import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { createTestDatabase, type TestDatabase } from '../support/database.js';
import { testContext, testDeps } from '../support/context.js';
import {
  createFakeIssuer,
  localKeyResolver,
  type FakeIssuer,
} from '../support/tokens.js';
import { detailOf, expectRefusal } from '../support/errors.js';
import { syncEventRegistry } from '../../src/modules/events/index.js';
import { ALL_EVENTS } from '../../src/event-catalog.js';
import { withUnitOfWork, type UnitOfWork } from '../../src/kernel/unit-of-work.js';
import {
  assertIssuerUsable,
  describePrincipal,
  linkIdentity,
  loadIssuers,
  resolveIdentity,
  verifyToken,
  type IssuerConfig,
} from '../../src/modules/iam/index.js';

/**
 * Acceptance criterion 1 (spec §83): one identity is recognised by two API audiences
 * and resolves to a single canonical person, without minting a second person ID.
 *
 * The scenario is the one FSW will actually hit: a person who exists in the Welsford
 * tenant and in the ValveMan tenant, authenticating against each in turn.
 */
describe('identity and authentication (AC1)', () => {
  let testDb: TestDatabase;
  let deps: ReturnType<typeof testDeps>;
  let welsford: FakeIssuer;
  let valveman: FakeIssuer;
  let issuers: IssuerConfig[];

  beforeAll(async () => {
    testDb = await createTestDatabase('identity');
    await syncEventRegistry(testDb.db, ALL_EVENTS);
    welsford = await createFakeIssuer({
      issuerUrl: 'https://login.example.test/welsford',
      name: 'Welsford tenant',
      audience: 'api://fsw-layer0',
      jitEnabled: true,
      jitEmailDomains: ['fswelsford.com'],
      defaultOperatingCompany: 'WELSFORD',
    });
    valveman = await createFakeIssuer({
      issuerUrl: 'https://login.example.test/valveman',
      name: 'ValveMan tenant',
      audience: 'api://valveman-storefront',
      jitEnabled: false,
    });
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await sql`
      TRUNCATE iam.access_denial, iam.principal_role_assignment, iam.api_credential,
               iam.service_account, iam.pending_link_request, iam.identity,
               iam.principal, iam.issuer, party.person RESTART IDENTITY CASCADE
    `.execute(testDb.db);
    await sql`
      TRUNCATE events.event_delivery, events.domain_event RESTART IDENTITY CASCADE
    `.execute(testDb.db);
    deps = testDeps();

    for (const issuer of [welsford, valveman]) {
      await sql`
        INSERT INTO iam.issuer
          (issuer_url, name, jwks_uri, audiences, jit_enabled, jit_email_domains,
           default_operating_company)
        VALUES (${issuer.config.issuerUrl}, ${issuer.config.name}, ${issuer.config.jwksUri},
                ${[...issuer.config.audiences]}::text[], ${issuer.config.jitEnabled},
                ${[...issuer.config.jitEmailDomains]}::text[],
                ${issuer.config.defaultOperatingCompany ?? null})
      `.execute(testDb.db);
    }
    issuers = [...(await loadIssuers(testDb.db))];
  });

  const resolver = () => localKeyResolver([welsford, valveman]);

  async function inUnitOfWork<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    return withUnitOfWork(testDb.db, testContext(), deps, work);
  }

  it('recognises one human through two issuers as one person', async () => {
    // First login, against the Welsford directory. JIT provisions a person.
    const welsfordToken = await verifyToken(
      await welsford.sign({
        sub: 'welsford-subject-001',
        email: 'j.welsford@fswelsford.com',
        email_verified: true,
        name: 'J Welsford',
      }),
      issuers,
      resolver(),
    );
    const first = await inUnitOfWork(async (uow) => resolveIdentity(uow, welsfordToken));
    expect(first.kind).toBe('PROVISIONED');
    const personId = first.kind === 'PENDING' ? '' : first.personId;

    // The same human, later, through the ValveMan directory. An administrator links
    // the second identity to the person who already exists.
    const valvemanToken = await verifyToken(
      await valveman.sign({
        sub: 'valveman-subject-777',
        email: 'jwelsford@valveman.com',
        email_verified: true,
        name: 'John Welsford',
      }),
      issuers,
      resolver(),
    );
    await inUnitOfWork(async (uow) => linkIdentity(uow, personId, valvemanToken));

    // Authenticating through either now lands on the SAME person and the SAME
    // principal. This is the whole of acceptance criterion 1.
    const viaWelsford = await inUnitOfWork(async (uow) =>
      resolveIdentity(uow, welsfordToken),
    );
    const viaValveman = await inUnitOfWork(async (uow) =>
      resolveIdentity(uow, valvemanToken),
    );
    expect(viaWelsford.kind).toBe('RESOLVED');
    expect(viaValveman.kind).toBe('RESOLVED');
    expect(viaValveman).toEqual(viaWelsford);

    const people = await sql<{ count: string }>`
      SELECT count(*) AS count FROM party.person
    `.execute(testDb.db);
    expect(Number(people.rows[0]!.count)).toBe(1);

    // Two identities, two different email addresses, one person. The addresses are
    // stored as hints of what the token said and are not what joined them.
    const identities = await sql<{ subject: string; email_at_link: string }>`
      SELECT subject, email_at_link FROM iam.identity ORDER BY subject
    `.execute(testDb.db);
    expect(identities.rows.map((r) => r.subject)).toEqual([
      'valveman-subject-777',
      'welsford-subject-001',
    ]);
    expect(identities.rows[0]!.email_at_link).not.toBe(identities.rows[1]!.email_at_link);
  });

  it('does not use email to find a person, even when it changes', async () => {
    const original = await verifyToken(
      await welsford.sign({
        sub: 'stable-subject',
        email: 'a.person@fswelsford.com',
        email_verified: true,
      }),
      issuers,
      resolver(),
    );
    const provisioned = await inUnitOfWork(async (uow) => resolveIdentity(uow, original));

    // They get married, or the company renames its domain. Same subject, new address.
    const renamed = await verifyToken(
      await welsford.sign({
        sub: 'stable-subject',
        email: 'a.newname@fswelsford.com',
        email_verified: true,
      }),
      issuers,
      resolver(),
    );
    const after = await inUnitOfWork(async (uow) => resolveIdentity(uow, renamed));
    expect(after).toEqual({ ...provisioned, kind: 'RESOLVED' });
  });

  it('does not merge two people who happen to share an address', async () => {
    // An address reused by a successor is the classic way email-as-identity creates
    // one person out of two.
    const leaver = await verifyToken(
      await welsford.sign({
        sub: 'subject-leaver',
        email: 'sales@fswelsford.com',
        email_verified: true,
      }),
      issuers,
      resolver(),
    );
    const joiner = await verifyToken(
      await welsford.sign({
        sub: 'subject-joiner',
        email: 'sales@fswelsford.com',
        email_verified: true,
      }),
      issuers,
      resolver(),
    );
    const a = await inUnitOfWork(async (uow) => resolveIdentity(uow, leaver));
    const b = await inUnitOfWork(async (uow) => resolveIdentity(uow, joiner));
    expect(a).not.toEqual(b);

    const people = await sql<{
      count: string;
    }>`SELECT count(*) AS count FROM party.person`.execute(testDb.db);
    expect(Number(people.rows[0]!.count)).toBe(2);
  });

  describe('token validation', () => {
    it('refuses a token from an unregistered issuer', async () => {
      const stranger = await createFakeIssuer({
        issuerUrl: 'https://attacker.example.test',
        name: 'Not registered',
        audience: 'api://fsw-layer0',
      });
      await expectRefusal(
        verifyToken(
          await stranger.sign({ sub: 'x' }),
          issuers,
          localKeyResolver([stranger]),
        ),
        /not a registered issuer/,
      );
    });

    it('refuses a token signed by the wrong key', async () => {
      // The same issuer URL and audience, a different signing key. Nothing is trusted
      // because it parses.
      const impostor = await createFakeIssuer({
        issuerUrl: welsford.config.issuerUrl,
        name: 'Impostor',
        audience: 'api://fsw-layer0',
      });
      await expectRefusal(
        verifyToken(await impostor.sign({ sub: 'x' }), issuers, resolver()),
        /could not be verified/,
      );
    });

    it('refuses a token minted for another audience', async () => {
      const token = await welsford.sign(
        { sub: 'x' },
        { audience: 'api://somebody-else' },
      );
      await expectRefusal(
        verifyToken(token, issuers, resolver()),
        /could not be verified/,
      );
    });

    it('refuses an expired token and one that is not yet valid', async () => {
      await expectRefusal(
        verifyToken(
          await welsford.sign({ sub: 'x' }, { expiresIn: '-5m' }),
          issuers,
          resolver(),
        ),
        /could not be verified/,
      );
      await expectRefusal(
        verifyToken(
          await welsford.sign({ sub: 'x' }, { notBefore: '1h' }),
          issuers,
          resolver(),
        ),
        /could not be verified/,
      );
    });

    it('refuses a tampered token', async () => {
      const token = await welsford.sign({ sub: 'x', email: 'a@fswelsford.com' });
      const [header, payload, signature] = token.split('.');
      const claims = JSON.parse(
        Buffer.from(payload!, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      claims['sub'] = 'somebody-else';
      const forged = `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;
      await expectRefusal(
        verifyToken(forged, issuers, resolver()),
        /could not be verified/,
      );
    });

    it('refuses a token with no subject', async () => {
      await expectRefusal(
        verifyToken(
          await welsford.sign({ email: 'a@fswelsford.com' }),
          issuers,
          resolver(),
        ),
        /identifies nobody/,
      );
    });

    it('refuses a token from a tenant the issuer is not trusted for', async () => {
      await sql`
        UPDATE iam.issuer SET allowed_tenant_ids = ARRAY['tenant-a']
         WHERE issuer_url = ${welsford.config.issuerUrl}
      `.execute(testDb.db);
      const scoped = [...(await loadIssuers(testDb.db))];

      await expectRefusal(
        verifyToken(
          await welsford.sign({ sub: 'x', tid: 'tenant-b' }),
          scoped,
          resolver(),
        ),
        /not trusted for/,
      );
      // And accepts the one it is trusted for.
      await expect(
        verifyToken(
          await welsford.sign({ sub: 'x', tid: 'tenant-a' }),
          scoped,
          resolver(),
        ),
      ).resolves.toMatchObject({ subject: 'x' });
    });

    it('gives the same message however the token is bad', async () => {
      // "Signature invalid" versus "expired" is a useful oracle to someone probing and
      // useless to a legitimate client, who should just reauthenticate.
      const expired = await welsford
        .sign({ sub: 'x' }, { expiresIn: '-5m' })
        .then((t) => verifyToken(t, issuers, resolver()).catch(detailOf));
      const wrongAudience = await welsford
        .sign({ sub: 'x' }, { audience: 'api://other' })
        .then((t) => verifyToken(t, issuers, resolver()).catch(detailOf));
      expect(expired).toBe(wrongAudience);
    });
  });

  describe('just-in-time provisioning', () => {
    it('refuses to provision from an issuer that does not allow it', async () => {
      const token = await verifyToken(
        await valveman.sign({
          sub: 'new-person',
          email: 'x@valveman.com',
          email_verified: true,
        }),
        issuers,
        resolver(),
      );
      const outcome = await inUnitOfWork(async (uow) => resolveIdentity(uow, token));
      expect(outcome.kind).toBe('PENDING');
      expect(outcome.kind === 'PENDING' && outcome.reason).toContain(
        'does not allow automatic provisioning',
      );
    });

    it('refuses a domain that is not on the allow-list', async () => {
      const token = await verifyToken(
        await welsford.sign({
          sub: 'contractor',
          email: 'someone@gmail.com',
          email_verified: true,
        }),
        issuers,
        resolver(),
      );
      const outcome = await inUnitOfWork(async (uow) => resolveIdentity(uow, token));
      expect(outcome.kind).toBe('PENDING');
      expect(outcome.kind === 'PENDING' && outcome.reason).toContain(
        'not on this issuer',
      );
    });

    it('refuses an unverified address, which the user chose rather than the directory', async () => {
      const token = await verifyToken(
        await welsford.sign({
          sub: 'self-asserted',
          email: 'anyone@fswelsford.com',
          email_verified: false,
        }),
        issuers,
        resolver(),
      );
      const outcome = await inUnitOfWork(async (uow) => resolveIdentity(uow, token));
      expect(outcome.kind).toBe('PENDING');
      expect(outcome.kind === 'PENDING' && outcome.reason).toContain(
        'not marked verified',
      );
    });

    it('raises one pending request however many times they try', async () => {
      const token = await verifyToken(
        await welsford.sign({
          sub: 'persistent',
          email: 'x@gmail.com',
          email_verified: true,
        }),
        issuers,
        resolver(),
      );
      await inUnitOfWork(async (uow) => resolveIdentity(uow, token));
      await inUnitOfWork(async (uow) => resolveIdentity(uow, token));
      await inUnitOfWork(async (uow) => resolveIdentity(uow, token));

      const requests = await sql<{ attempt_count: number; status: string }>`
        SELECT attempt_count, status FROM iam.pending_link_request
      `.execute(testDb.db);
      expect(requests.rows).toHaveLength(1);
      expect(requests.rows[0]!.attempt_count).toBe(3);
      expect(requests.rows[0]!.status).toBe('PENDING');

      // And one event, not three: a person retrying is not three things happening.
      const events = await sql<{ count: string }>`
        SELECT count(*) AS count FROM events.domain_event
         WHERE event_type = 'fsw.iam.PendingLinkRequested'
      `.execute(testDb.db);
      expect(Number(events.rows[0]!.count)).toBe(1);
    });

    it('grants a provisioned person no roles at all', async () => {
      const token = await verifyToken(
        await welsford.sign({
          sub: 'new-joiner',
          email: 'new@fswelsford.com',
          email_verified: true,
        }),
        issuers,
        resolver(),
      );
      const outcome = await inUnitOfWork(async (uow) => resolveIdentity(uow, token));
      expect(outcome.kind).toBe('PROVISIONED');

      // Authentication is not authorization. A person who can log in and see nothing
      // is a far better outcome than one who can log in and see everything.
      const summary = await describePrincipal(
        testDb.db,
        outcome.kind === 'PENDING' ? '' : outcome.principalId,
      );
      expect(summary.roles).toEqual([]);
      expect(summary.permissions).toEqual([]);
    });

    it('refuses to disable an identity and then honour it', async () => {
      const token = await verifyToken(
        await welsford.sign({
          sub: 'leaver',
          email: 'leaver@fswelsford.com',
          email_verified: true,
        }),
        issuers,
        resolver(),
      );
      await inUnitOfWork(async (uow) => resolveIdentity(uow, token));
      await sql`UPDATE iam.identity SET disabled_at = now(), disabled_reason = 'Left'`.execute(
        testDb.db,
      );

      await expectRefusal(
        inUnitOfWork(async (uow) => resolveIdentity(uow, token)),
        /disabled/,
      );
    });
  });

  describe('issuer configuration', () => {
    it('refuses an issuer that could provision anyone it will sign for', async () => {
      expect(() =>
        assertIssuerUsable({
          ...welsford.config,
          id: 'x',
          jitEnabled: true,
          jitEmailDomains: [],
        }),
      ).toThrow(/no email-domain allow-list/);
    });

    it('refuses an issuer with no audiences, which could accept nothing anyway', () => {
      expect(() =>
        assertIssuerUsable({ ...welsford.config, id: 'x', audiences: [] }),
      ).toThrow(/no audiences/);
    });

    it('refuses JIT with no operating company to put the person in', () => {
      expect(() =>
        assertIssuerUsable({
          ...welsford.config,
          id: 'x',
          jitEnabled: true,
          jitEmailDomains: ['fswelsford.com'],
          defaultOperatingCompany: undefined,
        }),
      ).toThrow(/no default operating company/);
    });

    it('accepts the configuration the tests actually use', () => {
      expect(() => assertIssuerUsable({ ...welsford.config, id: 'x' })).not.toThrow();
    });
  });
});
