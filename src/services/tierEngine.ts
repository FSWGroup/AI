/**
 * CENTRALIZED TIER ENGINE — the single source of truth for customer tiers.
 *
 * Evaluation order: E override, then A, B, C, D, then REVIEW.
 * All requirements of a tier must be met. The highest qualifying tier wins.
 * The React UI never calculates tiers on its own.
 */
import type { CustomerMetrics, RankedTierCode, ReviewReason, TierCriterionResult, TierEvaluation, TierReasons } from '../types';
import { TIER_EVALUATION_ORDER, TIER_RULES, TierRule } from '../config/tierRules';
import { formatMoney } from '../utils/money';
import { pluralize } from '../utils/normalization';

/** Human label for the customer's credit/payment position (used in tables). */
export function creditPositionLabel(m: CustomerMetrics): string {
  if (m.hasEstablishedCredit) return m.creditTermsLabel ?? 'Established credit terms';
  if (m.paymentHistoryPass) return 'Pay-as-you-go (consistent payment history)';
  if (m.paymentHistory.applicableOrders === 0) return 'No payment history';
  if (m.paymentHistory.seriouslyDelinquentOrders > 0) return 'Pay-as-you-go (90+ days past due)';
  if (m.paymentHistory.overdueOrders > 0) return 'Pay-as-you-go (past-due invoice)';
  return 'Pay-as-you-go (payment history unclear)';
}

function creditCriterion(rule: TierRule, m: CustomerMetrics): TierCriterionResult {
  const actual = creditPositionLabel(m);
  let passed: boolean;
  switch (rule.credit) {
    case 'establishedCredit':
      passed = m.hasEstablishedCredit;
      break;
    case 'establishedCreditOrPaymentHistory':
      passed = m.hasEstablishedCredit || m.paymentHistoryPass;
      break;
    case 'payAsYouGo':
      passed = !m.hasEstablishedCredit;
      break;
  }
  return {
    passed,
    actual,
    requirement: rule.creditRequirementText,
    display: `${passed ? 'Met' : 'Not met'} — ${actual}`,
  };
}

function ordersCriterion(rule: TierRule, m: CustomerMetrics): TierCriterionResult {
  const n = m.rollingOrderCount;
  const passed = n >= rule.minOrders && (rule.maxOrders == null || n <= rule.maxOrders);
  const requirement = rule.maxOrders != null && rule.maxOrders === rule.minOrders ? `${rule.minOrders} (single purchase)` : rule.minOrders;
  const display =
    rule.maxOrders != null
      ? `${passed ? 'Met' : 'Not met'} — ${pluralize(n, 'order')} (single purchase required)`
      : `${passed ? 'Met' : 'Not met'} — ${pluralize(n, 'order')} / ${rule.minOrders} required`;
  return { passed, actual: n, requirement, display };
}

function spendCriterion(rule: TierRule, m: CustomerMetrics): TierCriterionResult {
  const s = m.rollingSpend;
  const passed = s >= rule.minSpend && (rule.maxSpendExclusive == null || s < rule.maxSpendExclusive);
  const requirement = rule.maxSpendExclusive != null ? `Under ${formatMoney(rule.maxSpendExclusive)}` : rule.minSpend;
  const display =
    rule.maxSpendExclusive != null
      ? `${passed ? 'Met' : 'Not met'} — ${formatMoney(s)} (under ${formatMoney(rule.maxSpendExclusive)} required)`
      : `${passed ? 'Met' : 'Not met'} — ${formatMoney(s)} / ${formatMoney(rule.minSpend)} required`;
  return { passed, actual: s, requirement, display };
}

function vendorCriterion(rule: TierRule, m: CustomerMetrics): TierCriterionResult {
  const v = m.vendorCount;
  const passed = v >= rule.minVendors;
  return { passed, actual: v, requirement: rule.minVendors, display: `${passed ? 'Met' : 'Not met'} — ${pluralize(v, 'vendor')} / ${rule.minVendors} required` };
}

export function evaluateTierRequirements(code: RankedTierCode, m: CustomerMetrics): TierReasons {
  const rule = TIER_RULES[code];
  return {
    credit: creditCriterion(rule, m),
    orders: ordersCriterion(rule, m),
    spend: spendCriterion(rule, m),
    vendorMix: vendorCriterion(rule, m),
  };
}

