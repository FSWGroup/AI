import 'server-only';
import { db } from '@/lib/db';
import { retentionSignal, type RetentionFacts, type RetentionSignal } from '@/lib/analytics/retention';

/**
 * Workforce analytics that answer "what is about to happen", not "what
 * happened".
 *
 * These are only possible because employment and compensation are effective
 * dated: history is never overwritten, so a cohort can be reconstructed as it
 * actually was rather than as the current row claims.
 */

const MONTH_MS = 30.44 * 86_400_000;

function monthsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MONTH_MS));
}

// ---------------------------------------------------------------------------
// Early attrition cohorts
// ---------------------------------------------------------------------------

export interface CohortRow {
  cohort: string; // "2026-Q1"
  hired: number;
  leftWithin90Days: number;
  leftWithin1Year: number;
  stillHere: number;
  /** Null while the cohort is too young to have a meaningful 90-day rate. */
  ninetyDayAttritionPct: number | null;
}

function quarterOf(d: Date): string {
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/** Start of the quarter after the one named, e.g. "2026-Q1" -> 2026-04-01. */
function quarterEnd(cohort: string): Date {
  const year = Number(cohort.slice(0, 4));
  const quarter = Number(cohort.slice(6));
  // Month is zero-based here, so quarter 1 ends at month index 3 (April).
  return new Date(Date.UTC(year, quarter * 3, 1));
}

export function cohortHasMatured(cohort: string, now: Date): boolean {
  return now.getTime() - quarterEnd(cohort).getTime() >= 90 * 86_400_000;
}

/**
 * Early attrition by hire cohort. The expensive failure for a distributor is
 * the warehouse hire who leaves inside three months, because the whole cost of
 * recruiting and training them is sunk. Grouping by hire quarter shows whether
 * that is getting better or worse.
 *
 * A cohort younger than 90 days cannot have a 90-day rate, so it reports null
 * rather than a flattering zero.
 */
export async function earlyAttritionCohorts(opts: { quarters?: number; departmentId?: string } = {}) {
  const quarters = opts.quarters ?? 8;
  const since = new Date(Date.now() - quarters * 3 * MONTH_MS);
  const workers = await db.worker.findMany({
    where: {
      hireDate: { not: null, gte: since },
      deletedAt: null,
      ...(opts.departmentId
        ? { employments: { some: { departmentId: opts.departmentId, effectiveTo: null } } }
        : {}),
    },
    select: { hireDate: true, terminationDate: true, status: true },
  });

  const now = new Date();
  const byCohort = new Map<string, CohortRow>();
  for (const w of workers) {
    if (!w.hireDate) continue;
    const key = quarterOf(w.hireDate);
    const row = byCohort.get(key) ?? {
      cohort: key,
      hired: 0,
      leftWithin90Days: 0,
      leftWithin1Year: 0,
      stillHere: 0,
      ninetyDayAttritionPct: null,
    };
    row.hired += 1;
    if (w.terminationDate) {
      const daysServed = (w.terminationDate.getTime() - w.hireDate.getTime()) / 86_400_000;
      if (daysServed <= 90) row.leftWithin90Days += 1;
      if (daysServed <= 365) row.leftWithin1Year += 1;
    } else {
      row.stillHere += 1;
    }
    byCohort.set(key, row);
  }

  const rows = [...byCohort.values()].map((row) => ({
    ...row,
    // Someone hired on the last day of the quarter has not had 90 days yet, so
    // a cohort only reports a rate once its *last* hire has passed that mark.
    // Otherwise a young cohort reports a flattering zero.
    ninetyDayAttritionPct:
      cohortHasMatured(row.cohort, now) && row.hired > 0 ? (row.leftWithin90Days / row.hired) * 100 : null,
  }));
  return rows.sort((a, b) => a.cohort.localeCompare(b.cohort));
}

// ---------------------------------------------------------------------------
// Hiring velocity
// ---------------------------------------------------------------------------

export interface TimeToFillRow {
  key: string;
  filled: number;
  medianDays: number | null;
  openNow: number;
  oldestOpenDays: number | null;
}

/**
 * Median days from opening a requisition to an accepted offer, by department.
 * Median rather than mean: one six-month search should not make the whole
 * department look broken.
 */
export async function timeToFill(): Promise<TimeToFillRow[]> {
  const [requisitions, departments] = await Promise.all([
    db.jobRequisition.findMany({
      where: { openedAt: { not: null } },
      select: {
        id: true,
        departmentId: true,
        status: true,
        openedAt: true,
        offers: {
          where: { status: 'ACCEPTED' },
          orderBy: { respondedAt: 'asc' },
          take: 1,
          select: { respondedAt: true, createdAt: true },
        },
      },
    }),
    db.department.findMany({ select: { id: true, name: true } }),
  ]);
  const deptName = new Map(departments.map((d) => [d.id, d.name]));

  const buckets = new Map<string, { days: number[]; openNow: number; oldestOpen: number | null }>();
  const now = Date.now();
  for (const req of requisitions) {
    const key = req.departmentId ? (deptName.get(req.departmentId) ?? 'Unassigned') : 'Unassigned';
    const bucket = buckets.get(key) ?? { days: [], openNow: 0, oldestOpen: null };
    const accepted = req.offers[0]?.respondedAt ?? req.offers[0]?.createdAt ?? null;
    if (accepted && req.openedAt) {
      bucket.days.push((accepted.getTime() - req.openedAt.getTime()) / 86_400_000);
    } else if (req.status === 'OPEN' && req.openedAt) {
      bucket.openNow += 1;
      const age = (now - req.openedAt.getTime()) / 86_400_000;
      bucket.oldestOpen = Math.max(bucket.oldestOpen ?? 0, age);
    }
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([key, b]) => ({
      key,
      filled: b.days.length,
      medianDays: roundTo(median(b.days), 1),
      openNow: b.openNow,
      oldestOpenDays: b.oldestOpen === null ? null : Math.round(b.oldestOpen),
    }))
    .sort((a, b) => b.openNow - a.openNow || a.key.localeCompare(b.key));
}

function roundTo(value: number | null, places: number): number | null {
  if (value === null) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Exact median. Callers round to whatever precision their unit deserves. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ---------------------------------------------------------------------------
// Pay position
// ---------------------------------------------------------------------------

export interface CompaRow {
  workerId: string;
  name: string;
  jobFamily: string | null;
  jobLevel: string | null;
  amount: number;
  currency: string;
  bandMin: number;
  bandMid: number;
  bandMax: number;
  compaRatio: number;
  position: 'BELOW_MIN' | 'LOW' | 'IN_RANGE' | 'HIGH' | 'ABOVE_MAX';
}

/**
 * Where everyone sits against their band. Below-minimum is the actionable
 * number: it is both a retention risk and, left long enough, a pay equity
 * problem.
 */
export async function compaRatios(): Promise<CompaRow[]> {
  const [workers, bands] = await Promise.all([
    db.worker.findMany({
      where: { status: { in: ['ACTIVE', 'ON_LEAVE'] }, deletedAt: null },
      select: {
        id: true,
        legalFirstName: true,
        preferredName: true,
        lastName: true,
        country: true,
        employments: {
          where: { effectiveTo: null },
          take: 1,
          select: { jobFamily: true, jobLevel: true },
        },
        compensations: {
          where: { effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          select: { amount: true, currency: true, rateType: true },
        },
      },
    }),
    db.salaryBand.findMany(),
  ]);

  const rows: CompaRow[] = [];
  for (const w of workers) {
    const employment = w.employments[0];
    const comp = w.compensations[0];
    if (!employment?.jobFamily || !employment.jobLevel || !comp) continue;
    const geography = w.country === 'PH' ? 'PH' : 'US';
    const band = bands.find(
      (b) => b.jobFamily === employment.jobFamily && b.jobLevel === employment.jobLevel && b.geography === geography,
    );
    if (!band) continue;

    // Bands are annual; put hourly rates on the same footing before comparing.
    const annual = comp.rateType === 'HOURLY' ? Number(comp.amount) * 2080 : Number(comp.amount);
    const mid = Number(band.midAmount);
    if (mid <= 0) continue;
    const ratio = annual / mid;
    const min = Number(band.minAmount);
    const max = Number(band.maxAmount);
    rows.push({
      workerId: w.id,
      name: `${w.preferredName || w.legalFirstName} ${w.lastName}`,
      jobFamily: employment.jobFamily,
      jobLevel: employment.jobLevel,
      amount: annual,
      currency: comp.currency,
      bandMin: min,
      bandMid: mid,
      bandMax: max,
      compaRatio: Math.round(ratio * 1000) / 1000,
      position:
        annual < min ? 'BELOW_MIN' : annual > max ? 'ABOVE_MAX' : ratio < 0.9 ? 'LOW' : ratio > 1.1 ? 'HIGH' : 'IN_RANGE',
    });
  }
  return rows.sort((a, b) => a.compaRatio - b.compaRatio);
}

// ---------------------------------------------------------------------------
// Retention facts assembly
// ---------------------------------------------------------------------------

export interface WorkerRetentionRow {
  workerId: string;
  name: string;
  title: string | null;
  department: string | null;
  signal: RetentionSignal;
}

/**
 * Build RetentionFacts for the active population.
 *
 * The select lists below are the enforcement point for the protected-
 * characteristic rule: dateOfBirth, gender, marital status, citizenship and
 * home address are simply never read here, so they cannot reach the rules
 * even by accident.
 */
export async function retentionSignals(opts: { managerId?: string } = {}): Promise<WorkerRetentionRow[]> {
  const now = new Date();
  const yearAgo = new Date(now.getTime() - 365 * 86_400_000);

  const workers = await db.worker.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      ...(opts.managerId ? { employments: { some: { managerId: opts.managerId, effectiveTo: null } } } : {}),
    },
    select: {
      id: true,
      legalFirstName: true,
      preferredName: true,
      lastName: true,
      hireDate: true,
      country: true,
      employments: {
        orderBy: { effectiveFrom: 'desc' },
        select: {
          title: true,
          jobFamily: true,
          jobLevel: true,
          managerId: true,
          effectiveFrom: true,
          effectiveTo: true,
          department: { select: { name: true } },
        },
      },
      compensations: {
        orderBy: { effectiveFrom: 'desc' },
        select: { amount: true, rateType: true, effectiveFrom: true, effectiveTo: true },
      },
      trainingAssignments: {
        where: { status: { in: ['ASSIGNED', 'IN_PROGRESS', 'OVERDUE'] }, dueDate: { lt: now } },
        select: { id: true },
      },
      ptoTransactions: {
        where: { kind: 'USE', effectiveDate: { gte: yearAgo } },
        select: { hours: true },
      },
    },
  });

  const [bands, spans, oneOnOnes] = await Promise.all([
    db.salaryBand.findMany(),
    db.employmentRecord.groupBy({
      by: ['managerId'],
      where: { effectiveTo: null, managerId: { not: null } },
      _count: { _all: true },
    }),
    db.oneOnOne.findMany({
      where: { scheduledAt: { lte: now } },
      orderBy: { scheduledAt: 'desc' },
      select: { reportId: true, managerId: true, scheduledAt: true },
    }),
  ]);
  const spanByManager = new Map(spans.map((s) => [s.managerId!, s._count._all]));
  const lastOneOnOne = new Map<string, Date>();
  for (const o of oneOnOnes) {
    if (!lastOneOnOne.has(o.reportId)) lastOneOnOne.set(o.reportId, o.scheduledAt);
  }

  return workers.map((w) => {
    const current = w.employments.find((e) => e.effectiveTo === null) ?? w.employments[0] ?? null;
    const currentComp = w.compensations.find((c) => c.effectiveTo === null) ?? w.compensations[0] ?? null;

    // The most recent compensation row's start date is the last pay change.
    const lastPayChange = w.compensations[0]?.effectiveFrom ?? null;

    // How long in the current title: walk back while the title is unchanged.
    let roleStart = current?.effectiveFrom ?? null;
    if (current) {
      for (const e of w.employments) {
        if (e.title === current.title) roleStart = e.effectiveFrom;
        else break;
      }
    }

    const distinctManagers = new Set(
      w.employments.filter((e) => e.effectiveFrom >= yearAgo).map((e) => e.managerId ?? 'none'),
    );

    const geography = w.country === 'PH' ? 'PH' : 'US';
    const band =
      current?.jobFamily && current.jobLevel
        ? bands.find(
            (b) => b.jobFamily === current.jobFamily && b.jobLevel === current.jobLevel && b.geography === geography,
          )
        : undefined;
    const annual = currentComp
      ? currentComp.rateType === 'HOURLY'
        ? Number(currentComp.amount) * 2080
        : Number(currentComp.amount)
      : null;

    const last1on1 = lastOneOnOne.get(w.id) ?? null;
    const ptoHours = w.ptoTransactions.reduce((sum, t) => sum + Math.abs(Number(t.hours)), 0);

    const facts: RetentionFacts = {
      monthsSinceLastPayChange: lastPayChange ? monthsBetween(lastPayChange, now) : null,
      compaRatio: band && annual ? Math.round((annual / Number(band.midAmount)) * 1000) / 1000 : null,
      belowBandMinimum: Boolean(band && annual && annual < Number(band.minAmount)),
      monthsInCurrentRole: roleStart ? monthsBetween(roleStart, now) : null,
      managerSpan: current?.managerId ? (spanByManager.get(current.managerId) ?? null) : null,
      managerChanges12mo: Math.max(0, distinctManagers.size - 1),
      daysSinceLastOneOnOne: last1on1 ? Math.floor((now.getTime() - last1on1.getTime()) / 86_400_000) : null,
      overdueTrainings: w.trainingAssignments.length,
      ptoDaysTaken12mo: Math.round(ptoHours / 8),
      tenureMonths: w.hireDate ? monthsBetween(w.hireDate, now) : 0,
    };
    return {
      workerId: w.id,
      name: `${w.preferredName || w.legalFirstName} ${w.lastName}`,
      title: current?.title ?? null,
      department: current?.department?.name ?? null,
      signal: retentionSignal(facts),
    };
  });
}
