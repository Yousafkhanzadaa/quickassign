import { describe, expect, it } from "vitest";
import { signRequest } from "./gateway-client.js";

describe("gateway request signing", () => {
  it("matches the Go verifier's vector", () => {
    // Same vector as gateway/internal/api/auth_test.go TestCrossLanguageSignature.
    const sig = signRequest(
      "test-secret-0123456789abcdef0123456789",
      "worker",
      "1700000000",
      "00112233445566778899aabbccddeeff",
      "POST",
      "/v1/tenants/abcdefgh/self/text",
      Buffer.from('{"text":"hi"}'),
    );
    expect(sig).toBe("6413f24448ee332396dde4133c174e64d8774bf502117ff4aef46173716107c1");
  });
});
