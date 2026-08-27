/**
 * Local-disk storage provider: signed download/streaming endpoint.
 * Tokens are expiring HMACs over "download:<objectKey>" issued only after
 * an RBAC + audit check (see the recording playback route).
 */

import { NextResponse } from "next/server";
import { verifySignedValue } from "@/lib/crypto";
import { getStorage } from "@/lib/storage";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const payload = token ? verifySignedValue(token) : null;
  if (!payload || !payload.startsWith("download:")) {
    return apiError("This link is invalid or has expired.", 403);
  }
  const objectKey = payload.slice("download:".length);
  const storage = getStorage();
  if (!storage.appRouted) {
    return apiError("Direct downloads are not served by the application.", 400);
  }
  const data = await storage.getObject(objectKey);
  if (!data) return apiError("Not found.", 404);

  const contentType = objectKey.endsWith(".webm")
    ? "video/webm"
    : objectKey.endsWith(".pdf")
      ? "application/pdf"
      : "application/octet-stream";
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(data.length),
      "Cache-Control": "private, no-store",
    },
  });
}
