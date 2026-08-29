import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { createTestDatabase, type TestDatabase } from '../support/database.js';
import { testContext, testDeps } from '../support/context.js';
import { syncEventRegistry } from '../../src/modules/events/index.js';
import { ALL_EVENTS } from '../../src/event-catalog.js';
import { withUnitOfWork } from '../../src/kernel/unit-of-work.js';
import {
  assertOrganizationFields,
  createOrganization,
  loadPartyDeps,
  readOrganization,
  readProvenance,
  reevaluateOrganization,
  type PartyDeps,
} from '../../src/modules/party/index.js';

/**
 * Acceptance criterion 10 (spec §83): two sources disagree about one field, and the
 * system shows both values, which won, why, and where each came from — and changing
 * the rule re-evaluates safely.
 *
 * The scenario is the real one. Prophet 21 and Pipedrive both hold a name and a
 * website for the same company, and they disagree, because an ERP is kept accurate for
 * invoicing and a CRM is kept accurate by whoever visited last.
 */
describe('survivorship and provenance (AC10)', () => {
  let testDb: TestDatabase;
  let deps: ReturnType<typeof testDeps>;

  beforeAll(async () => {
    testDb = await createTestDatabase('survivorship');
    await syncEventRegistry(testDb.db, ALL_EVENTS);
    // Snapshot the seeded rules before any test changes them. One test deliberately
    // rewrites a rule, and survivorship rules are configuration that outlives a row
    // truncation -- so without this, that test silently changes the meaning of every
    // test after it.
    await sql`
      CREATE TABLE seeded_survivorship_rule AS TABLE party.survivorship_rule
    `.execute(testDb.db);
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await sql`
      TRUNCATE party.field_candidate, party.organization_role,
               party.organization_relationship, party.organization RESTART IDENTITY CASCADE
    `.execute(testDb.db);
    await sql`
      TRUNCATE events.event_delivery, events.domain_event RESTART IDENTITY CASCADE
    `.execute(testDb.db);
    await sql`
      TRUNCATE party.survivorship_rule;
      INSERT INTO party.survivorship_rule SELECT * FROM seeded_survivorship_rule;
    `.execute(testDb.db);
    deps = testDeps();
  });

  async function inUnitOfWork<T>(
    work: (
      uow: Parameters<Parameters<typeof withUnitOfWork>[3]>[0],
      party: PartyDeps,
    ) => Promise<T>,
  ): Promise<T> {
    return withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
      const party = await loadPartyDeps(uow.tx);
      return work(uow, party);
    });
  }

  /** Two sources, disagreeing on name and website. */
  async function twoDisagreeingSources(): Promise<string> {
    return inUnitOfWork(async (uow, party) => {
      const id = await createOrganization(uow, party, {
        legalName: 'KEYSTONE PROCESS SYSTEMS INC',
        sourceSystemCode: 'P21',
        fields: [
          {
            fieldKey: 'website_url',
            value: 'http://keystoneprocess.com',
            sourceSystemCode: 'P21',
            sourceField: 'web_address',
            sourceUpdatedAt: new Date('2024-03-01T00:00:00Z'),
          },
        ],
      });

      await assertOrganizationFields(uow, party, {
        organizationId: id,
        candidates: [
          {
            fieldKey: 'legal_name',
            value: 'Keystone Process Systems, Inc.',
            sourceSystemCode: 'PIPEDRIVE',
            sourceField: 'name',
            sourceUpdatedAt: new Date('2026-05-01T00:00:00Z'),
          },
          {
            fieldKey: 'website_url',
            value: 'https://www.keystoneprocess.com',
            sourceSystemCode: 'PIPEDRIVE',
            sourceField: 'url',
            sourceUpdatedAt: new Date('2026-05-01T00:00:00Z'),
          },
        ],
      });

      return id;
    });
  }

  it('keeps both values, selects one, and says which source it came from', async () => {
    const id = await twoDisagreeingSources();

    const provenance = await inUnitOfWork(async (uow) =>
      readProvenance(uow, 'ORGANIZATION', id, 'legal_name'),
    );

    // Both are kept. The loser is not overwritten, deleted or downgraded.
    expect(provenance).toHaveLength(2);
    expect(provenance.map((entry) => entry.sourceSystemCode).sort()).toEqual([
      'P21',
      'PIPEDRIVE',
    ]);
    expect(provenance.map((entry) => entry.value).sort()).toEqual([
      'KEYSTONE PROCESS SYSTEMS INC',
      'Keystone Process Systems, Inc.',
    ]);

    // Exactly one winner, and it is first.
    const selected = provenance.filter((entry) => entry.isSelected);
    expect(selected).toHaveLength(1);
    expect(provenance[0]!.isSelected).toBe(true);

    // Where each value came from, down to the field the source calls it.
    expect(provenance.find((e) => e.sourceSystemCode === 'PIPEDRIVE')!.sourceField).toBe(
      'name',
    );
  });

  it('applies different rules to different fields, and says so in the reason', async () => {
    const id = await twoDisagreeingSources();
    const view = await readOrganization(testDb.db, id);

    // The default organization rule puts the ERP above the CRM: an accounting system
    // is kept accurate because invoices depend on it.
    expect(view.legalName).toBe('KEYSTONE PROCESS SYSTEMS INC');
    // The website rule reverses that, because salespeople keep websites current and
    // an ERP has no reason to.
    expect(view.websiteUrl).toBe('https://www.keystoneprocess.com');

    const name = await inUnitOfWork(async (uow) =>
      readProvenance(uow, 'ORGANIZATION', id, 'legal_name'),
    );
    expect(name[0]!.selectedReason).toContain('P21 outranks PIPEDRIVE');

    const site = await inUnitOfWork(async (uow) =>
      readProvenance(uow, 'ORGANIZATION', id, 'website_url'),
    );
    expect(site[0]!.selectedReason).toContain('PIPEDRIVE outranks P21');
  });

  it('shows the disagreement in the divergence report', async () => {
    const id = await twoDisagreeingSources();

    const divergence = await sql<{
      field_key: string;
      candidate_count: string;
      distinct_value_count: string;
      selected_source: string;
      sources: string[];
    }>`
      SELECT field_key, candidate_count, distinct_value_count, selected_source, sources
        FROM party.field_divergence
       WHERE entity_id = ${id}::uuid ORDER BY field_key
    `.execute(testDb.db);

    expect(divergence.rows.map((row) => row.field_key)).toEqual([
      'legal_name',
      'website_url',
    ]);
    expect(divergence.rows[0]!.distinct_value_count).toBe('2');
    expect(divergence.rows[0]!.selected_source).toBe('P21');
    expect(divergence.rows[0]!.sources).toEqual(['P21', 'PIPEDRIVE']);
  });

  it('re-evaluates safely when a rule changes, destroying no candidate', async () => {
    const id = await twoDisagreeingSources();

    const before = await sql<{ count: string }>`
      SELECT count(*) AS count FROM party.field_candidate WHERE entity_id = ${id}::uuid
    `.execute(testDb.db);

    // Someone decides the CRM should own names too, and bumps the version.
    await sql`
      UPDATE party.survivorship_rule
         SET source_priority = ARRAY['MANUAL','PIPEDRIVE','P21']::kernel.code_key[],
             version = version + 1
       WHERE entity_type = 'ORGANIZATION' AND field_key IS NULL
    `.execute(testDb.db);

    const changed = await inUnitOfWork(async (uow, party) =>
      reevaluateOrganization(uow, party, id),
    );
    expect(changed).toContain('legal_name');

    const view = await readOrganization(testDb.db, id);
    expect(view.legalName).toBe('Keystone Process Systems, Inc.');

    // No candidate was destroyed, and the new reason records the rule that chose it.
    const after = await sql<{ count: string }>`
      SELECT count(*) AS count FROM party.field_candidate WHERE entity_id = ${id}::uuid
    `.execute(testDb.db);
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count);

    const provenance = await inUnitOfWork(async (uow) =>
      readProvenance(uow, 'ORGANIZATION', id, 'legal_name'),
    );
    expect(provenance[0]!.sourceSystemCode).toBe('PIPEDRIVE');
    expect(provenance[0]!.selectedReason).toContain('PIPEDRIVE outranks P21');
    expect(provenance[0]!.ruleVersion).toBe(2);
    // And the P21 value is still there, unchanged, ready to win again if the rule
    // is put back.
    expect(provenance[1]!.value).toBe('KEYSTONE PROCESS SYSTEMS INC');
  });

  it('makes a human edit a candidate from MANUAL, not a direct write', async () => {
    const id = await twoDisagreeingSources();

    await inUnitOfWork(async (uow, party) =>
      assertOrganizationFields(uow, party, {
        organizationId: id,
        candidates: [
          {
            fieldKey: 'legal_name',
            value: 'Keystone Process Systems',
            sourceSystemCode: 'MANUAL',
            reason: 'Checked against the certificate of incorporation.',
          },
        ],
      }),
    );

    const view = await readOrganization(testDb.db, id);
    expect(view.legalName).toBe('Keystone Process Systems');

    const provenance = await inUnitOfWork(async (uow) =>
      readProvenance(uow, 'ORGANIZATION', id, 'legal_name'),
    );
    // Three candidates now, not one edited row. The human's value won through the same
    // mechanism as every other source, which is what keeps a merge reversible.
    expect(provenance).toHaveLength(3);
    expect(provenance[0]!.sourceSystemCode).toBe('MANUAL');
    expect(provenance[0]!.reason).toBe(
      'Checked against the certificate of incorporation.',
    );
  });

  it('refuses a manual value with no reason', async () => {
    const id = await twoDisagreeingSources();
    await expect(
      inUnitOfWork(async (uow, party) =>
        assertOrganizationFields(uow, party, {
          organizationId: id,
          candidates: [
            { fieldKey: 'legal_name', value: 'Whatever', sourceSystemCode: 'MANUAL' },
          ],
        }),
      ),
    ).rejects.toThrow(/needs a reason/);
  });

  it('prefers a verified value over a higher-priority unverified one', async () => {
    const id = await inUnitOfWork(async (uow, party) => {
      const created = await createOrganization(uow, party, {
        legalName: 'Unverified ERP Name',
        sourceSystemCode: 'P21',
      });
      await assertOrganizationFields(uow, party, {
        organizationId: created,
        candidates: [
          {
            fieldKey: 'legal_name',
            value: 'Verified CRM Name',
            sourceSystemCode: 'PIPEDRIVE',
            verificationStatus: 'VERIFIED',
          },
        ],
      });
      return created;
    });

    const view = await readOrganization(testDb.db, id);
    expect(view.legalName).toBe('Verified CRM Name');

    const provenance = await inUnitOfWork(async (uow) =>
      readProvenance(uow, 'ORGANIZATION', id, 'legal_name'),
    );
    expect(provenance[0]!.selectedReason).toContain('prefers verified');
  });

  it('does not let a source that asserts absence blank a value another source has', async () => {
    const id = await inUnitOfWork(async (uow, party) => {
      const created = await createOrganization(uow, party, {
        legalName: 'Bucks County Water Authority',
        sourceSystemCode: 'P21',
        fields: [
          { fieldKey: 'main_phone', value: '215-555-0100', sourceSystemCode: 'P21' },
        ],
      });
      // Someone cleared the phone number in the CRM. That is a claim, and it is
      // recorded — but blanking a number the ERP has is not the default outcome.
      await assertOrganizationFields(uow, party, {
        organizationId: created,
        candidates: [
          { fieldKey: 'main_phone', assertsAbsence: true, sourceSystemCode: 'PIPEDRIVE' },
        ],
      });
      return created;
    });

    const row = await sql<{ main_phone: string | null }>`
      SELECT main_phone FROM party.organization WHERE id = ${id}::uuid
    `.execute(testDb.db);
    expect(row.rows[0]!.main_phone).toBe('215-555-0100');

    // The claim is still recorded, so the disagreement is visible rather than lost.
    const provenance = await inUnitOfWork(async (uow) =>
      readProvenance(uow, 'ORGANIZATION', id, 'main_phone'),
    );
    expect(provenance).toHaveLength(2);
    expect(
      provenance.find((e) => e.sourceSystemCode === 'PIPEDRIVE')!.assertsAbsence,
    ).toBe(true);
  });

  it('does not record a candidate when a source is simply silent', async () => {
    const id = await inUnitOfWork(async (uow, party) =>
      createOrganization(uow, party, {
        legalName: 'Silent Source Co',
        sourceSystemCode: 'P21',
        fields: [
          { fieldKey: 'main_phone', value: null, sourceSystemCode: 'P21' },
          { fieldKey: 'trade_name', value: undefined, sourceSystemCode: 'P21' },
        ],
      }),
    );

    // Silence is not a claim. A row here would show up as a disagreement that no
    // source is actually having.
    const provenance = await inUnitOfWork(async (uow) =>
      readProvenance(uow, 'ORGANIZATION', id),
    );
    expect(provenance.map((entry) => entry.fieldKey)).toEqual(['legal_name']);
  });

  it('emits a field-change event carrying the field key and never the value', async () => {
    await twoDisagreeingSources();

    const events = await sql<{ event_type: string; payload: Record<string, unknown> }>`
      SELECT event_type, payload FROM events.domain_event ORDER BY sequence
    `.execute(testDb.db);

    expect(events.rows.map((r) => r.event_type)).toContain(
      'fsw.party.OrganizationFieldValueChanged',
    );
    const changed = events.rows.filter(
      (r) => r.event_type === 'fsw.party.OrganizationFieldValueChanged',
    );
    expect(changed.map((r) => r.payload['fieldKey']).sort()).toEqual(['website_url']);
    expect(changed[0]!.payload['winningSourceCode']).toBe('PIPEDRIVE');

    // A name is personal-adjacent and a person's name is personal data outright. No
    // event payload anywhere in this run carries a value (ADR-0027).
    const serialised = JSON.stringify(events.rows);
    expect(serialised).not.toContain('Keystone');
    expect(serialised).not.toContain('keystoneprocess.com');
  });
});
