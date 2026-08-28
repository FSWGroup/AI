'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Printer, ZoomIn, ZoomOut } from 'lucide-react';
import { Button, cx, inputClass } from '@/components/ui';
import { FilterSelect } from '@/components/ui/client';

export interface OrgNode {
  id: string;
  name: string;
  title: string;
  department: string | null;
  entity: string | null;
  managerId: string | null;
  dottedManagerId: string | null;
}

interface TreeNode extends OrgNode {
  children: TreeNode[];
  headcount: number;
}

function buildTree(nodes: OrgNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>(nodes.map((n) => [n.id, { ...n, children: [], headcount: 0 }]));
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.managerId && byId.has(node.managerId)) byId.get(node.managerId)!.children.push(node);
    else roots.push(node);
  }
  const count = (n: TreeNode): number => {
    n.headcount = n.children.reduce((sum, c) => sum + 1 + count(c), 0);
    return n.headcount;
  };
  roots.forEach(count);
  const sortRec = (list: TreeNode[]) => {
    list.sort((a, b) => b.headcount - a.headcount || a.name.localeCompare(b.name));
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

function NodeCard({
  node,
  collapsed,
  onToggle,
  highlight,
  dottedNames,
}: {
  node: TreeNode;
  collapsed: boolean;
  onToggle: () => void;
  highlight: boolean;
  dottedNames: string[];
}) {
  return (
    <div
      className={cx(
        'inline-flex min-w-52 items-center gap-2.5 rounded-card border bg-white px-3.5 py-2.5 shadow-card',
        highlight ? 'border-brand-500 ring-2 ring-brand-200' : 'border-ink-200/80',
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-800 text-[11px] font-semibold text-white" aria-hidden>
        {node.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
      </span>
      <div className="min-w-0">
        <Link href={`/people/${node.id}`} className="block truncate text-[13.5px] font-semibold text-ink-900 hover:text-brand-600">
          {node.name}
        </Link>
        <div className="truncate text-[12px] text-ink-500">{node.title}</div>
        <div className="truncate text-[11px] text-ink-400">
          {[node.entity, node.department].filter(Boolean).join(' · ')}
          {dottedNames.length ? ` · dotted: ${dottedNames.join(', ')}` : ''}
        </div>
      </div>
      {node.children.length > 0 ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? `Expand ${node.name}'s team (${node.headcount})` : `Collapse ${node.name}'s team`}
          className="ml-1 flex items-center gap-0.5 rounded px-1.5 py-1 text-[12px] font-medium text-brand-600 hover:bg-brand-50"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          {node.headcount}
        </button>
      ) : null}
    </div>
  );
}

function Subtree({
  node,
  collapsedSet,
  toggle,
  query,
  dottedFor,
}: {
  node: TreeNode;
  collapsedSet: Set<string>;
  toggle: (id: string) => void;
  query: string;
  dottedFor: (id: string) => string[];
}) {
  const collapsed = collapsedSet.has(node.id);
  const highlight = query.length > 1 && node.name.toLowerCase().includes(query.toLowerCase());
  return (
    <li className="flex flex-col items-start">
      <NodeCard node={node} collapsed={collapsed} onToggle={() => toggle(node.id)} highlight={highlight} dottedNames={dottedFor(node.id)} />
      {!collapsed && node.children.length > 0 ? (
        <ul className="mt-3 ml-6 space-y-3 border-l-2 border-ink-200 pl-6">
          {node.children.map((c) => (
            <Subtree key={c.id} node={c} collapsedSet={collapsedSet} toggle={toggle} query={query} dottedFor={dottedFor} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function OrgChartClient({
  nodes,
  entities,
  departments,
}: {
  nodes: OrgNode[];
  entities: { value: string; label: string }[];
  departments: { value: string; label: string }[];
}) {
  const [collapsedSet, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(1);

  const roots = useMemo(() => buildTree(nodes), [nodes]);
  const nameById = useMemo(() => new Map(nodes.map((n) => [n.id, n.name])), [nodes]);
  const dottedFor = (id: string) =>
    nodes.filter((n) => n.dottedManagerId === id).map((n) => nameById.get(n.id) ?? '').filter(Boolean);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Search the org chart"
          placeholder="Search people…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={cx(inputClass, 'h-9 w-56')}
        />
        <FilterSelect param="entity" allLabel="All companies" options={entities} ariaLabel="Filter by company" />
        <FilterSelect param="dept" allLabel="All departments" options={departments} ariaLabel="Filter by department" />
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}>
            <ZoomOut size={15} />
          </Button>
          <span className="w-10 text-center text-[12px] text-ink-500">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="sm" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}>
            <ZoomIn size={15} />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer size={14} /> Print / PDF
          </Button>
        </div>
      </div>
      <div className="fsw-scroll overflow-x-auto pb-4">
        <ul className="space-y-6 origin-top-left" style={{ transform: `scale(${zoom})` }}>
          {roots.map((root) => (
            <Subtree key={root.id} node={root} collapsedSet={collapsedSet} toggle={toggle} query={query} dottedFor={dottedFor} />
          ))}
        </ul>
      </div>
    </div>
  );
}
