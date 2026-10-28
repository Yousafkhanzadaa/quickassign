// The session cookie holds a random token; the database keeps only its SHA-256.
// No database access here, so src/proxy.ts and public pages can use it cheaply.

/**
 * Over HTTPS the cookie gets the __Host- prefix: browsers then require Secure and Path=/
 * and refuse a Domain attribute, so no other site or subdomain can set or replace it.
 */
export function sessionCookieName(secure: boolean): string {
  return secure ? "__Host-qa_session" : "qa_session";
}

/** True when a session cookie is present (optimistic; pages still check it against the database). */
export function hasSessionCookie(all: Array<{ name: string }>): boolean {
  return all.some((c) => c.name === "qa_session" || c.name === "__Host-qa_session");
}

/** Session tokens are 32 random bytes, base64url-encoded. */
export function isSessionToken(value: string | undefined): value is string {
  return value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value);
}
