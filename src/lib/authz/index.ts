import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth/session';
import type { Permission } from './catalog';

export type { Permission } from './catalog';

export class AuthzError extends Error {
  constructor(message = 'You do not have permission to do that.') {
    super(message);
    this.name = 'AuthzError';
  }
}

export interface Ctx {
  userId: string;
  email: string;
  sessionId: string;
  workerId: string | null;
  roleKeys: string[];
  permissions: Set<string>;
  /** Scope narrowing per permission (legalEntityIds/departmentIds/countries), empty = unrestricted */
  scopes: Record<string, { legalEntityIds?: string[]; departmentIds?: string[]; countries?: string[] }>;
}

/** Build the request auth context. Null when not signed in / MFA pending. */
export const getCtx = cache(async (): Promise<Ctx | null> => {
  const session = await getSession();
  if (!session) return null;
  if (session.user.mfaEnabled && !session.mfaPassed) return null;
  const permissions = new Set<string>();
  const scopes: Ctx['scopes'] = {};
  for (const ur of session.user.roles) {
    for (const rp of ur.role.permissions) {
      permissions.add(rp.permission);
      const scope = rp.scope as Ctx['scopes'][string];
      if (scope && Object.keys(scope).length > 0) scopes[rp.permission] = scope;
      else delete scopes[rp.permission]; // any unscoped grant wins
    }
  }
  return {
    userId: session.user.id,
    email: session.user.email,
    sessionId: session.id,
    workerId: session.user.worker?.id ?? null,
    roleKeys: session.user.roles.map((r) => r.role.key),
    permissions,
    scopes,
  };
});

export function can(ctx: Ctx, permission: Permission): boolean {
  return ctx.permissions.has(permission);
}

/** For pages: redirect unauthenticated users to login. */
export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect('/login');
  return ctx;
}

/** For server actions: throw a typed error instead of redirecting. */
export async function requireCtxAction(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) throw new AuthzError('Your session has expired. Please sign in again.');
  return ctx;
}

export function assertPermission(ctx: Ctx, permission: Permission): void {
  if (!can(ctx, permission)) throw new AuthzError();
}

export async function requirePermission(permission: Permission): Promise<Ctx> {
  const ctx = await requireCtxAction();
  assertPermission(ctx, permission);
  return ctx;
}

// ---------------------------------------------------------------------------
// Manager hierarchy
// ---------------------------------------------------------------------------

/** Direct report worker ids for a manager (current employment records only). */
export async function directReportIds(managerWorkerId: string): Promise<string[]> {
  const rows = await db.employmentRecord.findMany({
    where: {
      effectiveTo: null,
      OR: [{ managerId: managerWorkerId }, { secondaryManagerId: managerWorkerId }],
      worker: { status: { notIn: ['TERMINATED'] }, deletedAt: null },
    },
    select: { workerId: true },
  });
  return [...new Set(rows.map((r) => r.workerId))];
}

/** Direct + indirect report ids (BFS over current employment records). */
export async function allReportIds(managerWorkerId: string): Promise<string[]> {
  const seen = new Set<string>();
  let frontier = [managerWorkerId];
  for (let depth = 0; depth < 12 && frontier.length > 0; depth++) {
    const rows = await db.employmentRecord.findMany({
      where: {
        effectiveTo: null,
        OR: [{ managerId: { in: frontier } }, { secondaryManagerId: { in: frontier } }],
        worker: { status: { notIn: ['TERMINATED'] }, deletedAt: null },
      },
      select: { workerId: true },
    });
    frontier = rows.map((r) => r.workerId).filter((id) => !seen.has(id));
    frontier.forEach((id) => seen.add(id));
  }
  seen.delete(managerWorkerId);
  return [...seen];
}

export async function isManagerOf(ctx: Ctx, workerId: string): Promise<boolean> {
  if (!ctx.workerId) return false;
  const reports = await allReportIds(ctx.workerId);
  return reports.includes(workerId);
}

// ---------------------------------------------------------------------------
// Worker-level visibility
// ---------------------------------------------------------------------------

export interface WorkerAccess {
  /** Can see the worker exists + basic directory card */
  directory: boolean;
  self: boolean;
  manager: boolean;
  /** Full HR profile access */
  hr: boolean;
  /** Restricted personal fields (DOB, home address, personal email) */
  pii: boolean;
  /** Compensation visibility */
  comp: boolean;
}

export async function workerAccess(ctx: Ctx, workerId: string): Promise<WorkerAccess> {
  const self = ctx.workerId === workerId;
  const hr = can(ctx, 'people.read_all');
  const manager = self ? false : await isManagerOf(ctx, workerId);
  return {
    directory: can(ctx, 'people.read') || self,
    self,
    manager,
    hr,
    pii: self || can(ctx, 'pii.view'),
    comp: self || can(ctx, 'comp.read'),
  };
}

/** Guard: the viewer must at least be self / manager / HR to open a full profile. */
export async function assertProfileAccess(ctx: Ctx, workerId: string): Promise<WorkerAccess> {
  const access = await workerAccess(ctx, workerId);
  if (!access.self && !access.manager && !access.hr && !access.directory) {
    throw new AuthzError('You do not have access to this profile.');
  }
  return access;
}

/**
 * Apply permission scope narrowing (legal entity / department / country)
 * for list queries. Returns a Prisma where-fragment for Worker.
 */
export function scopedWorkerFilter(ctx: Ctx, permission: Permission): Record<string, unknown> {
  const scope = ctx.scopes[permission];
  if (!scope) return {};
  const and: Record<string, unknown>[] = [];
  if (scope.countries?.length) and.push({ country: { in: scope.countries } });
  if (scope.legalEntityIds?.length || scope.departmentIds?.length) {
    and.push({
      employments: {
        some: {
          effectiveTo: null,
          ...(scope.legalEntityIds?.length ? { legalEntityId: { in: scope.legalEntityIds } } : {}),
          ...(scope.departmentIds?.length ? { departmentId: { in: scope.departmentIds } } : {}),
        },
      },
    });
  }
  return and.length ? { AND: and } : {};
}
