import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { getSql, closeSql } from "../db/client.ts";
import { loadGoldenDataset, GOLDEN_DIR } from "./dataset.ts";
import { runEvaluation } from "./runner.ts";

const gateMode = process.argv.includes("--gate");
const verbose = process.argv.includes("--verbose");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7)?.split(",");

async function main() {
  const sql = getSql();
  const n = await loadGoldenDataset(sql);
  let codeVersion: string | null = null;
  try { codeVersion = execSync("git rev-parse --short HEAD", { cwd: join(GOLDEN_DIR, "..", "..") }).toString().trim(); } catch { /* not a git checkout */ }
  const res = await runEvaluation(sql, { onlyIds: only, codeVersion: codeVersion ?? undefined });
  const m = res.metrics;
  const pct = (x: number, d = 3) => `${(x * 100).toFixed(d)}%`;
  console.log(`\nWelsford Product Intelligence — evaluation run ${res.runId}`);
  console.log(`dataset v${res.datasetVersion} (${n} cases loaded, ${m.cases} executed) code ${codeVersion ?? "n/a"} LLM: disabled (deterministic path)\n`);
  console.log(`Cases passed              ${m.passed}/${m.cases}  (${pct(m.caseAccuracy, 1)})`);
  console.log(`Factual claims tested     ${m.claimsTotal}`);
  console.log(`Incorrect claims          ${m.claimsIncorrect}`);
  console.log(`CLAIM PRECISION           ${pct(m.claimPrecision)}   (target ≥ 99.9%)`);
  console.log(`Critical-claim precision  ${pct(m.criticalClaimPrecision)}   (${m.criticalClaimsTotal} claims, target 100%)`);
  console.log(`Citation validity         ${pct(m.citationValidity)}   (target ≥ 99.9%)`);
  console.log(`Unsupported claim rate    ${pct(m.unsupportedClaimRate)}   (target ≤ 0.1%)`);
  console.log(`Severity-1 errors         ${m.severity1Errors}   (target 0)`);
  console.log(`Abstention quality        ${m.abstainedCorrectly}/${m.expectedAbstain} expected abstentions honored (${pct(m.abstentionQuality, 1)}); false-answer rate ${pct(m.falseAnswerRate, 1)}`);
  console.log(`Abstention rate (overall) ${pct(m.abstentionRate, 1)}   answer rate ${pct(m.answerRate, 1)}`);
  console.log(`Exact part lookup         ${m.partLookupExact.passed}/${m.partLookupExact.cases}`);
  console.log(`Regression cases          ${m.regressionPassed}/${m.regressionCases}`);
  console.log(`\nBy category:`);
  for (const [cat, b] of Object.entries(m.byCategory).sort()) console.log(`  ${cat.padEnd(28)} cases ${String(b.passed).padStart(2)}/${String(b.cases).padEnd(3)} claims ${String(b.claimsCorrect).padStart(3)}/${b.claims}`);
  const failures = res.results.filter((r) => !r.pass);
  if (failures.length || verbose) {
    console.log(`\nFailures (${failures.length}):`);
    for (const f of failures) {
      console.log(`  ✗ ${f.id} [${f.category}/${f.agent}] outcome=${f.outcome} expected=${f.expectedOutcome ?? "any"}${f.error ? ` ERROR ${f.error}` : ""}`);
      for (const c of f.claims.filter((c) => !c.correct)) console.log(`      wrong claim: ${c.subject} ${c.predicate}=${c.value} — ${c.reason}`);
      for (const e of f.missingExpected) console.log(`      missing expected: ${e.subject} ${e.predicate}=${e.value}`);
      for (const e of f.forbiddenHit) console.log(`      forbidden claim present: ${e.subject} ${e.predicate}${e.value ? "=" + e.value : ""}`);
      for (const d of f.dataFailures) console.log(`      data: ${d}`);
    }
  }
  console.log(`\nRELEASE GATE: ${res.gate.passed ? "PASS" : "FAIL"}`);
  for (const r of res.gate.reasons) console.log(`  - ${r}`);
  const outDir = join(GOLDEN_DIR, "..", "runs");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${res.runId.slice(0, 8)}.json`);
  writeFileSync(outFile, JSON.stringify(res, null, 2));
  console.log(`\nFull results: ${outFile}`);
  await closeSql();
  if (gateMode && !res.gate.passed) process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
