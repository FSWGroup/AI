import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseOrderTracker, WorkbookImportError } from './excelParser';

function workbookFrom(sheets: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellDates: true }) as ArrayBuffer);
}

const HEADER = ['SOURCE', 'TYPE OF ORDER', 'ORDER DATE', 'COMPANY NAME', 'CUSTOMER NAME', 'TERRITORY MANAGER', 'ONLINE SUPPORT', 'Customer PO #', 'BIGC Order #', 'QB Sales Receipt # / Sales Order #', 'QB Estimate #', 'QB Invoice #', 'PRODUCT VALUE', 'PRODUCT VALUE 2', 'PAYMENT STATUS', 'PAYMENT DATE', 'MODE OF PAYMENT', 'NOTES', 'INVOICE DATE', 'INVOICE DUE DATE', 'INVOICE STATUS', 'VM PO #', 'VENDOR'];

describe('parseOrderTracker', () => {
  it('detects MAIN, maps columns by normalized header and coerces values', () => {
    const data = workbookFrom({
      'Lead Source': [['x']],
      MAIN: [
        HEADER,
        ['', 'Offline', new Date(2026, 5, 15), 'Acme Fabrication', 'Pat', 'Joe', '', 'PO 1', '', '', '4001-A', 'I-9001', 5000, '$12,000.00', 'Payment Cleared', new Date(2026, 5, 20), 'Net 30', '', null, null, 'Paid w/o Shipping Fee', 7001, 'Richards'],
        [null, null, null, null, null, null, null, null, null, null, '4001-B', null, 7000, '', null, null, null, null, null, null, null, 7002, 'Apollo'],
        [],
      ],
    });
    const parsed = parseOrderTracker(data, 'tracker.xlsx');
    expect(parsed.sheetName).toBe('MAIN');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].orderDate).toEqual(new Date(2026, 5, 15));
    expect(parsed.rows[0].productValue2).toBe(12000);
    expect(parsed.rows[0].estimate).toBe('4001-A');
    expect(parsed.rows[0].vmPo).toBe('7001');
    expect(parsed.rows[1].productValue2).toBeNull();
    expect(parsed.rows[1].rowNumber).toBe(3);
    expect(parsed.mapping.indexes.vendor).toBe(22);
  });

  it('matches headers case-insensitively with extra whitespace and line breaks', () => {
    const header = HEADER.map((h) => (h === 'ORDER DATE' ? ' order\ndate ' : h === 'COMPANY NAME' ? 'Company  Name' : h));
    const data = workbookFrom({ MAIN: [header, ['', 'Offline', new Date(2026, 0, 1), 'Acme', '', 'Joe', '', '', '', '', '1', '', 10, 10, 'Payment Cleared', null, 'Visa', '', null, null, '', '', 'Richards']] });
    const parsed = parseOrderTracker(data, 't.xlsx');
    expect(parsed.rows[0].companyName).toBe('Acme');
    expect(parsed.rows[0].orderDate).toEqual(new Date(2026, 0, 1));
  });

  it('tolerates a header row that is not the first row', () => {
    const data = workbookFrom({ MAIN: [['ValveMan Order Tracker'], [], HEADER, ['', 'Offline', new Date(2026, 0, 1), 'Acme', '', 'Joe', '', '', '', '', '1', '', 10, 10, 'Payment Cleared', null, 'Visa', '', null, null, '', '', 'Richards']] });
    const parsed = parseOrderTracker(data, 't.xlsx');
    expect(parsed.mapping.headerRowIndex).toBe(2);
    expect(parsed.rows[0].rowNumber).toBe(4);
  });

  it('errors clearly when MAIN is missing and no sheet looks like a tracker', () => {
    const data = workbookFrom({ Other: [['a', 'b'], [1, 2]] });
    expect(() => parseOrderTracker(data, 't.xlsx')).toThrow(WorkbookImportError);
    expect(() => parseOrderTracker(data, 't.xlsx')).toThrow('does not contain a worksheet named MAIN');
  });

  it('errors clearly when a critical column is missing', () => {
    const header = HEADER.filter((h) => h !== 'COMPANY NAME');
    const data = workbookFrom({ MAIN: [header, header.map(() => '')] });
    expect(() => parseOrderTracker(data, 't.xlsx')).toThrow('Unable to locate COMPANY NAME in the uploaded workbook.');
    const header2 = HEADER.filter((h) => h !== 'VENDOR');
    expect(() => parseOrderTracker(workbookFrom({ MAIN: [header2] }), 't.xlsx')).toThrow('Unable to locate VENDOR in the uploaded workbook.');
  });

  it('errors clearly on an unreadable file', () => {
    expect(() => parseOrderTracker(new Uint8Array([1, 2, 3, 4]), 'bad.xlsx')).toThrow('could not be read');
  });
});
