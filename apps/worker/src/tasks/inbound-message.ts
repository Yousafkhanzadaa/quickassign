import type { Task } from "graphile-worker";
import { openText, withTenant } from "@qa/core";
import { z } from "zod";
import type { Ctx } from "../context.js";
import { CANDIDATE_THRESHOLD, prefilterScore } from "../prefilter.js";
import { parsePayload } from "../util.js";

const Payload = z.object({ user_id: z.string(), message_id: z.string().uuid() });

/** Scores a newly stored group message; candidates schedule a debounced classification. */
export const inboundMessage =
  (ctx: Ctx): Task =>
  async (payload, helpers) => {
    const { user_id, message_id } = parsePayload(Payload, payload);
    const result = await withTenant(ctx.db, user_id, async (trx) => {
      const m = await trx.selectFrom("app.inbound_messages").selectAll().where("id", "=", message_id).executeTakeFirst();
      if (!m || m.revoked_at) return null;
      const key = await ctx.keys.get(trx, user_id);
      const record = `${m.group_jid}:${m.wa_message_id}`;
      const sender = await trx
        .selectFrom("app.group_senders")
        .select("role")
        .where("group_jid", "=", m.group_jid)
        .where("sender_hash", "=", m.sender_hash)
        .executeTakeFirst();
      const score = prefilterScore({
        kind: m.kind,
        text: openText(key, m.body_enc, "msg.body", user_id, record) ?? "",
        fileName: openText(key, m.media_filename_enc, "msg.filename", user_id, record),
        mime: m.media_mime,
        senderIsAdmin: m.sender_is_admin,
        senderRole: sender?.role ?? "unknown",
      });
      const candidate = score >= CANDIDATE_THRESHOLD;
      await trx
        .updateTable("app.inbound_messages")
        .set({ prefilter_score: score, processed_at: candidate ? null : new Date() })
        .where("id", "=", message_id)
        .execute();
      return candidate ? m.group_jid : null;
    });

    if (result) {
      // preserve_run_at: a burst of messages (text, then the PDF, then "deadline Monday")
      // is classified together once, shortly after the first candidate arrives.
      await helpers.addJob(
        "classify_group",
        { user_id, group_jid: result },
        {
          runAt: new Date(Date.now() + ctx.cfg.CLASSIFY_DEBOUNCE_SECONDS * 1000),
          jobKey: `classify:${user_id}:${result}`,
          jobKeyMode: "preserve_run_at",
          maxAttempts: 3,
        },
      );
    }
  };
