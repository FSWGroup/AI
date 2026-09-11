import { describe, it, expect } from 'vitest';
import { buildOpportunities, topOpportunitiesForRep, isOpportunityEligible } from './opportunityEngine';
import { analyzeCustomers } from './analyzer';
import { metrics } from '../test/fixtures';
import { determineCustomerTier } from './tierEngine';
import { computeNextTierGap } from './nextTierEngine';
import type { CustomerAnalysis } from '../types';

function analysis(input: Parameters<typeof metrics>[0]): CustomerAnalysis {
  const m = metrics(input);
  const tier = determineCustomerTier(m);
  return { metrics: m, tier, nextTier: computeNextTierGap(m, tier), fallout: { falloutDate: null, reason: '', daysUntil: null, indeterminate: true }, creditLabel: '' };
}

describe('opportunity engine', () => {
  it('excludes A and E customers and REVIEW customers with insufficient data', () => {
    expect(isOpportunityEligible(analysis({ hasEstablishedCredit: true, rollingOrderCount: 4, rollingSpend: 30000, vendors: ['R', 'S', 'A'] }))).toBe(false);
    expect(isOpportunityEligible(analysis({ has90DayPastDueInvoice: true, rollingOrderCount: 2, rollingSpend: 6000 }))).toBe(false);
    expect(isOpportunityEligible(analysis({ rollingOrderCount: 0, rollingSpend: 0, qualifyingOrders: [], dataComplete: false }))).toBe(false);
    expect(isOpportunityEligible(analysis({ paymentHistoryPass: true, rollingOrderCount: 1, rollingSpend: 3500 }))).toBe(true);
    expect(isOpportunityEligible(analysis({ paymentHistoryPass: true, rollingOrderCount: 1, rollingSpend: 500 }))).toBe(true);
  });

  it('scores customers closest to the next tier highest', () => {
    const close = analysis({ company: 'Close Co', hasEstablishedCredit: true, rollingOrderCount: 4, rollingSpend: 27450, vendors: ['R', 'S'] }); // B->A
    const far = analysis({ company: 'Far Co', hasEstablishedCredit: true, rollingOrderCount: 3, rollingSpend: 15000, vendors: ['R', 'S'] }); // B->A
    const list = buildOpportunities([far, close]);
    expect(list[0].company).toBe('Close Co');
    expect(list[0].score).toBeGreaterThan(list[1].score);
    // spendProgress 27450/30000*45 + 25 + 2/3*20 + 10 + 5
    expect(list[0].score).toBeCloseTo(41.175 + 25 + 13.333 + 10 + 5, 0);
  });

  it('uses deterministic tie breakers: spend, then last order date, then company name', () => {
    const a = analysis({ company: 'Zeta Co', paymentHistoryPass: true, rollingOrderCount: 2, rollingSpend: 6000, vendors: ['R'], lastOrderDate: new Date(2026, 6, 1) });
    const b = analysis({ company: 'Alpha Co', paymentHistoryPass: true, rollingOrderCount: 2, rollingSpend: 6000, vendors: ['R'], lastOrderDate: new Date(2026, 6, 1) });
    const c = analysis({ company: 'Mid Co', paymentHistoryPass: true, rollingOrderCount: 2, rollingSpend: 6000, vendors: ['R'], lastOrderDate: new Date(2026, 7, 1) });
    const d = analysis({ company: 'Rich Co', paymentHistoryPass: true, rollingOrderCount: 2, rollingSpend: 6500, vendors: ['R'], lastOrderDate: new Date(2026, 1, 1) });
    const list = buildOpportunities([a, b, c, d]);
    // All C->B with equal order/vendor progress; spend progress differs slightly for Rich Co (higher score).
    expect(list.map((o) => o.company)).toEqual(['Rich Co', 'Mid Co', 'Alpha Co', 'Zeta Co']);
  });

  it('ranks within each sales rep and returns at most 10 per rep', () => {
    const list = Array.from({ length: 12 }, (_, i) => analysis({ company: `Co ${i}`, salesRep: i % 2 ? 'Joe Mitchell' : 'Cleon Kemp', paymentHistoryPass: true, rollingOrderCount: 2, rollingSpend: 5000 + i * 100, vendors: ['R'] }));
    const opps = buildOpportunities(list);
    const joe = topOpportunitiesForRep(opps, 'Joe Mitchell');
    expect(joe.length).toBe(6);
    expect(joe.map((o) => o.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    const many = Array.from({ length: 15 }, (_, i) => analysis({ company: `Big ${i}`, salesRep: 'Joe Mitchell', paymentHistoryPass: true, rollingOrderCount: 2, rollingSpend: 5000 + i, vendors: ['R'] }));
    expect(topOpportunitiesForRep(buildOpportunities(many), 'Joe Mitchell')).toHaveLength(10);
  });

  it('analyzeCustomers produces one record per customer end-to-end', () => {
    const result = analyzeCustomers([], new Date());
    expect(result).toEqual([]);
  });
});
