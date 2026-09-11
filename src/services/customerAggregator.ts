/**
 * Customer aggregation: ONE CustomerMetrics record per normalized company.
 *
 * - Rolling 12-month order count and spend use qualifying orders within the window.
 * - Vendor Mix uses all legitimate (qualifying) purchase history in the tracker.
 * - Sales rep ownership: the salesperson on the customer's most recent qualifying
 *   order that names a person (TERRITORY MANAGER, else ONLINE SUPPORT). If no order
 *   names a person, "Online / Unassigned". Historical rep changes therefore never
 *   split a company into multiple tier records.
 */
import type { CustomerMetrics, NormalizedOrder, OrderPaymentAssessment } from '../types';
import { tierEOverrides } from '../config/accountOverrides';
import { UNASSIGNED_REP_LABEL } from '../config/salesRepAliases';
import { isWithinRange, maxDate, rollingTwelveMonthRange } from '../utils/dates';
import { companyKey, pickDisplayName } from '../utils/normalization';
import { round2 } from '../utils/money';
import { isQualifyingOrder } from './orderNormalizer';
import { assessOrderPayment, detectSeriousDelinquency, evaluatePaymentHistory } from './paymentAnalyzer';

const overrideKeys = new Set(tierEOverrides.map((n) => companyKey(n)));

export interface CreditStatus {
  hasEstablishedCredit: boolean;
  label: string | null;
}

/**
 * Established credit terms: recent/current purchase evidence of Net terms.
 * "Recent" = any qualifying order in the rolling window, or the customer's most recent
 * qualifying order. Consistent pay-as-you-go history does NOT count as established terms.
 */
export function computeCreditStatus(windowOrders: NormalizedOrder[], qualifyingOrders: NormalizedOrder[]): CreditStatus {
  const evidence: NormalizedOrder[] = windowOrders.filter((o) => o.payMethodKind === 'net');
  if (!evidence.length && qualifyingOrders.length) {
    const latest = qualifyingOrders.reduce((a, b) => ((a.orderDate?.getTime() ?? 0) >= (b.orderDate?.getTime() ?? 0) ? a : b));
    if (latest.payMethodKind === 'net') evidence.push(latest);
  }
  if (!evidence.length) return { hasEstablishedCredit: false, label: null };
  // Most common Net term among the evidence; ties -> the most recent.
  const counts = new Map<number, number>();
  for (const o of evidence) counts.set(o.netTermsDays!, (counts.get(o.netTermsDays!) ?? 0) + 1);
  let best = evidence[evidence.length - 1].netTermsDays!;
  let bestCount = -1;
  for (const [days, c] of counts) {
    if (c > bestCount) {
      best = days;
      bestCount = c;
    }
  }
  return { hasEstablishedCredit: true, label: `Net ${best}` };
}

export function computeWindowMetrics(qualifyingOrders: NormalizedOrder[], asOf: Date): { windowOrders: NormalizedOrder[]; spend: number; count: number } {
  const range = rollingTwelveMonthRange(asOf);
  const windowOrders = qualifyingOrders.filter((o) => o.orderDate && isWithinRange(o.orderDate, range));
  let spend = 0;
  for (const o of windowOrders) spend += o.orderValue;
  return { windowOrders, spend: round2(spend), count: windowOrders.length };
}

function pickSalesRep(qualifyingOrders: NormalizedOrder[], allOrders: NormalizedOrder[]): string {
  const byRecency = (list: NormalizedOrder[]) => [...list].sort((a, b) => (b.orderDate?.getTime() ?? 0) - (a.orderDate?.getTime() ?? 0));
  for (const o of byRecency(qualifyingOrders)) if (o.salesRepAssigned) return o.salesRep;
  for (const o of byRecency(allOrders)) if (o.salesRepAssigned) return o.salesRep;
  return UNASSIGNED_REP_LABEL;
}

export function aggregateCustomers(orders: NormalizedOrder[], asOf: Date): CustomerMetrics[] {
  const groups = new Map<string, NormalizedOrder[]>();
  for (const o of orders) {
    const list = groups.get(o.companyKey) ?? [];
    list.push(o);
    groups.set(o.companyKey, list);
  }
  const result: CustomerMetrics[] = [];
  for (const [key, list] of groups) {
    const variants = new Map<string, number>();
    for (const o of list) variants.set(o.company, (variants.get(o.company) ?? 0) + 1);
    const company = pickDisplayName(variants);

    const qualifying = list.filter(isQualifyingOrder).sort((a, b) => a.orderDate!.getTime() - b.orderDate!.getTime());
    const { windowOrders, spend, count } = computeWindowMetrics(qualifying, asOf);

    const vendorMap = new Map<string, string>();
    for (const o of qualifying) for (const v of o.vendors) vendorMap.set(v.toLowerCase(), v);
    const vendors = [...vendorMap.values()].sort((a, b) => a.localeCompare(b));

    const credit = computeCreditStatus(windowOrders, qualifying);
    const assessments: OrderPaymentAssessment[] = qualifying.map((o) => assessOrderPayment(o, asOf));
    const paymentHistory = evaluatePaymentHistory(qualifying, asOf, assessments);
    const delinquency = detectSeriousDelinquency(assessments);

    const hasFraudOrChargeback = list.some((o) => o.hasFraudFlag || o.hasChargebackFlag);
    const requiresUpfrontPayment = list.some((o) => o.hasUpfrontTermsFlag);

    const dataIssues: string[] = [];
    if (qualifying.length === 0) dataIssues.push('No qualifying orders in the tracker');
    if (qualifying.some((o) => o.vendors.length === 0)) dataIssues.push('One or more qualifying orders have no vendor');
    if (assessments.some((a) => a.state === 'contradictory')) dataIssues.push('Contradictory payment data on one or more orders');

    result.push({
      company,
      companyKey: key,
      salesRep: pickSalesRep(qualifying, list),
      rollingSpend: spend,
      rollingOrderCount: count,
      vendorCount: vendors.length,
      vendors,
      hasEstablishedCredit: credit.hasEstablishedCredit,
      creditTermsLabel: credit.label,
      paymentHistory,
      paymentHistoryPass: paymentHistory.passed,
      paymentHistoryExplanation: paymentHistory.explanation,
      has90DayPastDueInvoice: delinquency.flagged,
      seriousDelinquencyExplanation: delinquency.explanation,
      hasFraudOrChargeback,
      requiresUpfrontPayment,
      manualTierEOverride: overrideKeys.has(key),
      lastOrderDate: maxDate(qualifying.map((o) => o.orderDate)),
      windowOrders,
      qualifyingOrders: qualifying,
      normalizedOrders: list,
      paymentAssessments: assessments,
      dataComplete: count > 0 && qualifying.every((o) => o.orderDate != null),
      dataIssues,
    });
  }
  return result.sort((a, b) => a.company.localeCompare(b.company));
}
