import { openText, withTenant } from "@qa/core";
import { notFound } from "next/navigation";
import { z } from "zod";
import { formatPk, Notice, PageHeader, TaskStatusBadge } from "@/components/ui";
import { db, keys } from "@/lib/server";
import { requireProfile } from "@/lib/session";
import { TaskActions, TaskFileUpload } from "./actions";

export const dynamic = "force-dynamic";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { user, profile } = await requireProfile();
  const tz = profile.timezone;

  const data = await withTenant(db(), user.id, async (trx) => {
    const t = await trx.selectFrom("app.tasks").selectAll().where("id", "=", id).executeTakeFirst();
    if (!t) return null;
    const key = await keys().get(trx, user.id);
    const course = t.course_id ? await trx.selectFrom("app.courses").select(["name", "code"]).where("id", "=", t.course_id).executeTakeFirst() : undefined;
    const msgs = t.source_message_ids.length
      ? await trx.selectFrom("app.inbound_messages").selectAll().where("id", "in", t.source_message_ids).orderBy("sent_at").execute()
      : [];
    const files = await trx.selectFrom("app.task_files").selectAll().where("task_id", "=", id).orderBy("created_at").execute();
    const solutions = await trx.selectFrom("app.solutions").select(["id", "version", "pdf_blob_id", "docx_blob_id", "warnings", "created_at"]).where("task_id", "=", id).orderBy("version", "desc").execute();
    return {
      t,
      course,
      summary: openText(key, t.summary_enc, "task.summary", user.id, t.id),
      deliverables: openText(key, t.deliverables_enc, "task.deliverables", user.id, t.id),
      messages: msgs.map((m) => {
        const rec = `${m.group_jid}:${m.wa_message_id}`;
        return {
          id: m.id,
          sentAt: m.sent_at,
          kind: m.kind,
          revoked: m.revoked_at !== null,
          text: openText(key, m.body_enc, "msg.body", user.id, rec),
          fileName: openText(key, m.media_filename_enc, "msg.filename", user.id, rec),
        };
      }),
      files: files.map((f) => ({ id: f.id, blobId: f.blob_id, name: openText(key, f.filename_enc, "task_file.filename", user.id, f.id) ?? "file" })),
      solutions,
    };
  });
  if (!data) notFound();
  const { t } = data;
  const isTest = t.kind === "quiz" || t.kind === "exam";

  return (
    <>
      <PageHeader title={`#${t.short_no} ${t.title}`} subtitle={[t.kind, data.course?.name].filter(Boolean).join(" · ")} />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <section className="card space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <TaskStatusBadge status={t.status} />
              <span>Due {formatPk(t.deadline_at, tz)}</span>
              {t.deadline_confidence !== null && t.deadline_confidence < 0.7 && <span className="text-amber-700">(deadline uncertain; double-check)</span>}
            </div>
            {data.summary && <p className="whitespace-pre-wrap text-sm text-slate-800">{data.summary}</p>}
            {data.deliverables && (
              <div>
                <h3 className="text-sm font-semibold">Deliverables</h3>
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {data.deliverables.split("\n").map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            )}
            {t.status === "failed" && (
              <Notice tone="warn">
                {t.last_error === "no_credits"
                  ? "You were out of credits when this was queued."
                  : t.last_error === "LlmUnavailableError"
                    ? "AI isn't configured on this server yet, so this couldn't be solved. You weren't charged."
                    : "The last attempt failed. You weren't charged; try again."}
              </Notice>
            )}
          </section>

          {data.messages.length > 0 && (
            <section className="card">
              <h2 className="font-semibold">From your class group</h2>
              <ul className="mt-3 space-y-3">
                {data.messages.map((m) => (
                  <li key={m.id} className="rounded-xl bg-slate-50 p-3 text-sm">
                    <p className="text-xs text-slate-500">{formatPk(m.sentAt, tz)}</p>
                    {m.revoked ? (
                      <p className="italic text-slate-500">This message was deleted by the sender.</p>
                    ) : (
                      <>
                        {m.fileName && <p className="font-medium">📎 {m.fileName}</p>}
                        {m.kind === "image" && !m.fileName && <p className="font-medium">🖼️ Image</p>}
                        {m.text && <p className="mt-1 whitespace-pre-wrap">{m.text}</p>}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card">
            <h2 className="font-semibold">Worked solutions</h2>
            {data.solutions.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">{isTest ? "Quizzes and exams are reminders only." : "No solution yet."}</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {data.solutions.map((s) => (
                  <li key={s.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-medium">Version {s.version}</span>
                      <span className="text-slate-500">{formatPk(s.created_at, tz)}</span>
                      {s.pdf_blob_id && (
                        <a className="link" href={`/api/files/${s.pdf_blob_id}`}>
                          PDF
                        </a>
                      )}
                      {s.docx_blob_id && (
                        <a className="link" href={`/api/files/${s.docx_blob_id}`}>
                          Editable DOCX
                        </a>
                      )}
                    </div>
                    {s.warnings.length > 0 && (
                      <ul className="mt-1 list-disc pl-5 text-xs text-amber-800">
                        {s.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-slate-500">
              Use solutions to learn the method, then write your own answer. If you use AI assistance in submitted work, disclose it as your
              university and HEC policy require.
            </p>
          </section>
        </div>

        <aside className="space-y-6">
          <TaskActions taskId={t.id} status={t.status} isTest={isTest} hasSolution={data.solutions.length > 0} />
          {!isTest && (
            <section className="card space-y-3">
              <h2 className="font-semibold">Assignment files</h2>
              <p className="text-sm text-slate-600">If the assignment is on your portal, upload it here (PDF, DOCX, PPTX or photo).</p>
              <ul className="text-sm">
                {data.files.map((f) => (
                  <li key={f.id}>
                    <a className="link" href={`/api/files/${f.blobId}`}>
                      {f.name}
                    </a>
                  </li>
                ))}
              </ul>
              <TaskFileUpload taskId={t.id} />
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
