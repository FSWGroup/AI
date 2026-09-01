import 'server-only';
import { mkdir, readFile, writeFile, unlink } from 'fs/promises';
import { createHash, randomBytes } from 'crypto';
import path from 'path';
import { env } from '@/lib/env';
import { GraphDriver } from '@/lib/storage-graph';

/**
 * Private document storage behind a driver interface.
 *
 *  - local: files under STORAGE_LOCAL_DIR (dev / single node). Never inside
 *    /public — nothing is ever served directly.
 *  - graph: SharePoint via Microsoft Graph, against an app-owned site with no
 *    human members. Preferred where the tenant is already Microsoft 365 —
 *    Purview retention, DLP and eDiscovery come for free.
 *  - s3: S3-compatible object storage (adapter stub wired to env; production
 *    deployments provide credentials).
 *
 * All downloads flow through the authenticated /api/documents/... route with
 * a short-lived HMAC token (see crypto.signDownload). There are no public
 * object URLs anywhere in the system.
 */

export interface StorageDriver {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class LocalDriver implements StorageDriver {
  private root = path.resolve(env.STORAGE_LOCAL_DIR);

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await unlink(this.resolve(key)).catch(() => {});
  }
}

class S3Driver implements StorageDriver {
  constructor() {
    if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
      throw new Error(
        'STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY. See .env.example.',
      );
    }
  }
  // Production deployments plug in @aws-sdk/client-s3 here; the interface is
  // intentionally identical to LocalDriver so nothing else changes.
  async put(): Promise<void> {
    throw new Error('S3 storage adapter requires @aws-sdk/client-s3 — see DEPLOYMENT.md.');
  }
  async get(): Promise<Buffer> {
    throw new Error('S3 storage adapter requires @aws-sdk/client-s3 — see DEPLOYMENT.md.');
  }
  async delete(): Promise<void> {
    throw new Error('S3 storage adapter requires @aws-sdk/client-s3 — see DEPLOYMENT.md.');
  }
}

let driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  if (!driver) {
    switch (env.STORAGE_DRIVER) {
      case 'graph':
        driver = new GraphDriver();
        break;
      case 's3':
        driver = new S3Driver();
        break;
      default:
        driver = new LocalDriver();
    }
  }
  return driver;
}

/** Test seam: drop the memoised driver. */
export function resetStorageDriver(): void {
  driver = null;
}

export function newFileKey(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase().slice(0, 12);
  const now = new Date();
  return `documents/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${randomBytes(16).toString('hex')}${ext}`;
}

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

// File-type allowlist for uploads (validated by extension AND magic bytes for
// the common binary types).
const ALLOWED_MIME: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'text/csv': ['.csv'],
  'text/plain': ['.txt'],
};

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export function validateUpload(fileName: string, mimeType: string, data: Buffer): { ok: true } | { ok: false; error: string } {
  if (data.length === 0) return { ok: false, error: 'The file is empty.' };
  if (data.length > MAX_UPLOAD_BYTES) return { ok: false, error: 'Files must be 15 MB or smaller.' };
  const ext = path.extname(fileName).toLowerCase();
  const allowedExts = ALLOWED_MIME[mimeType];
  if (!allowedExts || !allowedExts.includes(ext)) {
    return { ok: false, error: 'Allowed file types: PDF, PNG, JPG, DOC(X), XLS(X), CSV, TXT.' };
  }
  // Magic byte checks for binary formats
  if (mimeType === 'application/pdf' && !data.subarray(0, 5).toString('latin1').startsWith('%PDF')) {
    return { ok: false, error: 'That file does not look like a valid PDF.' };
  }
  if (mimeType === 'image/png' && data.readUInt32BE(0) !== 0x89504e47) {
    return { ok: false, error: 'That file does not look like a valid PNG.' };
  }
  if (mimeType === 'image/jpeg' && data.readUInt16BE(0) !== 0xffd8) {
    return { ok: false, error: 'That file does not look like a valid JPEG.' };
  }
  return { ok: true };
}
