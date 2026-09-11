/**
 * Logical-order normalization engine.
 *
 * The Order Tracker records ONE customer purchase across SEVERAL spreadsheet rows:
 *   - one row per vendor PO (estimate "3996-A", "3996-B", "3996-C" ...)
 *   - continuation rows with a blank ORDER DATE / COMPANY NAME that only carry vendor data
 *   - 50%-deposit orders split across two rows (PRODUCT VALUE = each half,
 *     PRODUCT VALUE 2 = consolidated total on one row)
 *   - separate negative "Refund" rows that share the original order's identifiers
 *   - replacement / sample / cancelled rows
 *
 * Rows for the same company are linked (union-find) when they share an identifier
 * (BIGC #, Sales Receipt / Sales Order #, Estimate #, Invoice #, VM PO #), when they
 * share a Customer PO # on the same date / adjacent rows, or when a row is an obvious
 * continuation of the row above. Each linked group becomes ONE NormalizedOrder.
 *
 * Value rule (verified against the real tracker):
 *   PRODUCT VALUE 2 is the consolidated customer-order value; PRODUCT VALUE is the
 *   line/vendor-level value. When any row in a group carries PRODUCT VALUE 2, that
 *   value is used and PRODUCT VALUE on the other rows is ignored (except negative
 *   adjustments). Otherwise PRODUCT VALUE is summed.
 */
import type { DataQualityIssue, NormalizedOrder, RawOrderTrackerRow, RowKind } from '../types';
import { cleanText, companyDisplay, companyKey, extractIdentifierBase, normalizeKey, resolveSalesRep, resolveVendors } from '../utils/normalization';
import { isValidDate, sameDay, startOfDay } from '../utils/dates';
import { round2 } from '../utils/money';

// ---------- Status vocabulary (case-insensitive) ----------

const RE_FRAUD = /fraud/i;
const RE_FRAUD_CONFIRMED = /^\s*fraud/i; // "FRAUD!", "Fraudulent" — but not "Checking if Fraud"
const RE_PARTIAL = /partial\s*(refund|return)/i;
const RE_REPLACEMENT = /replacement|sample|courtesy|\bfree\b|no[\s-]?charge|\bn\/c\b|warranty/i;
const RE_REFUND = /refund|credit\s*memo|cancel+ed|\bcancel\b|return|chargeback|charge\s*back|\brma\b|\brga\b/i;
const RE_CHARGEBACK = /chargeback|charge\s*back/i;
const RE_UPFRONT = /100\s*%\s*(up\s*front|upfront|prepay|pre-pay|in\s*advance|down)|\bup\s*front\b|\bupfront\b|prepay|pre-pay|fixed\s*terms|\bcod\b|cash\s*on\s*delivery|payment\s*in\s*advance/i;
const RE_NET_TERMS = /\bnet\s*-?\s*(\d{2,3})\b/i;
const RE_PAYG = /credit\s*card|\bvisa\b|master\s*card|american\s*express|\bamex|\bpaypal\b|\bach\b|\bwire\b|\bcheck\b|checking|\bcash\b|debit|zelle|venmo|e-?check|\bcc\b/i;
const RE_VENDOR_PLACEHOLDER_CANCEL = /^(cancel+ed|deleted\?*)$/i;
const RE_INVOICE_CANCELLED = /cancel/i;

export interface RowClassification {
  kind: RowKind;
  fraudConfirmed: boolean;
  chargeback: boolean;
  partialRefund: boolean;
  upfrontTerms: boolean;
}

