/**
 * Shared TypeScript types for the ValveMan Customer Tier Analyzer.
 * Business logic lives in src/services; React components only render these shapes.
 */

export type TierCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'REVIEW';

/** Tiers that can be "held" and that appear in the Customer Tiers table. */
export type RankedTierCode = 'A' | 'B' | 'C' | 'D';

export type Severity = 'high' | 'medium' | 'low';

/** One row of the MAIN worksheet after column mapping and light value coercion. */
export interface RawOrderTrackerRow {
  /** 1-based Excel row number for traceability. */
  rowNumber: number;
  source: string;
  customerType: string;
  typeOfOrder: string;
  orderDate: Date | null;
  /** True when the cell had a value that could not be parsed as a date. */
  orderDateInvalid: boolean;
  companyName: string;
  customerName: string;
  territoryManager: string;
  onlineSupport: string;
  customerPo: string;
  bigcOrder: string;
  salesReceipt: string;
  estimate: string;
  invoice: string;
  productValue: number | null;
  productValue2: number | null;
  paymentStatus: string;
  paymentDate: Date | null;
  modeOfPayment: string;
  notes: string;
  invoiceDate: Date | null;
  invoiceDueDate: Date | null;
  invoiceStatus: string;
  vmPo: string;
  vendor: string;
  /** True when every mapped cell was empty. */
  isEmpty: boolean;
}

export type RowKind = 'sale' | 'partial' | 'refund' | 'replacement' | 'fraud';

/** A logical customer purchase event, possibly spanning several spreadsheet rows. */
export interface NormalizedOrder {
  orderKey: string;
  company: string;
  companyKey: string;
  salesRep: string;
  salesRepAssigned: boolean;
  orderDate: Date | null;
  /** Net qualifying value (gross sale value minus refunds/credits), never negative. */
  orderValue: number;
  grossValue: number;
  refundAmount: number;
  paymentStatus: string;
  paymentDate: Date | null;
  paymentMethod: string;
  notes: string;
  invoiceDate: Date | null;
  invoiceDueDate: Date | null;
  invoiceStatus: string;
  vendors: string[];
  sourceRows: number[];
  orderIdentifiers: string[];
  qualifying: boolean;
  /** Human-readable reason when the order does not qualify. */
  disqualifyReason: string | null;
  /** Row kinds found in the group, for diagnostics. */
  rowKinds: RowKind[];
  hasPartialRefundFlag: boolean;
  hasFraudFlag: boolean;
  hasChargebackFlag: boolean;
  hasUpfrontTermsFlag: boolean;
  /** Established Net terms parsed from payment fields (e.g. 30, 60). */
  netTermsDays: number | null;
  payMethodKind: 'net' | 'payg' | 'unknown';
}

export type PaymentState = 'paid' | 'unpaid' | 'contradictory' | 'unknown';

export interface OrderPaymentAssessment {
  orderKey: string;
  state: PaymentState;
  dueDate: Date | null;
  daysPastDue: number | null;
  seriouslyDelinquent: boolean;
  overdue: boolean;
  explanation: string;
}

export interface PaymentHistoryResult {
  passed: boolean;
  applicableOrders: number;
  successfullyPaidOrders: number;
  openNotYetDueOrders: number;
  overdueOrders: number;
  seriouslyDelinquentOrders: number;
  unknownOrders: number;
  explanation: string;
}

export interface CustomerMetrics {
  company: string;
  companyKey: string;
  salesRep: string;

  rollingSpend: number;
  rollingOrderCount: number;

  vendorCount: number;
  vendors: string[];

  hasEstablishedCredit: boolean;
  /** e.g. "Net 30" when established credit is evidenced. */
  creditTermsLabel: string | null;
  paymentHistory: PaymentHistoryResult;
  paymentHistoryPass: boolean;
  paymentHistoryExplanation: string;

  has90DayPastDueInvoice: boolean;
  seriousDelinquencyExplanation: string | null;
  hasFraudOrChargeback: boolean;
  requiresUpfrontPayment: boolean;
  manualTierEOverride: boolean;

