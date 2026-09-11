/** Fictional test fixtures. No real customer data. */
import type { CustomerMetrics, NormalizedOrder, RawOrderTrackerRow } from '../types';
import { evaluatePaymentHistory } from '../services/paymentAnalyzer';

let rowCounter = 2;

export function resetRows(): void {
  rowCounter = 2;
}

export function rawRow(overrides: Partial<RawOrderTrackerRow> = {}): RawOrderTrackerRow {
  const row: RawOrderTrackerRow = {
    rowNumber: rowCounter++,
    source: '',
    customerType: '',
    typeOfOrder: 'Offline',
    orderDate: new Date(2026, 5, 15),
    orderDateInvalid: false,
    companyName: 'Acme Fabrication',
    customerName: 'Pat Example',
    territoryManager: 'Joe',
    onlineSupport: '',
    customerPo: '',
    bigcOrder: '',
    salesReceipt: '',
    estimate: '',
    invoice: '',
    productValue: 1000,
    productValue2: 1000,
    paymentStatus: 'Payment Cleared',
    paymentDate: new Date(2026, 5, 15),
    modeOfPayment: 'Credit Card',
    notes: '',
    invoiceDate: null,
    invoiceDueDate: null,
    invoiceStatus: 'Paid with Shipping Fee',
    vmPo: '',
    vendor: 'Richards',
    isEmpty: false,
  };
  return { ...row, ...overrides };
}

export function order(overrides: Partial<NormalizedOrder> = {}): NormalizedOrder {
  const base: NormalizedOrder = {
    orderKey: `k-${Math.random().toString(36).slice(2, 8)}`,
    company: 'Acme Fabrication',
    companyKey: 'acme fabrication',
    salesRep: 'Joe Mitchell',
    salesRepAssigned: true,
    orderDate: new Date(2026, 5, 15),
    orderValue: 1000,
    grossValue: 1000,
    refundAmount: 0,
    paymentStatus: 'Payment Cleared',
    paymentDate: new Date(2026, 5, 15),
    paymentMethod: 'Credit Card',
    notes: '',
    invoiceDate: null,
    invoiceDueDate: null,
    invoiceStatus: 'Paid with Shipping Fee',
    vendors: ['Richards'],
    sourceRows: [2],
    orderIdentifiers: [],
    qualifying: true,
    disqualifyReason: null,
    rowKinds: ['sale'],
    hasPartialRefundFlag: false,
    hasFraudFlag: false,
    hasChargebackFlag: false,
    hasUpfrontTermsFlag: false,
    netTermsDays: null,
    payMethodKind: 'payg',
  };
  return { ...base, ...overrides };
}

export function netOrder(overrides: Partial<NormalizedOrder> = {}): NormalizedOrder {
  return order({ paymentMethod: 'Net 30', netTermsDays: 30, payMethodKind: 'net', paymentStatus: 'Payment Cleared', ...overrides });
}

export interface MetricsInput {
  company?: string;
  salesRep?: string;
  rollingSpend?: number;
  rollingOrderCount?: number;
  vendors?: string[];
  hasEstablishedCredit?: boolean;
  creditTermsLabel?: string | null;
  paymentHistoryPass?: boolean;
  has90DayPastDueInvoice?: boolean;
  hasFraudOrChargeback?: boolean;
  requiresUpfrontPayment?: boolean;
  manualTierEOverride?: boolean;
  lastOrderDate?: Date | null;
  windowOrders?: NormalizedOrder[];
  qualifyingOrders?: NormalizedOrder[];
  dataComplete?: boolean;
}

export function metrics(input: MetricsInput = {}): CustomerMetrics {
  const vendors = input.vendors ?? ['Richards'];
  const windowOrders = input.windowOrders ?? [];
  const qualifyingOrders = input.qualifyingOrders ?? windowOrders;
  const passed = input.paymentHistoryPass ?? true;
  const paymentHistory = qualifyingOrders.length
    ? evaluatePaymentHistory(qualifyingOrders, new Date(2026, 8, 11))
    : { passed, applicableOrders: passed ? 3 : 0, successfullyPaidOrders: passed ? 3 : 0, openNotYetDueOrders: 0, overdueOrders: 0, seriouslyDelinquentOrders: 0, unknownOrders: 0, explanation: passed ? '3/3 paid' : 'No payment history' };
  const ph = input.paymentHistoryPass != null ? { ...paymentHistory, passed: input.paymentHistoryPass } : paymentHistory;
  return {
    company: input.company ?? 'Acme Fabrication',
    companyKey: (input.company ?? 'Acme Fabrication').toLowerCase(),
    salesRep: input.salesRep ?? 'Joe Mitchell',
    rollingSpend: input.rollingSpend ?? 0,
    rollingOrderCount: input.rollingOrderCount ?? 0,
    vendorCount: vendors.length,
    vendors,
    hasEstablishedCredit: input.hasEstablishedCredit ?? false,
    creditTermsLabel: input.creditTermsLabel ?? (input.hasEstablishedCredit ? 'Net 30' : null),
    paymentHistory: ph,
    paymentHistoryPass: ph.passed,
    paymentHistoryExplanation: ph.explanation,
    has90DayPastDueInvoice: input.has90DayPastDueInvoice ?? false,
    seriousDelinquencyExplanation: input.has90DayPastDueInvoice ? 'Unpaid invoice 90+ days past due' : null,
    hasFraudOrChargeback: input.hasFraudOrChargeback ?? false,
    requiresUpfrontPayment: input.requiresUpfrontPayment ?? false,
    manualTierEOverride: input.manualTierEOverride ?? false,
    lastOrderDate: input.lastOrderDate ?? new Date(2026, 6, 21),
    windowOrders,
    qualifyingOrders,
    normalizedOrders: qualifyingOrders,
    paymentAssessments: [],
    dataComplete: input.dataComplete ?? true,
    dataIssues: [],
  };
}
