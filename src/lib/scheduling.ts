import 'server-only';
import { db } from '@/lib/db';

/**
 * Shift scheduling, overtime forecasting and break compliance.
 *
 * The point of forecasting overtime is that it is *cheap to avoid and
 * expensive to discover*. A distributor finds out about unplanned overtime
 * when payroll runs, by which point it is already owed. Projecting scheduled
 * hours against the FLSA weekly threshold turns it into a scheduling decision
 * instead of a payroll surprise.
 *
 * Break rules live in the database (BreakRule) rather than in code, for the
 * same reason compliance rules do: they are jurisdictional and they change.
 * The rules seeded here carry their source, and the UI is explicit that this
 * is a scheduling aid, not a legal opinion.
 */

/** FLSA weekly overtime threshold for non-exempt employees. */
export const FLSA_WEEKLY_THRESHOLD = 40;

export function shiftHours(shift: { startsAt: Date; endsAt: Date; breakMinutes: number }): number {
  const gross = (shift.endsAt.getTime() - shift.startsAt.getTime()) / 3_600_000;
  return Math.max(0, gross - shift.breakMinutes / 60);
}

/** Monday 00:00 UTC of the week containing `d`. */
export function weekStart(d: Date): Date {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = start.getUTCDay(); // 0 Sun … 6 Sat
  const offset = day === 0 ? 6 : day - 1;
  start.setUTCDate(start.getUTCDate() - offset);
  return start;
}

export interface OvertimeProjection {
  workerId: string;
  name: string;
  /** Hours already worked and approved this week. */
  workedHours: number;
  /** Hours on the schedule for the rest of the week. */
  scheduledHours: number;
  projectedHours: number;
  overtimeHours: number;
  flsaStatus: string | null;
  /** Exempt employees do not accrue FLSA overtime; shown for completeness. */
  countsForOvertime: boolean;
}

/**
 * Project the week ahead.
 *
 * Worked hours come from time entries; scheduled hours come from published
 * shifts that have not happened yet. Draft shifts are excluded — a schedule
 * nobody has seen is not a commitment.
 */
export async function projectOvertime(week: Date): Promise<OvertimeProjection[]> {
  const start = weekStart(week);
  const end = new Date(start.getTime() + 7 * 86_400_000);
  const now = new Date();

  const [assignments, timesheets] = await Promise.all([
    db.shiftAssignment.findMany({
      where: {
        status: { in: ['ASSIGNED', 'ACCEPTED'] },
        shift: { status: 'PUBLISHED', date: { gte: start, lt: end } },
      },
      include: {
        shift: { select: { startsAt: true, endsAt: true, breakMinutes: true } },
        worker: {
          select: {
            id: true,
            legalFirstName: true,
            preferredName: true,
            lastName: true,
            employments: { where: { effectiveTo: null }, take: 1, select: { flsaStatus: true } },
          },
        },
      },
    }),
    db.timesheet.findMany({
      where: { weekStart: start },
      include: { entries: true, worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } } },
    }),
  ]);

  const rows = new Map<string, OvertimeProjection>();

  for (const sheet of timesheets) {
    const worked = sheet.entries.reduce((sum, e) => {
      if (e.manualHours !== null) return sum + Number(e.manualHours);
      if (e.clockIn && e.clockOut) {
        return sum + Math.max(0, (e.clockOut.getTime() - e.clockIn.getTime()) / 3_600_000 - e.breakMinutes / 60);
      }
      return sum;
    }, 0);
    rows.set(sheet.workerId, {
      workerId: sheet.workerId,
      name: `${sheet.worker.preferredName || sheet.worker.legalFirstName} ${sheet.worker.lastName}`,
      workedHours: round2(worked),
      scheduledHours: 0,
      projectedHours: round2(worked),
      overtimeHours: 0,
      flsaStatus: null,
      countsForOvertime: true,
    });
  }

  for (const assignment of assignments) {
    // A shift already in the past is counted through the timesheet, not twice.
    if (assignment.shift.endsAt <= now) continue;
    const w = assignment.worker;
    const row = rows.get(w.id) ?? {
      workerId: w.id,
      name: `${w.preferredName || w.legalFirstName} ${w.lastName}`,
      workedHours: 0,
      scheduledHours: 0,
      projectedHours: 0,
      overtimeHours: 0,
      flsaStatus: w.employments[0]?.flsaStatus ?? null,
      countsForOvertime: w.employments[0]?.flsaStatus !== 'EXEMPT',
    };
    row.flsaStatus = w.employments[0]?.flsaStatus ?? row.flsaStatus;
    row.countsForOvertime = row.flsaStatus !== 'EXEMPT';
    row.scheduledHours = round2(row.scheduledHours + shiftHours(assignment.shift));
    rows.set(w.id, row);
  }

  return [...rows.values()]
    .map((row) => {
      const projected = round2(row.workedHours + row.scheduledHours);
      return {
        ...row,
        projectedHours: projected,
        overtimeHours: row.countsForOvertime ? round2(Math.max(0, projected - FLSA_WEEKLY_THRESHOLD)) : 0,
      };
    })
    .sort((a, b) => b.projectedHours - a.projectedHours);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Break compliance
// ---------------------------------------------------------------------------

export interface BreakFinding {
  ruleId: string;
  ruleName: string;
  jurisdiction: string;
  requiredMinutes: number;
  scheduledMinutes: number;
  kind: string;
  paid: boolean;
  sourceUrl: string | null;
}

