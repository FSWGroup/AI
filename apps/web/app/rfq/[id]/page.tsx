import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireInternal } from "@/lib/guard";
import { Badge, statusTone, confidenceTone } from "@/components/Badge";
import { Panel } from "@/components/DataTable";
import { BomEditor, type BomLine } from "@/components/BomEditor";
import { fmtDate, short } from "@/lib/format";

export default async function RfqDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireInternal();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sql = db();
  const [rfq] = await sql`SELECT r.*, u.display_name AS created_by_name, c.name AS customer_name FROM rfqs r LEFT JOIN users u ON u.id = r.created_by LEFT JOIN customers c ON c.id = r.customer_id WHERE r.id = ${id}`;
  if (!rfq) notFound();
  const lines = await sql`SELECT l.*, v.canonical_sku, v.name AS candidate_name FROM rfq_lines l LEFT JOIN product_variants v ON v.id = l.candidate_variant_id WHERE l.rfq_id = ${id} ORDER BY l.line_no`;
  const [run] = await sql`SELECT id, answer, confidence, outcome, created_at FROM agent_runs WHERE agent = 'rfq_bom' AND answer->'data'->>'rfqId' = ${id} ORDER BY created_at DESC LIMIT 1`;
  const runLines = ((run?.answer as { data?: { lines?: Record<string, unknown>[] } } | null)?.data?.lines ?? []) as Record<string, unknown>[];
  const initial: BomLine[] = lines.map((l) => {
    const rl = runLines.find((x) => x.lineNo === l.lineNo);
    return {
      id: l.id, lineNo: l.lineNo, raw: l.rawLine, quantity: l.quantity == null ? null : Number(l.quantity), partNumberText: l.partNumberText, description: l.descriptionText,
      candidateSku: l.canonicalSku ?? null, candidateName: l.candidateName ?? null, matchType: l.matchType, confidence: l.confidence, questions: (l.questions ?? []) as string[],
      citations: (Array.isArray(l.evidence) ? l.evidence : []) as BomLine["citations"], candidates: ((rl?.candidates as BomLine["candidates"]) ?? []),
    };
  });
  const verified = lines.filter((l) => l.confidence === "VERIFIED").length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1>RFQ <span className="mono">{short(id)}</span></h1>
        <Badge tone={statusTone(rfq.status)}>{rfq.status}</Badge>
        <Badge tone="neutral">{rfq.channelId}</Badge>
        <Badge tone="neutral">{rfq.sourceKind}</Badge>
        <span className="text-slate-500">{fmtDate(rfq.createdAt)} · {rfq.createdByName ?? "anonymous"}{rfq.customerName ? ` · ${rfq.customerName}` : ""}</span>
        {run ? <span className="text-slate-500">run <span className="mono">{run.id}</span> <Badge tone={confidenceTone(run.confidence)}>{run.confidence}</Badge></span> : null}
        <Link href="/rfq" className="ml-auto">← all RFQs</Link>
      </div>
      <Panel title={`Bill of materials (${lines.length} lines · ${verified} verified · ${lines.length - verified} need review)`}>
        {lines.length === 0 ? <p className="text-slate-500">No lines were parsed from this RFQ.</p> : <BomEditor rfqId={id} initial={initial} />}
      </Panel>
      <Panel title="Source text (untrusted input)">
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-[12px]">{rfq.rawText}</pre>
      </Panel>
    </div>
  );
}
