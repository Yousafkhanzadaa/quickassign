import { describe, expect, it } from "vitest";
import { chunkPages } from "./chunk.js";

describe("chunkPages", () => {
  it("keeps small documents in one chunk with the right page range", () => {
    const chunks = chunkPages([
      { page: 1, text: "Intro to graphs.\n\nBFS explores level by level." },
      { page: 2, text: "DFS goes deep first." },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ pageFrom: 1, pageTo: 2 });
    expect(chunks[0]!.text).toContain("DFS");
  });

  it("splits large documents with overlap and monotonic pages", () => {
    const pages = Array.from({ length: 10 }, (_, i) => ({ page: i + 1, text: `Page ${i + 1}. ` + "lorem ipsum dolor sit amet ".repeat(60) }));
    const chunks = chunkPages(pages, 1500, 200);
    expect(chunks.length).toBeGreaterThan(5);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.pageFrom).toBeGreaterThanOrEqual(chunks[i - 1]!.pageFrom);
      expect(chunks[i]!.text.length).toBeLessThanOrEqual(1500 + 200 + 2);
    }
    expect(chunks.at(-1)!.pageTo).toBe(10);
  });

  it("ignores empty input", () => {
    expect(chunkPages([{ page: 1, text: "   " }])).toEqual([]);
  });
});
