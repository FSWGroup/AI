import { describe, it, expect } from 'vitest';
import {
  selectWinner,
  type Candidate,
  type FieldOwnership,
  type SurvivorshipRule,
} from '../../src/modules/party/index.js';

/**
 * The rule semantics, tested without a database.
 *
 * `selectWinner` is pure on purpose: rule behaviour is combinatorial — four strategies
 * times verification times absence times ownership — and needing a fixture row for
 * each combination is how a rule engine ends up under-tested.
 */

const DEFAULTS = new Map([
  ['MANUAL', 10],
  ['P21', 20],
  ['PIPEDRIVE', 30],
  ['VALVEMAN_STORE', 40],
  ['MFR_CATALOG', 50],
]);

function rule(overrides: Partial<SurvivorshipRule> = {}): SurvivorshipRule {
  return {
    entityType: 'ORGANIZATION',
    fieldKey: 'legal_name',
    strategy: 'PRIORITY_THEN_RECENCY',
    preferVerified: true,
    allowAbsenceToWin: false,
    minConfidence: 0,
    sourcePriority: ['MANUAL', 'P21', 'PIPEDRIVE'],
    version: 1,
    ...overrides,
  };
}

let sequence = 0;
function candidate(overrides: Partial<Candidate> = {}): Candidate {
  sequence += 1;
  return {
    id: `019b0000-0000-7000-8000-${String(sequence).padStart(12, '0')}`,
    fieldKey: 'legal_name',
    valueText: 'a value',
    assertsAbsence: false,
    sourceSystemCode: 'P21',
    sourceRecordId: null,
    sourceField: null,
    sourceUpdatedAt: null,
    ingestedAt: new Date('2026-01-01T00:00:00Z'),
    confidence: 1,
    verificationStatus: 'UNVERIFIED',
    isSelected: false,
    ...overrides,
  };
}

