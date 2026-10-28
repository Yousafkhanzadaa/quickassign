import { openText, withTenant } from "@qa/core";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/ui";
import { deleteCourse, deleteMaterial, updateCourse } from "@/lib/actions/courses";
import { db, keys } from "@/lib/server";
import { requireProfile } from "@/lib/session";
import { MaterialUpload } from "./upload";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { uploaded: "Waiting", processing: "Reading…", ready: "Ready", failed: "Failed" };

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { user } = await requireProfile();
  const data = await withTenant(db(), user.id, async (trx) => {
    const course = await trx.selectFrom("app.courses").selectAll().where("id", "=", id).executeTakeFirst();
    if (!course) return null;
    const key = await keys().get(trx, user.id);
    const materials = await trx.selectFrom("app.materials").selectAll().where("course_id", "=", id).orderBy("created_at", "desc").execute();
    return {
      course,
      materials: materials.map((m) => ({ ...m, name: openText(key, m.filename_enc, "material.filename", user.id, m.id) ?? "file" })),
    };
  });
  if (!data) notFound();
  const { course, materials } = data;
  const auto = course.auto_solve === null ? "inherit" : course.auto_solve ? "on" : "off";

  return (
    <>
      <PageHeader title={course.name} subtitle={course.code ?? undefined} />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-4">
          <h2 className="font-semibold">Course material</h2>
          <p className="text-sm text-slate-600">
            Upload lecture slides, notes, the syllabus or past solutions (PDF, DOCX, PPTX or TXT, up to 20 MB). They&apos;re encrypted and
            only used for your solutions.
          </p>
          <MaterialUpload courseId={course.id} />
          <ul className="divide-y divide-slate-100 text-sm">
            {materials.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                <a className="link min-w-0 truncate" href={`/api/files/${m.blob_id}`}>
                  {m.name}
                </a>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-slate-500" title={m.error ?? undefined}>
                    {STATUS[m.status]}
                    {m.page_count ? ` · ${m.page_count} p.` : ""}
                  </span>
                  <form action={deleteMaterial}>
                    <input type="hidden" name="id" value={m.id} />
                    <button className="text-xs text-red-700 hover:underline">Remove</button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <form action={updateCourse} className="card space-y-3">
          <h2 className="font-semibold">Details</h2>
          <input type="hidden" name="id" value={course.id} />
          <label className="label" htmlFor="name">Name</label>
          <input id="name" name="name" className="input" defaultValue={course.name} required maxLength={160} />
          <label className="label" htmlFor="code">Code</label>
          <input id="code" name="code" className="input" defaultValue={course.code ?? ""} maxLength={40} />
          <label className="label" htmlFor="instructor">Instructor</label>
          <input id="instructor" name="instructor" className="input" defaultValue={course.instructor ?? ""} maxLength={120} />
          <label className="label" htmlFor="notes">Conventions for solutions (optional)</label>
          <textarea
            id="notes"
            name="notes"
            className="input min-h-24"
            defaultValue={course.notes ?? ""}
            maxLength={4000}
            placeholder="e.g. Use C++ not Java; show units in SI; follow the textbook's notation."
          />
          <label className="label" htmlFor="auto_solve">When an assignment is detected</label>
          <select id="auto_solve" name="auto_solve" className="input" defaultValue={auto}>
            <option value="inherit">Use my default (Settings)</option>
            <option value="off">Ask me first</option>
            <option value="on">Solve automatically (uses 1 credit each)</option>
          </select>
          <button className="btn-primary">Save</button>
        </form>
      </div>
      <form action={deleteCourse} className="mt-8">
        <input type="hidden" name="id" value={course.id} />
        <button className="text-sm text-red-700 hover:underline">Delete course and its files</button>
      </form>
    </>
  );
}
