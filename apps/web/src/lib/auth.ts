import "server-only";
import { verifyPassword } from "@qa/core";
import { createHash, randomBytes } from "node:crypto";
import { sql } from "kysely";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { env } from "./env";
import { RateLimiter } from "./rate-limit";
import { db } from "./server";
import { isSessionToken, sessionCookieName } from "./session-cookie";

export interface SessionUser {
  /** Account id (a UUID): the tenant id everywhere in QuickAssign. */
  id: string;
  email: string;
  name: string;
}

// The database expires a session after 30 days without use; the cookie can outlive it.
const COOKIE_MAX_AGE = 400 * 24 * 3600;

function secure(): boolean {
  return env().APP_BASE_URL.startsWith("https://");
}

const hashToken = (token: string) => createHash("sha256").update(token).digest();

async function sessionToken(): Promise<string | undefined> {
  const value = (await cookies()).get(sessionCookieName(secure()))?.value;
  return isSessionToken(value) ? value : undefined;
}

/** The signed-in account for this request, checked against the database once per request. */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const token = await sessionToken();
  if (!token) return null;
  const r = await sql<{ user_id: string; email: string; name: string }>`select * from qa_auth.session_account(${hashToken(token)})`.execute(db());
  const row = r.rows[0];
  return row ? { id: row.user_id, email: row.email, name: row.name } : null;
});

/** Signs this browser in as userId with a fresh token (Server Actions only: it sets a cookie). */
export async function startSession(userId: string): Promise<void> {
  const old = await sessionToken();
  if (old) await sql`select qa_auth.end_session(${hashToken(old)})`.execute(db());
  const token = randomBytes(32).toString("base64url");
  await sql`select qa_auth.start_session(${userId}::uuid, ${hashToken(token)})`.execute(db());
  (await cookies()).set(sessionCookieName(secure()), token, {
    httpOnly: true,
    secure: secure(),
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

/** Signs this browser out. */
export async function endSession(): Promise<void> {
  const token = await sessionToken();
  if (token) await sql`select qa_auth.end_session(${hashToken(token)})`.execute(db());
  (await cookies()).delete(sessionCookieName(secure()));
}

/** Ends every session of the signed-in account, or every other one with keepCurrent. */
export async function endAllSessions(keepCurrent: boolean): Promise<void> {
  const token = await sessionToken();
  if (token) await sql`select qa_auth.end_all_sessions(${hashToken(token)}, ${keepCurrent})`.execute(db());
  if (!keepCurrent) (await cookies()).delete(sessionCookieName(secure()));
}

const g = globalThis as unknown as {
  __qaLimits?: { signInIp: RateLimiter; signInEmail: RateLimiter; signUpIp: RateLimiter; passwordCheck: RateLimiter };
};

/** Attempt limits for sign-in, sign-up and password checks (they survive dev hot-reloads). */
export function limits() {
  g.__qaLimits ??= {
    signInIp: new RateLimiter(20, 60_000),
    signInEmail: new RateLimiter(10, 15 * 60_000),
    signUpIp: new RateLimiter(20, 60 * 60_000),
    passwordCheck: new RateLimiter(10, 15 * 60_000),
  };
  return g.__qaLimits;
}

/**
 * The client's address for rate limiting: the last X-Forwarded-For entry, which is the one
 * your reverse proxy (or Next.js itself, without a proxy) added, not one the client sent.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return forwarded || h.get("x-real-ip")?.trim() || "unknown";
}

/** Re-checks the signed-in account's password, for sensitive changes in Settings. */
export async function passwordMatches(user: SessionUser, password: string): Promise<"ok" | "wrong" | "limited"> {
  if (!limits().passwordCheck.take(user.id)) return "limited";
  const r = await sql<{ password_hash: string }>`select h.password_hash from qa_auth.password_hash(${user.email}) as h`.execute(db());
  const stored = r.rows[0]?.password_hash;
  return stored && password.length > 0 && (await verifyPassword(password, stored)) ? "ok" : "wrong";
}
