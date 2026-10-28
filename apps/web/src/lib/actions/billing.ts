"use server";
import { withTenant } from "@qa/core";
import { sql } from "kysely";
import { z } from "zod";
import { mockAllowed, paymentsProvider, safepay } from "../billing";
import { env } from "../env";
import { db } from "../server";
import { requireProfile } from "../session";

export interface CheckoutResult {
  url?: string;
  error?: string;
}

const PlanId = z.string().regex(/^[a-z][a-z0-9_]{1,30}$/);

/** Opens a checkout for a plan. The amount always comes from app.plans, never the client. */
export async function startCheckout(planId: string): Promise<CheckoutResult> {
  const { user } = await requireProfile();
  if (!PlanId.safeParse(planId).success) return { error: "Unknown plan." };
  const provider = paymentsProvider();
  if (provider === "disabled") return { error: "Payments aren't available yet. Please check back soon." };

  let order: { payment_id: string; amount_paisa: number } | undefined;
  try {
    order = await withTenant(db(), user.id, async (trx) => {
      const r = await sql<{ payment_id: string; amount_paisa: number }>`
        select payment_id, amount_paisa from app.start_checkout(${planId}, ${provider})`.execute(trx);
      return r.rows[0];
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("too many")) return { error: "Too many checkout attempts. Please wait a while and try again." };
    if (msg.includes("unknown plan")) return { error: "Unknown plan." };
    return { error: "Couldn't start checkout." };
  }
  if (!order) return { error: "Couldn't start checkout." };

  if (provider === "mock") return { url: `/billing/mock?payment=${order.payment_id}` };

  const base = env().APP_BASE_URL;
  try {
    const checkout = await safepay().createCheckout({
      amountPaisa: order.amount_paisa,
      orderId: order.payment_id,
      // The id goes in the path: Safepay appends "?tracker=…" to this URL.
      redirectUrl: `${base}/billing/return/${order.payment_id}`,
      cancelUrl: `${base}/billing?canceled=1`,
    });
    await withTenant(db(), user.id, (trx) => sql`select app.attach_payment_ref(${order!.payment_id}::uuid, ${checkout.tracker})`.execute(trx));
    return { url: checkout.url };
  } catch (err) {
    console.error("checkout failed:", (err as Error).name, (err as { detail?: string }).detail ?? "");
    return { error: "Couldn't reach the payment gateway. Please try again in a minute." };
  }
}

/** Local testing only: completes a mock checkout as if the gateway confirmed it. */
export async function completeMockPayment(paymentId: string): Promise<{ ok: boolean; error?: string }> {
  if (!mockAllowed()) return { ok: false, error: "Mock payments are disabled." };
  const { user } = await requireProfile();
  if (!z.string().uuid().safeParse(paymentId).success) return { ok: false, error: "Invalid payment." };
  const ref = `mock_${paymentId}`;
  try {
    const row = await withTenant(db(), user.id, async (trx) => {
      const p = await trx.selectFrom("app.payments").select(["amount_paisa", "currency", "status", "provider"]).where("id", "=", paymentId).executeTakeFirst();
      if (!p || p.provider !== "mock") return null;
      if (p.status === "created") await sql`select app.attach_payment_ref(${paymentId}::uuid, ${ref})`.execute(trx);
      return p;
    });
    if (!row) return { ok: false, error: "Payment not found." };
    await db()
      .transaction()
      .execute((trx) => sql`select app.fulfill_payment(${paymentId}::uuid, ${ref}, ${row.amount_paisa}, ${row.currency})`.execute(trx));
  } catch {
    return { ok: false, error: "Couldn't complete the test payment. Start a new checkout." };
  }
  return { ok: true };
}
