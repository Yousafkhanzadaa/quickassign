import type { Task } from "graphile-worker";
import { sql } from "kysely";
import { audit, openText, withTenant } from "@qa/core";
import { z } from "zod";
import { parseCommand } from "../commands.js";
import type { Ctx } from "../context.js";
import { helpText, statusText } from "../notify.js";
import { notify, parsePayload } from "../util.js";

const Payload = z.object({ user_id: z.string(), command_id: z.string().uuid() });

/** Handles a command the student typed in their own chat (reply to a notice, or "qa ..."). */
export const selfCommand =
  (ctx: Ctx): Task =>
  async (payload) => {
    const { user_id, command_id } = parsePayload(Payload, payload);
    const appUrl = ctx.cfg.APP_BASE_URL;

    const outcome = await withTenant(ctx.db, user_id, async (trx) => {
      const cmd = await trx.selectFrom("app.self_commands").selectAll().where("id", "=", command_id).executeTakeFirst();
      if (!cmd || cmd.processed_at) return null;
      await trx.updateTable("app.self_commands").set({ processed_at: new Date() }).where("id", "=", command_id).execute();

      const key = await ctx.keys.get(trx, user_id);
      const text = openText(key, cmd.text_enc, "cmd.text", user_id, cmd.id) ?? "";
      // Purge the command text as soon as it has been read.
      await trx.updateTable("app.self_commands").set({ text_enc: Buffer.alloc(0) }).where("id", "=", command_id).execute();

      let quotedTaskId: string | null = null;
      let quotedOurs = false;
      if (cmd.quoted_wa_message_id) {
        const ob = await trx
          .selectFrom("app.outbound_messages")
          .select(["task_id"])
          .where("wa_message_id", "=", cmd.quoted_wa_message_id)
          .executeTakeFirst();
        quotedOurs = !!ob;
        quotedTaskId = ob?.task_id ?? null;
      }
      const prefixed = /^\s*\/?qa\b/i.test(text);
      // A reply to someone else's message (not ours) without the prefix is just a note.
      if (!prefixed && !quotedOurs) return null;

      const command = parseCommand(text);
      const profile = await trx.selectFrom("app.profiles").select(["timezone"]).where("user_id", "=", user_id).executeTakeFirst();
      const tz = profile?.timezone ?? "Asia/Karachi";

      const resolveTask = async (taskNo?: number) => {
        if (taskNo !== undefined) {
          return trx.selectFrom("app.tasks").select(["id", "short_no", "kind", "status"]).where("short_no", "=", taskNo).executeTakeFirst();
        }
        if (quotedTaskId) {
          return trx.selectFrom("app.tasks").select(["id", "short_no", "kind", "status"]).where("id", "=", quotedTaskId).executeTakeFirst();
        }
        return undefined;
      };

      switch (command.type) {
        case "solve": {
          const task = await resolveTask(command.taskNo);
          if (!task) return { reply: "Which task? Reply *solve* to an assignment notice, or send *qa solve 12*." };
          if (task.kind === "quiz" || task.kind === "exam" || task.kind === "announcement")
            return { reply: `#${task.short_no} is a quiz/exam reminder; those are never solved.` };
          if (task.status === "queued" || task.status === "solving") return { reply: `#${task.short_no} is already being prepared. ⏳` };
          await sql`select app.enqueue_solve(${task.id}::uuid)`.execute(trx);
          await audit(trx, user_id, "user", "solve_requested", { task_no: task.short_no, via: "whatsapp" });
          return { reply: `⏳ Working on #${task.short_no}. You'll get the PDF here in a few minutes.`, taskId: task.id };
        }
        case "skip": {
          const task = await resolveTask(command.taskNo);
          if (!task) return { reply: "Which task? Reply *skip* to a notice, or send *qa skip 12*." };
          await sql`select app.skip_task(${task.id}::uuid)`.execute(trx);
          return { reply: `👍 Skipped #${task.short_no}.`, taskId: task.id };
        }
        case "status": {
          const tasks = await trx
            .selectFrom("app.tasks")
            .select(["short_no", "title", "kind", "status", "deadline_at"])
            .where("status", "in", ["awaiting_confirmation", "queued", "solving", "needs_content", "reminder_only", "failed"])
            .orderBy("deadline_at", (ob) => ob.asc().nullsLast())
            .limit(10)
            .execute();
          return {
            reply: statusText(
              tasks.map((t) => ({ shortNo: t.short_no, title: t.title, kind: t.kind, status: t.status, deadline: t.deadline_at })),
              tz,
              appUrl,
            ),
          };
        }
        default:
          return { reply: helpText(appUrl) };
      }
    });

    if (outcome) await notify(ctx, user_id, outcome.reply, "command_reply", outcome.taskId ?? null);
  };
