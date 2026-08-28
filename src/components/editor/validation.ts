import type { Block } from "@/lib/content/types";

export interface BlockIssue {
  blockId: string;
  index: number;
  message: string;
  /** Blocking issues must be fixed before the SOP can be published. */
  blocking: boolean;
}

/**
 * Editor-side validation. The server (publishSop in src/lib/services/sop.ts)
 * re-checks the one blocking rule — image blocks need alt text — as the
 * source of truth; this mirrors it for immediate inline feedback, plus a set
 * of softer quality checks that don't block publishing.
 */
export function validateBlocksForPublish(blocks: Block[]): BlockIssue[] {
  const issues: BlockIssue[] = [];

  blocks.forEach((block, index) => {
    if (block.type === "image" && block.altText.trim().length === 0) {
      issues.push({ blockId: block.id, index, message: "Add alt text describing this image.", blocking: true });
    }
    if (block.type === "image" && block.mediaId.trim().length === 0) {
      issues.push({ blockId: block.id, index, message: "Choose a media file for this image.", blocking: true });
    }
    if (block.type === "file" && block.mediaId.trim().length === 0) {
      issues.push({ blockId: block.id, index, message: "Choose a file to attach.", blocking: true });
    }
    if (block.type === "table" && block.headers.length === 0) {
      issues.push({ blockId: block.id, index, message: "Add at least one column header.", blocking: false });
    }
    if (block.type === "list" && block.items.every((item) => item.trim().length === 0)) {
      issues.push({ blockId: block.id, index, message: "Add at least one list item.", blocking: false });
    }
    if (block.type === "checklist" && block.items.length === 0) {
      issues.push({ blockId: block.id, index, message: "Add at least one checklist item.", blocking: false });
    }
    if (block.type === "question" && (block.prompt.trim().length === 0 || block.options.filter((o) => o.trim()).length < 2)) {
      issues.push({ blockId: block.id, index, message: "Add a prompt and at least two answer options.", blocking: false });
    }
    if (block.type === "embed" && !/^https?:\/\//.test(block.url)) {
      issues.push({ blockId: block.id, index, message: "Embed URL must start with http:// or https://.", blocking: false });
    }
    if (block.type === "video" && !block.mediaId && !block.externalUrl) {
      issues.push({ blockId: block.id, index, message: "Add a media file or an external URL.", blocking: false });
    }
    if (block.type === "flowchart") {
      const ids = new Set(block.nodes.map((n) => n.id));
      const badEdge = block.edges.some((e) => !ids.has(e.from) || !ids.has(e.to));
      if (badEdge) {
        issues.push({ blockId: block.id, index, message: "A connection references a node that no longer exists.", blocking: false });
      }
      if (block.nodes.length === 0) {
        issues.push({ blockId: block.id, index, message: "Add at least one node.", blocking: false });
      }
    }
  });

  return issues;
}

export function hasBlockingIssues(issues: BlockIssue[]): boolean {
  return issues.some((issue) => issue.blocking);
}
