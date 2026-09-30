/**
 * Loads the fixture knowledge base into the provenance model.
 * Every fact goes through: source → document/version/page → source_record → assertion → evidence → projection.
 * The same loader shape is what a manufacturer-PDF ingestion pipeline produces (documents/pages come from the
 * PDF text layer; assertions come from table parsers or LLM extraction and land as `pending` until verified).
 */
import { createHash } from "node:crypto";
import type { Sql } from "../db/client.ts";
import { normalizeIdentifier } from "../identifiers.ts";
import { ATTRIBUTE_DEFINITIONS } from "../../fixtures/attributes.ts";
import { ASSERTIONS, CHANNEL_RULES, DOCUMENTS, FAMILIES, MANUFACTURERS, RELATIONSHIPS, SERIES, TERRITORIES, VARIANTS, type FixtureAssertion } from "../../fixtures/catalog.ts";
import { AUTHORITY_BY_SOURCE_TYPE } from "../knowledge/authority.ts";
import { rebuildAttributeProjection } from "../knowledge/projection.ts";
import { detectConflicts } from "../knowledge/conflicts.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export interface SeedContext {
  manufacturerIds: Map<string, string>;
  variantIds: Map<string, string>;
  seriesIds: Map<string, string>;
  sourceRecordsByDocPage: Map<string, string>; // `${docKey}:${revision}:${page}` → source_record id
  docSourceIds: Map<string, string>;
  auxSourceIds: Record<string, string>;
  userIds: Record<string, string>;
}

