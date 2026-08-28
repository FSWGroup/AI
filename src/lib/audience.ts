import 'server-only';
import { db } from '@/lib/db';

/**
 * Shared population targeting used by lifecycle templates, workflows,
 * policies, announcements, training auto-assignment and compliance rules.
 */
export interface Audience {
  countries?: string[];
  workerTypes?: string[];
  departmentIds?: string[];
  legalEntityIds?: string[];
  workStates?: string[];
  workModes?: string[];
  managerOnly?: boolean;
  tenureDaysGte?: number;
  tenureDaysLte?: number;
}

export interface WorkerFacts {
  workerId: string;
  country: string;
  workerType: string;
  departmentId: string | null;
  legalEntityId: string | null;
  workState: string | null;
  workMode: string | null;
  isManager: boolean;
  tenureDays: number | null;
}

export async function workerFacts(workerId: string): Promise<WorkerFacts | null> {
  const worker = await db.worker.findUnique({
    where: { id: workerId },
    include: { employments: { where: { effectiveTo: null }, take: 1 } },
  });
  if (!worker) return null;
  const employment = worker.employments[0] ?? null;
  const reportCount = await db.employmentRecord.count({
    where: { effectiveTo: null, managerId: workerId },
  });
  return {
    workerId,
    country: worker.country,
    workerType: worker.workerType,
    departmentId: employment?.departmentId ?? null,
    legalEntityId: employment?.legalEntityId ?? null,
    workState: employment?.workState ?? null,
    workMode: employment?.workMode ?? null,
    isManager: reportCount > 0,
    tenureDays: worker.hireDate ? Math.floor((Date.now() - worker.hireDate.getTime()) / 86_400_000) : null,
  };
}

export function audienceMatches(audience: Audience | null | undefined, facts: WorkerFacts): boolean {
  if (!audience) return true;
  if (audience.countries?.length && !audience.countries.includes(facts.country)) return false;
  if (audience.workerTypes?.length && !audience.workerTypes.includes(facts.workerType)) return false;
  if (audience.departmentIds?.length && (!facts.departmentId || !audience.departmentIds.includes(facts.departmentId))) return false;
  if (audience.legalEntityIds?.length && (!facts.legalEntityId || !audience.legalEntityIds.includes(facts.legalEntityId))) return false;
  if (audience.workStates?.length && (!facts.workState || !audience.workStates.includes(facts.workState))) return false;
  if (audience.workModes?.length && (!facts.workMode || !audience.workModes.includes(facts.workMode))) return false;
  if (audience.managerOnly && !facts.isManager) return false;
  if (audience.tenureDaysGte !== undefined && (facts.tenureDays === null || facts.tenureDays < audience.tenureDaysGte)) return false;
  if (audience.tenureDaysLte !== undefined && (facts.tenureDays === null || facts.tenureDays > audience.tenureDaysLte)) return false;
  return true;
}

/** Ids of all non-terminated workers matching an audience. */
export async function audienceWorkerIds(audience: Audience | null | undefined): Promise<string[]> {
  const workers = await db.worker.findMany({
    where: { status: { notIn: ['TERMINATED'] }, deletedAt: null },
    select: { id: true },
  });
  if (!audience || Object.keys(audience).length === 0) return workers.map((w) => w.id);
  const out: string[] = [];
  for (const w of workers) {
    const facts = await workerFacts(w.id);
    if (facts && audienceMatches(audience, facts)) out.push(w.id);
  }
  return out;
}
