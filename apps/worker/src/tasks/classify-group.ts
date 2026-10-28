import { randomUUID } from "node:crypto";
import type { Task } from "graphile-worker";
import { sql } from "kysely";
import { audit, openText, sealText, withTenant, type TaskKind, type TaskStatus } from "@qa/core";
import { z } from "zod";
import type { Ctx } from "../context.js";
import { localStamp, resolveDeadline } from "../deadline.js";
import { DETECT_INSTRUCTIONS, Detection } from "../llm/prompts.js";
import { deadlineChangedNotice, examNotice, needsContentNotice, newTaskNotice } from "../notify.js";
import { clip, nextTaskNo, notify, parsePayload, scheduleReminders } from "../util.js";

const Payload = z.object({ user_id: z.string(), group_jid: z.string().endsWith("@g.us") });

const WINDOW_BEFORE_MS = 30 * 60_000;
const MAX_CONTEXT_MESSAGES = 50;
const MAX_DETECTIONS_PER_DAY = 300;

interface PreparedMessage {
  id: string;
  waId: string;
  sentAt: Date;
  kind: string;
  text: string;
  fileName: string | null;
  mime: string | null;
  senderHash: string;
  senderIsAdmin: boolean;
  quotedWaId: string | null;
  edited: boolean;
  backfill: boolean;
}

