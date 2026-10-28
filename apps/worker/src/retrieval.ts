import { sql } from "kysely";
import { openText, toVector, type Tx } from "@qa/core";
import type { Ctx } from "./context.js";

export interface Excerpt {
  label: string; // M1, M2, ...
  source: string; // material file name
  pages: string; // "p. 3" or "pp. 3-4"
  text: string;
}

/**
 * Exact nearest-neighbour search over one course's chunks (small per-course corpora, so
 * no ANN index and no cross-tenant scan; RLS confines the query to this tenant anyway).
 */
export async function retrieveExcerpts(ctx: Ctx, trx: Tx, userId: string, courseId: string, query: string, k = 10): Promise<Excerpt[]> {
  const count = await trx
    .selectFrom("app.material_chunks")
    .select(sql<string>`count(*)`.as("n"))
    .where("course_id", "=", courseId)
    .executeTakeFirstOrThrow();
  if (Number(count.n) === 0 || !ctx.llm.enabled) return [];

  const [vec] = await ctx.llm.embed(userId, ctx.cfg.OPENAI_EMBED_MODEL, [query.slice(0, 8000)]);
  if (!vec) return [];
  const rows = await sql<{
    id: string;
    material_id: string;
    page_from: number | null;
    page_to: number | null;
    content_enc: Buffer;
    filename_enc: Buffer;
  }>`
    select c.id, c.material_id, c.page_from, c.page_to, c.content_enc, m.filename_enc
    from app.material_chunks c
    join app.materials m on m.id = c.material_id
    where c.course_id = ${courseId}
    order by c.embedding <=> ${toVector(vec)}::vector
    limit ${k}`.execute(trx);

  const key = await ctx.keys.get(trx, userId);
  return rows.rows.map((r, i) => {
    const pf = r.page_from ?? 1;
    const pt = r.page_to ?? pf;
    return {
      label: `M${i + 1}`,
      source: openText(key, r.filename_enc, "material.filename", userId, r.material_id) ?? "course material",
      pages: pf === pt ? `p. ${pf}` : `pp. ${pf}-${pt}`,
      text: openText(key, r.content_enc, "chunk", userId, r.id) ?? "",
    };
  });
}
