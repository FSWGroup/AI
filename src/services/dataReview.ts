/**
 * Data Review: consolidates row-level, order-level and customer-level findings so
 * management can verify questionable cases. Every issue keeps its source rows.
 */
import type { CustomerAnalysis, DataQualityIssue } from '../types';
import { UNASSIGNED_REP_LABEL } from '../config/salesRepAliases';
import { normalizeLoose } from '../utils/normalization';
import { formatMoney } from '../utils/money';

const SEVERITY_ORDER: Record<DataQualityIssue['severity'], number> = { high: 0, medium: 1, low: 2 };

function stripCorporateSuffix(name: string): string {
  return normalizeLoose(name)
    .replace(/\b(incorporated|inc|llc|l l c|ltd|limited|corp|corporation|co|company|lp|l p|dba)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function customerLevelIssues(customers: CustomerAnalysis[]): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];
  for (const c of customers) {
    const m = c.metrics;
    const rows = [...new Set(m.normalizedOrders.flatMap((o) => o.sourceRows))].sort((a, b) => a - b);
    const windowRows = [...new Set(m.windowOrders.flatMap((o) => o.sourceRows))].sort((a, b) => a - b);
    const base = { company: m.company, salesRep: m.salesRep };

    if (c.tier.tier === 'E') {
      issues.push({ id: `tierE-${m.companyKey}`, issueType: 'Tier E account', ...base, sourceRows: rows, explanation: c.tier.explanation, severity: 'high' });
    }
    if (c.tier.tier === 'REVIEW') {
      const reason = c.tier.reviewReason;
      issues.push({
        id: `review-${m.companyKey}`,
        issueType: reason === 'TIER_GAP' ? 'REVIEW: does not fit a documented tier' : reason === 'NO_RECENT_ORDERS' ? 'REVIEW: no orders in rolling window' : 'REVIEW: missing data',
        ...base,
        sourceRows: reason === 'TIER_GAP' ? windowRows : rows,
        explanation:
          reason === 'TIER_GAP'
            ? `${c.tier.explanation} Current: ${m.rollingOrderCount} order(s), ${formatMoney(m.rollingSpend)}, ${m.vendorCount} vendor(s), ${c.creditLabel}.`
            : c.tier.explanation,
        severity: reason === 'MISSING_DATA' ? 'high' : reason === 'TIER_GAP' ? 'medium' : 'low',
      });
    }
    if (m.salesRep === UNASSIGNED_REP_LABEL && c.tier.tier !== 'REVIEW') {
      issues.push({ id: `rep-${m.companyKey}`, issueType: 'Unknown salesperson (customer)', ...base, sourceRows: rows, explanation: 'No order for this customer names a salesperson in TERRITORY MANAGER or ONLINE SUPPORT.', severity: 'low' });
    }
    const contradictory = m.paymentAssessments.filter((a) => a.state === 'contradictory');
    if (contradictory.length) {
      const orderRows = m.qualifyingOrders.filter((o) => contradictory.some((a) => a.orderKey === o.orderKey)).flatMap((o) => o.sourceRows);
      issues.push({ id: `contradict-${m.companyKey}`, issueType: 'Payment data contradictory', ...base, sourceRows: orderRows, explanation: `${contradictory.length} order(s) have PAYMENT STATUS marked unpaid while INVOICE STATUS reads paid. Treated as unknown (not delinquent).`, severity: 'medium' });
    }
    const unknownDue = m.paymentAssessments.filter((a) => a.state === 'unpaid' && !a.dueDate);
    if (unknownDue.length) {
      const orderRows = m.qualifyingOrders.filter((o) => unknownDue.some((a) => a.orderKey === o.orderKey)).flatMap((o) => o.sourceRows);
      issues.push({ id: `nodue-${m.companyKey}`, issueType: 'Unpaid order without due date', ...base, sourceRows: orderRows, explanation: `${unknownDue.length} unpaid order(s) have no INVOICE DUE DATE (and no invoice date + Net terms), so days past due cannot be measured.`, severity: 'medium' });
    }
    if (m.has90DayPastDueInvoice) {
      const rowsHit = m.qualifyingOrders.filter((o) => m.paymentAssessments.some((a) => a.orderKey === o.orderKey && a.seriouslyDelinquent)).flatMap((o) => o.sourceRows);
      issues.push({ id: `90day-${m.companyKey}`, issueType: 'Invoice 90+ days past due', ...base, sourceRows: rowsHit, explanation: m.seriousDelinquencyExplanation ?? '', severity: 'high' });
    }
    const unusualRefund = m.normalizedOrders.filter((o) => o.refundAmount > 0 && o.grossValue > 0 && o.refundAmount > o.grossValue * 0.5 && o.qualifying);
    if (unusualRefund.length) {
      issues.push({ id: `refund-${m.companyKey}`, issueType: 'Unusual refund', ...base, sourceRows: unusualRefund.flatMap((o) => o.sourceRows), explanation: `${unusualRefund.length} order(s) had more than half their value refunded but remain qualifying with the reduced amount.`, severity: 'medium' });
    }
  }

  // Inconsistent company naming: same name once corporate suffixes/punctuation are removed.
  const byLoose = new Map<string, CustomerAnalysis[]>();
  for (const c of customers) {
    const k = stripCorporateSuffix(c.metrics.company);
    if (!k) continue;
    const list = byLoose.get(k) ?? [];
    list.push(c);
    byLoose.set(k, list);
  }
  for (const [, list] of byLoose) {
    if (list.length < 2) continue;
    const names = list.map((c) => `"${c.metrics.company}"`).join(', ');
    issues.push({
      id: `naming-${list[0].metrics.companyKey}`,
      issueType: 'Inconsistent company naming',
      company: list[0].metrics.company,
      salesRep: list[0].metrics.salesRep,
      sourceRows: [...new Set(list.flatMap((c) => c.metrics.normalizedOrders.flatMap((o) => o.sourceRows)))].sort((a, b) => a - b).slice(0, 40),
      explanation: `${names} look like the same customer but are tiered separately. Add an alias in companyAliases.ts to merge them.`,
      severity: 'low',
    });
  }
  return issues;
}

export function sortIssues(issues: DataQualityIssue[]): DataQualityIssue[] {
  return [...issues].sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (s !== 0) return s;
    const t = a.issueType.localeCompare(b.issueType);
    if (t !== 0) return t;
    return (a.sourceRows[0] ?? 0) - (b.sourceRows[0] ?? 0);
  });
}
