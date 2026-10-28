import { z } from "zod";

const Effort = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

const Env = z.object({
  WORKER_DATABASE_URL: z.string().min(1),
  QUEUE_DATABASE_URL: z.string().min(1),
  APP_KEK: z.string().min(40),
  APP_KEK_ID: z.string().default("app-local-v1"),
  GATEWAY_URL: z.string().url(),
  GATEWAY_SECRET_WORKER: z.string().min(32),
  SANDBOX_URL: z.string().url(),
  SANDBOX_TOKEN: z.string().min(32),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),

  // OpenAI. Without a key, detection and solving fail cleanly and tasks are marked failed.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_DETECT_MODEL: z.string().default("gpt-6-luna"),
  OPENAI_DETECT_EFFORT: Effort.default("low"),
  OPENAI_SOLVE_MODEL: z.string().default("gpt-6.1-sol"),
  OPENAI_SOLVE_EFFORT: Effort.default("high"),
  OPENAI_REPAIR_MODEL: z.string().default("gpt-6-luna"),
  OPENAI_EMBED_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_SOLVE_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(4000).max(128000).default(32000),

  // Safepay (payments). Optional: without it, payment reconciliation is skipped.
  SAFEPAY_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  SAFEPAY_API_KEY: z.string().optional(),
  SAFEPAY_SECRET_KEY: z.string().optional(),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  // Connection pool sizes (lower them if the database limits connections).
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  QUEUE_POOL_MAX: z.coerce.number().int().min(2).max(50).default(10),
  CLASSIFY_DEBOUNCE_SECONDS: z.coerce.number().int().min(10).max(600).default(90),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    // Report variable names only, never values.
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`invalid worker configuration: ${names}`);
  }
  return parsed.data;
}
