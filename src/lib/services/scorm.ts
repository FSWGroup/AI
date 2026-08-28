import "server-only";
import zlib from "node:zlib";
import { prisma } from "@/lib/db";
import { getStorage, sanitizeFilename } from "@/lib/storage";
import type { Actor } from "@/lib/auth/guard";
import { Prisma } from "@prisma/client";

/**
 * SCORM 1.2 / 2004 packages, treated as UNTRUSTED content end to end.
 *
 * Honest scope and limitations (documented here rather than claimed away):
 *  - Only SCORM 1.2 and SCORM 2004 are supported. xAPI, cmi5, and AICC are
 *    NOT implemented — there is no adapter for them, by design.
 *  - The manifest parser resolves the default organization's first <item> to
 *    a single launch resource. Multi-SCO courses with sequencing rules,
 *    <adlseq:*> conditions, and shared SCOs are not modeled — the first SCO
 *    found is treated as "the course."
 *  - The runtime CMI data model implemented by the injected API shim is a
 *    minimal key/value store (get/set/commit/terminate over whatever keys the
 *    content reads and writes). It does not validate data types, does not
 *    implement interactions/objectives arrays, and does not enforce SCORM's
 *    read-only/write-only field rules. This is enough to capture completion
 *    status and score for reporting; it is not a conformant RTE.
 *  - Isolation model: the package's HTML/JS is served through a *sandboxed*
 *    iframe (`sandbox="allow-scripts"`, deliberately without
 *    `allow-same-origin`), so the content executes with an opaque origin and
 *    cannot read cookies, call our authenticated API, or navigate the parent.
 *    The SCORM API object is injected into that SAME document (not the
 *    parent's), because a truly cross-origin `window.parent.API` reference
 *    would be blocked by the same isolation that makes the sandbox safe.
 *    The shim then relays commits to the parent via `postMessage`, which is
 *    the one channel that works across an opaque-origin boundary by design.
 *    The parent wrapper (src/app/(app)/media/[id]/page.tsx) is the only piece
 *    that talks to our backend, via POST /api/media/scorm/progress. Gate this
 *    entire feature behind the `scormPlayer` feature flag.
 */

// ---------------------------------------------------------------------------
// Minimal ZIP reader (mirrors the writer in src/lib/export.ts)
// ---------------------------------------------------------------------------

interface ZipCentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function readZipEntries(buffer: Buffer): ZipCentralEntry[] {
  const maxCommentSize = 65557;
  const searchStart = Math.max(0, buffer.length - maxCommentSize);
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= searchStart; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("Not a valid ZIP archive: no end-of-central-directory record found.");

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  const entries: ZipCentralEntry[] = [];
  let offset = centralDirOffset;
  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Corrupt ZIP central directory.");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLen);
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractEntryData(buffer: Buffer, entry: ZipCentralEntry): Buffer {
  const offset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error(`Corrupt local file header for ${entry.name}`);
  const nameLen = buffer.readUInt16LE(offset + 26);
  const extraLen = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLen + extraLen;
  const raw = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`Unsupported ZIP compression method (${entry.method}) for ${entry.name}.`);
}

function isSafeZipEntryName(name: string): boolean {
  if (!name || name.endsWith("/")) return false;
  if (name.startsWith("/") || name.startsWith("\\")) return false;
  if (/^[a-zA-Z]:/.test(name)) return false;
  if (name.split(/[\\/]/).some((seg) => seg === "..")) return false;
  return true;
}

export async function sniffIsScormZip(buffer: Buffer): Promise<boolean> {
  const names = listZipEntryNames(buffer);
  return names.some((n) => n.toLowerCase() === "imsmanifest.xml");
}

/** Lists entry names in a ZIP without decompressing anything — used to verify
 * a file really is a ZIP, and (for OOXML) that it contains the expected
 * marker part, before trusting its extension. Returns [] for anything that
 * doesn't parse as a ZIP central directory. */
