import { openText, withTenant } from "@qa/core";
import Link from "next/link";
import { Notice, PageHeader } from "@/components/ui";
import { setGroupMonitoring, setSenderRole } from "@/lib/actions/groups";
import { db, keys } from "@/lib/server";
import { requireProfile } from "@/lib/session";
import { RefreshGroupsButton } from "./refresh";

export const metadata = { title: "Groups" };
export const dynamic = "force-dynamic";

const ROLES = [
  ["unknown", "Unknown"],
  ["instructor", "Instructor"],
  ["ta", "TA"],
  ["class_rep", "Class rep (CR)"],
  ["student", "Student"],
] as const;

export default async function GroupsPage() {
  const { user } = await requireProfile();
  const data = await withTenant(db(), user.id, async (trx) => {
    const link = await trx.selectFrom("app.wa_links").select("status").executeTakeFirst();
    const groups = await trx
      .selectFrom("app.wa_groups")
      .selectAll()
      .where("left_at", "is", null)
      .where("is_community_parent", "=", false)
      .orderBy("monitored", "desc")
      .orderBy("name")
      .execute();
    const courses = await trx.selectFrom("app.courses").select(["id", "name", "code"]).orderBy("name").execute();
    const monitoredJids = groups.filter((g) => g.monitored).map((g) => g.group_jid);
    const senders = monitoredJids.length
      ? await trx
          .selectFrom("app.group_senders")
          .selectAll()
          .where("group_jid", "in", monitoredJids)
          .orderBy("message_count", "desc")
          .execute()
      : [];
    const key = await keys().get(trx, user.id);
    return {
      linked: link?.status === "linked",
      groups,
      courses,
      senders: senders.map((s) => ({
        ...s,
        name: openText(key, s.display_name_enc, "sender.name", user.id, `${s.group_jid}:${s.sender_hash}`) ?? "Unknown",
      })),
    };
  });

  return (
    <>
      <PageHeader title="Class groups" subtitle="Switch on only your class groups. QuickAssign ignores everything else." action={data.linked ? <RefreshGroupsButton /> : undefined} />
      {!data.linked && (
        <div className="mb-4">
          <Notice tone="warn">
            <Link className="link" href="/whatsapp">Link WhatsApp</Link> first to see your groups.
          </Notice>
        </div>
      )}
      {data.linked && data.groups.length === 0 && <Notice>No groups yet. Tap &ldquo;Refresh groups&rdquo;.</Notice>}
      {data.courses.length === 0 && data.groups.length > 0 && (
        <div className="mb-4">
          <Notice>
            Tip: <Link className="link" href="/courses">create your courses</Link> and map each group to one, so solutions use the right
            slides and notation.
          </Notice>
        </div>
      )}

      <ul className="space-y-3">
        {data.groups.map((g) => {
          const senders = data.senders.filter((s) => s.group_jid === g.group_jid).slice(0, 8);
          return (
            <li key={g.id} className="card">
              <form action={setGroupMonitoring} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="group_id" value={g.id} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{g.name ?? "Unnamed group"}</p>
                  <p className="text-xs text-slate-500">
                    {g.participant_count ?? "?"} members{g.is_announcement ? " · announcements only" : ""}
                  </p>
                </div>
                <select name="course_id" defaultValue={g.course_id ?? ""} className="input w-auto max-w-56 py-2 text-sm" aria-label="Course">
                  <option value="">No course</option>
                  {data.courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code ? `${c.code} · ` : ""}
                      {c.name}
                    </option>
                  ))}
                </select>
                <select name="monitored" defaultValue={g.monitored ? "on" : "off"} className="input w-auto py-2 text-sm" aria-label="Watch this group">
                  <option value="on">Watching</option>
                  <option value="off">Ignored</option>
                </select>
                <button className="btn-secondary py-2">Save</button>
              </form>
              {g.monitored && senders.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-slate-600">Who posts assignments here? ({senders.length} people)</summary>
                  <ul className="mt-2 space-y-2">
                    {senders.map((s) => (
                      <li key={s.sender_hash}>
                        <form action={setSenderRole} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="group_jid" value={s.group_jid} />
                          <input type="hidden" name="sender_hash" value={s.sender_hash} />
                          <span className="min-w-0 flex-1 truncate">
                            {s.name}
                            {s.is_admin && <span className="badge ml-2 bg-slate-100 text-slate-600">admin</span>}
                          </span>
                          <select name="role" defaultValue={s.role} className="input w-auto py-1.5 text-sm" aria-label={`Role of ${s.name}`}>
                            {ROLES.map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                          </select>
                          <button className="btn-secondary py-1.5">Set</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
