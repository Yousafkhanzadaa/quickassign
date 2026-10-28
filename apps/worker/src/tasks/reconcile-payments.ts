import type { Task } from "graphile-worker";
import { verifyAndFulfil } from "@qa/core";
import { sql } from "kysely";
import type { Ctx } from "../context.js";

/**
 * Every few minutes, asks Safepay about checkouts that are still pending, and about ones
 * closed as failed/expired in the last day (a student can retry on the same checkout).
 * Catches payments whose webhook was lost and whose student never came back.
 */
export const reconcilePayments =
  (ctx: Ctx): Task =>
  async () => {
    const safepay = ctx.safepay;
    if (!safepay) return;
    const open = await sql<{ provider_ref: string; provider: string; created_at: Date }>`
      select provider_ref, provider, created_at from app.open_payments(100)`.execute(ctx.db);
    let paid = 0;
    for (const p of open.rows) {
      // Give the student a moment to finish paying before polling.
      if (p.provider !== "safepay" || Date.now() - p.created_at.getTime() < 2 * 60_000) continue;
      try {
        const r = await verifyAndFulfil(ctx.db, safepay, p.provider_ref);
        if (r === "paid") paid++;
      } catch (err) {
        ctx.log.warn({ err: (err as Error).message }, "payment reconciliation failed for one payment");
      }
    }
    if (open.rows.length > 0) ctx.log.info({ checked: open.rows.length, paid }, "payment reconciliation");
  };
