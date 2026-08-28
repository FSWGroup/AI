import crypto from "node:crypto";
import { getActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getStorage, buildStorageKey, sanitizeFilename } from "@/lib/storage";
import { findDuplicateBySha256 } from "@/lib/services/media";
import { sniffIsScormZip, ingestScormPackage, listZipEntryNames } from "@/lib/services/scorm";
import { getSettings } from "@/lib/settings";
import { recordAudit } from "@/lib/audit";
import { enqueueJob, JOB_TYPES } from "@/lib/jobs/queue";
import type { MediaKind } from "@prisma/client";

/**
 * Media upload. Untrusted content: every file is validated by BOTH its
 * extension AND its sniffed magic bytes before anything is written to
 * storage — a renamed executable does not pass because it changed its
 * extension.
 */

interface AllowedType {
  extensions: string[];
  mimeType: string;
  kind: MediaKind;
  sniff: (buf: Buffer) => boolean;
}

function ascii(buf: Buffer, start: number, end: number): string {
  return buf.length >= end ? buf.toString("ascii", start, end) : "";
}

function isZipSignature(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  return (
    (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) ||
    (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x05 && buf[3] === 0x06)
  );
}

function zipHasEntry(buf: Buffer, entryName: string): boolean {
  return listZipEntryNames(buf).some((n) => n.toLowerCase() === entryName.toLowerCase());
}

const ALLOWLIST: AllowedType[] = [
  {
    extensions: ["png"],
    mimeType: "image/png",
    kind: "IMAGE",
    sniff: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    extensions: ["jpg", "jpeg"],
    mimeType: "image/jpeg",
    kind: "IMAGE",
    sniff: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  { extensions: ["gif"], mimeType: "image/gif", kind: "IMAGE", sniff: (b) => ascii(b, 0, 4) === "GIF8" },
  {
    extensions: ["webp"],
    mimeType: "image/webp",
    kind: "IMAGE",
    sniff: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
  },
  { extensions: ["pdf"], mimeType: "application/pdf", kind: "DOCUMENT", sniff: (b) => ascii(b, 0, 5) === "%PDF-" },
  {
    extensions: ["mp4", "m4v"],
    mimeType: "video/mp4",
    kind: "VIDEO",
    sniff: (b) => ascii(b, 4, 8) === "ftyp",
  },
  {
    extensions: ["webm"],
    mimeType: "video/webm",
    kind: "VIDEO",
    sniff: (b) => b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  },
  {
    extensions: ["mp3"],
    mimeType: "audio/mpeg",
    kind: "AUDIO",
    sniff: (b) => ascii(b, 0, 3) === "ID3" || (b.length >= 2 && b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0),
  },
  {
    extensions: ["wav"],
    mimeType: "audio/wav",
    kind: "AUDIO",
    sniff: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WAVE",
  },
  {
    extensions: ["docx"],
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "DOCUMENT",
    sniff: (b) => isZipSignature(b) && zipHasEntry(b, "word/document.xml"),
  },
  {
    extensions: ["xlsx"],
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "DOCUMENT",
    sniff: (b) => isZipSignature(b) && zipHasEntry(b, "xl/workbook.xml"),
  },
  {
    extensions: ["pptx"],
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    kind: "DOCUMENT",
    sniff: (b) => isZipSignature(b) && zipHasEntry(b, "ppt/presentation.xml"),
  },
  { extensions: ["zip"], mimeType: "application/zip", kind: "DOCUMENT", sniff: (b) => isZipSignature(b) },
];

const ALLOWED_EXTENSION_LIST = ALLOWLIST.flatMap((a) => a.extensions).join(", ");

export async function POST(request: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!actor.permissions.has("media.upload")) {
    return Response.json({ error: "You don't have permission to upload media." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Could not read the upload. Send it as multipart/form-data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file was attached." }, { status: 400 });
  }

  const maxBytes = Number(process.env.MAX_UPLOAD_MB ?? 200) * 1024 * 1024;
  if (file.size > maxBytes) {
    return Response.json({ error: `That file is too large. The limit is ${Math.round(maxBytes / (1024 * 1024))} MB.` }, { status: 413 });
  }
  if (file.size === 0) {
    return Response.json({ error: "That file is empty." }, { status: 400 });
  }

  const sanitizedName = sanitizeFilename(file.name || "upload");
  const extension = sanitizedName.split(".").pop()?.toLowerCase() ?? "";
  const candidate = ALLOWLIST.find((a) => a.extensions.includes(extension));
  if (!candidate) {
    return Response.json(
      { error: `That file type isn't allowed. Supported types: ${ALLOWED_EXTENSION_LIST}.` },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!candidate.sniff(buffer)) {
    return Response.json(
      { error: "The file's contents don't match its extension, so it was rejected for safety." },
      { status: 400 },
    );
  }

  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const duplicate = await findDuplicateBySha256(hash);
  if (duplicate) {
    return Response.json(
      {
        id: duplicate.id,
        filename: duplicate.filename,
        mimeType: duplicate.mimeType,
        sizeBytes: duplicate.sizeBytes,
        kind: duplicate.kind,
        duplicate: true,
      },
      { status: 200 },
    );
  }

  // SCORM packages get their own extraction pipeline, gated by the feature flag.
  if (extension === "zip" && (await sniffIsScormZip(buffer))) {
    const settings = await getSettings();
    if (settings.features.scormPlayer) {
      try {
        const asset = await ingestScormPackage(actor, { filename: sanitizedName, buffer, sha256: hash });
        await recordAudit({
          actorId: actor.id,
          actorEmail: actor.email,
          action: "media.uploaded",
          entityType: "MEDIA",
          entityId: asset.id,
          metadata: { filename: sanitizedName, kind: "SCORM_PACKAGE" },
        });
        return Response.json(
          { id: asset.id, filename: asset.filename, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, kind: asset.kind, duplicate: false, scorm: true },
          { status: 201 },
        );
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : "Could not extract that SCORM package." },
          { status: 400 },
        );
      }
    }
    // Feature disabled: fall through and store it as a plain zip document.
  }

  const storage = getStorage();
  const storageKey = buildStorageKey("media", sanitizedName);
  const stored = await storage.put(storageKey, buffer, candidate.mimeType);

  const asset = await prisma.mediaAsset.create({
    data: {
      kind: candidate.kind,
      filename: sanitizedName,
      mimeType: candidate.mimeType,
      sizeBytes: stored.sizeBytes,
      storagePath: stored.storagePath,
      sha256: hash,
      ownerId: actor.id,
      processingStatus: candidate.kind === "VIDEO" ? "PROCESSING" : "READY",
    },
  });

  if (candidate.kind === "VIDEO") {
    await enqueueJob(JOB_TYPES.TRANSCRIBE_MEDIA, { mediaId: asset.id });
  }

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "media.uploaded",
    entityType: "MEDIA",
    entityId: asset.id,
    metadata: { filename: sanitizedName, kind: candidate.kind, sizeBytes: asset.sizeBytes },
  });

  return Response.json(
    { id: asset.id, filename: asset.filename, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, kind: asset.kind, duplicate: false },
    { status: 201 },
  );
}
