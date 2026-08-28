import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import type { Block } from "@/lib/content/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Glyph, Icon } from "@/components/icons";

/**
 * Static (non-interactive) block views plus the shared inline-markdown parser
 * and the block-list dispatcher.
 *
 * Deliberately has no "use client" directive: everything here is a plain
 * function component with no hooks, so it can be imported from a real Server
 * Component (the SOP reader page) with zero extra client JS, or from a client
 * component (the block editor's live preview) where it just behaves like an
 * ordinary component. The three genuinely interactive block types (checklist,
 * tabs, question) are NOT implemented here — they are injected via
 * `InteractiveRenderers` so this module never needs to import client code.
 */

type Extracted<T extends Block["type"]> = Extract<Block, { type: T }>;

// ---------------------------------------------------------------------------
// Inline markdown: **bold**, *italic*, `code`, [text](url). No HTML parsing,
// no dangerouslySetInnerHTML — output is always real React text/elements, so
// there is nothing to sanitize; React escapes text nodes automatically.
// ---------------------------------------------------------------------------

const INLINE_PATTERN = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\))/g;

export function renderInlineText(text: string, keyPrefix = "t"): ReactNode[] {
  if (!text) return [];
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let counter = 0;
  const pattern = new RegExp(INLINE_PATTERN);
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const full = match[0];
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const code = match[1];
    const bold = match[2];
    const italic = match[3];
    const link = match[4];
    counter += 1;
    const key = `${keyPrefix}-${counter}`;

    if (code) {
      nodes.push(
        <code key={key} className="rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 font-mono text-[0.875em]">
          {code.slice(1, -1)}
        </code>,
      );
    } else if (bold) {
      nodes.push(<strong key={key}>{renderInlineText(bold.slice(2, -2), key)}</strong>);
    } else if (italic) {
      nodes.push(<em key={key}>{renderInlineText(italic.slice(1, -1), key)}</em>);
    } else if (link) {
      const parsed = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(full);
      const label = parsed?.[1] ?? full;
      const href = parsed?.[2] ?? "#";
      const external = href.startsWith("http");
      nodes.push(
        external ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--brand-secondary)] underline underline-offset-2"
          >
            {label}
            <Glyph name="external" className="ml-0.5 inline h-3 w-3 align-text-top" />
          </a>
        ) : (
          <Link key={key} href={href} className="text-[var(--brand-secondary)] underline underline-offset-2">
            {label}
          </Link>
        ),
      );
    }
    lastIndex = match.index + full.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

// ---------------------------------------------------------------------------
// Individual block views
// ---------------------------------------------------------------------------

function HeadingView({ block }: { block: Extracted<"heading"> }) {
  const Tag = block.level === 2 ? "h2" : block.level === 3 ? "h3" : "h4";
  return <Tag>{renderInlineText(block.text, block.id)}</Tag>;
}

function ParagraphView({ block }: { block: Extracted<"paragraph"> }) {
  return <p>{renderInlineText(block.text, block.id)}</p>;
}

function ListView({ block }: { block: Extracted<"list"> }) {
  if (block.items.length === 0) return null;
  const Tag = block.ordered ? "ol" : "ul";
  return (
    <Tag>
      {block.items.map((item, index) => (
        <li key={`${block.id}-${index}`}>{renderInlineText(item, `${block.id}-${index}`)}</li>
      ))}
    </Tag>
  );
}