export function listZipEntryNames(buffer: Buffer): string[] {
  try {
    return readZipEntries(buffer).map((e) => e.name);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// imsmanifest.xml parsing (deliberately minimal — see module doc comment)
// ---------------------------------------------------------------------------

export interface ScormManifest {
  version: "1.2" | "2004";
  identifier: string;
  title: string | null;
  launchHref: string;
}

function extractAttr(tag: string, attr: string): string | null {
  const doubleQuoted = tag.match(new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, "i"));
  if (doubleQuoted) return doubleQuoted[1] ?? null;
  const singleQuoted = tag.match(new RegExp(`${attr}\\s*=\\s*'([^']*)'`, "i"));
  return singleQuoted ? (singleQuoted[1] ?? null) : null;
}

export function parseScormManifest(xml: string): ScormManifest {
  const schemaVersionMatch = xml.match(/<schemaversion[^>]*>([\s\S]*?)<\/schemaversion>/i);
  const version: "1.2" | "2004" = /2004/.test(schemaVersionMatch?.[1] ?? "") || /2004/.test(xml.slice(0, 3000)) ? "2004" : "1.2";

  const manifestTagMatch = xml.match(/<manifest\b[^>]*>/i);
  const identifier = (manifestTagMatch && extractAttr(manifestTagMatch[0], "identifier")) || "unknown";

  const resourceMap = new Map<string, string>();
  const resourceRegex = /<resource\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = resourceRegex.exec(xml))) {
    const tag = match[0];
    const id = extractAttr(tag, "identifier");
    const href = extractAttr(tag, "href");
    if (id && href) resourceMap.set(id, href);
  }
  if (resourceMap.size === 0) throw new Error("imsmanifest.xml has no <resource> element with an href.");

  let launchResourceId: string | null = null;
  const orgsMatch = xml.match(/<organizations\b[^>]*>([\s\S]*?)<\/organizations>/i);
  if (orgsMatch?.[1]) {
    const itemMatch =
      orgsMatch[1].match(/<item\b[^>]*identifierref\s*=\s*"([^"]+)"[^>]*>/i) ??
      orgsMatch[1].match(/<item\b[^>]*identifierref\s*=\s*'([^']+)'[^>]*>/i);
    launchResourceId = itemMatch?.[1] ?? null;
  }

  const href = (launchResourceId && resourceMap.get(launchResourceId)) || [...resourceMap.values()][0];
  if (!href) throw new Error("Could not resolve a launch file from imsmanifest.xml.");

  const titleMatch = orgsMatch?.[1]?.match(/<title>([\s\S]*?)<\/title>/i);

  return {
    version,
    identifier,
    title: titleMatch?.[1]?.trim() || null,
    launchHref: href.replace(/\\/g, "/"),
  };
}

// ---------------------------------------------------------------------------
// Extraction to storage
// ---------------------------------------------------------------------------

const MAX_SCORM_FILES = 4000;
const MAX_SCORM_TOTAL_BYTES = 500 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
  xml: "application/xml",
  txt: "text/plain; charset=utf-8",
  pdf: "application/pdf",
};

export function guessMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

interface ExtractedScormPackage {
  manifest: ScormManifest;
  storagePrefix: string;
  fileCount: number;
  totalBytes: number;
}

async function extractScormPackage(zipBuffer: Buffer, packageId: string): Promise<ExtractedScormPackage> {
  const entries = readZipEntries(zipBuffer).filter((e) => isSafeZipEntryName(e.name));
  if (entries.length === 0) throw new Error("The ZIP archive contains no usable files.");
  if (entries.length > MAX_SCORM_FILES) throw new Error(`SCORM package exceeds the ${MAX_SCORM_FILES}-file limit.`);

  const manifestEntry = entries.find((e) => e.name.toLowerCase() === "imsmanifest.xml");
  if (!manifestEntry) throw new Error("This ZIP does not contain a top-level imsmanifest.xml — it is not a SCORM package.");

  const manifestXml = extractEntryData(zipBuffer, manifestEntry).toString("utf8");
  const manifest = parseScormManifest(manifestXml);

  const storage = getStorage();
  const storagePrefix = `scorm/${packageId}`;
  let totalBytes = 0;

  for (const entry of entries) {
    const data = extractEntryData(zipBuffer, entry);
    totalBytes += data.length;
    if (totalBytes > MAX_SCORM_TOTAL_BYTES) throw new Error("SCORM package exceeds the extraction size limit.");
    const safeRelative = entry.name
      .split("/")
      .map((seg) => sanitizeFilename(seg))
      .join("/");
    await storage.put(`${storagePrefix}/${safeRelative}`, data, guessMimeType(safeRelative));
  }

  return { manifest, storagePrefix, fileCount: entries.length, totalBytes };
}

