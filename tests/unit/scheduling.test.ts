import { describe, it, expect } from 'vitest';
import { shiftHours, weekStart, checkBreaks, overlaps, FLSA_WEEKLY_THRESHOLD } from '@/lib/scheduling';

const at = (iso: string) => new Date(iso);

describe('shift hours', () => {
  it('subtracts the unpaid break', () => {
    expect(shiftHours({ startsAt: at('2026-09-01T06:00:00Z'), endsAt: at('2026-09-01T14:30:00Z'), breakMinutes: 30 }))
      .toBe(8);
  });

  it('handles an overnight shift', () => {
    expect(shiftHours({ startsAt: at('2026-09-01T22:00:00Z'), endsAt: at('2026-09-02T06:00:00Z'), breakMinutes: 30 }))
      .toBe(7.5);
  });

  it('never returns negative hours when the break is longer than the shift', () => {
    expect(shiftHours({ startsAt: at('2026-09-01T06:00:00Z'), endsAt: at('2026-09-01T06:20:00Z'), breakMinutes: 60 }))
      .toBe(0);
  });
});

describe('week start', () => {
  it('is the Monday of the containing week', () => {
    // 2026-09-03 is a Thursday.
    expect(weekStart(at('2026-09-03T15:00:00Z')).toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });

  it('treats Sunday as the end of the week, not the start', () => {
    expect(weekStart(at('2026-09-06T12:00:00Z')).toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });

  it('is idempotent on a Monday', () => {
    const monday = at('2026-08-31T00:00:00Z');
    expect(weekStart(monday).toISOString()).toBe(monday.toISOString());
  });
});

describe('break rules', () => {
  const caMeal = {
    id: 'r1', name: '30-min meal after 5h', jurisdiction: 'US-CA',
    afterMinutes: 300, breakMinutes: 30, kind: 'MEAL', paid: false, sourceUrl: null,
  };
  const caSecondMeal = { ...caMeal, id: 'r2', name: 'Second meal after 10h', afterMinutes: 600, breakMinutes: 60 };
  const caRest = { ...caMeal, id: 'r3', name: 'Paid rest', kind: 'REST', paid: true, breakMinutes: 10, afterMinutes: 240 };

  it('flags a shift scheduled with too short a meal break', () => {
    const findings = checkBreaks(
      { startsAt: at('2026-09-01T06:00:00Z'), endsAt: at('2026-09-01T14:30:00Z'), breakMinutes: 15 },
      [caMeal],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].requiredMinutes).toBe(30);
    expect(findings[0].scheduledMinutes).toBe(15);
  });

  it('passes a compliant shift', () => {
    expect(
      checkBreaks({ startsAt: at('2026-09-01T06:00:00Z'), endsAt: at('2026-09-01T14:30:00Z'), breakMinutes: 30 }, [caMeal]),
    ).toHaveLength(0);
  });

  it('ignores a rule whose hour threshold the shift never reaches', () => {
    expect(
      checkBreaks({ startsAt: at('2026-09-01T06:00:00Z'), endsAt: at('2026-09-01T10:00:00Z'), breakMinutes: 0 }, [caMeal]),
    ).toHaveLength(0);
  });

  it('reports only the strictest rule of each kind, not one finding per rule', () => {
    const findings = checkBreaks(
      { startsAt: at('2026-09-01T06:00:00Z'), endsAt: at('2026-09-01T18:00:00Z'), breakMinutes: 30 },
      [caMeal, caSecondMeal],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].requiredMinutes).toBe(60);
  });

  it('does not check paid rest breaks against scheduled unpaid break minutes', () => {
    // A paid rest period is not deducted from hours, so shift.breakMinutes
    // says nothing about whether it was given.
    const findings = checkBreaks(
      { startsAt: at('2026-09-01T06:00:00Z'), endsAt: at('2026-09-01T14:30:00Z'), breakMinutes: 30 },
      [caRest],
    );
    expect(findings).toHaveLength(0);
  });

  it('applies no rules when none are recorded for the jurisdiction', () => {
    expect(
      checkBreaks({ startsAt: at('2026-09-01T06:00:00Z'), endsAt: at('2026-09-01T20:00:00Z'), breakMinutes: 0 }, []),
    ).toHaveLength(0);
  });
});

describe('overlap detection', () => {
  const shift = { startsAt: at('2026-09-01T06:00:00Z'), endsAt: at('2026-09-01T14:00:00Z') };

  it('detects a genuine clash', () => {
    expect(overlaps(shift, { startsAt: at('2026-09-01T13:00:00Z'), endsAt: at('2026-09-01T21:00:00Z') })).toBe(true);
  });

  it('allows back-to-back shifts', () => {
    expect(overlaps(shift, { startsAt: at('2026-09-01T14:00:00Z'), endsAt: at('2026-09-01T22:00:00Z') })).toBe(false);
  });

  it('detects containment in either direction', () => {
    expect(overlaps(shift, { startsAt: at('2026-09-01T08:00:00Z'), endsAt: at('2026-09-01T10:00:00Z') })).toBe(true);
    expect(overlaps({ startsAt: at('2026-09-01T08:00:00Z'), endsAt: at('2026-09-01T10:00:00Z') }, shift)).toBe(true);
  });
});

describe('the FLSA threshold is a constant, not a magic number', () => {
  it('is 40 hours', () => {
    expect(FLSA_WEEKLY_THRESHOLD).toBe(40);
  });
});
