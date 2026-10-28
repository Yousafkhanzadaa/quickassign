"use server";
import { audit, withTenant } from "@qa/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "../server";
import { requireProfile } from "../session";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

const CourseInput = z.object({
  name: z.string().trim().min(1).max(160),
  code: text(40),
  instructor: text(120),
  notes: text(4000),
  auto_solve: z.enum(["inherit", "on", "off"]).default("inherit"),
});

function autoSolveValue(v: "inherit" | "on" | "off"): boolean | null {
  return v === "inherit" ? null : v === "on";
}

export async function createCourse(formData: FormData): Promise<void> {
  const { user } = await requireProfile();
  const p = CourseInput.safeParse(Object.fromEntries(formData));
  if (!p.success) return;
  const id = await withTenant(db(), user.id, async (trx) => {
    const row = await trx
      .insertInto("app.courses")
      .values({ user_id: user.id, name: p.data.name, code: p.data.code, instructor: p.data.instructor, notes: p.data.notes, auto_solve: autoSolveValue(p.data.auto_solve) })
      .returning("id")
      .executeTakeFirstOrThrow();
    await audit(trx, user.id, "user", "course_created", {});
    return row.id;
  });
  redirect(`/courses/${id}`);
}

export async function updateCourse(formData: FormData): Promise<void> {
  const { user } = await requireProfile();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const p = CourseInput.safeParse(Object.fromEntries(formData));
  if (!id.success || !p.success) return;
  await withTenant(db(), user.id, (trx) =>
    trx
      .updateTable("app.courses")
      .set({ name: p.data.name, code: p.data.code, instructor: p.data.instructor, notes: p.data.notes, auto_solve: autoSolveValue(p.data.auto_solve), updated_at: new Date() })
      .where("id", "=", id.data)
      .execute(),
  );
  revalidatePath(`/courses/${id.data}`);
}

export async function deleteCourse(formData: FormData): Promise<void> {
  const { user } = await requireProfile();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  await withTenant(db(), user.id, async (trx) => {
    // Delete material blobs first (cascades to materials and their chunks).
    const mats = await trx.selectFrom("app.materials").select("blob_id").where("course_id", "=", id.data).execute();
    if (mats.length > 0) await trx.deleteFrom("app.blobs").where("id", "in", mats.map((m) => m.blob_id)).execute();
    await trx.deleteFrom("app.courses").where("id", "=", id.data).execute();
    await audit(trx, user.id, "user", "course_deleted", {});
  });
  redirect("/courses");
}

export async function deleteMaterial(formData: FormData): Promise<void> {
  const { user } = await requireProfile();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const courseId = await withTenant(db(), user.id, async (trx) => {
    const m = await trx.selectFrom("app.materials").select(["blob_id", "course_id"]).where("id", "=", id.data).executeTakeFirst();
    if (!m) return null;
    await trx.deleteFrom("app.blobs").where("id", "=", m.blob_id).execute(); // cascades to material + chunks
    return m.course_id;
  });
  if (courseId) revalidatePath(`/courses/${courseId}`);
}
