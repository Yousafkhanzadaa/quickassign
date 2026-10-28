import { describe, expect, it } from "vitest";
import { findMath, mathAsCode, mathIssues, normalizeMathDelimiters, replaceMath, sanitizeMarkdown, validateTex } from "./markdown.js";

describe("markdown post-processing", () => {
  it("normalises LaTeX-style delimiters", () => {
    expect(normalizeMathDelimiters("a \\(x^2\\) and \\[y\\]")).toBe("a $x^2$ and $$y$$");
    expect(normalizeMathDelimiters("```\n\\(keep\\)\n```")).toBe("```\n\\(keep\\)\n```");
  });

  it("strips html, images and raw attributes but keeps code", () => {
    const md = "Hi <script>alert(1)</script> ![p](/etc/passwd) `<b>`\n```{=latex}\n\\input{x}\n```";
    const out = sanitizeMarkdown(md);
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("/etc/passwd");
    expect(out).toContain("`<b>`");
  });

  it("finds inline and display math but not prices or code", () => {
    const md = "Cost is $5 and $10. Area $\\pi r^2$.\n\n$$\\int_0^1 x\\,dx$$\n\n`$notmath$`";
    const spans = findMath(md);
    expect(spans.map((s) => s.tex)).toEqual(["\\pi r^2", "\\int_0^1 x\\,dx"]);
    expect(spans[1]!.display).toBe(true);
  });

  it("validates with KaTeX as an allowlist", () => {
    expect(validateTex("\\frac{a}{b}", false)).toBeNull();
    expect(validateTex("\\begin{aligned}a&=b\\end{aligned}", true)).toBeNull();
    expect(validateTex("\\input{/etc/passwd}", false)).not.toBeNull();
    expect(validateTex("\\frac{a}{", false)).not.toBeNull();
  });

  it("reports issues and replaces spans by index", () => {
    const md = "ok $x^2$ bad $\\frac{1}{$ end";
    const issues = mathIssues(md);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.index).toBe(1);
    const fixed = replaceMath(md, new Map([[1, "$\\frac{1}{2}$"]]));
    expect(fixed).toBe("ok $x^2$ bad $\\frac{1}{2}$ end");
    expect(mathIssues(fixed)).toHaveLength(0);
    expect(mathAsCode("a`b", false)).toBe("`a'b`");
  });
});
