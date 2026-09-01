'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireCtxAction, requirePermission, workerAccess, can, AuthzError } from '@/lib/authz';
import { storage, newFileKey, sha256, validateUpload } from '@/lib/storage';
import { signDownload } from '@/lib/crypto';
import { audit } from '@/lib/audit';
import { recordTimeline } from '@/lib/timeline';
import { requestMeta } from '@/lib/auth/session';
import type { ActionResult } from '@/app/(auth)/actions';
import type { DocumentCategory, DataClassification } from '@/generated/prisma/enums';
import { env } from '@/lib/env';
import { notifyUser } from '@/lib/notify';
import { esign, esignConfigured } from '@/lib/esign';
import { recordSignatureEvent, storeSignedArtifacts } from '@/lib/signatures';

export async function uploadDocumentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('docs.write');
    const file = formData.get('file') as File | null;
    if (!file || file.size === 0) return { error: 'Choose a file to upload.' };
    const buffer = Buffer.from(await file.arrayBuffer());
    const check = validateUpload(file.name, file.type, buffer);
    if (!check.ok) return { error: check.error };

    const title = String(formData.get('title') ?? '').trim() || file.name;
    const workerId = String(formData.get('workerId') ?? '') || null;
    const documentId = String(formData.get('documentId') ?? '') || null;

    const key = newFileKey(file.name);
    await storage().put(key, buffer, file.type);

    let docId: string;
    if (documentId) {
      // New version of an existing document
      const doc = await db.document.findUniqueOrThrow({ where: { id: documentId }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
      // docs.write is HR-only today, but check the individual document too so
      // the permission stays safe to delegate more narrowly later.
      if (!(await canAccessDocument(ctx, doc))) throw new AuthzError();
      await db.documentVersion.create({
        data: {
          documentId,
          version: (doc.versions[0]?.version ?? 0) + 1,
          fileKey: key,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: buffer.length,
          sha256: sha256(buffer),
          uploadedById: ctx.userId,
          approvedBy: String(formData.get('approvedBy') ?? '') || null,
          effectiveAt: formData.get('effectiveAt') ? new Date(String(formData.get('effectiveAt'))) : new Date(),
        },
      });
      docId = documentId;
    } else {
      const doc = await db.document.create({
        data: {
          title,
          category: (String(formData.get('category') ?? 'OTHER') as DocumentCategory) ?? 'OTHER',
          classification: (String(formData.get('classification') ?? 'CONFIDENTIAL') as DataClassification) ?? 'CONFIDENTIAL',
          workerId,
          requiresSignature: formData.get('requiresSignature') === 'on',
          expiresAt: formData.get('expiresAt') ? new Date(String(formData.get('expiresAt'))) : null,
          uploadedById: ctx.userId,
          versions: {
            create: {
              version: 1,
              fileKey: key,
              fileName: file.name,
              mimeType: file.type,
              sizeBytes: buffer.length,
              sha256: sha256(buffer),
              uploadedById: ctx.userId,
              approvedBy: String(formData.get('approvedBy') ?? '') || null,
              effectiveAt: formData.get('effectiveAt') ? new Date(String(formData.get('effectiveAt'))) : new Date(),
            },
          },
        },
      });
      docId = doc.id;
    }
    await audit(ctx, 'document.uploaded', {
      targetType: 'Document',
      targetId: docId,
      metadata: { fileName: file.name, size: buffer.length, workerId },
    });
    revalidatePath('/documents');
    redirect(`/documents/${docId}`);
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'Upload failed. Please try again.' };
  }
}

/** Access rule shared by detail page + download endpoint. */
export async function canAccessDocument(
  ctx: Awaited<ReturnType<typeof requireCtxAction>>,
  doc: { id?: string; workerId: string | null; classification: string },
): Promise<boolean> {
  if (can(ctx, 'docs.read_all')) return true;
  // Candidate résumés sit outside the worker hierarchy — an applicant is not
  // an employee, so no workerId rule can reach them. Recruiters need them,
  // and nobody else does.
  if (doc.id && !doc.workerId && can(ctx, 'recruiting.read')) {
    const isCandidateResume = await db.candidate.count({ where: { resumeDocId: doc.id } });
    if (isCandidateResume > 0) return true;
  }
  if (doc.workerId) {
    const access = await workerAccess(ctx, doc.workerId);
    if (access.self) return true;
    // Managers see their reports' non-restricted documents
    if (access.manager && doc.classification !== 'HIGHLY_RESTRICTED') return true;
  } else if (doc.classification === 'PUBLIC_INTERNAL' || doc.classification === 'INTERNAL') {
    // Company-wide documents (handbook etc.)
    return true;
  }
  return false;
}

