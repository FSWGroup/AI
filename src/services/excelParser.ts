/**
 * Excel import layer.
 *
 * - Detects the MAIN worksheet (case-insensitive), with a fallback to the sheet whose
 *   headers best match the Order Tracker layout.
 * - Locates the header row by scanning the first rows for known column names.
 * - Maps columns by NORMALIZED HEADER NAME, never by fixed Excel column letters.
 * - Coerces cell values (dates, money) tolerantly; a malformed row never aborts the import.
 *
 * Everything runs in the browser. Nothing is transmitted anywhere.
 */
import * as XLSX from 'xlsx';
import type { ColumnMapping, DataQualityIssue, ParsedWorkbook, RawOrderTrackerRow } from '../types';
import { normalizeHeader, cleanText } from '../utils/normalization';
import { parseCellDate } from '../utils/dates';
import { parseMoney } from '../utils/money';

type FieldKey = Exclude<keyof RawOrderTrackerRow, 'rowNumber' | 'isEmpty' | 'orderDateInvalid'>;

interface ColumnDefinition {
  key: FieldKey;
  /** Normalized header candidates (see normalizeHeader). First match wins. */
  candidates: string[];
  required: boolean;
  /** Label used in user-facing error messages. */
  label: string;
}

export const COLUMN_DEFINITIONS: ColumnDefinition[] = [
  { key: 'source', candidates: ['source', 'lead source'], required: false, label: 'SOURCE' },
  { key: 'customerType', candidates: ['customer type'], required: false, label: 'CUSTOMER TYPE' },
  { key: 'typeOfOrder', candidates: ['type of order', 'order type'], required: false, label: 'TYPE OF ORDER' },
  { key: 'orderDate', candidates: ['order date', 'date of order'], required: true, label: 'ORDER DATE' },
  { key: 'companyName', candidates: ['company name', 'company'], required: true, label: 'COMPANY NAME' },
  { key: 'customerName', candidates: ['customer name', 'customer'], required: false, label: 'CUSTOMER NAME' },
  { key: 'territoryManager', candidates: ['territory manager', 'territory mgr', 'sales rep', 'salesperson'], required: true, label: 'TERRITORY MANAGER' },
  { key: 'onlineSupport', candidates: ['online support'], required: false, label: 'ONLINE SUPPORT' },
  { key: 'customerPo', candidates: ['customer po', 'customer po number', 'customer s po', 'customers po', 'customer purchase order'], required: false, label: 'Customer PO #' },
  { key: 'bigcOrder', candidates: ['bigc order', 'bigc order number', 'bigcommerce', 'bigcommerce order', 'bigc'], required: false, label: 'BIGC Order #' },
  { key: 'salesReceipt', candidates: ['qb sales receipt sales order', 'sales receipt sales order', 'qb sales receipt', 'sales receipt', 'sales receipt order', 'sales order'], required: false, label: 'QB Sales Receipt # / Sales Order #' },
  { key: 'estimate', candidates: ['qb estimate', 'estimate'], required: false, label: 'QB Estimate #' },
  { key: 'invoice', candidates: ['qb invoice', 'invoice'], required: false, label: 'QB Invoice #' },
  { key: 'productValue', candidates: ['product value'], required: true, label: 'PRODUCT VALUE' },
  { key: 'productValue2', candidates: ['product value 2', 'product value2', 'total product value'], required: false, label: 'PRODUCT VALUE 2' },
  { key: 'paymentStatus', candidates: ['payment status'], required: false, label: 'PAYMENT STATUS' },
  { key: 'paymentDate', candidates: ['payment date'], required: false, label: 'PAYMENT DATE' },
  { key: 'modeOfPayment', candidates: ['mode of payment', 'payment method', 'payment mode', 'payment terms'], required: false, label: 'MODE OF PAYMENT' },
  { key: 'notes', candidates: ['notes', 'note'], required: false, label: 'NOTES' },
  { key: 'invoiceDate', candidates: ['invoice date'], required: false, label: 'INVOICE DATE' },
  { key: 'invoiceDueDate', candidates: ['invoice due date', 'due date'], required: false, label: 'INVOICE DUE DATE' },
  { key: 'invoiceStatus', candidates: ['invoice status'], required: false, label: 'INVOICE STATUS' },
  { key: 'vmPo', candidates: ['vm po', 'vm po number'], required: false, label: 'VM PO #' },
  { key: 'vendor', candidates: ['vendor', 'vendor 1', 'vendor name'], required: false, label: 'VENDOR' },
];

