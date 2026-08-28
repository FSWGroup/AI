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
  doc: { workerId: string | null; classification: string },
): Promise<boolean> {
  if (can(ctx, 'docs.read_all')) return true;
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