/** Produce a short-lived signed download URL after an authorization check. */
export async function getDownloadUrlAction(versionId: string): Promise<{ error?: string; url?: string }> {
  try {
    const ctx = await requireCtxAction();
    const version = await db.documentVersion.findUnique({
      where: { id: versionId },
      include: { document: true },
    });
    if (!version || version.document.deletedAt) return { error: 'Document not found.' };
    if (!(await canAccessDocument(ctx, version.document))) throw new AuthzError();
    const expiresAt = Date.now() + 5 * 60_000; // 5 minutes
    const token = signDownload({ versionId, userId: ctx.userId, expiresAt });
    return { url: `/api/documents/${versionId}?t=${encodeURIComponent(token)}` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not create the download link.' };
  }
}

/** Internal e-signature / acknowledgment (§26): immutable, version-bound. */
export async function signDocumentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    if (!ctx.workerId) return { error: 'Your account is not linked to a worker profile.' };
    const versionId = String(formData.get('versionId') ?? '');
    const signedName = String(formData.get('signedName') ?? '').trim();
    if (!signedName) return { error: 'Type your full name to sign.' };
    const version = await db.documentVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { document: true },
    });
    if (version.document.workerId && version.document.workerId !== ctx.workerId) {
      throw new AuthzError('Only the document owner can sign it.');
    }
    const meta = await requestMeta();
    await db.documentSignature.create({
      data: {
        documentVersionId: versionId,
        workerId: ctx.workerId,
        userId: ctx.userId,
        kind: String(formData.get('kind') ?? 'SIGNATURE'),
        signedName,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    await audit(ctx, 'document.signed', {
      targetType: 'DocumentVersion',
      targetId: versionId,
      metadata: { document: version.document.title, version: version.version },
    });
    await recordTimeline({
      workerId: ctx.workerId,
      kind: 'POLICY_ACK',
      title: `Signed: ${version.document.title} (v${version.version})`,
      visibility: 'HR',
      actorUserId: ctx.userId,
    });
    revalidatePath(`/documents/${version.documentId}`);
    return { success: 'Signed. The signature event is immutable and audited.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      return { error: 'You have already signed this version.' };
    }
    return { error: 'Could not record the signature.' };
  }
}

export async function deleteDocumentAction(formData: FormData): Promise<void> {
  const ctx = await requirePermission('docs.write');
  const documentId = String(formData.get('documentId') ?? '');
  const doc = await db.document.findUniqueOrThrow({ where: { id: documentId } });
  if (!(await canAccessDocument(ctx, doc))) throw new AuthzError();
  if (doc.retentionDate && doc.retentionDate > new Date()) {
    throw new AuthzError(`This record is under retention until ${doc.retentionDate.toDateString()}.`);
  }
  // Soft delete: content stays for the retention workflow; destruction requires
  // retention.admin approval (Admin → Compliance → Retention).
  await db.document.update({ where: { id: documentId }, data: { deletedAt: new Date() } });
  await audit(ctx, 'document.deleted', { targetType: 'Document', targetId: documentId, metadata: { title: doc.title } });
  revalidatePath('/documents');
}

// ---------------------------------------------------------------------------
// Certified e-signature
// ---------------------------------------------------------------------------

/**
 * Ask a worker to sign a document at the e-signature provider.
 *
 * Distinct from signDocumentAction above, which records an *internal
 * acknowledgment* — a typed name and an IP. This one produces a tamper-evident
 * certificate from a specialist provider, and is what an offer letter or a
 * contractor agreement needs.
 */
export async function requestSignatureAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('docs.write');
    if (!esignConfigured()) {
      return {
        error: 'Certified e-signature is not configured. An administrator sets the SignNow credentials — see Admin › Integrations.',
      };
    }
    const versionId = String(formData.get('versionId') ?? '');
    const workerId = String(formData.get('workerId') ?? '');
    if (!versionId || !workerId) return { error: 'Pick a document and a signer.' };

    const [version, worker] = await Promise.all([
      db.documentVersion.findUniqueOrThrow({ where: { id: versionId }, include: { document: true } }),
      db.worker.findUniqueOrThrow({
        where: { id: workerId },
        select: {
          id: true, legalFirstName: true, preferredName: true, lastName: true,
          workEmail: true, personalEmail: true, status: true,
        },
      }),
    ]);
    if (!(await canAccessDocument(ctx, version.document))) throw new AuthzError();

    if (version.mimeType !== 'application/pdf') {
      return { error: 'Only PDFs can be sent for certified signature. Upload a PDF version first.' };
    }
    const signerEmail = worker.workEmail ?? worker.personalEmail;
    if (!signerEmail) return { error: 'That worker has no email address on file to send the request to.' };

    // One live request per document version per signer. A second would produce
    // two certificates for the same signature and neither would be canonical.
    const existing = await db.signatureRequest.findFirst({
      where: { documentVersionId: versionId, workerId, status: { in: ['DRAFT', 'SENT', 'VIEWED', 'SIGNED'] } },
      select: { id: true, status: true },
    });
    if (existing) {
      return { error: `A signature request for this document is already ${existing.status.toLowerCase()}.` };
    }

    const dueDaysRaw = Number(formData.get('dueDays'));
    const dueDays = Number.isFinite(dueDaysRaw) && dueDaysRaw > 0 ? dueDaysRaw : 7;
    const signerName = `${worker.preferredName || worker.legalFirstName} ${worker.lastName}`;

    const request = await db.signatureRequest.create({
      data: {
        documentVersionId: versionId,
        workerId,
        // Captured now: a later name change must not rewrite who was asked.
        signerName,
        signerEmail,
        provider: 'SIGNNOW',
        message: String(formData.get('message') ?? '') || null,
        dueAt: new Date(Date.now() + dueDays * 86_400_000),
        requestedById: ctx.userId,
      },
    });
    await recordSignatureEvent({ requestId: request.id, kind: 'CREATED', detail: `Requested by ${ctx.email}.` });

    try {
      const file = await storage().get(version.fileKey);
      const created = await esign().createRequest({
        file,
        fileName: version.fileName,
        documentTitle: version.document.title,
        signerName,
        signerEmail,
        message: request.message,
        redirectUrl: `${env.APP_BASE_URL.replace(/\/$/, '')}/documents/${version.documentId}`,
      });
      await db.signatureRequest.update({
        where: { id: request.id },
        data: {
          providerDocumentId: created.providerDocumentId,
          providerInviteId: created.providerInviteId,
          status: 'SENT',
          sentAt: new Date(),
        },
      });
      await recordSignatureEvent({ requestId: request.id, kind: 'SENT', detail: `Sent to ${signerEmail}.` });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 400) : 'Could not reach the provider.';
      await db.signatureRequest.update({
        where: { id: request.id },
        data: { status: 'FAILED', lastError: message },
      });
      await recordSignatureEvent({ requestId: request.id, kind: 'ERROR', detail: message });
      return { error: `The request was recorded but the provider rejected it: ${message}` };
    }

    await audit(ctx, 'esign.requested', {
      targetType: 'SignatureRequest',
      targetId: request.id,
      metadata: { documentId: version.documentId, workerId, provider: 'SIGNNOW' },
    });
    await notifyUser(
      (await db.worker.findUnique({ where: { id: workerId }, select: { userId: true } }))?.userId ?? '',
      {
        kind: 'TASK',
        title: `Signature requested: ${version.document.title}`,
        body: 'Open it to review and sign.',
        href: `/documents/${version.documentId}`,
        email: true,
      },
    ).catch(() => {
      /* a worker with no user account still gets the provider's own email */
    });

    revalidatePath(`/documents/${version.documentId}`);
    revalidatePath('/documents/signatures');
    return { success: `Sent to ${signerName}. They will get an email from the signing provider.` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'Could not request the signature.' };
  }
}

