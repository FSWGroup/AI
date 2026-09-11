/**
 * Falls Out Of Tier — simulation.
 *
 * Assuming no additional qualifying orders after the analysis date, find the earliest
 * future date on which the customer stops meeting ALL requirements of its CURRENT tier.
 * Candidate dates are each window order's expiry (order date + 12 months + 1 day).
 * At each candidate date the rolling metrics are recomputed and the current tier's
 * rules re-run. Vendor Mix is based on all purchase history and does not decay.
 */
import type { CustomerMetrics, FalloutResult, RankedTierCode, TierEvaluation } from '../types';
import { TIER_RULES } from '../config/tierRules';
import { daysBetween, formatDate, startOfDay, windowExpiryDate } from '../utils/dates';
import { formatMoney } from '../utils/money';
import { computeCreditStatus, computeWindowMetrics } from './customerAggregator';
import { evaluateTierRequirements, reasonsAllPassed } from './tierEngine';

export function simulateMetricsAt(m: CustomerMetrics, asOf: Date, simulatedDate: Date): CustomerMetrics {
  // No orders after the analysis date exist in the simulation.
  const eligible = m.qualifyingOrders.filter((o) => o.orderDate && startOfDay(o.orderDate).getTime() <= startOfDay(asOf).getTime());
  const { windowOrders, spend, count } = computeWindowMetrics(eligible, simulatedDate);
  const credit = computeCreditStatus(windowOrders, eligible);
  return {
    ...m,
    windowOrders,
    rollingSpend: spend,
    rollingOrderCount: count,
    hasEstablishedCredit: credit.hasEstablishedCredit,
    creditTermsLabel: credit.label,
  };
}

export function calculateFallout(m: CustomerMetrics, evaluation: TierEvaluation, asOf: Date): FalloutResult {
  const tier = evaluation.tier;
  if (tier === 'E' || tier === 'REVIEW') {
    return { falloutDate: null, reason: tier === 'E' ? 'Not applicable for Tier E.' : 'Not applicable: tier could not be determined.', daysUntil: null, indeterminate: true };
  }
  const code = tier as RankedTierCode;
  const rule = TIER_RULES[code];
  const candidates = [...new Set(m.windowOrders.filter((o) => o.orderDate).map((o) => windowExpiryDate(o.orderDate!).getTime()))]
    .filter((t) => t > startOfDay(asOf).getTime())
    .sort((a, b) => a - b)
    .map((t) => new Date(t));

  let previous = m;
  for (const date of candidates) {
    const simulated = simulateMetricsAt(m, asOf, date);
    const reasons = evaluateTierRequirements(code, simulated);
    if (!reasonsAllPassed(reasons)) {
      const parts: string[] = [];
      if (!reasons.orders.passed) {
        parts.push(
          rule.maxOrders != null
            ? `Order count drops from ${previous.rollingOrderCount} to ${simulated.rollingOrderCount}`
            : `Order count drops from ${previous.rollingOrderCount} to ${simulated.rollingOrderCount} (${code} requires ${rule.minOrders})`,
        );
      }
      if (!reasons.spend.passed) {
        parts.push(`Rolling spend falls from ${formatMoney(previous.rollingSpend)} to ${formatMoney(simulated.rollingSpend)} (${code} requires ${formatMoney(rule.minSpend)})`);
      }
      if (!reasons.credit.passed) {
        parts.push('Recent evidence of established credit terms ages out of the window');
      }
      if (!reasons.vendorMix.passed) {
        parts.push('Vendor mix requirement no longer met');
      }
      const reason = parts.length ? parts.join('. ') + '.' : `No longer meets Tier ${code} requirements.`;
      return { falloutDate: date, reason, daysUntil: daysBetween(asOf, date), indeterminate: false };
    }
    previous = simulated;
  }
  if (!candidates.length) {
    return { falloutDate: null, reason: 'No qualifying orders in the rolling window.', daysUntil: null, indeterminate: true };
  }
  return { falloutDate: null, reason: `Tier ${code} is retained through ${formatDate(candidates[candidates.length - 1])} even after all window orders expire.`, daysUntil: null, indeterminate: true };
}
