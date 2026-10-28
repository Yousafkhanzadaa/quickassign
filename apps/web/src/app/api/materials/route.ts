import { randomUUID } from "node:crypto";
import { audit, putBlob, sealText, withTenant } from "@qa/core";
import { sql } from "kysely";
import { z } from "zod";
import { db, keys } from "@/lib/server";
import { sessionUserId } from "@/lib/session";
import { cleanFileName, MAX_UPLOAD_BYTES, sniffUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["pdf", "docx", "pptx", "text"]);

/** Uploads course material (slides, notes, syllabus) for retrieval. */
export async function POST(request: Request) {
  const userId = await sessionUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) return Response.json({ error: "File is larger than 20 MB." }, { status: 413 });

  const form = await request.formData();
  const courseId = z.string().uuid().safeParse(form.get("course_id"));
  const file = form.get("file");
  if (!courseId.success || !(file instanceof File)) return Response.json({ error: "Choose a course and a file." }, { status: 400 });
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) return Response.json({ error: "File must be between 1 byte and 20 MB." }, { status: 413 });

  const data = Buffer.from(await file.arrayBuffer());
  const type = sniffUpload(data);
  if (!type || !ALLOWED.has(type.kind)) return Response.json({ error: "Upload a PDF, DOCX, PPTX or TXT file." }, { status: 415 });
  const fileName = cleanFileName(file.name, `material.${type.kind}`);

  const result = await withTenant(db(), userId, async (trx) => {
    const course = await trx.selectFrom("app.courses").select("id").where("id", "=", courseId.data).executeTakeFirst();
    if (!course) return null;
    const key = await keys().get(trx, userId);
    const blobId = await putBlob(trx, keys(), userId, "material", type.mime, data);
    const id = randomUUID();
    await trx
      .insertInto("app.materials")
      .values({ id, user_id: userId, course_id: course.id, filename_enc: sealText(key, fileName, "material.filename", userId, id)!, mime: type.mime, size: data.length, blob_id: blobId })
      .execute();
    await sql`select app.enqueue_material_ingest(${id}::uuid)`.execute(trx);
    await audit(trx, userId, "user", "material_uploaded", { bytes: data.length, kind: type.kind });
    return id;
  });
  if (!result) return Response.json({ error: "Course not found." }, { status: 404 });
  return Response.json({ id: result });
}