/**
 * Mint a short-lived signing link for the signer themselves.
 *
 * Only the person being asked to sign can get one — not their manager, not HR.
 * A link that someone else could obtain would let them sign in the worker's
 * name, which is the one thing a signature must never allow.
 */
export async function getSigningLinkAction(requestId: string): Promise<{ error?: string; url?: string }> {
  try {
    const ctx = await requireCtxAction();
    const request = await db.signatureRequest.findUnique({
      where: { id: requestId },
      select: { id: true, workerId: true, status: true, providerDocumentId: true, signerEmail: true },
    });
    if (!request) return { error: 'Signature request not found.' };
    if (request.workerId !== ctx.workerId) {
      throw new AuthzError('Only the person being asked to sign can open the signing session.');
    }
    if (!['SENT', 'VIEWED'].includes(request.status)) {
      return { error: `This request is ${request.status.toLowerCase()} and cannot be signed.` };
    }
    if (!request.providerDocumentId) return { error: 'This request never reached the provider.' };

    const link = await esign().signingLink(request.providerDocumentId, request.signerEmail);
    await recordSignatureEvent({ requestId: request.id, kind: 'VIEWED', detail: 'Signing session opened.' });
    await audit(ctx, 'esign.signing_opened', { targetType: 'SignatureRequest', targetId: request.id });
    return { url: link.url };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: error instanceof Error ? error.message : 'Could not open the signing session.' };
  }
}

