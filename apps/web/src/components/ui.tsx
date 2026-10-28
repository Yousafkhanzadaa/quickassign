import type { TaskStatus, WaStatus } from "@qa/core";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-slate-950">{title}</h1>
        {subtitle && <p className="mt-1.5 text-slate-600">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "success"; children: React.ReactNode }) {
  const tones = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-900",
    success: "border-brand-100 bg-brand-50 text-brand-900",
  };
  return <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
}

const TASK_STATUS: Record<TaskStatus, { label: string; cls: string }> = {
  awaiting_confirmation: { label: "Needs your OK", cls: "bg-amber-100 text-amber-800" },
  queued: { label: "Queued", cls: "bg-sky-100 text-sky-800" },
  solving: { label: "Solving…", cls: "bg-sky-100 text-sky-800" },
  delivered: { label: "Delivered", cls: "bg-brand-100 text-brand-800" },
  skipped: { label: "Skipped", cls: "bg-slate-100 text-slate-600" },
  failed: { label: "Failed", cls: "bg-red-100 text-red-800" },
  reminder_only: { label: "Reminder", cls: "bg-violet-100 text-violet-800" },
  needs_content: { label: "Needs file", cls: "bg-amber-100 text-amber-800" },
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const s = TASK_STATUS[status];
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

const WA_STATUS: Record<WaStatus, { label: string; cls: string }> = {
  unlinked: { label: "Not linked", cls: "bg-slate-100 text-slate-700" },
  pairing: { label: "Linking…", cls: "bg-sky-100 text-sky-800" },
  linked: { label: "Linked", cls: "bg-brand-100 text-brand-800" },
  logged_out: { label: "Logged out", cls: "bg-amber-100 text-amber-800" },
  temp_banned: { label: "Restricted by WhatsApp", cls: "bg-red-100 text-red-800" },
  error: { label: "Needs attention", cls: "bg-red-100 text-red-800" },
};

export function WaStatusBadge({ status }: { status: WaStatus }) {
  const s = WA_STATUS[status];
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

export function formatPk(date: Date | null | undefined, tz = "Asia/Karachi"): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(date);
}
