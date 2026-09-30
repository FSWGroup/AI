import Link from "next/link";
import type { Citation } from "@wpi/core";
import { Badge } from "./Badge";

export function CitationList({ citations, compact = false }: { citations: Citation[] | undefined | null; compact?: boolean }) {
  if (!citations || citations.length === 0) return <span className="text-slate-400">no citations</span>;
  return (
    <ul className={`space-y-1 ${compact ? "text-[11.5px]" : "text-xs"}`}>
      {citations.map((c, i) => (
        <li key={`${c.sourceRecordId}-${i}`} className="rounded border border-slate-200 bg-slate-50 p-1.5">
          <div className="flex flex-wrap items-center gap-1">
            <Link href={`/sources/record/${c.sourceRecordId}`} className="font-medium">{c.label}</Link>
            <Badge tone="blue">{c.sourceType}</Badge>
            <Badge tone="neutral" title="authority level (1 = highest precedence)">auth L{c.authorityLevel}</Badge>
            {c.isFixture ? <Badge tone="amber">FIXTURE</Badge> : null}
            {c.pageNumber != null ? <Badge tone="neutral">p.{c.pageNumber}</Badge> : null}
            {c.asOf ? <Badge tone="neutral">as of {String(c.asOf).slice(0, 19)}</Badge> : null}
          </div>
          {c.supportingText ? <blockquote className="mt-1 border-l-2 border-slate-300 pl-2 text-slate-700 whitespace-pre-wrap">{c.supportingText}</blockquote> : null}
        </li>
      ))}
    </ul>
  );
}

/** Collapsible citation count → list. */
export function CitationsDisclosure({ citations }: { citations: Citation[] | undefined | null }) {
  const n = citations?.length ?? 0;
  if (!n) return <span className="text-slate-400">0</span>;
  return (
    <details>
      <summary>{n} citation{n === 1 ? "" : "s"}</summary>
      <div className="mt-1 max-w-2xl"><CitationList citations={citations} compact /></div>
    </details>
  );
}