/** Nudge a signer. Rate-limited so "remind" cannot become harassment. */
export async function remindSignatureAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('docs.write');
    const requestId = String(formData.get('requestId') ?? '');
    const request = await db.signatureRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (!['SENT', 'VIEWED'].includes(request.status)) {
      return { error: 'Only an outstanding request can be reminded.' };
    }
    if (request.lastReminderAt && Date.now() - request.lastReminderAt.getTime() < 24 * 3_600_000) {
      return { error: 'A reminder went out within the last 24 hours.' };
    }
    if (!request.providerDocumentId) return { error: 'This request never reached the provider.' };

    await esign().remind(request.providerDocumentId);
    await db.signatureRequest.update({
      where: { id: requestId },
      data: { remindersSent: { increment: 1 }, lastReminderAt: new Date() },
    });
    await recordSignatureEvent({ requestId, kind: 'REMINDED', detail: `Reminded by ${ctx.email}.` });
    await audit(ctx, 'esign.reminded', { targetType: 'SignatureRequest', targetId: requestId });
    revalidatePath('/documents/signatures');
    return { success: 'Reminder sent.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: error instanceof Error ? error.message : 'Could not send the reminder.' };
  }
}

export async function cancelSignatureAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('docs.write');
    const requestId = String(formData.get('requestId') ?? '');
    const request = await db.signatureRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (['STORED', 'DECLINED', 'CANCELED'].includes(request.status)) {
      return { error: `This request is already ${request.status.toLowerCase()}.` };
    }
    if (request.providerDocumentId) {
      await esign().cancel(request.providerDocumentId).catch(() => {
        /* cancelling locally still matters if the provider call fails */
      });
    }
    await db.signatureRequest.update({
      where: { id: requestId },
      data: { status: 'CANCELED', canceledById: ctx.userId },
    });
    await recordSignatureEvent({ requestId, kind: 'CANCELED', detail: `Cancelled by ${ctx.email}.` });
    await audit(ctx, 'esign.canceled', { targetType: 'SignatureRequest', targetId: requestId });
    revalidatePath('/documents/signatures');
    return { success: 'Request cancelled.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not cancel the request.' };
  }
}

/** Retry a completed signature whose artifacts we failed to download. */
export async function retryStoreSignedAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('docs.write');
    const requestId = String(formData.get('requestId') ?? '');
    const result = await storeSignedArtifacts(requestId);
    await audit(ctx, 'esign.store_retried', {
      targetType: 'SignatureRequest',
      targetId: requestId,
      metadata: { stored: result.stored },
    });
    revalidatePath('/documents/signatures');
    return result.stored
      ? { success: 'Signed document and certificate stored.' }
      : { error: result.reason ?? 'Still could not download it.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not retry.' };
  }
}

/** Short-lived signed URL for a signature's audit certificate. */
export async function getCertificateUrlAction(requestId: string): Promise<{ error?: string; url?: string }> {
  try {
    const ctx = await requireCtxAction();
    const signature = await db.signatureRequest.findUnique({
      where: { id: requestId },
      include: { documentVersion: { include: { document: true } } },
    });
    if (!signature?.certificateFileKey) return { error: 'No certificate is stored for that signature.' };
    if (!(await canAccessDocument(ctx, signature.documentVersion.document))) throw new AuthzError();
    const expiresAt = Date.now() + 5 * 60_000;
    const token = signDownload({ versionId: requestId, userId: ctx.userId, expiresAt });
    return { url: `/api/signatures/${requestId}/certificate?t=${encodeURIComponent(token)}` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not create the download link.' };
  }
}
