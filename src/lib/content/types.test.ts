import { describe, it, expect } from "vitest";
import {
  blocksSchema,
  blocksToChunks,
  blocksToPlainText,
  estimateReadingMinutes,
  extractLinks,
  type Block,
} from "@/lib/content/types";

const sample: Block[] = [
  { id: "1", type: "heading", level: 2, text: "Procedure" },
  { id: "2", type: "paragraph", text: "Open the ERP and start a new quote." },
  { id: "3", type: "heading", level: 3, text: "Step 4" },
  { id: "4", type: "list", ordered: true, items: ["Check stock", "Confirm lead time"] },
  {
    id: "5",
    type: "table",
    headers: ["Discount", "Approver"],
    rows: [["Up to 10%", "Representative"]],
  },
  { id: "6", type: "image", mediaId: "m1", altText: "The quote entry screen" },
];

describe("blocksToPlainText", () => {
  it("flattens every block type into readable text", () => {
    const text = blocksToPlainText(sample);
    expect(text).toContain("## Procedure");
    expect(text).toContain("Open the ERP");
    expect(text).toContain("### Step 4");
    expect(text).toContain("1. Check stock");
    expect(text).toContain("Discount | Approver");
    expect(text).toContain("[Image: The quote entry screen]");
  });

  it("includes the correct answer for question blocks so search can find it", () => {
    const text = blocksToPlainText([
      {
        id: "q",
        type: "question",
        prompt: "Who approves a 25% discount?",
        options: ["Representative", "Sales Manager and business unit leader"],
        correctIndex: 1,
        explanation: "Over 20% needs both.",
      },
    ]);
    expect(text).toContain("Who approves a 25% discount?");
    expect(text).toContain("Sales Manager and business unit leader");
    expect(text).toContain("Over 20% needs both.");
  });

  it("renders flowchart edges as readable transitions", () => {
    const text = blocksToPlainText([
      {
        id: "f",
        type: "flowchart",
        title: "Approval flow",
        nodes: [
          { id: "a", label: "Request received", kind: "start" },
          { id: "b", label: "Manager approves", kind: "end" },
        ],
        edges: [{ from: "a", to: "b", label: "Over 20%" }],
      },
    ]);
    expect(text).toContain("Request received → Manager approves (Over 20%)");
  });

  it("collapses excessive blank lines", () => {
    const text = blocksToPlainText([
      { id: "a", type: "divider" },
      { id: "b", type: "divider" },
      { id: "c", type: "paragraph", text: "Body" },
    ]);
    expect(text).not.toMatch(/\n{3,}/);
  });

  it("returns an empty string for no blocks", () => {
    expect(blocksToPlainText([])).toBe("");
  });
});

describe("blocksToChunks", () => {
  it("carries the heading path so citations can be precise", () => {
    const chunks = blocksToChunks(sample);
    const step4 = chunks.find((c) => c.content.includes("Check stock"));
    expect(step4?.sectionPath).toBe("Procedure > Step 4");
  });

  it("resets the heading path when a new level-2 heading starts", () => {
    const chunks = blocksToChunks([
      { id: "1", type: "heading", level: 2, text: "First" },
      { id: "2", type: "paragraph", text: "Alpha" },
      { id: "3", type: "heading", level: 2, text: "Second" },
      { id: "4", type: "paragraph", text: "Beta" },
    ]);
    expect(chunks.find((c) => c.content.includes("Alpha"))?.sectionPath).toBe("First");
    expect(chunks.find((c) => c.content.includes("Beta"))?.sectionPath).toBe("Second");
  });

  it("splits long content into multiple chunks", () => {
    const long: Block[] = Array.from({ length: 40 }, (_, i) => ({
      id: `p${i}`,
      type: "paragraph" as const,
      text: "This sentence exists purely to add length to the chunk under test. ".repeat(3),
    }));
    const chunks = blocksToChunks(long, 500);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("produces no chunks for empty or contentless input", () => {
    expect(blocksToChunks([])).toEqual([]);
    expect(blocksToChunks([{ id: "d", type: "divider" }])).toEqual([]);
  });
});

describe("extractLinks", () => {
  it("finds markdown links, embeds, and external video URLs", () => {
    const links = extractLinks([
      {
        id: "1",
        type: "paragraph",
        text: "See the [vendor portal](https://example.com/portal) for details.",
      },
      { id: "2", type: "embed", url: "https://example.com/dashboard", height: 420 },
      { id: "3", type: "video", externalUrl: "https://example.com/video.mp4" },
    ]);
    expect(links).toContain("https://example.com/portal");
    expect(links).toContain("https://example.com/dashboard");
    expect(links).toContain("https://example.com/video.mp4");
  });

  it("deduplicates repeated URLs", () => {
    const links = extractLinks([
      { id: "1", type: "paragraph", text: "[a](https://example.com/x)" },
      { id: "2", type: "paragraph", text: "[b](https://example.com/x)" },
    ]);
    expect(links).toEqual(["https://example.com/x"]);
  });
});

describe("estimateReadingMinutes", () => {
  it("returns at least one minute for short content", () => {
    expect(estimateReadingMinutes([{ id: "1", type: "paragraph", text: "Short." }])).toBe(1);
  });

  it("scales with word count at roughly 200 words per minute", () => {
    const blocks: Block[] = [{ id: "1", type: "paragraph", text: "word ".repeat(1000) }];
    expect(estimateReadingMinutes(blocks)).toBe(5);
  });
});

describe("block schema validation", () => {
  it("accepts well-formed blocks", () => {
    expect(blocksSchema.safeParse(sample).success).toBe(true);
  });

  it("rejects an unknown block type", () => {
    const result = blocksSchema.safeParse([{ id: "1", type: "not_a_block", text: "x" }]);
    expect(result.success).toBe(false);
  });

  it("rejects an image without alt text, protecting accessibility", () => {
    const result = blocksSchema.safeParse([{ id: "1", type: "image", mediaId: "m1" }]);
    expect(result.success).toBe(false);
  });

  it("rejects a heading at an unsupported level", () => {
    const result = blocksSchema.safeParse([{ id: "1", type: "heading", level: 1, text: "x" }]);
    expect(result.success).toBe(false);
  });

  it("rejects an embed with a non-URL", () => {
    const result = blocksSchema.safeParse([{ id: "1", type: "embed", url: "not-a-url" }]);
    expect(result.success).toBe(false);
  });
});
