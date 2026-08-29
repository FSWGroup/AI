/** Apply the repository's real metadata configuration to a test database. */
import { join } from 'node:path';
import { readMetadata, applyMetadata } from '../../src/modules/pim/index.js';
import type { Database } from '../../src/platform/db/index.js';
import type { ParsedMetadata } from '../../src/modules/pim/index.js';

export const METADATA_DIR = join(import.meta.dirname, '..', '..', 'config', 'metadata');

let cached: Promise<ParsedMetadata> | undefined;

/** Parse once per process; the files do not change during a run. */
export function realMetadata(): Promise<ParsedMetadata> {
  cached ??= readMetadata(METADATA_DIR);
  return cached;
}

export async function applyRealMetadata(db: Database): Promise<void> {
  await applyMetadata(db, await realMetadata(), { actor: 'test-harness' });
}
