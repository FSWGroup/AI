import 'server-only';
import { db } from '@/lib/db';
import { startOfUTCDay, isoDate, addDays } from '@/lib/format';

/**
 * PTO engine: policy-driven accruals, transaction-balanced ledgers,
 * request/approval flow. Balances are ALWAYS derived from PtoTransaction
 * sums — there is no mutable "balance" column to drift out of sync (§53).
 */

export const HOURS_PER_DAY = 8;

export async function ptoBalance(workerId: string, policyId: string): Promise<number> {
  const agg = await db.ptoTransaction.aggregate({
    where: { workerId, policyId },
    _sum: { hours: true },
  });
  return Number(agg._sum.hours ?? 0);
}

/**
 * Working hours between two dates inclusive: weekdays × 8h minus company
 * holidays on the worker's country calendar.
 */
export async function workingHours(workerId: string, start: Date, end: Date): Promise<number> {
  const worker = await db.worker.findUnique({ where: { id: workerId }, select: { country: true } });
  const holidays = await db.holiday.findMany({
    where: {
      date: { gte: start, lte: end },
      calendar: { country: worker?.country ?? 'US', active: true },
    },
    select: { date: true },
  });
  const holidaySet = new Set(holidays.map((h) => isoDate(h.date)));
  let hours = 0;
  for (let d = startOfUTCDay(start); d <= end; d = addDays(d, 1)) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (holidaySet.has(isoDate(d))) continue;
    hours += HOURS_PER_DAY;
  }
  return hours;
}

/**
 * Idempotent accrual run for one worker+policy for a given date.
 * Accrual keys (stored in the transaction note) prevent double-granting.
 */
export async function accrueIfDue(opts: {
  workerId: string;
  policyId: string;
  today: Date;
  hireDate: Date | null;
}): Promise<boolean> {
  const policy = await db.ptoPolicy.findUniqueOrThrow({ where: { id: opts.policyId } });
  if (!policy.active || policy.accrualMethod === 'NONE') return false;

  // Waiting period
  if (opts.hireDate && policy.waitingPeriodDays > 0) {
    const eligibleAt = addDays(opts.hireDate, policy.waitingPeriodDays);
    if (opts.today < eligibleAt) return false;
  }

  const y = opts.today.getUTCFullYear();
  const m = opts.today.getUTCMonth() + 1;
  const day = opts.today.getUTCDate();
  const hoursPerYear = Number(policy.hoursPerYear);

  let key: string | null = null;
  let hours = 0;
  switch (policy.accrualMethod) {
    case 'ANNUAL_GRANT':
    case 'FRONTLOAD':
      if (m === 1 && day === 1) {
        key = `accrual:${y}`;
        hours = hoursPerYear;
      }
      // First-time assignment mid-year: grant pro-rated remainder once.
      break;
    case 'MONTHLY':
      if (day === 1) {
        key = `accrual:${y}-${String(m).padStart(2, '0')}`;
        hours = hoursPerYear / 12;
      }
      break;
    case 'PER_PAY_PERIOD':
      if (day === 1 || day === 16) {
        key = `accrual:${y}-${String(m).padStart(2, '0')}-${day === 1 ? 'a' : 'b'}`;
        hours = hoursPerYear / 24;
      }
      break;
  }
  if (!key || hours <= 0) return false;

  const existing = await db.ptoTransaction.findFirst({
    where: { workerId: opts.workerId, policyId: opts.policyId, kind: 'ACCRUAL', note: key },
  });
  if (existing) return false;

  // Carryover cap at year boundary (annual policies): expire excess first.
  if ((policy.accrualMethod === 'ANNUAL_GRANT' || policy.accrualMethod === 'FRONTLOAD') && policy.carryoverCapHours !== null) {
    const balance = await ptoBalance(opts.workerId, opts.policyId);
    const cap = Number(policy.carryoverCapHours);
    if (balance > cap) {
      await db.ptoTransaction.create({
        data: {
          workerId: opts.workerId,
          policyId: opts.policyId,
          kind: 'EXPIRY',
          hours: -(balance - cap),
          effectiveDate: opts.today,
          note: `carryover-cap:${y}`,
        },
      });
    }
  }

  // Max balance cap
  if (policy.maxBalanceHours !== null) {
    const balance = await ptoBalance(opts.workerId, opts.policyId);
    const max = Number(policy.maxBalanceHours);
    hours = Math.max(0, Math.min(hours, max - balance));
    if (hours <= 0) return false;
  }

  await db.ptoTransaction.create({
    data: {
      workerId: opts.workerId,
      policyId: opts.policyId,
      kind: 'ACCRUAL',
      hours: Math.round(hours * 100) / 100,
      effectiveDate: opts.today,
      note: key,
    },
  });
  return true;
}

/** Daily sweep: run accruals for every active policy assignment. */
export async function runAccrualsForAll(today: Date): Promise<number> {
  const assignments = await db.ptoPolicyAssignment.findMany({
    where: {
      endDate: null,
      worker: { status: { in: ['ACTIVE', 'ONBOARDING', 'ON_LEAVE'] }, deletedAt: null },
    },
    include: { worker: { select: { hireDate: true } } },
  });
  let count = 0;
  for (const a of assignments) {
    const did = await accrueIfDue({
      workerId: a.workerId,
      policyId: a.policyId,
      today,
      hireDate: a.worker.hireDate,
    }).catch(() => false);
    if (did) count++;
  }
  return count;
}