  lastOrderDate: Date | null;
  /** Qualifying orders inside the rolling 12-month window. */
  windowOrders: NormalizedOrder[];
  /** All qualifying orders (any date). */
  qualifyingOrders: NormalizedOrder[];
  /** All normalized orders, including non-qualifying. */
  normalizedOrders: NormalizedOrder[];
  paymentAssessments: OrderPaymentAssessment[];
  /** True when the metrics are trustworthy enough for an opportunity recommendation. */
  dataComplete: boolean;
  dataIssues: string[];
}

export interface TierCriterionResult {
  passed: boolean;
  /** Short human-readable actual value, e.g. "Net 30" or "4 orders". */
  actual: string | number;
  requirement: string | number;
  /** Full sentence for the Customer Tiers table, e.g. "Met — 5 orders / 4 required". */
  display: string;
}

export interface TierReasons {
  credit: TierCriterionResult;
  orders: TierCriterionResult;
  spend: TierCriterionResult;
  vendorMix: TierCriterionResult;
}

export interface TierEvaluation {
  tier: TierCode;
  /** Reasons for the achieved tier (or the nearest evaluated tier for REVIEW). */
  reasons: TierReasons;
  /** For REVIEW/E, why. */
  explanation: string;
  reviewReason: ReviewReason | null;
  eReasons: string[];
  /** Per-tier pass/fail for A-D, useful for detail views. */
  tierChecks: Record<RankedTierCode, TierReasons>;
}

export type ReviewReason =
  | 'NO_RECENT_ORDERS'
  | 'TIER_GAP'
  | 'MISSING_DATA';

export interface NextTierGap {
  currentTier: TierCode;
  nextTier: RankedTierCode | null;
  additionalSpend: number;
  additionalOrders: number;
  additionalVendors: number;
  creditRequirementMet: boolean;
  creditRequirement: string;
  summary: string;
}

export interface Opportunity {
  rank: number;
  company: string;
  companyKey: string;
  salesRep: string;
  currentTier: TierCode;
  nextTier: RankedTierCode;
  rollingSpend: number;
  rollingOrderCount: number;
  vendorCount: number;
  creditLabel: string;
  gap: NextTierGap;
  score: number;
  scoreBreakdown: {
    spendProgress: number;
    orderProgress: number;
    vendorProgress: number;
    creditProgress: number;
    baseScore: number;
    bonus: number;
  };
  lastOrderDate: Date | null;
}

export interface FalloutResult {
  falloutDate: Date | null;
  reason: string;
  /** Days from the analysis date until fall-out, when known. */
  daysUntil: number | null;
  /** True when a determination could not be made (e.g. REVIEW tier). */
  indeterminate: boolean;
}

export interface DataQualityIssue {
  id: string;
  issueType: string;
  company: string;
  salesRep: string;
  sourceRows: number[];
  explanation: string;
  severity: Severity;
}

export interface CustomerAnalysis {
  metrics: CustomerMetrics;
  tier: TierEvaluation;
  nextTier: NextTierGap;
  fallout: FalloutResult;
  creditLabel: string;
}

export interface AnalysisResult {
  fileName: string;
  asOfDate: Date;
  customers: CustomerAnalysis[];
  opportunities: Opportunity[];
  issues: DataQualityIssue[];
  totals: {
    sourceRows: number;
    normalizedOrders: number;
    qualifyingOrders: number;
    customers: number;
  };
  salesReps: string[];
}

export interface ColumnMapping {
  /** Field key -> zero-based column index in the sheet. */
  indexes: Partial<Record<keyof RawOrderTrackerRow, number>>;
  headerRowIndex: number;
  /** Header text as found, by field key. */
  matchedHeaders: Partial<Record<string, string>>;
  missingOptional: string[];
}

export interface ParsedWorkbook {
  fileName: string;
  sheetName: string;
  rows: RawOrderTrackerRow[];
  mapping: ColumnMapping;
  issues: DataQualityIssue[];
}
