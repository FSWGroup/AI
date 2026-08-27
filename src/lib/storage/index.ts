/**
 * Object storage abstraction for webcam recording chunks.
 *
 * Recordings are NEVER stored in the database and NEVER public. Chunks are
 * uploaded directly from the candidate's browser to storage using short-lived
 * signed upload URLs (never routed through serverless API bodies when a
 * direct upload is possible), and played back only through short-lived
 * signed URLs after an RBAC + audit check.
 *
 * Providers:
 *  - LocalDiskStorage: development only. Stores under .storage/ and "signs"
 *    upload/download URLs with an HMAC token verified by our own routes.
 *  - S3Storage: any S3-compatible store (AWS S3, Cloudflare R2, MinIO)
 *    using presigned PUT/GET URLs.
 *  - NetlifyBlobsStorage: zero-config private storage on Netlify; small
 *    chunks route through the signed app endpoints (see netlify-blobs.ts).
 */

import { env } from "@/lib/env";
import { LocalDiskStorage } from "./local";
import { S3Storage } from "./s3";

export interface StorageProvider {
  readonly kind: "local" | "s3" | "netlify";
  /** True when uploads/downloads flow through the app's signed routes. */
  readonly appRouted: boolean;
  /** Short-lived signed URL the browser can PUT a chunk to. */
  getUploadUrl(objectKey: string, contentType: string): Promise<string>;
  /** Short-lived signed URL for streaming/downloading an object. */
  getDownloadUrl(objectKey: string, ttlSeconds?: number): Promise<string>;
  /** Server-side read (used for report PDFs and chunk assembly). */
  getObject(objectKey: string): Promise<Buffer | null>;
  /** Server-side write (used for generated PDFs). */
  putObject(objectKey: string, body: Buffer, contentType: string): Promise<void>;
  deleteObject(objectKey: string): Promise<void>;
  deletePrefix(prefix: string): Promise<number>;
  objectExists(objectKey: string): Promise<boolean>;
}

let provider: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!provider) {
    if (env.storageProvider === "s3") {
      provider = new S3Storage();
    } else if (env.storageProvider === "netlify") {
      // Lazy require keeps @netlify/blobs out of non-Netlify bundles' hot path.
      const { NetlifyBlobsStorage } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("./netlify-blobs") as typeof import("./netlify-blobs");
      provider = new NetlifyBlobsStorage();
    } else {
      provider = new LocalDiskStorage();
    }
  }
  return provider;
}

/** Object key layout for recordings. */
export function recordingChunkKey(
  attemptId: string,
  recordingSessionId: string,
  sequence: number,
): string {
  return `assessment-recordings/${attemptId}/${recordingSessionId}/${String(
    sequence,
  ).padStart(6, "0")}.webm`;
}

export function reportPdfKey(attemptId: string, reportId: string): string {
  return `reports/${attemptId}/${reportId}.pdf`;
}
