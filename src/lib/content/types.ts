import { z } from "zod";

/**
 * Block content model, shared by SOPs and rich-text lessons.
 *
 * One content model serves the whole platform: an SOP body, a lesson body, and
 * the source text handed to AI and search are the same blocks. That is what
 * makes "SOP + training + searchable knowledge + video" one artifact rather
 * than five copies.
 */

export const BLOCK_TYPES = [
  "heading",
  "paragraph",
  "list",
  "table",
  "callout",
  "warning",
  "image",
  "video",
  "file",
  "embed",
  "flowchart",
  "checklist",
  "code",
  "accordion",
  "tabs",
  "related",
  "question",
  "ai_explanation",
  "divider",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

const baseBlock = z.object({
  id: z.string().min(1),
});

export const headingBlockSchema = baseBlock.extend({
  type: z.literal("heading"),
  level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  text: z.string(),
});

export const paragraphBlockSchema = baseBlock.extend({
  type: z.literal("paragraph"),
  /** Limited inline markdown: **bold**, *italic*, `code`, [text](url) */
  text: z.string(),
});

export const listBlockSchema = baseBlock.extend({
  type: z.literal("list"),
  ordered: z.boolean().default(false),
  items: z.array(z.string()),
});

export const tableBlockSchema = baseBlock.extend({
  type: z.literal("table"),
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  caption: z.string().optional(),
});

export const calloutBlockSchema = baseBlock.extend({
  type: z.literal("callout"),
  tone: z.enum(["info", "tip", "note"]).default("info"),
  title: z.string().optional(),
  text: z.string(),
});

export const warningBlockSchema = baseBlock.extend({
  type: z.literal("warning"),
  severity: z.enum(["caution", "warning", "danger"]).default("warning"),
  title: z.string().optional(),
  text: z.string(),
});

export const imageBlockSchema = baseBlock.extend({
  type: z.literal("image"),
  mediaId: z.string(),
  /** Required for WCAG 1.1.1; the editor blocks publishing without it. */
  altText: z.string(),
  caption: z.string().optional(),
});

export const videoBlockSchema = baseBlock.extend({
  type: z.literal("video"),
  mediaId: z.string().optional(),
  externalUrl: z.string().url().optional(),
  title: z.string().optional(),
  caption: z.string().optional(),
});

export const fileBlockSchema = baseBlock.extend({
  type: z.literal("file"),
  mediaId: z.string(),
  label: z.string().optional(),
});

export const embedBlockSchema = baseBlock.extend({
  type: z.literal("embed"),
  url: z.string().url(),
  title: z.string().optional(),
  height: z.number().int().min(120).max(1200).default(420),
});

export const flowchartBlockSchema = baseBlock.extend({
  type: z.literal("flowchart"),
  title: z.string().optional(),
  /** Node/edge graph rendered as accessible SVG plus a text fallback list. */
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      kind: z.enum(["start", "step", "decision", "end"]).default("step"),
    }),
  ),
  edges: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      label: z.string().optional(),
    }),
  ),
});

export const checklistBlockSchema = baseBlock.extend({
  type: z.literal("checklist"),
  title: z.string().optional(),
  items: z.array(z.object({ id: z.string(), text: z.string() })),
  /** When true, a learner must check every item before the lesson completes. */
  requireAll: z.boolean().default(true),
});

export const codeBlockSchema = baseBlock.extend({
  type: z.literal("code"),
  language: z.string().default("text"),
  code: z.string(),
});

export const accordionBlockSchema = baseBlock.extend({
  type: z.literal("accordion"),
  sections: z.array(z.object({ id: z.string(), title: z.string(), text: z.string() })),
});

export const tabsBlockSchema = baseBlock.extend({
  type: z.literal("tabs"),
  tabs: z.array(z.object({ id: z.string(), label: z.string(), text: z.string() })),
});

export const relatedBlockSchema = baseBlock.extend({
  type: z.literal("related"),
  title: z.string().optional(),
  items: z.array(
    z.object({
      entityType: z.enum(["SOP", "COURSE", "LEARNING_PATH"]),
      entityId: z.string(),
      label: z.string(),
    }),
  ),
});

export const questionBlockSchema = baseBlock.extend({
  type: z.literal("question"),
  prompt: z.string(),
  options: z.array(z.string()),
  correctIndex: z.number().int().min(0),
  explanation: z.string().optional(),
});

export const aiExplanationBlockSchema = baseBlock.extend({
  type: z.literal("ai_explanation"),
  text: z.string(),
  /** Always rendered with an AI-generated marker so readers can judge it. */
  reviewedBy: z.string().optional(),
});

export const dividerBlockSchema = baseBlock.extend({
  type: z.literal("divider"),
});

export const blockSchema = z.discriminatedUnion("type", [
  headingBlockSchema,
  paragraphBlockSchema,
  listBlockSchema,
  tableBlockSchema,
  calloutBlockSchema,
  warningBlockSchema,
  imageBlockSchema,
  videoBlockSchema,
  fileBlockSchema,
  embedBlockSchema,
  flowchartBlockSchema,
  checklistBlockSchema,
  codeBlockSchema,
  accordionBlockSchema,
  tabsBlockSchema,
  relatedBlockSchema,
  questionBlockSchema,
  aiExplanationBlockSchema,
  dividerBlockSchema,
]);

export type Block = z.infer<typeof blockSchema>;
export const blocksSchema = z.array(blockSchema);