/**
 * Check one shift's scheduled break against the rules for its jurisdiction.
 *
 * Only rules whose `afterMinutes` threshold the shift actually reaches apply,
 * and only the longest requirement of each kind is reported — a state that
 * requires a 30-minute meal break after 5 hours and after 6 hours should
 * produce one finding, not two.
 */
export function checkBreaks(
  shift: { startsAt: Date; endsAt: Date; breakMinutes: number },
  rules: {
    id: string; name: string; jurisdiction: string; afterMinutes: number;
    breakMinutes: number; kind: string; paid: boolean; sourceUrl: string | null;
  }[],
): BreakFinding[] {
  const shiftMinutes = (shift.endsAt.getTime() - shift.startsAt.getTime()) / 60_000;
  const applicable = rules.filter((r) => shiftMinutes >= r.afterMinutes);

  const strictestByKind = new Map<string, (typeof applicable)[number]>();
  for (const rule of applicable) {
    const current = strictestByKind.get(rule.kind);
    if (!current || rule.breakMinutes > current.breakMinutes) strictestByKind.set(rule.kind, rule);
  }

  const findings: BreakFinding[] = [];
  for (const rule of strictestByKind.values()) {
    // Unpaid meal breaks are what `breakMinutes` on the shift represents.
    // A paid rest break is not deducted from hours, so a shift cannot be
    // checked against it from scheduled break minutes alone.
    if (rule.paid) continue;
    if (shift.breakMinutes < rule.breakMinutes) {
      findings.push({
        ruleId: rule.id,
        ruleName: rule.name,
        jurisdiction: rule.jurisdiction,
        requiredMinutes: rule.breakMinutes,
        scheduledMinutes: shift.breakMinutes,
        kind: rule.kind,
        paid: rule.paid,
        sourceUrl: rule.sourceUrl,
      });
    }
  }
  return findings;
}

/** Break findings across a week's published shifts, by jurisdiction. */
export async function weeklyBreakFindings(week: Date) {
  const start = weekStart(week);
  const end = new Date(start.getTime() + 7 * 86_400_000);
  const [shifts, rules, locations] = await Promise.all([
    db.shift.findMany({
      where: { date: { gte: start, lt: end }, status: 'PUBLISHED' },
      include: { assignments: { select: { workerId: true } } },
    }),
    db.breakRule.findMany({ where: { active: true } }),
    db.location.findMany({ select: { id: true, state: true, country: true } }),
  ]);
  const jurisdictionOf = (locationId: string | null) => {
    if (!locationId) return 'US-PA';
    const loc = locations.find((l) => l.id === locationId);
    if (!loc) return 'US-PA';
    return loc.country === 'US' ? `US-${loc.state ?? 'PA'}` : loc.country;
  };

  return shifts.flatMap((shift) => {
    const jurisdiction = jurisdictionOf(shift.locationId);
    const findings = checkBreaks(shift, rules.filter((r) => r.jurisdiction === jurisdiction));
    return findings.map((f) => ({ shiftId: shift.id, date: shift.date, workers: shift.assignments.length, ...f }));
  });
}

// ---------------------------------------------------------------------------
// Labor cost
// ---------------------------------------------------------------------------

export interface LaborCostRow {
  key: string;
  scheduledHours: number;
  estimatedCost: number;
  currency: string;
  workers: number;
}

/**
 * Scheduled labour cost for a week, by location.
 *
 * An estimate, and labelled as one: it prices scheduled hours at each
 * worker's current base rate. It does not model overtime premium, shift
 * differentials, or employer taxes — payroll does that, and pretending
 * otherwise would produce a number people would wrongly trust.
 */
export async function scheduledLaborCost(week: Date): Promise<LaborCostRow[]> {
  const start = weekStart(week);
  const end = new Date(start.getTime() + 7 * 86_400_000);
  const [assignments, locations] = await Promise.all([
    db.shiftAssignment.findMany({
      where: { status: { in: ['ASSIGNED', 'ACCEPTED', 'COMPLETED'] }, shift: { date: { gte: start, lt: end }, status: 'PUBLISHED' } },
      include: {
        shift: { select: { startsAt: true, endsAt: true, breakMinutes: true, locationId: true } },
        worker: {
          select: {
            id: true,
            compensations: {
              where: { effectiveTo: null },
              orderBy: { effectiveFrom: 'desc' },
              take: 1,
              select: { amount: true, rateType: true, currency: true },
            },
          },
        },
      },
    }),
    db.location.findMany({ select: { id: true, name: true } }),
  ]);
  const locationName = new Map(locations.map((l) => [l.id, l.name]));

  const rows = new Map<string, { hours: number; cost: number; currency: string; workers: Set<string> }>();
  for (const a of assignments) {
    const key = a.shift.locationId ? (locationName.get(a.shift.locationId) ?? 'Unassigned') : 'Unassigned';
    const comp = a.worker.compensations[0];
    const hours = shiftHours(a.shift);
    const hourly = comp
      ? comp.rateType === 'HOURLY'
        ? Number(comp.amount)
        : Number(comp.amount) / 2080
      : 0;
    const row = rows.get(key) ?? { hours: 0, cost: 0, currency: comp?.currency ?? 'USD', workers: new Set<string>() };
    row.hours += hours;
    row.cost += hours * hourly;
    row.workers.add(a.workerId);
    rows.set(key, row);
  }

  return [...rows.entries()]
    .map(([key, r]) => ({
      key,
      scheduledHours: round2(r.hours),
      estimatedCost: round2(r.cost),
      currency: r.currency,
      workers: r.workers.size,
    }))
    .sort((a, b) => b.estimatedCost - a.estimatedCost);
}

/** A worker cannot be in two places at once. */
export function overlaps(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}
