import { randomUUID } from "node:crypto";
import type { JobHelpers, Task } from "graphile-worker";
import { audit, getBlob, openText, putBlob, SandboxError, sealText, withTenant, type TasksTable } from "@qa/core";
import { sql, type Selectable } from "kysely";
import type { ResponseInputContent } from "openai/resources/responses/responses";
import { z } from "zod";
import type { Ctx } from "../context.js";
import { formatLocal } from "../deadline.js";
import { LlmUnavailableError } from "../llm/openai.js";
import { Repair, REPAIR_INSTRUCTIONS, SOLVE_INSTRUCTIONS } from "../llm/prompts.js";
import { findMath, mathAsCode, mathIssues, normalizeMathDelimiters, replaceMath, sanitizeMarkdown, validateTex } from "../markdown.js";
import { failureNotice, noCreditsNotice, solutionCaption } from "../notify.js";
import { retrieveExcerpts } from "../retrieval.js";
import { notify, parsePayload, scheduleReminders } from "../util.js";

const Payload = z.object({ user_id: z.string(), task_id: z.string().uuid() });

const DISCLOSURE =
  "This worked solution was prepared with AI assistance (QuickAssign) as a study aid. " +
  "Under HEC policy, if you use AI assistance in work you submit, disclose the tool and how you used it.";

const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;
const ATTACHMENT_TTL_MS = 30 * 24 * 3600_000;

type TaskRow = Selectable<TasksTable>;

export const solveTask =
  (ctx: Ctx): Task =>
  async (payload, helpers) => {
    const { user_id, task_id } = parsePayload(Payload, payload);

    const claim = await withTenant(ctx.db, user_id, async (trx) => {
      const t = await trx.selectFrom("app.tasks").selectAll().where("id", "=", task_id).forUpdate().executeTakeFirst();
      if (!t || t.status !== "queued") return null;
      if (t.kind === "quiz" || t.kind === "exam" || t.kind === "announcement") {
        await trx.updateTable("app.tasks").set({ status: "reminder_only", updated_at: new Date() }).where("id", "=", task_id).execute();
        return null;
      }
      // Reserve one credit now (from the grant expiring first); refunded if the solve fails.
      const reserved = await sql<{ grant: string | null }>`select app.reserve_credit(${task_id}::uuid) as grant`.execute(trx);
      if (!reserved.rows[0]?.grant) {
        await trx.updateTable("app.tasks").set({ status: "failed", last_error: "no_credits", updated_at: new Date() }).where("id", "=", task_id).execute();
        return { noCredits: true as const, task: t };
      }
      await trx.updateTable("app.tasks").set({ status: "solving", last_error: null, updated_at: new Date() }).where("id", "=", task_id).execute();
      return { noCredits: false as const, task: t };
    });
    if (!claim) return;
    if (claim.noCredits) {
      await notify(ctx, user_id, noCreditsNotice(claim.task.short_no, ctx.cfg.APP_BASE_URL), "no_credits", task_id);
      return;
    }

    try {
      await runSolve(ctx, helpers, user_id, claim.task);
    } catch (err) {
      const retryable = !(err instanceof LlmUnavailableError) && helpers.job.attempts < helpers.job.max_attempts;
      const reason = err instanceof LlmUnavailableError ? "AI is not configured yet" : "an internal error occurred";
      ctx.log.error({ tenant: user_id.slice(0, 8), task: claim.task.short_no, err: (err as Error).message, retryable }, "solve failed");
      await withTenant(ctx.db, user_id, async (trx) => {
        // Failed solves are free: return the reserved credit (a retry reserves again).
        await sql`select app.release_credit(${task_id}::uuid)`.execute(trx);
        await trx
          .updateTable("app.tasks")
          .set({ status: retryable ? "queued" : "failed", last_error: (err as Error).name.slice(0, 80), updated_at: new Date() })
          .where("id", "=", task_id)
          .execute();
      });
      if (retryable) throw err; // graphile-worker retries with backoff
      await notify(ctx, user_id, failureNotice(claim.task.short_no, reason), "failure", task_id);
    }
  };

