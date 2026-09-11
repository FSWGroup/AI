/**
 * OFFICIAL VALVEMAN CUSTOMER TIER RULES
 *
 * This is the single source of truth for tier thresholds. Do not duplicate these
 * values anywhere else in the application.
 *
 * Source: ValveMan Customer Tier reference ("Valveman Customer Tiers - 12 Rolling Months").
 *
 *   A Strategic  Established credit terms                              4+ orders   $30,000+     3+ vendors
 *   B Preferred  Credit terms OR consistent payment history            3+ orders   $15,000+     2+ vendors
 *   C Core       Credit terms OR consistent payment history            2+ orders   $5,000+      1+ vendors
 *   D Emerging   Pay-as-you-go / no established credit                 single      Under $1,000 1+ vendors
 *   E Fired      No acceptable standing / 90+ days past due / 100% upfront   Any    Any          Any
 *
 * Order frequency and total spend use the rolling 12-month window ending on the
 * Analysis As Of date. Vendor mix (Product Purchase Mix) uses all legitimate
 * purchase history in the uploaded tracker.
 */
import type { RankedTierCode } from '../types';

export type CreditRule = 'establishedCredit' | 'establishedCreditOrPaymentHistory' | 'payAsYouGo';

export interface TierRule {
  code: RankedTierCode;
  name: string;
  /** Minimum qualifying orders in the rolling window (inclusive). */
  minOrders: number;
  /** Maximum qualifying orders in the rolling window (inclusive); null = no maximum. */
  maxOrders: number | null;
  /** Minimum rolling spend (inclusive); e.g. 30000 means $30,000 exactly qualifies. */
  minSpend: number;
  /** Exclusive maximum rolling spend; e.g. 1000 means $999.99 qualifies, $1,000.00 does not. null = none. */
  maxSpendExclusive: number | null;
  /** Minimum distinct vendors (inclusive). */
  minVendors: number;
  credit: CreditRule;
  creditRequirementText: string;
}

export const TIER_RULES: Record<RankedTierCode, TierRule> = {
  A: {
    code: 'A',
    name: 'Strategic',
    minOrders: 4,
    maxOrders: null,
    minSpend: 30000,
    maxSpendExclusive: null,
    minVendors: 3,
    credit: 'establishedCredit',
    creditRequirementText: 'Established credit terms',
  },
  B: {
    code: 'B',
    name: 'Preferred',
    minOrders: 3,
    maxOrders: null,
    minSpend: 15000,
    maxSpendExclusive: null,
    minVendors: 2,
    credit: 'establishedCreditOrPaymentHistory',
    creditRequirementText: 'Established credit terms OR consistent payment history',
  },
  C: {
    code: 'C',
    name: 'Core',
    minOrders: 2,
    maxOrders: null,
    minSpend: 5000,
    maxSpendExclusive: null,
    minVendors: 1,
    credit: 'establishedCreditOrPaymentHistory',
    creditRequirementText: 'Established credit terms OR consistent payment history',
  },
  D: {
    code: 'D',
    name: 'Emerging',
    // "First-time OR single purchase": exactly one qualifying order in the window.
    minOrders: 1,
    maxOrders: 1,
    minSpend: 0,
    maxSpendExclusive: 1000,
    minVendors: 1,
    credit: 'payAsYouGo',
    creditRequirementText: 'Pay-as-you-go / no established credit',
  },
};

/** Evaluation order: E is checked first (override), then highest to lowest. */
export const TIER_EVALUATION_ORDER: RankedTierCode[] = ['A', 'B', 'C', 'D'];

export const TIER_NAMES: Record<string, string> = {
  A: 'Strategic',
  B: 'Preferred',
  C: 'Core',
  D: 'Emerging',
  E: 'Fired / Fixed Terms',
  REVIEW: 'Review',
};

export const NEXT_TIER: Record<string, RankedTierCode | null> = {
  A: null,
  B: 'A',
  C: 'B',
  D: 'C',
  // Customers whose activity falls in a gap between documented tiers are pointed at Core.
  REVIEW: 'C',
  E: null,
};

/** Tier E: an unpaid invoice this many days (or more) past its due date triggers E. */
export const SERIOUS_DELINQUENCY_DAYS = 90;

/** Opportunity score weights (transparent business-priority score, not AI). */
export const OPPORTUNITY_WEIGHTS = {
  spend: 45,
  orders: 25,
  vendors: 20,
  credit: 10,
};

export const OPPORTUNITY_NEXT_TIER_BONUS: Record<RankedTierCode, number> = {
  A: 5,
  B: 3,
  C: 1,
  D: 0,
};

/** Fall-out warning thresholds (days). */
export const AT_RISK_DAYS_WARNING = 60;
export const AT_RISK_DAYS_URGENT = 30;
