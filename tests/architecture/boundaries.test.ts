import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, dirname } from 'node:path';

const SRC = resolve(import.meta.dirname, '..', '..', 'src');

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(full)));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts'))
      files.push(full);
  }
  return files;
}

const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;

async function importsOf(file: string): Promise<string[]> {
  const source = await readFile(file, 'utf8');
  return [...source.matchAll(IMPORT_PATTERN)].map((m) => m[1]!);
}

/** The module a source file belongs to, or undefined for platform and kernel code. */
function moduleOf(file: string): string | undefined {
  const rel = relative(SRC, file);
  const match = /^modules[/\\]([^/\\]+)[/\\]/.exec(rel);
  return match?.[1];
}

describe('module boundaries (ADR-0003)', () => {
  it('lets a module be reached only through its index', async () => {
    const violations: string[] = [];

    for (const file of await sourceFiles(SRC)) {
      const owner = moduleOf(file);
      for (const specifier of await importsOf(file)) {
        if (!specifier.startsWith('.')) continue;

        const target = resolve(dirname(file), specifier);
        const targetModule = moduleOf(target);
        if (targetModule === undefined) continue; // platform or kernel: always allowed
        if (targetModule === owner) continue; // inside its own module

        const targetRel = relative(SRC, target).replace(/\\/g, '/');
        if (targetRel !== `modules/${targetModule}/index.js`) {
          violations.push(
            `${relative(SRC, file)} imports '${specifier}'. Import module ` +
              `'${targetModule}' only through modules/${targetModule}/index.js.`,
          );
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('keeps the platform free of domain knowledge', async () => {
    // The platform is runtime plumbing: database, HTTP, configuration, logging. If
    // it imports a domain module, the dependency is upside down.
    const violations: string[] = [];
    for (const file of await sourceFiles(join(SRC, 'platform'))) {
      for (const specifier of await importsOf(file)) {
        if (!specifier.startsWith('.')) continue;
        const target = resolve(dirname(file), specifier);
        if (moduleOf(target) !== undefined) {
          violations.push(
            `${relative(SRC, file)} imports the domain module '${specifier}'`,
          );
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('gives every module a published index', async () => {
    const modulesDir = join(SRC, 'modules');
    const entries = await readdir(modulesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const files = await readdir(join(modulesDir, entry.name));
      expect(files, `module '${entry.name}' has no index.ts`).toContain('index.ts');
    }
  });
});
