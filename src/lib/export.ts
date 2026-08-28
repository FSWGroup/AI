import "server-only";
import zlib from "node:zlib";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Report export formats: CSV, a genuinely valid .xlsx (hand-built OOXML zip —
 * no external spreadsheet library), and a paginated PDF table via pdf-lib.
 *
 * All three take the same shape: an array of row objects plus a column list,
 * so every report in src/lib/services/reports.ts exports identically.
 */

export interface ExportColumn {
  key: string;
  label: string;
  /** Relative width weight, used only by the PDF exporter. Default 1. */
  width?: number;
}

// ---------------------------------------------------------------------------
// CSV — RFC 4180
// ---------------------------------------------------------------------------

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** RFC 4180 CSV with a UTF-8 BOM so Excel opens it without mangling accents. */
export function toCsv(rows: Record<string, unknown>[], columns: ExportColumn[]): Buffer {
  const lines: string[] = [];
  lines.push(columns.map((c) => csvCell(c.label)).join(","));
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(row[c.key])).join(","));
  }
  const body = lines.join("\r\n") + "\r\n";
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body, "utf8")]);
}

// ---------------------------------------------------------------------------
// Minimal ZIP writer (store or deflate), enough to build a valid OOXML package
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  data: Buffer;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    const tableIndex = (crc ^ (buf[i] ?? 0)) & 0xff;
    crc = (CRC_TABLE[tableIndex] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
  const day =
    (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
  return { time, date: day };
}

/** Hand-rolled ZIP container. Node's zlib provides raw DEFLATE; we assemble
 * local file headers, the central directory, and the end-of-central-directory
 * record ourselves per the PKZIP APPNOTE format that OOXML packages use. */
export function buildZip(entries: ZipEntry[]): Buffer {
  const { time, date } = dosDateTime(new Date());
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const deflated = zlib.deflateRawSync(entry.data);
    const useDeflate = deflated.length < entry.data.length;
    const method = useDeflate ? 8 : 0;
    const payload = useDeflate ? deflated : entry.data;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirStart = offset;
  const centralDir = Buffer.concat(centralParts);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(centralDirStart, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, end]);
}

// ---------------------------------------------------------------------------
// XLSX — minimal but valid OOXML spreadsheet package
// ---------------------------------------------------------------------------

export interface XlsxSheet {
  name: string;
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
}

const XML_ILLEGAL_CODEPOINTS: [number, number][] = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
];

/** True for the C0 control characters XML 1.0 cannot encode. */
function isXmlIllegal(codePoint: number): boolean {
  return XML_ILLEGAL_CODEPOINTS.some(([start, end]) => codePoint >= start && codePoint <= end);
}

function xmlEscape(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (isXmlIllegal(code)) continue;
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === '"') out += "&quot;";
    else if (ch === "\'") out += "&apos;";
    else out += ch;
  }
  return out;
}

function colLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function cellXml(colIndex: number, rowNumber: number, value: unknown): string {
  const ref = `${colLetter(colIndex)}${rowNumber}`;
  if (value === null || value === undefined || value === "") return `<c r="${ref}"/>`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

/**
 * Builds a real .xlsx by hand: [Content_Types].xml, root and workbook
 * relationships, workbook.xml, and one worksheet per sheet, using inline
 * strings (no sharedStrings.xml needed) so the package stays small and valid.
 * Opens correctly in Excel, LibreOffice Calc, and Google Sheets.
 */
export function toXlsx(sheets: XlsxSheet[]): Buffer {
  const safeSheets = sheets.length > 0 ? sheets : [{ name: "Sheet1", columns: [], rows: [] }];
  const entries: ZipEntry[] = [];

  const overrides = safeSheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");

  entries.push({
    name: "[Content_Types].xml",
    data: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `${overrides}</Types>`,
      "utf8",
    ),
  });

  entries.push({
    name: "_rels/.rels",
    data: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
      "utf8",
    ),
  });

  const sheetTags = safeSheets
    .map((s, i) => {
      const name = xmlEscape(s.name).slice(0, 31) || `Sheet${i + 1}`;
      return `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`;
    })
    .join("");

  entries.push({
    name: "xl/workbook.xml",
    data: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>${sheetTags}</sheets></workbook>`,
      "utf8",
    ),
  });

  const rels = safeSheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join("");

  entries.push({
    name: "xl/_rels/workbook.xml.rels",
    data: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
      "utf8",
    ),
  });

  safeSheets.forEach((sheet, sheetIndex) => {
    const rowsXml: string[] = [];
    const headerCells = sheet.columns.map((c, ci) => cellXml(ci, 1, c.label)).join("");
    rowsXml.push(`<row r="1">${headerCells}</row>`);
    sheet.rows.forEach((row, ri) => {
      const rowNumber = ri + 2;
      const cells = sheet.columns.map((c, ci) => cellXml(ci, rowNumber, row[c.key])).join("");
      rowsXml.push(`<row r="${rowNumber}">${cells}</row>`);
    });
    const dimension =
      sheet.columns.length > 0
        ? `A1:${colLetter(sheet.columns.length - 1)}${sheet.rows.length + 1}`
        : "A1";

    entries.push({
      name: `xl/worksheets/sheet${sheetIndex + 1}.xml`,
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
          `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
          `<dimension ref="${dimension}"/><sheetData>${rowsXml.join("")}</sheetData></worksheet>`,
        "utf8",
      ),
    });
  });

  return buildZip(entries);
}

// ---------------------------------------------------------------------------
// PDF — paginated table via pdf-lib
// ---------------------------------------------------------------------------

