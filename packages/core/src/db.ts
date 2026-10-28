import pg from "pg";
import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import type { DB } from "./schema.js";

export type Db = Kysely<DB>;
export type Tx = Transaction<DB>;

// Tenant IDs are account ids (UUIDs; older databases may hold other URL-safe strings).
const TENANT_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function assertTenantId(userId: string): void {
  if (!TENANT_ID.test(userId)) throw new Error("invalid tenant id");
}

export function createPool(connectionString: string, applicationName: string, max = 10): pg.Pool {
  return new pg.Pool({
    connectionString,
    max,
    application_name: applicationName,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function createDb(pool: pg.Pool): Db {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

/**
 * Runs fn in a transaction scoped to one tenant. Row-level security (FORCE'd on every
 * table) then hides and blocks every row that belongs to anyone else, even if a query
 * forgets its WHERE clause.
 */
export async function withTenant<T>(db: Db, userId: string, fn: (trx: Tx) => Promise<T>): Promise<T> {
  assertTenantId(userId);
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.user_id', ${userId}, true)`.execute(trx);
    return fn(trx);
  });
}

/** pgvector literal for an embedding. */
export function toVector(values: number[]): string {
  if (!values.every((v) => Number.isFinite(v))) throw new Error("embedding contains non-finite values");
  return `[${values.join(",")}]`;
}
