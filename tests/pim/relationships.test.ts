import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { createTestDatabase, type TestDatabase } from '../support/database.js';
import { applyRealMetadata } from '../support/metadata.js';
import { testContext, testDeps, TEST_ACTOR } from '../support/context.js';
import { withUnitOfWork } from '../../src/kernel/unit-of-work.js';
import { syncEventRegistry, readEvents } from '../../src/modules/events/index.js';
import {
  assertRelationship,
  verifyRelationship,
  relationshipsFor,
  resolveSupersession,
  recordCertification,
  certificationsFor,
  pimEvents,
} from '../../src/modules/pim/index.js';
import { seedCatalog } from '../../tools/seed-data.js';
import type { Database } from '../../src/platform/db/index.js';

const deps = testDeps();
const VERIFIER = TEST_ACTOR.principalId!;

async function variantIdFor(db: Database, mpn: string): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    SELECT id FROM pim.variant WHERE manufacturer_part_number = ${mpn}
  `.execute(db);
  return rows[0]!.id;
}

describe('cross-references and supersession', () => {
  let testDb: TestDatabase;
  let A: string;
  let B: string;
  let C: string;

  beforeAll(async () => {
    testDb = await createTestDatabase('relationships');
    await applyRealMetadata(testDb.db);
    await syncEventRegistry(testDb.db, [...pimEvents]);
    await seedCatalog(testDb.db, deps);

    A = await variantIdFor(testDb.db, '77C-103-01');
    B = await variantIdFor(testDb.db, 'LFFBV-3C-0050');
    C = await variantIdFor(testDb.db, '76F-104-01');
  }, 120_000);

  afterAll(async () => {
    await testDb.close();
  });

  describe('relationship types are not interchangeable (acceptance criterion 21)', () => {
    it('distinguishes an exact equivalent from a closest comparable', async () => {
      const exact = await variantIdFor(testDb.db, '77C-104-01');
      const comparable = await variantIdFor(testDb.db, 'S30-0300-11300');
      const subject = await variantIdFor(testDb.db, '77C-105-01');

      await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
        await assertRelationship(uow, {
          from: { level: 'VARIANT', id: subject },
          to: { level: 'VARIANT', id: exact },
          relationshipType: 'EXACT_EQUIVALENT',
          confidence: 1.0,
          verify: {
            by: VERIFIER,
            evidence:
              'Dimensional and pressure-rating comparison against both manufacturer ' +
              'datasheets; identical face-to-face, port and rating.',
          },
        });
        await assertRelationship(uow, {
          from: { level: 'VARIANT', id: subject },
          to: { level: 'VARIANT', id: comparable },
          relationshipType: 'CLOSEST_COMPARABLE',
          confidence: 0.4,
          notes:
            'Different valve type entirely; offered only when nothing closer is available.',
        });
      });

      const relationships = await relationshipsFor(testDb.db, {
        level: 'VARIANT',
        id: subject,
      });

      const equivalent = relationships.find(
        (r) => r.relationshipType === 'EXACT_EQUIVALENT',
      )!;
      const closest = relationships.find(
        (r) => r.relationshipType === 'CLOSEST_COMPARABLE',
      )!;

      // The API exposes the distinction rather than flattening both into
      // "related products", which is the entire point of acceptance criterion 21.
      expect(equivalent.impliesInterchangeable).toBe(true);
      expect(equivalent.verificationStatus).toBe('VERIFIED');
      expect(equivalent.safeToSubstitute).toBe(true);
      expect(equivalent.evidence).toMatch(/Dimensional and pressure-rating comparison/);
      expect(Number(equivalent.confidence)).toBe(1);

      expect(closest.impliesInterchangeable).toBe(false);
      expect(closest.verificationStatus).toBe('UNVERIFIED');
      expect(closest.safeToSubstitute).toBe(false);
      expect(Number(closest.confidence)).toBeLessThan(0.5);
    });

    it('refuses to record an interchangeability claim nobody has verified', async () => {
      // EXACT_EQUIVALENT and APPROVED_REPLACEMENT assert that a substitution is safe.
      // An unverified claim of that kind is exactly what should not reach a quote.
      await expect(
        withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
          await assertRelationship(uow, {
            from: { level: 'VARIANT', id: A },
            to: { level: 'VARIANT', id: B },
            relationshipType: 'EXACT_EQUIVALENT',
          });
        }),
      ).rejects.toThrow(/must be verified by a named person with stated evidence/);
    });

    it('treats an equivalence as symmetric and a replacement as directional', async () => {
      const left = await variantIdFor(testDb.db, '8210G094');
      const right = await variantIdFor(testDb.db, '8210G095');

      await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
        await assertRelationship(uow, {
          from: { level: 'VARIANT', id: left },
          to: { level: 'VARIANT', id: right },
          relationshipType: 'EXACT_EQUIVALENT',
          confidence: 0.95,
          verify: {
            by: VERIFIER,
            evidence: 'Same body and Cv; coil voltage differs only.',
          },
        });
      });

      // Recorded once, visible from both ends.
      const fromLeft = await relationshipsFor(testDb.db, { level: 'VARIANT', id: left });
      const fromRight = await relationshipsFor(testDb.db, {
        level: 'VARIANT',
        id: right,
      });
      expect(
        fromLeft.find((r) => r.relationshipType === 'EXACT_EQUIVALENT')?.direction,
      ).toBe('SYMMETRIC');
      expect(
        fromRight.find((r) => r.relationshipType === 'EXACT_EQUIVALENT')?.direction,
      ).toBe('SYMMETRIC');
      expect(
        fromRight.find((r) => r.relationshipType === 'EXACT_EQUIVALENT')?.counterpart.id,
      ).toBe(left);
    });

    it('lets an unverified alternate be promoted by a named reviewer', async () => {
      const subject = await variantIdFor(testDb.db, 'S30-0400-11300');
      const alternate = await variantIdFor(testDb.db, 'S30-0600-11300');

      const { relationshipId } = await withUnitOfWork(
        testDb.db,
        testContext(),
        deps,
        async (uow) =>
          assertRelationship(uow, {
            from: { level: 'VARIANT', id: subject },
            to: { level: 'VARIANT', id: alternate },
            relationshipType: 'FUNCTIONAL_ALTERNATE',
            confidence: 0.6,
          }),
      );

      await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
        await verifyRelationship(uow, relationshipId, {
          by: VERIFIER,
          evidence:
            'Reviewed against the customer application; flow is adequate one size up.',
          confidence: 0.85,
        });
      });

      const relationships = await relationshipsFor(testDb.db, {
        level: 'VARIANT',
        id: subject,
      });
      const alternateView = relationships.find(
        (r) => r.relationshipType === 'FUNCTIONAL_ALTERNATE',
      )!;
      expect(alternateView.verificationStatus).toBe('VERIFIED');
      expect(Number(alternateView.confidence)).toBe(0.85);
      // Verified, but the TYPE still does not assert interchangeability, so this is
      // not a safe automatic substitution.
      expect(alternateView.safeToSubstitute).toBe(false);
    });
  });

  describe('supersession chains (acceptance criterion 20)', () => {
    it('resolves A to C through B, and shows the chain', async () => {
      await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
        await assertRelationship(uow, {
          from: { level: 'VARIANT', id: A },
          to: { level: 'VARIANT', id: B },
          relationshipType: 'SUPERSEDED_BY',
          confidence: 0.9,
          evidence: 'Manufacturer product bulletin PB-2027-04.',
        });
        await assertRelationship(uow, {
          from: { level: 'VARIANT', id: B },
          to: { level: 'VARIANT', id: C },
          relationshipType: 'SUPERSEDED_BY',
          confidence: 0.7,
          evidence: 'Distributor notice; not yet confirmed with the manufacturer.',
        });
      });

      const resolution = await resolveSupersession(testDb.db, {
        level: 'VARIANT',
        id: A,
      });

      expect(resolution.activeSuccessor?.toKey).toBe(C);
      expect(resolution.chain).toHaveLength(2);
      expect(resolution.chain.map((link) => link.toKey)).toEqual([B, C]);

      // A chain is only as good as its worst link, and the answer says so.
      expect(Number(resolution.chainConfidence)).toBe(0.7);
      expect(resolution.allLinksVerified).toBe(false);
      expect(resolution.chain[1]!.evidence).toMatch(/not yet confirmed/);
    });

    it('marks the obsolete product and still resolves it', async () => {
      await sql`
        UPDATE pim.variant SET lifecycle_status = 'SUPERSEDED', version = version + 1
         WHERE id = ${A}::uuid
      `.execute(testDb.db);

      const resolution = await resolveSupersession(testDb.db, {
        level: 'VARIANT',
        id: A,
      });
      expect(resolution.activeSuccessor?.toKey).toBe(C);

      const { rows } = await sql<{ lifecycle_status: string }>`
        SELECT lifecycle_status FROM pim.variant WHERE id = ${A}::uuid
      `.execute(testDb.db);
      expect(rows[0]!.lifecycle_status).toBe('SUPERSEDED');
    });

    it('returns no successor for a product nothing has replaced', async () => {
      const resolution = await resolveSupersession(testDb.db, {
        level: 'VARIANT',
        id: C,
      });
      expect(resolution.activeSuccessor).toBeUndefined();
      expect(resolution.chain).toEqual([]);
    });

    it('refuses a cycle', async () => {
      // A -> B -> C already exists. C -> A would make "what replaces A" unanswerable.
      await expect(
        withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
          await assertRelationship(uow, {
            from: { level: 'VARIANT', id: C },
            to: { level: 'VARIANT', id: A },
            relationshipType: 'SUPERSEDED_BY',
            confidence: 0.5,
          });
        }),
      ).rejects.toThrow(/cycle/i);

      // And the existing chain is untouched.
      const resolution = await resolveSupersession(testDb.db, {
        level: 'VARIANT',
        id: A,
      });
      expect(resolution.activeSuccessor?.toKey).toBe(C);
    });

    it('refuses a self-relationship', async () => {
      await expect(
        withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
          await assertRelationship(uow, {
            from: { level: 'VARIANT', id: A },
            to: { level: 'VARIANT', id: A },
            relationshipType: 'FUNCTIONAL_ALTERNATE',
          });
        }),
      ).rejects.toThrow();
    });

    it('refuses a duplicate relationship covering the same period', async () => {
      await expect(
        withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
          await assertRelationship(uow, {
            from: { level: 'VARIANT', id: A },
            to: { level: 'VARIANT', id: B },
            relationshipType: 'SUPERSEDED_BY',
            confidence: 0.5,
          });
        }),
      ).rejects.toThrow(/already/i);
    });

    it('works at product level as well as variant level', async () => {
      const products = await sql<{ id: string; key: string }>`
        SELECT id, key FROM pim.product WHERE key IN ('apollo_77c', 'apollo_76f') ORDER BY key
      `.execute(testDb.db);
      const [newer, older] = products.rows;

      await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
        await assertRelationship(uow, {
          from: { level: 'PRODUCT', id: older!.id },
          to: { level: 'PRODUCT', id: newer!.id },
          relationshipType: 'SUPERSEDED_BY',
          confidence: 0.8,
          evidence: 'Series-level replacement announced in the 2027 catalogue.',
        });
      });

      const resolution = await resolveSupersession(testDb.db, {
        level: 'PRODUCT',
        id: older!.id,
      });
      expect(resolution.activeSuccessor?.toKey).toBe(newer!.id);
      expect(resolution.activeSuccessor?.toLevel).toBe('PRODUCT');
    });
  });

  describe('certifications (spec §38)', () => {
    it('records a certificate with its scope, revision and issuing body', async () => {
      const variantId = await variantIdFor(testDb.db, 'LFFBV-3C-0100');

      await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
        await recordCertification(uow, {
          subject: { level: 'VARIANT', id: variantId },
          certificationCode: 'NSF_ANSI_61',
          issuingBodyCode: 'NSF',
          standardRevision: '2023',
          certificateId: 'NSF-61-8842190',
          scope: 'Sizes 1/2" through 2", lead-free brass body only. Cold water service.',
          issuedOn: '2026-03-01',
          expiresOn: '2029-03-01',
          verify: { by: VERIFIER },
        });
      });

      const certifications = await certificationsFor(testDb.db, variantId);
      const nsf = certifications.find((c) => c.certificationCode === 'NSF_ANSI_61')!;

      expect(nsf.standardRevision).toBe('2023');
      expect(nsf.issuingBody).toBe('NSF International');
      // The scope is the point: "the product is NSF 61 certified" is usually shorthand
      // for "these configurations are".
      expect(nsf.scope).toMatch(/Sizes 1\/2" through 2"/);
      expect(nsf.isCurrentlyValid).toBe(true);
      expect(nsf.attachedAt).toBe('VARIANT');
    });

    it('does not let a variant certificate certify its siblings', async () => {
      const sibling = await variantIdFor(testDb.db, 'LFFBV-3C-0050');
      const certifications = await certificationsFor(testDb.db, sibling);
      expect(
        certifications.some((c) => c.certificateId === 'NSF-61-8842190'),
        'a certificate recorded against one variant must not appear on another',
      ).toBe(false);
    });

    it('distinguishes a product-level certificate from a variant-level one', async () => {
      const productId = (
        await sql<{
          id: string;
        }>`SELECT id FROM pim.product WHERE key = 'watts_lf_ball'`.execute(testDb.db)
      ).rows[0]!.id;

      await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
        await recordCertification(uow, {
          subject: { level: 'PRODUCT', id: productId },
          certificationCode: 'LEAD_FREE',
          issuingBodyCode: 'MANUFACTURER',
          scope: 'Entire LFFBV-3C series.',
        });
      });

      const certifications = await certificationsFor(
        testDb.db,
        await variantIdFor(testDb.db, 'LFFBV-3C-0050'),
      );
      const leadFree = certifications.find((c) => c.certificationCode === 'LEAD_FREE')!;
      // Visible on the variant, but clearly attached at the product level, so a reader
      // knows the claim is about the series rather than this configuration.
      expect(leadFree.attachedAt).toBe('PRODUCT');
      expect(leadFree.issuingBody).toMatch(/self-declaration/);
    });

    it('marks an expired certificate as no longer valid', async () => {
      const variantId = await variantIdFor(testDb.db, '76F-105-01');
      await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
        await recordCertification(uow, {
          subject: { level: 'VARIANT', id: variantId },
          certificationCode: 'API_607',
          issuingBodyCode: 'API',
          certificateId: 'OLD-CERT-1',
          issuedOn: '2018-01-01',
          expiresOn: '2021-01-01',
        });
      });
      const certifications = await certificationsFor(testDb.db, variantId);
      const expired = certifications.find((c) => c.certificateId === 'OLD-CERT-1')!;
      expect(expired.isCurrentlyValid).toBe(false);
    });
  });

  describe('events', () => {
    it('publishes the interchangeability claim, not just the link', async () => {
      const events = await readEvents(testDb.db, {
        after: '0',
        types: ['fsw.pim.ProductRelationshipAsserted'],
        limit: 100,
      });
      expect(events.length).toBeGreaterThan(0);

      const equivalent = events.find(
        (e) =>
          (e.payload as { relationshipType: string }).relationshipType ===
          'EXACT_EQUIVALENT',
      )!;
      const comparable = events.find(
        (e) =>
          (e.payload as { relationshipType: string }).relationshipType ===
          'CLOSEST_COMPARABLE',
      )!;

      // A downstream consumer can tell the two apart without knowing FSW's type
      // vocabulary, which is what makes the event useful rather than merely present.
      expect(
        (equivalent.payload as { impliesInterchangeable: boolean })
          .impliesInterchangeable,
      ).toBe(true);
      expect(
        (comparable.payload as { impliesInterchangeable: boolean })
          .impliesInterchangeable,
      ).toBe(false);
    });
  });
});
