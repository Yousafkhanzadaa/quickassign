"use server";
import {
  audit,
  hashPassword,
  needsRehash,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyAgainstDecoy,
  verifyPassword,
  withTenant,
} from "@qa/core";
import { sql } from "kysely";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clientIp, currentUser, endAllSessions, endSession, limits, startSession } from "../auth";
import { safeNext } from "../redirects";
import { db } from "../server";

export interface AuthState {
  error?: string;
  /** Echoed back so the form keeps what was typed (never the password). */
  name?: string;
  email?: string;
}

const Email = z.string().trim().toLowerCase().max(254).email();

const SignUp = z.object({
  name: z.string().trim().min(1).max(120),
  email: Email,
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  plan: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/).optional().catch(undefined),
});

const SignIn = z.object({
  email: Email,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

const TOO_MANY = "Too many attempts. Wait a few minutes, then try again.";

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "").slice(0, 254);

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const typed = { name: field(formData, "name"), email: field(formData, "email") };
  const p = SignUp.safeParse(Object.fromEntries(formData));
  if (!p.success) {
    const bad = new Set(p.error.issues.map((i) => i.path[0]));
    const error = bad.has("name")
      ? "Enter your name."
      : bad.has("email")
        ? "Enter a valid email address."
        : `Use a password of ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`;
    return { ...typed, error };
  }
  if (!limits().signUpIp.take(await clientIp())) return { ...typed, error: TOO_MANY };

  const hash = await hashPassword(p.data.password);
  const r = await sql<{ id: string | null }>`select qa_auth.sign_up(${p.data.email}, ${p.data.name}, ${hash}) as id`.execute(db());
  const id = r.rows[0]?.id;
  if (!id) return { ...typed, error: "An account with this email address already exists. Sign in instead." };

  await startSession(id);
  await withTenant(db(), id, (trx) => audit(trx, id, "user", "account_created"));
  redirect(p.data.plan ? `/onboarding?plan=${p.data.plan}` : "/onboarding");
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const typed = { email: field(formData, "email") };
  const next = safeNext(formData.get("next")?.toString());
  const p = SignIn.safeParse(Object.fromEntries(formData));
  if (!p.success) return { ...typed, error: "Enter your email address and password." };
  const l = limits();
  if (!l.signInIp.take(await clientIp()) || !l.signInEmail.take(p.data.email)) return { ...typed, error: TOO_MANY };

  const r = await sql<{ user_id: string; password_hash: string }>`select h.user_id, h.password_hash from qa_auth.password_hash(${p.data.email}) as h`.execute(db());
  const account = r.rows[0];
  // Unknown addresses take as long as wrong passwords, so timing doesn't reveal accounts.
  const ok = account ? await verifyPassword(p.data.password, account.password_hash) : await verifyAgainstDecoy(p.data.password);
  if (!account || !ok) return { ...typed, error: "Email or password is incorrect." };

  if (needsRehash(account.password_hash)) {
    await sql`select qa_auth.set_password_hash(${account.user_id}::uuid, ${await hashPassword(p.data.password)}, false)`.execute(db());
  }
  await startSession(account.user_id);
  await withTenant(db(), account.user_id, (trx) => audit(trx, account.user_id, "user", "signed_in"));
  redirect(next);
}

/** Signs out of this browser. */
export async function signOut(): Promise<void> {
  await endSession();
  redirect("/");
}

/** Signs out of every device (ends all of this account's sessions). */
export async function signOutEverywhere(): Promise<void> {
  const user = await currentUser();
  await endAllSessions(false);
  if (user) await withTenant(db(), user.id, (trx) => audit(trx, user.id, "user", "signed_out_everywhere"));
  redirect("/sign-in?signed_out=everywhere");
}
