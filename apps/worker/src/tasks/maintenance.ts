import type { Task } from "graphile-worker";
import { sql } from "kysely";
import { withTenant } from "@qa/core";
import { z } from "zod";
import type { Ctx } from "../context.js";
import { reminderNotice } from "../notify.js";
import { notify, parsePayload } from "../util.js";

const ReminderPayload = z.object({ user_id: z.string(), task_id: z.string().uuid(), label: z.string(), deadline: z.string() });

export const sendReminder =
  (ctx: Ctx): Task =>
  async (payload) => {
    const p = parsePayload(ReminderPayload, payload);
    const msg = await withTenant(ctx.db, p.user_id, async (trx) => {
      const t = await trx
        .selectFrom("app.tasks")
        .select(["id", "short_no", "title", "kind", "status", "deadline_at"])
        .where("id", "=", p.task_id)
        .executeTakeFirst();
      // Skip if the task was skipped or its deadline moved (a newer reminder exists).
      if (!t || t.status === "skipped" || !t.deadline_at || t.deadline_at.toISOString() !== p.deadline) return null;
      const profile = await trx.selectFrom("app.profiles").select("timezone").where("user_id", "=", p.user_id).executeTakeFirst();
      return reminderNotice({ shortNo: t.short_no, title: t.title, kind: t.kind, deadline: t.deadline_at }, profile?.timezone ?? "Asia/Karachi", p.label);
    });
    if (msg) await notify(ctx, p.user_id, msg, "reminder", p.task_id);
  };

/** Hourly retention purge (runs through a SECURITY DEFINER function owned by qa_maint). */
export const purgeExpired =
  (ctx: Ctx): Task =>
  async () => {
    const r = await sql<{ result: Record<string, number> }>`select app.purge_expired() as result`.execute(ctx.db);
    ctx.log.info({ purged: r.rows[0]?.result }, "retention purge");
  };

// Delete order respects foreign keys; the tenant key goes last (crypto-shredding anything
// that might survive in backups). Payments, the credit ledger and audit rows are
// pseudonymous financial/security records and are retained.
const TENANT_TABLES = [
  "app.material_chunks",
  "app.materials",
  "app.attachments",
  "app.task_files",
  "app.solutions",
  "app.outbound_messages",
  "app.tasks",
  "app.blobs",
  "app.inbound_messages",
  "app.self_commands",
  "app.group_senders",
  "app.wa_groups",
  "app.courses",
  "app.usage_events",
  "app.credit_grants",
  "app.user_counters",
  "app.wa_links",
  "app.profiles",
  "app.tenant_keys",
] as const;

export const purgeAccount =
  (ctx: Ctx): Task =>
  async (payload) => {
    const { user_id } = parsePayload(z.object({ user_id: z.string() }), payload);
    await withTenant(ctx.db, user_id, async (trx) => {
      for (const table of TENANT_TABLES) {
        await trx.deleteFrom(table).where("user_id", "=", user_id).execute();
      }
      await trx.insertInto("app.audit_log").values({ user_id, actor: "worker", action: "account_purged", details: "{}" }).execute();
    });
    ctx.keys.forget(user_id);
    // Finally delete the account itself, which also ends its sessions. Tenants from before
    // local accounts (migration 0007) have non-UUID ids and no account to delete.
    if (/^[0-9a-f-]{36}$/i.test(user_id)) {
      await sql`select qa_auth.delete_user(${user_id}::uuid)`.execute(ctx.db);
    }
    ctx.log.info({ tenant: user_id.slice(0, 8) }, "account purged");
  };