export function reasonsAllPassed(r: TierReasons): boolean {
  return r.credit.passed && r.orders.passed && r.spend.passed && r.vendorMix.passed;
}

export function meetsTier(code: RankedTierCode, m: CustomerMetrics): boolean {
  return reasonsAllPassed(evaluateTierRequirements(code, m));
}

export function tierEReasons(m: CustomerMetrics): string[] {
  const reasons: string[] = [];
  if (m.manualTierEOverride) reasons.push('Manual Tier E override (accountOverrides.ts)');
  if (m.has90DayPastDueInvoice) reasons.push(m.seriousDelinquencyExplanation ?? 'Unpaid invoice 90+ days past due');
  if (m.hasFraudOrChargeback) reasons.push('Fraud or chargeback recorded on the account');
  if (m.requiresUpfrontPayment) reasons.push('Account requires 100% upfront payment / fixed terms');
  return reasons;
}

function nearestTierForReview(checks: Record<RankedTierCode, TierReasons>): RankedTierCode {
  // Highest tier whose purchasing requirements (orders, spend, vendors) are all met; else most criteria passed.
  for (const code of TIER_EVALUATION_ORDER) {
    const r = checks[code];
    if (r.orders.passed && r.spend.passed && r.vendorMix.passed) return code;
  }
  let best: RankedTierCode = 'C';
  let bestScore = -1;
  for (const code of TIER_EVALUATION_ORDER) {
    const r = checks[code];
    const score = [r.credit, r.orders, r.spend, r.vendorMix].filter((c) => c.passed).length;
    if (score > bestScore) {
      best = code;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Determines the customer's tier with structured reasoning.
 */
export function determineCustomerTier(m: CustomerMetrics): TierEvaluation {
  const tierChecks = {
    A: evaluateTierRequirements('A', m),
    B: evaluateTierRequirements('B', m),
    C: evaluateTierRequirements('C', m),
    D: evaluateTierRequirements('D', m),
  };

  const eReasons = tierEReasons(m);
  let normalTier: RankedTierCode | null = null;
  for (const code of TIER_EVALUATION_ORDER) {
    if (reasonsAllPassed(tierChecks[code])) {
      normalTier = code;
      break;
    }
  }

  if (eReasons.length) {
    const basis = normalTier ?? nearestTierForReview(tierChecks);
    return {
      tier: 'E',
      reasons: tierChecks[basis],
      explanation: `Tier E override: ${eReasons.map((r) => r.replace(/\.$/, '')).join('; ')}.` + (normalTier ? ` Purchasing activity would otherwise meet Tier ${normalTier}.` : ''),
      reviewReason: null,
      eReasons,
      tierChecks,
    };
  }

  if (normalTier) {
    return {
      tier: normalTier,
      reasons: tierChecks[normalTier],
      explanation: `Meets all Tier ${normalTier} requirements.`,
      reviewReason: null,
      eReasons: [],
      tierChecks,
    };
  }

  let reviewReason: ReviewReason;
  let explanation: string;
  if (m.rollingOrderCount === 0 && m.qualifyingOrders.length === 0) {
    reviewReason = 'MISSING_DATA';
    explanation = 'No qualifying orders could be determined from the tracker (all rows are refunds, cancellations, replacements or missing data).';
  } else if (m.rollingOrderCount === 0) {
    reviewReason = 'NO_RECENT_ORDERS';
    explanation = 'No qualifying orders in the rolling 12-month window; the customer is inactive for tiering purposes.';
  } else {
    reviewReason = 'TIER_GAP';
    const nearest = nearestTierForReview(tierChecks);
    const failed = Object.entries(tierChecks[nearest])
      .filter(([, c]) => !c.passed)
      .map(([k]) => (k === 'vendorMix' ? 'vendor mix' : k));
    explanation = `Activity does not cleanly satisfy a documented tier. Closest is Tier ${nearest} (not met: ${failed.join(', ')}).`;
  }
  return {
    tier: 'REVIEW',
    reasons: tierChecks[nearestTierForReview(tierChecks)],
    explanation,
    reviewReason,
    eReasons: [],
    tierChecks,
  };
}