export async function seedCatalog(sql: Sql): Promise<SeedContext> {
  const ctx: SeedContext = { manufacturerIds: new Map(), variantIds: new Map(), seriesIds: new Map(), sourceRecordsByDocPage: new Map(), docSourceIds: new Map(), auxSourceIds: {}, userIds: {} };

  // Organizations, channels, roles, users
  const [welsford] = await sql`INSERT INTO organizations (slug, name) VALUES ('welsford', 'F.S. Welsford Co.') ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
  const [valveman] = await sql`INSERT INTO organizations (slug, name) VALUES ('valveman', 'ValveMan') ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
  await sql`INSERT INTO sales_channels (id, name, organization_id, channel_type) VALUES ('welsford', 'Welsford (rep / distributor)', ${welsford.id}, 'rep_distributor'), ('valveman', 'ValveMan (ecommerce)', ${valveman.id}, 'ecommerce') ON CONFLICT (id) DO NOTHING`;
  const roles = [
    ["admin", "Administrator", ["view_cost", "view_customer_pricing", "view_inventory", "view_internal", "review_knowledge", "write_crm", "manage_users", "view_territory_rules"]],
    ["app_engineer", "Application engineer", ["view_customer_pricing", "view_inventory", "view_internal", "review_knowledge", "view_territory_rules"]],
    ["sales", "Sales", ["view_cost", "view_customer_pricing", "view_inventory", "view_internal", "write_crm", "view_territory_rules"]],
    ["cs", "Customer service", ["view_customer_pricing", "view_inventory", "view_internal"]],
    ["customer", "Authenticated customer", ["view_own_pricing", "view_public_inventory"]],
    ["public", "Anonymous public", ["view_public_inventory"]],
  ] as const;
  for (const [id, desc, perms] of roles) await sql`INSERT INTO roles (id, description, permissions) VALUES (${id}, ${desc}, ${sql.array([...perms])}) ON CONFLICT (id) DO UPDATE SET permissions = EXCLUDED.permissions`;
  const users = [
    ["admin@welsford.example", "Fixture Admin", "admin", welsford.id],
    ["engineer@welsford.example", "Fixture Application Engineer", "app_engineer", welsford.id],
    ["sales@welsford.example", "Fixture Sales Rep", "sales", welsford.id],
    ["cs@valveman.example", "Fixture ValveMan CS", "cs", valveman.id],
  ] as const;
  for (const [email, name, role, org] of users) {
    const [u] = await sql`INSERT INTO users (organization_id, email, display_name, role_id) VALUES (${org}, ${email}, ${name}, ${role}) ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`;
    ctx.userIds[role] = u.id;
  }

  for (const t of TERRITORIES) await sql`INSERT INTO territories (code, name, state) VALUES (${t.code}, ${t.name}, ${t.state}) ON CONFLICT (code) DO NOTHING`;
  for (const a of ATTRIBUTE_DEFINITIONS) {
    await sql`INSERT INTO attribute_definitions (key, label, data_type, unit, scope, criticality, allowed_values) VALUES (${a.key}, ${a.label}, ${a.dataType}, ${a.unit ?? null}, ${a.scope}, ${a.criticality}, ${a.allowedValues ? sql.array(a.allowedValues) : null}) ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, criticality = EXCLUDED.criticality`;
  }

  // Manufacturers / families / series / products / variants / identifiers
  for (const m of MANUFACTURERS) {
    const [row] = await sql`INSERT INTO manufacturers (code, name, website, aliases) VALUES (${m.code}, ${m.name}, ${m.website ?? null}, ${sql.array(m.aliases)}) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
    ctx.manufacturerIds.set(m.code, row.id);
  }
  const familyIds = new Map<string, string>();
  for (const f of FAMILIES) {
    const [row] = await sql`INSERT INTO product_families (manufacturer_id, name, category) VALUES (${ctx.manufacturerIds.get(f.mfr)!}, ${f.name}, ${f.category}) ON CONFLICT (manufacturer_id, name) DO UPDATE SET category = EXCLUDED.category RETURNING id`;
    familyIds.set(`${f.mfr}:${f.name}`, row.id);
  }
  for (const s of SERIES) {
    const [row] = await sql`INSERT INTO product_series (family_id, manufacturer_id, code, name) VALUES (${familyIds.get(`${s.mfr}:${s.family}`)!}, ${ctx.manufacturerIds.get(s.mfr)!}, ${s.code}, ${s.name}) ON CONFLICT (manufacturer_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
    ctx.seriesIds.set(`${s.mfr}:${s.code}`, row.id);
  }

  // A source for identity facts (part numbers) — manufacturer structured data (authority 3)
  const identitySources = new Map<string, string>();
  for (const m of MANUFACTURERS) {
    const [src] = await sql`INSERT INTO sources (source_type, name, manufacturer_id, authority_level, is_fixture, notes) VALUES ('mfr_structured', ${`[DEV FIXTURE] ${m.name} price/part list`}, ${ctx.manufacturerIds.get(m.code)!}, ${AUTHORITY_BY_SOURCE_TYPE.mfr_structured}, true, 'Fixture stand-in for the manufacturer part list') RETURNING id`;
    identitySources.set(m.code, src.id);
  }

  for (const v of VARIANTS) {
    const series = SERIES.find((s) => s.mfr === v.mfr && s.code === v.series)!;
    const [product] = await sql`INSERT INTO products (manufacturer_id, series_id, family_id, category, name, description, status)
      VALUES (${ctx.manufacturerIds.get(v.mfr)!}, ${ctx.seriesIds.get(`${v.mfr}:${v.series}`)!}, ${familyIds.get(`${v.mfr}:${series.family}`)!}, ${v.category}, ${v.name}, ${v.description}, ${v.status ?? "active"}) RETURNING id`;
    const [variant] = await sql`INSERT INTO product_variants (product_id, canonical_sku, name, status) VALUES (${product.id}, ${v.sku}, ${v.name}, ${v.status ?? "active"}) ON CONFLICT (canonical_sku) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
    ctx.variantIds.set(v.sku, variant.id);
    const [rec] = await sql`INSERT INTO source_records (source_id, record_locator, extracted_text, structured, checksum, source_version, last_verified_at)
      VALUES (${identitySources.get(v.mfr)!}, ${`partlist:${v.mfr}:${v.mfrPartNumber}`}, ${`${MANUFACTURERS.find((m) => m.code === v.mfr)!.name} part ${v.mfrPartNumber} (SKU ${v.sku}) — ${v.name}`}, ${sql.json({ mfrPartNumber: v.mfrPartNumber, historical: v.historical ?? [] } as never)}, ${sha(v.mfrPartNumber + v.name)}, 'fixture-2026-09', now()) RETURNING id`;
    const ids: [string, string, boolean][] = [["canonical_sku", v.sku, true], ["mfr_part_number", v.mfrPartNumber, true]];
    for (const h of v.historical ?? []) ids.push(["historical_part_number", h, false]);
    for (const a of v.aliases ?? []) ids.push(["alias", a, false]);
    for (const [type, raw, primary] of ids) {
      await sql`INSERT INTO product_identifiers (variant_id, identifier_type, identifier_raw, identifier_norm, manufacturer_id, is_primary, source_record_id)
        VALUES (${variant.id}, ${type}, ${raw}, ${normalizeIdentifier(raw)}, ${ctx.manufacturerIds.get(v.mfr)!}, ${primary}, ${rec.id}) ON CONFLICT DO NOTHING`;
    }
  }

  // Documents → versions → pages → per-page source records
  for (const d of DOCUMENTS) {
    const sourceType = d.key.startsWith("welsford-") ? "internal_approved" : d.type === "catalog" && d.key.includes("web") ? "mfr_website" : "mfr_document";
    const [src] = await sql`INSERT INTO sources (source_type, name, manufacturer_id, authority_level, is_fixture, origin_url) VALUES (${sourceType}, ${d.title}, ${ctx.manufacturerIds.get(d.mfr)!}, ${AUTHORITY_BY_SOURCE_TYPE[sourceType]}, true, ${`fixture://documents/${d.key}`}) RETURNING id`;
    ctx.docSourceIds.set(d.key, src.id);
    const [doc] = await sql`INSERT INTO documents (source_id, manufacturer_id, document_type, title, document_number) VALUES (${src.id}, ${ctx.manufacturerIds.get(d.mfr)!}, ${d.type}, ${d.title}, ${d.number}) RETURNING id`;
    for (const rev of d.revisions) {
      const body = rev.pages.join("\n\f\n");
      const [ver] = await sql`INSERT INTO document_versions (document_id, revision, publication_date, effective_date, checksum, storage_uri, page_count, is_current, last_verified_at, superseded_at)
        VALUES (${doc.id}, ${rev.revision}, ${rev.publicationDate}, ${rev.publicationDate}, ${sha(body)}, ${`fixture://documents/${d.key}/${rev.revision}.txt`}, ${rev.pages.length}, ${rev.isCurrent}, now(), ${rev.isCurrent ? null : new Date()}) RETURNING id`;
      for (let i = 0; i < rev.pages.length; i++) {
        await sql`INSERT INTO document_pages (document_version_id, page_number, text) VALUES (${ver.id}, ${i + 1}, ${rev.pages[i]})`;
        const [rec] = await sql`INSERT INTO source_records (source_id, document_version_id, page_number, record_locator, extracted_text, checksum, source_version, revision, effective_date, last_verified_at)
          VALUES (${src.id}, ${ver.id}, ${i + 1}, ${`doc:${d.number}:rev${rev.revision}:p${i + 1}`}, ${rev.pages[i]}, ${sha(rev.pages[i])}, ${rev.revision}, ${rev.revision}, ${rev.publicationDate}, now()) RETURNING id`;
        ctx.sourceRecordsByDocPage.set(`${d.key}:${rev.revision}:${i + 1}`, rec.id);
      }
    }
  }

  // Auxiliary non-document sources used by trap assertions
  const [internet] = await sql`INSERT INTO sources (source_type, name, authority_level, is_fixture, origin_url, notes) VALUES ('internet', '[DEV FIXTURE] General internet forum capture', 10, true, 'https://forum.example.invalid/thread/123', 'Never authoritative') RETURNING id`;
  const [shopifySrc] = await sql`INSERT INTO sources (source_type, name, authority_level, is_fixture, notes) VALUES ('shopify', '[DEV FIXTURE] Shopify catalog (valveman)', ${AUTHORITY_BY_SOURCE_TYPE.shopify}, true, 'Merchandising copy; not a technical authority') RETURNING id`;
  const [engNotes] = await sql`INSERT INTO sources (source_type, name, authority_level, is_fixture, notes) VALUES ('internal_approved', '[DEV FIXTURE] Welsford engineering notes register', ${AUTHORITY_BY_SOURCE_TYPE.internal_approved}, true, 'Approved internal engineering notes (author/approver tracked per record)') RETURNING id`;
  ctx.auxSourceIds.internet = internet.id;
  ctx.auxSourceIds.shopify = shopifySrc.id;
  ctx.auxSourceIds.internal_approved = engNotes.id;

  const currentRevision = (docKey: string) => DOCUMENTS.find((d) => d.key === docKey)!.revisions.find((r) => r.isCurrent)!.revision;
  const resolveEvidence = async (e: FixtureAssertion["evidence"][number]): Promise<string> => {
    if (e.doc) {
      const key = `${e.doc}:${e.revision ?? currentRevision(e.doc)}:${e.page}`;
      const id = ctx.sourceRecordsByDocPage.get(key);
      if (!id) throw new Error(`No source record for ${key}`);
      const page = DOCUMENTS.find((d) => d.key === e.doc)!.revisions.find((r) => r.revision === (e.revision ?? currentRevision(e.doc!)))!.pages[e.page! - 1];
      if (!page.includes(e.text)) throw new Error(`Fixture integrity: supporting text "${e.text}" not found on ${key}`);
      return id;
    }
    if (e.sourceKind === "partlist") {
      const [rec] = await sql`SELECT r.id FROM source_records r JOIN product_identifiers i ON i.source_record_id = r.id JOIN product_variants v ON v.id = i.variant_id WHERE i.identifier_type = 'canonical_sku' AND v.name = ${e.text} LIMIT 1`;
      if (!rec) throw new Error(`No part-list record for ${e.text}`);
      return rec.id;
    }
    const srcId = e.sourceKind === "internet" ? internet.id : e.sourceKind === "internal_approved" ? engNotes.id : shopifySrc.id;
    const [rec] = await sql`INSERT INTO source_records (source_id, record_locator, extracted_text, checksum, source_version, last_verified_at) VALUES (${srcId}, ${`${e.sourceKind}:${sha(e.text).slice(0, 12)}`}, ${e.text}, ${sha(e.text)}, 'fixture', ${e.sourceKind === "internet" ? null : new Date()}) RETURNING id`;
    return rec.id;
  };

  // Assertions + evidence
  const attrCrit = new Map(ATTRIBUTE_DEFINITIONS.map((a) => [a.key, a.criticality]));
  for (const a of ASSERTIONS) {
    const variantId = ctx.variantIds.get(a.sku);
    if (!variantId) throw new Error(`Unknown SKU in assertions: ${a.sku}`);
    const isNum = typeof a.value === "number";
    const [as] = await sql`INSERT INTO knowledge_assertions (subject_type, subject_id, predicate, value_text, value_number, value_number_max, unit, status, criticality, effective_date)
      VALUES ('variant', ${variantId}, ${a.key}, ${isNum ? null : String(a.value)}, ${isNum ? (a.value as number) : null}, ${a.valueMax ?? null}, ${a.unit ?? null}, ${a.status ?? "verified"}, ${attrCrit.get(a.key) ?? 1}, '2025-01-01') RETURNING id`;
    for (const e of a.evidence) {
      const recId = await resolveEvidence(e);
      await sql`INSERT INTO assertion_evidence (assertion_id, source_record_id, supporting_text, extraction_method) VALUES (${as.id}, ${recId}, ${e.text}, ${e.extraction ?? "table_parser"}) ON CONFLICT DO NOTHING`;
    }
  }

  // Relationships
  for (const r of RELATIONSHIPS) {
    if (r.type === "replaces_historical") continue; // historical numbers are identifiers + product bulletin evidence, handled via identifiers
    const [rel] = await sql`INSERT INTO product_relationships (from_variant_id, to_variant_id, relationship_type, approval_authority, status, notes, conditions)
      VALUES (${ctx.variantIds.get(r.from)!}, ${ctx.variantIds.get(r.to)!}, ${r.type}, ${r.authority}, ${r.status}, ${r.notes ?? null}, ${r.conditions ? sql.json(r.conditions as never) : null})
      ON CONFLICT (from_variant_id, to_variant_id, relationship_type) DO UPDATE SET status = EXCLUDED.status RETURNING id`;
    const recId = await resolveEvidence(r.evidence);
    await sql`INSERT INTO relationship_evidence (relationship_id, source_record_id, supporting_text) VALUES (${rel.id}, ${recId}, ${r.evidence.text}) ON CONFLICT DO NOTHING`;
  }
  // Historical identifiers get their evidence from the supersession bulletin
  for (const r of RELATIONSHIPS.filter((r) => r.type === "replaces_historical")) {
    const recId = await resolveEvidence(r.evidence);
    await sql`UPDATE product_identifiers SET source_record_id = ${recId} WHERE variant_id = ${ctx.variantIds.get(r.from)!} AND identifier_type = 'historical_part_number'`;
  }

  // Channel rules, evidenced by an internal approved register
  const [ruleSrc] = await sql`INSERT INTO sources (source_type, name, authority_level, is_fixture, notes) VALUES ('internal_approved', '[DEV FIXTURE] Welsford channel & territory register 2026', ${AUTHORITY_BY_SOURCE_TYPE.internal_approved}, true, 'Compiled manufacturer agreements') RETURNING id`;
  for (const r of CHANNEL_RULES) {
    const [rec] = await sql`INSERT INTO source_records (source_id, record_locator, extracted_text, checksum, source_version, last_verified_at) VALUES (${ruleSrc.id}, ${`rule:${r.channel}:${r.scope}:${r.rule}:${r.territory ?? "*"}`}, ${r.note}, ${sha(r.note + r.rule + r.scope)}, '2026.1', now()) RETURNING id`;
    let scopeId: string;
    let scopeType = r.scopeType;
    if (r.scopeType === "manufacturer") scopeId = ctx.manufacturerIds.get(r.scope)!;
    else if (r.scopeType === "series") scopeId = ctx.seriesIds.get(r.scope)!;
    else scopeId = ctx.variantIds.get(r.scope)!;
    await sql`INSERT INTO channel_rules (channel_id, scope_type, scope_id, rule_type, territory_code, customer_class, priority, source_record_id, notes, effective_date)
      VALUES (${r.channel}, ${scopeType}, ${scopeId}, ${r.rule}, ${r.territory ?? null}, ${r.customerClass ?? null}, ${r.priority ?? 100}, ${rec.id}, ${r.note}, '2026-01-01')`;
  }

  await detectConflicts(sql);
  await rebuildAttributeProjection(sql);
  return ctx;
}
