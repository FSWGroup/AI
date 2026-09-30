"use server";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { runEvaluation } from "@wpi/core";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

/** Locate eval/golden relative to the repo root (works from apps/web or the monorepo root). */
function goldenDir(): string | null {
  for (const c of [path.join(process.cwd(), "eval", "golden"), path.join(process.cwd(), "..", "..", "eval", "golden"), process.env.WPI_GOLDEN_DIR ?? ""]) if (c && existsSync(c)) return c;
  return null;
}

/** Upsert golden cases (same semantics as core's loadGoldenDataset, but path-resolved from the web process cwd). */
async function ensureGoldenLoaded(): Promise<number> {
  const dir = goldenDir();
  if (!dir) return 0;
  const sql = db();
  let n = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const doc = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { version: string; cases: { id: string; category: string; agent: string; criticality: number; input: unknown; expected: unknown; isRegression?: boolean; origin?: string }[] };
    for (const c of doc.cases) {
      await sql`INSERT INTO evaluation_cases (id, category, agent, criticality, input, expected, is_regression, origin, dataset_version)
        VALUES (${c.id}, ${c.category}, ${c.agent}, ${c.criticality}, ${sql.json(c.input as never)}, ${sql.json(c.expected as never)}, ${c.isRegression ?? false}, ${c.origin ?? f}, ${doc.version})
        ON CONFLICT (id) DO UPDATE SET category = EXCLUDED.category, agent = EXCLUDED.agent, criticality = EXCLUDED.criticality, input = EXCLUDED.input, expected = EXCLUDED.expected, is_regression = EXCLUDED.is_regression, origin = EXCLUDED.origin, dataset_version = EXCLUDED.dataset_version`;
      n++;
    }
  }
  return n;
}

export async function runEvaluationAction() {
  const session = await getSession();
  if (!session.isInternal) redirect("/ask");
  await ensureGoldenLoaded();
  const result = await runEvaluation(db(), { codeVersion: process.env.WPI_CODE_VERSION ?? "web" });
  if (session.principal.userId) await db()`INSERT INTO audit_events (user_id, action, target_type, target_id, details) VALUES (${session.principal.userId}, 'evaluation.run', 'evaluation_run', ${result.runId}, ${db().json({ passed: result.gate.passed, cases: result.metrics.cases } as never)})`;
  revalidatePath("/evaluations");
  redirect(`/evaluations/${result.runId}`);
}
