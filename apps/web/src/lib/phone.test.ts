import { describe, expect, it } from "vitest";
import { normalizePkPhone } from "./phone";

describe("normalizePkPhone", () => {
  it.each([
    ["+92 300 1234567", "923001234567"],
    ["923001234567", "923001234567"],
    ["03001234567", "923001234567"],
    ["0092-300-1234567", "923001234567"],
    ["+91 98765 43210", "919876543210"],
  ])("%s", (input, out) => expect(normalizePkPhone(input)).toBe(out));

  it.each(["", "12345", "0300123", "abc", "+0 123 456 7890"])("rejects %s", (input) => expect(normalizePkPhone(input)).toBeNull());
});
