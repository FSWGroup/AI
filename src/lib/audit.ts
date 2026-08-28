import 'server-only';
import { db } from '@/lib/db';
import { requestMeta } from '@/lib/auth/session';
import type { Ctx } from '@/lib/authz';

import type { Prisma } from '@/generated/prisma/client';

type Jsonish = Prisma.InputJsonValue | null | undefined;

/**
 * Append an audit event. Audit rows are append-only at the database level
 * (see the audit_immutability migration). Never place decrypted PII in
 * before/after payloads — pass masked values.
 */
export async function audit(
  ctx: Ctx | null,
  action: string,
  opts: {
    targetType?: string;
    targetId?: string;
    before?: Jsonish;
    after?: Jsonish;
    metadata?: Jsonish;
  } = {},
) {
  const meta = await requestMeta().catch(() => ({ ip: null, userAgent: null }));
  await db.auditEvent.create({
    data: {
      actorUserId: ctx?.userId ?? null,
      actorEmail: ctx?.email ?? null,
      action,
      targetType: opts.targetType ?? null,
      targetId: opts.targetId ?? null,
      before: opts.before ?? undefined,
      after: opts.after ?? undefined,
      metadata: opts.metadata ?? undefined,
      ip: meta.ip,
      sessionId: ctx?.sessionId ?? null,
    },
  });
}

/** For unauthenticated events (login failures etc.). */
export async function auditAnonymous(action: string, opts: { email?: string; metadata?: Jsonish } = {}) {
  const meta = await requestMeta().catch(() => ({ ip: null, userAgent: null }));
  await db.auditEvent.create({
    data: {
      action,
      actorEmail: opts.email ?? null,
      metadata: opts.metadata ?? undefined,
      ip: meta.ip,
    },
  });
}
