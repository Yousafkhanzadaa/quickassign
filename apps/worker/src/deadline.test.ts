import { describe, expect, it } from "vitest";
import { formatLocal, localStamp, resolveDeadline, tzOffsetMinutes } from "./deadline.js";

const sentAt = new Date("2026-10-05T09:00:00Z"); // Mon 14:00 in Karachi

describe("deadline", () => {
  it("knows Karachi is UTC+5", () => {
    expect(tzOffsetMinutes("Asia/Karachi", sentAt)).toBe(300);
  });

  it("resolves local Karachi times to UTC", () => {
    expect(resolveDeadline("2026-10-12T23:59", "Asia/Karachi", sentAt)?.toISOString()).toBe("2026-10-12T18:59:00.000Z");
  });

  it("treats date-only deadlines as end of day", () => {
    expect(resolveDeadline("2026-10-12", "Asia/Karachi", sentAt)?.toISOString()).toBe("2026-10-12T18:59:00.000Z");
  });

  it("rejects malformed or implausible deadlines", () => {
    expect(resolveDeadline("next monday", "Asia/Karachi", sentAt)).toBeNull();
    expect(resolveDeadline("2026-13-01T10:00", "Asia/Karachi", sentAt)).toBeNull();
    expect(resolveDeadline("2020-01-01T10:00", "Asia/Karachi", sentAt)).toBeNull(); // long past
    expect(resolveDeadline("2030-01-01T10:00", "Asia/Karachi", sentAt)).toBeNull(); // > 1 year out
    expect(resolveDeadline(null, "Asia/Karachi", sentAt)).toBeNull();
  });

  it("handles DST zones", () => {
    // London is UTC+1 in summer.
    expect(resolveDeadline("2026-07-01T12:00", "Europe/London", new Date("2026-06-20T00:00:00Z"))?.toISOString()).toBe(
      "2026-07-01T11:00:00.000Z",
    );
  });

  it("formats for humans and for the model", () => {
    const d = new Date("2026-10-12T18:59:00Z");
    expect(formatLocal(d, "Asia/Karachi")).toMatch(/Mon.*12.*Oct.*11:59/);
    expect(localStamp(sentAt, "Asia/Karachi")).toBe("2026-10-05T14:00 (Mon)");
  });
});
