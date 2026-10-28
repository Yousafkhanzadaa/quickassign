import { ContentKeys, createDb, createPool, GatewayClient, Kek, Safepay, SandboxClient, withTenant, type Db } from "@qa/core";
import { pino, type Logger } from "pino";
import type { Config } from "./config.js";
import { Llm } from "./llm/openai.js";

export interface Ctx {
  cfg: Config;
  log: Logger;
  db: Db;
  keys: ContentKeys;
  gateway: GatewayClient;
  sandbox: SandboxClient;
  llm: Llm;
  /** Present only when Safepay credentials are configured. */
  safepay: Safepay | null;
  close(): Promise<void>;
}

export function createContext(cfg: Config): Ctx {
  const log = pino({
    level: cfg.LOG_LEVEL,
    // Defence in depth: never log secrets or content even if a caller passes them.
    redact: { paths: ["*.text", "*.body", "*.markdown", "*.data", "*.apiKey", "*.token", "*.secret"], censor: "[redacted]" },
  });
  const pool = createPool(cfg.WORKER_DATABASE_URL, "qa-worker", cfg.DB_POOL_MAX);
  const db = createDb(pool);
  const kek = Kek.parse(cfg.APP_KEK_ID, cfg.APP_KEK);
  const llm = new Llm(cfg.OPENAI_API_KEY, kek.deriveSubkey("qa/v1/openai-safety-id"), async (u) => {
    await withTenant(db, u.userId, (trx) =>
      trx
        .insertInto("app.usage_events")
        .values({
          user_id: u.userId,
          kind: u.kind,
          model: u.model,
          input_tokens: u.inputTokens,
          cached_input_tokens: u.cachedInputTokens,
          output_tokens: u.outputTokens,
          cost_usd: u.costUsd.toFixed(6),
        })
        .execute(),
    ).catch((err: unknown) => log.warn({ err: (err as Error).message }, "usage record failed"));
  });
  return {
    cfg,
    log,
    db,
    keys: new ContentKeys(kek),
    gateway: new GatewayClient(cfg.GATEWAY_URL, "worker", cfg.GATEWAY_SECRET_WORKER),
    sandbox: new SandboxClient(cfg.SANDBOX_URL, cfg.SANDBOX_TOKEN),
    llm,
    safepay:
      cfg.SAFEPAY_API_KEY && cfg.SAFEPAY_SECRET_KEY
        ? new Safepay({ env: cfg.SAFEPAY_ENV, apiKey: cfg.SAFEPAY_API_KEY, secretKey: cfg.SAFEPAY_SECRET_KEY })
        : null,
    close: async () => {
      await db.destroy();
    },
  };
}