function TableView({ block }: { block: Extracted<"table"> }) {
  return (
    <div className="overflow-x-auto">
      <table>
        {block.caption && <caption className="mb-2 text-left text-[0.8125rem] text-[var(--text-muted)]">{block.caption}</caption>}
        <thead>
          <tr>
            {block.headers.map((header, index) => (
              <th key={`${block.id}-h-${index}`} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={`${block.id}-r-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${block.id}-r-${rowIndex}-c-${cellIndex}`}>{renderInlineText(cell, `${block.id}-${rowIndex}-${cellIndex}`)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CALLOUT_STYLES: Record<Extracted<"callout">["tone"], { container: string; label: string }> = {
  info: { container: "border-info-100 bg-info-50 text-info-700", label: "Info" },
  tip: { container: "border-success-100 bg-success-50 text-success-700", label: "Tip" },
  note: { container: "border-steel-200 bg-steel-100 text-steel-700", label: "Note" },
};

function CalloutView({ block }: { block: Extracted<"callout"> }) {
  const style = CALLOUT_STYLES[block.tone];
  return (
    <div role="note" className={cn("not-prose my-4 flex gap-3 rounded-md border px-4 py-3", style.container)}>
      <Icon name="knowledge" className="mt-0.5 h-4.5 w-4.5 shrink-0" />
      <div>
        <p className="mb-0.5 text-[0.8125rem] font-semibold">{block.title || style.label}</p>
        <p className="text-[0.875rem] leading-relaxed">{renderInlineText(block.text, block.id)}</p>
      </div>
    </div>
  );
}

const WARNING_STYLES: Record<Extracted<"warning">["severity"], { container: string; label: string }> = {
  caution: { container: "border-warning-100 bg-warning-50 text-warning-700", label: "Caution" },
  warning: { container: "border-warning-100 bg-warning-50 text-warning-700", label: "Warning" },
  danger: { container: "border-danger-100 bg-danger-50 text-danger-700", label: "Danger" },
};

function WarningView({ block }: { block: Extracted<"warning"> }) {
  const style = WARNING_STYLES[block.severity];
  return (
    <div role="note" className={cn("not-prose my-4 flex gap-3 rounded-md border px-4 py-3", style.container)}>
      <Glyph name="alert" className="mt-0.5 h-4.5 w-4.5 shrink-0" />
      <div>
        <p className="mb-0.5 text-[0.8125rem] font-semibold">
          {style.label}
          {block.title ? `: ${block.title}` : ""}
        </p>
        <p className="text-[0.875rem] leading-relaxed">{renderInlineText(block.text, block.id)}</p>
      </div>
    </div>
  );
}

function ImageView({ block }: { block: Extracted<"image"> }) {
  return (
    <figure className="not-prose my-4">
      { }
      <img
        src={`/api/media/${block.mediaId}`}
        alt={block.altText}
        className="w-full rounded-md border border-[var(--border-subtle)]"
      />
      {block.caption && (
        <figcaption className="mt-1.5 text-[0.8125rem] text-[var(--text-muted)]">{block.caption}</figcaption>
      )}
    </figure>
  );
}

function VideoView({ block }: { block: Extracted<"video"> }) {
  return (
    <figure className="not-prose my-4">
      {block.mediaId ? (
        <video controls className="w-full rounded-md border border-[var(--border-subtle)]" src={`/api/media/${block.mediaId}`}>
          <track kind="captions" src={`/api/media/${block.mediaId}/captions.vtt`} srcLang="en" label="English captions" default />
          Your browser does not support embedded video.{" "}
          <a href={`/api/media/${block.mediaId}`}>Download the video</a> instead.
        </video>
      ) : block.externalUrl ? (
        <a
          href={block.externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3.5 py-2.5 text-[0.875rem] font-medium text-[var(--brand-secondary)] hover:bg-[var(--surface-sunken)]"
        >
          <Glyph name="play" className="h-4 w-4" />
          {block.title || "Watch video"}
          <Glyph name="external" className="h-3.5 w-3.5" />
        </a>
      ) : (
        <p className="text-[0.8125rem] text-[var(--text-muted)]">No video source is configured for this block.</p>
      )}
      {block.caption && <figcaption className="mt-1.5 text-[0.8125rem] text-[var(--text-muted)]">{block.caption}</figcaption>}
    </figure>
  );
}

function FileView({ block }: { block: Extracted<"file"> }) {
  return (
    <a
      href={`/api/media/${block.mediaId}`}
      download
      className="not-prose my-3 flex items-center gap-2.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3.5 py-2.5 text-[0.875rem] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-sunken)]"
    >
      <Glyph name="download" className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
      {block.label || "Download attachment"}
    </a>
  );
}

function EmbedView({ block }: { block: Extracted<"embed"> }) {
  return (
    <div className="not-prose my-4 overflow-hidden rounded-md border border-[var(--border-subtle)]">
      <iframe
        src={block.url}
        title={block.title || "Embedded content"}
        style={{ height: block.height }}
        className="w-full"
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      />
    </div>
  );
}

function truncateLabel(label: string, max = 26): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function FlowchartView({ block }: { block: Extracted<"flowchart"> }) {
  const rowHeight = 78;
  const nodeWidth = 220;
  const nodeHeight = 44;
  const width = 320;
  const height = Math.max(rowHeight, block.nodes.length * rowHeight);
  const indexOf = new Map(block.nodes.map((node, index) => [node.id, index]));
  const titleId = `flowchart-title-${block.id}`;
  const markerId = `flowchart-arrow-${block.id}`;

  return (
    <figure className="not-prose my-4">
      {block.title && <figcaption className="mb-2 text-[0.875rem] font-semibold text-[var(--text-primary)]">{block.title}</figcaption>}
      <div className="overflow-x-auto rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4">
        <svg
          viewBox={`0 0 ${width + 140} ${height}`}
          role="img"
          aria-labelledby={titleId}
          className="mx-auto block h-auto"
          style={{ width: Math.min(width + 140, 460) }}
        >
          <title id={titleId}>{block.title ? `Flowchart: ${block.title}` : "Flowchart"}</title>
          <defs>
            <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" className="fill-[var(--border-strong)]" />
            </marker>
          </defs>
          <g>
            {block.edges.map((edge, i) => {
              const fromIdx = indexOf.get(edge.from);
              const toIdx = indexOf.get(edge.to);
              if (fromIdx === undefined || toIdx === undefined) return null;
              const cx = width / 2;
              const adjacent = toIdx === fromIdx + 1;
              const fromCy = fromIdx * rowHeight + rowHeight / 2;
              const toCy = toIdx * rowHeight + rowHeight / 2;
              const path = adjacent
                ? `M ${cx} ${fromCy + nodeHeight / 2} L ${cx} ${toCy - nodeHeight / 2}`
                : `M ${cx + nodeWidth / 2} ${fromCy} C ${cx + nodeWidth / 2 + 56} ${fromCy}, ${cx + nodeWidth / 2 + 56} ${toCy}, ${cx + nodeWidth / 2 + 4} ${toCy}`;
              const labelX = adjacent ? cx + 8 : cx + nodeWidth / 2 + 30;
              const labelY = adjacent ? (fromCy + toCy) / 2 : (fromCy + toCy) / 2;
              return (
                <g key={`${block.id}-e-${i}`}>
                  <path d={path} fill="none" className="stroke-[var(--border-strong)]" strokeWidth={1.5} markerEnd={`url(#${markerId})`} />
                  {edge.label && (
                    <text x={labelX} y={labelY} className="fill-[var(--text-muted)] text-[9px]">
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
          <g>
            {block.nodes.map((node, i) => {
              const cx = width / 2;
              const cy = i * rowHeight + rowHeight / 2;
              return (
                <g key={node.id}>
                  <title>{node.label}</title>
                  {node.kind === "decision" ? (
                    <polygon
                      points={`${cx},${cy - nodeHeight / 2} ${cx + nodeWidth / 2},${cy} ${cx},${cy + nodeHeight / 2} ${cx - nodeWidth / 2},${cy}`}
                      className="fill-[var(--surface-card)] stroke-[var(--brand-secondary)]"
                      strokeWidth={1.5}
                    />
                  ) : node.kind === "start" || node.kind === "end" ? (
                    <rect
                      x={cx - nodeWidth / 2}
                      y={cy - nodeHeight / 2}
                      width={nodeWidth}
                      height={nodeHeight}
                      rx={nodeHeight / 2}
                      className="fill-[var(--surface-card)] stroke-[var(--brand-primary)]"
                      strokeWidth={1.5}
                    />
                  ) : (
                    <rect
                      x={cx - nodeWidth / 2}
                      y={cy - nodeHeight / 2}
                      width={nodeWidth}
                      height={nodeHeight}
                      rx={6}
                      className="fill-[var(--surface-card)] stroke-[var(--border-strong)]"
                      strokeWidth={1.5}
                    />
                  )}
                  <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" className="fill-[var(--text-primary)] text-[11px] font-medium">
                    {truncateLabel(node.label)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <ol className="sr-only">
        {block.nodes
          .filter((node) => node.kind === "start")
          .map((node) => (
            <li key={`start-${node.id}`}>{`Start: ${node.label}.`}</li>
          ))}
        {block.edges.map((edge, i) => {
          const from = block.nodes.find((n) => n.id === edge.from)?.label ?? edge.from;
          const to = block.nodes.find((n) => n.id === edge.to)?.label ?? edge.to;
          return (
            <li key={`transition-${i}`}>
              {`From "${from}", ${edge.label ? `when ${edge.label}, ` : ""}go to "${to}".`}
            </li>
          );
        })}
        {block.nodes
          .filter((node) => node.kind === "end")
          .map((node) => (
            <li key={`end-${node.id}`}>{`End: ${node.label}.`}</li>
          ))}
      </ol>
    </figure>
  );
}

function CodeView({ block }: { block: Extracted<"code"> }) {
  return (
    <div className="not-prose my-4 overflow-hidden rounded-md border border-[var(--border-subtle)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {block.language || "text"}
      </div>
      <pre className="overflow-x-auto px-3.5 py-3 text-[0.8125rem] leading-relaxed">
        <code className="font-mono">{block.code}</code>
      </pre>
    </div>
  );
}

function AccordionView({ block }: { block: Extracted<"accordion"> }) {
  return (
    <div className="not-prose my-4 flex flex-col gap-2">
      {block.sections.map((section) => (
        <details key={section.id} className="rounded-md border border-[var(--border-subtle)] px-4 py-2.5">
          <summary className="cursor-pointer text-[0.9375rem] font-semibold text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
            {section.title}
          </summary>
          <div className="prose-fsw mt-2 text-[0.875rem]">
            <p>{renderInlineText(section.text, section.id)}</p>
          </div>
        </details>
      ))}
    </div>
  );
}

function relatedHref(entityType: Extracted<"related">["items"][number]["entityType"], entityId: string): string {
  switch (entityType) {
    case "SOP":
      return `/sops/${entityId}`;
    case "COURSE":
      return `/courses/${entityId}`;
    case "LEARNING_PATH":
      return `/paths/${entityId}`;
    default:
      return "#";
  }
}

function RelatedView({ block }: { block: Extracted<"related"> }) {
  if (block.items.length === 0) return null;
  return (
    <div className="not-prose my-4 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4">
      <p className="mb-2 text-[0.8125rem] font-semibold text-[var(--text-primary)]">{block.title || "Related"}</p>
      <ul className="flex flex-col gap-1.5">
        {block.items.map((item, index) => (
          <li key={`${block.id}-${index}`}>
            <Link
              href={relatedHref(item.entityType, item.entityId)}
              className="inline-flex items-center gap-1.5 text-[0.875rem] text-[var(--brand-secondary)] hover:underline"
            >
              {item.label}
              <Glyph name="arrow-right" className="h-3.5 w-3.5" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AiExplanationView({ block }: { block: Extracted<"ai_explanation"> }) {
  return (
    <div className="not-prose my-4 rounded-md border border-signal-200 bg-signal-50 px-4 py-3">
      <div className="mb-1.5 flex items-center gap-2">
        <Badge tone="accent">
          <Icon name="ai" className="h-3.5 w-3.5" />
          AI-generated
        </Badge>
        {block.reviewedBy && <span className="text-[0.75rem] text-[var(--text-muted)]">Reviewed by {block.reviewedBy}</span>}
      </div>
      <p className="text-[0.875rem] leading-relaxed text-[var(--text-primary)]">{renderInlineText(block.text, block.id)}</p>
    </div>
  );
}

function DividerView() {
  return <hr className="my-6 border-[var(--border-subtle)]" />;
}

// ---------------------------------------------------------------------------
// Dispatcher shared by the server BlockRenderer and the client
// BlockRendererClient. Interactive block types are rendered via injected
// components so this file never needs to import client code.
// ---------------------------------------------------------------------------

export interface InteractiveRenderers {
  Checklist: ComponentType<{
    block: Extracted<"checklist">;
    initialChecked?: string[];
    onChange?: (checkedItemIds: string[]) => void;
  }>;
  Tabs: ComponentType<{ block: Extracted<"tabs"> }>;
  Question: ComponentType<{ block: Extracted<"question"> }>;
}

export interface RenderBlockListOptions {
  onChecklistChange?: (blockId: string, checkedItemIds: string[]) => void;
  checklistState?: Record<string, string[]>;
}

export function renderBlockList(
  blocks: Block[],
  interactive: InteractiveRenderers,
  options: RenderBlockListOptions = {},
): ReactNode[] {
  return blocks.map((block, index) => {
    const key = `${block.id || "block"}-${index}`;
    switch (block.type) {
      case "heading":
        return <HeadingView key={key} block={block} />;
      case "paragraph":
        return <ParagraphView key={key} block={block} />;
      case "list":
        return <ListView key={key} block={block} />;
      case "table":
        return <TableView key={key} block={block} />;
      case "callout":
        return <CalloutView key={key} block={block} />;
      case "warning":
        return <WarningView key={key} block={block} />;
      case "image":
        return <ImageView key={key} block={block} />;
      case "video":
        return <VideoView key={key} block={block} />;
      case "file":
        return <FileView key={key} block={block} />;
      case "embed":
        return <EmbedView key={key} block={block} />;
      case "flowchart":
        return <FlowchartView key={key} block={block} />;
      case "code":
        return <CodeView key={key} block={block} />;
      case "accordion":
        return <AccordionView key={key} block={block} />;
      case "related":
        return <RelatedView key={key} block={block} />;
      case "ai_explanation":
        return <AiExplanationView key={key} block={block} />;
      case "divider":
        return <DividerView key={key} />;
      case "checklist": {
        const Checklist = interactive.Checklist;
        return (
          <Checklist
            key={key}
            block={block}
            initialChecked={options.checklistState?.[block.id]}
            onChange={options.onChecklistChange ? (ids) => options.onChecklistChange?.(block.id, ids) : undefined}
          />
        );
      }
      case "tabs": {
        const Tabs = interactive.Tabs;
        return <Tabs key={key} block={block} />;
      }
      case "question": {
        const Question = interactive.Question;
        return <Question key={key} block={block} />;
      }
      default:
        return null;
    }
  });
}