export function classifyRow(row: RawOrderTrackerRow): RowClassification {
  const ps = row.paymentStatus;
  const is = row.invoiceStatus;
  const mode = row.modeOfPayment;
  const idText = `${row.bigcOrder} ${row.salesReceipt} ${row.estimate} ${row.invoice}`;
  const allText = `${ps} ${is} ${mode} ${row.notes} ${idText}`;
  const chargeback = RE_CHARGEBACK.test(allText);
  const upfrontTerms = RE_UPFRONT.test(`${ps} ${mode} ${row.notes}`);
  const partialRefund = RE_PARTIAL.test(`${ps} ${is} ${idText}`);

  let kind: RowKind = 'sale';
  if (RE_FRAUD.test(ps)) {
    kind = 'fraud';
  } else if (partialRefund) {
    kind = 'partial';
  } else if (RE_REPLACEMENT.test(ps) || RE_REPLACEMENT.test(is) || /sample/i.test(mode)) {
    kind = 'replacement';
  } else if (RE_REFUND.test(ps) || /credit\s*memo/i.test(mode)) {
    kind = 'refund';
  } else if (RE_INVOICE_CANCELLED.test(is) && RE_VENDOR_PLACEHOLDER_CANCEL.test(row.vendor)) {
    // Cleared payment but the invoice was cancelled AND the vendor cell is a cancel placeholder.
    kind = 'refund';
  }
  return { kind, fraudConfirmed: RE_FRAUD_CONFIRMED.test(ps), chargeback, partialRefund, upfrontTerms };
}

export function parseNetTermsDays(...texts: string[]): number | null {
  for (const t of texts) {
    if (!t) continue;
    const m = RE_NET_TERMS.exec(t);
    if (m) {
      const days = Number(m[1]);
      if (days >= 7 && days <= 180) return days;
    }
  }
  return null;
}

export function isPayAsYouGoMethod(text: string): boolean {
  return RE_PAYG.test(text || '');
}

// ---------- Union-find ----------

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

interface RowMeta {
  index: number;
  row: RawOrderTrackerRow;
  companyKey: string;
  companyDisplay: string;
  effectiveDate: Date | null;
  inheritedCompany: boolean;
  inheritedDate: boolean;
  usedCustomerNameAsCompany: boolean;
  tokens: string[];
  poKey: string | null;
  hasPrimaryId: boolean;
  classification: RowClassification;
}

const PO_STOPLIST = /^(po|p\.o\.|n\/a|na|none|tbd|stock|misc|-+|\?+)$/i;

