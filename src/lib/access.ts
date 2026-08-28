import 'server-only';
import { db } from '@/lib/db';
import { createTask } from '@/lib/tasks';

/**
 * The access provisioning loop.
 *
 * The gap this closes: FSW People already tracks who has what, but grants and
 * revocations happen by hand in each vendor console. So the record shows what
 * somebody *intended*, and nobody finds out otherwise until a leaver still has
 * a mailbox three months later.
 *
 * An access profile makes "what does a Warehouse Associate get" data rather
 * than tribal knowledge. Onboarding creates the grant tasks from it,
 * offboarding creates the revoke tasks from what was actually granted, and
 * `accessExceptions()` is the report that catches whatever slipped.
 *
 * What this does NOT do: reach into Entra, Google or RingCentral and press the
 * button. That needs each vendor's API and credentials. Until an adapter
 * exists, a task with a named owner and an evidence record is the honest
 * mechanism — it is what someone has to do anyway, tracked instead of
 * remembered.
 */

export interface ProfileCriteria {
  departmentIds?: string[];
  jobFamilies?: string[];
  workerTypes?: string[];
  titles?: string[];
}

export function profileMatches(
  criteria: ProfileCriteria | null | undefined,
  facts: { departmentId: string | null; jobFamily: string | null; workerType: string; title: string | null },
): boolean {
  if (!criteria) return false;
  // An empty profile matches nobody. A profile that applied to everyone by
  // omission would over-provision the whole company on its first save.
  const hasAnyRule =
    Boolean(criteria.departmentIds?.length) ||
    Boolean(criteria.jobFamilies?.length) ||
    Boolean(criteria.workerTypes?.length) ||
    Boolean(criteria.titles?.length);
  if (!hasAnyRule) return false;

  if (criteria.departmentIds?.length && (!facts.departmentId || !criteria.departmentIds.includes(facts.departmentId))) {
    return false;
  }
  if (criteria.jobFamilies?.length && (!facts.jobFamily || !criteria.jobFamilies.includes(facts.jobFamily))) {
    return false;
  }
  if (criteria.workerTypes?.length && !criteria.workerTypes.includes(facts.workerType)) return false;
  if (criteria.titles?.length && (!facts.title || !criteria.titles.includes(facts.title))) return false;
  return true;
}

/** Every entitlement the profiles say this worker should have. */
export async function entitlementsFor(workerId: string) {
  const worker = await db.worker.findUnique({
    where: { id: workerId },
    select: {
      id: true,
      workerType: true,
      employments: {
        where: { effectiveTo: null },
        take: 1,
        select: { departmentId: true, jobFamily: true, title: true },
      },
    },
  });
  if (!worker) return [];
  const employment = worker.employments[0];
  const facts = {
    departmentId: employment?.departmentId ?? null,
    jobFamily: employment?.jobFamily ?? null,
    workerType: worker.workerType,
    title: employment?.title ?? null,
  };

  const profiles = await db.accessProfile.findMany({
    where: { active: true },
    include: { items: { include: { app: { select: { id: true, name: true, active: true } } } } },
  });

  const matched = profiles.filter((p) => profileMatches(p.criteria as ProfileCriteria, facts));
  // One app can appear in two profiles; the higher access level wins.
  const rank: Record<string, number> = { READONLY: 1, USER: 2, ADMIN: 3 };
  const byApp = new Map<string, { appId: string; appName: string; accessLevel: string; required: boolean; profile: string }>();
  for (const profile of matched) {
    for (const item of profile.items) {
      if (!item.app.active) continue;
      const existing = byApp.get(item.appId);
      if (!existing || (rank[item.accessLevel] ?? 0) > (rank[existing.accessLevel] ?? 0)) {
        byApp.set(item.appId, {
          appId: item.appId,
          appName: item.app.name,
          accessLevel: item.accessLevel,
          required: item.required || Boolean(existing?.required),
          profile: profile.name,
        });
      }
    }
  }
  return [...byApp.values()];
}

