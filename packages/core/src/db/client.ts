import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

let _sql: Sql | null = null;

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/wpi";
}

export function getSql(): Sql {
  if (!_sql) {
    _sql = postgres(databaseUrl(), {
      max: 8,
      transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } },  // column names only; JSON payloads untouched
      onnotice: () => {},
    });
  }
  return _sql;
}

export async function closeSql(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = null;
  }
}
