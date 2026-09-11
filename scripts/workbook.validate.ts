/**
 * Developer-only validation against a REAL Order Tracker workbook.
 * Never commits or prints full customer data to the repo; run locally:
 *   VALVEMAN_TRACKER_PATH=/path/to/tracker.xlsx npm run validate:workbook
 * Optional: VALVEMAN_AS_OF=2026-09-11  VALVEMAN_SPOT="acme,beta corp"
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseOrderTracker } from '../src/services/excelParser';
import { normalizeWorkbook, runAnalysis } from '../src/services/analyzer';
import { formatDate, fromInputDate } from '../src/utils/dates';
import { formatMoney } from '../src/utils/money';

const path = process.env.VALVEMAN_TRACKER_PATH;

describe.skipIf(!path)('real workbook validation', () => {
  it('parses, normalizes and tiers the workbook', () => {
    const buf = readFileSync(path!);
    const parsed = parseOrderTracker(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), path!.split('/').pop()!);
    console.log(`Sheet: ${parsed.sheetName}; header row ${parsed.mapping.headerRowIndex + 1}; rows ${parsed.rows.length}`);
    console.log('Mapped headers:', parsed.mapping.matchedHeaders);
    console.log('Missing optional:', parsed.mapping.missingOptional);

    const normalized = normalizeWorkbook(parsed);
    const asOf = (process.env.VALVEMAN_AS_OF && fromInputDate(process.env.VALVEMAN_AS_OF)) || new Date();
    const result = runAnalysis(normalized, asOf);
    console.log('As of', formatDate(asOf));
    console.log('Totals:', result.totals);

    const qualifying = normalized.orders.filter((o) => o.qualifying);
    const totalSpend = qualifying.reduce((s, o) => s + o.orderValue, 0);
    const rawPositivePV = parsed.rows.reduce((s, r) => s + (r.productValue && r.productValue > 0 ? r.productValue : 0), 0);
    const rawPositivePV2 = parsed.rows.reduce((s, r) => s + (r.productValue2 && r.productValue2 > 0 ? r.productValue2 : 0), 0);
    console.log(`Qualifying spend (all history): ${formatMoney(totalSpend)} | raw positive PV sum ${formatMoney(rawPositivePV)} | raw positive PV2 sum ${formatMoney(rawPositivePV2)}`);
    const multiRow = normalized.orders.filter((o) => o.sourceRows.length > 1);
    console.log(`Orders spanning >1 row: ${multiRow.length}; max rows in one order: ${Math.max(...normalized.orders.map((o) => o.sourceRows.length))}`);
    const big = multiRow.filter((o) => o.sourceRows.length >= 6).slice(0, 8);
    for (const o of big) console.log('  large group rows', o.sourceRows.join(','), 'value', formatMoney(o.orderValue), 'vendors', o.vendors.length, o.qualifying ? '' : `NOT QUALIFYING (${o.disqualifyReason})`);

    const disq = new Map<string, number>();
    for (const o of normalized.orders) if (!o.qualifying) disq.set(o.disqualifyReason ?? '?', (disq.get(o.disqualifyReason ?? '?') ?? 0) + 1);
    console.log('Non-qualifying reasons:', [...disq.entries()]);

    const tiers = new Map<string, number>();
    for (const c of result.customers) tiers.set(c.tier.tier + (c.tier.reviewReason ? ':' + c.tier.reviewReason : ''), (tiers.get(c.tier.tier + (c.tier.reviewReason ? ':' + c.tier.reviewReason : '')) ?? 0) + 1);
    console.log('Tier distribution:', [...tiers.entries()]);

    const reps = new Map<string, number>();
    for (const c of result.customers) reps.set(c.metrics.salesRep, (reps.get(c.metrics.salesRep) ?? 0) + 1);
    console.log('Reps:', [...reps.entries()]);

    const issueTypes = new Map<string, number>();
    for (const i of result.issues) issueTypes.set(`${i.severity}:${i.issueType}`, (issueTypes.get(`${i.severity}:${i.issueType}`) ?? 0) + 1);
    console.log('Issues:', [...issueTypes.entries()].sort());

    const vendors = new Map<string, number>();
    for (const o of qualifying) for (const v of o.vendors) vendors.set(v, (vendors.get(v) ?? 0) + 1);
    console.log(`Distinct vendors after normalization: ${vendors.size}`);
    console.log([...vendors.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k}(${c})`).join(', '));

    console.log('\n=== A/B/C customers ===');
    for (const c of result.customers.filter((c) => ['A', 'B', 'C'].includes(c.tier.tier)).sort((a, b) => a.tier.tier.localeCompare(b.tier.tier) || b.metrics.rollingSpend - a.metrics.rollingSpend)) {
      const m = c.metrics;
      console.log(`${c.tier.tier} | ${m.company} | ${m.salesRep} | ${m.rollingOrderCount} orders | ${formatMoney(m.rollingSpend)} | ${m.vendorCount} vendors [${m.vendors.join('; ')}] | ${c.creditLabel} | falls out ${formatDate(c.fallout.falloutDate)} (${c.fallout.reason}) | next: ${c.nextTier.summary}`);
    }
    console.log('\n=== E customers ===');
    for (const c of result.customers.filter((c) => c.tier.tier === 'E')) console.log(`E | ${c.metrics.company} | ${c.metrics.salesRep} | ${c.tier.explanation}`);

    console.log('\n=== Top opportunities (overall top 15) ===');
    for (const o of result.opportunities.slice(0, 15)) console.log(`${o.score} | ${o.company} | ${o.salesRep} | ${o.currentTier}->${o.nextTier} | ${formatMoney(o.rollingSpend)} | ${o.rollingOrderCount} orders | ${o.vendorCount} vendors | ${o.creditLabel} | ${o.gap.summary}`);

    const spots = (process.env.VALVEMAN_SPOT ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    for (const s of spots) {
      console.log(`\n=== Spot: ${s} ===`);
      for (const c of result.customers.filter((c) => c.metrics.company.toLowerCase().includes(s))) {
        const m = c.metrics;
        console.log(`${m.company} | tier ${c.tier.tier} | ${m.salesRep} | window ${m.rollingOrderCount} / ${formatMoney(m.rollingSpend)} | vendors ${m.vendors.join('; ')} | credit ${c.creditLabel} | payhist ${m.paymentHistoryExplanation} | ${c.tier.explanation}`);
        for (const o of m.normalizedOrders) console.log(`   rows ${o.sourceRows.join(',')} | ${formatDate(o.orderDate)} | ${formatMoney(o.orderValue)} (gross ${formatMoney(o.grossValue)}, refund ${formatMoney(o.refundAmount)}) | ${o.vendors.join('/')} | ${o.paymentStatus} | ${o.paymentMethod} | ${o.qualifying ? 'Q' : 'X:' + o.disqualifyReason} | ${o.rowKinds.join('+')}`);
      }
    }
    expect(result.customers.length).toBeGreaterThan(0);
    expect(result.totals.qualifyingOrders).toBeLessThan(parsed.rows.length);
  });
});
