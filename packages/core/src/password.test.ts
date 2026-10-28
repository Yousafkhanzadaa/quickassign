import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, verifyAgainstDecoy, verifyPassword } from "./password.js";

describe("password", () => {
  it("verifies the right password and rejects others", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored).toMatch(/^scrypt\$32768\$8\$3\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterY", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("salts every hash", async () => {
    const [a, b] = await Promise.all([hashPassword("same password"), hashPassword("same password")]);
    expect(a).not.toBe(b);
  });

  it("treats differently composed Unicode as the same password", async () => {
    const stored = await hashPassword("café-password");
    expect(await verifyPassword("café-password", stored)).toBe(true);
  });

  it("never matches malformed or tampered hashes", async () => {
    const stored = await hashPassword("a long password");
    const parts = stored.split("$");
    for (const bad of [
      "",
      "plain-text",
      "bcrypt$10$abc",
      parts.slice(0, 5).join("$"),
      ["scrypt", 2 ** 30, 8, 3, parts[4], parts[5]].join("$"), // absurd cost
      ["scrypt", 1000, 8, 3, parts[4], parts[5]].join("$"), // N not a power of two
      ["scrypt", 2 ** 15, 8, 3, "", parts[5]].join("$"), // no salt
    ]) {
      expect(await verifyPassword("a long password", bad)).toBe(false);
    }
  });

  it("flags hashes made with other parameters for re-hashing", async () => {
    expect(needsRehash(await hashPassword("x".repeat(12)))).toBe(false);
    expect(needsRehash("scrypt$16384$8$1$c2FsdHNhbHRzYWx0c2FsdA==$a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5")).toBe(true);
  });

  it("the decoy check never succeeds", async () => {
    expect(await verifyAgainstDecoy("anything at all")).toBe(false);
  });
});
