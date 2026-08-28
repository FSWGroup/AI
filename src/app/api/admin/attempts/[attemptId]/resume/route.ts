/**
 * Résumé upload for a candidate.
 *
 * Accepts a PDF/DOCX/TXT file (multipart) or pasted text. Files go to
 * private object storage; extracted text is stored for analysis and is
 * never shown to candidates. Every upload is audited.
 */

import { prisma } from "@/lib/db";
import { apiError, apiOk, withErrorHandling } from "@/lib/api";
import { requirePermission, requestMeta } from "@/lib/auth/session";
import { assertAttemptAccess } from "@/lib/auth/scope";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { getStorage } from "@/lib/storage";
import {
  MAX_DOCUMENT_BYTES,
  MAX_EXTRACTED_CHARS,
  detectKind,
  extractText,
} from "@/lib/documents/extract";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = withErrorHandling(async (req, ctx) => {
  const user = await requirePermission("MANAGE_CANDIDATES");
  const { attemptId } = await ctx.params;
  await assertAttemptAccess(user, attemptId);

  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    select: { id: true, candidateId: true },
  });
  if (!attempt) return apiError("Attempt not found.", 404);

  const contentType = req.headers.get("content-type") ?? "";
  let fileName = "pasted-resume.txt";
  let mimeType = "text/plain";
  let bytes: Buffer | null = null;
  let text = "";
  let textSource: "extracted" | "pasted" = "extracted";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return apiError("No file was uploaded.", 422);
    if (file.size === 0) return apiError("The uploaded file is empty.", 422);
    if (file.size > MAX_DOCUMENT_BYTES) {
      return apiError("That file is larger than 10 MB. Upload a smaller file.", 413);
    }
    fileName = file.name.slice(0, 200) || "resume";
    mimeType = file.type || "application/octet-stream";
    if (!detectKind(mimeType, fileName)) {
      return apiError(
        "Unsupported file type. Upload a PDF, DOCX, or plain-text file — or paste the text instead.",
        415,
      );
    }
    bytes = Buffer.from(await file.arrayBuffer());
    const result = await extractText(bytes, mimeType, fileName);
    if (!result.ok) {
      // Keep the file, report the problem, and let the admin paste text.
      const stored = await storeFile(attemptId, fileName, bytes, mimeType);
      const doc = await prisma.candidateDocument.create({
        data: {
          candidateId: attempt.candidateId,
          attemptId,
          fileName,
          mimeType,
          sizeBytes: bytes.length,
          objectKey: stored,
          extractedText: result.text || null,
          textSource: "extracted",
          uploadedById: user.id,
        },
      });
      return apiOk({
        documentId: doc.id,
        extractionFailed: true,
        message: result.reason,
      });
    }
    text = result.text;
  } else {
    const body = (await req.json().catch(() => null)) as { text?: string } | null;
    const pasted = (body?.text ?? "").trim();
    if (pasted.length < 50) {
      return apiError("Please paste the full résumé text (at least 50 characters).", 422);
    }
    text = pasted.slice(0, MAX_EXTRACTED_CHARS);
    textSource = "pasted";
  }

  const objectKey = bytes
    ? await storeFile(attemptId, fileName, bytes, mimeType)
    : null;

  const doc = await prisma.candidateDocument.create({
    data: {
      candidateId: attempt.candidateId,
      attemptId,
      fileName,
      mimeType,
      sizeBytes: bytes?.length ?? Buffer.byteLength(text, "utf8"),
      objectKey,
      extractedText: text,
      textSource,
      uploadedById: user.id,
    },
  });

  const meta = await requestMeta();
  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.RESUME_UPLOADED,
    entityType: "CandidateDocument",
    entityId: doc.id,
    newValue: { attemptId, fileName, textSource, chars: text.length },
    ip: meta.ip,
  });

  return apiOk({
    documentId: doc.id,
    fileName: doc.fileName,
    characters: text.length,
    extractionFailed: false,
  });
});

async function storeFile(
  attemptId: string,
  fileName: string,
  bytes: Buffer,
  mimeType: string,
): Promise<string> {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 100);
  const key = `candidate-documents/${attemptId}/${Date.now()}-${safe}`;
  await getStorage().putObject(key, bytes, mimeType);
  return key;
}

/** Replace the stored text for a document whose extraction failed. */
export const PATCH = withErrorHandling(async (req, ctx) => {
  const user = await requirePermission("MANAGE_CANDIDATES");
  const { attemptId } = await ctx.params;
  await assertAttemptAccess(user, attemptId);

  const body = (await req.json().catch(() => null)) as {
    documentId?: string;
    text?: string;
  } | null;
  const text = (body?.text ?? "").trim();
  if (!body?.documentId || text.length < 50) {
    return apiError("Please paste the full résumé text (at least 50 characters).", 422);
  }

  const doc = await prisma.candidateDocument.findUnique({
    where: { id: body.documentId },
  });
  if (!doc || doc.attemptId !== attemptId) {
    return apiError("Document not found.", 404);
  }

  await prisma.candidateDocument.update({
    where: { id: doc.id },
    data: { extractedText: text.slice(0, MAX_EXTRACTED_CHARS), textSource: "pasted" },
  });
  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.RESUME_UPLOADED,
    entityType: "CandidateDocument",
    entityId: doc.id,
    newValue: { attemptId, textSource: "pasted", chars: text.length },
  });
  return apiOk({ documentId: doc.id, characters: text.length });
});

/** Remove a résumé and its stored file. */
export const DELETE = withErrorHandling(async (req, ctx) => {
  const user = await requirePermission("MANAGE_CANDIDATES");
  const { attemptId } = await ctx.params;
  await assertAttemptAccess(user, attemptId);

  const url = new URL(req.url);
  const documentId = url.searchParams.get("documentId");
  if (!documentId) return apiError("Missing document id.", 422);

  const doc = await prisma.candidateDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.attemptId !== attemptId) return apiError("Document not found.", 404);

  if (doc.objectKey) {
    await getStorage().deleteObject(doc.objectKey);
  }
  await prisma.candidateDocument.delete({ where: { id: doc.id } });
  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.RESUME_DELETED,
    entityType: "CandidateDocument",
    entityId: doc.id,
    previousValue: { attemptId, fileName: doc.fileName },
  });
  return apiOk({ ok: true });
});
