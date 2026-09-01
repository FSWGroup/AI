import 'server-only';
import { db } from '@/lib/db';
import { storage, newFileKey, sha256 } from '@/lib/storage';
import { esign } from '@/lib/esign';
import { canTransition, isOverdue, type SignatureStatus, type ParsedWebhookEvent } from '@/lib/esign/types';
import type { Prisma } from '@/generated/prisma/client';
import type { PayloadDigest } from '@/lib/esign/signnow';

/**
 * The signature lifecycle, independent of any provider.
 *
 * This is where the "three systems of record" discipline is enforced:
 * FSW People owns status, our own storage owns the bytes, and the provider's
 * evidence is copied here at completion rather than left with them.
 */

export interface RecordEventInput {
  requestId: string;
  kind: string;
  detail?: string | null;
  providerEventId?: string | null;
  payloadDigest?: PayloadDigest | null;
  at?: Date;
}

/**
 * Append an event.
 *
 * Returns false when the provider event id has been seen before — that is the
 * idempotency check, enforced by a unique index rather than a read-then-write
 * that two concurrent deliveries could both pass.
 */
export async function recordSignatureEvent(input: RecordEventInput): Promise<boolean> {
  try {
    await db.signatureEvent.create({
      data: {
        requestId: input.requestId,
        kind: input.kind,
        detail: input.detail?.slice(0, 500) ?? null,
        providerEventId: input.providerEventId ?? null,
        payloadDigest: (input.payloadDigest ?? undefined) as Prisma.InputJsonValue | undefined,
        at: input.at ?? new Date(),
      },
    });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return false; // already seen
    throw error;
  }
}

/**
 * Move a request to a new status, if the transition is legal.
 *
 * Returns false when it is not — which is the normal case for an out-of-order
 * webhook, not an error. Providers deliver events out of order routinely, and
 * a VIEWED arriving after SIGNED must never un-sign a document.
 */
export async function advanceStatus(
  requestId: string,
  to: SignatureStatus,
  data: Prisma.SignatureRequestUpdateInput = {},
): Promise<boolean> {
  const request = await db.signatureRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  });
  if (!request) return false;
  if (request.status === to) return false;
  if (!canTransition(request.status as SignatureStatus, to)) return false;

  await db.signatureRequest.update({ where: { id: requestId }, data: { ...data, status: to } });
  return true;
}

/**
 * Fetch the completed artifacts and put them somewhere we control.
 *
 * Deliberately separate from marking the request SIGNED. The provider saying
 * "done" and us actually holding the bytes are different facts, and collapsing
 * them would let a failed download masquerade as a completed signature.
 *
 * Idempotent: a request already STORED returns without re-downloading.
 */
