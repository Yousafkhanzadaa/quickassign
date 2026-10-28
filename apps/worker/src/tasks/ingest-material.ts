import { randomUUID } from "node:crypto";
import type { Task } from "graphile-worker";
import { audit, getBlob, openText, sealText, toVector, withTenant } from "@qa/core";
import { z } from "zod";
import { chunkPages } from "../chunk.js";
import type { Ctx } from "../context.js";
import { LlmUnavailableError } from "../llm/openai.js";
import { parsePayload } from "../util.js";

const Payload = z.object({ user_id: z.string(), material_id: z.string().uuid() });
const MAX_CHUNKS = 1500;

/** Extracts text (in the sandbox), chunks, embeds and stores course material. */
export const ingestMaterial =
  (ctx: Ctx): Task =>
  async (payload) => {
    const { user_id, material_id } = parsePayload(Payload, payload);
    const loaded = await withTenant(ctx.db, user_id, async (trx) => {
      const m = await trx.selectFrom("app.materials").selectAll().where("id", "=", material_id).executeTakeFirst();
      if (!m) return null;
      const key = await ctx.keys.get(trx, user_id);
      const blob = await getBlob(trx, ctx.keys, user_id, m.blob_id);
      if (!blob) return null;
      return { m, data: blob.data, fileName: openText(key, m.filename_enc, "material.filename", user_id, m.id) ?? "material" };
    });
    if (!loaded) return;

    const fail = async (error: string) => {
      await withTenant(ctx.db, user_id, (trx) =>
        trx.updateTable("app.materials").set({ status: "failed", error }).where("id", "=", material_id).execute(),
      );
    };

    try {
      const extracted = await ctx.sandbox.extract(loaded.fileName, loaded.data);
      const chunks = chunkPages(extracted.pages).slice(0, MAX_CHUNKS);
      if (chunks.length === 0) {
        await fail("No text found. Scanned PDFs (images of pages) aren't supported yet.");
        return;
      }
      const vectors = await ctx.llm.embed(user_id, ctx.cfg.OPENAI_EMBED_MODEL, chunks.map((c) => c.text));
      await withTenant(ctx.db, user_id, async (trx) => {
        const key = await ctx.keys.get(trx, user_id);
        await trx.deleteFrom("app.material_chunks").where("material_id", "=", material_id).execute();
        for (let i = 0; i < chunks.length; i += 100) {
          const rows = chunks.slice(i, i + 100).map((c, j) => {
            const id = randomUUID();
            return {
              id,
              user_id,
              course_id: loaded.m.course_id,
              material_id,
              chunk_index: c.index,
              page_from: c.pageFrom,
              page_to: c.pageTo,
              content_enc: sealText(key, c.text, "chunk", user_id, id)!,
              embedding: toVector(vectors[i + j]!),
            };
          });
          await trx.insertInto("app.material_chunks").values(rows).execute();
        }
        await trx
          .updateTable("app.materials")
          .set({ status: "ready", page_count: extracted.pages.length, error: extracted.truncated ? "Only the first part of this file was indexed." : null })
          .where("id", "=", material_id)
          .execute();
        await audit(trx, user_id, "worker", "material_indexed", { chunks: chunks.length });
      });
    } catch (err) {
      ctx.log.warn({ err: (err as Error).message }, "material ingest failed");
      await fail(
        err instanceof LlmUnavailableError
          ? "AI isn't configured yet, so this file can't be indexed. It will need re-uploading."
          : "We couldn't read this file. Try a PDF, DOCX or PPTX export.",
      );
    }
  };
