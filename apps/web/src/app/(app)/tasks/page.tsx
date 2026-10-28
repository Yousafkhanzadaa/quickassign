import { withTenant } from "@qa/core";
import Link from "next/link";
import { formatPk, PageHeader, TaskStatusBadge } from "@/components/ui";
import { db } from "@/lib/server";
import { requireProfile } from "@/lib/session";

export const metadata = { title: "Tasks" };
export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const { user, profile } = await requireProfile();
  const tasks = await withTenant(db(), user.id, (trx) =>
    trx
      .selectFrom("app.tasks")
      .leftJoin("app.courses", "app.courses.id", "app.tasks.course_id")
      .select(["app.tasks.id", "short_no", "title", "kind", "status", "deadline_at", "app.courses.name as course"])
      .orderBy("app.tasks.created_at", "desc")
      .limit(100)
      .execute(),
  );
  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle="Assignments, quizzes and exams detected in your groups, plus ones you add yourself."
        action={
          <Link href="/tasks/new" className="btn-primary">
            Add task
          </Link>
        }
      />
      {tasks.length === 0 ? (
        <p className="card text-sm text-slate-600">No tasks yet.</p>
      ) : (
        <ul className="card divide-y divide-slate-100 p-0">
          {tasks.map((t) => (
            <li key={t.id}>
              <Link href={`/tasks/${t.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="font-medium">
                    <span className="text-slate-400">#{t.short_no}</span> {t.title}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {t.kind}
                    {t.course ? ` · ${t.course}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-sm text-slate-600">
                  {formatPk(t.deadline_at, profile.timezone)} <TaskStatusBadge status={t.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
