import { describe, it, expect } from 'vitest';
import { aggregateCustomers, computeCreditStatus } from './customerAggregator';
import { order, netOrder } from '../test/fixtures';

const asOf = new Date(2026, 8, 10); // 09/10/2026

describe('aggregateCustomers', () => {
  it('rolling window boundary: 09/10/2025 is inside, 09/09/2025 is outside', () => {
    const orders = [
      order({ orderDate: new Date(2025, 8, 10), orderValue: 100 }),
      order({ orderDate: new Date(2025, 8, 9), orderValue: 999 }),
      order({ orderDate: new Date(2026, 8, 10), orderValue: 50 }),
      order({ orderDate: new Date(2026, 8, 11), orderValue: 5000 }), // after as-of
    ];
    const [c] = aggregateCustomers(orders, asOf);
    expect(c.rollingOrderCount).toBe(2);
    expect(c.rollingSpend).toBe(150);
  });

  it('vendor mix uses all legitimate history, not only the window', () => {
    const orders = [order({ orderDate: new Date(2024, 0, 1), vendors: ['Richards'] }), order({ orderDate: new Date(2026, 6, 1), vendors: ['Spirax Sarco', 'Apollo'] })];
    const [c] = aggregateCustomers(orders, asOf);
    expect(c.vendorCount).toBe(3);
    expect(c.rollingOrderCount).toBe(1);
  });

  it('non-qualifying orders do not contribute vendors, spend or orders', () => {
    const orders = [order({ vendors: ['Richards'] }), order({ qualifying: false, orderValue: 0, vendors: ['Bogus Vendor'], disqualifyReason: 'Cancelled' })];
    const [c] = aggregateCustomers(orders, asOf);
    expect(c.vendors).toEqual(['Richards']);
    expect(c.rollingOrderCount).toBe(1);
  });

  it('one record per company and display name prefers mixed case', () => {
    const orders = [order({ company: 'ACME FABRICATION', companyKey: 'acme fabrication' }), order({ company: 'Acme Fabrication', companyKey: 'acme fabrication', orderDate: new Date(2026, 1, 1) })];
    const list = aggregateCustomers(orders, asOf);
    expect(list).toHaveLength(1);
    expect(list[0].company).toBe('Acme Fabrication');
  });

  it('sales rep comes from the most recent qualifying order with an assigned rep', () => {
    const orders = [
      order({ salesRep: 'Joe Mitchell', orderDate: new Date(2025, 10, 1) }),
      order({ salesRep: 'Cleon Kemp', orderDate: new Date(2026, 5, 1) }),
      order({ salesRep: 'Online / Unassigned', salesRepAssigned: false, orderDate: new Date(2026, 7, 1) }),
    ];
    const [c] = aggregateCustomers(orders, asOf);
    expect(c.salesRep).toBe('Cleon Kemp');
  });

  it('last order date uses the most recent qualifying order, not refunds', () => {
    const orders = [order({ orderDate: new Date(2026, 3, 1) }), order({ orderDate: new Date(2026, 7, 1), qualifying: false, orderValue: 0, rowKinds: ['refund'] })];
    const [c] = aggregateCustomers(orders, asOf);
    expect(c.lastOrderDate).toEqual(new Date(2026, 3, 1));
  });

  it('established credit requires Net terms evidence; pay-as-you-go does not count', () => {
    expect(computeCreditStatus([netOrder()], [netOrder()])).toEqual({ hasEstablishedCredit: true, label: 'Net 30' });
    expect(computeCreditStatus([order()], [order()]).hasEstablishedCredit).toBe(false);
    const [c] = aggregateCustomers([netOrder({ paymentMethod: 'Net 60', netTermsDays: 60 })], asOf);
    expect(c.hasEstablishedCredit).toBe(true);
    expect(c.creditTermsLabel).toBe('Net 60');
  });

  it('detects a current 90+ day past due invoice at the customer level', () => {
    const orders = [order(), netOrder({ paymentStatus: 'Payment Overdue', paymentDate: null, invoiceStatus: '', invoiceDueDate: new Date(2026, 0, 1) })];
    const [c] = aggregateCustomers(orders, asOf);
    expect(c.has90DayPastDueInvoice).toBe(true);
  });
});
