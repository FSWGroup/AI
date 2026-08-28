import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { retentionSignal, RETENTION_RULE_IDS, type RetentionFacts } from '@/lib/analytics/retention';
import { median } from '@/lib/analytics/workforce';

/** A worker with nothing wrong: recently paid, mid-band, seen by their manager. */
const healthy: RetentionFacts = {
  monthsSinceLastPayChange: 4,
  compaRatio: 1.0,
  belowBandMinimum: false,
  monthsInCurrentRole: 14,
  managerSpan: 6,
  managerChanges12mo: 0,
  daysSinceLastOneOnOne: 14,
  overdueTrainings: 0,
  ptoDaysTaken12mo: 12,
  tenureMonths: 30,
};

describe('retention signal', () => {
  it('flags nothing for a healthy record', () => {
    const signal = retentionSignal(healthy);
    expect(signal.factors).toHaveLength(0);
    expect(signal.score).toBe(0);
    expect(signal.band).toBe('LOW');
  });

  it('flags pay that has not moved in two years', () => {
    const signal = retentionSignal({ ...healthy, monthsSinceLastPayChange: 26 });
    expect(signal.factors.map((f) => f.id)).toContain('no_pay_change');
  });

  it('distinguishes stale pay from very stale pay, and never double-counts', () => {
    const stale = retentionSignal({ ...healthy, monthsSinceLastPayChange: 20 });
    expect(stale.factors.map((f) => f.id)).toEqual(['pay_stale']);
    const verystale = retentionSignal({ ...healthy, monthsSinceLastPayChange: 30 });
    expect(verystale.factors.map((f) => f.id)).toEqual(['no_pay_change']);
  });

  it('treats below-band pay as the heaviest single factor', () => {
    const signal = retentionSignal({ ...healthy, belowBandMinimum: true, compaRatio: 0.8 });
    const below = signal.factors.find((f) => f.id === 'below_band');
    expect(below).toBeDefined();
    // Below minimum supersedes "low in band" rather than stacking with it.
    expect(signal.factors.map((f) => f.id)).not.toContain('low_in_band');
  });

  it('flags low-in-band pay only when it is not already below minimum', () => {
    const signal = retentionSignal({ ...healthy, compaRatio: 0.8, belowBandMinimum: false });
    expect(signal.factors.map((f) => f.id)).toContain('low_in_band');
  });

  it('flags a missing 1:1, including one that never happened', () => {
    expect(retentionSignal({ ...healthy, daysSinceLastOneOnOne: 120 }).factors.map((f) => f.id))
      .toContain('no_one_on_one');
    expect(retentionSignal({ ...healthy, daysSinceLastOneOnOne: null }).factors.map((f) => f.id))
      .toContain('no_one_on_one');
  });

  it('does not flag unused leave for someone who just joined', () => {
    const newJoiner = retentionSignal({ ...healthy, tenureMonths: 3, ptoDaysTaken12mo: 0 });
    expect(newJoiner.factors.map((f) => f.id)).not.toContain('no_pto');
    const established = retentionSignal({ ...healthy, tenureMonths: 24, ptoDaysTaken12mo: 0 });
    expect(established.factors.map((f) => f.id)).toContain('no_pto');
  });

  it('escalates the band as conditions accumulate', () => {
    expect(retentionSignal({ ...healthy, daysSinceLastOneOnOne: 200 }).band).toBe('LOW');
    expect(retentionSignal({ ...healthy, daysSinceLastOneOnOne: 200, monthsSinceLastPayChange: 30 }).band)
      .toBe('MODERATE');
    expect(
      retentionSignal({
        ...healthy,
        daysSinceLastOneOnOne: 200,
        monthsSinceLastPayChange: 30,
        belowBandMinimum: true,
      }).band,
    ).toBe('ELEVATED');
  });

  it('caps the score at 100 however many conditions match', () => {
    const worst = retentionSignal({
      monthsSinceLastPayChange: 60,
      compaRatio: 0.6,
      belowBandMinimum: true,
      monthsInCurrentRole: 120,
      managerSpan: 30,
      managerChanges12mo: 4,
      daysSinceLastOneOnOne: null,
      overdueTrainings: 9,
      ptoDaysTaken12mo: 0,
      tenureMonths: 6,
    });
    expect(worst.score).toBe(100);
    expect(worst.band).toBe('ELEVATED');
  });

  it('gives every factor an action the company can take', () => {
    const worst = retentionSignal({
      monthsSinceLastPayChange: 60,
      compaRatio: 0.6,
      belowBandMinimum: true,
      monthsInCurrentRole: 120,
      managerSpan: 30,
      managerChanges12mo: 4,
      daysSinceLastOneOnOne: null,
      overdueTrainings: 9,
      ptoDaysTaken12mo: 0,
      tenureMonths: 6,
    });
    for (const factor of worst.factors) {
      expect(factor.suggestion.length).toBeGreaterThan(10);
      expect(factor.label.length).toBeGreaterThan(3);
    }
  });

  it('orders factors by weight so the biggest lever reads first', () => {
    const signal = retentionSignal({ ...healthy, belowBandMinimum: true, overdueTrainings: 5 });
    expect(signal.factors[0].id).toBe('below_band');
  });
});