/** Structured SOP metadata beyond the block body. */
export const sopMetaSchema = z.object({
  purpose: z.string().default(""),
  scope: z.string().default(""),
  definitions: z.array(z.object({ term: z.string(), definition: z.string() })).default([]),
  prerequisites: z.array(z.string()).default([]),
  requiredTools: z.array(z.string()).default([]),
  safetyConsiderations: z.string().default(""),
  troubleshooting: z
    .array(z.object({ problem: z.string(), resolution: z.string() }))
    .default([]),
  exceptions: z.string().default(""),
  relatedSopIds: z.array(z.string()).default([]),
  relatedCourseIds: z.array(z.string()).default([]),
  externalLinks: z.array(z.object({ label: z.string(), url: z.string() })).default([]),
});

export type SopMeta = z.infer<typeof sopMetaSchema>;

export const EMPTY_SOP_META: SopMeta = {
  purpose: "",
  scope: "",
  definitions: [],
  prerequisites: [],
  requiredTools: [],
  safetyConsiderations: "",
  troubleshooting: [],
  exceptions: "",
  relatedSopIds: [],
  relatedCourseIds: [],
  externalLinks: [],
};

/**
 * Flatten blocks into plain text for search indexing, RAG chunking, and AI
 * source material. Never includes author-only comment threads.
 */
export function blocksToPlainText(blocks: Block[]): string {
  const lines: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        lines.push(`\n${"#".repeat(block.level)} ${block.text}`);
        break;
      case "paragraph":
        lines.push(block.text);
        break;
      case "list":
        block.items.forEach((item, index) => {
          lines.push(block.ordered ? `${index + 1}. ${item}` : `- ${item}`);
        });
        break;
      case "table":
        lines.push(block.headers.join(" | "));
        block.rows.forEach((row) => lines.push(row.join(" | ")));
        if (block.caption) lines.push(block.caption);
        break;
      case "callout":
      case "warning":
        lines.push(`${block.title ? `${block.title}: ` : ""}${block.text}`);
        break;
      case "image":
        lines.push(block.caption ? `[Image: ${block.altText}. ${block.caption}]` : `[Image: ${block.altText}]`);
        break;
      case "video":
        if (block.title) lines.push(`[Video: ${block.title}]`);
        break;
      case "file":
        if (block.label) lines.push(`[Attachment: ${block.label}]`);
        break;
      case "embed":
        if (block.title) lines.push(`[Embedded: ${block.title}]`);
        break;
      case "flowchart":
        if (block.title) lines.push(block.title);
        block.edges.forEach((edge) => {
          const from = block.nodes.find((n) => n.id === edge.from)?.label ?? edge.from;
          const to = block.nodes.find((n) => n.id === edge.to)?.label ?? edge.to;
          lines.push(`${from} → ${to}${edge.label ? ` (${edge.label})` : ""}`);
        });
        break;
      case "checklist":
        if (block.title) lines.push(block.title);
        block.items.forEach((item) => lines.push(`- [ ] ${item.text}`));
        break;
      case "code":
        lines.push(block.code);
        break;
      case "accordion":
        block.sections.forEach((section) => lines.push(`${section.title}: ${section.text}`));
        break;
      case "tabs":
        block.tabs.forEach((tab) => lines.push(`${tab.label}: ${tab.text}`));
        break;
      case "related":
        block.items.forEach((item) => lines.push(`Related: ${item.label}`));
        break;
      case "question":
        lines.push(`Question: ${block.prompt}`);
        lines.push(`Answer: ${block.options[block.correctIndex] ?? ""}`);
        if (block.explanation) lines.push(block.explanation);
        break;
      case "ai_explanation":
        lines.push(block.text);
        break;
      case "divider":
        break;
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Split blocks into retrieval chunks that keep their heading path, so a
 * citation can say "SOP OPS-014, Procedure > Step 4" and link precisely.
 */
export function blocksToChunks(
  blocks: Block[],
  maxChars = 1400,
): { sectionPath: string; content: string }[] {
  const chunks: { sectionPath: string; content: string }[] = [];
  let headingPath: string[] = [];
  let buffer: Block[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const text = blocksToPlainText(buffer);
    if (text.trim().length > 0) {
      chunks.push({ sectionPath: headingPath.join(" > "), content: text });
    }
    buffer = [];
  };

  for (const block of blocks) {
    if (block.type === "heading") {
      flush();
      // Maintain the heading hierarchy: level 2 resets, 3 and 4 nest.
      const depth = block.level - 2;
      headingPath = [...headingPath.slice(0, depth), block.text];
      continue;
    }

    buffer.push(block);
    if (blocksToPlainText(buffer).length >= maxChars) flush();
  }

  flush();
  return chunks;
}

/** Estimated reading time in minutes, used for course duration defaults. */
export function estimateReadingMinutes(blocks: Block[]): number {
  const words = blocksToPlainText(blocks).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** Collect every external URL referenced by the blocks, for link checking. */
export function extractLinks(blocks: Block[]): string[] {
  const urls = new Set<string>();
  const markdownLink = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;

  for (const block of blocks) {
    if (block.type === "embed") urls.add(block.url);
    if (block.type === "video" && block.externalUrl) urls.add(block.externalUrl);
    const text =
      block.type === "paragraph" || block.type === "callout" || block.type === "warning"
        ? block.text
        : "";
    for (const match of text.matchAll(markdownLink)) {
      if (match[1]) urls.add(match[1]);
    }
  }
  return [...urls];
}
