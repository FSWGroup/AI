/**
 * Payment / credit analysis.
 *
 * - assessOrderPayment: paid / unpaid / contradictory / unknown per order, plus days past due.
 * - evaluatePaymentHistory: "consistent payment history on all applicable orders" (Tier B/C).
 * - detectSeriousDelinquency: currently unpaid invoices 90+ days past due (Tier E).
 */
import type { NormalizedOrder, OrderPaymentAssessment, PaymentHistoryResult } from '../types';
import { SERIOUS_DELINQUENCY_DAYS } from '../config/tierRules';
import { addDays, daysBetween, isValidDate } from '../utils/dates';

const RE_PAID = /cleared|\bpaid\b|complete|received|processed|settled/i;
const RE_UNPAID = /sent\s*invoice|payment\s*due|overdue|unpaid|past\s*due|for\s*clearing|pending|awaiting|outstanding|not\s*paid/i;
const RE_INVOICE_PAID = /^paid\b/i;
const RE_INVOICE_UNPAID = /overdue|payment\s*due|sent\s*(out\s*)?invoice|unpaid|past\s*due/i;

export function assessOrderPayment(order: NormalizedOrder, asOf: Date): OrderPaymentAssessment {
  const ps = order.paymentStatus || '';
  const is = order.invoiceStatus || '';
  const paidByStatus = RE_PAID.test(ps) && !RE_UNPAID.test(ps);
  const paidByDate = isValidDate(order.paymentDate);
  const invoicePaid = RE_INVOICE_PAID.test(is);
  const unpaidByStatus = RE_UNPAID.test(ps) && !paidByStatus;
  const unpaidByInvoice = RE_INVOICE_UNPAID.test(is);

  let state: OrderPaymentAssessment['state'];
  if (paidByStatus || paidByDate) state = 'paid';
  else if (unpaidByStatus) state = invoicePaid ? 'contradictory' : 'unpaid';
  else if (!ps && unpaidByInvoice) state = 'unpaid';
  else if (!ps && invoicePaid) state = 'paid';
  else state = 'unknown';

  let dueDate: Date | null = isValidDate(order.invoiceDueDate) ? order.invoiceDueDate : null;
  if (!dueDate && order.netTermsDays != null && isValidDate(order.invoiceDate)) {
    dueDate = addDays(order.invoiceDate, order.netTermsDays);
  }
  const daysPastDue = dueDate ? daysBetween(dueDate, asOf) : null;
  const overdue = state === 'unpaid' && daysPastDue != null && daysPastDue > 0;
  const seriouslyDelinquent = overdue && (daysPastDue as number) >= SERIOUS_DELINQUENCY_DAYS;

  let explanation: string;
  switch (state) {
    case 'paid':
      explanation = paidByStatus ? `Paid (${ps})` : `Paid (payment date ${order.paymentDate!.toLocaleDateString('en-US')})`;
      break;
    case 'unpaid':
      explanation = dueDate
        ? daysPastDue! > 0
          ? `Unpaid, ${daysPastDue} days past due (due ${dueDate.toLocaleDateString('en-US')})`
          : `Unpaid, not yet due (due ${dueDate.toLocaleDateString('en-US')})`
        : `Unpaid (${ps || is}), due date unknown`;
      break;
    case 'contradictory':
      explanation = `PAYMENT STATUS "${ps}" conflicts with INVOICE STATUS "${is}"`;
      break;
    default:
      explanation = ps || is ? `Payment state unclear (${ps || is})` : 'No payment information recorded';
  }
  return { orderKey: order.orderKey, state, dueDate, daysPastDue, seriouslyDelinquent, overdue, explanation };
}

/**
 * Consistent payment history on all applicable orders.
 * Applicable = qualifying orders. Orders that are unpaid but not yet due are neutral.
 */
export function evaluatePaymentHistory(orders: NormalizedOrder[], asOf: Date, assessments?: OrderPaymentAssessment[]): PaymentHistoryResult {
  const list = assessments ?? orders.map((o) => assessOrderPayment(o, asOf));
  let paid = 0;
  let open = 0;
  let overdue = 0;
  let serious = 0;
  let unknown = 0;
  for (const a of list) {
    if (a.state === 'paid') paid++;
    else if (a.state === 'unpaid') {
      if (a.seriouslyDelinquent) serious++;
      else if (a.overdue) overdue++;
      else if (a.dueDate) open++;
      else unknown++;
    } else unknown++;
  }
  const applicable = list.length;
  const passed = applicable > 0 && paid > 0 && overdue === 0 && serious === 0;
  let explanation: string;
  if (applicable === 0) explanation = 'No applicable orders.';
  else if (passed) {
    explanation = `${paid}/${applicable} applicable orders paid/cleared with no unresolved delinquency` + (open ? ` (${open} open, not yet due)` : '') + (unknown ? ` (${unknown} with unclear payment data)` : '') + '.';
  } else if (serious > 0) {
    explanation = `${serious} order${serious > 1 ? 's' : ''} unpaid 90+ days past due; ${paid}/${applicable} paid.`;
  } else if (overdue > 0) {
    explanation = `${overdue} order${overdue > 1 ? 's' : ''} currently past due; ${paid}/${applicable} paid.`;
  } else {
    explanation = `No cleared payments recorded (${unknown} of ${applicable} orders have unclear payment data).`;
  }
  return { passed, applicableOrders: applicable, successfullyPaidOrders: paid, openNotYetDueOrders: open, overdueOrders: overdue, seriouslyDelinquentOrders: serious, unknownOrders: unknown, explanation };
}

export function detectSeriousDelinquency(assessments: OrderPaymentAssessment[]): { flagged: boolean; explanation: string | null; orderKeys: string[] } {
  const hits = assessments.filter((a) => a.seriouslyDelinquent);
  if (!hits.length) return { flagged: false, explanation: null, orderKeys: [] };
  const worst = hits.reduce((a, b) => ((a.daysPastDue ?? 0) >= (b.daysPastDue ?? 0) ? a : b));
  return {
    flagged: true,
    explanation: `${hits.length} unpaid invoice${hits.length > 1 ? 's' : ''} ${SERIOUS_DELINQUENCY_DAYS}+ days past due (oldest ${worst.daysPastDue} days, due ${worst.dueDate!.toLocaleDateString('en-US')}).`,
    orderKeys: hits.map((h) => h.orderKey),
  };
}
