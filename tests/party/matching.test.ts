import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { createTestDatabase, type TestDatabase } from '../support/database.js';
import {
  blockingKeys,
  deterministicMatch,
  normalizeDomain,
  normalizeName,
  normalizePhone,
  scorePair,
  trigramSimilarity,
  type MatchSubject,
  type MatchWeights,
} from '../../src/modules/party/index.js';

/**
 * Matching semantics (ADR-0025), tested without fixtures where possible.
 *
 * The scorer is pure so it can be, because matching behaviour is combinatorial and a
 * matcher tested on three examples is a matcher nobody should trust with a merge.
 */

const WEIGHTS: MatchWeights = {
  name_similarity: 0.3,
  name_token_overlap: 0.1,
  alias_exact: 0.15,
  address_similarity: 0.15,
  postal_exact: 0.1,
  city_region_exact: 0.05,
  domain_exact: 0.1,
  phone_exact: 0.05,
  shared_parent: 0.05,
};

function subject(overrides: Partial<MatchSubject> = {}): MatchSubject {
  return {
    id: '019b0000-0000-7000-8000-000000000001',
    name: 'Acme Pharma LLC',
    aliases: [],
    addressLine1: '100 Industrial Way',
    city: 'West Chester',
    regionCode: 'PA',
    postalCode: '19380',
    website: 'https://www.acmepharma.com',
    phone: '(610) 555-0100',
    parentIds: [],
    duns: null,
    taxIdentifier: null,
    ...overrides,
  };
}

describe('name normalization', () => {
  it('folds case, accents and punctuation', () => {
    expect(normalizeName('Sté. Générale-Fluide, Inc.').normalized).toBe(
      'ste generale fluide',
    );
  });

  it('removes legal suffixes so a changed legal form is not a different company', () => {
    expect(normalizeName('Acme Pharma LLC').normalized).toBe('acme pharma');
    expect(normalizeName('Acme Pharma, Incorporated').normalized).toBe('acme pharma');
    expect(normalizeName('ACME PHARMA CORP').normalized).toBe('acme pharma');
  });

  it("reads '&' as a word so both spellings agree", () => {
    // Dropping it would make 'B & G' normalize to 'bg', which collides with far too
    // much. Expanding it means both spellings land in the same place.
    expect(normalizeName('B & G Controls').normalized).toBe('b g controls');
    expect(normalizeName('B and G Controls').normalized).toBe('b g controls');
  });

  it('keeps its tokens when a name is entirely suffixes', () => {
    // An empty normalized name would block against every other empty one, which is
    // the worst possible outcome for a matching key.
    expect(normalizeName('The Company').normalized).not.toBe('');
  });

  it('separates industry words from distinctive ones without discarding them', () => {
    const parsed = normalizeName('Keystone Industrial Supply Co');
    expect(parsed.tokens).toEqual(['keystone', 'industrial', 'supply']);
    expect(parsed.distinctiveTokens).toEqual(['keystone']);
  });

  it('does not reduce two different companies to the same distinctive token set', () => {
    // The reason the stop list is short: over-eager removal makes these identical.
    const valve = normalizeName('Keystone Valve');
    const pump = normalizeName('Keystone Pump');
    expect(valve.distinctiveTokens).not.toEqual(pump.distinctiveTokens);
  });
});

describe('domain and phone normalization', () => {
  it('reduces a URL or an email to a bare host', () => {
    expect(normalizeDomain('https://www.acmepharma.com/about?x=1')).toBe(
      'acmepharma.com',
    );
    expect(normalizeDomain('sales@acmepharma.com')).toBe('acmepharma.com');
    expect(normalizeDomain('ACMEPHARMA.COM')).toBe('acmepharma.com');
  });

  it('does not guess a registrable domain from a subdomain', () => {
    // Reducing this to 'example.com' would be a guess about how the company organises
    // its estate, and needs public-suffix data this does not warrant.
    expect(normalizeDomain('shop.example.com')).toBe('shop.example.com');
  });

  it('refuses anything that is not a hostname', () => {
    for (const value of ['not a domain', 'localhost', '', '   ', null, undefined]) {
      expect(normalizeDomain(value)).toBeUndefined();
    }
  });

  it('normalizes North American numbers to E.164 and refuses ambiguous ones', () => {
    expect(normalizePhone('(610) 555-0100')).toBe('+16105550100');
    expect(normalizePhone('1-610-555-0100')).toBe('+16105550100');
    expect(normalizePhone('610.555.0100 x204')).toBe('+16105550100');
    // Seven digits has no area code. Inventing one from an address would make two
    // unrelated companies in different states look like a phone match.
    expect(normalizePhone('555-0100')).toBeUndefined();
    expect(normalizePhone('+44 20 7946 0000')).toBeUndefined();
  });
});

