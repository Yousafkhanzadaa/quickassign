// Applies db/migrations/*.sql in order, once each, inside a transaction per file.
// Runs as the schema owner (qa_owner); never with application credentials.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

export async function migrate(connectionString: string, dir: string, log: (msg: string) => void = console.log): Promise<string[]> {
  const client = new pg.Client({ connectionString, application_name: "qa-migrate" });
  await client.connect();
  const applied: string[] = [];
  try {
    // Serialize concurrent migrators.
    await client.query("SELECT pg_advisory_lock(hashtext('qa-migrations'))");
    // Bookkeeping lives in a private schema, never in "public" (QuickAssign keeps nothing
    // there; hosted Postgres services can expose it through an API).
    await client.query("CREATE SCHEMA IF NOT EXISTS qa_meta");
    await client.query("REVOKE ALL ON SCHEMA qa_meta FROM PUBLIC");
    await client.query(`CREATE TABLE IF NOT EXISTS qa_meta.schema_migrations (
      version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query<{ version: string }>("SELECT version FROM qa_meta.schema_migrations")).rows.map((r) => r.version));
    const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sqlText = await readFile(path.join(dir, file), "utf8");
      log(`applying ${file}`);
      await client.query("BEGIN");
      try {
        await client.query(sqlText);
        await client.query("INSERT INTO qa_meta.schema_migrations (version) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('qa-migrations'))").catch(() => undefined);
    await client.end();
  }
  return applied;
}
