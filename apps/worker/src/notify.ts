// Text of every message QuickAssign sends to the student's own WhatsApp chat.
// WhatsApp formatting: *bold*, _italic_. Messages stay short and never include
// other people's names or numbers.
import type { TaskKind } from "@qa/core";
import { formatLocal } from "./deadline.js";

const SIG = "🤖 QuickAssign";

interface TaskInfo {
  shortNo: number;
  title: string;
  kind: TaskKind;
  course?: string | null;
  deadline?: Date | null;
}

function due(deadline: Date | null | undefined, tz: string): string {
  return deadline ? formatLocal(deadline, tz) : "not stated";
}

export function newTaskNotice(t: TaskInfo, tz: string): string {
  return [
    `${SIG} · 📌 *New ${t.kind} detected* (#${t.shortNo})`,
    `*${t.title}*`,
    t.course ? `Course: ${t.course}` : null,
    `Due: ${due(t.deadline, tz)}`,
    "",
    "Reply to this message with *solve* for a worked solution (1 credit), or *skip* to ignore.",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

export function needsContentNotice(t: TaskInfo, tz: string, appUrl: string): string {
  return [
    `${SIG} · 📎 *${t.title}* (#${t.shortNo})`,
    `Due: ${due(t.deadline, tz)}`,
    "The assignment itself seems to be on your portal, not in the group.",
    `Upload the file on your dashboard to get a worked solution: ${appUrl}/tasks`,
  ].join("\n");
}

export function examNotice(t: TaskInfo, tz: string): string {
  return [
    `${SIG} · 🗓️ *${t.kind === "quiz" ? "Quiz" : "Exam"} noted* (#${t.shortNo})`,
    `*${t.title}*`,
    `When: ${due(t.deadline, tz)}`,
    "I'll remind you before it. (Quizzes and exams are never solved; that's your moment.)",
  ].join("\n");
}

export function deadlineChangedNotice(t: TaskInfo, tz: string): string {
  return `${SIG} · ⏰ *Deadline update* for #${t.shortNo} ${t.title}\nNew due date: *${due(t.deadline, tz)}*`;
}

export function solutionCaption(t: TaskInfo, tz: string, notes: string[]): string {
  const lines = [
    `${SIG} · ✅ *Worked solution* #${t.shortNo}`,
    `*${t.title}*`,
    `Due: ${due(t.deadline, tz)}`,
  ];
  if (notes.length > 0) lines.push("", ...notes.slice(0, 3).map((n) => `⚠️ ${n}`));
  lines.push("", "Study the steps and write your own submission. An editable DOCX is on your dashboard.");
  return lines.join("\n").slice(0, 1000);
}

export function reminderNotice(t: TaskInfo, tz: string, label: string): string {
  return `${SIG} · ⏰ *Reminder:* #${t.shortNo} ${t.title} is due in ${label} (${due(t.deadline, tz)}).`;
}

export function failureNotice(shortNo: number, reason: string): string {
  return `${SIG} · ⚠️ Couldn't prepare #${shortNo}: ${reason}. No credit was used.`;
}

export function noCreditsNotice(shortNo: number, appUrl: string): string {
  return `${SIG} · You're out of credits, so #${shortNo} wasn't solved. Top up at ${appUrl}/billing`;
}

export function helpText(appUrl: string): string {
  return [
    `${SIG} · *Commands*`,
    "Reply *solve* or *skip* to an assignment notice.",
    "Or type: *qa solve 12*, *qa skip 12*, *qa status*.",
    `Dashboard: ${appUrl}`,
  ].join("\n");
}

export function statusText(tasks: Array<TaskInfo & { status: string }>, tz: string, appUrl: string): string {
  if (tasks.length === 0) return `${SIG} · No open tasks. 🎉\n${appUrl}`;
  const lines = tasks.slice(0, 10).map((t) => `#${t.shortNo} ${t.title} · ${t.status.replace(/_/g, " ")} · due ${due(t.deadline, tz)}`);
  return [`${SIG} · *Open tasks*`, ...lines, appUrl].join("\n");
}
