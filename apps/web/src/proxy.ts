import { NextResponse, type NextRequest } from "next/server";
import { hasSessionCookie } from "./lib/session-cookie";

const PROTECTED = ["/dashboard", "/whatsapp", "/groups", "/courses", "/tasks", "/settings", "/billing", "/onboarding"];

/**
 * Runs before every page render:
 *  - sets a strict, per-request nonce-based Content-Security-Policy
 *  - sends visitors without a session cookie from app pages to sign-in (pages check the
 *    session itself against the database on the server)
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-inline'" : ""}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  if (!hasSessionCookie(request.cookies.getAll()) && PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const to = new URL("/sign-in", request.url);
    to.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(to);
  }

  // Headers the page render sees: the CSP nonce.
  const forwarded = new Headers(request.headers);
  forwarded.set("x-nonce", nonce);
  forwarded.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: forwarded } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
