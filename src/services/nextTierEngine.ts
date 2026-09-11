/**
 * Next-tier gap analysis: what does a customer need to reach the next tier?
 * Gaps are never negative: max(requirement - actual, 0).
 */
import type { CustomerMetrics, NextTierGap, RankedTierCode, TierEvaluation } from '../types';
import { NEXT_TIER, TIER_RULES } from '../config/tierRules';
import { formatMoneyCompact } from '../utils/money';
import { pluralize } from '../utils/normalization';

function creditRequirementFor(target: RankedTierCode, m: CustomerMetrics): { met: boolean; requirement: string; action: string } {
  const rule = TIER_RULES[target];
  if (rule.credit === 'establishedCredit') {
    return { met: m.hasEstablishedCredit, requirement: rule.creditRequirementText, action: 'Establish credit terms' };
  }
  if (rule.credit === 'establishedCreditOrPaymentHistory') {
    const met = m.hasEstablishedCredit || m.paymentHistoryPass;
    let action = 'Establish credit terms or demonstrate consistent payment history';
    if (!met && (m.paymentHistory.overdueOrders > 0 || m.paymentHistory.seriouslyDelinquentOrders > 0)) {
      action = 'Bring past-due invoices current (or establish credit terms)';
    }
    return { met, requirement: rule.creditRequirementText, action };
  }
  return { met: !m.hasEstablishedCredit, requirement: rule.creditRequirementText, action: '' };
}

function vendorClause(vendors: number): string {
  if (vendors <= 0) return '';
  return vendors === 1 ? ' from a new vendor' : ` from ${vendors} new vendors`;
}

/** Builds the concise salesperson-facing recommendation. */
export function buildGapSummary(gap: { additionalSpend: number; additionalOrders: number; additionalVendors: number; creditRequirementMet: boolean; creditAction: string }): string {
  const { additionalSpend: S, additionalOrders: O, additionalVendors: V, creditRequirementMet, creditAction } = gap;
  let purchase = '';
  if (O > 0 && S > 0) {
    purchase = `${pluralize(O, 'additional qualifying order')} totaling at least ${formatMoneyCompact(S)}${vendorClause(V)}`;
  } else if (O > 0) {
    purchase = `${pluralize(O, 'additional qualifying order')}${vendorClause(V)}`;
  } else if (S > 0) {
    purchase = `Purchase at least ${formatMoneyCompact(S)} more${vendorClause(V)}`;
  } else if (V > 0) {
    purchase = `Purchase from ${pluralize(V, 'additional vendor')}`;
  }
  const credit = creditRequirementMet ? '' : creditAction;
  if (purchase && credit) return `${purchase}. ${credit}.`;
  if (purchase) return `${purchase}.`;
  if (credit) return `${credit}. All purchasing requirements are already met.`;
  return 'All requirements are met.';
}

export function computeNextTierGap(m: CustomerMetrics, evaluation: TierEvaluation): NextTierGap {
  const current = evaluation.tier;
  const target = NEXT_TIER[current] ?? null;
  if (!target || (current === 'REVIEW' && evaluation.reviewReason !== 'TIER_GAP')) {
    return {
      currentTier: current,
      nextTier: current === 'REVIEW' ? 'C' : null,
      additionalSpend: 0,
      additionalOrders: 0,
      additionalVendors: 0,
      creditRequirementMet: true,
      creditRequirement: '',
      summary: current === 'A' ? 'Already at the highest tier.' : current === 'E' ? 'Tier E: resolve credit standing before pursuing a tier move.' : 'Insufficient recent activity to recommend a next-tier action.',
    };
  }
  const rule = TIER_RULES[target];
  const additionalSpend = Math.max(rule.minSpend - m.rollingSpend, 0);
  const additionalOrders = Math.max(rule.minOrders - m.rollingOrderCount, 0);
  const additionalVendors = Math.max(rule.minVendors - m.vendorCount, 0);
  const credit = creditRequirementFor(target, m);
  const summary = buildGapSummary({ additionalSpend, additionalOrders, additionalVendors, creditRequirementMet: credit.met, creditAction: credit.action });
  return {
    currentTier: current,
    nextTier: target,
    additionalSpend: Math.round(additionalSpend * 100) / 100,
    additionalOrders,
    additionalVendors,
    creditRequirementMet: credit.met,
    creditRequirement: credit.requirement,
    summary,
  };
}