async function recordEvent(opts: {
  workerId: string;
  appId?: string | null;
  appName: string;
  action: string;
  source?: string;
  actorUserId?: string | null;
  detail?: string;
}) {
  await db.accessEvent.create({
    data: {
      workerId: opts.workerId,
      appId: opts.appId ?? null,
      appName: opts.appName,
      action: opts.action,
      source: opts.source ?? 'MANUAL',
      actorUserId: opts.actorUserId ?? null,
      detail: opts.detail ?? null,
    },
  });
}

export { recordEvent as recordAccessEvent };

/**
 * Raise the grant tasks a new hire needs, from their profiles.
 *
 * Idempotent: an entitlement that is already granted, or that already has an
 * open task, is skipped. Onboarding can therefore be re-run safely.
 */
export async function provisionForOnboarding(workerId: string, actorUserId?: string | null): Promise<number> {
  const [entitlements, existingGrants, worker] = await Promise.all([
    entitlementsFor(workerId),
    db.appAccessGrant.findMany({ where: { workerId, revokedAt: null }, select: { appId: true } }),
    db.worker.findUnique({
      where: { id: workerId },
      select: { legalFirstName: true, preferredName: true, lastName: true },
    }),
  ]);
  if (!worker) return 0;
  const has = new Set(existingGrants.map((g) => g.appId));
  const name = `${worker.preferredName || worker.legalFirstName} ${worker.lastName}`;

  let created = 0;
  for (const entitlement of entitlements) {
    if (has.has(entitlement.appId)) continue;
    const openTask = await db.task.findFirst({
      where: {
        workerId,
        sourceType: 'ACCESS_PROVISION',
        sourceId: entitlement.appId,
        status: { notIn: ['COMPLETED', 'CANCELED'] },
      },
      select: { id: true },
    });
    if (openTask) continue;

    await createTask({
      title: `Grant ${entitlement.appName} access to ${name}`,
      description: `${entitlement.accessLevel.toLowerCase()} access, from the "${entitlement.profile}" access profile.`,
      category: 'IT_ACCESS',
      workerId,
      ownerRoleKey: 'IT_ADMIN',
      dueDate: new Date(Date.now() + 2 * 86_400_000),
      priority: entitlement.required ? 'HIGH' : 'NORMAL',
      sourceType: 'ACCESS_PROVISION',
      sourceId: entitlement.appId,
      createdById: actorUserId ?? null,
      notify: true,
    });
    await recordEvent({
      workerId,
      appId: entitlement.appId,
      appName: entitlement.appName,
      action: 'GRANT_REQUESTED',
      source: 'ONBOARDING',
      actorUserId,
      detail: `From profile "${entitlement.profile}"`,
    });
    created += 1;
  }
  return created;
}

/**
 * Raise the revoke tasks a leaver needs, from what they were actually granted
 * — not from what a profile says they should have had. Those two differ, and
 * the difference is exactly what gets left behind.
 */
export async function deprovisionForOffboarding(workerId: string, actorUserId?: string | null): Promise<number> {
  const [grants, worker] = await Promise.all([
    db.appAccessGrant.findMany({
      where: { workerId, revokedAt: null },
      include: { app: { select: { id: true, name: true } } },
    }),
    db.worker.findUnique({
      where: { id: workerId },
      select: { legalFirstName: true, preferredName: true, lastName: true },
    }),
  ]);
  if (!worker) return 0;
  const name = `${worker.preferredName || worker.legalFirstName} ${worker.lastName}`;

  let created = 0;
  for (const grant of grants) {
    const openTask = await db.task.findFirst({
      where: {
        workerId,
        sourceType: 'ACCESS_REVOKE',
        sourceId: grant.appId,
        status: { notIn: ['COMPLETED', 'CANCELED'] },
      },
      select: { id: true },
    });
    if (openTask) continue;

    await createTask({
      title: `Revoke ${grant.app.name} access for ${name}`,
      description: 'Access must be removed on or before the last working day.',
      category: 'IT_ACCESS',
      workerId,
      ownerRoleKey: 'IT_ADMIN',
      dueDate: new Date(),
      // Matches the offboarding template's rule: revoking a leaver's access is
      // the most time-critical thing on the checklist.
      priority: 'CRITICAL',
      sourceType: 'ACCESS_REVOKE',
      sourceId: grant.appId,
      createdById: actorUserId ?? null,
      notify: true,
    });
    await recordEvent({
      workerId,
      appId: grant.appId,
      appName: grant.app.name,
      action: 'REVOKE_REQUESTED',
      source: 'OFFBOARDING',
      actorUserId,
    });
    created += 1;
  }
  return created;
}

