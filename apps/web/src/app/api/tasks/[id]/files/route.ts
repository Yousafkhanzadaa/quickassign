import { randomUUID } from "node:crypto";
import { audit, putBlob, sealText, withTenant } from "@qa/core";
import { z } from "zod";
import { db, keys } from "@/lib/server";
import { sessionUserId } from "@/lib/session";
import { cleanFileName, MAX_UPLOAD_BYTES, sniffUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["pdf", "docx", "pptx", "jpeg", "png", "text"]);

/** Attaches the assignment file to a task (e.g. when it was posted on the university portal). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await sessionUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id: taskId } = await ctx.params;
  if (!z.string().uuid().safeParse(taskId).success) return Response.json({ error: "not found" }, { status: 404 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) return Response.json({ error: "File is larger than 20 MB." }, { status: 413 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_UPLOAD_BYTES) return Response.json({ error: "Choose a file up to 20 MB." }, { status: 400 });
  const data = Buffer.from(await file.arrayBuffer());
  const type = sniffUpload(data);
  if (!type || !ALLOWED.has(type.kind)) return Response.json({ error: "Upload a PDF, DOCX, PPTX, image or TXT file." }, { status: 415 });
  const fileName = cleanFileName(file.name, `assignment.${type.kind}`);

  const ok = await withTenant(db(), userId, async (trx) => {
    const task = await trx.selectFrom("app.tasks").select(["id", "status"]).where("id", "=", taskId).executeTakeFirst();
    if (!task) return false;
    const count = await trx.selectFrom("app.task_files").select((eb) => eb.fn.countAll<string>().as("n")).where("task_id", "=", taskId).executeTakeFirstOrThrow();
    if (Number(count.n) >= 5) return false;
    const key = await keys().get(trx, userId);
    const blobId = await putBlob(trx, keys(), userId, "attachment", type.mime, data);
    const id = randomUUID();
    await trx
      .insertInto("app.task_files")
      .values({ id, user_id: userId, task_id: taskId, blob_id: blobId, filename_enc: sealText(key, fileName, "task_file.filename", userId, id)!, mime: type.mime })
      .execute();
    await audit(trx, userId, "user", "task_file_uploaded", { bytes: data.length, kind: type.kind });
    return true;
  });
  if (!ok) return Response.json({ error: "Task not found or it already has 5 files." }, { status: 400 });
  return Response.json({ ok: true });
}
