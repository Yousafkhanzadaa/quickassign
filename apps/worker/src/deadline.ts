// Converts the model's local deadline ("YYYY-MM-DDTHH:mm" in the student's timezone)
// into an absolute instant, and rejects implausible values.

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/;

/** Offset in minutes of timeZone at the given instant (e.g. Asia/Karachi -> +300). */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUTC - at.getTime()) / 60_000);
}

/**
 * Resolves a local wall-clock deadline in timeZone. Date-only values mean end of day
 * (23:59). Returns null if the value is malformed or outside [sentAt - 1 day, sentAt + 1 year].
 */
export function resolveDeadline(local: string | null | undefined, timeZone: string, sentAt: Date): Date | null {
  if (!local) return null;
  const m = LOCAL.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  const hour = hh === undefined ? 23 : Number(hh);
  const minute = mm === undefined ? 59 : Number(mm);
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31 || hour > 23 || minute > 59) return null;
  const wallAsUTC = Date.UTC(Number(y), Number(mo) - 1, Number(d), hour, minute);
  // Two-step offset resolution handles zones with DST correctly.
  let instant = wallAsUTC - tzOffsetMinutes(timeZone, new Date(wallAsUTC)) * 60_000;
  instant = wallAsUTC - tzOffsetMinutes(timeZone, new Date(instant)) * 60_000;
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  const min = sentAt.getTime() - 24 * 3600_000;
  const max = sentAt.getTime() + 366 * 24 * 3600_000;
  if (date.getTime() < min || date.getTime() > max) return null;
  return date;
}

/** Formats an instant for messages, e.g. "Mon 13 Oct, 11:59 PM". */
export function formatLocal(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/** "2026-10-05T14:30" style local timestamp the model can reason about. */
export function localStamp(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")} (${g("weekday")})`;
}
