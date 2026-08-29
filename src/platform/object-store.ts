/**
 * Object storage (ADR-0026).
 *
 * Binaries never go in PostgreSQL. Two implementations behind one narrow interface:
 * a filesystem store for local development and tests, and an S3-compatible store for
 * real environments. The interface is deliberately the intersection of what every
 * S3-compatible provider supports, so switching providers is configuration.
 *
 * Keys are content-addressed. Identical content is stored once, which is the same
 * property that makes re-ingesting a Prophet 21 export idempotent.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

export interface ObjectMetadata {
  readonly key: string;
  readonly size: number;
  readonly sha256: string;
  readonly contentType: string | undefined;
  readonly storedAt: Date;
}

export interface PutOptions {
  readonly contentType?: string;
  /** Refuse to overwrite existing content. Content-addressed keys make this cheap. */
  readonly ifAbsent?: boolean;
}

export interface ObjectStore {
  put(key: string, body: Buffer, options?: PutOptions): Promise<ObjectMetadata>;
  get(key: string): Promise<Buffer>;
  head(key: string): Promise<ObjectMetadata | undefined>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<readonly string[]>;
}

export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`No stored object with key '${key}'`);
    this.name = 'ObjectNotFoundError';
  }
}

export function sha256Of(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Content-addressed key. The two-character shard keeps directory listings usable in
 * the filesystem store and spreads keys in object storage.
 */
export function contentKey(kind: string, sha256: string, extension = ''): string {
  return `${kind}/${sha256.slice(0, 2)}/${sha256}${extension}`;
}

/** Local filesystem store. Development and tests only; never a production backend. */
export class FilesystemObjectStore implements ObjectStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #pathFor(key: string): string {
    if (key.includes('..')) throw new Error(`Unsafe object key '${key}'`);
    return join(this.#root, ...key.split('/'));
  }

  async put(
    key: string,
    body: Buffer,
    options: PutOptions = {},
  ): Promise<ObjectMetadata> {
    const path = this.#pathFor(key);
    if (options.ifAbsent === true) {
      const existing = await this.head(key);
      if (existing !== undefined) return existing;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    if (options.contentType !== undefined) {
      await writeFile(`${path}.contenttype`, options.contentType, 'utf8');
    }
    return {
      key,
      size: body.byteLength,
      sha256: sha256Of(body),
      contentType: options.contentType,
      storedAt: new Date(),
    };
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.#pathFor(key));
    } catch {
      throw new ObjectNotFoundError(key);
    }
  }

  async head(key: string): Promise<ObjectMetadata | undefined> {
    const path = this.#pathFor(key);
    try {
      const info = await stat(path);
      let contentType: string | undefined;
      try {
        contentType = await readFile(`${path}.contenttype`, 'utf8');
      } catch {
        contentType = undefined;
      }
      return {
        key,
        size: info.size,
        // The key already carries the hash; recomputing would mean reading the file.
        sha256: key.split('/').pop()?.split('.')[0] ?? '',
        contentType,
        storedAt: info.mtime,
      };
    } catch {
      return undefined;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.#pathFor(key));
    } catch {
      // Deleting something that is not there is the desired end state.
    }
  }

  async list(prefix: string): Promise<readonly string[]> {
    const base = this.#pathFor(prefix);
    const found: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (!entry.name.endsWith('.contenttype')) {
          found.push(relative(this.#root, full).split(sep).join('/'));
        }
      }
    };
    await walk(base);
    return found.sort();
  }
}
