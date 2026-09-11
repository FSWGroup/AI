/**
 * Opportunity ranking: which customers are closest to the NEXT tier?
 *
 * Transparent business-priority score (not AI):
 *   Base  = spendProgress*45 + orderProgress*25 + vendorProgress*20 + creditProgress*10
 *   Bonus = +5 next tier A, +3 next tier B, +1 next tier C
 * Tie breakers: higher 12-month spend, more recent last qualifying order, company name A-Z.
 */
import type { CustomerAnalysis, Opportunity } from '../types';
import { OPPORTUNITY_NEXT_TIER_BONUS, OPPORTUNITY_WEIGHTS, TIER_RULES } from '../config/tierRules';
import { creditPositionLabel } from './tierEngine';

export function isOpportunityEligible(c: CustomerAnalysis): boolean {
  const t = c.tier.tier;
  if (t === 'A' || t === 'E') return false;
  if (t === 'REVIEW') return c.tier.reviewReason === 'TIER_GAP' && c.metrics.dataComplete;
  return c.nextTier.nextTier != null;
}

export function scoreOpportunity(c: CustomerAnalysis): Opportunity['scoreBreakdown'] & { score: number } {
  const target = c.nextTier.nextTier!;
  const rule = TIER_RULES[target];
  const m = c.metrics;
  const spendProgress = rule.minSpend > 0 ? Math.min(m.rollingSpend / rule.minSpend, 1) : 1;
  const orderProgress = rule.minOrders > 0 ? Math.min(m.rollingOrderCount / rule.minOrders, 1) : 1;
  const vendorProgress = rule.minVendors > 0 ? Math.min(m.vendorCount / rule.minVendors, 1) : 1;
  const creditProgress = c.nextTier.creditRequirementMet ? 1 : 0;
  const baseScore = spendProgress * OPPORTUNITY_WEIGHTS.spend + orderProgress * OPPORTUNITY_WEIGHTS.orders + vendorProgress * OPPORTUNITY_WEIGHTS.vendors + creditProgress * OPPORTUNITY_WEIGHTS.credit;
  const bonus = OPPORTUNITY_NEXT_TIER_BONUS[target];
  return { spendProgress, orderProgress, vendorProgress, creditProgress, baseScore, bonus, score: Math.round((baseScore + bonus) * 10) / 10 };
}

export function compareOpportunities(a: Opportunity, b: Opportunity): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.rollingSpend !== a.rollingSpend) return b.rollingSpend - a.rollingSpend;
  const ad = a.lastOrderDate?.getTime() ?? 0;
  const bd = b.lastOrderDate?.getTime() ?? 0;
  if (bd !== ad) return bd - ad;
  return a.company.localeCompare(b.company);
}

/** All eligible opportunities, ranked within each sales rep. */
export function buildOpportunities(customers: CustomerAnalysis[]): Opportunity[] {
  const list: Opportunity[] = [];
  for (const c of customers) {
    if (!isOpportunityEligible(c)) continue;
    const { score, ...breakdown } = scoreOpportunity(c);
    list.push({
      rank: 0,
      company: c.metrics.company,
      companyKey: c.metrics.companyKey,
      salesRep: c.metrics.salesRep,
      currentTier: c.tier.tier,
      nextTier: c.nextTier.nextTier!,
      rollingSpend: c.metrics.rollingSpend,
      rollingOrderCount: c.metrics.rollingOrderCount,
      vendorCount: c.metrics.vendorCount,
      creditLabel: creditPositionLabel(c.metrics),
      gap: c.nextTier,
      score,
      scoreBreakdown: breakdown,
      lastOrderDate: c.metrics.lastOrderDate,
    });
  }
  list.sort(compareOpportunities);
  const perRep = new Map<string, number>();
  for (const o of list) {
    const n = (perRep.get(o.salesRep) ?? 0) + 1;
    perRep.set(o.salesRep, n);
    o.rank = n;
  }
  return list;
}

export function topOpportunitiesForRep(all: Opportunity[], rep: string, limit = 10): Opportunity[] {
  return all.filter((o) => o.salesRep === rep).slice(0, limit);
}

/** Top N across every rep, re-ranked as one list (used when "All Sales Reps" is copied as one table). */
export function topOpportunitiesOverall(all: Opportunity[], limit = 10): Opportunity[] {
  return [...all].sort(compareOpportunities).slice(0, limit).map((o, i) => ({ ...o, rank: i + 1 }));
}
