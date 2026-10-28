import { describe, expect, it } from "vitest";
import { hasSessionCookie, isSessionToken, sessionCookieName } from "./session-cookie";

describe("session cookie", () => {
  it("uses the __Host- prefix only over HTTPS", () => {
    expect(sessionCookieName(true)).toBe("__Host-qa_session");
    expect(sessionCookieName(false)).toBe("qa_session");
  });

  it("recognises only QuickAssign's session cookies", () => {
    expect(hasSessionCookie([{ name: "qa_next" }, { name: "qa_session" }])).toBe(true);
    expect(hasSessionCookie([{ name: "__Host-qa_session" }])).toBe(true);
    expect(hasSessionCookie([{ name: "sb-abc-auth-token" }, { name: "qa_session_x" }])).toBe(false);
  });

  it("accepts only well-formed tokens", () => {
    expect(isSessionToken("A".repeat(43))).toBe(true);
    expect(isSessionToken(`${"A".repeat(42)}=`)).toBe(false);
    expect(isSessionToken("A".repeat(44))).toBe(false);
    expect(isSessionToken(undefined)).toBe(false);
  });
});
