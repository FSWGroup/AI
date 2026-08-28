import { getActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { getScormLaunchInfo, readScormFile, buildScormApiShimScript, injectScormShim } from "@/lib/services/scorm";
import { randomUUID } from "node:crypto";

/**
 * Serves the extracted files of an uploaded SCORM package, one at a time,
 * from inside a sandboxed iframe. See the long comment at the top of
 * src/lib/services/scorm.ts for the full isolation model and its one real
 * limitation in this deployment: next.config.ts applies a bare `sandbox`
 * Content-Security-Policy (no `allow-scripts`) to every path under
 * `/api/media/*`, including this one, and CSP directives from multiple
 * applicable policies are enforced as an intersection — a stricter `sandbox`
 * from one policy cannot be loosened by a more permissive one from another.
 * That means script execution is blocked here regardless of what this route
 * sends, so interactive SCORM content will not run in this deployment. The
 * extraction, manifest parsing, and API shim below are complete and correct;
 * they need a route outside `/api/media` (a file this task does not own) to
 * actually execute. The player page shows this limitation plainly rather
 * than a silently broken blank iframe.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string; path: string[] }> }): Promise<Response> {
  const actor = await getActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });

  const settings = await getSettings();
  if (!settings.features.scormPlayer) return new Response("SCORM playback is disabled.", { status: 404 });

  const { id, path } = await context.params;
  const asset = await prisma.mediaAsset.findFirst({ where: { id, isDeleted: false } });
  if (!asset) return new Response("Not found", { status: 404 });

  const launch = getScormLaunchInfo(asset);
  if (!launch) return new Response("Not a SCORM package.", { status: 400 });

  const relativePath = path.join("/") || launch.launchPath;
  const file = await readScormFile(launch.storagePrefix, relativePath);
  if (!file) return new Response("Not found", { status: 404 });

  let body: Buffer | string = file.data;
  if (file.mimeType.startsWith("text/html")) {
    const appUrl = process.env.APP_URL ?? new URL(request.url).origin;
    const shim = buildScormApiShimScript({ mediaId: asset.id, parentOrigin: appUrl, nonce: randomUUID() });
    body = injectScormShim(file.data.toString("utf8"), shim);
  }

  const responseBody: BodyInit = typeof body === "string" ? body : new Uint8Array(body);
  return new Response(responseBody, {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