/** SCORM package metadata, stashed in MediaAsset.chapters (see src/lib/services/media.ts ScormPackageMarker). */
interface ScormMarker {
  scorm: { version: "1.2" | "2004"; launchPath: string; identifier: string; title: string | null };
}

/**
 * Extracts an uploaded ZIP as a SCORM package and records it as a MediaAsset
 * (kind DOCUMENT). Called from the media upload route once it has sniffed a
 * top-level imsmanifest.xml. `processingStatus` tracks extraction: PROCESSING
 * while extracting, READY on success, FAILED (never left stuck) on error.
 */
export async function ingestScormPackage(
  actor: Actor,
  params: { filename: string; buffer: Buffer; sha256: string },
) {
  const placeholder = await prisma.mediaAsset.create({
    data: {
      kind: "DOCUMENT",
      filename: sanitizeFilename(params.filename),
      mimeType: "application/zip",
      sizeBytes: params.buffer.length,
      storagePath: "",
      sha256: params.sha256,
      ownerId: actor.id,
      processingStatus: "PROCESSING",
    },
  });

  try {
    const extracted = await extractScormPackage(params.buffer, placeholder.id);
    const marker: ScormMarker = {
      scorm: {
        version: extracted.manifest.version,
        launchPath: extracted.manifest.launchHref,
        identifier: extracted.manifest.identifier,
        title: extracted.manifest.title,
      },
    };
    return await prisma.mediaAsset.update({
      where: { id: placeholder.id },
      data: {
        storagePath: extracted.storagePrefix,
        title: extracted.manifest.title ?? params.filename,
        processingStatus: "READY",
        chapters: marker as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    await prisma.mediaAsset.update({ where: { id: placeholder.id }, data: { processingStatus: "FAILED" } });
    throw error;
  }
}

export interface ScormLaunchInfo {
  storagePrefix: string;
  launchPath: string;
  version: "1.2" | "2004";
  title: string | null;
}

/** Reads back the launch info stashed at ingest time. Null when the asset isn't a SCORM package. */
export function getScormLaunchInfo(asset: { storagePath: string; chapters: unknown }): ScormLaunchInfo | null {
  const marker = asset.chapters as ScormMarker | null;
  if (!marker || typeof marker !== "object" || !("scorm" in marker)) return null;
  return {
    storagePrefix: asset.storagePath,
    launchPath: marker.scorm.launchPath,
    version: marker.scorm.version,
    title: marker.scorm.title,
  };
}

/** Reads one extracted file back out of storage for the sandboxed serving route. */
export async function readScormFile(
  storagePrefix: string,
  relativePath: string,
): Promise<{ data: Buffer; mimeType: string } | null> {
  if (relativePath.split("/").some((seg) => seg === "..")) return null;
  const safeRelative = relativePath
    .split("/")
    .map((seg) => sanitizeFilename(seg))
    .join("/");
  const fullPath = `${storagePrefix}/${safeRelative}`;
  const storage = getStorage();
  if (!(await storage.exists(fullPath))) return null;
  const data = await storage.get(fullPath);
  return { data, mimeType: guessMimeType(safeRelative) };
}

// ---------------------------------------------------------------------------
// In-content API shim (SCORM 1.2 + 2004 runtime, minimal data model)
// ---------------------------------------------------------------------------

/**
 * A small script injected into the served launch HTML that defines
 * `window.API` (SCORM 1.2) and `window.API_1484_11` (SCORM 2004) *inside the
 * sandboxed document itself* — not on the parent — because that is the only
 * place the content's own "find the API" search can reach without breaking
 * sandbox isolation. Commits and terminations are relayed to the parent
 * wrapper via postMessage, targeted at a specific origin known server-side.
 */
export function buildScormApiShimScript(opts: { mediaId: string; parentOrigin: string; nonce: string }): string {
  const config = JSON.stringify({ mediaId: opts.mediaId, parentOrigin: opts.parentOrigin, nonce: opts.nonce });
  return `<script>(function(){
var CFG = ${config};
var STATE = { data: {}, lastError: "0" };
function post(type, extra) {
  try {
    var msg = { source: "fsw-scorm", nonce: CFG.nonce, mediaId: CFG.mediaId, type: type };
    for (var k in (extra || {})) { msg[k] = extra[k]; }
    window.parent.postMessage(msg, CFG.parentOrigin);
  } catch (e) {}
}
function commit() { post("commit", { cmi: STATE.data }); }
var api12 = {
  LMSInitialize: function () { post("initialize", {}); return "true"; },
  LMSFinish: function () { commit(); post("terminate", { cmi: STATE.data }); return "true"; },
  LMSGetValue: function (name) { return STATE.data[name] !== undefined ? String(STATE.data[name]) : ""; },
  LMSSetValue: function (name, value) { STATE.data[name] = value; return "true"; },
  LMSCommit: function () { commit(); return "true"; },
  LMSGetLastError: function () { return STATE.lastError; },
  LMSGetErrorString: function () { return "No error"; },
  LMSGetDiagnostic: function () { return ""; }
};
var api2004 = {
  Initialize: function () { post("initialize", {}); return "true"; },
  Terminate: function () { commit(); post("terminate", { cmi: STATE.data }); return "true"; },
  GetValue: function (name) { return STATE.data[name] !== undefined ? String(STATE.data[name]) : ""; },
  SetValue: function (name, value) { STATE.data[name] = value; return "true"; },
  Commit: function () { commit(); return "true"; },
  GetLastError: function () { return STATE.lastError; },
  GetErrorString: function () { return "No error"; },
  GetDiagnostic: function () { return ""; }
};
window.API = api12;
window.API_1484_11 = api2004;
post("ready", {});
})();</script>`;
}

/** Inserts the shim right after <head> (or <html> as a fallback) so it runs before the package's own scripts. */
export function injectScormShim(html: string, shimScript: string): string {
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch?.index !== undefined) {
    const at = headMatch.index + headMatch[0].length;
    return html.slice(0, at) + shimScript + html.slice(at);
  }
  const htmlMatch = html.match(/<html[^>]*>/i);
  if (htmlMatch?.index !== undefined) {
    const at = htmlMatch.index + htmlMatch[0].length;
    return html.slice(0, at) + shimScript + html.slice(at);
  }
  return shimScript + html;
}

// ---------------------------------------------------------------------------
// Progress bridging: postMessage payload -> LessonProgress
// ---------------------------------------------------------------------------

export interface ScormCommitPayload {
  cmi?: Record<string, unknown>;
}

function readCmi(cmi: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!cmi) return undefined;
  for (const key of keys) {
    const value = cmi[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

async function findLessonsForMediaPackage(mediaId: string): Promise<{ id: string; courseId: string }[]> {
  const lessons = await prisma.lesson.findMany({
    where: { content: { not: Prisma.JsonNull } },
    select: { id: true, content: true, section: { select: { courseId: true } } },
  });
  return lessons
    .filter((l) => JSON.stringify(l.content).includes(mediaId))
    .map((l) => ({ id: l.id, courseId: l.section.courseId }));
}

/**
 * Applies one SCORM commit/terminate payload to every lesson that embeds this
 * package, upserting LessonProgress. Course-level completion evaluation
 * (CompletionRecord issuance, certificates) is the shared training-completion
 * pipeline's job once it observes LessonProgress flip to COMPLETED — this
 * function does not create CompletionRecord rows itself.
 */
export async function recordScormProgress(
  actor: Actor,
  mediaId: string,
  payload: ScormCommitPayload,
): Promise<{ updated: number; status: "COMPLETED" | "IN_PROGRESS" }> {
  const lessons = await findLessonsForMediaPackage(mediaId);
  const lessonStatus = readCmi(payload.cmi, "cmi.core.lesson_status");
  const completionStatus = readCmi(payload.cmi, "cmi.completion_status");
  const successStatus = readCmi(payload.cmi, "cmi.success_status");

  const isComplete =
    lessonStatus === "completed" ||
    lessonStatus === "passed" ||
    completionStatus === "completed" ||
    successStatus === "passed";
  const status = isComplete ? "COMPLETED" : "IN_PROGRESS";
  const now = new Date();

  for (const lesson of lessons) {
    await prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId: actor.id, lessonId: lesson.id } },
      create: {
        userId: actor.id,
        lessonId: lesson.id,
        courseId: lesson.courseId,
        status,
        startedAt: now,
        completedAt: isComplete ? now : null,
        checklistState: { scorm: payload.cmi ?? {} } as unknown as Prisma.InputJsonValue,
      },
      update: {
        status,
        completedAt: isComplete ? now : undefined,
        checklistState: { scorm: payload.cmi ?? {} } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  return { updated: lessons.length, status };
}
