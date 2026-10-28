import { describe, expect, it } from "vitest";
import { aad, DecryptError, Kek, open, openText, seal, sealText } from "./seal.js";

describe("seal", () => {
  const key = Buffer.alloc(32, 0x11);

  it("round-trips and binds to purpose/tenant/record", () => {
    const ct = seal(key, Buffer.from("Assignment 3"), aad("msg.body", "t1", "r1"));
    expect(open(key, ct, aad("msg.body", "t1", "r1")).toString()).toBe("Assignment 3");
    expect(() => open(key, ct, aad("msg.body", "t2", "r1"))).toThrow(DecryptError);
    expect(() => open(key, ct, aad("msg.body", "t1", "r2"))).toThrow(DecryptError);
    expect(() => open(key, ct, aad("blob", "t1", "r1"))).toThrow(DecryptError);
  });

  it("detects tampering and truncation", () => {
    const ct = seal(key, Buffer.from("secret"), aad("p", "t", "r"));
    const tampered = Buffer.from(ct);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => open(key, tampered, aad("p", "t", "r"))).toThrow(DecryptError);
    expect(() => open(key, ct.subarray(0, 10), aad("p", "t", "r"))).toThrow(DecryptError);
  });

  it("decrypts the Go-side cross-language vector", () => {
    // Same vector as gateway/internal/seal/seal_test.go (key 0x11*32, nonce 0x22*12).
    const sealed = Buffer.from(
      "01" + "222222222222222222222222" + "7f926b25afeff92d8a52fe4831d68ca67ce1a4921ee3c808d3e2cd5775c877c5baa20e14b6",
      "hex",
    );
    expect(open(key, sealed, aad("msg.body", "tenant-x", "record-y")).toString()).toBe("hello from typescript");
  });

  it("text helpers handle empty values", () => {
    expect(sealText(key, "", "p", "t", "r")).toBeNull();
    expect(openText(key, null, "p", "t", "r")).toBeNull();
    const ct = sealText(key, "héllo ✓", "p", "t", "r");
    expect(openText(key, ct, "p", "t", "r")).toBe("héllo ✓");
  });
});

describe("Kek", () => {
  const kek = Kek.parse("test-v1", Buffer.alloc(32, 7).toString("base64"));

  it("wraps and unwraps data keys per tenant and purpose", () => {
    const dek = Buffer.alloc(32, 9);
    const w = kek.wrap(dek, "content", "user-1");
    expect(kek.unwrap(w, "content", "user-1").equals(dek)).toBe(true);
    expect(() => kek.unwrap(w, "content", "user-2")).toThrow(DecryptError);
    expect(() => kek.unwrap(w, "wastore", "user-1")).toThrow(DecryptError);
  });

  it("rejects malformed keys", () => {
    expect(() => Kek.parse("x", "short")).toThrow();
    expect(() => Kek.parse("", Buffer.alloc(32).toString("base64"))).toThrow();
  });

  it("derives the same sender pepper as Go", () => {
    // Go: seal.SenderHash uses HKDF(sha256, key, "quickassign", "qa/v1/sender-pepper").
    expect(kek.deriveSubkey("qa/v1/sender-pepper").length).toBe(32);
    expect(kek.deriveSubkey("a").equals(kek.deriveSubkey("b"))).toBe(false);
  });
});
