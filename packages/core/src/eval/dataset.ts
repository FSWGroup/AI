import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "../db/client.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const GOLDEN_DIR = join(here, "..", "..", "..", "..", "eval", "golden");

export interface GoldenCase {
  id: string;
  category: string;
  agent: string;
  criticality: number;
  input: Record<string, unknown>;
  expected: {
    outcome?: "answered" | "partial" | "abstained" | "escalated";
    /** claims that must be present and verified; each is checked by subjectRef+predicate and value equality */
    claims?: { subject: string; predicate: string; value: string; severity?: 1 | 2 }[];
    /** claims that must NOT appear as verified (e.g. conflicting or stale values, false substitutes) */
    forbiddenClaims?: { subject: string; predicate: string; value?: string }[];
    /** agent payload expectations */
    data?: Record<string, unknown>;
    maxClaims?: number;
  };
  isRegression?: boolean;
  origin?: string;
  notes?: string;
}

export function readGoldenFiles(): { version: string; cases: GoldenCase[] } {
  const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".json")).sort();
  const cases: GoldenCase[] = [];
  let version = "0";
  for (const f of files) {
    const doc = JSON.parse(readFileSync(join(GOLDEN_DIR, f), "utf8")) as { version: string; cases: GoldenCase[] };
    version = doc.version > version ? doc.version : version;
    cases.push(...doc.cases.map((c) => ({ ...c, origin: c.origin ?? f })));
  }
  const ids = new Set<string>();
  for (const c of cases) { if (ids.has(c.id)) throw new Error(`Duplicate golden case id ${c.id}`); ids.add(c.id); }
  return { version, cases };
}

export async function loadGoldenDataset(sql: Sql): Promise<number> {
  const { version, cases } = readGoldenFiles();
  for (const c of cases) {
    await sql`INSERT INTO evaluation_cases (id, category, agent, criticality, input, expected, is_regression, origin, dataset_version)
      VALUES (${c.id}, ${c.category}, ${c.agent}, ${c.criticality}, ${sql.json(c.input as never)}, ${sql.json(c.expected as never)}, ${c.isRegression ?? false}, ${c.origin ?? null}, ${version})
      ON CONFLICT (id) DO UPDATE SET category = EXCLUDED.category, agent = EXCLUDED.agent, criticality = EXCLUDED.criticality, input = EXCLUDED.input, expected = EXCLUDED.expected, is_regression = EXCLUDED.is_regression, origin = EXCLUDED.origin, dataset_version = EXCLUDED.dataset_version`;
  }
  return cases.length;
}
