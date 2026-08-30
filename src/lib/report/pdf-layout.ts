/**
 * A small flowing-layout engine over pdf-lib.
 *
 * Why this exists: the platform's other PDF path prints the web report with
 * headless Chromium, which needs a Chromium binary. Serverless hosts (the
 * deployment target) do not have one, so the download button could only ever
 * return an apology there. pdf-lib is pure JavaScript and runs anywhere, but
 * it draws at absolute coordinates and knows nothing about paragraphs, page
 * breaks, or tables — so this module supplies those.
 *
 * The API is a cursor: you append blocks top to bottom, and the engine breaks
 * pages, repeats the running header and footer, and finally stamps
 * "Page N of M" once the total is known.
 */

import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
  type RGB,
} from "pdf-lib";

// Letter at 72pt/in.
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 54;
const MARGIN_TOP = 62;
const MARGIN_BOTTOM = 58;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

export const COLORS = {
  navy900: rgb(0.08, 0.13, 0.22),
  navy700: rgb(0.21, 0.29, 0.4),
  navy500: rgb(0.42, 0.53, 0.65),
  navy400: rgb(0.55, 0.64, 0.74),
  navy100: rgb(0.87, 0.9, 0.94),
  navy50: rgb(0.95, 0.96, 0.98),
  fsw600: rgb(0.12, 0.35, 0.72),
  fsw100: rgb(0.85, 0.9, 0.98),
  white: rgb(1, 1, 1),
  green: rgb(0.06, 0.5, 0.34),
  greenBg: rgb(0.85, 0.96, 0.91),
  amber: rgb(0.6, 0.4, 0.04),
  amberBg: rgb(0.99, 0.95, 0.83),
  red: rgb(0.7, 0.15, 0.15),
  redBg: rgb(0.99, 0.9, 0.9),
} as const;

/**
 * The 14 standard PDF fonts are WinAnsi-encoded, so a character outside that
 * set makes pdf-lib throw mid-render — and report copy is full of typographic
 * punctuation.
 *
 * WinAnsi is wider than Latin-1: its 0x80-0x9F range carries the curly quotes,
 * the dashes, the ellipsis and the bullet, so those all survive intact. Only
 * the genuinely unencodable characters are substituted, and the catch-all
 * turns anything still unknown into a space rather than an exception — losing
 * one glyph beats losing the whole document.
 */
const WINANSI_HIGH = new Set(
  "\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178",
);

const SUBSTITUTIONS: [RegExp, string][] = [
  [/[\u2192\u21D2]/g, "->"],
  [/[\u2190\u21D0]/g, "<-"],
  [/[\u2194\u21D4]/g, "<->"],
  [/[\u2264]/g, "<="],
  [/[\u2265]/g, ">="],
  [/[\u2713\u2714]/g, "y"],
  [/[\u2212]/g, "-"],
  [/[\u2010\u2011\u2012\u2015]/g, "-"],
  [/[\u201F\u201B]/g, '"'],
  [/[\u00A0\u2007\u202F\u2009\u200A]/g, " "],
  [/[\u200B\uFEFF]/g, ""],
  [/\r\n?/g, "\n"],
];

/** True when a character can be drawn with a standard PDF font. */
function isEncodable(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  if (ch === "\n") return true;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return WINANSI_HIGH.has(ch);
}

/** Make a string safe for the standard fonts, losing as little as possible. */
export function encodable(input: string): string {
  let out = input;
  for (const [pattern, replacement] of SUBSTITUTIONS) {
    out = out.replace(pattern, replacement);
  }
  let result = "";
  for (const ch of out) result += isEncodable(ch) ? ch : " ";
  return result;
}

export interface TextStyle {
  size?: number;
  bold?: boolean;
  color?: RGB;
  /** Multiplier on font size. */
  lineHeight?: number;
  indent?: number;
  width?: number;
}

export interface DocMeta {
  /** Left-hand running header, e.g. "Alex Sample - Inside Sales". */
  header: string;
  /** Right-hand running header, usually the assessment date. */
  headerRight: string;
  footer: string;
}

interface Outline {
  title: string;
  page: number;
}

export class PdfBuilder {
  private doc!: PDFDocument;
  private regular!: PDFFont;
  private boldFont!: PDFFont;
  private page!: PDFPage;
  private y = 0;
  private pages: PDFPage[] = [];
  /** Pages that get no running header/footer (the cover). */
  private chromeless = new Set<number>();
  private outline: Outline[] = [];
  /** Nothing drawn on the current page yet — used to avoid blank pages when a
   *  section heading asks to start on a fresh sheet it is already on. */
  private pageEmpty = true;

