import { describe, it, expect } from 'vitest';
import { assessOrderPayment, evaluatePaymentHistory, detectSeriousDelinquency } from './paymentAnalyzer';
import { order, netOrder } from '../test/fixtures';

const asOf = new Date(2026, 8, 11); // 09/11/2026

describe('assessOrderPayment', () => {
  it('unpaid 89 days past due does not trigger the 90-day condition', () => {
    const o = netOrder({ paymentStatus: 'Sent Invoice', paymentDate: null, invoiceStatus: 'Payment Due Net30', invoiceDueDate: new Date(2026, 5, 14) });
    const a = assessOrderPayment(o, asOf);
    expect(a.state).toBe('unpaid');
    expect(a.daysPastDue).toBe(89);
    expect(a.seriouslyDelinquent).toBe(false);
    expect(a.overdue).toBe(true);
  });

  it('unpaid exactly 90 days past due triggers E', () => {
    const o = netOrder({ paymentStatus: 'Sent Invoice', paymentDate: null, invoiceStatus: 'Payment Due Net30', invoiceDueDate: new Date(2026, 5, 13) });
    const a = assessOrderPayment(o, asOf);
    expect(a.daysPastDue).toBe(90);
    expect(a.seriouslyDelinquent).toBe(true);
    expect(detectSeriousDelinquency([a]).flagged).toBe(true);
  });

  it('a late but paid invoice is not currently delinquent', () => {
    const o = netOrder({ paymentStatus: 'Payment Cleared', paymentDate: new Date(2026, 4, 1), invoiceStatus: 'Payment Overdue', invoiceDueDate: new Date(2025, 9, 1) });
    const a = assessOrderPayment(o, asOf);
    expect(a.state).toBe('paid');
    expect(a.seriouslyDelinquent).toBe(false);
  });

  it('derives the due date from invoice date + Net terms when no due date is present', () => {
    const o = netOrder({ paymentStatus: 'Payment Due Net30', paymentDate: null, invoiceStatus: '', invoiceDate: new Date(2026, 0, 1), invoiceDueDate: null });
    const a = assessOrderPayment(o, asOf);
    expect(a.dueDate).toEqual(new Date(2026, 0, 31));
    expect(a.seriouslyDelinquent).toBe(true);
  });

  it('flags contradictory payment data instead of treating it as delinquent', () => {
    const o = netOrder({ paymentStatus: 'Payment Due Net30', paymentDate: null, invoiceStatus: 'Paid w/o Shipping Fee', invoiceDueDate: new Date(2025, 0, 1) });
    const a = assessOrderPayment(o, asOf);
    expect(a.state).toBe('contradictory');
    expect(a.seriouslyDelinquent).toBe(false);
  });
});

describe('evaluatePaymentHistory', () => {
  it('returns structured results with an explanation', () => {
    const orders = Array.from({ length: 6 }, () => order());
    const r = evaluatePaymentHistory(orders, asOf);
    expect(r.passed).toBe(true);
    expect(r.applicableOrders).toBe(6);
    expect(r.successfullyPaidOrders).toBe(6);
    expect(r.overdueOrders).toBe(0);
    expect(r.explanation).toBe('6/6 applicable orders paid/cleared with no unresolved delinquency.');
  });

  it('fails when an order is currently past due; open not-yet-due orders are neutral', () => {
    const overdue = netOrder({ paymentStatus: 'Sent Invoice', paymentDate: null, invoiceStatus: '', invoiceDueDate: new Date(2026, 7, 1) });
    const open = netOrder({ paymentStatus: 'Sent Invoice', paymentDate: null, invoiceStatus: '', invoiceDueDate: new Date(2026, 9, 1) });
    expect(evaluatePaymentHistory([order(), overdue], asOf).passed).toBe(false);
    const r = evaluatePaymentHistory([order(), open], asOf);
    expect(r.passed).toBe(true);
    expect(r.openNotYetDueOrders).toBe(1);
  });

  it('pay-as-you-go cleared payments count as positive evidence', () => {
    const r = evaluatePaymentHistory([order({ paymentMethod: 'PayPal' }), order({ paymentMethod: 'Visa' })], asOf);
    expect(r.passed).toBe(true);
  });
});