async function runSolve(ctx: Ctx, helpers: JobHelpers, userId: string, task: TaskRow): Promise<void> {
  const warnings: string[] = [];

  // 1. Gather the task, its source messages, the student profile and the course.
  const g = await withTenant(ctx.db, userId, async (trx) => {
    const key = await ctx.keys.get(trx, userId);
    const profile = await trx.selectFrom("app.profiles").selectAll().where("user_id", "=", userId).executeTakeFirstOrThrow();
    const course = task.course_id ? await trx.selectFrom("app.courses").selectAll().where("id", "=", task.course_id).executeTakeFirst() : undefined;
    const ids = task.source_message_ids.length > 0 ? task.source_message_ids : ["00000000-0000-0000-0000-000000000000"];
    const msgs = await trx.selectFrom("app.inbound_messages").selectAll().where("id", "in", ids).where("revoked_at", "is", null).orderBy("sent_at").execute();
    const atts = await trx.selectFrom("app.attachments").select(["message_id", "blob_id"]).where("message_id", "in", ids).execute();
    const taskFiles = await trx.selectFrom("app.task_files").select(["id", "blob_id", "filename_enc"]).where("task_id", "=", task.id).execute();
    return {
      profile,
      course,
      summary: openText(key, task.summary_enc, "task.summary", userId, task.id) ?? "",
      deliverables: openText(key, task.deliverables_enc, "task.deliverables", userId, task.id) ?? "",
      messages: msgs.map((m) => {
        const rec = `${m.group_jid}:${m.wa_message_id}`;
        return {
          id: m.id,
          kind: m.kind,
          sentAt: m.sent_at,
          hasMedia: m.media_desc_enc !== null,
          mime: m.media_mime,
          text: openText(key, m.body_enc, "msg.body", userId, rec) ?? "",
          fileName: openText(key, m.media_filename_enc, "msg.filename", userId, rec),
        };
      }),
      attachmentBlobs: new Map(atts.map((a) => [a.message_id, a.blob_id])),
      taskFiles: taskFiles.map((f) => ({
        blobId: f.blob_id,
        fileName: openText(key, f.filename_enc, "task_file.filename", userId, f.id) ?? "attachment",
      })),
    };
  });
  const tz = g.profile.timezone;

  // 2. Download attachments on demand (only for tasks the student chose to solve).
  for (const m of g.messages) {
    if (!m.hasMedia || g.attachmentBlobs.has(m.id)) continue;
    try {
      const media = await ctx.gateway.fetchMedia(userId, m.id);
      const blobId = await withTenant(ctx.db, userId, async (trx) => {
        const id = await putBlob(trx, ctx.keys, userId, "attachment", media.mime, media.data, new Date(Date.now() + ATTACHMENT_TTL_MS));
        await trx.insertInto("app.attachments").values({ message_id: m.id, user_id: userId, blob_id: id }).onConflict((oc) => oc.column("message_id").doNothing()).execute();
        return id;
      });
      g.attachmentBlobs.set(m.id, blobId);
    } catch (err) {
      ctx.log.warn({ err: (err as Error).message }, "attachment download failed");
      warnings.push("One attachment couldn't be downloaded from WhatsApp; the solution may be incomplete.");
    }
  }

  // 3. Build the model input: brief, files, course excerpts.
  const parts: ResponseInputContent[] = [];
  const extracted: string[] = [];
  let totalBytes = 0;
  const sources = [
    ...g.messages.flatMap((m) => {
      const blobId = g.attachmentBlobs.get(m.id);
      return blobId ? [{ blobId, fileName: m.fileName }] : [];
    }),
    ...g.taskFiles.map((f) => ({ blobId: f.blobId, fileName: f.fileName })),
  ];
  for (const src of sources) {
    const blobId = src.blobId;
    const blob = await withTenant(ctx.db, userId, (trx) => getBlob(trx, ctx.keys, userId, blobId));
    if (!blob) continue;
    totalBytes += blob.data.length;
    if (totalBytes > MAX_ATTACHMENT_BYTES) {
      warnings.push("Some attachments were too large to include.");
      break;
    }
    const name = src.fileName ?? "attachment";
    if (blob.mime === "application/pdf") {
      parts.push({ type: "input_file", filename: name.endsWith(".pdf") ? name : `${name}.pdf`, file_data: `data:application/pdf;base64,${blob.data.toString("base64")}` });
    } else if (blob.mime.startsWith("image/")) {
      parts.push({ type: "input_image", image_url: `data:${blob.mime};base64,${blob.data.toString("base64")}`, detail: "high" });
    } else {
      try {
        const ext = await ctx.sandbox.extract(name, blob.data);
        extracted.push(`--- Attached file "${name}" (text extracted) ---\n${ext.pages.map((p) => p.text).join("\n\n").slice(0, 60_000)}`);
      } catch {
        warnings.push(`The attached file "${name}" couldn't be read.`);
      }
    }
  }

  const courseLabel = g.course ? [g.course.code, g.course.name].filter(Boolean).join(" ") : null;
  const excerpts = g.course
    ? await withTenant(ctx.db, userId, (trx) => retrieveExcerpts(ctx, trx, userId, g.course!.id, `${task.title}\n${g.summary}\n${g.deliverables}`))
    : [];
  const brief = [
    courseLabel ? `Course: ${courseLabel}${g.course?.instructor ? ` (instructor: ${g.course.instructor})` : ""}` : null,
    g.course?.notes ? `Student's notes about this course's conventions: ${g.course.notes}` : null,
    `Assignment title: ${task.title}`,
    task.deadline_at ? `Due: ${formatLocal(task.deadline_at, tz)}` : null,
    g.summary ? `What is required (summary): ${g.summary}` : null,
    g.deliverables ? `Deliverables:\n${g.deliverables}` : null,
    "Original messages from the class group:",
    ...g.messages.map((m) => `- [${formatLocal(m.sentAt, tz)}] ${m.text || `(${m.kind}${m.fileName ? `: ${m.fileName}` : ""})`}`),
    ...extracted,
    excerpts.length > 0 ? "Course material excerpts:" : "No course materials were uploaded for this course.",
    ...excerpts.map((e) => `[${e.label}] (${e.source}, ${e.pages})\n${e.text}`),
  ]
    .filter((l): l is string => l !== null)
    .join("\n\n");
  parts.unshift({ type: "input_text", text: brief });

  // 4. Solve.
  const raw = await ctx.llm.text({
    userId,
    kind: "solve",
    model: ctx.cfg.OPENAI_SOLVE_MODEL,
    effort: ctx.cfg.OPENAI_SOLVE_EFFORT,
    instructions: SOLVE_INSTRUCTIONS,
    input: [{ role: "user", content: parts }],
    maxOutputTokens: ctx.cfg.OPENAI_SOLVE_MAX_OUTPUT_TOKENS,
  });
  let markdown = sanitizeMarkdown(normalizeMathDelimiters(raw));
  markdown = await repairMath(ctx, userId, markdown, warnings);

  // 5. Render in the sandbox (PDF for WhatsApp, DOCX for editing).
  const meta = {
    title: task.title,
    university: g.profile.university ?? undefined,
    student_name: g.profile.full_name,
    roll_number: g.profile.roll_number ?? undefined,
    course: courseLabel ?? undefined,
    instructor: g.course?.instructor ?? undefined,
    due: task.deadline_at ? formatLocal(task.deadline_at, tz) : undefined,
    date: new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric" }).format(new Date()),
    disclosure: DISCLOSURE,
  };
  let rendered: { pdf?: Buffer; docx?: Buffer };
  try {
    rendered = await ctx.sandbox.render(markdown, meta, ["pdf", "docx"]);
  } catch (err) {
    if (!(err instanceof SandboxError)) throw err;
    ctx.log.warn({ code: err.code }, "render failed; retrying with math as plain text");
    const spans = findMath(markdown);
    markdown = replaceMath(markdown, new Map(spans.map((sp, i) => [i, mathAsCode(sp.tex, sp.display)])));
    warnings.push(spans.length > 0 ? "Formulas are shown as plain text in this version." : "Some formatting was simplified.");
    rendered = await ctx.sandbox.render(markdown, meta, ["pdf", "docx"]);
  }
  if (!rendered.pdf) throw new Error("renderer returned no PDF");

  // 6. Persist (encrypted) and charge one credit.
  const solutionId = randomUUID();
  await withTenant(ctx.db, userId, async (trx) => {
    const key = await ctx.keys.get(trx, userId);
    const pdfBlob = await putBlob(trx, ctx.keys, userId, "solution_pdf", "application/pdf", rendered.pdf!);
    const docxBlob = rendered.docx
      ? await putBlob(trx, ctx.keys, userId, "solution_docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", rendered.docx)
      : null;
    const prev = await trx.selectFrom("app.solutions").select((eb) => eb.fn.max("version").as("v")).where("task_id", "=", task.id).executeTakeFirst();
    await trx
      .insertInto("app.solutions")
      .values({
        id: solutionId,
        user_id: userId,
        task_id: task.id,
        version: (prev?.v ?? 0) + 1,
        model: ctx.cfg.OPENAI_SOLVE_MODEL,
        markdown_enc: sealText(key, markdown, "solution.md", userId, solutionId)!,
        pdf_blob_id: pdfBlob,
        docx_blob_id: docxBlob,
        warnings,
      })
      .execute();
    // The credit reserved at claim time is now spent for good.
    await trx.updateTable("app.tasks").set({ status: "delivered", credit_grant_id: null, updated_at: new Date() }).where("id", "=", task.id).execute();
    await audit(trx, userId, "worker", "solution_created", { task_no: task.short_no, warnings: warnings.length });
  });

  // 7. Deliver to the student's own chat (the dashboard always has it too).
  const info = { shortNo: task.short_no, title: task.title, kind: task.kind, course: courseLabel, deadline: task.deadline_at };
  try {
    const waId = await ctx.gateway.sendDocument(userId, {
      fileName: `QA-${task.short_no}-${slug(task.title)}.pdf`,
      mime: "application/pdf",
      caption: solutionCaption(info, tz, warnings),
      data: rendered.pdf,
    });
    await withTenant(ctx.db, userId, (trx) =>
      trx.insertInto("app.outbound_messages").values({ user_id: userId, wa_message_id: waId, kind: "solution", task_id: task.id }).execute(),
    );
  } catch (err) {
    ctx.log.warn({ err: (err as Error).message }, "WhatsApp delivery failed; solution is on the dashboard");
  }
  if (task.deadline_at) await scheduleReminders(helpers, userId, task.id, task.deadline_at);
}

