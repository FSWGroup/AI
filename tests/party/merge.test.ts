import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { createTestDatabase, type TestDatabase } from '../support/database.js';
import { testContext, testDeps } from '../support/context.js';
import { syncEventRegistry } from '../../src/modules/events/index.js';
import { ALL_EVENTS } from '../../src/event-catalog.js';
import { withUnitOfWork, type UnitOfWork } from '../../src/kernel/unit-of-work.js';
import {
  assertOrganizationFields,
  createOrganization,
  loadPartyDeps,
  loadMatchConfig,
  mergeOrganizations,
  readOrganization,
  readProvenance,
  resolveOrganization,
  resolveOrganizationId,
  decideCandidate,
  unmergeOrganizations,
  type PartyDeps,
} from '../../src/modules/party/index.js';

/**
 * Acceptance criteria 8 and 9 (spec §83):
 *
 *   8 — two source records resolve to one organization through an explainable match;
 *       a human approves it; both source records are preserved.
 *   9 — the merge is undone, relationships are restored, and nothing is lost.
 *
 * The scenario is FSW's actual problem: Prophet 21 and Pipedrive each hold a record for
 * the same company under slightly different names, and neither shares an identifier
 * with the other.
 */
describe('entity resolution, merge and unmerge (AC8, AC9)', () => {
  let testDb: TestDatabase;
  let deps: ReturnType<typeof testDeps>;

  beforeAll(async () => {
    testDb = await createTestDatabase('merge');
    await syncEventRegistry(testDb.db, ALL_EVENTS);
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await sql`
      TRUNCATE party.merge_link_move, party.organization_merge, party.match_candidate,
               party.organization_alias, party.field_candidate, party.source_link,
               party.person_affiliation, party.commercial_account, party.site,
               party.organization_role, party.organization_relationship,
               party.organization, party.location RESTART IDENTITY CASCADE
    `.execute(testDb.db);
    await sql`
      TRUNCATE events.event_delivery, events.domain_event RESTART IDENTITY CASCADE
    `.execute(testDb.db);
    deps = testDeps();
  });

  async function inUnitOfWork<T>(
    work: (uow: UnitOfWork, party: PartyDeps) => Promise<T>,
  ): Promise<T> {
    return withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
      const party = await loadPartyDeps(uow.tx);
      return work(uow, party);
    });
  }

  /** A location, so blocking and the address signals have something to work with. */
  async function makeLocation(
    uow: UnitOfWork,
    line1: string,
    postal: string,
  ): Promise<string> {
    const id = uow.ids.next();
    await sql`
      INSERT INTO party.location (id, raw_address, line1, city, region_code, postal_code)
      VALUES (${id}, ${line1}, ${line1}, 'West Chester', 'PA', ${postal})
    `.execute(uow.tx);
    return id;
  }

  /**
   * The same company as two source systems see it. Neither record shares an identifier
   * with the other, which is exactly why deterministic matching alone is insufficient.
   */
  async function twoRecordsOfOneCompany(): Promise<{ erp: string; crm: string }> {
    return inUnitOfWork(async (uow, party) => {
      const address = await makeLocation(uow, '100 Industrial Way', '19380');

      const erp = await createOrganization(uow, party, {
        legalName: 'ACME PHARMA LLC',
        sourceSystemCode: 'P21',
        fields: [
          { fieldKey: 'primary_location_id', value: address, sourceSystemCode: 'P21' },
          { fieldKey: 'main_phone', value: '610-555-0100', sourceSystemCode: 'P21' },
          {
            fieldKey: 'website_url',
            value: 'http://acmepharma.com',
            sourceSystemCode: 'P21',
          },
        ],
        roles: [{ roleCode: 'CUSTOMER', operatingCompany: 'WELSFORD' }],
      });

      const crmAddress = await makeLocation(uow, '100 Industrial Way', '19380');
      const crm = await createOrganization(uow, party, {
        legalName: 'Acme Pharmaceutical, Inc.',
        sourceSystemCode: 'PIPEDRIVE',
        fields: [
          {
            fieldKey: 'primary_location_id',
            value: crmAddress,
            sourceSystemCode: 'PIPEDRIVE',
          },
          {
            fieldKey: 'website_url',
            value: 'https://www.acmepharma.com',
            sourceSystemCode: 'PIPEDRIVE',
          },
        ],
        roles: [{ roleCode: 'PROSPECT', operatingCompany: 'VALVEMAN' }],
      });

      return { erp, crm };
    });
  }

  describe('resolution (AC8)', () => {
    it('finds the pair, scores it, and queues it with the evidence that explains it', async () => {
      const { erp, crm } = await twoRecordsOfOneCompany();

      const outcomes = await inUnitOfWork(async (uow) => {
        const config = await loadMatchConfig(uow.tx);
        return resolveOrganization(uow, config, erp);
      });

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]!.otherId).toBe(crm);

      const queued = await sql<{
        status: string;
        score: string;
        method: string;
        features: {
          signal: string;
          value: number;
          weight: number;
          contribution: number;
          detail: string;
        }[];
        deterministic_rule: string | null;
      }>`
        SELECT status, score, method, features, deterministic_rule
          FROM party.match_candidate
      `.execute(testDb.db);
      expect(queued.rows).toHaveLength(1);

      // 'acme pharma' against 'acme pharmaceutical' is 0.52 on trigrams — well under
      // the deterministic floor of 0.85 — so the domain-and-name rule does NOT fire.
      // That is the conservative behaviour these rules are meant to have: they bypass
      // scoring entirely, so they must not fire on a plausible coincidence. Two
      // subsidiaries can share a corporate website.
      expect(queued.rows[0]!.method).toBe('PROBABILISTIC');
      expect(queued.rows[0]!.deterministic_rule).toBeNull();
      // The weighted stage is what catches it, on the address, postal code, city and
      // domain all agreeing.
      expect(Number(queued.rows[0]!.score)).toBeGreaterThan(0.65);
      expect(Number(queued.rows[0]!.score)).toBeLessThan(1);

      // It is queued, not linked: the default configuration disables auto-linking
      // until precision has been measured on real data.
      expect(queued.rows[0]!.status).toBe('PENDING');

      // And the evidence is there for a person to read — which signals fired, what
      // each measured, and what each contributed.
      const features = queued.rows[0]!.features;
      const signals = features.map((f) => f.signal);
      expect(signals).toContain('name_similarity');
      expect(signals).toContain('address_similarity');
      expect(signals).toContain('domain_exact');
      expect(features.find((f) => f.signal === 'name_similarity')!.detail).toContain(
        'acme pharma',
      );
    });

    it('links deterministically when a trusted identifier agrees, whatever else does not', async () => {
      const ids = await inUnitOfWork(async (uow, party) => {
        const left = await createOrganization(uow, party, {
          legalName: 'Bucks County Water Authority',
          sourceSystemCode: 'P21',
          fields: [
            { fieldKey: 'tax_identifier', value: '23-1234567', sourceSystemCode: 'P21' },
          ],
        });
        const right = await createOrganization(uow, party, {
          legalName: 'Bucks Cty Water Auth',
          sourceSystemCode: 'PIPEDRIVE',
          fields: [
            {
              fieldKey: 'tax_identifier',
              value: '231234567',
              sourceSystemCode: 'PIPEDRIVE',
            },
          ],
        });
        return { left, right };
      });

      await inUnitOfWork(async (uow) => {
        const config = await loadMatchConfig(uow.tx);
        return resolveOrganization(uow, config, ids.left);
      });

      const row = await sql<{
        method: string;
        deterministic_rule: string;
        score: string;
      }>`
        SELECT method, deterministic_rule, score FROM party.match_candidate
      `.execute(testDb.db);
      expect(row.rows[0]!.method).toBe('DETERMINISTIC');
      expect(row.rows[0]!.deterministic_rule).toBe('TRUSTED_TAX_IDENTIFIER');
      // A weighted score would have been dragged under the threshold by the differing
      // names and the absent addresses. Two records with one EIN are one company.
      expect(Number(row.rows[0]!.score)).toBe(1);
    });

    it('stores a pair once however it was discovered', async () => {
      const { erp, crm } = await twoRecordsOfOneCompany();
      await inUnitOfWork(async (uow) => {
        const config = await loadMatchConfig(uow.tx);
        await resolveOrganization(uow, config, erp);
        await resolveOrganization(uow, config, crm);
      });

      const rows = await sql<{ count: string }>`
        SELECT count(*) AS count FROM party.match_candidate
      `.execute(testDb.db);
      expect(Number(rows.rows[0]!.count)).toBe(1);
    });

    it('does not resurface a pair a steward has rejected', async () => {
      const { erp, crm } = await twoRecordsOfOneCompany();

      const candidateId = await inUnitOfWork(async (uow) => {
        const config = await loadMatchConfig(uow.tx);
        const outcomes = await resolveOrganization(uow, config, erp);
        return outcomes[0]!.candidateId;
      });

      await inUnitOfWork(async (uow) =>
        decideCandidate(
          uow,
          candidateId,
          'KNOWN_DIFFERENT',
          'Two subsidiaries sharing a corporate website. Confirmed with the account manager.',
        ),
      );

      // Re-running resolution must not put it back. A queue that refills with pairs a
      // steward has already ruled on is a queue nobody reads.
      await inUnitOfWork(async (uow) => {
        const config = await loadMatchConfig(uow.tx);
        await resolveOrganization(uow, config, erp);
        await resolveOrganization(uow, config, crm);
      });

      const rows = await sql<{ status: string }>`
        SELECT status FROM party.match_candidate
      `.execute(testDb.db);
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]!.status).toBe('KNOWN_DIFFERENT');
    });

    it('does resurface it when a source says something new', async () => {
      const { erp, crm } = await twoRecordsOfOneCompany();

      const candidateId = await inUnitOfWork(async (uow) => {
        const config = await loadMatchConfig(uow.tx);
        return (await resolveOrganization(uow, config, erp))[0]!.candidateId;
      });
      await inUnitOfWork(async (uow) =>
        decideCandidate(uow, candidateId, 'REJECTED', 'Looked wrong at the time.'),
      );

      // The CRM now carries the same phone number as the ERP. That is new evidence
      // about these two companies, not a tuning change, so the pair comes back.
      await inUnitOfWork(async (uow, party) =>
        assertOrganizationFields(uow, party, {
          organizationId: crm,
          candidates: [
            {
              fieldKey: 'main_phone',
              value: '610-555-0100',
              sourceSystemCode: 'PIPEDRIVE',
            },
          ],
        }),
      );

      await inUnitOfWork(async (uow) => {
        const config = await loadMatchConfig(uow.tx);
        await resolveOrganization(uow, config, erp);
      });

      const rows = await sql<{ status: string }>`
        SELECT status FROM party.match_candidate ORDER BY created_at
      `.execute(testDb.db);
      expect(rows.rows.map((r) => r.status)).toEqual(['SUPERSEDED', 'PENDING']);
    });

    it('refuses a decision with no reason', async () => {
      const { erp } = await twoRecordsOfOneCompany();
      const candidateId = await inUnitOfWork(async (uow) => {
        const config = await loadMatchConfig(uow.tx);
        return (await resolveOrganization(uow, config, erp))[0]!.candidateId;
      });

      await expect(
        inUnitOfWork(async (uow) => decideCandidate(uow, candidateId, 'REJECTED', '  ')),
      ).rejects.toThrow(/needs a reason/);
    });
  });

  describe('merge (AC8)', () => {
    it("moves the loser's children and preserves both records", async () => {
      const { erp, crm } = await twoRecordsOfOneCompany();

      const result = await inUnitOfWork(async (uow, party) =>
        mergeOrganizations(uow, party, {
          survivingOrganizationId: erp,
          mergedOrganizationId: crm,
          reason:
            'Same company; the CRM record was created before the ERP account existed.',
          method: 'MANUAL',
        }),
      );

      expect(result.movedRows).toBeGreaterThan(0);

      // Both records survive. The merged one keeps its identity forever so every
      // identifier ever issued still resolves.
      const rows = await sql<{
        id: string;
        merged_into_id: string | null;
        lifecycle_status: string;
      }>`
        SELECT id, merged_into_id, lifecycle_status FROM party.organization ORDER BY created_at
      `.execute(testDb.db);
      expect(rows.rows).toHaveLength(2);
      const loser = rows.rows.find((r) => r.id === crm)!;
      expect(loser.merged_into_id).toBe(erp);
      expect(loser.lifecycle_status).toBe('DUPLICATE');

      // The roles moved: the survivor is now both a Welsford customer and a ValveMan
      // prospect, which is what one company playing two roles looks like.
      const roles = await sql<{ role_code: string; operating_company: string }>`
        SELECT role_code, operating_company FROM party.organization_role
         WHERE organization_id = ${erp}::uuid ORDER BY role_code
      `.execute(testDb.db);
      expect(roles.rows).toEqual([
        { role_code: 'CUSTOMER', operating_company: 'WELSFORD' },
        { role_code: 'PROSPECT', operating_company: 'VALVEMAN' },
      ]);
    });

    it("changes the survivor's values only by giving it more candidates", async () => {
      const { erp, crm } = await twoRecordsOfOneCompany();
      const before = await readOrganization(testDb.db, erp);
      expect(before.websiteUrl).toBe('http://acmepharma.com');

      await inUnitOfWork(async (uow, party) =>
        mergeOrganizations(uow, party, {
          survivingOrganizationId: erp,
          mergedOrganizationId: crm,
          reason: 'Confirmed the same company.',
        }),
      );

      // The website rule prefers the CRM, and the survivor now holds the CRM's
      // candidate. Nothing copied a value across: survivorship simply had more to
      // choose from.
      const after = await readOrganization(testDb.db, erp);
      expect(after.websiteUrl).toBe('https://www.acmepharma.com');

      const provenance = await inUnitOfWork(async (uow) =>
        readProvenance(uow, 'ORGANIZATION', erp, 'legal_name'),
      );
      expect(provenance).toHaveLength(2);
      expect(provenance.map((p) => p.sourceSystemCode).sort()).toEqual([
        'P21',
        'PIPEDRIVE',
      ]);
      // The ERP still wins the name under the default rule, as it did before.
      expect(provenance[0]!.sourceSystemCode).toBe('P21');
    });

    it('keeps a merged identifier resolving to the survivor', async () => {
      const { erp, crm } = await twoRecordsOfOneCompany();
      await inUnitOfWork(async (uow, party) =>
        mergeOrganizations(uow, party, {
          survivingOrganizationId: erp,
          mergedOrganizationId: crm,
          reason: 'Same company.',
        }),
      );

      const resolved = await resolveOrganizationId(testDb.db as never, crm);
      expect(resolved).toEqual({ id: erp, wasRedirected: true });
      expect(await resolveOrganizationId(testDb.db as never, erp)).toEqual({
        id: erp,
        wasRedirected: false,
      });
    });

    it('refuses a merge with no reason, and a merge into itself', async () => {
      const { erp, crm } = await twoRecordsOfOneCompany();
      await expect(
        inUnitOfWork(async (uow, party) =>
          mergeOrganizations(uow, party, {
            survivingOrganizationId: erp,
            mergedOrganizationId: crm,
            reason: '   ',
          }),
        ),
      ).rejects.toThrow(/needs a reason/);

      await expect(
        inUnitOfWork(async (uow, party) =>
          mergeOrganizations(uow, party, {
            survivingOrganizationId: erp,
            mergedOrganizationId: erp,
            reason: 'x',
          }),
        ),
      ).rejects.toThrow(/into itself/);
    });

    it('refuses to merge a record that has already been merged', async () => {
      const { erp, crm } = await twoRecordsOfOneCompany();
      await inUnitOfWork(async (uow, party) =>
        mergeOrganizations(uow, party, {
          survivingOrganizationId: erp,
          mergedOrganizationId: crm,
          reason: 'Same company.',
        }),
      );

      const third = await inUnitOfWork(async (uow, party) =>
        createOrganization(uow, party, {
          legalName: 'Third Co',
          sourceSystemCode: 'P21',
        }),
      );

      await expect(
        inUnitOfWork(async (uow, party) =>
          mergeOrganizations(uow, party, {
            survivingOrganizationId: third,
            mergedOrganizationId: crm,
            reason: 'Also the same company.',
          }),
        ),
      ).rejects.toThrow(/already been merged/);
    });
  });

  describe('unmerge (AC9)', () => {
    it('restores both organizations and everything that moved', async () => {
      const { erp, crm } = await twoRecordsOfOneCompany();
      const erpBefore = await readOrganization(testDb.db, erp);
      const crmBefore = await readOrganization(testDb.db, crm);

      const merge = await inUnitOfWork(async (uow, party) =>
        mergeOrganizations(uow, party, {
          survivingOrganizationId: erp,
          mergedOrganizationId: crm,
          reason: 'Same company.',
        }),
      );

      const undone = await inUnitOfWork(async (uow, party) =>
        unmergeOrganizations(uow, party, {
          mergeId: merge.mergeId,
          reason: 'Two subsidiaries after all; the account manager confirmed.',
        }),
      );
      expect(undone.restoredRows).toBe(merge.movedRows);

      // Both are live again, and each says what it said before — recomputed from its
      // own candidates rather than restored from a snapshot.
      const erpAfter = await readOrganization(testDb.db, erp);
      const crmAfter = await readOrganization(testDb.db, crm);
      expect(erpAfter.legalName).toBe(erpBefore.legalName);
      expect(erpAfter.websiteUrl).toBe(erpBefore.websiteUrl);
      expect(crmAfter.legalName).toBe(crmBefore.legalName);
      expect(crmAfter.websiteUrl).toBe(crmBefore.websiteUrl);
      expect(crmAfter.lifecycleStatus).toBe('ACTIVE');

      // The roles went back where they came from.
      const erpRoles = await sql<{ role_code: string }>`
        SELECT role_code FROM party.organization_role WHERE organization_id = ${erp}::uuid
      `.execute(testDb.db);
      const crmRoles = await sql<{ role_code: string }>`
        SELECT role_code FROM party.organization_role WHERE organization_id = ${crm}::uuid
      `.execute(testDb.db);
      expect(erpRoles.rows.map((r) => r.role_code)).toEqual(['CUSTOMER']);
      expect(crmRoles.rows.map((r) => r.role_code)).toEqual(['PROSPECT']);
    });

    it('keeps what was learned while the two were merged', async () => {
      const { erp, crm } = await twoRecordsOfOneCompany();
      const merge = await inUnitOfWork(async (uow, party) =>
        mergeOrganizations(uow, party, {
          survivingOrganizationId: erp,
          mergedOrganizationId: crm,
          reason: 'Same company.',
        }),
      );

      // Someone corrects the name while the records are merged.
      await inUnitOfWork(async (uow, party) =>
        assertOrganizationFields(uow, party, {
          organizationId: erp,
          candidates: [
            {
              fieldKey: 'legal_name',
              value: 'Acme Pharma',
              sourceSystemCode: 'MANUAL',
              reason: 'Checked against the certificate of incorporation.',
            },
          ],
        }),
      );

      await inUnitOfWork(async (uow, party) =>
        unmergeOrganizations(uow, party, {
          mergeId: merge.mergeId,
          reason: 'Not the same.',
        }),
      );

      // The correction is not discarded. This is where a snapshot-and-restore
      // implementation silently loses everything learned during the merge.
      expect((await readOrganization(testDb.db, erp)).legalName).toBe('Acme Pharma');
    });

    it('reverses only its own merge in a chain', async () => {
      const { erp, crm } = await twoRecordsOfOneCompany();
      const third = await inUnitOfWork(async (uow, party) =>
        createOrganization(uow, party, {
          legalName: 'Acme Pharma West',
          sourceSystemCode: 'VALVEMAN_STORE',
          roles: [{ roleCode: 'CUSTOMER', operatingCompany: 'VALVEMAN' }],
        }),
      );

      const first = await inUnitOfWork(async (uow, party) =>
        mergeOrganizations(uow, party, {
          survivingOrganizationId: erp,
          mergedOrganizationId: crm,
          reason: 'Same company.',
        }),
      );
      await inUnitOfWork(async (uow, party) =>
        mergeOrganizations(uow, party, {
          survivingOrganizationId: erp,
          mergedOrganizationId: third,
          reason: 'The web account too.',
        }),
      );

      await inUnitOfWork(async (uow, party) =>
        unmergeOrganizations(uow, party, { mergeId: first.mergeId, reason: 'Wrong.' }),
      );

      // The first merge is undone; the second still stands.
      const rows = await sql<{ id: string; merged_into_id: string | null }>`
        SELECT id, merged_into_id FROM party.organization
      `.execute(testDb.db);
      expect(rows.rows.find((r) => r.id === crm)!.merged_into_id).toBeNull();
      expect(rows.rows.find((r) => r.id === third)!.merged_into_id).toBe(erp);
    });

    it('refuses to unmerge out of order', async () => {
      const { erp, crm } = await twoRecordsOfOneCompany();
      const other = await inUnitOfWork(async (uow, party) =>
        createOrganization(uow, party, {
          legalName: 'Parent Co',
          sourceSystemCode: 'P21',
        }),
      );

      const inner = await inUnitOfWork(async (uow, party) =>
        mergeOrganizations(uow, party, {
          survivingOrganizationId: erp,
          mergedOrganizationId: crm,
          reason: 'Same company.',
        }),
      );
      // The survivor is itself merged away.
      await inUnitOfWork(async (uow, party) =>
        mergeOrganizations(uow, party, {
          survivingOrganizationId: other,
          mergedOrganizationId: erp,
          reason: 'And that one belongs to the parent record.',
        }),
      );

      await expect(
        inUnitOfWork(async (uow, party) =>
          unmergeOrganizations(uow, party, { mergeId: inner.mergeId, reason: 'Undo.' }),
        ),
      ).rejects.toThrow(/Reverse that merge first/);
    });

    it('refuses to reverse the same merge twice', async () => {
      const { erp, crm } = await twoRecordsOfOneCompany();
      const merge = await inUnitOfWork(async (uow, party) =>
        mergeOrganizations(uow, party, {
          survivingOrganizationId: erp,
          mergedOrganizationId: crm,
          reason: 'Same company.',
        }),
      );
      await inUnitOfWork(async (uow, party) =>
        unmergeOrganizations(uow, party, { mergeId: merge.mergeId, reason: 'Undo.' }),
      );
      await expect(
        inUnitOfWork(async (uow, party) =>
          unmergeOrganizations(uow, party, { mergeId: merge.mergeId, reason: 'Again.' }),
        ),
      ).rejects.toThrow(/already been reversed/);
    });

    it('keeps the merge record after reversal, with who reversed it and why', async () => {
      const { erp, crm } = await twoRecordsOfOneCompany();
      const merge = await inUnitOfWork(async (uow, party) =>
        mergeOrganizations(uow, party, {
          survivingOrganizationId: erp,
          mergedOrganizationId: crm,
          reason: 'Same company.',
        }),
      );
      await inUnitOfWork(async (uow, party) =>
        unmergeOrganizations(uow, party, {
          mergeId: merge.mergeId,
          reason: 'Two subsidiaries after all.',
        }),
      );

      // A merge that happened is a fact about what people believed; the reversal is
      // another fact beside it, not an erasure of the first.
      const row = await sql<{
        reason: string;
        reversal_reason: string;
        reversed_at: Date;
      }>`
        SELECT reason, reversal_reason, reversed_at FROM party.organization_merge
         WHERE id = ${merge.mergeId}::uuid
      `.execute(testDb.db);
      expect(row.rows[0]!.reason).toBe('Same company.');
      expect(row.rows[0]!.reversal_reason).toBe('Two subsidiaries after all.');
      expect(row.rows[0]!.reversed_at).not.toBeNull();
    });
  });

  describe('the merge manifest (ADR-0012)', () => {
    it('registers every table that points at an organization', async () => {
      // The tripwire ADR-0012 requires. An unregistered child table would be silently
      // left behind on merge, pointing at a record that takes no new facts, and nobody
      // would notice until someone asked where a site had gone.
      const unregistered = await sql<{ table_name: string; column_name: string }>`
        SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name
          FROM pg_constraint c
          JOIN pg_attribute a
            ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
         WHERE c.contype = 'f'
           AND c.confrelid = 'party.organization'::regclass
           AND c.conrelid <> 'party.organization'::regclass
           -- A generated column follows the column it is generated from, so it needs
           -- no manifest row of its own. party.field_candidate.organization_id is one:
           -- it is derived from entity_id, which the manifest does register.
           AND a.attgenerated = ''
           AND NOT EXISTS (
             SELECT 1 FROM party.merge_manifest m
              WHERE m.entity_table = c.conrelid::regclass::text
                AND m.column_name = a.attname
           )
      `.execute(testDb.db);

      expect(
        unregistered.rows,
        'These tables reference party.organization but are not in party.merge_manifest. ' +
          'Register them as MOVE, or as NEVER_MOVE with a note saying why — an ' +
          'omission is indistinguishable from an oversight.',
      ).toEqual([]);
    });

    it("never moves the merge ledger's own references", async () => {
      // Re-pointing these during a later merge would rewrite the record of an earlier
      // one, and the unmerge that depends on it would restore rows to the wrong place.
      const excluded = await sql<{ column_name: string; strategy: string }>`
        SELECT column_name, strategy FROM party.merge_manifest
         WHERE entity_table = 'party.organization_merge' ORDER BY column_name
      `.execute(testDb.db);
      expect(excluded.rows).toEqual([
        { column_name: 'merged_organization_id', strategy: 'NEVER_MOVE' },
        { column_name: 'surviving_organization_id', strategy: 'NEVER_MOVE' },
      ]);
    });

    it('registers nothing that does not exist', async () => {
      const phantom = await sql<{ entity_table: string; column_name: string }>`
        SELECT m.entity_table, m.column_name FROM party.merge_manifest m
         WHERE NOT EXISTS (
           SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema || '.' || c.table_name = m.entity_table
              AND c.column_name = m.column_name
         )
      `.execute(testDb.db);
      expect(phantom.rows).toEqual([]);
    });

    it('moves the generic candidate table by entity_id, not by a column it lacks', async () => {
      // party.field_candidate has no organization_id column of its own — it has a
      // generated one — so the manifest must name entity_id. Getting this wrong would
      // fail at merge time rather than here.
      const row = await sql<{ column_name: string }>`
        SELECT column_name FROM party.merge_manifest
         WHERE entity_table = 'party.field_candidate'
      `.execute(testDb.db);
      expect(row.rows[0]!.column_name).toBe('entity_id');
    });
  });

  it('emits merge and reversal events carrying identifiers only', async () => {
    const { erp, crm } = await twoRecordsOfOneCompany();
    const merge = await inUnitOfWork(async (uow, party) =>
      mergeOrganizations(uow, party, {
        survivingOrganizationId: erp,
        mergedOrganizationId: crm,
        reason: 'Same company.',
      }),
    );
    await inUnitOfWork(async (uow, party) =>
      unmergeOrganizations(uow, party, { mergeId: merge.mergeId, reason: 'Undo.' }),
    );

    const events = await sql<{ event_type: string; payload: Record<string, unknown> }>`
      SELECT event_type, payload FROM events.domain_event ORDER BY sequence
    `.execute(testDb.db);
    const types = events.rows.map((r) => r.event_type);
    expect(types).toContain('fsw.party.OrganizationsMerged');
    expect(types).toContain('fsw.party.OrganizationMergeReversed');

    const serialised = JSON.stringify(events.rows);
    expect(serialised).not.toContain('Acme');
    expect(serialised).not.toContain('acmepharma.com');
    // Nor the reason: a merge reason routinely names a person who confirmed it.
    expect(serialised).not.toContain('Same company.');
  });
});
