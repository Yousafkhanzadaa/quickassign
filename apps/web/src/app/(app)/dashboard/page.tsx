import { withTenant } from "@qa/core";
import Link from "next/link";
import { IconArrowRight, IconBook, IconCheck, IconPlus, IconQr, IconSparkle, IconUsers } from "@/components/icons";
import { formatPk, PageHeader, TaskStatusBadge, WaStatusBadge } from "@/components/ui";
import { db } from "@/lib/server";
import { requireProfile } from "@/lib/session";

export const metadata = { title: "Home" };

export default async function Dashboard() {
  const { user, profile } = await requireProfile();
  const data = await withTenant(db(), user.id, async (trx) => {
    const link = await trx.selectFrom("app.wa_links").selectAll().executeTakeFirst();
    const monitored = await trx.selectFrom("app.wa_groups").select((eb) => eb.fn.countAll<string>().as("n")).where("monitored", "=", true).executeTakeFirstOrThrow();
    const courses = await trx.selectFrom("app.courses").select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow();
    const delivered = await trx.selectFrom("app.tasks").select((eb) => eb.fn.countAll<string>().as("n")).where("status", "=", "delivered").executeTakeFirstOrThrow();
    const upcoming = await trx
      .selectFrom("app.tasks")
      .select(["id", "short_no", "title", "status", "deadline_at", "kind"])
      .where("status", "not in", ["skipped"])
      .where((eb) => eb.or([eb("deadline_at", "is", null), eb("deadline_at", ">", new Date(Date.now() - 24 * 3600_000))]))
      .orderBy("deadline_at", (ob) => ob.asc().nullsLast())
      .limit(8)
      .execute();
    return { link, monitored: Number(monitored.n), courses: Number(courses.n), delivered: Number(delivered.n), upcoming };
  });
  const status = data.link?.status ?? "unlinked";
  const steps = [
    { done: status === "linked", title: "Link your WhatsApp", body: "Scan a QR code, like WhatsApp Web.", href: "/whatsapp", icon: IconQr },
    { done: data.monitored > 0, title: "Choose your class groups", body: "Only the groups you switch on are read.", href: "/groups", icon: IconUsers },
    { done: data.courses > 0, title: "Add courses and slides", body: "Solutions cite your own material.", href: "/courses", icon: IconBook },
    { done: data.delivered > 0, title: "Get your first worked solution", body: "Reply solve in WhatsApp, or add a task here.", href: "/tasks", icon: IconSparkle },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const openTasks = data.upcoming.filter((t) => t.status !== "delivered").length;

  return (
    <>
      <PageHeader
        title={`Salaam, ${profile.full_name.split(" ")[0]}`}
        subtitle="Here's what's coming up."
        action={
          <Link href="/tasks/new" className="btn-secondary">
            <IconPlus className="size-4" />
            Add a task
          </Link>
        }
      />

      {doneCount < steps.length && (
        <section className="card mb-6 p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5">
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-950">Get started</h2>
              <p className="text-sm text-slate-500">
                {doneCount} of {steps.length} done
              </p>
            </div>
            <div className="h-2 w-40 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
              <div className={`h-full rounded-full bg-brand-500 ${["w-0", "w-1/4", "w-2/4", "w-3/4", "w-full"][doneCount]}`} />
            </div>
          </div>
          <ol className="mt-4 grid border-t border-slate-100 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <li key={s.title} className="border-slate-100 max-lg:border-b lg:border-r lg:last:border-r-0">
                <Link href={s.href} className="group flex h-full flex-col gap-3 p-5 transition hover:bg-slate-50">
                  <span
                    className={`grid size-9 place-items-center rounded-xl ${s.done ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 group-hover:bg-brand-50 group-hover:text-brand-700"}`}
                  >
                    {s.done ? <IconCheck className="size-4" /> : <s.icon className="size-4" />}
                  </span>
                  <span>
                    <span className={`block text-sm font-semibold ${s.done ? "text-slate-400 line-through" : "text-slate-900"}`}>
                      {i + 1}. {s.title}
                    </span>
                    <span className="mt-0.5 block text-sm text-slate-500">{s.body}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/whatsapp" className="card group transition hover:border-slate-300">
          <p className="text-sm text-slate-500">WhatsApp</p>
          <div className="mt-2.5">
            <WaStatusBadge status={status} />
          </div>
        </Link>
        <Link href="/groups" className="card group transition hover:border-slate-300">
          <p className="text-sm text-slate-500">Groups watched</p>
          <p className="mt-1 font-display text-3xl font-bold text-slate-950">{data.monitored}</p>
        </Link>
        <Link href="/tasks" className="card group transition hover:border-slate-300">
          <p className="text-sm text-slate-500">Open tasks</p>
          <p className="mt-1 font-display text-3xl font-bold text-slate-950">{openTasks}</p>
        </Link>
      </div>

      <section className="card mt-6 p-0">
        <div className="flex items-center justify-between px-6 pt-5">
          <h2 className="font-display text-lg font-semibold text-slate-950">Upcoming</h2>
          <Link href="/tasks" className="link inline-flex items-center gap-1 text-sm">
            All tasks <IconArrowRight className="size-3.5" />
          </Link>
        </div>
        {data.upcoming.length === 0 ? (
          <p className="px-6 pt-2 pb-6 text-sm text-slate-600">Nothing yet. New assignments from your groups will appear here.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
            {data.upcoming.map((t) => (
              <li key={t.id}>
                <Link href={`/tasks/${t.id}`} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3.5 transition hover:bg-slate-50">
                  <span className="font-medium text-slate-900">
                    <span className="text-slate-400">#{t.short_no}</span> {t.title}
                  </span>
                  <span className="flex items-center gap-2 text-sm text-slate-600">
                    {formatPk(t.deadline_at, profile.timezone)} <TaskStatusBadge status={t.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