  private constructor(private meta: DocMeta) {}

  static async create(meta: DocMeta): Promise<PdfBuilder> {
    const b = new PdfBuilder(meta);
    b.doc = await PDFDocument.create();
    b.regular = await b.doc.embedFont(StandardFonts.Helvetica);
    b.boldFont = await b.doc.embedFont(StandardFonts.HelveticaBold);
    b.newPage();
    return b;
  }

  // ---- page management -------------------------------------------------------

  newPage(): void {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = PAGE_H - MARGIN_TOP;
    this.pageEmpty = true;
  }

  /**
   * Claim a page now and draw on it later. The table of contents needs page
   * numbers that do not exist until the document is finished, but it has to
   * sit near the front — so it is reserved in place and filled in at the end,
   * which also means every later page number already accounts for it.
   */
  reservePage(): PDFPage {
    this.newPage();
    this.pageEmpty = false;
    const reserved = this.page;
    this.newPage();
    return reserved;
  }

  /** Draw a single line on any page, not just the current one. */
  drawOn(
    page: PDFPage,
    content: string,
    x: number,
    y: number,
    style: TextStyle = {},
  ): void {
    page.drawText(encodable(content), {
      x,
      y,
      size: style.size ?? 9.5,
      font: this.font(style.bold ?? false),
      color: style.color ?? COLORS.navy700,
    });
  }

  /** Current page number, 1-based. */
  get pageNumber(): number {
    return this.pages.length;
  }

  /** Mark the current page as having no header/footer. */
  markChromeless(): void {
    this.chromeless.add(this.pages.length - 1);
  }

  private space(): number {
    return this.y - MARGIN_BOTTOM;
  }

  /** Break to a new page unless `needed` points still fit. */
  ensure(needed: number): void {
    if (this.space() < needed) this.newPage();
  }

  moveDown(points: number): void {
    this.y -= points;
  }

  get cursorY(): number {
    return this.y;
  }

  // ---- measurement -----------------------------------------------------------

  private font(bold: boolean): PDFFont {
    return bold ? this.boldFont : this.regular;
  }

  widthOf(text: string, size: number, bold = false): number {
    return this.font(bold).widthOfTextAtSize(encodable(text), size);
  }

