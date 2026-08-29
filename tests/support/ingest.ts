/** Test doubles for ingestion (ADR-0029): no real files, no real object storage. */
import {
  sha256Of,
  ObjectNotFoundError,
  type ObjectMetadata,
  type ObjectStore,
  type PutOptions,
} from '../../src/platform/object-store.js';
import type { P21FileSystem } from '../../src/modules/ingest/connectors/prophet21.js';

/** An object store that keeps bytes in a Map. Records every put, so a test can assert
 * that the original was preserved before anything was interpreted. */
export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<
    string,
    { body: Buffer; contentType: string | undefined; storedAt: Date }
  >();
  readonly putKeys: string[] = [];

  async put(
    key: string,
    body: Buffer,
    options: PutOptions = {},
  ): Promise<ObjectMetadata> {
    this.putKeys.push(key);
    const existing = this.objects.get(key);
    if (existing !== undefined && options.ifAbsent === true)
      return this.#meta(key, existing);
    const entry = { body, contentType: options.contentType, storedAt: new Date() };
    this.objects.set(key, entry);
    return this.#meta(key, entry);
  }

  async get(key: string): Promise<Buffer> {
    const entry = this.objects.get(key);
    if (entry === undefined) throw new ObjectNotFoundError(key);
    return entry.body;
  }

  async head(key: string): Promise<ObjectMetadata | undefined> {
    const entry = this.objects.get(key);
    return entry === undefined ? undefined : this.#meta(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(prefix: string): Promise<readonly string[]> {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }

  #meta(
    key: string,
    entry: { body: Buffer; contentType: string | undefined; storedAt: Date },
  ): ObjectMetadata {
    return {
      key,
      size: entry.body.byteLength,
      sha256: sha256Of(entry.body),
      contentType: entry.contentType,
      storedAt: entry.storedAt,
    };
  }
}

/** A landing directory that exists only in memory. */
export class MemoryFileSystem implements P21FileSystem {
  readonly #files = new Map<string, { bytes: Buffer; modifiedAt: Date }>();

  /** `content` as a string is encoded windows-1252-compatible ASCII; pass a Buffer for
   * anything that is not. */
  set(
    path: string,
    content: string | Buffer,
    modifiedAt = new Date('2026-01-05T12:00:00Z'),
  ): void {
    const bytes = typeof content === 'string' ? Buffer.from(content, 'latin1') : content;
    this.#files.set(path, { bytes, modifiedAt });
  }

  remove(path: string): void {
    this.#files.delete(path);
  }

  async list(path: string): Promise<readonly string[]> {
    const prefix = `${path}/`;
    return [...this.#files.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .sort();
  }

  async read(path: string): Promise<Buffer> {
    const file = this.#files.get(path);
    if (file === undefined) throw new Error(`No such file: ${path}`);
    return file.bytes;
  }

  async modifiedAt(path: string): Promise<Date> {
    const file = this.#files.get(path);
    if (file === undefined) throw new Error(`No such file: ${path}`);
    return file.modifiedAt;
  }
}
