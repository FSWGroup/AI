import { describe, it, expect } from "vitest";
import { PdfBuilder, encodable } from "@/lib/report/pdf-layout";

const meta = { header: "H", headerRight: "R", footer: "F" };

describe("encodable", () => {
  it("keeps the typographic punctuation WinAnsi actually supports", () => {
    const input = "‘a’ “b” – — … • × café";
    expect(encodable(input)).toBe(input);
  });

  it("substitutes characters WinAnsi cannot encode", () => {
    expect(encodable("a → b")).toBe("a -> b");
    expect(encodable("low ↔ high")).toBe("low <-> high");
    expect(encodable("≤ 5")).toBe("<= 5");
    expect(encodable("✓ done")).toBe("y done");
  });

  it("replaces anything else with a space rather than throwing", () => {
    // Emoji and CJK are outside WinAnsi entirely. One space per code point,
    // so surrounding spacing survives — an astral-plane emoji is a single
    // code point, not two.
    expect(encodable("a \u{1F600} b")).toBe("a   b");
    expect(encodable("a 中 b")).toBe("a   b");
  });

  it("normalizes newlines and strips zero-width characters", () => {
    expect(encodable("a\r\nb")).toBe("a\nb");
    expect(encodable("a​b")).toBe("ab");
    expect(encodable("a b")).toBe("a b");
  });

  it("never emits a character a standard PDF font would reject", async () => {
    // The real guarantee: whatever comes out must be drawable.
    const b = await PdfBuilder.create(meta);
    const nasty = "Smørrebrød — “quoted” → ✓ \u{1F4A1} 中文";
    expect(() => b.widthOf(nasty, 10)).not.toThrow();
    b.text(nasty);
    await expect(b.finish("t")).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe("PdfBuilder.wrap", () => {
  it("wraps to the requested column width", async () => {
    const b = await PdfBuilder.create(meta);
    const lines = b.wrap("one two three four five six seven eight", 60, 9);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(b.widthOf(line, 9)).toBeLessThanOrEqual(60);
  });

  it("breaks a single word wider than the column instead of looping forever", async () => {
    const b = await PdfBuilder.create(meta);
    const lines = b.wrap("A".repeat(400), 50, 9);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(b.widthOf(line, 9)).toBeLessThanOrEqual(50);
    expect(lines.join("")).toBe("A".repeat(400));
  });

  it("preserves explicit newlines", async () => {
    const b = await PdfBuilder.create(meta);
    expect(b.wrap("a\nb", 500, 9)).toEqual(["a", "b"]);
  });

  it("measure() agrees with what wrap() produces", async () => {
    const b = await PdfBuilder.create(meta);
    const text = "one two three four five six seven eight nine ten eleven";
    const lines = b.wrap(text, 100, 9);
    expect(b.measure(text, { size: 9, width: 100, lineHeight: 1.35 })).toBeCloseTo(
      lines.length * 9 * 1.35,
      5,
    );
  });
});

describe("PdfBuilder pagination", () => {
  it("adds pages as content overflows", async () => {
    const b = await PdfBuilder.create(meta);
    expect(b.pageNumber).toBe(1);
    for (let i = 0; i < 200; i++) b.text(`line ${i}`);
    expect(b.pageNumber).toBeGreaterThan(1);
  });

  it("does not leave a blank page when a section starts on a fresh one", async () => {
    const b = await PdfBuilder.create(meta);
    b.sectionHeading(1, "First");
    expect(b.pageNumber).toBe(1);
    b.text("body");
    b.sectionHeading(2, "Second");
    expect(b.pageNumber).toBe(2);
  });

  it("records each section against the page it starts on", async () => {
    const b = await PdfBuilder.create(meta);
    b.sectionHeading(1, "Alpha");
    for (let i = 0; i < 120; i++) b.text(`line ${i}`);
    b.sectionHeading(2, "Beta");
    expect(b.sections.map((s) => s.title)).toEqual(["1. Alpha", "2. Beta"]);
    expect(b.sections[1].page).toBeGreaterThan(b.sections[0].page);
  });

  it("reservePage claims a page in order so later numbering accounts for it", async () => {
    const b = await PdfBuilder.create(meta);
    b.text("cover");
    b.reservePage();
    expect(b.pageNumber).toBe(3);
    b.sectionHeading(1, "After the reserved page");
    expect(b.sections[0].page).toBe(3);
  });

  it("produces a parseable PDF", async () => {
    const b = await PdfBuilder.create(meta);
    b.sectionHeading(1, "Section");
    b.text("Hello");
    b.table(
      [
        { label: "A", width: 100 },
        { label: "B", width: 100 },
      ],
      [["one", "two"]],
    );
    b.bullets(["first", "second"]);
    b.bandScale(100, 400, 5, { min: 4, max: 6 });
    const bytes = await b.finish("Test");
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
