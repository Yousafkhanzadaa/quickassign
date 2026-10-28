import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  it("allows max attempts per window, then refuses until the window ends", () => {
    const l = new RateLimiter(3, 60_000);
    expect([1, 2, 3].map(() => l.take("ip:1", 0))).toEqual([true, true, true]);
    expect(l.take("ip:1", 59_999)).toBe(false);
    expect(l.take("ip:2", 59_999)).toBe(true); // other keys are independent
    expect(l.take("ip:1", 60_000)).toBe(true); // new window
  });

  it("stays bounded under many distinct keys", () => {
    const l = new RateLimiter(1, 60_000, 100);
    for (let i = 0; i < 1000; i++) l.take(`k${i}`, 0);
    expect(l.take("k999", 1)).toBe(false); // the newest keys are kept
    expect(l.take("k0", 1)).toBe(true); // the oldest were dropped
  });
});
