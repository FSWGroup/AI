import type { EvalRunResult } from "@wpi/core";

export type EvalMetrics = EvalRunResult["metrics"];
export type CaseResult = EvalRunResult["results"][number];

/**
 * Release-gate reasons for a stored metrics payload. Mirrors core's releaseGate (docs/release-gates.md) so historical
 * runs can be explained without re-running them; core's own gate result is what is persisted in evaluation_runs.passed_gate.
 */
export function gateReasons(m: EvalMetrics): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (m.claimPrecision < 0.999) reasons.push(`claim precision ${(m.claimPrecision * 100).toFixed(3)}% < 99.9%`);
  if (m.criticalClaimPrecision < 1) reasons.push(`critical-claim precision ${(m.criticalClaimPrecision * 100).toFixed(3)}% < 100%`);
  if (m.severity1Errors > 0) reasons.push(`${m.severity1Errors} severity-1 error(s)`);
  if (m.citationValidity < 0.999) reasons.push(`citation validity ${(m.citationValidity * 100).toFixed(3)}% < 99.9%`);
  if (m.unsupportedClaimRate > 0.001) reasons.push(`unsupported claim rate ${(m.unsupportedClaimRate * 100).toFixed(3)}% > 0.1%`);
  if (m.regressionPassed < m.regressionCases) reasons.push(`${m.regressionCases - m.regressionPassed} regression case(s) failing`);
  if (m.partLookupExact.passed < m.partLookupExact.cases) reasons.push(`exact part lookup ${m.partLookupExact.passed}/${m.partLookupExact.cases} < 100%`);
  if (m.abstentionQuality < 1) reasons.push(`abstention quality ${(m.abstentionQuality * 100).toFixed(1)}% < 100%`);
  for (const cat of ["pricing", "inventory", "territory_eligibility"]) { const b = m.byCategory[cat]; if (b && b.passed < b.cases) reasons.push(`${cat}: ${b.passed}/${b.cases} cases pass (target 100%)`); }
  return { passed: reasons.length === 0, reasons };
}
