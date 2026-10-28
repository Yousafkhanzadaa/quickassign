// Splits extracted course material into overlapping chunks for retrieval,
// remembering which pages each chunk came from (for citations like "Lecture 5, p. 12").

export interface Page {
  page: number;
  text: string;
}

export interface Chunk {
  index: number;
  pageFrom: number;
  pageTo: number;
  text: string;
}

export function chunkPages(pages: Page[], target = 2200, overlap = 250): Chunk[] {
  const chunks: Chunk[] = [];
  let buf = "";
  let fresh = false; // new text added since the last emitted chunk
  let from = 0;
  let to = 0;

  const emit = () => {
    const text = buf.trim();
    if (fresh && text.length > 0) chunks.push({ index: chunks.length, pageFrom: from, pageTo: to, text });
    buf = text.length > overlap ? text.slice(-overlap) : text;
    fresh = false;
    from = to;
  };

  for (const p of pages) {
    const paras = p.text
      .replace(/[ \t]+/g, " ")
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const para of paras) {
      const pieces = para.length > target ? splitLong(para, target) : [para];
      for (const piece of pieces) {
        if (fresh && buf.length + piece.length + 2 > target) emit();
        if (!fresh && buf.length === 0) from = p.page;
        if (!fresh && from === 0) from = p.page;
        buf += (buf ? "\n\n" : "") + piece;
        fresh = true;
        to = p.page;
      }
    }
  }
  emit();
  return chunks;
}

function splitLong(text: string, size: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf(". ", size);
    if (cut < size / 2) cut = rest.lastIndexOf(" ", size);
    if (cut < size / 2) cut = size;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1);
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}
