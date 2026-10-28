"use server";
import { audit, hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, withTenant } from "@qa/core";
import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { endAllSessions, passwordMatches } from "../auth";
import { db, gateway, keys } from "../server";
import { requireProfile } from "../session";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

const ProfileInput = z.object({
  full_name: z.string().trim().min(1).max(120),
  roll_number: text(64),
  university: text(160),
  department: text(160),
  program: text(120),
  semester: text(40),
  auto_solve: z.enum(["on", "off"]).default("off"),
});

export interface SettingsState {
  ok?: boolean;
  error?: string;
}

const PASSWORD_ERRORS = {
  wrong: "That password is incorrect.",
  limited: "Too many attempts. Wait a few minutes, then try again.",
} as const;

export async function updateProfile(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const { user } = await requireProfile();
  const p = ProfileInput.safeParse({ auto_solve: "off", ...Object.fromEntries(formData) });
  if (!p.success) return { error: "Please check the fields." };
  await withTenant(db(), user.id, (trx) =>
    trx
      .updateTable("app.profiles")
      .set({
        full_name: p.data.full_name,
        roll_number: p.data.roll_number,
        university: p.data.university,
        department: p.data.department,
        program: p.data.program,
        semester: p.data.semester,
        auto_solve: p.data.auto_solve === "on",
        updated_at: new Date(),
      })
      .where("user_id", "=", user.id)
      .execute(),
  );
  revalidatePath("/settings");
  return { ok: true };
}

export async function changePassword(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const { user } = await requireProfile();
  const next = String(formData.get("new_password") ?? "");
  if (next.length < PASSWORD_MIN_LENGTH || next.length > PASSWORD_MAX_LENGTH) {
    return { error: `Use a new password of ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.` };
  }
  const check = await passwordMatches(user, String(formData.get("current_password") ?? ""));
  if (check !== "ok") return { error: check === "wrong" ? "Your current password is incorrect." : PASSWORD_ERRORS.limited };

  await sql`select qa_auth.set_password_hash(${user.id}::uuid, ${await hashPassword(next)}, true)`.execute(db());
  // Anyone who knew the old password is signed out; this browser stays signed in.
  await endAllSessions(true);
  await withTenant(db(), user.id, (trx) => audit(trx, user.id, "user", "password_changed"));
  return { ok: true };
}

export async function deleteAccount(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const { user } = await requireProfile();
  if (formData.get("confirm") !== "DELETE") return { error: 'Type DELETE to confirm.' };
  // Someone at an unlocked laptop shouldn't be able to wipe the account: ask for the
  // password again.
  const check = await passwordMatches(user, String(formData.get("password") ?? ""));
  if (check !== "ok") return { error: PASSWORD_ERRORS[check] };

  // 1. Remove the WhatsApp link and destroy its keys (gateway crypto-shreds them).
  await gateway()
    .unlink(user.id)
    .catch(() => undefined);
  // 2. Purge every row of app data, the tenant key last, then the account itself
  //    (worker: purge_account).
  await withTenant(db(), user.id, async (trx) => {
    await audit(trx, user.id, "user", "account_deletion_requested", {});
    await sql`select app.enqueue_account_purge()`.execute(trx);
  });
  keys().forget(user.id);
  // 3. End every session now; the account is deleted by the purge job.
  await endAllSessions(false);
  redirect("/");
}