describe('survivorship rules', () => {
  it('has no winner and says so when there are no candidates', () => {
    const { winner, reason } = selectWinner([], rule(), DEFAULTS, undefined);
    expect(winner).toBeUndefined();
    expect(reason).toBe('No candidate values.');
  });

  it('prefers the higher-priority source under PRIORITY', () => {
    const erp = candidate({ sourceSystemCode: 'P21' });
    const crm = candidate({ sourceSystemCode: 'PIPEDRIVE' });
    const { winner } = selectWinner(
      [crm, erp],
      rule({ strategy: 'PRIORITY' }),
      DEFAULTS,
      undefined,
    );
    expect(winner?.sourceSystemCode).toBe('P21');
  });

  it('prefers the most recent under RECENCY, whatever the source', () => {
    const older = candidate({
      sourceSystemCode: 'P21',
      sourceUpdatedAt: new Date('2024-01-01T00:00:00Z'),
    });
    const newer = candidate({
      sourceSystemCode: 'PIPEDRIVE',
      sourceUpdatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const { winner, reason } = selectWinner(
      [older, newer],
      rule({ strategy: 'RECENCY' }),
      DEFAULTS,
      undefined,
    );
    expect(winner?.sourceSystemCode).toBe('PIPEDRIVE');
    expect(reason).toContain('most recent');
  });

  it("uses the source's own timestamp for recency, not when we saw it", () => {
    // A full re-import of a stale export must not look like fresh news.
    const stale = candidate({
      sourceSystemCode: 'P21',
      sourceUpdatedAt: new Date('2020-01-01T00:00:00Z'),
      ingestedAt: new Date('2026-08-01T00:00:00Z'),
    });
    const fresh = candidate({
      sourceSystemCode: 'PIPEDRIVE',
      sourceUpdatedAt: new Date('2025-01-01T00:00:00Z'),
      ingestedAt: new Date('2025-01-02T00:00:00Z'),
    });
    const { winner } = selectWinner(
      [stale, fresh],
      rule({ strategy: 'RECENCY' }),
      DEFAULTS,
      undefined,
    );
    expect(winner?.sourceSystemCode).toBe('PIPEDRIVE');
  });

  it('ranks a source the rule does not list below every source it does', () => {
    const listed = candidate({ sourceSystemCode: 'PIPEDRIVE' });
    const unlisted = candidate({ sourceSystemCode: 'MFR_CATALOG' });
    const { winner } = selectWinner([unlisted, listed], rule(), DEFAULTS, undefined);
    expect(winner?.sourceSystemCode).toBe('PIPEDRIVE');
  });

  it('prefers a verified value over a higher-priority unverified one', () => {
    const unverifiedErp = candidate({ sourceSystemCode: 'P21' });
    const verifiedCrm = candidate({
      sourceSystemCode: 'PIPEDRIVE',
      verificationStatus: 'VERIFIED',
    });
    const { winner } = selectWinner(
      [unverifiedErp, verifiedCrm],
      rule(),
      DEFAULTS,
      undefined,
    );
    expect(winner?.sourceSystemCode).toBe('PIPEDRIVE');
  });

  it('does not prefer verified when the rule says not to', () => {
    const unverifiedErp = candidate({ sourceSystemCode: 'P21' });
    const verifiedCrm = candidate({
      sourceSystemCode: 'PIPEDRIVE',
      verificationStatus: 'VERIFIED',
    });
    const { winner } = selectWinner(
      [unverifiedErp, verifiedCrm],
      rule({ preferVerified: false }),
      DEFAULTS,
      undefined,
    );
    expect(winner?.sourceSystemCode).toBe('P21');
  });

  it('never selects a rejected candidate, and says why it was excluded', () => {
    const rejected = candidate({
      sourceSystemCode: 'MANUAL',
      verificationStatus: 'REJECTED',
    });
    const { winner, reason } = selectWinner([rejected], rule(), DEFAULTS, undefined);
    expect(winner).toBeUndefined();
    expect(reason).toContain('MANUAL (rejected)');
  });

  it('excludes a candidate below the minimum confidence', () => {
    const guess = candidate({ sourceSystemCode: 'MANUAL', confidence: 0.4 });
    const solid = candidate({ sourceSystemCode: 'PIPEDRIVE', confidence: 0.95 });
    const { winner } = selectWinner(
      [guess, solid],
      rule({ minConfidence: 0.5 }),
      DEFAULTS,
      undefined,
    );
    expect(winner?.sourceSystemCode).toBe('PIPEDRIVE');
  });

  it('does not let an asserted absence win by default', () => {
    const absent = candidate({
      sourceSystemCode: 'MANUAL',
      assertsAbsence: true,
      valueText: null,
    });
    const present = candidate({ sourceSystemCode: 'PIPEDRIVE' });
    const { winner } = selectWinner([absent, present], rule(), DEFAULTS, undefined);
    expect(winner?.sourceSystemCode).toBe('PIPEDRIVE');
  });

  it('lets an asserted absence win where a field is configured to allow it', () => {
    // Some fields genuinely should be blankable from a source: a contact who no longer
    // has a mobile number.
    const absent = candidate({
      sourceSystemCode: 'MANUAL',
      assertsAbsence: true,
      valueText: null,
    });
    const present = candidate({ sourceSystemCode: 'PIPEDRIVE' });
    const { winner } = selectWinner(
      [absent, present],
      rule({ allowAbsenceToWin: true }),
      DEFAULTS,
      undefined,
    );
    expect(winner?.sourceSystemCode).toBe('MANUAL');
  });

  it('picks the longest value under MOST_COMPLETE', () => {
    const short = candidate({ sourceSystemCode: 'MANUAL', valueText: 'ACME' });
    const long = candidate({
      sourceSystemCode: 'PIPEDRIVE',
      valueText: 'ACME Industrial Inc.',
    });
    const { winner, reason } = selectWinner(
      [short, long],
      rule({ strategy: 'MOST_COMPLETE' }),
      DEFAULTS,
      undefined,
    );
    expect(winner?.valueText).toBe('ACME Industrial Inc.');
    expect(reason).toContain('most complete');
  });

  describe('ownership', () => {
    const ownership: FieldOwnership = {
      entityType: 'ORGANIZATION',
      fieldKey: 'legal_name',
      operatingCompany: undefined,
      owningSourceCode: 'P21',
      isExclusive: true,
      allowManualOverride: true,
    };

    it('lets only the owning source win, even against a higher-priority one', () => {
      const owner = candidate({ sourceSystemCode: 'P21' });
      const higherPriority = candidate({
        sourceSystemCode: 'PIPEDRIVE',
        verificationStatus: 'VERIFIED',
      });
      const { winner, reason } = selectWinner(
        [higherPriority, owner],
        rule({ sourcePriority: ['PIPEDRIVE', 'P21'] }),
        DEFAULTS,
        ownership,
      );
      expect(winner?.sourceSystemCode).toBe('P21');
      expect(reason).toContain('P21 owns this field');
    });

    it('still lets a human override an owned field when that is permitted', () => {
      const owner = candidate({ sourceSystemCode: 'P21' });
      const human = candidate({ sourceSystemCode: 'MANUAL' });
      const { winner } = selectWinner([owner, human], rule(), DEFAULTS, ownership);
      expect(winner?.sourceSystemCode).toBe('MANUAL');
    });

    it('refuses a human override where the field is a system of record', () => {
      const owner = candidate({ sourceSystemCode: 'P21' });
      const human = candidate({ sourceSystemCode: 'MANUAL' });
      const { winner } = selectWinner([owner, human], rule(), DEFAULTS, {
        ...ownership,
        allowManualOverride: false,
      });
      expect(winner?.sourceSystemCode).toBe('P21');
    });

    it('falls back to normal ranking when the owner has said nothing', () => {
      // Ownership must not blank a field simply because its owner is silent.
      const crm = candidate({ sourceSystemCode: 'PIPEDRIVE' });
      const { winner } = selectWinner([crm], rule(), DEFAULTS, ownership);
      expect(winner?.sourceSystemCode).toBe('PIPEDRIVE');
    });
  });

  it('is deterministic when two candidates are indistinguishable', () => {
    const first = candidate({
      sourceSystemCode: 'P21',
      id: '019b0000-0000-7000-8000-00000000000a',
    });
    const second = candidate({
      sourceSystemCode: 'P21',
      id: '019b0000-0000-7000-8000-00000000000b',
    });

    // Whatever order the database returns them in, the same one wins. "First row the
    // planner happened to produce" must never decide a canonical value.
    const forwards = selectWinner([first, second], rule(), DEFAULTS, undefined);
    const backwards = selectWinner([second, first], rule(), DEFAULTS, undefined);
    expect(forwards.winner?.id).toBe(first.id);
    expect(backwards.winner?.id).toBe(first.id);
    expect(forwards.reason).toContain('indistinguishable');
  });

  it('names the rule and its version in every reason', () => {
    const a = candidate({ sourceSystemCode: 'P21' });
    const b = candidate({ sourceSystemCode: 'PIPEDRIVE' });
    const { reason } = selectWinner([a, b], rule({ version: 7 }), DEFAULTS, undefined);
    expect(reason).toContain('rule PRIORITY_THEN_RECENCY, version 7');
  });
});
