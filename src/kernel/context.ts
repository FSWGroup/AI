/**
 * The ambient facts every write needs to record: who is acting, through what, and
 * why. Passed explicitly rather than held in async-local storage, so a reader can
 * see what a function depends on.
 */
import type { Uuid } from './id.js';

export type ActorType = 'USER' | 'SERVICE_ACCOUNT' | 'SYSTEM' | 'MIGRATION';

export type InterfaceKind = 'HTTP' | 'CONNECTOR' | 'JOB' | 'CLI' | 'MIGRATION' | 'TEST';

export interface Actor {
  readonly principalId: Uuid | undefined;
  readonly type: ActorType;
  /** Human-readable, for audit legibility. An email, a service account key, a job name. */
  readonly label: string;
}

export interface RequestContext {
  readonly actor: Actor;
  readonly interface: InterfaceKind;
  readonly correlationId: Uuid;
  readonly causationId: Uuid | undefined;
  /** Scope the actor is acting within. Null means group-wide. */
  readonly operatingCompany: string | undefined;
  readonly clientIp: string | undefined;
  readonly userAgent: string | undefined;
  /** Free-text justification, required for merges, unmerges, overrides and erasure. */
  readonly reason: string | undefined;
  /** For connector writes: the source record that carried the change (spec §13). */
  readonly sourceRecordId: Uuid | undefined;
  /** What caused this: 'http', 'connector:p21', 'job:reconcile'. */
  readonly source: string;
}

export interface ContextOverrides {
  actor?: Actor;
  interface?: InterfaceKind;
  correlationId?: Uuid;
  causationId?: Uuid;
  operatingCompany?: string;
  clientIp?: string;
  userAgent?: string;
  reason?: string;
  sourceRecordId?: Uuid;
  source?: string;
}

export const SYSTEM_ACTOR: Actor = {
  principalId: undefined,
  type: 'SYSTEM',
  label: 'system',
};

export function createContext(
  correlationId: Uuid,
  overrides: ContextOverrides = {},
): RequestContext {
  return {
    actor: overrides.actor ?? SYSTEM_ACTOR,
    interface: overrides.interface ?? 'JOB',
    correlationId: overrides.correlationId ?? correlationId,
    causationId: overrides.causationId,
    operatingCompany: overrides.operatingCompany,
    clientIp: overrides.clientIp,
    userAgent: overrides.userAgent,
    reason: overrides.reason,
    sourceRecordId: overrides.sourceRecordId,
    source: overrides.source ?? 'system',
  };
}

/**
 * Derive a child context for work caused by this one. The correlation ID is carried
 * forward; the causation ID points at what triggered the child.
 */
export function deriveContext(
  parent: RequestContext,
  causationId: Uuid,
  overrides: ContextOverrides = {},
): RequestContext {
  return { ...parent, ...overrides, causationId };
}