export interface PdfExportMeta {
  generatedAt?: Date;
  generatedBy?: string;
  /** Short human-readable summary of active filters, shown under the title. */
  filterSummary?: string;
}

const PAGE_WIDTH = 792; // US Letter landscape, points
const PAGE_HEIGHT = 612;
const MARGIN = 32;
const HEADER_BAR_HEIGHT = 46;
const ROW_HEIGHT = 18;
const FSW_NAVY = rgb(0x17 / 255, 0x36 / 255, 0x5c / 255);
const FSW_STEEL = rgb(0x4c / 255, 0x55 / 255, 0x66 / 255);
const ROW_ALT = rgb(0.96, 0.97, 0.98);

function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}…`, size) > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

/**
 * Renders a paginated table PDF with an FSW-navy header band, title,
 * generated-at timestamp, and "Page X of Y" footers added in a final pass
 * once total page count is known.
 */
export async function toPdfTable(
  title: string,
  columns: ExportColumn[],
  rows: Record<string, unknown>[],
  meta: PdfExportMeta = {},
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const usableWidth = PAGE_WIDTH - MARGIN * 2;
  const totalWeight = columns.reduce((sum, c) => sum + (c.width ?? 1), 0) || 1;
  const colWidths = columns.map((c) => ((c.width ?? 1) / totalWeight) * usableWidth);
  const colX: number[] = [];
  {
    let x = MARGIN;
    for (const w of colWidths) {
      colX.push(x);
      x += w;
    }
  }

  const generatedAt = meta.generatedAt ?? new Date();
  const pages: PDFPage[] = [];

  function drawHeader(page: PDFPage): number {
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - HEADER_BAR_HEIGHT, width: PAGE_WIDTH, height: HEADER_BAR_HEIGHT, color: FSW_NAVY });
    page.drawText("FSW Academy", {
      x: MARGIN,
      y: PAGE_HEIGHT - 20,
      size: 9,
      font: boldFont,
      color: rgb(1, 1, 1),
    });
    page.drawText(title, {
      x: MARGIN,
      y: PAGE_HEIGHT - 37,
      size: 14,
      font: boldFont,
      color: rgb(1, 1, 1),
    });
    const stamp = `Generated ${generatedAt.toISOString().replace("T", " ").slice(0, 16)} UTC${
      meta.generatedBy ? ` by ${meta.generatedBy}` : ""
    }`;
    const stampWidth = font.widthOfTextAtSize(stamp, 8);
    page.drawText(stamp, {
      x: PAGE_WIDTH - MARGIN - stampWidth,
      y: PAGE_HEIGHT - 20,
      size: 8,
      font,
      color: rgb(0.85, 0.89, 0.94),
    });

    let y = PAGE_HEIGHT - HEADER_BAR_HEIGHT - 14;
    if (meta.filterSummary) {
      page.drawText(truncateToWidth(meta.filterSummary, font, 8, usableWidth), {
        x: MARGIN,
        y,
        size: 8,
        font,
        color: FSW_STEEL,
      });
      y -= 14;
    }
    return y;
  }

  function drawColumnHeaders(page: PDFPage, y: number): number {
    page.drawRectangle({ x: MARGIN, y: y - ROW_HEIGHT + 4, width: usableWidth, height: ROW_HEIGHT, color: rgb(0.9, 0.92, 0.95) });
    columns.forEach((col, i) => {
      const x = colX[i] ?? MARGIN;
      const w = colWidths[i] ?? 0;
      page.drawText(truncateToWidth(col.label, boldFont, 8.5, w - 6), {
        x: x + 3,
        y: y - ROW_HEIGHT + 9,
        size: 8.5,
        font: boldFont,
        color: FSW_NAVY,
      });
    });
    return y - ROW_HEIGHT;
  }

  function newPage(): number {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    const afterHeader = drawHeader(page);
    return drawColumnHeaders(page, afterHeader);
  }

  let y = newPage();
  let page = pages[pages.length - 1] as PDFPage;
  const bottomLimit = MARGIN + 24;

  if (rows.length === 0) {
    page.drawText("No rows match the current filters.", {
      x: MARGIN,
      y: y - 14,
      size: 9.5,
      font,
      color: FSW_STEEL,
    });
  }

  rows.forEach((row, rowIndex) => {
    if (y - ROW_HEIGHT < bottomLimit) {
      y = newPage();
      page = pages[pages.length - 1] as PDFPage;
    }
    if (rowIndex % 2 === 1) {
      page.drawRectangle({ x: MARGIN, y: y - ROW_HEIGHT + 4, width: usableWidth, height: ROW_HEIGHT, color: ROW_ALT });
    }
    columns.forEach((col, i) => {
      const x = colX[i] ?? MARGIN;
      const w = colWidths[i] ?? 0;
      const raw = row[col.key];
      const text = raw === null || raw === undefined ? "" : raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw);
      page.drawText(truncateToWidth(text, font, 8.5, w - 6), {
        x: x + 3,
        y: y - ROW_HEIGHT + 9,
        size: 8.5,
        font,
        color: rgb(0.12, 0.14, 0.18),
      });
    });
    y -= ROW_HEIGHT;
  });

  const total = pages.length;
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${total} · ${rows.length} row${rows.length === 1 ? "" : "s"}`;
    const w = font.widthOfTextAtSize(label, 8);
    p.drawText(label, {
      x: PAGE_WIDTH - MARGIN - w,
      y: MARGIN - 14,
      size: 8,
      font,
      color: FSW_STEEL,
    });
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