/** Classifies a burst of candidate messages in one group into tasks. */
export const classifyGroup =
  (ctx: Ctx): Task =>
  async (payload, helpers) => {
    const { user_id, group_jid } = parsePayload(Payload, payload);
    if (!ctx.llm.enabled) {
      // Candidates stay unprocessed and are picked up once OPENAI_API_KEY is configured.
      ctx.log.warn({ tenant: user_id.slice(0, 8) }, "classification skipped: AI not configured");
      return;
    }

    const prep = await withTenant(ctx.db, user_id, async (trx) => {
      // Cost guard: a flooded or very busy group can't run up unbounded detection calls.
      const today = await trx
        .selectFrom("app.usage_events")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("kind", "=", "detect")
        .where("created_at", ">", new Date(Date.now() - 24 * 3600_000))
        .executeTakeFirstOrThrow();
      if (Number(today.n) >= MAX_DETECTIONS_PER_DAY) {
        ctx.log.warn({ tenant: user_id.slice(0, 8) }, "daily detection cap reached");
        return null;
      }
      const profile = await trx.selectFrom("app.profiles").select(["timezone", "auto_solve"]).where("user_id", "=", user_id).executeTakeFirst();
      const group = await trx
        .selectFrom("app.wa_groups")
        .select(["name", "course_id", "monitored"])
        .where("group_jid", "=", group_jid)
        .executeTakeFirst();
      if (!profile || !group?.monitored) return null;

      const candidates = await trx
        .selectFrom("app.inbound_messages")
        .select(["id", "sent_at"])
        .where("group_jid", "=", group_jid)
        .where("processed_at", "is", null)
        .where("revoked_at", "is", null)
        .orderBy("sent_at")
        .execute();
      if (candidates.length === 0) return null;

      const windowStart = new Date(candidates[0]!.sent_at.getTime() - WINDOW_BEFORE_MS);
      let rows = await trx
        .selectFrom("app.inbound_messages")
        .selectAll()
        .where("group_jid", "=", group_jid)
        .where("sent_at", ">=", windowStart)
        .where("revoked_at", "is", null)
        .orderBy("sent_at", "desc")
        .limit(MAX_CONTEXT_MESSAGES)
        .execute();
      const inWindow = new Set(rows.map((r) => r.wa_message_id));
      const quoted = [...new Set(rows.map((r) => r.quoted_wa_message_id).filter((q): q is string => !!q && !inWindow.has(q)))];
      if (quoted.length > 0) {
        const extra = await trx
          .selectFrom("app.inbound_messages")
          .selectAll()
          .where("group_jid", "=", group_jid)
          .where("wa_message_id", "in", quoted.slice(0, 10))
          .where("revoked_at", "is", null)
          .execute();
        rows = rows.concat(extra);
      }
      rows.sort((a, b) => a.sent_at.getTime() - b.sent_at.getTime());

      const key = await ctx.keys.get(trx, user_id);
      const messages: PreparedMessage[] = rows.map((r) => {
        const rec = `${r.group_jid}:${r.wa_message_id}`;
        return {
          id: r.id,
          waId: r.wa_message_id,
          sentAt: r.sent_at,
          kind: r.kind,
          text: openText(key, r.body_enc, "msg.body", user_id, rec) ?? "",
          fileName: openText(key, r.media_filename_enc, "msg.filename", user_id, rec),
          mime: r.media_mime,
          senderHash: r.sender_hash,
          senderIsAdmin: r.sender_is_admin,
          quotedWaId: r.quoted_wa_message_id,
          edited: r.edited_at !== null,
          backfill: r.is_backfill,
        };
      });

      const senders = await trx
        .selectFrom("app.group_senders")
        .select(["sender_hash", "role", "is_admin"])
        .where("group_jid", "=", group_jid)
        .execute();
      const openTasks = await trx
        .selectFrom("app.tasks")
        .select(["id", "short_no", "title", "kind", "deadline_at", "status"])
        .where("group_jid", "=", group_jid)
        .where("status", "not in", ["skipped"])
        .where("created_at", ">", new Date(Date.now() - 45 * 24 * 3600_000))
        .orderBy("created_at", "desc")
        .limit(15)
        .execute();
      const course = group.course_id
        ? await trx.selectFrom("app.courses").select(["name", "code", "auto_solve"]).where("id", "=", group.course_id).executeTakeFirst()
        : undefined;

      return { profile, group, course, messages, senders, openTasks, candidateIds: candidates.map((c) => c.id) };
    });
    if (!prep) return;

    const tz = prep.profile.timezone;
    const roleOf = new Map(prep.senders.map((s) => [s.sender_hash, s.role]));
    const senderLabel = new Map<string, string>();
    const msgLabel = new Map<string, string>(); // label -> message id
    const labelOfWa = new Map<string, string>();
    const promptMessages = prep.messages.map((m, i) => {
      const label = `M${i + 1}`;
      msgLabel.set(label, m.id);
      labelOfWa.set(m.waId, label);
      if (!senderLabel.has(m.senderHash)) senderLabel.set(m.senderHash, `S${senderLabel.size + 1}`);
      return { m, label };
    });
    const input = {
      now_local: localStamp(new Date(), tz),
      timezone: tz,
      group: prep.group.name ?? "class group",
      course: prep.course ? [prep.course.code, prep.course.name].filter(Boolean).join(" ") : null,
      open_tasks: prep.openTasks.map((t) => ({
        id: `T${t.short_no}`,
        kind: t.kind,
        title: t.title,
        deadline_local: t.deadline_at ? localStamp(t.deadline_at, tz) : null,
      })),
      messages: promptMessages.map(({ m, label }) => ({
        id: label,
        time_local: localStamp(m.sentAt, tz),
        sender: senderLabel.get(m.senderHash),
        role: roleOf.get(m.senderHash) ?? "unknown",
        admin: m.senderIsAdmin,
        text: m.text.slice(0, 3000),
        attachment: m.kind === "document" ? { type: m.mime ?? "document", name: m.fileName } : m.kind === "image" ? { type: "image" } : null,
        reply_to: m.quotedWaId ? (labelOfWa.get(m.quotedWaId) ?? "earlier message") : null,
        edited: m.edited,
      })),
    };

    const detection = await ctx.llm.parse({
      userId: user_id,
      kind: "detect",
      model: ctx.cfg.OPENAI_DETECT_MODEL,
      effort: ctx.cfg.OPENAI_DETECT_EFFORT,
      instructions: DETECT_INSTRUCTIONS,
      input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(input) }] }],
      schema: Detection,
      schemaName: "detection",
      maxOutputTokens: 6000,
    });

    const autoSolve = prep.course?.auto_solve ?? prep.profile.auto_solve;
    const messagesById = new Map(prep.messages.map((m) => [m.id, m]));
    const outbox: Array<{ text: string; kind: string; taskId: string }> = [];
    const toSolve: string[] = [];
    const reminders: Array<{ taskId: string; deadline: Date }> = [];

    await withTenant(ctx.db, user_id, async (trx) => {
      const key = await ctx.keys.get(trx, user_id);
      for (const item of detection.items.slice(0, 6)) {
        if (item.confidence < 0.5) continue;
        const refs = item.message_refs.map((r) => msgLabel.get(r)).filter((id): id is string => !!id);
        const anchor = refs.map((id) => messagesById.get(id)?.sentAt.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
        const deadline = resolveDeadline(item.deadline_local, tz, anchor ? new Date(anchor) : new Date());
        const title = clip(item.title, 120) || "Untitled task";
        // Old history (backfilled at link time) and past deadlines go to the dashboard
        // quietly instead of pinging the student.
        const expired = deadline !== null && deadline.getTime() < Date.now();
        const stale = refs.length > 0 && refs.every((rid) => messagesById.get(rid)?.backfill) && anchor < Date.now() - 3 * 24 * 3600_000;
        const quiet = expired || stale;
        const summary = clip(item.instructions_summary, 2000);
        const deliverables = item.deliverables.slice(0, 15).map((d) => clip(d, 200)).join("\n");

        const existingNo = item.existing_task ? Number(item.existing_task.replace(/^T/i, "")) : NaN;
        const existing = Number.isFinite(existingNo) ? prep.openTasks.find((t) => t.short_no === existingNo) : undefined;
        if (existing && (item.action === "update" || item.action === "duplicate")) {
          const changedDeadline =
            item.action === "update" && deadline !== null && (!existing.deadline_at || Math.abs(existing.deadline_at.getTime() - deadline.getTime()) > 60_000);
          await trx
            .updateTable("app.tasks")
            .set({
              ...(item.action === "update"
                ? {
                    deadline_at: deadline ?? existing.deadline_at,
                    summary_enc: sealText(key, summary, "task.summary", user_id, existing.id),
                    deliverables_enc: sealText(key, deliverables, "task.deliverables", user_id, existing.id),
                  }
                : {}),
              source_message_ids: sql<string[]>`(select array(select distinct unnest(source_message_ids || ${refs}::uuid[])))`,
              updated_at: new Date(),
            })
            .where("id", "=", existing.id)
            .execute();
          if (changedDeadline && deadline && !quiet) {
            outbox.push({
              text: deadlineChangedNotice({ shortNo: existing.short_no, title: existing.title, kind: existing.kind, deadline }, tz),
              kind: "deadline_update",
              taskId: existing.id,
            });
            reminders.push({ taskId: existing.id, deadline });
          }
          continue;
        }

        const kind: TaskKind = item.kind;
        const isTest = kind === "quiz" || kind === "exam";
        const hasFile = refs.some((id) => {
          const k = messagesById.get(id)?.kind;
          return k === "document" || k === "image";
        });
        let status: TaskStatus;
        if (isTest) status = "reminder_only";
        else if (item.content_location === "external_portal" && !hasFile) status = "needs_content";
        else status = "awaiting_confirmation";

        const id = randomUUID();
        const shortNo = await nextTaskNo(trx, user_id);
        await trx
          .insertInto("app.tasks")
          .values({
            id,
            user_id,
            short_no: shortNo,
            group_jid,
            course_id: prep.group.course_id,
            kind,
            status,
            title,
            summary_enc: sealText(key, summary, "task.summary", user_id, id),
            deliverables_enc: sealText(key, deliverables, "task.deliverables", user_id, id),
            deadline_at: deadline,
            deadline_confidence: deadline ? item.deadline_confidence : null,
            content_location: item.content_location,
            confidence: item.confidence,
            source_message_ids: refs,
          })
          .execute();
        await audit(trx, user_id, "worker", "task_detected", { task_no: shortNo, kind, status });

        const info = { shortNo, title, kind, course: prep.course?.name ?? null, deadline };
        if (quiet) {
          // dashboard only
        } else if (status === "reminder_only") outbox.push({ text: examNotice(info, tz), kind: "exam_notice", taskId: id });
        else if (status === "needs_content") outbox.push({ text: needsContentNotice(info, tz, ctx.cfg.APP_BASE_URL), kind: "needs_content", taskId: id });
        else if (autoSolve) toSolve.push(id);
        else outbox.push({ text: newTaskNotice(info, tz), kind: "task_notice", taskId: id });
        if (deadline && !expired) reminders.push({ taskId: id, deadline });
      }

      await trx
        .updateTable("app.inbound_messages")
        .set({ processed_at: new Date() })
        .where("id", "in", prep.candidateIds)
        .execute();
    });

    for (const o of outbox) await notify(ctx, user_id, o.text, o.kind, o.taskId);
    for (const taskId of toSolve) {
      await withTenant(ctx.db, user_id, (trx) => sql`select app.enqueue_solve(${taskId}::uuid)`.execute(trx));
    }
    for (const r of reminders) await scheduleReminders(helpers, user_id, r.taskId, r.deadline);
  };
