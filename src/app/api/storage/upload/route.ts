/**
 * Local-disk storage provider: signed upload endpoint (development).
 * The token is an expiring HMAC over "upload:<objectKey>" issued by
 * LocalDiskStorage.getUploadUrl. In production with STORAGE_PROVIDER=s3,
 * uploads go directly to the bucket and this route is unused.
 */

import { NextResponse } from "next/server";
import { verifySignedValue } from "@/lib/crypto";
import { getStorage } from "@/lib/storage";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";
const MAX_CHUNK_BYTES = 50 * 1024 * 1024;

export async function PUT(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const payload = token ? verifySignedValue(token) : null;
  if (!payload || !payload.startsWith("upload:")) {
    return apiError("Upload link is invalid or has expired.", 403);
  }
  const objectKey = payload.slice("upload:".length);

  const body = Buffer.from(await req.arrayBuffer());
  if (body.length === 0) return apiError("Empty upload.", 400);
  if (body.length > MAX_CHUNK_BYTES) return apiError("Chunk too large.", 413);

  const storage = getStorage();
  if (storage.kind !== "local") {
    return apiError("Direct uploads are not served by the application.", 400);
  }
  await storage.putObject(objectKey, body, req.headers.get("content-type") ?? "application/octet-stream");
  return NextResponse.json({ ok: true });
}
