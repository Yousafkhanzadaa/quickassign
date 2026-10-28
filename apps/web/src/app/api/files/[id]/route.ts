import { getBlob, openText, withTenant } from "@qa/core";
import { z } from "zod";
import { db, keys } from "@/lib/server";
import { sessionUserId } from "@/lib/session";
import { contentDisposition } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** Downloads one of the signed-in student's own files (row-level security enforces ownership). */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await sessionUserId();
  if (!userId) return new Response("unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return new Response("not found", { status: 404 });

  const file = await withTenant(db(), userId, async (trx) => {
    const blob = await getBlob(trx, keys(), userId, id);
    if (!blob) return null;
    let name = "file";
    if (blob.purpose === "solution_pdf" || blob.purpose === "solution_docx") {
      const sol = await trx
        .selectFrom("app.solutions")
        .innerJoin("app.tasks", "app.tasks.id", "app.solutions.task_id")
        .select(["app.tasks.short_no", "app.solutions.version"])
        .where((eb) => eb.or([eb("app.solutions.pdf_blob_id", "=", id), eb("app.solutions.docx_blob_id", "=", id)]))
        .executeTakeFirst();
      const ext = blob.purpose === "solution_pdf" ? "pdf" : "docx";
      name = sol ? `QuickAssign-${sol.short_no}-v${sol.version}.${ext}` : `solution.${ext}`;
    } else if (blob.purpose === "material") {
      const m = await trx.selectFrom("app.materials").select(["id", "filename_enc"]).where("blob_id", "=", id).executeTakeFirst();
      if (m) name = openText(await keys().get(trx, userId), m.filename_enc, "material.filename", userId, m.id) ?? name;
    } else {
      const tf = await trx.selectFrom("app.task_files").select(["id", "filename_enc"]).where("blob_id", "=", id).executeTakeFirst();
      if (tf) name = openText(await keys().get(trx, userId), tf.filename_enc, "task_file.filename", userId, tf.id) ?? name;
    }
    return { ...blob, name };
  });
  if (!file) return new Response("not found", { status: 404 });

  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mime,
      "Content-Disposition": contentDisposition(file.name),
      "Content-Length": String(file.data.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