export async function storeSignedArtifacts(requestId: string): Promise<{ stored: boolean; reason?: string }> {
  const request = await db.signatureRequest.findUnique({
    where: { id: requestId },
    include: { documentVersion: { include: { document: true } } },
  });
  if (!request) return { stored: false, reason: 'Request not found.' };
  if (request.status === 'STORED') return { stored: true };
  if (!request.providerDocumentId) return { stored: false, reason: 'No provider document id.' };

  try {
    const { pdf, certificate } = await esign().downloadSigned(request.providerDocumentId);

    const baseName = request.documentVersion.fileName.replace(/\.pdf$/i, '');
    const signedKey = newFileKey(`${baseName}-signed.pdf`);
    await storage().put(signedKey, pdf, 'application/pdf');

    let certificateKey: string | null = null;
    if (certificate) {
      certificateKey = newFileKey(`${baseName}-certificate.pdf`);
      await storage().put(certificateKey, certificate, 'application/pdf');
    }

    // The signed PDF becomes a new version of the same document, so it joins
    // the existing history and is downloadable through the same audited,
    // signed-URL route as everything else. No second access path to maintain.
    const latest = await db.documentVersion.findFirst({
      where: { documentId: request.documentVersion.documentId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const signedVersion = await db.documentVersion.create({
      data: {
        documentId: request.documentVersion.documentId,
        version: (latest?.version ?? request.documentVersion.version) + 1,
        fileKey: signedKey,
        fileName: `${baseName}-signed.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: pdf.length,
        sha256: sha256(pdf),
        effectiveAt: new Date(),
      },
    });

    await db.signatureRequest.update({
      where: { id: requestId },
      data: {
        status: 'STORED',
        storedAt: new Date(),
        signedFileKey: signedKey,
        certificateFileKey: certificateKey,
        signedSha256: sha256(pdf),
        signedVersionId: signedVersion.id,
        lastError: null,
      },
    });
    await recordSignatureEvent({
      requestId,
      kind: 'STORED',
      detail: certificate
        ? 'Signed document and audit certificate stored.'
        : 'Signed document stored. The provider returned no audit certificate.',
    });
    return { stored: true };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 400) : 'Download failed.';
    await db.signatureRequest.update({
      where: { id: requestId },
      data: { status: 'FAILED', lastError: message },
    });
    await recordSignatureEvent({ requestId, kind: 'ERROR', detail: message });
    return { stored: false, reason: message };
  }
}

/**
 * Apply a parsed provider event to a request.
 *
 * The whole webhook path funnels through here so the ordering and idempotency
 * rules live in one tested place rather than in a route handler.
 */
export async function applySignatureEvent(
  event: ParsedWebhookEvent,
  payloadDigest?: PayloadDigest,
): Promise<{ handled: boolean; reason: string; requestId?: string }> {
  const request = await db.signatureRequest.findUnique({
    where: { providerDocumentId: event.providerDocumentId },
    select: { id: true, status: true },
  });
  if (!request) return { handled: false, reason: 'No signature request matches that document.' };

  const fresh = await recordSignatureEvent({
    requestId: request.id,
    kind: event.kind,
    detail: event.detail,
    providerEventId: event.providerEventId,
    payloadDigest,
    at: event.occurredAt,
  });
  if (!fresh) return { handled: true, reason: 'Duplicate delivery ignored.', requestId: request.id };

  const timestamps: Record<string, Prisma.SignatureRequestUpdateInput> = {
    SENT: { sentAt: event.occurredAt },
    VIEWED: { viewedAt: event.occurredAt },
    SIGNED: { signedAt: event.occurredAt },
    DECLINED: { declinedAt: event.occurredAt, declineReason: event.detail ?? null },
    EXPIRED: {},
  };

  const moved = await advanceStatus(request.id, event.kind as SignatureStatus, timestamps[event.kind] ?? {});
  if (!moved) {
    return {
      handled: true,
      reason: `Event recorded; status stays ${request.status} (out-of-order or already past this point).`,
      requestId: request.id,
    };
  }

  if (event.kind === 'SIGNED') {
    const result = await storeSignedArtifacts(request.id);
    return {
      handled: true,
      reason: result.stored ? 'Signed and stored.' : `Signed, but storing failed: ${result.reason}`,
      requestId: request.id,
    };
  }
  return { handled: true, reason: `Status advanced to ${event.kind}.`, requestId: request.id };
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface SignatureSummary {
  total: number;
  outstanding: number;
  overdue: number;
  signed: number;
  declined: number;
  failed: number;
}

/**
 * Status counts, read from our own tables only.
 *
 * Never by querying the provider or SharePoint live — a dashboard that did
 * that would be slow, rate-limited, and blank whenever a vendor had a bad day.
 */
export async function signatureSummary(now = new Date()): Promise<SignatureSummary> {
  const requests = await db.signatureRequest.findMany({ select: { status: true, dueAt: true } });
  return {
    total: requests.length,
    outstanding: requests.filter((r) => ['DRAFT', 'SENT', 'VIEWED'].includes(r.status)).length,
    overdue: requests.filter((r) => isOverdue(r.status, r.dueAt, now)).length,
    signed: requests.filter((r) => r.status === 'STORED' || r.status === 'SIGNED').length,
    declined: requests.filter((r) => r.status === 'DECLINED').length,
    failed: requests.filter((r) => r.status === 'FAILED').length,
  };
}

/** Requests still waiting, oldest and most overdue first. */
export async function outstandingRequests(limit = 100) {
  return db.signatureRequest.findMany({
    where: { status: { in: ['DRAFT', 'SENT', 'VIEWED'] } },
    include: {
      worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
      documentVersion: { include: { document: { select: { id: true, title: true, category: true } } } },
    },
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
  });
}

/**
 * Requests that reached SIGNED but never reached STORED.
 *
 * This is the queue that matters operationally: the provider says it is done
 * and we do not hold the evidence. Retried by the maintenance sweep, and
 * surfaced so a persistent failure cannot sit unnoticed.
 */
export async function requestsAwaitingStorage(limit = 25) {
  return db.signatureRequest.findMany({
    where: { status: { in: ['SIGNED', 'FAILED'] }, providerDocumentId: { not: null } },
    orderBy: { signedAt: 'asc' },
    take: limit,
    select: { id: true, status: true, signedAt: true, lastError: true },
  });
}
