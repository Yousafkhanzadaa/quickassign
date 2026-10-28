"use server";
import { audit, withTenant } from "@qa/core";
import { sql } from "kysely";
import { redirect } from "next/navigation";
import { z } from "zod";
import { TERMS_VERSION } from "../constants";
import { env } from "../env";
import { db, keys } from "../server";
import { requireUser } from "../session";

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const Onboarding = z.object({
  full_name: z.string().trim().min(1).max(120),
  roll_number: opt(64),
  university: opt(160),
  department: opt(160),
  program: opt(120),
  semester: opt(40),
  adult: z.literal("on"),
  terms: z.literal("on"),
  wa_risk: z.literal("on"),
  plan: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/).optional().catch(undefined),
});

export interface FormState {
  error?: string;
}

export async function completeOnboarding(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = Onboarding.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Fill in your name and tick all three confirmations to continue." };
  }
  const v = parsed.data;
  const now = new Date();
  await withTenant(db(), user.id, async (trx) => {
    await trx
      .insertInto("app.profiles")
      .values({
        user_id: user.id,
        full_name: v.full_name,
        roll_number: v.roll_number ?? null,
        university: v.university ?? null,
        department: v.department ?? null,
        program: v.program ?? null,
        semester: v.semester ?? null,
        age_confirmed_at: now,
        terms_version: TERMS_VERSION,
        terms_accepted_at: now,
        wa_risk_ack_at: now,
      })
      .onConflict((oc) => oc.column("user_id").doNothing())
      .execute();
    await keys().get(trx, user.id); // creates the student's content key
    await sql`select app.grant_signup_credits(${env().FREE_SIGNUP_CREDITS})`.execute(trx);
    await audit(trx, user.id, "user", "onboarding_completed", { terms: TERMS_VERSION });
  });
  redirect(v.plan ? `/billing?plan=${v.plan}` : "/whatsapp");
}
