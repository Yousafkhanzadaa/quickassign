import "server-only";
import { z } from "zod";

// Docker Compose passes unset optional variables as "", so treat empty as missing.
const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const Env = z.object({
  WEB_DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  APP_KEK: z.string().min(40),
  APP_KEK_ID: z.string().default("app-local-v1"),
  GATEWAY_URL: z.string().url(),
  GATEWAY_SECRET_WEB: z.string().min(32),
  APP_BASE_URL: z.string().url(),
  FREE_SIGNUP_CREDITS: z.coerce.number().int().min(0).max(20).default(5),

  // Payments. "mock" works only when APP_BASE_URL is localhost (local testing).
  PAYMENTS_PROVIDER: z.enum(["safepay", "mock", "disabled"]).default("disabled"),
  SAFEPAY_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  SAFEPAY_API_KEY: optional(z.string()),
  SAFEPAY_SECRET_KEY: optional(z.string()),
  SAFEPAY_WEBHOOK_SECRET: optional(z.string()),

  // Public site details (legal pages, footer).
  LEGAL_NAME: z.string().max(120).default("QuickAssign"),
  CONTACT_EMAIL: optional(z.string().email()),
  CONTACT_ADDRESS: optional(z.string().max(300)),
  REPO_URL: optional(z.string().url().startsWith("https://")),
});

export type WebEnv = z.infer<typeof Env>;

let cached: WebEnv | undefined;

export function env(): WebEnv {
  if (cached) return cached;
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    // Names only, never values. Most often the web app was started on its own: it needs the
    // database and the other services, which ./scripts/start.sh runs together.
    throw new Error(
      `invalid web configuration: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}. ` +
        "Start QuickAssign with ./scripts/start.sh from the repository root (see docs/getting-started.md).",
    );
  }
  cached = parsed.data;
  return cached;
}
