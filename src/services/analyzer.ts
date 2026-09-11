/**
 * Pipeline orchestrator. Parsing/normalization happen once per upload; the
 * as-of-date-dependent stages can be re-run cheaply when the date changes.
 */
import type { AnalysisResult, CustomerAnalysis, DataQualityIssue, NormalizedOrder, ParsedWorkbook } from '../types';
import { UNASSIGNED_REP_LABEL } from '../config/salesRepAliases';
import { aggregateCustomers } from './customerAggregator';
import { calculateFallout } from './falloutCalculator';
import { computeNextTierGap } from './nextTierEngine';
import { buildOpportunities } from './opportunityEngine';
import { isQualifyingOrder, normalizeOrders } from './orderNormalizer';
import { customerLevelIssues, sortIssues } from './dataReview';
import { creditPositionLabel, determineCustomerTier } from './tierEngine';

export interface NormalizedWorkbook {
  fileName: string;
  sourceRows: number;
  orders: NormalizedOrder[];
  issues: DataQualityIssue[];
}

export function normalizeWorkbook(parsed: ParsedWorkbook): NormalizedWorkbook {
  const { orders, issues } = normalizeOrders(parsed.rows);
  return { fileName: parsed.fileName, sourceRows: parsed.rows.length, orders, issues: [...parsed.issues, ...issues] };
}

export function analyzeCustomers(orders: NormalizedOrder[], asOf: Date): CustomerAnalysis[] {
  const metrics = aggregateCustomers(orders, asOf);
  return metrics.map((m) => {
    const tier = determineCustomerTier(m);
    const nextTier = computeNextTierGap(m, tier);
    const fallout = calculateFallout(m, tier, asOf);
    return { metrics: m, tier, nextTier, fallout, creditLabel: creditPositionLabel(m) };
  });
}

export function runAnalysis(normalized: NormalizedWorkbook, asOf: Date): AnalysisResult {
  const customers = analyzeCustomers(normalized.orders, asOf);
  const opportunities = buildOpportunities(customers);
  const issues = sortIssues([...normalized.issues, ...customerLevelIssues(customers)]);
  const reps = [...new Set(customers.map((c) => c.metrics.salesRep))].sort((a, b) => {
    if (a === UNASSIGNED_REP_LABEL) return 1;
    if (b === UNASSIGNED_REP_LABEL) return -1;
    return a.localeCompare(b);
  });
  return {
    fileName: normalized.fileName,
    asOfDate: asOf,
    customers,
    opportunities,
    issues,
    totals: {
      sourceRows: normalized.sourceRows,
      normalizedOrders: normalized.orders.length,
      qualifyingOrders: normalized.orders.filter(isQualifyingOrder).length,
      customers: customers.length,
    },
    salesReps: reps,
  };
}
