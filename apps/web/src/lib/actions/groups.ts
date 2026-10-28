"use server";
import { audit, withTenant, type SenderRole } from "@qa/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, gateway } from "../server";
import { requireProfile } from "../session";

const Monitor = z.object({
  group_id: z.string().uuid(),
  monitored: z.enum(["on", "off"]),
  course_id: z.union([z.string().uuid(), z.literal("")]).transform((v) => (v === "" ? null : v)),
});

export async function setGroupMonitoring(formData: FormData): Promise<void> {
  const { user } = await requireProfile();
  const p = Monitor.safeParse(Object.fromEntries(formData));
  if (!p.success) return;
  await withTenant(db(), user.id, async (trx) => {
    if (p.data.course_id) {
      const ok = await trx.selectFrom("app.courses").select("id").where("id", "=", p.data.course_id).executeTakeFirst();
      if (!ok) return;
    }
    await trx
      .updateTable("app.wa_groups")
      .set({ monitored: p.data.monitored === "on", course_id: p.data.course_id, updated_at: new Date() })
      .where("id", "=", p.data.group_id)
      .execute();
    await audit(trx, user.id, "user", "group_monitoring_changed", { monitored: p.data.monitored === "on" });
  });
  // Tell the gateway immediately (it also re-syncs every few minutes).
  await gateway()
    .reloadMonitored(user.id)
    .catch(() => undefined);
  revalidatePath("/groups");
}

const Role = z.object({
  group_jid: z.string().endsWith("@g.us"),
  sender_hash: z.string().regex(/^[0-9a-f]{32}$/),
  role: z.enum(["unknown", "instructor", "ta", "class_rep", "student"]),
});

export async function setSenderRole(formData: FormData): Promise<void> {
  const { user } = await requireProfile();
  const p = Role.safeParse(Object.fromEntries(formData));
  if (!p.success) return;
  await withTenant(db(), user.id, (trx) =>
    trx
      .updateTable("app.group_senders")
      .set({ role: p.data.role as SenderRole })
      .where("group_jid", "=", p.data.group_jid)
      .where("sender_hash", "=", p.data.sender_hash)
      .execute(),
  );
  revalidatePath("/groups");
}
