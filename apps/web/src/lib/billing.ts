import "server-only";
import { Safepay, type Tx } from "@qa/core";
import { sql } from "kysely";
import { env } from "./env";

export type PaymentsProvider = "safepay" | "mock" | "disabled";

/** The mock provider grants plans without payment, so it only ever works on localhost. */
export function mockAllowed(): boolean {
  const e = env();
  if (e.PAYMENTS_PROVIDER !== "mock") return false;
  const host = new URL(e.APP_BASE_URL).hostname;
  return host === "localhost" || host === "127.0.0.1";
}

export function paymentsProvider(): PaymentsProvider {
  const e = env();
  if (e.PAYMENTS_PROVIDER === "mock") return mockAllowed() ? "mock" : "disabled";
  if (e.PAYMENTS_PROVIDER === "safepay" && e.SAFEPAY_API_KEY && e.SAFEPAY_SECRET_KEY) return "safepay";
  return "disabled";
}

const g = globalThis as unknown as { __qaSafepay?: Safepay };

export function safepay(): Safepay {
  const e = env();
  if (!e.SAFEPAY_API_KEY || !e.SAFEPAY_SECRET_KEY) throw new Error("Safepay is not configured");
  g.__qaSafepay ??= new Safepay({
    env: e.SAFEPAY_ENV,
    apiKey: e.SAFEPAY_API_KEY,
    secretKey: e.SAFEPAY_SECRET_KEY,
    webhookSecret: e.SAFEPAY_WEBHOOK_SECRET,
  });
  return g.__qaSafepay;
}

/** Credits the student can still use (active, unexpired grants). Tenant-scoped by RLS. */
export async function creditBalance(trx: Tx): Promise<number> {
  const r = await sql<{ b: number }>`select app.credit_balance() as b`.execute(trx);
  return Number(r.rows[0]?.b ?? 0);
}

export function formatPkr(paisa: number): string {
  return `PKR ${new Intl.NumberFormat("en-PK").format(Math.round(paisa / 100))}`;
}

/** Short reference students quote to support (first 8 hex digits of the payment id). */
export function paymentRef(paymentId: string): string {
  return paymentId.replace(/-/g, "").slice(0, 8).toUpperCase();
}
