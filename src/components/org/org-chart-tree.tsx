"use client";

import { useState } from "react";
import Link from "next/link";
import { PersonAvatar } from "@/components/people/avatar";
import { Glyph } from "@/components/icons";
import type { OrgChartNode } from "@/lib/services/org";

/**
 * The toggle button and the profile link are siblings, never nested — nesting
 * an `<a>` inside an interactive toggle control is an accessibility
 * anti-pattern (ambiguous hit-testing and keyboard focus order).
 */
export function OrgChartTree({ nodes }: { nodes: OrgChartNode[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {nodes.map((node) => (
        <li key={node.id}>
          <OrgChartNodeItem node={node} depth={0} />
        </li>
      ))}
    </ul>
  );
}

function OrgChartNodeItem({ node, depth }: { node: OrgChartNode; depth: number }) {
  const hasChildren = node.children.length > 0;
  const [open, setOpen] = useState(depth < 2);

  return (
    <div>
      <div
        className="flex items-center gap-2 rounded-md py-1.5 pr-2 hover:bg-[var(--surface-sunken)]"
        style={{ paddingLeft: `${depth * 1.25}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${node.name}'s reports`}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-card)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <Glyph name={open ? "chevron-down" : "chevron-right"} className="h-4 w-4" />
          </button>
        ) : (
          <span className="w-6 shrink-0" aria-hidden="true" />
        )}

        <PersonAvatar name={node.name} image={node.image} size={28} />
        <Link
          href={`/people/${node.id}`}
          className="min-w-0 flex-1 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          <span className="block truncate text-[0.8125rem] font-medium text-[var(--text-primary)] hover:underline">
            {node.name}
          </span>
          <span className="block truncate text-[0.75rem] text-[var(--text-muted)]">
            {node.title ?? "—"}
            {node.departmentName ? ` · ${node.departmentName}` : ""}
          </span>
        </Link>
        {hasChildren && (
          <span className="shrink-0 rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[0.6875rem] text-[var(--text-muted)]">
            {node.directReportCount} report{node.directReportCount === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {hasChildren && open && (
        <ul className="flex flex-col gap-1 border-l border-[var(--border-subtle)]" style={{ marginLeft: `${depth * 1.25 + 0.75}rem` }}>
          {node.children.map((child) => (
            <li key={child.id}>
              <OrgChartNodeItem node={child} depth={depth + 1} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