/** Validates math with KaTeX; asks a small model to fix failures; falls back to code. */
async function repairMath(ctx: Ctx, userId: string, md: string, warnings: string[]): Promise<string> {
  const issues = mathIssues(md);
  if (issues.length === 0) return md;
  if (ctx.llm.enabled && issues.length <= 40) {
    try {
      const res = await ctx.llm.parse({
        userId,
        kind: "repair",
        model: ctx.cfg.OPENAI_REPAIR_MODEL,
        effort: "low",
        instructions: REPAIR_INSTRUCTIONS,
        input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(issues.map((i) => ({ index: i.index, tex: i.tex, error: i.error }))) }] }],
        schema: Repair,
        schemaName: "repair",
        maxOutputTokens: 4000,
      });
      const fixes = new Map<number, string>();
      for (const f of res.fixes) {
        const issue = issues.find((i) => i.index === f.index);
        if (issue && validateTex(f.tex, issue.display) === null) fixes.set(f.index, issue.display ? `$$${f.tex}$$` : `$${f.tex}$`);
      }
      md = replaceMath(md, fixes);
    } catch (err) {
      ctx.log.warn({ err: (err as Error).message }, "math repair failed");
    }
  }
  const remaining = mathIssues(md);
  if (remaining.length > 0) {
    md = replaceMath(md, new Map(remaining.map((i) => [i.index, mathAsCode(i.tex, i.display)])));
    warnings.push(`${remaining.length} formula(s) couldn't be typeset and are shown as plain text.`);
  }
  return md;
}

function slug(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "solution"
  );
}
