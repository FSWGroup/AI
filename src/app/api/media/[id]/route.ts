import { getActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getScormLaunchInfo } from "@/lib/services/scorm";

/**
 * Authorized media delivery. SECURITY CRITICAL.
 *
 * Every request must be authenticated (no anonymous access — this is an
 * internal training platform, not a public CDN). The media id is looked up
 * through Prisma and only the resulting `storagePath` value from the
 * database is ever passed to the storage layer — user input never becomes a
 * filesystem path. Supports HTTP Range for video/audio seeking. The sandbox
 * Content-Security-Policy for this whole route tree is already applied by
 * next.config.ts.
 *
 * Note on Range support: the storage abstraction (src/lib/storage/index.ts)
 * has no partial-read API for either driver, so a full read then in-memory
 * slice is used to satisfy Range requests — correct for the file sizes this
 * platform handles, though a production S3 deployment would ideally issue a
 * ranged GET to the object store directly.
 */

const INLINE_KINDS = new Set(["IMAGE", "VIDEO", "AUDIO"]);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const actor = await getActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });

  const { id } = await context.params;
  const asset = await prisma.mediaAsset.findFirst({ where: { id, isDeleted: false } });
  if (!asset) return new Response("Not found", { status: 404 });

  if (getScormLaunchInfo(asset)) {
    return Response.json(
      { error: "This media asset is a SCORM package. View it from its media detail page." },
      { status: 400 },
    );
  }

  const storage = getStorage();
  if (!(await storage.exists(asset.storagePath))) return new Response("Not found", { status: 404 });

  const data = await storage.get(asset.storagePath);
  const size = data.byteLength;

  const inline = INLINE_KINDS.has(asset.kind) || asset.mimeType === "application/pdf";
  const safeFilename = asset.filename.replace(/["\r\n]/g, "");
  const disposition = `${inline ? "inline" : "attachment"}; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(asset.filename)}`;

  const baseHeaders: Record<string, string> = {
    "Content-Type": asset.mimeType,
    "Content-Disposition": disposition,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };

  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match) {
      const startText = match[1];
      const endText = match[2];
      const start = startText ? parseInt(startText, 10) : 0;
      const end = endText ? parseInt(endText, 10) : size - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start < 0 || end >= size) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }

      const chunk = data.subarray(start, end + 1);
      return new Response(new Uint8Array(chunk), {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(chunk.byteLength),
        },
      });
    }
  }

  return new Response(new Uint8Array(data), {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(size) },
  });
}
