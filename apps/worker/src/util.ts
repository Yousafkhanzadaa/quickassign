import { sql } from "kysely";
import type { JobHelpers } from "graphile-worker";
import { withTenant, type Tx } from "@qa/core";
import type { z } from "zod";
import type { Ctx } from "./context.js";

export function parsePayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  const r = schema.safeParse(payload);
  if (!r.success) throw new Error("invalid job payload");
  return r.data;
}

export async function nextTaskNo(trx: Tx, userId: string): Promise<number> {
  const r = await sql<{ task_seq: number }>`
    insert into app.user_counters (user_id, task_seq) values (${userId}, 1)
    on conflict (user_id) do update set task_seq = app.user_counters.task_seq + 1
    returning task_seq`.execute(trx);
  return r.rows[0]!.task_seq;
}

/**
 * Sends a text to the student's own chat and remembers the message id so replies to it
 * can be matched to the task. Delivery failures are logged, not thrown: the dashboard
 * still shows everything.
 */
export async function notify(ctx: Ctx, userId: string, text: string, kind: string, taskId: string | null): Promise<boolean> {
  try {
    const waId = await ctx.gateway.sendText(userId, text);
    await withTenant(ctx.db, userId, (trx) =>
      trx
        .insertInto("app.outbound_messages")
        .values({ user_id: userId, wa_message_id: waId, kind, task_id: taskId })
        .onConflict((oc) => oc.columns(["user_id", "wa_message_id"]).doNothing())
        .execute(),
    );
    return true;
  } catch (err) {
    ctx.log.warn({ tenant: userId.slice(0, 8), kind, err: (err as Error).message }, "notify failed");
    return false;
  }
}

export async function scheduleReminders(helpers: JobHelpers, userId: string, taskId: string, deadline: Date): Promise<void> {
  const plan: Array<[string, number]> = [
    ["24 hours", 24 * 3600_000],
    ["3 hours", 3 * 3600_000],
  ];
  for (const [label, before] of plan) {
    const runAt = new Date(deadline.getTime() - before);
    if (runAt.getTime() < Date.now() + 60_000) continue;
    await helpers.addJob(
      "send_reminder",
      { user_id: userId, task_id: taskId, label, deadline: deadline.toISOString() },
      { runAt, jobKey: `reminder:${taskId}:${label}`, jobKeyMode: "replace", maxAttempts: 3 },
    );
  }
}

export function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}
