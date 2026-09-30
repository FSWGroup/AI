import { fileURLToPath } from "node:url";
import { getSql, closeSql } from "./client.ts";

export async function resetDatabase(): Promise<void> {
  const sql = getSql();
  await sql.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  resetDatabase()
    .then(() => {
      console.log("Database reset (schema public dropped and recreated)");
      return closeSql();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
