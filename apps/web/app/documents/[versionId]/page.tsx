import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { Badge } from "@/components/Badge";
import { fmtDate } from "@/lib/format";

function highlight(text: string, term: string): ReactNode {
  if (!term) return text;
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${esc})`, "ig"));
  return parts.map((p, i) => (p.toLowerCase() === term.toLowerCase() ? <mark key={i} className="bg-yellow-200">{p}</mark> : p));
}

export default async function DocumentViewer({ params, searchParams }: { params: Promise<{ versionId: string }>; searchParams: Promise<{ page?: string; q?: string }> }) {
  const { versionId } = await params;
  const { page, q } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) notFound();
  const sql = db();
  const [dv] = await sql`SELECT dv.*, d.title, d.document_number, d.document_type, m.name AS manufacturer, s.name AS source_name, s.is_fixture, s.authority_level FROM document_versions dv JOIN documents d ON d.id = dv.document_id LEFT JOIN manufacturers m ON m.id = d.manufacturer_id JOIN sources s ON s.id = d.source_id WHERE dv.id = ${versionId}`;
  if (!dv) notFound();
  const pages = await sql`SELECT p.page_number, p.text, r.id AS source_record_id FROM document_pages p LEFT JOIN source_records r ON r.document_version_id = p.document_version_id AND r.page_number = p.page_number WHERE p.document_version_id = ${versionId} ORDER BY p.page_number`;
  const term = (q ?? "").trim().slice(0, 100);
  const requested = Number(page);
  const current = pages.find((p) => p.pageNumber === requested) ?? (term ? pages.find((p) => String(p.text).toLowerCase().includes(term.toLowerCase())) : undefined) ?? pages[0];
  const others = await sql`SELECT id, revision, is_current FROM document_versions WHERE document_id = ${dv.documentId} ORDER BY ingested_at DESC`;
  const href = (n: number) => `/documents/${versionId}?page=${n}${term ? `&q=${encodeURIComponent(term)}` : ""}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1>{dv.title}</h1>
        <Badge tone="neutral">{dv.documentType}</Badge>
        <span className="mono">{dv.documentNumber ?? ""} Rev {dv.revision}</span>
        {dv.isCurrent ? <Badge tone="green">current</Badge> : <Badge tone="red">SUPERSEDED — not answerable</Badge>}
        {dv.isFixture ? <Badge tone="amber">FIXTURE</Badge> : null}
        <Link href="/documents" className="ml-auto">← documents</Link>
      </div>
      <div className="text-slate-500">
        {dv.manufacturer ?? "—"} · source {dv.sourceName} (auth L{dv.authorityLevel}) · published {dv.publicationDate ? String(dv.publicationDate).slice(0, 10) : "?"} · ingested {fmtDate(dv.ingestedAt)} · verified {fmtDate(dv.lastVerifiedAt)} · checksum <span className="mono">{String(dv.checksum).slice(0, 16)}</span> · {dv.storageUri ?? ""}
        {others.length > 1 ? <span> · other revisions: {others.filter((o) => o.id !== versionId).map((o) => <Link key={o.id} href={`/documents/${o.id}`} className="mono ml-1">Rev {o.revision}{o.isCurrent ? " (current)" : ""}</Link>)}</span> : null}
      </div>
      <form method="get" className="flex items-center gap-2">
        <input type="hidden" name="page" value={current?.pageNumber ?? 1} />
        <input type="search" name="q" defaultValue={term} placeholder="highlight term" className="w-64" />
        <button className="btn secondary small" type="submit">Highlight</button>
      </form>
      <div className="grid gap-3 lg:grid-cols-[180px_1fr]">
        <nav className="panel p-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Pages ({pages.length})</div>
          <ul className="space-y-[2px]">{pages.map((p) => {
            const hit = term && String(p.text).toLowerCase().includes(term.toLowerCase());
            return <li key={p.pageNumber}><Link href={href(p.pageNumber)} className={`block rounded px-2 py-[2px] ${current?.pageNumber === p.pageNumber ? "bg-blue-50 font-semibold" : ""}`}>p.{p.pageNumber}{hit ? <span className="ml-1 text-yellow-700">●</span> : null}</Link></li>;
          })}</ul>
        </nav>
        <section className="panel">
          <div className="panel-head"><h2>Page {current?.pageNumber ?? "—"}</h2>{current?.sourceRecordId ? <Link href={`/sources/record/${current.sourceRecordId}`}>source record</Link> : null}</div>
          <pre className="panel-body max-h-[70vh] overflow-auto whitespace-pre-wrap text-[12.5px] leading-relaxed">{current ? highlight(String(current.text), term) : "No page text."}</pre>
        </section>
      </div>
    </div>
  );
}
