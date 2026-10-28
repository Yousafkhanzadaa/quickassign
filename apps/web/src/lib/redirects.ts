/**
 * Where to send someone after sign-in: only a path on this site. The value is parsed the
 * way a browser would (which drops tabs and newlines and treats "\" as "/"), so tricks
 * like "//evil.com", "/\evil.com" or "/\t/evil.com" fall back to the default.
 */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || next.length > 512 || !next.startsWith("/")) return fallback;
  try {
    const base = "http://local.invalid";
    const url = new URL(next, base);
    return url.origin === base ? url.pathname + url.search : fallback;
  } catch {
    return fallback;
  }
}