/** VENDOR is required for Product Purchase Mix; called out separately so the message is explicit. */
const REQUIRED_FOR_ANALYSIS: FieldKey[] = ['orderDate', 'companyName', 'territoryManager', 'productValue', 'vendor'];

export class WorkbookImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbookImportError';
  }
}

const PREFERRED_SHEET = 'main';
const HEADER_SCAN_ROWS = 15;

type Cell = string | number | boolean | Date | null;
type SheetRows = Cell[][];

function sheetToRows(sheet: XLSX.WorkSheet): SheetRows {
  return XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true });
}

/** Attempts to map columns for a candidate header row. */
function mapHeaderRow(headerCells: Cell[]): { indexes: Partial<Record<FieldKey, number>>; matched: Partial<Record<string, string>>; score: number } {
  const normalized = headerCells.map((c) => normalizeHeader(c));
  const indexes: Partial<Record<FieldKey, number>> = {};
  const matched: Partial<Record<string, string>> = {};
  const used = new Set<number>();
  for (const def of COLUMN_DEFINITIONS) {
    outer: for (const candidate of def.candidates) {
      for (let i = 0; i < normalized.length; i++) {
        if (used.has(i)) continue;
        if (normalized[i] && normalized[i] === candidate) {
          indexes[def.key] = i;
          matched[def.key] = cleanText(headerCells[i]);
          used.add(i);
          break outer;
        }
      }
    }
  }
  return { indexes, matched, score: Object.keys(indexes).length };
}

export function detectHeaderRow(rows: SheetRows): { headerRowIndex: number; mapping: ReturnType<typeof mapHeaderRow> } | null {
  let best: { headerRowIndex: number; mapping: ReturnType<typeof mapHeaderRow> } | null = null;
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
  for (let r = 0; r < limit; r++) {
    const row = rows[r];
    if (!row || row.every((c) => c == null || c === '')) continue;
    const mapping = mapHeaderRow(row);
    if (mapping.score >= 4 && (!best || mapping.score > best.mapping.score)) {
      best = { headerRowIndex: r, mapping };
    }
  }
  return best;
}