describe('trigram similarity', () => {
  it('agrees with PostgreSQL, which is where the blocking half runs', async () => {
    // The scorer reimplements pg_trgm so it can be pure. If the two drift apart, a
    // pair could block in SQL and score differently in TypeScript, which would be
    // invisible and maddening.
    const testDb: TestDatabase = await createTestDatabase('trgm');
    try {
      const pairs = [
        ['acme pharma', 'acme pharmaceutical'],
        ['keystone process systems', 'keystone process'],
        ['delaware valley pumps', 'delaware valley pump'],
        ['b and g controls', 'bg controls'],
        ['abc', 'xyz'],
        ['acme pharma', 'acme pharma'],
        ['lehigh valley controls', 'lehigh controls valley'],
      ];
      for (const [left, right] of pairs) {
        const result = await sql<{ similarity: number }>`
          SELECT similarity(${left}, ${right})::float8 AS similarity
        `.execute(testDb.db);
        expect(trigramSimilarity(left!, right!)).toBeCloseTo(
          result.rows[0]!.similarity,
          5,
        );
      }
    } finally {
      await testDb.close();
    }
  }, 60_000);
});

describe('deterministic rules', () => {
  it('links on a shared tax identifier whatever else disagrees', () => {
    // A weighted score would be dragged under the threshold by the disagreeing
    // address, name and phone. Two records with the same EIN are one company.
    const left = subject({ taxIdentifier: '23-1234567' });
    const right = subject({
      id: '019b0000-0000-7000-8000-000000000002',
      name: 'Completely Different Holdings',
      addressLine1: '9 Other Street',
      city: 'Trenton',
      regionCode: 'NJ',
      postalCode: '08608',
      website: 'https://different.example',
      phone: '(609) 555-0199',
      taxIdentifier: '231234567',
    });
    expect(deterministicMatch(left, right)?.rule).toBe('TRUSTED_TAX_IDENTIFIER');
  });

  it('links on a shared domain when the names are also close', () => {
    const left = subject();
    const right = subject({
      id: '019b0000-0000-7000-8000-000000000002',
      name: 'Acme Pharma Inc',
      addressLine1: '55 Elsewhere Road',
      postalCode: '19382',
    });
    expect(deterministicMatch(left, right)?.rule).toBe('DOMAIN_AND_NAME');
  });

  it('does not link on a shared domain when the names are unrelated', () => {
    // Two subsidiaries can share a corporate website and be different companies.
    const left = subject({ name: 'Acme Pharma' });
    const right = subject({
      id: '019b0000-0000-7000-8000-000000000002',
      name: 'Zenith Coatings',
    });
    expect(deterministicMatch(left, right)).toBeUndefined();
  });

  it('links on an identical address when the names are also close', () => {
    const left = subject({ website: null });
    const right = subject({
      id: '019b0000-0000-7000-8000-000000000002',
      name: 'Acme Pharma Inc.',
      website: null,
    });
    expect(deterministicMatch(left, right)?.rule).toBe('ADDRESS_AND_NAME');
  });

  it('does not link two different companies sharing an office building', () => {
    const left = subject({ name: 'Acme Pharma', website: null });
    const right = subject({
      id: '019b0000-0000-7000-8000-000000000002',
      name: 'Brandywine Legal Services',
      website: null,
    });
    expect(deterministicMatch(left, right)).toBeUndefined();
  });
});

