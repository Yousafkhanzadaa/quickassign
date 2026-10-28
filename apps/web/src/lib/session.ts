import "server-only";
import { withTenant, type ProfilesTable } from "@qa/core";
import type { Selectable } from "kysely";
import { redirect } from "next/navigation";
import { currentUser, type SessionUser } from "./auth";
import { db } from "./server";

/** The signed-in student: a session cookie whose token matches a live session in the database. */
export async function getUser(): Promise<SessionUser | null> {
  return currentUser();
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getUser();
  if (!u) redirect("/sign-in");
  return u;
}

export type { SessionUser };
export type Profile = Selectable<ProfilesTable>;

/** Requires a signed-in user who has completed onboarding (profile + consents). */
export async function requireProfile(): Promise<{ user: SessionUser; profile: Profile }> {
  const user = await requireUser();
  const profile = await withTenant(db(), user.id, (trx) =>
    trx.selectFrom("app.profiles").selectAll().where("user_id", "=", user.id).executeTakeFirst(),
  );
  if (!profile) redirect("/onboarding");
  return { user, profile };
}

/** For route handlers: returns the user id or null (no redirects). */
export async function sessionUserId(): Promise<string | null> {
  return (await getUser())?.id ?? null;
}