// ---------------------------------------------------------------------------
// The exception report — the reason the loop exists
// ---------------------------------------------------------------------------

export interface AccessException {
  kind: 'STILL_HAS_ACCESS_AFTER_LEAVING' | 'MISSING_ENTITLEMENT' | 'ACCESS_WITHOUT_PROFILE';
  workerId: string;
  workerName: string;
  appId: string | null;
  appName: string;
  detail: string;
  daysOutstanding: number | null;
}

/**
 * Where reality and the record disagree.
 *
 * The first kind is the one that matters and the one nobody discovers on
 * their own: a terminated worker whose access was never revoked. It is
 * ordered first and by age, because a 90-day-old one is a finding and a
 * one-day-old one is just Tuesday.
 */
export async function accessExceptions(): Promise<AccessException[]> {
  const exceptions: AccessException[] = [];
  const now = Date.now();

  const leavers = await db.worker.findMany({
    where: { status: 'TERMINATED', deletedAt: null, terminationDate: { not: null } },
    select: {
      id: true,
      legalFirstName: true,
      preferredName: true,
      lastName: true,
      terminationDate: true,
      appAccessGrants: {
        where: { revokedAt: null },
        include: { app: { select: { id: true, name: true } } },
      },
    },
  });
  for (const leaver of leavers) {
    const days = leaver.terminationDate
      ? Math.floor((now - leaver.terminationDate.getTime()) / 86_400_000)
      : null;
    for (const grant of leaver.appAccessGrants) {
      exceptions.push({
        kind: 'STILL_HAS_ACCESS_AFTER_LEAVING',
        workerId: leaver.id,
        workerName: `${leaver.preferredName || leaver.legalFirstName} ${leaver.lastName}`,
        appId: grant.appId,
        appName: grant.app.name,
        detail: `Left ${days ?? '?'} days ago and still has ${grant.accessLevel.toLowerCase()} access.`,
        daysOutstanding: days,
      });
    }
  }

  const active = await db.worker.findMany({
    where: { status: 'ACTIVE', deletedAt: null },
    select: {
      id: true,
      legalFirstName: true,
      preferredName: true,
      lastName: true,
      appAccessGrants: {
        where: { revokedAt: null },
        include: { app: { select: { id: true, name: true } } },
      },
    },
  });
  for (const worker of active) {
    const entitlements = await entitlementsFor(worker.id);
    const entitledIds = new Set(entitlements.map((e) => e.appId));
    const heldIds = new Set(worker.appAccessGrants.map((g) => g.appId));
    const name = `${worker.preferredName || worker.legalFirstName} ${worker.lastName}`;

    for (const entitlement of entitlements) {
      if (entitlement.required && !heldIds.has(entitlement.appId)) {
        exceptions.push({
          kind: 'MISSING_ENTITLEMENT',
          workerId: worker.id,
          workerName: name,
          appId: entitlement.appId,
          appName: entitlement.appName,
          detail: `Their "${entitlement.profile}" profile expects this and it has not been granted.`,
          daysOutstanding: null,
        });
      }
    }
    // Only reported for workers a profile actually covers; otherwise every
    // grant in a company with no profiles would look like an exception.
    if (entitlements.length > 0) {
      for (const grant of worker.appAccessGrants) {
        if (!entitledIds.has(grant.appId)) {
          exceptions.push({
            kind: 'ACCESS_WITHOUT_PROFILE',
            workerId: worker.id,
            workerName: name,
            appId: grant.appId,
            appName: grant.app.name,
            detail: 'Granted individually rather than by a profile. Confirm it is still needed.',
            daysOutstanding: null,
          });
        }
      }
    }
  }

  const order = { STILL_HAS_ACCESS_AFTER_LEAVING: 0, MISSING_ENTITLEMENT: 1, ACCESS_WITHOUT_PROFILE: 2 };
  return exceptions.sort(
    (a, b) => order[a.kind] - order[b.kind] || (b.daysOutstanding ?? 0) - (a.daysOutstanding ?? 0),
  );
}
