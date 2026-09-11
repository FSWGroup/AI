import { describe, it, expect } from 'vitest';
import { calculateFallout } from './falloutCalculator';
import { aggregateCustomers } from './customerAggregator';
import { determineCustomerTier } from './tierEngine';
import { netOrder, order } from '../test/fixtures';
import { formatDate } from '../utils/dates';

describe('calculateFallout', () => {
  const asOf = new Date(2026, 8, 10);

  it('A customer falls out when the oldest order exits the window (spec example)', () => {
    const orders = [
      netOrder({ orderDate: new Date(2025, 8, 20), orderValue: 14000, vendors: ['R'] }),
      netOrder({ orderDate: new Date(2026, 0, 10), orderValue: 9000, vendors: ['S'] }),
      netOrder({ orderDate: new Date(2026, 2, 15), orderValue: 9000, vendors: ['A'] }),
      netOrder({ orderDate: new Date(2026, 6, 22), orderValue: 9000, vendors: ['R'] }),
    ];
    const [m] = aggregateCustomers(orders, asOf);
    const tier = determineCustomerTier(m);
    expect(tier.tier).toBe('A');
    const f = calculateFallout(m, tier, asOf);
    expect(formatDate(f.falloutDate)).toBe('09/21/2026');
    expect(f.reason).toContain('Order count drops from 4 to 3');
    expect(f.reason).toContain('Rolling spend falls from $41,000.00 to $27,000.00');
    expect(f.daysUntil).toBe(11);
  });

  it('is NOT simply oldest order + 12 months: tier holds while requirements still met', () => {
    // 6 orders; losing the oldest two still leaves 4 orders / $30k+.
    const orders = [
      netOrder({ orderDate: new Date(2025, 9, 1), orderValue: 1000, vendors: ['R'] }),
      netOrder({ orderDate: new Date(2025, 10, 1), orderValue: 1000, vendors: ['S'] }),
      netOrder({ orderDate: new Date(2026, 0, 1), orderValue: 10000, vendors: ['A'] }),
      netOrder({ orderDate: new Date(2026, 1, 1), orderValue: 10000, vendors: ['R'] }),
      netOrder({ orderDate: new Date(2026, 2, 1), orderValue: 10000, vendors: ['R'] }),
      netOrder({ orderDate: new Date(2026, 3, 1), orderValue: 10000, vendors: ['R'] }),
    ];
    const [m] = aggregateCustomers(orders, asOf);
    const tier = determineCustomerTier(m);
    expect(tier.tier).toBe('A');
    const f = calculateFallout(m, tier, asOf);
    // Oldest + 12m + 1d would be 10/02/2026; the actual fall-out is when the 4th-newest order leaves: 01/02/2027.
    expect(formatDate(f.falloutDate)).toBe('01/02/2027');
    expect(f.reason).toContain('Order count drops from 4 to 3');
  });

  it('D customer falls out when its single order leaves the window', () => {
    const orders = [order({ orderDate: new Date(2026, 1, 14), orderValue: 250 })];
    const [m] = aggregateCustomers(orders, asOf);
    const tier = determineCustomerTier(m);
    expect(tier.tier).toBe('D');
    const f = calculateFallout(m, tier, asOf);
    expect(formatDate(f.falloutDate)).toBe('02/15/2027');
    expect(f.reason).toContain('Order count drops from 1 to 0');
  });

  it('vendor mix does not decay in the simulation', () => {
    const orders = [
      netOrder({ orderDate: new Date(2025, 9, 1), orderValue: 100, vendors: ['R', 'S', 'A'] }),
      netOrder({ orderDate: new Date(2026, 0, 1), orderValue: 20000, vendors: ['R'] }),
      netOrder({ orderDate: new Date(2026, 1, 1), orderValue: 20000, vendors: ['R'] }),
      netOrder({ orderDate: new Date(2026, 2, 1), orderValue: 20000, vendors: ['R'] }),
    ];
    const [m] = aggregateCustomers(orders, asOf);
    const tier = determineCustomerTier(m);
    expect(tier.tier).toBe('A');
    const f = calculateFallout(m, tier, asOf);
    expect(f.reason).not.toContain('Vendor mix');
    expect(f.reason).toContain('Order count drops from 4 to 3');
  });

  it('REVIEW and E are indeterminate', () => {
    const [m] = aggregateCustomers([order({ orderValue: 3500 })], asOf);
    const tier = determineCustomerTier(m);
    expect(tier.tier).toBe('REVIEW');
    expect(calculateFallout(m, tier, asOf).indeterminate).toBe(true);
  });
});
