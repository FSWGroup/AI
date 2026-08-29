/**
 * Every event the system publishes, in one place (ADR-0009).
 *
 * The registry is synchronised from this list at startup and in tests. A module whose
 * events are not listed here still works, which is exactly the failure worth
 * preventing: its schemas would never be registered, and a consumer would discover an
 * unknown event type in production rather than in review. Adding a module means adding
 * a line here.
 */
import { pimEvents } from './modules/pim/index.js';
import { ingestEvents } from './modules/ingest/index.js';
import { partyEvents } from './modules/party/index.js';

export const ALL_EVENTS = [...pimEvents, ...ingestEvents, ...partyEvents];