  /** Greedy word wrap. Respects explicit newlines. */
  wrap(text: string, width: number, size: number, bold = false): string[] {
    const font = this.font(bold);
    const lines: string[] = [];
    for (const paragraph of encodable(text).split("\n")) {
      if (paragraph.trim() === "") {
        lines.push("");
        continue;
      }
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= width) {
          line = candidate;
          continue;
        }
        if (line) lines.push(line);
        // A single word wider than the column would loop forever; break it.
        if (font.widthOfTextAtSize(word, size) > width) {
          let chunk = "";
          for (const ch of word) {
            if (font.widthOfTextAtSize(chunk + ch, size) > width) {
              lines.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else {
          line = word;
        }
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  /** Height a paragraph would occupy, without drawing it. */
  measure(text: string, style: TextStyle = {}): number {
    const size = style.size ?? 9.5;
    const lh = size * (style.lineHeight ?? 1.35);
    const width = (style.width ?? CONTENT_W) - (style.indent ?? 0);
    return this.wrap(text, width, size, style.bold).length * lh;
  }

  // ---- drawing ---------------------------------------------------------------

  /** Draw a wrapped paragraph at the cursor, breaking pages as needed. */
  text(content: string, style: TextStyle = {}): void {
    const size = style.size ?? 9.5;
    const lh = size * (style.lineHeight ?? 1.35);
    const indent = style.indent ?? 0;
    const width = (style.width ?? CONTENT_W) - indent;
    const color = style.color ?? COLORS.navy700;
    for (const line of this.wrap(content, width, size, style.bold)) {
      this.ensure(lh);
      this.y -= lh;
      if (line !== "") {
        this.pageEmpty = false;
        this.page.drawText(line, {
          x: MARGIN_X + indent,
          y: this.y,
          size,
          font: this.font(style.bold ?? false),
          color,
        });
      }
    }
  }

  /** A single line drawn at an absolute x, no wrapping and no page break. */
  lineAt(content: string, x: number, y: number, style: TextStyle = {}): void {
    const size = style.size ?? 9.5;
    this.pageEmpty = false;
    this.page.drawText(encodable(content), {
      x,
      y,
      size,
      font: this.font(style.bold ?? false),
      color: style.color ?? COLORS.navy700,
    });
  }

  /**
   * Numbered section heading. Starts a fresh page so a reader can find and
   * forward any single section, but never leaves a blank one behind.
   */
  sectionHeading(index: number, title: string): void {
    if (!this.pageEmpty) this.newPage();
    this.outline.push({ title: `${index}. ${title}`, page: this.pageNumber });
    this.y -= 4;
    this.lineAt(`SECTION ${index}`, MARGIN_X, this.y, {
      size: 7.5,
      bold: true,
      color: COLORS.fsw600,
    });
    this.y -= 17;
    this.lineAt(title, MARGIN_X, this.y, { size: 15, bold: true, color: COLORS.navy900 });
    this.y -= 8;
    this.rule(COLORS.navy900, 1.2);
    this.y -= 10;
  }

  subHeading(title: string): void {
    this.ensure(34);
    this.y -= 13;
    this.lineAt(title, MARGIN_X, this.y, { size: 10.5, bold: true, color: COLORS.navy900 });
    this.y -= 6;
  }

  rule(color: RGB = COLORS.navy100, thickness = 0.7): void {
    this.ensure(thickness + 2);
    this.page.drawRectangle({
      x: MARGIN_X,
      y: this.y,
      width: CONTENT_W,
      height: thickness,
      color,
    });
    this.y -= thickness;
  }

  /** Tinted panel behind a block of paragraphs (used for callouts). */
  panel(
    lines: { text: string; style?: TextStyle }[],
    opts: { bg?: RGB; pad?: number } = {},
  ): void {
    const pad = opts.pad ?? 8;
    const inner = CONTENT_W - pad * 2;
    const height =
      lines.reduce(
        (h, l) => h + this.measure(l.text, { ...l.style, width: inner }),
        0,
      ) + pad * 2;
    this.ensure(height + 6);
    this.page.drawRectangle({
      x: MARGIN_X,
      y: this.y - height,
      width: CONTENT_W,
      height,
      color: opts.bg ?? COLORS.navy50,
    });
    this.y -= pad;
    for (const l of lines) {
      this.text(l.text, { ...l.style, width: inner, indent: pad });
    }
    this.y -= pad;
    this.y -= 6;
  }

  /** Small rounded-ish label. Returns the width consumed. */
  chip(
    label: string,
    x: number,
    y: number,
    fg: RGB,
    bg: RGB,
    size = 7.5,
  ): number {
    const padX = 4;
    const w = this.widthOf(label, size, true) + padX * 2;
    this.page.drawRectangle({
      x,
      y: y - 2.5,
      width: w,
      height: size + 4,
      color: bg,
    });
    this.lineAt(label, x + padX, y, { size, bold: true, color: fg });
    return w;
  }

  /**
   * The 1-9 band scale: nine cells, the benchmark range tinted, the
   * candidate's band filled. Drawn at an absolute position so it can sit
   * inside a table row.
   */
  bandScale(
    x: number,
    y: number,
    band: number,
    range: { min: number; max: number } | null,
  ): number {
    const cell = 13;
    const gap = 1.5;
    for (let b = 1; b <= 9; b++) {
      const cx = x + (b - 1) * (cell + gap);
      const inRange = range ? b >= range.min && b <= range.max : false;
      const isBand = b === band;
      this.page.drawRectangle({
        x: cx,
        y: y - 2,
        width: cell,
        height: cell,
        color: isBand ? COLORS.navy900 : inRange ? COLORS.fsw100 : COLORS.navy50,
        borderColor: inRange && !isBand ? COLORS.fsw600 : COLORS.navy100,
        borderWidth: 0.5,
      });
      this.lineAt(String(b), cx + (cell - this.widthOf(String(b), 7, true)) / 2, y + 1.5, {
        size: 7,
        bold: true,
        color: isBand ? COLORS.white : inRange ? COLORS.fsw600 : COLORS.navy400,
      });
    }
    return 9 * (cell + gap);
  }

  /** Simple table with a header row; wraps cells and breaks pages. */
  table(
    columns: { label: string; width: number }[],
    rows: string[][],
    opts: { size?: number } = {},
  ): void {
    const size = opts.size ?? 8.5;
    const lh = size * 1.3;
    const drawHeader = () => {
      this.ensure(lh + 8);
      this.y -= lh;
      let x = MARGIN_X;
      for (const c of columns) {
        this.lineAt(c.label.toUpperCase(), x, this.y, {
          size: 6.8,
          bold: true,
          color: COLORS.navy400,
        });
        x += c.width;
      }
      this.y -= 3;
      this.rule();
      this.y -= 3;
    };
    drawHeader();
    for (const row of rows) {
      const wrapped = row.map((cell, i) =>
        this.wrap(cell ?? "", columns[i].width - 6, size),
      );
      const rowHeight = Math.max(...wrapped.map((w) => w.length)) * lh + 4;
      if (this.space() < rowHeight + 12) {
        this.newPage();
        drawHeader();
      }
      const top = this.y;
      let x = MARGIN_X;
      wrapped.forEach((cellLines, i) => {
        let cy = top;
        for (const line of cellLines) {
          cy -= lh;
          this.lineAt(line, x, cy, {
            size,
            color: i === 0 ? COLORS.navy900 : COLORS.navy700,
            bold: i === 0,
          });
        }
        x += columns[i].width;
      });
      this.y = top - rowHeight;
      this.page.drawRectangle({
        x: MARGIN_X,
        y: this.y + 2,
        width: CONTENT_W,
        height: 0.4,
        color: COLORS.navy100,
      });
    }
    this.y -= 4;
  }

  /**
   * Hanging-indent bullets. The marker is drawn inside the per-line loop
   * rather than around the call to text(): a wrapped item can break to a new
   * page mid-paragraph, and a marker positioned before that break lands on
   * the wrong page at a stale y.
   */
  bullets(items: string[], style: TextStyle = {}): void {
    const size = style.size ?? 9.5;
    const lh = size * (style.lineHeight ?? 1.35);
    const baseIndent = style.indent ?? 0;
    const indent = baseIndent + 12;
    const width = (style.width ?? CONTENT_W) - indent;
    for (const item of items) {
      const lines = this.wrap(item, width, size, style.bold);
      lines.forEach((line, i) => {
        this.ensure(lh);
        this.y -= lh;
        if (i === 0) {
          this.lineAt("-", MARGIN_X + baseIndent + 3, this.y, {
            size,
            color: style.color ?? COLORS.navy400,
          });
        }
        if (line !== "") {
          this.pageEmpty = false;
          this.page.drawText(line, {
            x: MARGIN_X + indent,
            y: this.y,
            size,
            font: this.font(style.bold ?? false),
            color: style.color ?? COLORS.navy700,
          });
        }
      });
    }
  }

  // ---- finishing -------------------------------------------------------------

  get contentWidth(): number {
    return CONTENT_W;
  }
  get marginX(): number {
    return MARGIN_X;
  }
  get pageWidth(): number {
    return PAGE_W;
  }
  get pageHeight(): number {
    return PAGE_H;
  }
  get sections(): Outline[] {
    return this.outline;
  }

  /**
   * Stamp the running header and footer on every page that wants them. Done
   * last because "of M" is unknowable until the document is complete.
   */
  private stampChrome(): void {
    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      if (this.chromeless.has(i)) return;
      page.drawText(encodable(this.meta.header), {
        x: MARGIN_X,
        y: PAGE_H - 34,
        size: 7.5,
        font: this.regular,
        color: COLORS.navy400,
      });
      const rightW = this.regular.widthOfTextAtSize(
        encodable(this.meta.headerRight),
        7.5,
      );
      page.drawText(encodable(this.meta.headerRight), {
        x: PAGE_W - MARGIN_X - rightW,
        y: PAGE_H - 34,
        size: 7.5,
        font: this.regular,
        color: COLORS.navy400,
      });
      page.drawRectangle({
        x: MARGIN_X,
        y: PAGE_H - 42,
        width: CONTENT_W,
        height: 0.4,
        color: COLORS.navy100,
      });

      page.drawText(encodable(this.meta.footer), {
        x: MARGIN_X,
        y: 34,
        size: 7,
        font: this.regular,
        color: COLORS.navy400,
      });
      const label = `Page ${i + 1} of ${total}`;
      const w = this.regular.widthOfTextAtSize(label, 7);
      page.drawText(label, {
        x: PAGE_W - MARGIN_X - w,
        y: 34,
        size: 7,
        font: this.regular,
        color: COLORS.navy400,
      });
    });
  }

  async finish(docTitle: string): Promise<Uint8Array> {
    this.stampChrome();
    this.doc.setTitle(encodable(docTitle));
    this.doc.setProducer("FSW WorkFit");
    this.doc.setCreator("FSW WorkFit");
    return this.doc.save();
  }

  /** Escape hatch for drawing directly on the current page. */
  get raw(): { page: PDFPage; regular: PDFFont; bold: PDFFont } {
    return { page: this.page, regular: this.regular, bold: this.boldFont };
  }

  setCursor(y: number): void {
    this.y = y;
  }
}
