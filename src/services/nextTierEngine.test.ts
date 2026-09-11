import { describe, it, expect } from 'vitest';
import { computeNextTierGap, buildGapSummary } from './nextTierEngine';
import { determineCustomerTier } from './tierEngine';
import { metrics } from '../test/fixtures';

function gapFor(input: Parameters<typeof metrics>[0]) {
  const m = metrics(input);
  return computeNextTierGap(m, determineCustomerTier(m));
}

describe('computeNextTierGap', () => {
  it('B -> A: $25,400, 4 orders, 2 vendors, Net 30', () => {
    const g = gapFor({ hasEstablishedCredit: true, rollingOrderCount: 4, rollingSpend: 25400, vendors: ['R', 'S'] });
    expect(g.currentTier).toBe('B');
    expect(g.nextTier).toBe('A');
    expect(g.additionalSpend).toBe(4600);
    expect(g.additionalOrders).toBe(0);
    expect(g.additionalVendors).toBe(1);
    expect(g.creditRequirementMet).toBe(true);
    expect(g.summary).toBe('Purchase at least $4,600 more from a new vendor.');
  });

  it('C -> B: $13,500, 2 orders, 2 vendors -> one order of at least $1,500', () => {
    const g = gapFor({ paymentHistoryPass: true, rollingOrderCount: 2, rollingSpend: 13500, vendors: ['R', 'S'] });
    expect(g.currentTier).toBe('C');
    expect(g.nextTier).toBe('B');
    expect(g.additionalSpend).toBe(1500);
    expect(g.additionalOrders).toBe(1);
    expect(g.summary).toBe('1 additional qualifying order totaling at least $1,500.');
  });

  it('B -> A: purchasing met, credit missing', () => {
    const g = gapFor({ paymentHistoryPass: true, rollingOrderCount: 4, rollingSpend: 34000, vendors: ['R', 'S', 'A'] });
    expect(g.currentTier).toBe('B');
    expect(g.summary).toBe('Establish credit terms. All purchasing requirements are already met.');
  });

  it('never returns negative gaps', () => {
    const g = gapFor({ paymentHistoryPass: true, rollingOrderCount: 9, rollingSpend: 14000, vendors: ['R', 'S', 'A', 'T'] });
    expect(g.currentTier).toBe('C');
    expect(g.additionalOrders).toBe(0);
    expect(g.additionalVendors).toBe(0);
    expect(g.additionalSpend).toBe(1000);
  });

  it('A has no next tier', () => {
    const g = gapFor({ hasEstablishedCredit: true, rollingOrderCount: 4, rollingSpend: 30000, vendors: ['R', 'S', 'A'] });
    expect(g.nextTier).toBeNull();
    expect(g.summary).toBe('Already at the highest tier.');
  });

  it('D -> C combines order + spend + vendor naturally', () => {
    const g = gapFor({ paymentHistoryPass: true, rollingOrderCount: 1, rollingSpend: 500, vendors: ['R'] });
    expect(g.currentTier).toBe('D');
    expect(g.nextTier).toBe('C');
    expect(g.summary).toBe('1 additional qualifying order totaling at least $4,500.');
  });

  it('REVIEW gap customers are pointed at C', () => {
    const g = gapFor({ paymentHistoryPass: true, rollingOrderCount: 1, rollingSpend: 3500, vendors: ['R'] });
    expect(g.currentTier).toBe('REVIEW');
    expect(g.nextTier).toBe('C');
    expect(g.summary).toBe('1 additional qualifying order totaling at least $1,500.');
  });

  it('phrases vendor-only and credit-only needs', () => {
    expect(buildGapSummary({ additionalSpend: 0, additionalOrders: 0, additionalVendors: 1, creditRequirementMet: true, creditAction: '' })).toBe('Purchase from 1 additional vendor.');
    expect(buildGapSummary({ additionalSpend: 0, additionalOrders: 0, additionalVendors: 0, creditRequirementMet: false, creditAction: 'Establish credit terms' })).toBe('Establish credit terms. All purchasing requirements are already met.');
    expect(buildGapSummary({ additionalSpend: 2550, additionalOrders: 1, additionalVendors: 1, creditRequirementMet: true, creditAction: '' })).toBe('1 additional qualifying order totaling at least $2,550 from a new vendor.');
    expect(buildGapSummary({ additionalSpend: 2550, additionalOrders: 0, additionalVendors: 1, creditRequirementMet: true, creditAction: '' })).toBe('Purchase at least $2,550 more from a new vendor.');
    expect(buildGapSummary({ additionalSpend: 0, additionalOrders: 2, additionalVendors: 0, creditRequirementMet: true, creditAction: '' })).toBe('2 additional qualifying orders.');
  });
});
