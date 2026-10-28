import { sql } from "kysely";
import type { Db } from "../db.js";
import type { PaymentLookup } from "./safepay.js";

export type FulfilResult = "paid" | "already_paid" | "pending" | "failed" | "unknown";

export interface PaymentVerifier {
  lookup(ref: string, expectedOrderId?: string): Promise<PaymentLookup>;
}

/**
 * Confirms a payment with the provider and, if it really is paid for the exact amount,
 * fulfils it (grants the plan's credits). Safe to call any number of times, from the
 * return page, the webhook and the reconciliation job concurrently.
 */
export async function verifyAndFulfil(db: Db, provider: PaymentVerifier, ref: string): Promise<FulfilResult> {
  const found = await sql<{ payment_id: string; status: string }>`
    select payment_id, status from app.payment_by_ref(${ref})`.execute(db);
  const row = found.rows[0];
  if (!row) return "unknown";
  if (row.status === "paid") return "already_paid";
  if (row.status === "refunded") return "failed";
  // "failed" and "expired" are still checked: a student can retry on the same checkout
  // and pay after all. app.fulfill_payment never fulfils an amount mismatch.

  const lookup = await provider.lookup(ref, row.payment_id);
  if (lookup.status === "pending") return "pending";
  if (lookup.status !== "paid") {
    await sql`select app.close_payment(${row.payment_id}::uuid, ${lookup.status === "expired" ? "expired" : "failed"}::app.payment_status, ${lookup.reason})`.execute(db);
    return "failed";
  }

  const res = await db.transaction().execute((trx) =>
    sql<{ ok: boolean }>`select app.fulfill_payment(${row.payment_id}::uuid, ${ref}, ${lookup.amountPaisa}, ${lookup.currency}) as ok`.execute(trx),
  );
  if (res.rows[0]?.ok) return "paid";
  const after = await sql<{ status: string }>`select status from app.payment_by_ref(${ref})`.execute(db);
  return after.rows[0]?.status === "paid" ? "already_paid" : "failed";
}
