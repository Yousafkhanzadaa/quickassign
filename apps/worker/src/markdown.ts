// Post-processing of model output before it reaches the sandbox renderer:
// normalise math delimiters, strip anything that is not plain Markdown, and validate
// every math fragment with KaTeX (an allowlist of math commands).
import katex from "katex";

export interface MathSpan {
  start: number;
  end: number;
  tex: string;
  display: boolean;
}

/** Converts \( \) and \[ \] delimiters to $ / $$ (outside code). */
export function normalizeMathDelimiters(md: string): string {
  return mapOutsideCode(md, (chunk) =>
    chunk
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex: string) => `$$${tex}$$`)
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex: string) => `$${tex.trim()}$`),
  );
}

/** Removes raw HTML, images and pandoc raw/attribute syntax from model output. */
export function sanitizeMarkdown(md: string): string {
  return mapOutsideCode(md, (chunk) =>
    chunk
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<\/?[a-zA-Z][^>]*>/g, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\{=[a-zA-Z]+\}/g, "")
      .replace(/^\s*(::+|\\documentclass|\\usepackage).*$/gm, ""),
  )
    .replace(/\r\n/g, "\n")
    .trim();
}

/** Finds $...$ and $$...$$ spans, skipping fenced and inline code. */
export function findMath(md: string): MathSpan[] {
  const spans: MathSpan[] = [];
  const codeRanges = codeSpans(md);
  const inCode = (i: number) => codeRanges.some(([s, e]) => i >= s && i < e);
  let i = 0;
  while (i < md.length) {
    if (md[i] === "\\" && md[i + 1] === "$") {
      i += 2;
      continue;
    }
    if (md[i] !== "$" || inCode(i)) {
      i++;
      continue;
    }
    const display = md[i + 1] === "$";
    const open = display ? 2 : 1;
    const close = display ? md.indexOf("$$", i + 2) : findInlineClose(md, i + 1);
    if (close < 0) {
      i += open;
      continue;
    }
    const tex = md.slice(i + open, close);
    if (!display && (tex.length === 0 || /^\s/.test(tex) || /\s$/.test(tex))) {
      i += 1; // pandoc rule: not math (e.g. "$5 and $10")
      continue;
    }
    spans.push({ start: i, end: close + open, tex, display });
    i = close + open;
  }
  return spans;
}

function findInlineClose(md: string, from: number): number {
  for (let j = from; j < md.length; j++) {
    if (md[j] === "\n" && md[j + 1] === "\n") return -1;
    if (md[j] === "\\") {
      j++;
      continue;
    }
    if (md[j] === "$" && md[j + 1] !== "$" && !/\d/.test(md[j + 1] ?? "")) return j;
  }
  return -1;
}

export function validateTex(tex: string, display: boolean): string | null {
  try {
    katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      strict: "ignore",
      trust: false,
      maxSize: 50,
      maxExpand: 500,
    });
    return null;
  } catch (err) {
    return (err as Error).message.slice(0, 200);
  }
}

export interface MathIssue {
  index: number;
  tex: string;
  display: boolean;
  error: string;
}

export function mathIssues(md: string): MathIssue[] {
  return findMath(md)
    .map((s, index) => ({ index, tex: s.tex, display: s.display, error: validateTex(s.tex, s.display) }))
    .filter((x): x is MathIssue => x.error !== null);
}

/** Replaces math spans by index (used to apply repairs or fall back to code). */
export function replaceMath(md: string, replacements: Map<number, string>): string {
  const spans = findMath(md);
  let out = "";
  let last = 0;
  spans.forEach((s, idx) => {
    const rep = replacements.get(idx);
    if (rep === undefined) return;
    out += md.slice(last, s.start) + rep;
    last = s.end;
  });
  return out + md.slice(last);
}

/** Last resort: show an unrenderable formula as code instead of failing the document. */
export function mathAsCode(tex: string, display: boolean): string {
  const safe = tex.replace(/`/g, "'").trim();
  return display ? `\n\n\`\`\`\n${safe}\n\`\`\`\n\n` : `\`${safe}\``;
}

function codeSpans(md: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const fence = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm;
  for (const m of md.matchAll(fence)) ranges.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  const inline = /`[^`\n]+`/g;
  for (const m of md.matchAll(inline)) {
    const s = m.index ?? 0;
    if (!ranges.some(([a, b]) => s >= a && s < b)) ranges.push([s, s + m[0].length]);
  }
  return ranges;
}

function mapOutsideCode(md: string, fn: (chunk: string) => string): string {
  const ranges = codeSpans(md).sort((a, b) => a[0] - b[0]);
  let out = "";
  let last = 0;
  for (const [s, e] of ranges) {
    if (s < last) continue;
    out += fn(md.slice(last, s)) + md.slice(s, e);
    last = e;
  }
  return out + fn(md.slice(last));
}
