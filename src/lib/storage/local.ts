/**
 * Development-only object storage on local disk under .storage/ (gitignored).
 * Upload/download URLs are app routes guarded by expiring HMAC tokens so the
 * browser-facing contract matches the S3 provider (PUT to a signed URL).
 */

import { mkdir, readFile, rm, stat, writeFile, readdir } from "fs/promises";
import path from "path";
import { createSignedValue } from "@/lib/crypto";
import { env } from "@/lib/env";
import type { StorageProvider } from "./index";

const ROOT = path.join(process.cwd(), ".storage");

function safeJoin(objectKey: string): string {
  const resolved = path.normalize(path.join(ROOT, objectKey));
  if (!resolved.startsWith(ROOT + path.sep)) {
    throw new Error("Invalid object key.");
  }
  return resolved;
}

export class LocalDiskStorage implements StorageProvider {
  readonly kind = "local" as const;
  readonly appRouted = true;

  async getUploadUrl(objectKey: string, _contentType: string): Promise<string> {
    const token = createSignedValue(`upload:${objectKey}`, 15 * 60);
    return `${env.appBaseUrl}/api/storage/upload?token=${encodeURIComponent(token)}`;
  }

  async getDownloadUrl(objectKey: string, ttlSeconds = 300): Promise<string> {
    const token = createSignedValue(`download:${objectKey}`, ttlSeconds);
    return `${env.appBaseUrl}/api/storage/download?token=${encodeURIComponent(token)}`;
  }

  async getObject(objectKey: string): Promise<Buffer | null> {
    try {
      return await readFile(safeJoin(objectKey));
    } catch {
      return null;
    }
  }

  async putObject(objectKey: string, body: Buffer): Promise<void> {
    const filePath = safeJoin(objectKey);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
  }

  async deleteObject(objectKey: string): Promise<void> {
    await rm(safeJoin(objectKey), { force: true });
  }

  async deletePrefix(prefix: string): Promise<number> {
    const dir = safeJoin(prefix);
    let count = 0;
    try {
      const walk = async (d: string): Promise<void> => {
        for (const entry of await readdir(d, { withFileTypes: true })) {
          const p = path.join(d, entry.name);
          if (entry.isDirectory()) await walk(p);
          else count++;
        }
      };
      await walk(dir);
      await rm(dir, { recursive: true, force: true });
    } catch {
      // Prefix may not exist; deleting nothing is fine.
    }
    return count;
  }

  async objectExists(objectKey: string): Promise<boolean> {
    try {
      await stat(safeJoin(objectKey));
      return true;
    } catch {
      return false;
    }
  }
}
