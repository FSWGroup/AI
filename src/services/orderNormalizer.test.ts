import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeOrders, isQualifyingOrder, classifyRow, parseNetTermsDays } from './orderNormalizer';
import { rawRow, resetRows } from '../test/fixtures';

beforeEach(resetRows);

describe('normalizeOrders', () => {
  it('one order across 3 vendor rows = 1 order, 3 vendors, PRODUCT VALUE 2 total', () => {
    const rows = [
      rawRow({ estimate: '4001-A', productValue: 5000, productValue2: 12000, vendor: 'Richards' }),
      rawRow({ estimate: '4001-B', productValue: 7000, productValue2: null, vendor: 'Spirax Sarco', paymentStatus: '', paymentDate: null, invoiceStatus: '' }),
      rawRow({ estimate: '4001-C', productValue: null, productValue2: null, vendor: 'Apollo', paymentStatus: '', paymentDate: null, invoiceStatus: '' }),
    ];
    const { orders } = normalizeOrders(rows);
    expect(orders).toHaveLength(1);
    expect(orders[0].orderValue).toBe(12000);
    expect(orders[0].vendors).toEqual(['Apollo', 'Richards', 'Spirax Sarco']);
    expect(orders[0].sourceRows).toEqual([2, 3, 4]);
    expect(isQualifyingOrder(orders[0])).toBe(true);
  });

  it('continuation rows with blank company and date inherit the order above', () => {
    const rows = [
      rawRow({ estimate: '5100', bigcOrder: '', productValue: 900, productValue2: 900, vendor: 'Richards' }),
      rawRow({ companyName: '', orderDate: null, estimate: '', productValue: null, productValue2: null, vendor: 'Apollo', vmPo: '7777', paymentStatus: '', paymentDate: null, invoiceStatus: '' }),
    ];
    const { orders } = normalizeOrders(rows);
    expect(orders).toHaveLength(1);
    expect(orders[0].vendors).toEqual(['Apollo', 'Richards']);
    expect(orders[0].orderValue).toBe(900);
  });

  it('50% deposit rows sharing a Customer PO are one order valued at PRODUCT VALUE 2', () => {
    const rows = [
      rawRow({ customerPo: 'PO 55501', estimate: '4655', productValue: 920.92, productValue2: 1841.84 }),
      rawRow({ customerPo: 'PO 55501', estimate: '4787', productValue: 920.92, productValue2: null }),
    ];
    const { orders } = normalizeOrders(rows);
    expect(orders).toHaveLength(1);
    expect(orders[0].orderValue).toBe(1841.84);
  });

  it('same vendor on 5 separate orders = 5 orders, 1 vendor', () => {
    const rows = Array.from({ length: 5 }, (_, i) => rawRow({ estimate: `${6000 + i}`, orderDate: new Date(2026, i, 10), vendor: i % 2 ? 'RICHARDS' : 'Richards ' }));
    const { orders } = normalizeOrders(rows);
    expect(orders).toHaveLength(5);
    const vendors = new Set(orders.flatMap((o) => o.vendors.map((v) => v.toLowerCase())));
    expect(vendors.size).toBe(1);
  });

  it('full refund (negative refund row) -> 0 qualifying orders, $0 spend', () => {
    const rows = [
      rawRow({ bigcOrder: '4491', salesReceipt: '6714', productValue: 685.99, productValue2: 685.99 }),
      rawRow({ bigcOrder: '4491', salesReceipt: '6714', productValue: -685.99, productValue2: -685.99, paymentStatus: 'Refund', paymentDate: null }),
    ];
    const { orders } = normalizeOrders(rows);
    expect(orders).toHaveLength(1);
    expect(isQualifyingOrder(orders[0])).toBe(false);
    expect(orders[0].orderValue).toBe(0);
    expect(orders[0].disqualifyReason).toBe('Fully refunded or cancelled');
  });

  it('single row marked REFUNDED -> not qualifying', () => {
    const { orders } = normalizeOrders([rawRow({ bigcOrder: '5860 REFUND', paymentStatus: 'REFUNDED', productValue: 299.99, productValue2: 315.23 })]);
    expect(orders).toHaveLength(1);
    expect(isQualifyingOrder(orders[0])).toBe(false);
  });

  it('partial refund: $10,000 order with $2,000 refund -> 1 order, $8,000', () => {
    const rows = [
      rawRow({ estimate: '7001', invoice: 'I-9001', productValue: 10000, productValue2: 10000 }),
      rawRow({ estimate: '7001', invoice: 'I-9001', productValue: -2000, productValue2: -2000, paymentStatus: 'Refund', paymentDate: null }),
    ];
    const { orders } = normalizeOrders(rows);
    expect(orders).toHaveLength(1);
    expect(isQualifyingOrder(orders[0])).toBe(true);
    expect(orders[0].orderValue).toBe(8000);
    expect(orders[0].refundAmount).toBe(2000);
  });

  it('refund records never count as additional orders even without a matching sale', () => {
    const { orders, issues } = normalizeOrders([rawRow({ bigcOrder: '9999', productValue: -50, productValue2: -50, paymentStatus: 'Refund' })]);
    expect(orders.filter(isQualifyingOrder)).toHaveLength(0);
    expect(issues.some((i) => i.issueType === 'Refund without matching order')).toBe(true);
  });

  it('cancelled order -> 0 orders, $0 spend', () => {
    const { orders } = normalizeOrders([rawRow({ estimate: '4263', paymentStatus: 'Cancelled', invoiceStatus: 'CANCELED', productValue: 2234.97, productValue2: 2234.97 })]);
    expect(orders.filter(isQualifyingOrder)).toHaveLength(0);
  });

  it('replacement / sample / courtesy rows contribute nothing and never count as orders', () => {
    const rows = [
      rawRow({ bigcOrder: '4789', salesReceipt: '7196', productValue: 1735.92, productValue2: 1735.92, vendor: 'Richards' }),
      rawRow({ companyName: '', orderDate: null, bigcOrder: '', salesReceipt: '', productValue: null, productValue2: null, paymentStatus: 'Replacement', vendor: 'Apollo', paymentDate: null, invoiceStatus: '' }),
      rawRow({ companyName: 'Other Co', estimate: '8888', paymentStatus: 'SAMPLE', invoiceStatus: 'Sample', productValue: 56.99, productValue2: 56.99 }),
      rawRow({ companyName: 'Other Co', estimate: '8889', paymentStatus: 'Courtesy, FREE', productValue: 20, productValue2: 20 }),
    ];
    const { orders } = normalizeOrders(rows);
    const acme = orders.find((o) => o.companyKey === 'acme fabrication')!;
    expect(acme.orderValue).toBe(1735.92);
    // replacement vendor does not count toward mix
    expect(acme.vendors).toEqual(['Richards']);
    expect(orders.filter((o) => o.companyKey === 'other co').every((o) => !isQualifyingOrder(o))).toBe(true);
  });

  it('fraud rows are excluded and flagged', () => {
    const { orders } = normalizeOrders([rawRow({ bigcOrder: '4444', paymentStatus: 'FRAUD!' })]);
    expect(isQualifyingOrder(orders[0])).toBe(false);
    expect(orders[0].hasFraudFlag).toBe(true);
  });

  it('customer normalization: " ABC Manufacturing " and "ABC MANUFACTURING" are the same customer, but "ABC Manufacturing Services" is not', () => {
    const rows = [
      rawRow({ companyName: ' ABC Manufacturing ', estimate: '1' }),
      rawRow({ companyName: 'ABC MANUFACTURING', estimate: '2', orderDate: new Date(2026, 6, 1) }),
      rawRow({ companyName: 'ABC Manufacturing Services', estimate: '3' }),
    ];
    const { orders } = normalizeOrders(rows);
    const keys = new Set(orders.map((o) => o.companyKey));
    expect(keys.size).toBe(2);
    expect(orders.filter((o) => o.companyKey === 'abc manufacturing')).toHaveLength(2);
  });

  it('identifier suffixes like "-A", " REPLACEMENT", "I-8308" are normalized for grouping', () => {
    const rows = [
      rawRow({ bigcOrder: '4521', salesReceipt: '6753-A', productValue: 63.98, productValue2: 63.98 }),
      rawRow({ bigcOrder: '4521', salesReceipt: '6753-B', productValue: null, productValue2: null, vendor: 'RWV', paymentStatus: '', paymentDate: null, invoiceStatus: '' }),
    ];
    const { orders } = normalizeOrders(rows);
    expect(orders).toHaveLength(1);
    expect(orders[0].vendors).toHaveLength(2);
  });

  it('sales rep falls back to ONLINE SUPPORT and applies aliases', () => {
    const { orders } = normalizeOrders([
      rawRow({ territoryManager: 'Online', onlineSupport: 'Cleon Kemp', estimate: '1' }),
      rawRow({ territoryManager: 'Joe', estimate: '2', orderDate: new Date(2026, 2, 2) }),
      rawRow({ territoryManager: 'Online', onlineSupport: '', estimate: '3', orderDate: new Date(2026, 3, 2) }),
    ]);
    expect(orders[0].salesRep).toBe('Cleon Kemp');
    expect(orders[1].salesRep).toBe('Joe Mitchell');
    expect(orders[2].salesRep).toBe('Online / Unassigned');
    expect(orders[2].salesRepAssigned).toBe(false);
  });

  it('a malformed row does not abort the import and produces an issue', () => {
    const { orders, issues } = normalizeOrders([
      rawRow({ estimate: '1' }),
      rawRow({ companyName: 'Broken Co', orderDate: null, orderDateInvalid: true, estimate: '2' }),
    ]);
    expect(orders).toHaveLength(2);
    expect(issues.some((i) => i.issueType === 'Invalid order date')).toBe(true);
    expect(orders.find((o) => o.companyKey === 'broken co')!.qualifying).toBe(false);
  });

  it('parses Net terms variations', () => {
    expect(parseNetTermsDays('Net 30')).toBe(30);
    expect(parseNetTermsDays('NET30')).toBe(30);
    expect(parseNetTermsDays('50% Net30')).toBe(30);
    expect(parseNetTermsDays('Payment Due Net 120')).toBe(120);
    expect(parseNetTermsDays('Credit Card')).toBeNull();
  });

  it('classifies row kinds case-insensitively', () => {
    expect(classifyRow(rawRow({ paymentStatus: 'credit memo' })).kind).toBe('refund');
    expect(classifyRow(rawRow({ paymentStatus: 'Returned for Replacement' })).kind).toBe('replacement');
    expect(classifyRow(rawRow({ paymentStatus: 'Partial Refund' })).kind).toBe('partial');
    expect(classifyRow(rawRow({ paymentStatus: 'Payment Cleared' })).kind).toBe('sale');
    expect(classifyRow(rawRow({ salesReceipt: 'I-9774 CHARGEBACK' })).chargeback).toBe(true);
  });
});