/** Garbage input can still yield a one-cell "sheet"; require a minimum amount of content. */
function looksLikeSpreadsheet(workbook: XLSX.WorkBook): boolean {
  let cells = 0;
  for (const name of workbook.SheetNames) {
    const ref = workbook.Sheets[name]?.['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    cells += (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
    if (cells >= 4) return true;
  }
  return false;
}

function pickSheet(workbook: XLSX.WorkBook): { name: string; rows: SheetRows } {
  const exact = workbook.SheetNames.find((n) => normalizeHeader(n) === PREFERRED_SHEET);
  if (exact) return { name: exact, rows: sheetToRows(workbook.Sheets[exact]) };
  // Fallback: the sheet whose header best matches the tracker layout.
  let best: { name: string; rows: SheetRows; score: number } | null = null;
  for (const name of workbook.SheetNames) {
    const rows = sheetToRows(workbook.Sheets[name]);
    const detected = detectHeaderRow(rows);
    if (detected && detected.mapping.score >= 8 && (!best || detected.mapping.score > best.score)) {
      best = { name, rows, score: detected.mapping.score };
    }
  }
  if (!best) {
    throw new WorkbookImportError('This workbook does not contain a worksheet named MAIN.');
  }
  return { name: best.name, rows: best.rows };
}

function str(cell: Cell): string {
  if (cell == null) return '';
  if (cell instanceof Date) return '';
  return cleanText(cell);
}

function idStr(cell: Cell): string {
  // Identifier cells are sometimes numeric (e.g. 4491) or dates by accident.
  if (cell == null) return '';
  if (cell instanceof Date) return '';
  if (typeof cell === 'number') return Number.isInteger(cell) ? String(cell) : String(cell);
  return cleanText(cell);
}

export function coerceRow(cells: Cell[], indexes: Partial<Record<FieldKey, number>>, rowNumber: number): RawOrderTrackerRow {
  const get = (key: FieldKey): Cell => {
    const i = indexes[key];
    return i == null ? null : (cells[i] ?? null);
  };
  const orderDateRaw = get('orderDate');
  const orderDate = parseCellDate(orderDateRaw);
  const orderDateInvalid = orderDate == null && orderDateRaw != null && str(orderDateRaw) !== '' && !(typeof orderDateRaw === 'string' && /^[-—]$/.test(orderDateRaw.trim()));
  const row: RawOrderTrackerRow = {
    rowNumber,
    source: str(get('source')),
    customerType: str(get('customerType')),
    typeOfOrder: str(get('typeOfOrder')),
    orderDate,
    orderDateInvalid,
    companyName: str(get('companyName')),
    customerName: str(get('customerName')),
    territoryManager: str(get('territoryManager')),
    onlineSupport: str(get('onlineSupport')),
    customerPo: idStr(get('customerPo')),
    bigcOrder: idStr(get('bigcOrder')),
    salesReceipt: idStr(get('salesReceipt')),
    estimate: idStr(get('estimate')),
    invoice: idStr(get('invoice')),
    productValue: parseMoney(get('productValue')),
    productValue2: parseMoney(get('productValue2')),
    paymentStatus: str(get('paymentStatus')),
    paymentDate: parseCellDate(get('paymentDate')),
    modeOfPayment: str(get('modeOfPayment')),
    notes: str(get('notes')),
    invoiceDate: parseCellDate(get('invoiceDate')),
    invoiceDueDate: parseCellDate(get('invoiceDueDate')),
    invoiceStatus: str(get('invoiceStatus')),
    vmPo: idStr(get('vmPo')),
    vendor: str(get('vendor')),
    isEmpty: false,
  };
  row.isEmpty = Object.values(indexes).every((i) => {
    const c = cells[i as number];
    return c == null || (typeof c === 'string' && c.trim() === '');
  });
  return row;
}

/**
 * Parses an Order Tracker workbook (ArrayBuffer) into mapped rows.
 * Throws WorkbookImportError with a user-facing message when the structure is unusable.
 */
export function parseOrderTracker(data: ArrayBuffer | Uint8Array, fileName: string): ParsedWorkbook {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: 'array', cellDates: true, dense: false });
  } catch (err) {
    console.error('[excelParser] XLSX.read failed', err instanceof Error ? err.message : err);
    throw new WorkbookImportError('The uploaded workbook could not be read.');
  }
  if (!workbook.SheetNames.length || !looksLikeSpreadsheet(workbook)) {
    throw new WorkbookImportError('The uploaded workbook could not be read.');
  }
  const { name: sheetName, rows } = pickSheet(workbook);
  const detected = detectHeaderRow(rows);
  if (!detected) {
    throw new WorkbookImportError(`Unable to locate the Order Tracker header row in worksheet "${sheetName}".`);
  }
  const { headerRowIndex, mapping } = detected;
  for (const key of REQUIRED_FOR_ANALYSIS) {
    if (mapping.indexes[key] == null) {
      const def = COLUMN_DEFINITIONS.find((d) => d.key === key)!;
      throw new WorkbookImportError(`Unable to locate ${def.label} in the uploaded workbook.`);
    }
  }
  const missingOptional = COLUMN_DEFINITIONS.filter((d) => mapping.indexes[d.key] == null).map((d) => d.label);

  const issues: DataQualityIssue[] = [];
  const parsedRows: RawOrderTrackerRow[] = [];
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const cells = rows[r];
    if (!cells) continue;
    try {
      const row = coerceRow(cells, mapping.indexes, r + 1);
      if (row.isEmpty) continue;
      parsedRows.push(row);
    } catch (err) {
      console.warn('[excelParser] Skipping unreadable row', r + 1, err instanceof Error ? err.message : err);
      issues.push({
        id: `parse-${r + 1}`,
        issueType: 'Unreadable row',
        company: '',
        salesRep: '',
        sourceRows: [r + 1],
        explanation: 'The row could not be read and was skipped.',
        severity: 'medium',
      });
    }
  }

  if (missingOptional.length) {
    issues.push({
      id: 'missing-optional-columns',
      issueType: 'Optional columns not found',
      company: '',
      salesRep: '',
      sourceRows: [headerRowIndex + 1],
      explanation: `These columns were not found and related checks were skipped: ${missingOptional.join(', ')}.`,
      severity: missingOptional.some((l) => ['PRODUCT VALUE 2', 'PAYMENT STATUS', 'MODE OF PAYMENT', 'INVOICE DUE DATE'].includes(l)) ? 'medium' : 'low',
    });
  }

  const columnMapping: ColumnMapping = {
    indexes: mapping.indexes,
    headerRowIndex,
    matchedHeaders: mapping.matched,
    missingOptional,
  };
  console.info(`[excelParser] Sheet "${sheetName}", header row ${headerRowIndex + 1}, ${parsedRows.length} data rows, ${Object.keys(mapping.indexes).length} columns mapped.`);
  return { fileName, sheetName, rows: parsedRows, mapping: columnMapping, issues };
}
