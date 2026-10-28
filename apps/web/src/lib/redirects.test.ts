import { describe, expect, it } from "vitest";
import { safeNext } from "./redirects";

describe("safeNext", () => {
  it("keeps paths on this site", () => {
    expect(safeNext("/billing?plan=pro")).toBe("/billing?plan=pro");
    expect(safeNext("/onboarding")).toBe("/onboarding");
  });

  it("refuses anything that leaves the site", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "https://evil.com", "evil.com", "", null, undefined]) {
      expect(safeNext(bad)).toBe("/dashboard");
    }
  });
});