describe('weighted scoring', () => {
  it('scores an obvious duplicate high and explains every signal', () => {
    const left = subject();
    const right = subject({
      id: '019b0000-0000-7000-8000-000000000002',
      name: 'ACME Pharmaceutical Inc',
    });
    const result = scorePair(left, right, WEIGHTS);

    expect(result.score).toBeGreaterThan(0.65);

    // Every signal that COULD be compared is present, including those that scored
    // zero: "the postal codes were compared and differ" is evidence a reviewer needs.
    const signals = result.features.map((f) => f.signal);
    expect(signals).toContain('name_similarity');
    expect(signals).toContain('postal_exact');
    expect(signals).toContain('domain_exact');

    // And each carries what it actually compared, not just a number.
    const name = result.features.find((f) => f.signal === 'name_similarity')!;
    expect(name.detail).toContain('acme pharma');
    expect(name.contribution).toBeCloseTo(name.value * name.weight, 4);

    // The vector adds up to the score a reviewer is shown. If it did not, the
    // explanation would be decoration rather than the reason.
    const contributed = result.features.reduce((sum, f) => sum + f.contribution, 0);
    const available = result.features.reduce((sum, f) => sum + f.weight, 0);
    expect(contributed / available).toBeCloseTo(result.score, 3);
  });

  it('scores two unrelated companies low', () => {
    const left = subject();
    const right = subject({
      id: '019b0000-0000-7000-8000-000000000002',
      name: 'Montgomery Steam Products',
      addressLine1: '9 Canal Street',
      city: 'Norristown',
      postalCode: '19401',
      website: 'https://montgomerysteam.example',
      phone: '(610) 555-0199',
    });
    expect(scorePair(left, right, WEIGHTS).score).toBeLessThan(0.4);
  });

  it('omits a signal neither side can supply, rather than scoring it zero', () => {
    // Otherwise two records with only a name could never clear a threshold however
    // identical their names, simply because nobody recorded a phone number.
    const bare = {
      website: null,
      phone: null,
      postalCode: null,
      addressLine1: null,
      city: null,
    };
    const left = subject(bare);
    const right = subject({ ...bare, id: '019b0000-0000-7000-8000-000000000002' });

    const result = scorePair(left, right, WEIGHTS);
    expect(result.features.map((f) => f.signal)).not.toContain('phone_exact');
    expect(result.features.map((f) => f.signal)).not.toContain('postal_exact');
    // Identical names alone still produce a high score.
    expect(result.score).toBeGreaterThan(0.9);
  });

  it('rewards containment, so a division name still matches its parent record', () => {
    const left = subject({ name: 'Acme Pharma' });
    const right = subject({
      id: '019b0000-0000-7000-8000-000000000002',
      name: 'Acme Pharma West Chester Division',
    });
    const overlap = scorePair(left, right, WEIGHTS).features.find(
      (f) => f.signal === 'name_token_overlap',
    )!;
    expect(overlap.value).toBe(1);
  });

  it('fires the alias signal when one record knows the other by name', () => {
    const left = subject({ name: 'Acme Pharma', aliases: ['APC Chemicals'] });
    const right = subject({
      id: '019b0000-0000-7000-8000-000000000002',
      name: 'APC Chemicals',
    });
    const result = scorePair(left, right, WEIGHTS);
    expect(result.features.find((f) => f.signal === 'alias_exact')?.value).toBe(1);
  });

  it('disables a signal when the configuration gives it no weight', () => {
    const left = subject();
    const right = subject({ id: '019b0000-0000-7000-8000-000000000002' });
    const result = scorePair(left, right, { ...WEIGHTS, phone_exact: 0 });
    expect(result.features.map((f) => f.signal)).not.toContain('phone_exact');
  });

  it('fingerprints the evidence, not the score', () => {
    // A rejected pair must not resurface because someone tuned a weight — that is not
    // new information about the two companies.
    const left = subject();
    const right = subject({
      id: '019b0000-0000-7000-8000-000000000002',
      name: 'ACME Pharmaceutical Inc',
    });
    const a = scorePair(left, right, WEIGHTS);
    const b = scorePair(left, right, { ...WEIGHTS, name_similarity: 0.5 });
    expect(b.score).not.toBe(a.score);
    expect(b.evidenceFingerprint).toBe(a.evidenceFingerprint);

    // But it MUST resurface when a source says something new.
    const changed = scorePair(left, { ...right, postalCode: '08608' }, WEIGHTS);
    expect(changed.evidenceFingerprint).not.toBe(a.evidenceFingerprint);
  });
});

describe('blocking', () => {
  it('generates a key for each cheap equality a duplicate is likely to share', () => {
    const keys = blockingKeys(subject());
    expect(keys).toContain('postal:19380');
    expect(keys).toContain('domain:acmepharma.com');
    expect(keys).toContain('phone:+16105550100');
    expect(keys.some((key) => key.startsWith('name:'))).toBe(true);
  });

  it('gives a short-named company a full-name key so it still blocks', () => {
    // 'BP' has no six-character prefix, and blocking on 'b' would be useless.
    const keys = blockingKeys(
      subject({ name: 'BP', website: null, phone: null, postalCode: null }),
    );
    expect(keys).toContain('fullname:bp');
  });

  it('produces the same name key for names that differ only by legal form', () => {
    const a = blockingKeys(subject({ name: 'Acme Pharma LLC' }));
    const b = blockingKeys(subject({ name: 'Acme Pharma, Inc.' }));
    expect(a.filter((k) => k.startsWith('name:'))).toEqual(
      b.filter((k) => k.startsWith('name:')),
    );
  });
});
