/** Deterministic contexts and dependencies for tests (ADR-0029). */
import { FixedClock } from '../../src/kernel/clock.js';
import { createIdGenerator, type Uuid } from '../../src/kernel/id.js';
import type { RequestContext, Actor } from '../../src/kernel/context.js';
import type { UnitOfWorkDeps } from '../../src/kernel/unit-of-work.js';

export const TEST_ACTOR: Actor = {
  principalId: '01920000-0000-7000-8000-000000000001' as Uuid,
  type: 'USER',
  label: 'test.user@fsw.group',
};

export function testDeps(
  clock = new FixedClock(),
): UnitOfWorkDeps & { clock: FixedClock } {
  return { clock, ids: createIdGenerator(clock) };
}

export function testContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    actor: TEST_ACTOR,
    interface: 'TEST',
    correlationId: '01920000-0000-7000-8000-0000000000c1' as Uuid,
    causationId: undefined,
    operatingCompany: 'FSW_GROUP',
    clientIp: undefined,
    userAgent: undefined,
    reason: undefined,
    sourceRecordId: undefined,
    source: 'test',
    ...overrides,
  };
}
