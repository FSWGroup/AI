/**
 * Netlify Blobs storage provider (STORAGE_PROVIDER=netlify).
 *
 * Zero-configuration private object storage when the app runs on Netlify:
 * blobs are scoped to the site, never publicly addressable, and read/write
 * happens through the same HMAC-signed app routes the local provider uses
 * (Netlify Blobs has no browser-direct presigned uploads). Recording chunks
 * are ~0.5 MB each, well within function payload limits; for very large
 * deployments prefer STORAGE_PROVIDER=s3, which uploads straight from the
 * browser to the bucket.
 *
 * Outside the Netlify runtime, set NETLIFY_BLOBS_SITE_ID and
 * NETLIFY_BLOBS_TOKEN to reach the store explicitly.
 */

import { getStore, type Store } from "@netlify/blobs";
import { createSignedValue } from "@/lib/crypto";
import { env } from "@/lib/env";
import type { StorageProvider } from "./index";

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export class NetlifyBlobsStorage implements StorageProvider {
  readonly kind = "netlify" as const;
  readonly appRouted = true;

  private store(): Store {
    // Deliberately still "fsw-workfit" after the Talent Scout rename: this is
    // the name of a live blob store, and renaming it would orphan every
    // recording already written to a deployed site.
    const name = process.env.NETLIFY_BLOBS_STORE ?? "fsw-workfit";
    const siteID = process.env.NETLIFY_BLOBS_SITE_ID;
    const token = process.env.NETLIFY_BLOBS_TOKEN;
    if (siteID && token) {
      return getStore({ name, siteID, token, consistency: "strong" });
    }
    return getStore({ name, consistency: "strong" });
  }

  async getUploadUrl(objectKey: string, _contentType: string): Promise<string> {
    const token = createSignedValue(`upload:${objectKey}`, 15 * 60);
    return `${env.appBaseUrl}/api/storage/upload?token=${encodeURIComponent(token)}`;
  }

  async getDownloadUrl(objectKey: string, ttlSeconds = 300): Promise<string> {
    const token = createSignedValue(`download:${objectKey}`, ttlSeconds);
    return `${env.appBaseUrl}/api/storage/download?token=${encodeURIComponent(token)}`;
  }

  async getObject(objectKey: string): Promise<Buffer | null> {
    const data = await this.store().get(objectKey, { type: "arrayBuffer" });
    return data ? Buffer.from(data) : null;
  }

  async putObject(objectKey: string, body: Buffer): Promise<void> {
    await this.store().set(objectKey, toArrayBuffer(body));
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.store().delete(objectKey);
  }

  async deletePrefix(prefix: string): Promise<number> {
    const store = this.store();
    const { blobs } = await store.list({ prefix });
    for (const blob of blobs) {
      await store.delete(blob.key);
    }
    return blobs.length;
  }

  async objectExists(objectKey: string): Promise<boolean> {
    return (await this.store().getMetadata(objectKey)) !== null;
  }
}
