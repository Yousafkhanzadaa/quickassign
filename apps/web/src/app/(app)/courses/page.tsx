import { withTenant } from "@qa/core";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { createCourse } from "@/lib/actions/courses";
import { db } from "@/lib/server";
import { requireProfile } from "@/lib/session";

export const metadata = { title: "Courses" };

export default async function CoursesPage() {
  const { user } = await requireProfile();
  const courses = await withTenant(db(), user.id, (trx) =>
    trx
      .selectFrom("app.courses")
      .leftJoin("app.materials", "app.materials.course_id", "app.courses.id")
      .select(["app.courses.id", "app.courses.name", "app.courses.code", "app.courses.instructor"])
      .select((eb) => eb.fn.count<string>("app.materials.id").as("materials"))
      .groupBy("app.courses.id")
      .orderBy("app.courses.name")
      .execute(),
  );
  return (
    <>
      <PageHeader title="Courses" subtitle="Upload slides, notes and the syllabus so solutions follow your course." />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <ul className="space-y-3">
          {courses.length === 0 && <li className="card text-sm text-slate-600">No courses yet. Add your first one.</li>}
          {courses.map((c) => (
            <li key={c.id}>
              <Link href={`/courses/${c.id}`} className="card block hover:border-brand-500">
                <p className="font-medium">
                  {c.code && <span className="text-slate-500">{c.code} · </span>}
                  {c.name}
                </p>
                <p className="text-sm text-slate-500">
                  {c.instructor ?? "Instructor not set"} · {Number(c.materials)} file{Number(c.materials) === 1 ? "" : "s"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
        <form action={createCourse} className="card h-fit space-y-3">
          <h2 className="font-semibold">Add a course</h2>
          <input name="name" className="input" placeholder="Course name, e.g. Data Structures" required maxLength={160} />
          <input name="code" className="input" placeholder="Code, e.g. CS201 (optional)" maxLength={40} />
          <input name="instructor" className="input" placeholder="Instructor (optional)" maxLength={120} />
          <input type="hidden" name="notes" value="" />
          <input type="hidden" name="auto_solve" value="inherit" />
          <button className="btn-primary w-full">Add course</button>
        </form>
      </div>
    </>
  );
}
