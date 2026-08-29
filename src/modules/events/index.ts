/**
 * Events module public surface (ADR-0003). Nothing outside this module imports a
 * deeper path.
 */
export {
  defineEvent,
  registeredEvents,
  findEvent,
  clearEventRegistry,
} from './definition.js';
export type { EventDefinition, EventDefinitionInput } from './definition.js';
export { syncEventRegistry } from './registry-sync.js';
export type { RegistrySyncResult } from './registry-sync.js';
export { readEvents, latestSequence, matchesAny, globToLike } from './feed.js';
export type { LedgerEvent, ReadOptions } from './feed.js';
export { runProjection, replayProjection } from './projection.js';
export type { Projection, RunResult } from './projection.js';