function poKeyFor(row: RawOrderTrackerRow): string | null {
  let po = normalizeKey(row.customerPo);
  if (!po) return null;
  po = po.replace(/^p\.?o\.?\s*#?\s*:?\s*/i, '').replace(/[#:]/g, '').replace(/\s+/g, ' ').trim();
  if (po.length < 3 || PO_STOPLIST.test(po) || !/\d/.test(po)) return null;
  return po;
}

function tokensFor(row: RawOrderTrackerRow): { tokens: string[]; hasPrimaryId: boolean } {
  const tokens: string[] = [];
  let hasPrimaryId = false;
  const add = (ns: string, raw: string) => {
    const base = extractIdentifierBase(raw);
    if (!base) return;
    if (base.startsWith('I-')) tokens.push(`inv:${base}`);
    else tokens.push(`${ns}:${base}`);
    hasPrimaryId = true;
  };
  add('bigc', row.bigcOrder);
  add('sr', row.salesReceipt);
  add('est', row.estimate);
  add('inv', row.invoice);
  // VM PO # links vendor rows to the same order, but is not a "primary" sale identifier.
  const vm = extractIdentifierBase(row.vmPo);
  if (vm && !vm.startsWith('I-')) tokens.push(`vmpo:${vm}`);
  return { tokens, hasPrimaryId };
}

function buildRowMeta(rows: RawOrderTrackerRow[], issues: DataQualityIssue[]): RowMeta[] {
  const metas: RowMeta[] = [];
  let prev: RowMeta | null = null;
  rows.forEach((row, index) => {
    const classification = classifyRow(row);
    let company = row.companyName;
    let inheritedCompany = false;
    let usedCustomerNameAsCompany = false;
    let effectiveDate = row.orderDate;
    let inheritedDate = false;

    if (!company) {
      if (!row.orderDate && prev) {
        // Blank company + blank date = continuation row of the previous order.
        company = prev.companyDisplay;
        inheritedCompany = true;
        if (!effectiveDate) {
          effectiveDate = prev.effectiveDate;
          inheritedDate = true;
        }
      } else if (row.customerName) {
        company = row.customerName;
        usedCustomerNameAsCompany = true;
      }
    } else if (!effectiveDate && prev && companyKey(prev.companyDisplay) === companyKey(company) && !row.orderDateInvalid) {
      // Same company as the row above, no date: continuation of that order.
      effectiveDate = prev.effectiveDate;
      inheritedDate = true;
    }

    const { tokens, hasPrimaryId } = tokensFor(row);
    const meta: RowMeta = {
      index,
      row,
      companyKey: companyKey(company),
      companyDisplay: companyDisplay(company),
      effectiveDate,
      inheritedCompany,
      inheritedDate,
      usedCustomerNameAsCompany,
      tokens,
      poKey: poKeyFor(row),
      hasPrimaryId,
      classification,
    };

    if (usedCustomerNameAsCompany) {
      issues.push({
        id: `company-fallback-${row.rowNumber}`,
        issueType: 'Missing company name',
        company: meta.companyDisplay,
        salesRep: resolveSalesRep(row.territoryManager, row.onlineSupport).rep,
        sourceRows: [row.rowNumber],
        explanation: `COMPANY NAME is blank; CUSTOMER NAME "${row.customerName}" was used as the customer.`,
        severity: 'medium',
      });
    }
    if (row.orderDateInvalid) {
      issues.push({
        id: `bad-date-${row.rowNumber}`,
        issueType: 'Invalid order date',
        company: meta.companyDisplay,
        salesRep: resolveSalesRep(row.territoryManager, row.onlineSupport).rep,
        sourceRows: [row.rowNumber],
        explanation: 'ORDER DATE could not be parsed as a date.',
        severity: 'high',
      });
    }
    if (row.orderDate && (row.orderDate.getFullYear() < 2015 || row.orderDate.getFullYear() > new Date().getFullYear() + 1)) {
      issues.push({
        id: `odd-date-${row.rowNumber}`,
        issueType: 'Suspicious order date',
        company: meta.companyDisplay,
        salesRep: resolveSalesRep(row.territoryManager, row.onlineSupport).rep,
        sourceRows: [row.rowNumber],
        explanation: `ORDER DATE ${row.orderDate.toLocaleDateString('en-US')} looks like a typo (payment date ${row.paymentDate ? row.paymentDate.toLocaleDateString('en-US') : 'n/a'}). The order is treated as dated ${row.orderDate.toLocaleDateString('en-US')}.`,
        severity: 'medium',
      });
    }
    metas.push(meta);
    prev = meta;
  });
  return metas;
}

function linkRows(metas: RowMeta[]): number[][] {
  const uf = new UnionFind(metas.length);
  // Identifier tokens are namespaced per company so unrelated companies never merge.
  const tokenOwner = new Map<string, number>();
  const poRows = new Map<string, number[]>();

  for (const m of metas) {
    for (const t of m.tokens) {
      const key = `${m.companyKey}|${t}`;
      const owner = tokenOwner.get(key);
      if (owner == null) tokenOwner.set(key, m.index);
      else uf.union(owner, m.index);
    }
    if (m.poKey) {
      const key = `${m.companyKey}|${m.poKey}`;
      const list = poRows.get(key) ?? [];
      list.push(m.index);
      poRows.set(key, list);
    }
  }

  // Customer PO links only when rows are close together or share the order date.
  for (const list of poRows.values()) {
    for (let i = 1; i < list.length; i++) {
      const a = metas[list[i - 1]];
      const b = metas[list[i]];
      if (b.index - a.index <= 4 || sameDay(a.effectiveDate, b.effectiveDate)) uf.union(a.index, b.index);
    }
  }

  // Adjacency / continuation links.
  for (let i = 1; i < metas.length; i++) {
    const cur = metas[i];
    const prev = metas[i - 1];
    if (cur.companyKey !== prev.companyKey) continue;
    if (cur.inheritedCompany || cur.inheritedDate) {
      uf.union(prev.index, cur.index);
      continue;
    }
    if (!sameDay(cur.effectiveDate, prev.effectiveDate)) continue;
    if (!cur.hasPrimaryId) {
      uf.union(prev.index, cur.index);
      continue;
    }
    // Split orders: the row above carries no positive value (e.g. PRODUCT VALUE 2 = 0 on the
    // deposit row) or the current row carries the value but no vendor while the row above has one.
    const prevValue = prev.row.productValue2 ?? prev.row.productValue ?? 0;
    const curValue = cur.row.productValue2 ?? cur.row.productValue ?? 0;
    const prevIsSale = prev.classification.kind === 'sale';
    const curIsSale = cur.classification.kind === 'sale';
    if (prevIsSale && curIsSale && ((prevValue <= 0 && curValue > 0) || (curValue > 0 && !cur.row.vendor && !!prev.row.vendor))) {
      uf.union(prev.index, cur.index);
    }
  }

  const groups = new Map<number, number[]>();
  for (const m of metas) {
    const root = uf.find(m.index);
    const g = groups.get(root) ?? [];
    g.push(m.index);
    groups.set(root, g);
  }
  return [...groups.values()].sort((a, b) => a[0] - b[0]);
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function buildOrder(group: RowMeta[], issues: DataQualityIssue[]): NormalizedOrder {
  const rows = group.map((g) => g.row);
  const sourceRows = rows.map((r) => r.rowNumber);
  const saleRows = group.filter((g) => g.classification.kind === 'sale' || g.classification.kind === 'partial');
  const primary =
    saleRows.find((g) => g.row.productValue2 != null && g.row.productValue2 > 0) ??
    saleRows[0] ??
    group[0];

  const companyKeyValue = primary.companyKey;
  const company = primary.companyDisplay;
  const repRes = resolveSalesRep(primary.row.territoryManager, primary.row.onlineSupport);
  let rep = repRes;
  if (!rep.assigned) {
    for (const g of group) {
      const r = resolveSalesRep(g.row.territoryManager, g.row.onlineSupport);
      if (r.assigned) {
        rep = r;
        break;
      }
    }
  }

  const orderDate =
    primary.effectiveDate ??
    saleRows.map((g) => g.effectiveDate).find((d) => d != null) ??
    group.map((g) => g.effectiveDate).find((d) => d != null) ??
    null;

  const groupHasPV2 = group.some((g) => g.row.productValue2 != null);

  // ---- Value computation ----
  let gross = 0;
  let net = 0;
  const seenSaleValues = new Set<string>();
  let duplicateRows: number[] = [];
  let positivePv2Rows = 0;
  for (const g of group) {
    const r = g.row;
    const kind = g.classification.kind;
    let v: number;
    if (r.productValue2 != null) v = r.productValue2;
    else if (groupHasPV2) v = r.productValue != null && r.productValue < 0 ? r.productValue : (kind === 'refund' && r.productValue != null ? r.productValue : 0);
    else v = r.productValue ?? 0;

    if (kind === 'sale' || kind === 'partial') {
      if (v > 0 && r.productValue2 != null) positivePv2Rows++;
      // Exact duplicate rows (same value + same invoice/receipt) are counted once.
      const invBase = extractIdentifierBase(r.invoice) ?? extractIdentifierBase(r.salesReceipt) ?? '';
      const dupKey = v > 0 && invBase ? `${v}|${invBase}` : '';
      if (dupKey && seenSaleValues.has(dupKey)) {
        duplicateRows.push(r.rowNumber);
        continue;
      }
      if (dupKey) seenSaleValues.add(dupKey);
      if (v > 0) gross += v;
      net += v;
    } else if (kind === 'refund') {
      net -= Math.abs(v);
    } else {
      // replacement / sample / fraud rows never add or remove value
    }
  }
  net = round2(net);
  gross = round2(gross);
  const orderValue = Math.max(net, 0);
  const refundAmount = round2(Math.max(gross - orderValue, 0));

  // ---- Vendors (legitimate sale rows only) ----
  const vendorMap = new Map<string, string>();
  for (const g of saleRows) {
    for (const v of resolveVendors(g.row.vendor)) {
      if (!vendorMap.has(v.key)) vendorMap.set(v.key, v.display);
    }
  }
  const vendors = [...vendorMap.values()].sort((a, b) => a.localeCompare(b));

  // ---- Payment fields ----
  const firstNonEmpty = <T>(pick: (r: RawOrderTrackerRow) => T | null | undefined | ''): T | null => {
    for (const g of saleRows.length ? saleRows : group) {
      const v = pick(g.row);
      if (v != null && v !== '') return v as T;
    }
    return null;
  };
  const paymentStatus = cleanText(primary.row.paymentStatus) || firstNonEmpty((r) => r.paymentStatus) || '';
  const paymentDate = firstNonEmpty<Date>((r) => (isValidDate(r.paymentDate) ? r.paymentDate : null));
  const paymentMethod = firstNonEmpty<string>((r) => r.modeOfPayment) || '';
  const invoiceDate = firstNonEmpty<Date>((r) => r.invoiceDate);
  const invoiceDueDate = firstNonEmpty<Date>((r) => r.invoiceDueDate);
  const invoiceStatus = cleanText(primary.row.invoiceStatus) || firstNonEmpty((r) => r.invoiceStatus) || '';
  const notes = group.map((g) => g.row.notes).filter(Boolean).join(' | ');

  const netTermsDays = parseNetTermsDays(paymentMethod, paymentStatus, invoiceStatus, notes, ...saleRows.map((g) => g.row.modeOfPayment));
  const payMethodKind: NormalizedOrder['payMethodKind'] = netTermsDays != null ? 'net' : isPayAsYouGoMethod(paymentMethod) || saleRows.some((g) => isPayAsYouGoMethod(g.row.modeOfPayment)) ? 'payg' : 'unknown';

  const rowKinds = [...new Set(group.map((g) => g.classification.kind))];
  const hasFraudFlag = group.some((g) => g.classification.fraudConfirmed);
  const hasChargebackFlag = group.some((g) => g.classification.chargeback);
  const hasPartialRefundFlag = group.some((g) => g.classification.partialRefund);
  const hasUpfrontTermsFlag = group.some((g) => g.classification.upfrontTerms);

  const identifiers = [
    ...new Set(
      group.flatMap((g) => [g.row.bigcOrder && `BIGC ${g.row.bigcOrder}`, g.row.salesReceipt && `SR/SO ${g.row.salesReceipt}`, g.row.estimate && `Est ${g.row.estimate}`, g.row.invoice && `Inv ${g.row.invoice}`, g.row.customerPo && `PO ${g.row.customerPo}`].filter(Boolean) as string[]),
    ),
  ];

  // ---- Qualification ----
  let qualifying = true;
  let disqualifyReason: string | null = null;
  const hasSaleRow = saleRows.length > 0;
  if (group.some((g) => g.classification.kind === 'fraud') && !hasSaleRow) {
    qualifying = false;
    disqualifyReason = 'Flagged as fraud';
  } else if (hasFraudFlag) {
    qualifying = false;
    disqualifyReason = 'Flagged as fraud';
  } else if (!hasSaleRow) {
    qualifying = false;
    disqualifyReason = rowKinds.includes('refund') ? 'Refund / cancellation / return record' : 'Replacement, sample or no-charge record';
  } else if (!orderDate) {
    qualifying = false;
    disqualifyReason = 'Missing order date';
  } else if (net <= 0.005) {
    qualifying = false;
    disqualifyReason = gross > 0 ? 'Fully refunded or cancelled' : 'No order value recorded';
  }

  const order: NormalizedOrder = {
    orderKey: `${companyKeyValue}|r${sourceRows[0]}`,
    company,
    companyKey: companyKeyValue,
    salesRep: rep.rep,
    salesRepAssigned: rep.assigned,
    orderDate: orderDate ? startOfDay(orderDate) : null,
    orderValue,
    grossValue: gross,
    refundAmount,
    paymentStatus,
    paymentDate,
    paymentMethod,
    notes,
    invoiceDate,
    invoiceDueDate,
    invoiceStatus,
    vendors,
    sourceRows,
    orderIdentifiers: identifiers,
    qualifying,
    disqualifyReason,
    rowKinds,
    hasPartialRefundFlag,
    hasFraudFlag,
    hasChargebackFlag,
    hasUpfrontTermsFlag,
    netTermsDays,
    payMethodKind,
  };

  // ---- Diagnostics ----
  const rowsLabel = sourceRows.length === 1 ? `Row ${sourceRows[0]}` : `Rows ${sourceRows[0]}-${sourceRows[sourceRows.length - 1]}`;
  const push = (issueType: string, explanation: string, severity: DataQualityIssue['severity']) =>
    issues.push({ id: `${issueType}-${sourceRows[0]}`, issueType, company, salesRep: rep.rep, sourceRows, explanation, severity });

  if (duplicateRows.length) {
    push('Possible duplicate order row', `${rowsLabel}: rows ${duplicateRows.join(', ')} repeat the same value and invoice/receipt number and were counted once.`, 'medium');
  }
  if (positivePv2Rows > 1) {
    push('Multiple consolidated values in one order', `${rowsLabel} were grouped as one order but ${positivePv2Rows} rows carry a PRODUCT VALUE 2. Their values were added (${money(gross)}).`, 'low');
  }
  if (!hasSaleRow && rowKinds.includes('refund')) {
    push('Refund without matching order', `${rowsLabel}: refund/cancellation record with no matching sale in this tracker. It was excluded from order counts and spend.`, 'medium');
  }
  if (qualifying && refundAmount > 0) {
    push('Partial refund applied', `${rowsLabel}: ${money(refundAmount)} of refunds/credits were deducted; qualifying spend is ${money(orderValue)}.`, 'low');
  }
  if (hasPartialRefundFlag && refundAmount === 0 && qualifying) {
    push('Partial refund amount unknown', `${rowsLabel} is marked as a partial refund/return but no refund amount is recorded; the full value ${money(orderValue)} was counted.`, 'medium');
  }
  if (hasSaleRow && !orderDate) {
    push('Missing order date', `${rowsLabel}: no ORDER DATE could be determined, so the order is excluded.`, 'high');
  }
  if (hasSaleRow && gross === 0 && net === 0 && orderDate) {
    push('Missing order value', `${rowsLabel}: no PRODUCT VALUE / PRODUCT VALUE 2 recorded, so the order is excluded.`, 'medium');
  }
  if (qualifying && vendors.length === 0) {
    push('Missing vendor', `${rowsLabel}: qualifying order has no usable VENDOR value, so it does not contribute to Vendor Mix.`, 'medium');
  }
  const explicitDates = [...new Set(group.filter((g) => g.row.orderDate).map((g) => startOfDay(g.row.orderDate!).getTime()))];
  if (explicitDates.length > 1) {
    push('Ambiguous order grouping', `${rowsLabel} share order identifiers but carry different ORDER DATEs; they were treated as one order dated ${orderDate ? orderDate.toLocaleDateString('en-US') : 'n/a'}.`, 'medium');
  }
  if (qualifying && RE_INVOICE_CANCELLED.test(invoiceStatus) && !rowKinds.includes('refund')) {
    push('Contradictory invoice data', `${rowsLabel}: INVOICE STATUS says cancelled while PAYMENT STATUS is "${paymentStatus}". The order was kept as qualifying (${money(orderValue)}).`, 'medium');
  }
  if (group.some((g) => g.classification.kind === 'fraud' && !g.classification.fraudConfirmed)) {
    push('Possible fraud under review', `${rowsLabel}: PAYMENT STATUS indicates a fraud check is in progress.`, 'high');
  }
  if (hasChargebackFlag) {
    push('Chargeback recorded', `${rowsLabel}: a chargeback is recorded on this order.`, 'high');
  }
  return order;
}

export interface NormalizationResult {
  orders: NormalizedOrder[];
  issues: DataQualityIssue[];
}

/** Groups raw rows into logical orders. */
export function normalizeOrders(rows: RawOrderTrackerRow[]): NormalizationResult {
  const issues: DataQualityIssue[] = [];
  const metas = buildRowMeta(rows, issues);
  const groups = linkRows(metas);
  const orders: NormalizedOrder[] = [];
  for (const g of groups) {
    const groupMetas = g.map((i) => metas[i]);
    try {
      orders.push(buildOrder(groupMetas, issues));
    } catch (err) {
      const rowNumbers = groupMetas.map((m) => m.row.rowNumber);
      console.warn('[orderNormalizer] Failed to build order for rows', rowNumbers, err instanceof Error ? err.message : err);
      issues.push({
        id: `build-failed-${rowNumbers[0]}`,
        issueType: 'Unreadable order',
        company: groupMetas[0].companyDisplay,
        salesRep: '',
        sourceRows: rowNumbers,
        explanation: 'These rows could not be normalized into an order and were skipped.',
        severity: 'high',
      });
    }
  }
  return { orders, issues };
}

/** Centralized qualifying-order rule used by every downstream calculation. */
export function isQualifyingOrder(order: NormalizedOrder): boolean {
  return order.qualifying && order.orderDate != null && order.orderValue > 0;
}
