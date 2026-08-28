import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { storage, newFileKey, validateUpload, sha256 } from '@/lib/storage';
import { auditAnonymous } from '@/lib/audit';
import { notifyUser, notifyRole } from '@/lib/notify';
import { emitEvent } from '@/lib/workflows';
import {
  INDEED_BOARD,
  indeedApplyEnabled,
  parseApplyPayload,
  payloadDigest,
  verifyApplySignature,
  type ApplyPayload,
} from '@/lib/indeed';

export const dynamic = 'force-dynamic';

/** Refuse oversized bodies before parsing anything. */
const MAX_BODY_BYTES = 12 * 1024 * 1024;

type Outcome = { status: 'ACCEPTED' | 'DUPLICATE' | 'REJECTED' | 'ERROR'; detail: string; http: number };

/**
 * Indeed Apply webhook (§16).
 *
 * Every delivery — accepted, duplicate, rejected or unsigned — is written to
 * the append-only JobBoardDelivery log, so "did Indeed send us that
 * candidate?" always has an answer. The log stores a digest, not a second
 * copy of the applicant's contact details.
 *
 * Idempotency is enforced by the database: Application.sourceRef is unique,
 * so a redelivery cannot create a second application even if two deliveries
 * race.
 */
export async function POST(request: NextRequest) {
  if (!indeedApplyEnabled()) return new NextResponse('Not found', { status: 404 });

  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    await log({ status: 'REJECTED', detail: 'Body exceeded the size limit.' });
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  const signature =
    request.headers.get('indeed-signature') ??
    request.headers.get('x-indeed-signature') ??
    request.headers.get('x-hub-signature-256');
  if (!verifyApplySignature(raw, signature)) {
    // Do not parse or store an unverified body beyond its shape: it is not
    // from Indeed as far as we know.
    await log({ status: 'REJECTED', detail: 'Signature verification failed.' });
    await auditAnonymous('indeed.apply_signature_rejected', {
      metadata: { bytes: raw.length, hadSignature: Boolean(signature) },
    });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    await log({ status: 'REJECTED', detail: 'Body was not valid JSON.' });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const digest = payloadDigest(body);
  const parsed = parseApplyPayload(body);
  if (!parsed.ok) {
    await log({ status: 'REJECTED', detail: parsed.error, digest });
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const outcome = await ingest(parsed.value, digest);
    return NextResponse.json(
      { status: outcome.status.toLowerCase(), detail: outcome.detail },
      { status: outcome.http },
    );
  } catch (error) {
    console.error('Indeed Apply ingest failed', error);
    await log({
      status: 'ERROR',
      detail: error instanceof Error ? error.message.slice(0, 400) : 'Unknown error',
      externalId: parsed.value.externalId,
      digest,
    });
    // 500 tells Indeed to retry; our idempotency key makes that safe.
    return NextResponse.json({ error: 'Could not process the application' }, { status: 500 });
  }
}

async function log(opts: {
  status: Outcome['status'];
  detail: string;
  externalId?: string | null;
  requisitionId?: string | null;
  applicationId?: string | null;
  digest?: Record<string, unknown>;
}) {
  await db.jobBoardDelivery.create({
    data: {
      board: INDEED_BOARD,
      status: opts.status,
      detail: opts.detail.slice(0, 500),
      externalId: opts.externalId ?? null,
      requisitionId: opts.requisitionId ?? null,
      applicationId: opts.applicationId ?? null,
      payloadDigest: { direction: 'inbound', ...(opts.digest ?? {}) },
    },
  });
}

async function ingest(payload: ApplyPayload, digest: Record<string, unknown>): Promise<Outcome> {
  const sourceRef = `${INDEED_BOARD}:${payload.externalId}`;

  const already = await db.application.findUnique({ where: { sourceRef }, select: { id: true } });
  if (already) {
    await log({
      status: 'DUPLICATE',
      detail: 'Already ingested — redelivery ignored.',
      externalId: payload.externalId,
      applicationId: already.id,
      digest,
    });
    return { status: 'DUPLICATE', detail: 'Already received.', http: 200 };
  }

  // The reference number is our requisition id, round-tripped through the
  // feed. Only a currently published, open job may receive applications —
  // otherwise anyone who ever saw a job id could post to a closed role.
  const posting = payload.referenceNumber
    ? await db.jobBoardPosting.findFirst({
        where: {
          requisitionId: payload.referenceNumber,
          board: INDEED_BOARD,
          status: 'PUBLISHED',
          requisition: { status: 'OPEN' },
        },
        include: { requisition: { select: { id: true, title: true, recruiterId: true, hiringManagerId: true } } },
      })
    : null;
  if (!posting) {
    await log({
      status: 'REJECTED',
      detail: payload.referenceNumber
        ? `No open published job matches reference ${payload.referenceNumber}.`
        : 'Delivery did not identify a job.',
      externalId: payload.externalId,
      digest,
    });
    return { status: 'REJECTED', detail: 'Unknown or closed job.', http: 422 };
  }

  const firstStage = await db.pipelineStage.findFirst({ orderBy: { order: 'asc' } });
  if (!firstStage) {
    throw new Error('No pipeline stages are configured.');
  }

  // Match an existing candidate by email so a repeat applicant stays one
  // person in the ATS. Without an email we cannot safely match, so we do not
  // guess on name alone — two different people share a name often enough.
  const existing = payload.email
    ? await db.candidate.findFirst({
        where: { email: { equals: payload.email, mode: 'insensitive' } },
        orderBy: { createdAt: 'desc' },
      })
    : null;

  const candidate = existing
    ? await db.candidate.update({
        where: { id: existing.id },
        data: {
          phone: existing.phone ?? payload.phone,
          // A fresher résumé is worth keeping; an empty one never overwrites.
          resumeText: payload.resumeText ?? existing.resumeText,
        },
      })
    : await db.candidate.create({
        data: {
          firstName: payload.firstName,
          lastName: payload.lastName,
          email: payload.email,
          phone: payload.phone,
          source: 'INDEED',
          resumeText: payload.resumeText,
          notes: payload.coverLetter ? `Cover letter (via Indeed):\n\n${payload.coverLetter}` : null,
        },
      });

  if (payload.resumeFileBase64 && payload.resumeFileName) {
    await storeResume(candidate.id, payload).catch((err) => {
      // A résumé we cannot store is not a reason to drop the application.
      console.error('Could not store Indeed résumé file', err);
    });
  }

  let application;
  try {
    application = await db.application.create({
      data: {
        candidateId: candidate.id,
        requisitionId: posting.requisitionId,
        stageId: firstStage.id,
        sourceBoard: INDEED_BOARD,
        sourceRef,
      },
    });
  } catch (error) {
    // Unique violation on (candidateId, requisitionId): this person already
    // has a live application for this job. Record it and move on.
    const code = (error as { code?: string }).code;
    if (code === 'P2002') {
      await log({
        status: 'DUPLICATE',
        detail: 'Candidate already has an application on this job.',
        externalId: payload.externalId,
        requisitionId: posting.requisitionId,
        digest,
      });
      return { status: 'DUPLICATE', detail: 'Already applied.', http: 200 };
    }
    throw error;
  }

  await log({
    status: 'ACCEPTED',
    detail: `Application created for ${posting.requisition.title}.`,
    externalId: payload.externalId,
    requisitionId: posting.requisitionId,
    applicationId: application.id,
    digest,
  });
  await auditAnonymous('recruiting.application_received', {
    metadata: {
      board: INDEED_BOARD,
      applicationId: application.id,
      requisitionId: posting.requisitionId,
      externalId: payload.externalId,
    },
  });

  await notifyOwners(posting.requisition, candidate);
  await emitEvent({
    type: 'CANDIDATE_APPLIED',
    data: {
      detail: `${candidate.firstName} ${candidate.lastName} — ${posting.requisition.title}`,
      applicationId: application.id,
      requisitionId: posting.requisitionId,
      source: INDEED_BOARD,
    },
  }).catch(() => {
    /* workflow failures are recorded on the run; never lose the application */
  });

  return { status: 'ACCEPTED', detail: 'Application received.', http: 201 };
}

async function storeResume(candidateId: string, payload: ApplyPayload) {
  const data = Buffer.from(payload.resumeFileBase64!, 'base64');
  const fileName = payload.resumeFileName!.replace(/[^\w.\- ]/g, '_').slice(0, 120);
  const mimeType = guessMime(fileName);
  const check = validateUpload(fileName, mimeType, data);
  if (!check.ok) throw new Error(check.error);

  const key = newFileKey(fileName);
  await storage().put(key, data, mimeType);
  const doc = await db.document.create({
    data: {
      title: `Résumé — ${fileName}`,
      category: 'OTHER',
      classification: 'CONFIDENTIAL',
      tags: ['candidate-resume', 'indeed'],
      versions: {
        create: { version: 1, fileKey: key, fileName, mimeType, sizeBytes: data.length, sha256: sha256(data) },
      },
    },
  });
  await db.candidate.update({ where: { id: candidateId }, data: { resumeDocId: doc.id } });
}

function guessMime(fileName: string): string {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.doc':
      return 'application/msword';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

async function notifyOwners(
  requisition: { id: string; title: string; recruiterId: string | null; hiringManagerId: string | null },
  candidate: { firstName: string; lastName: string },
) {
  const workerIds = [requisition.recruiterId, requisition.hiringManagerId].filter(Boolean) as string[];
  const opts = {
    kind: 'INFO' as const,
    title: `New Indeed application: ${requisition.title}`,
    body: `${candidate.firstName} ${candidate.lastName} applied through Indeed.`,
    href: `/recruiting/jobs/${requisition.id}`,
  };
  if (workerIds.length === 0) {
    await notifyRole('RECRUITER', opts);
    return;
  }
  const workers = await db.worker.findMany({
    where: { id: { in: workerIds } },
    select: { user: { select: { id: true, status: true } } },
  });
  const userIds = workers.map((w) => w.user).filter((u) => u && u.status === 'ACTIVE');
  if (userIds.length === 0) {
    await notifyRole('RECRUITER', opts);
    return;
  }
  for (const user of userIds) await notifyUser(user!.id, opts);
}
