import "server-only";
import { ContentKeys, createDb, createPool, GatewayClient, Kek, type Db } from "@qa/core";
import type pg from "pg";
import { env } from "./env";

// Singletons survive dev hot-reloads via globalThis.
const g = globalThis as unknown as {
  __qaPool?: pg.Pool;
  __qaDb?: Db;
  __qaKeys?: ContentKeys;
  __qaGateway?: GatewayClient;
};

export function pool(): pg.Pool {
  g.__qaPool ??= createPool(env().WEB_DATABASE_URL, "qa-web", env().DB_POOL_MAX);
  return g.__qaPool;
}

export function db(): Db {
  g.__qaDb ??= createDb(pool());
  return g.__qaDb;
}

export function keys(): ContentKeys {
  g.__qaKeys ??= new ContentKeys(Kek.parse(env().APP_KEK_ID, env().APP_KEK));
  return g.__qaKeys;
}

export function gateway(): GatewayClient {
  g.__qaGateway ??= new GatewayClient(env().GATEWAY_URL, "web", env().GATEWAY_SECRET_WEB);
  return g.__qaGateway;
}