// ---------------------------------------------------------------------------
// The guarantee that matters most.
// ---------------------------------------------------------------------------

describe('protected characteristics never reach the analysis', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/lib/analytics/retention.ts'), 'utf8');
  const factsSurface = source.slice(
    source.indexOf('export interface RetentionFacts'),
    source.indexOf('export interface RetentionFactor'),
  );

  /**
   * Split the interface's identifiers into individual words so the check is
   * exact. A naive substring scan would fail on `managerSpan`, which contains
   * "age" — and a test that cries wolf gets deleted, taking the guarantee
   * with it.
   */
  const wordsIn = (source: string): Set<string> => {
    const words = new Set<string>();
    for (const identifier of source.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []) {
      for (const part of identifier.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/\s+/)) {
        if (part) words.add(part.toLowerCase());
      }
    }
    return words;
  };

  const factsWords = wordsIn(factsSurface);

  const forbidden = [
    'birth', 'dob', 'age', 'gender', 'sex', 'ethnicity', 'ethnic', 'race', 'nationality',
    'citizenship', 'marital', 'married', 'spouse', 'pregnancy', 'pregnant', 'disability',
    'disabled', 'religion', 'veteran', 'street', 'postal', 'pronouns', 'origin',
  ];

  it.each(forbidden)('RetentionFacts carries no field about %s', (term) => {
    expect([...factsWords]).not.toContain(term);
  });

  it('sanity-check: the word scanner would actually catch a violation', () => {
    expect([...wordsIn('interface X { dateOfBirth: Date }')]).toContain('birth');
    // ...and does not fire on an innocent identifier that merely contains one.
    expect([...wordsIn('interface X { managerSpan: number }')]).not.toContain('age');
  });

  it('the assembly query never selects a protected field', () => {
    const workforce = readFileSync(path.join(process.cwd(), 'src/lib/analytics/workforce.ts'), 'utf8');
    const fn = workforce.slice(workforce.indexOf('export async function retentionSignals'));
    for (const term of ['dateOfBirth', 'citizenship', 'homeStreet', 'homeCity', 'homePostal', 'pronouns']) {
      expect(fn).not.toContain(term);
    }
  });

  it('every rule is job-related and reversible by the employer', () => {
    // Each id names a company-side condition, not an attribute of a person.
    expect(RETENTION_RULE_IDS.sort()).toEqual(
      [
        'below_band', 'first_year', 'long_in_role', 'low_in_band', 'manager_churn',
        'no_one_on_one', 'no_pay_change', 'no_pto', 'overdue_training', 'pay_stale', 'wide_span',
      ].sort(),
    );
  });
});

describe('median', () => {
  it('handles odd and even counts, and an empty set', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
