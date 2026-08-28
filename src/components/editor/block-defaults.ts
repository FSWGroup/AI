import type { Block, BlockType } from "@/lib/content/types";

/** Human labels for the "+ Add block" menu and block-card headers. */
export const BLOCK_LABELS: Record<BlockType, string> = {
  heading: "Heading",
  paragraph: "Paragraph",
  list: "List",
  table: "Table",
  callout: "Callout",
  warning: "Warning",
  image: "Image",
  video: "Video",
  file: "File attachment",
  embed: "Embed",
  flowchart: "Flowchart",
  checklist: "Checklist",
  code: "Code",
  accordion: "Accordion",
  tabs: "Tabs",
  related: "Related links",
  question: "Knowledge check",
  ai_explanation: "AI explanation",
  divider: "Divider",
};

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** A minimal, schema-valid block of the given type, ready to edit. */
export function createEmptyBlock(type: BlockType): Block {
  const id = newId();
  switch (type) {
    case "heading":
      return { id, type, level: 2, text: "" };
    case "paragraph":
      return { id, type, text: "" };
    case "list":
      return { id, type, ordered: false, items: [""] };
    case "table":
      return { id, type, headers: ["Column 1", "Column 2"], rows: [["", ""]] };
    case "callout":
      return { id, type, tone: "info", text: "" };
    case "warning":
      return { id, type, severity: "warning", text: "" };
    case "image":
      return { id, type, mediaId: "", altText: "" };
    case "video":
      return { id, type };
    case "file":
      return { id, type, mediaId: "" };
    case "embed":
      return { id, type, url: "", height: 420 };
    case "flowchart": {
      const startId = newId();
      const endId = newId();
      return {
        id,
        type,
        nodes: [
          { id: startId, label: "Start", kind: "start" },
          { id: endId, label: "End", kind: "end" },
        ],
        edges: [{ from: startId, to: endId }],
      };
    }
    case "checklist":
      return { id, type, items: [{ id: newId(), text: "" }], requireAll: true };
    case "code":
      return { id, type, language: "text", code: "" };
    case "accordion":
      return { id, type, sections: [{ id: newId(), title: "Section 1", text: "" }] };
    case "tabs":
      return { id, type, tabs: [{ id: newId(), label: "Tab 1", text: "" }] };
    case "related":
      return { id, type, items: [] };
    case "question":
      return { id, type, prompt: "", options: ["", ""], correctIndex: 0 };
    case "ai_explanation":
      return { id, type, text: "" };
    case "divider":
      return { id, type };
  }
}

export { newId };
