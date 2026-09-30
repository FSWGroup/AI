import Link from "next/link";
import { notFound } from "next/navigation";
import { decideEligibility, pricingAgent, inventoryAgent, documentFinderAgent, can } from "@wpi/core";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { loadAssertionsWithEvidence, assertionValue } from "@/lib/evidence";
import { Badge, statusTone, confidenceTone } from "@/components/Badge";
import { Panel, Empty } from "@/components/DataTable";
import { CitationsDisclosure } from "@/components/CitationList";
import { DocumentsPanel, EligibilityBadge, InventoryPanel, PricingPanel, Sku } from "@/components/panels";
import { fmtDate } from "@/lib/format";

export default async function ProductDetail({ params }: { params: Promise<{ sku: string }> }) {
  const { sku: rawSku } = await params;
  const sku = decodeURIComponent(rawSku);
  const { ctx, session } = await getContext();
  const sql = db();
  const [v] = await sql`SELECT v.id, v.canonical_sku, v.name, v.status, v.created_at, p.id AS product_id, p.name AS product_name, p.description, p.category, p.status AS product_status, m.name AS manufacturer, m.code AS manufacturer_code, s.code AS series_code, s.name AS series_name, f.name AS family_name
    FROM product_variants v JOIN products p ON p.id = v.product_id JOIN manufacturers m ON m.id = p.manufacturer_id LEFT JOIN product_series s ON s.id = p.series_id LEFT JOIN product_families f ON f.id = p.family_id WHERE upper(v.canonical_sku) = ${sku.toUpperCase()}`;
  if (!v) notFound();
  const [identifiers, assertions, relationships, defs, shopify, p21, valvemanElig, welsfordElig, pricing, inventory, docs] = await Promise.all([
    sql`SELECT i.identifier_type, i.identifier_raw, i.identifier_norm, i.is_primary, i.source_record_id, m.name AS competitor FROM product_identifiers i LEFT JOIN manufacturers m ON m.id = i.manufacturer_id WHERE i.variant_id = ${v.id} ORDER BY i.is_primary DESC, i.identifier_type`,
    loadAssertionsWithEvidence(sql, [v.id, v.productId]),
    sql`SELECT r.id, r.relationship_type, r.approval_authority, r.status, r.notes, r.conditions, CASE WHEN r.from_variant_id = ${v.id} THEN 'from' ELSE 'to' END AS direction, o.canonical_sku AS other_sku, o.name AS other_name,
          coalesce(json_agg(json_build_object('sourceRecordId', e.source_record_id, 'text', e.supporting_text)) FILTER (WHERE e.id IS NOT NULL), '[]') AS evidence
        FROM product_relationships r JOIN product_variants o ON o.id = CASE WHEN r.from_variant_id = ${v.id} THEN r.to_variant_id ELSE r.from_variant_id END LEFT JOIN relationship_evidence e ON e.relationship_id = r.id
        WHERE r.from_variant_id = ${v.id} OR r.to_variant_id = ${v.id} GROUP BY r.id, o.id ORDER BY r.relationship_type, o.canonical_sku`,
    sql`SELECT key, label, unit, criticality FROM attribute_definitions`,
    sql`SELECT * FROM shopify_mappings WHERE variant_id = ${v.id}`,
    sql`SELECT * FROM p21_mappings WHERE variant_id = ${v.id}`,
    decideEligibility(sql, { variantId: v.id, channelId: "valveman", state: session.state, customerClass: ctx.customerClass ?? null }),
    session.isInternal ? decideEligibility(sql, { variantId: v.id, channelId: "welsford", state: session.state, customerClass: ctx.customerClass ?? null }) : Promise.resolve(null),
    pricingAgent(ctx, { partNumber: v.canonicalSku, channel: session.channel }),
    inventoryAgent(ctx, { partNumber: v.canonicalSku }),
    documentFinderAgent(ctx, { query: v.canonicalSku, partNumber: v.canonicalSku }),
  ]);
  const labels = new Map(defs.map((d) => [d.key, d]));
  const byPredicate = new Map<string, typeof assertions>();
  for (const a of assertions) { if (!byPredicate.has(a.predicate)) byPredicate.set(a.predicate, []); byPredicate.get(a.predicate)!.push(a); }
  const canSeeInternal = can(session.principal, "view_internal");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mono">{v.canonicalSku}</h1>
        <Badge tone={statusTone(v.status)}>{v.status}</Badge>
        <span className="text-base">{v.name}</span>
        <Link href="/products" className="ml-auto">← products</Link>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Identity">
          <dl className="kv">
            <dt>Manufacturer</dt><dd>{v.manufacturer} <span className="mono text-slate-500">({v.manufacturerCode})</span></dd>
            <dt>Family</dt><dd>{v.familyName ?? "—"}</dd>
            <dt>Series</dt><dd>{v.seriesCode ? <><span className="mono">{v.seriesCode}</span> {v.seriesName}</> : "—"}</dd>
            <dt>Product</dt><dd>{v.productName} <Badge tone={statusTone(v.productStatus)}>{v.productStatus}</Badge></dd>
            <dt>Category</dt><dd>{v.category}</dd>
            <dt>Description</dt><dd className="text-slate-700">{v.description ?? "—"}</dd>
          </dl>
          <h3 className="mt-3">Identifiers</h3>
          <table className="data mt-1">
            <thead><tr><th>Type</th><th>Identifier</th><th>Normalized</th><th>Evidence</th></tr></thead>
            <tbody>{identifiers.map((i, k) => <tr key={k}><td>{i.identifierType.replace(/_/g, " ")}{i.competitor ? <span className="text-slate-500"> ({i.competitor})</span> : null}{i.isPrimary ? <Badge tone="blue">primary</Badge> : null}</td><td className="mono font-medium">{i.identifierRaw}</td><td className="mono text-slate-500">{i.identifierNorm}</td><td>{i.sourceRecordId ? <Link href={`/sources/record/${i.sourceRecordId}`}>record</Link> : <span className="text-slate-400">—</span>}</td></tr>)}</tbody>
          </table>
        </Panel>
        <Panel title="Channel eligibility">
          <div className="space-y-3">
            {welsfordElig ? (
              <div>
                <div className="flex items-center gap-2"><Badge tone="blue">Welsford{session.state ? ` / ${session.state}` : ""}</Badge><EligibilityBadge e={welsfordElig} /></div>
                <p className="mt-1 text-slate-700">{welsfordElig.explanation}</p>
                {can(session.principal, "view_territory_rules") && welsfordElig.appliedRules.length ? <ul className="mt-1 list-disc pl-5 text-[11.5px] text-slate-600">{welsfordElig.appliedRules.map((r) => <li key={r.id}><span className="mono">{r.ruleType}</span> ({r.scopeType}{r.territoryCode ? `, ${r.territoryCode}` : ""}{r.customerClass ? `, ${r.customerClass}` : ""}) {r.notes ? `— ${r.notes}` : ""}</li>)}</ul> : null}
              </div>
            ) : null}
            <div>
              <div className="flex items-center gap-2"><Badge tone="green">ValveMan{session.state ? ` / ${session.state}` : ""}</Badge><EligibilityBadge e={valvemanElig} /></div>
              <p className="mt-1 text-slate-700">{valvemanElig.explanation}</p>
            </div>
            {!session.state ? <p className="text-slate-500">Set a state in the top bar to evaluate territory-scoped rules.</p> : null}
          </div>
        </Panel>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-slate-500">Pricing <Badge tone={confidenceTone(pricing.confidence)}>{pricing.confidence}</Badge>{pricing.outcome === "abstained" ? <span className="text-red-700">{pricing.unknown[0]}</span> : null}</div>
          <PricingPanel data={pricing.data} />
          <div className="flex items-center gap-2 text-slate-500">Inventory <Badge tone={confidenceTone(inventory.confidence)}>{inventory.confidence}</Badge>{inventory.outcome === "abstained" ? <span className="text-red-700">{inventory.unknown[0]}</span> : null}</div>
          <InventoryPanel data={inventory.data} />
        </div>
      </div>

      <Panel title={`Knowledge assertions (${assertions.length})`} right={<span className="text-slate-500">grouped by predicate · every value is backed by cited evidence · only verified / human-approved values are answerable</span>}>
        {assertions.length === 0 ? <Empty>No assertions recorded for this variant.</Empty> : (
          <table className="data">
            <thead><tr><th>Predicate</th><th>Value</th><th>Unit</th><th className="num">Crit.</th><th>Status</th><th>Effective</th><th>Evidence</th></tr></thead>
            <tbody>{[...byPredicate.entries()].map(([pred, list]) => list.map((a, i) => (
              <tr key={a.id} className={a.status === "deprecated" || a.status === "rejected" ? "opacity-60" : ""}>
                <td>{i === 0 ? <><span className="mono font-medium">{pred}</span>{labels.get(pred) ? <div className="text-[11px] text-slate-500">{labels.get(pred)!.label}</div> : null}</> : null}</td>
                <td className="mono">{assertionValue(a)}</td>
                <td>{a.unit ?? labels.get(pred)?.unit ?? ""}</td>
                <td className="num">{a.criticality}</td>
                <td><Badge tone={statusTone(a.status)}>{a.status}</Badge>{a.supersedesId ? <div className="text-[11px] text-slate-500">supersedes {String(a.supersedesId).slice(0, 8)}</div> : null}</td>
                <td className="whitespace-nowrap text-slate-500">{a.effectiveDate ? String(a.effectiveDate).slice(0, 10) : "—"}{a.expiresAt ? <div>exp {fmtDate(a.expiresAt)}</div> : null}</td>
                <td><CitationsDisclosure citations={a.evidence} /></td>
              </tr>
            )))}</tbody>
          </table>
        )}
      </Panel>

      <Panel title={`Relationships (${relationships.length})`}>
        {relationships.length === 0 ? <Empty>No explicit relationships.</Empty> : (
          <table className="data">
            <thead><tr><th>Type</th><th>Direction</th><th>Other item</th><th>Approval authority</th><th>Status</th><th>Notes / conditions</th><th>Evidence</th></tr></thead>
            <tbody>{relationships.map((r) => (
              <tr key={r.id}><td className="mono">{r.relationshipType}</td><td>{r.direction === "from" ? <span title="this item → other">this → other</span> : <span title="other → this">other → this</span>}</td><td><Sku sku={r.otherSku} /> <span className="text-slate-600">{r.otherName}</span></td><td><Badge tone={r.approvalAuthority === "manufacturer" ? "green" : r.approvalAuthority === "welsford" ? "blue" : "grey"}>{r.approvalAuthority ?? "none"}</Badge></td><td><Badge tone={statusTone(r.status)}>{r.status}</Badge></td><td className="text-slate-600">{r.notes ?? ""}{r.conditions ? <code className="ml-1 text-[11px]">{JSON.stringify(r.conditions)}</code> : null}</td><td>{(r.evidence as { sourceRecordId: string; text: string | null }[]).map((e, i) => <div key={i}><Link href={`/sources/record/${e.sourceRecordId}`}>record</Link>{e.text ? <span className="text-slate-600"> — {e.text.slice(0, 120)}</span> : null}</div>)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Panel>

      <div className="flex items-center gap-2 text-slate-500">Documents <Badge tone={confidenceTone(docs.confidence)}>{docs.confidence}</Badge></div>
      <DocumentsPanel data={docs.data} />

      {canSeeInternal ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title={`Shopify mappings (${shopify.length})`}>
            {shopify.length === 0 ? <Empty>Not mapped to a Shopify variant.</Empty> : (
              <table className="data"><thead><tr><th>Variant id</th><th>SKU</th><th>Title</th><th>Vendor</th><th className="num">Price</th><th className="num">Inv.</th><th>Status</th><th>Mapping</th><th>Synced</th></tr></thead>
                <tbody>{shopify.map((m) => <tr key={m.id}><td className="mono">{m.shopifyVariantId}</td><td className="mono">{m.shopifySku}</td><td>{m.title}</td><td>{m.vendor}</td><td className="num mono">{m.price ?? "—"}</td><td className="num">{m.inventoryQuantity ?? "—"}</td><td>{m.status}</td><td><Badge tone={statusTone(m.mappingStatus)}>{m.mappingStatus}</Badge></td><td className="whitespace-nowrap text-slate-500">{fmtDate(m.lastSyncedAt)}</td></tr>)}</tbody></table>
            )}
          </Panel>
          <Panel title={`Prophet 21 mappings (${p21.length})`}>
            {p21.length === 0 ? <Empty>Not mapped to a P21 item.</Empty> : (
              <table className="data"><thead><tr><th>Item id</th><th>Inv mast uid</th><th>Description</th><th>Supplier part</th><th>Manufacturer</th><th>UOM</th><th>Mapping</th><th>Synced</th></tr></thead>
                <tbody>{p21.map((m) => <tr key={m.id}><td className="mono">{m.p21ItemId}</td><td className="mono">{m.p21InvMastUid}</td><td>{m.itemDesc}</td><td className="mono">{m.supplierPartNumber}</td><td>{m.manufacturerName}</td><td>{m.uom}</td><td><Badge tone={statusTone(m.mappingStatus)}>{m.mappingStatus}</Badge></td><td className="whitespace-nowrap text-slate-500">{fmtDate(m.lastSyncedAt)}</td></tr>)}</tbody></table>
            )}
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
