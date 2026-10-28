"use server";
import { randomUUID } from "node:crypto";
import { audit, sealText, withTenant } from "@qa/core";
import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { creditBalance } from "../billing";
import { db, keys } from "../server";
import { requireProfile } from "../session";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function requestSolve(taskId: string): Promise<ActionResult> {
  const { user } = await requireProfile();
  if (!z.string().uuid().safeParse(taskId).success) return { ok: false, error: "Invalid task." };
  try {
    await withTenant(db(), user.id, async (trx) => {
      if ((await creditBalance(trx)) < 1) throw new Error("NO_CREDITS");
      await sql`select app.enqueue_solve(${taskId}::uuid)`.execute(trx);
      await audit(trx, user.id, "user", "solve_requested", { via: "dashboard" });
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "NO_CREDITS") return { ok: false, error: "You're out of credits. Buy a plan on the Credits page." };
    if (msg.includes("never solved")) return { ok: false, error: "Quizzes and exams are never solved." };
    return { ok: false, error: "Couldn't queue this task." };
  }
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

export async function skipTask(taskId: string): Promise<ActionResult> {
  const { user } = await requireProfile();
  if (!z.string().uuid().safeParse(taskId).success) return { ok: false, error: "Invalid task." };
  await withTenant(db(), user.id, (trx) => sql`select app.skip_task(${taskId}::uuid)`.execute(trx));
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

const Manual = z.object({
  title: z.string().trim().min(3).max(200),
  course_id: z.union([z.string().uuid(), z.literal("")]).transform((v) => (v === "" ? null : v)),
  // datetime-local in Pakistan time (UTC+5, no DST)
  deadline: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)),
  description: z.string().trim().max(8000),
});

export async function createManualTask(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user } = await requireProfile();
  const p = Manual.safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, error: "Add a title (3+ characters) and check the deadline." };
  const id = randomUUID();
  const deadline = p.data.deadline ? new Date(`${p.data.deadline}:00+05:00`) : null;
  await withTenant(db(), user.id, async (trx) => {
    const key = await keys().get(trx, user.id);
    const summary = sealText(key, p.data.description, "task.summary", user.id, id);
    await sql`select app.create_manual_task(${id}::uuid, ${p.data.title}, ${p.data.course_id}::uuid, ${deadline}::timestamptz, ${summary}::bytea)`.execute(trx);
  });
  redirect(`/tasks/${id}`);
}
