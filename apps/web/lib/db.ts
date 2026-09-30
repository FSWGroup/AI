import "server-only";
import { getSql, type Sql } from "@wpi/core";

/** Server-only database handle. DATABASE_URL is read by @wpi/core on the server and never reaches the client. */
export function db(): Sql {
  return getSql();
}

// postgres.js rows are loosely typed; pages narrow them where it matters.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
