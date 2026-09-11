import { describe, it, expect } from 'vitest';
import { determineCustomerTier, meetsTier } from './tierEngine';
import { metrics } from '../test/fixtures';

describe('determineCustomerTier', () => {
  it('A qualification: Net 30, 4 orders, $30,000, 3 vendors', () => {
    const r = determineCustomerTier(metrics({ hasEstablishedCredit: true, rollingOrderCount: 4, rollingSpend: 30000, vendors: ['Richards', 'Spirax Sarco', 'Apollo'] }));
    expect(r.tier).toBe('A');
    expect(r.reasons.credit.passed).toBe(true);
    expect(r.reasons.orders.actual).toBe(4);
    expect(r.reasons.spend.actual).toBe(30000);
    expect(r.reasons.vendorMix.actual).toBe(3);
    expect(r.reasons.orders.display).toBe('Met — 4 orders / 4 required');
    expect(r.reasons.credit.display).toBe('Met — Net 30');
  });

  it('B qualification: 3 orders, $15,000, 2 vendors, consistent payment history (no terms)', () => {
    const r = determineCustomerTier(metrics({ hasEstablishedCredit: false, paymentHistoryPass: true, rollingOrderCount: 3, rollingSpend: 15000, vendors: ['Richards', 'Apollo'] }));
    expect(r.tier).toBe('B');
    expect(r.reasons.credit.actual).toContain('consistent payment history');
  });

  it('C qualification: 2 orders, $5,000, 1 vendor, consistent payment history', () => {
    const r = determineCustomerTier(metrics({ paymentHistoryPass: true, rollingOrderCount: 2, rollingSpend: 5000, vendors: ['Richards'] }));
    expect(r.tier).toBe('C');
  });

  it('D qualification: pay-as-you-go, 1 order, $999, 1 vendor', () => {
    const r = determineCustomerTier(metrics({ paymentHistoryPass: true, rollingOrderCount: 1, rollingSpend: 999, vendors: ['Richards'] }));
    expect(r.tier).toBe('D');
    expect(r.reasons.spend.display).toContain('under $1,000.00');
  });

  it('D boundary: $1,000.00 single order is NOT D (under $1,000 required) -> REVIEW gap', () => {
    const r = determineCustomerTier(metrics({ paymentHistoryPass: true, rollingOrderCount: 1, rollingSpend: 1000, vendors: ['Richards'] }));
    expect(r.tier).toBe('REVIEW');
    expect(r.reviewReason).toBe('TIER_GAP');
  });

  it('D boundary: $999.99 qualifies on spend', () => {
    expect(meetsTier('D', metrics({ rollingOrderCount: 1, rollingSpend: 999.99 }))).toBe(true);
    expect(meetsTier('D', metrics({ rollingOrderCount: 1, rollingSpend: 1000 }))).toBe(false);
  });

  it('D requires pay-as-you-go: a Net 30 single small order is not D', () => {
    const r = determineCustomerTier(metrics({ hasEstablishedCredit: true, rollingOrderCount: 1, rollingSpend: 200 }));
    expect(r.tier).toBe('REVIEW');
  });

  it('E override: otherwise A but a current invoice 90+ days past due', () => {
    const r = determineCustomerTier(metrics({ hasEstablishedCredit: true, rollingOrderCount: 4, rollingSpend: 30000, vendors: ['R', 'S', 'A'], has90DayPastDueInvoice: true }));
    expect(r.tier).toBe('E');
    expect(r.explanation).toContain('otherwise meet Tier A');
  });

  it('E override: manual override list', () => {
    const r = determineCustomerTier(metrics({ manualTierEOverride: true, rollingOrderCount: 1, rollingSpend: 100 }));
    expect(r.tier).toBe('E');
  });

  it('A credit requirement: great pay-as-you-go history without terms is NOT A (evaluates B)', () => {
    const r = determineCustomerTier(metrics({ hasEstablishedCredit: false, paymentHistoryPass: true, rollingOrderCount: 4, rollingSpend: 40000, vendors: ['R', 'S', 'A', 'T'] }));
    expect(r.tier).toBe('B');
    expect(r.tierChecks.A.credit.passed).toBe(false);
  });

  it('exact thresholds: $30,000 / 4 / 3 qualify A; $29,999.99 does not', () => {
    expect(meetsTier('A', metrics({ hasEstablishedCredit: true, rollingOrderCount: 4, rollingSpend: 30000, vendors: ['R', 'S', 'A'] }))).toBe(true);
    expect(meetsTier('A', metrics({ hasEstablishedCredit: true, rollingOrderCount: 4, rollingSpend: 29999.99, vendors: ['R', 'S', 'A'] }))).toBe(false);
    expect(meetsTier('A', metrics({ hasEstablishedCredit: true, rollingOrderCount: 3, rollingSpend: 50000, vendors: ['R', 'S', 'A'] }))).toBe(false);
    expect(meetsTier('A', metrics({ hasEstablishedCredit: true, rollingOrderCount: 4, rollingSpend: 50000, vendors: ['R', 'S'] }))).toBe(false);
    expect(meetsTier('B', metrics({ paymentHistoryPass: true, rollingOrderCount: 3, rollingSpend: 15000, vendors: ['R', 'S'] }))).toBe(true);
    expect(meetsTier('B', metrics({ paymentHistoryPass: true, rollingOrderCount: 3, rollingSpend: 14999.99, vendors: ['R', 'S'] }))).toBe(false);
    expect(meetsTier('C', metrics({ paymentHistoryPass: true, rollingOrderCount: 2, rollingSpend: 5000, vendors: ['R'] }))).toBe(true);
    expect(meetsTier('C', metrics({ paymentHistoryPass: true, rollingOrderCount: 2, rollingSpend: 4999.99, vendors: ['R'] }))).toBe(false);
  });

  it('returns the highest tier when several qualify', () => {
    const r = determineCustomerTier(metrics({ hasEstablishedCredit: true, rollingOrderCount: 10, rollingSpend: 100000, vendors: ['R', 'S', 'A', 'T'] }));
    expect(r.tier).toBe('A');
    expect(r.tierChecks.B.credit.passed && r.tierChecks.B.orders.passed).toBe(true);
  });

  it('does not force a gap case into D: 1 order, $3,500, 1 vendor, pay-as-you-go -> REVIEW', () => {
    const r = determineCustomerTier(metrics({ paymentHistoryPass: true, rollingOrderCount: 1, rollingSpend: 3500 }));
    expect(r.tier).toBe('REVIEW');
    expect(r.reviewReason).toBe('TIER_GAP');
    expect(r.explanation).toContain('Closest is Tier');
  });

  it('no orders in the rolling window -> REVIEW (no recent orders)', () => {
    const r = determineCustomerTier(metrics({ rollingOrderCount: 0, rollingSpend: 0, qualifyingOrders: [], windowOrders: [] }));
    expect(r.tier).toBe('REVIEW');
    expect(r.reviewReason).toBe('MISSING_DATA');
  });

  it('B/C credit fails when payment history is inconsistent and no terms', () => {
    const r = determineCustomerTier(metrics({ paymentHistoryPass: false, rollingOrderCount: 3, rollingSpend: 20000, vendors: ['R', 'S'] }));
    expect(r.tier).toBe('REVIEW');
    expect(r.tierChecks.B.credit.passed).toBe(false);
  });
});
