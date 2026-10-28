import { IconArrowRight, IconBell, IconCamera, IconCheck, IconFile, IconLock } from "@/components/icons";

// Decorative illustrations for the landing page, built from HTML so they stay crisp and
// need no images (the CSP allows images only from this site anyway).

const NOISE = [
  ["Hamza", "Kal class hogi?"],
  ["Sana", "😂😂😂"],
  ["Bilal", "Sir ne slides share ki hain kisi ke paas?"],
  ["Areeba", "Attendance kis ne lagwani hai"],
] as const;

/** A noisy class group with the one message that matters picked out. */
export function NoisyGroup() {
  return (
    <div className="relative" role="img" aria-label="A busy class WhatsApp group where QuickAssign picks out the assignment message">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-full bg-sky-100 text-xs font-bold text-sky-800">CS</div>
            <div>
              <p className="text-sm font-semibold text-slate-900">BSCS Fall · Section B</p>
              <p className="text-xs text-slate-500">148 members</p>
            </div>
          </div>
          <span className="rounded-full bg-brand-600 px-2.5 py-1 text-xs font-bold text-white">312 unread</span>
        </div>
        <div className="bg-chat space-y-2 px-4 py-5 text-[13px]">
          {NOISE.map(([who, text]) => (
            <div key={text} className="w-fit max-w-[85%] rounded-xl rounded-tl-sm bg-white/90 px-3 py-1.5 opacity-60 shadow-sm">
              <p className="text-[11px] font-semibold text-slate-500">{who}</p>
              <p className="text-slate-700">{text}</p>
            </div>
          ))}
          <div className="relative w-fit max-w-[92%] rounded-xl rounded-tl-sm bg-white px-3 py-2 shadow-md ring-2 ring-brand-500">
            <p className="text-[11px] font-semibold text-violet-700">Sir Ahmed</p>
            <p className="text-slate-900">
              Assignment 2 (Linked Lists) Friday 11:59 PM tak LMS pe submit karni hai. Questions attached 📎
            </p>
            <span className="absolute -top-3 -right-3 inline-flex items-center gap-1 rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white shadow">
              <IconCheck className="size-3" /> Caught
            </span>
          </div>
          <div className="w-fit max-w-[85%] rounded-xl rounded-tl-sm bg-white/90 px-3 py-1.5 opacity-60 shadow-sm">
            <p className="text-[11px] font-semibold text-slate-500">Usman</p>
            <p className="text-slate-700">voice note 🎤 0:42</p>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-8 left-6 right-6 rounded-2xl border border-brand-200 bg-white p-4 shadow-xl shadow-brand-900/10 sm:left-auto sm:-right-6 sm:w-72">
        <p className="eyebrow">Tracked by QuickAssign</p>
        <p className="mt-1.5 font-semibold text-slate-900">CS-201 · Assignment 2</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-600">
          <IconBell className="size-4 text-amber-600" /> Due Fri 11:59 PM · reminders set
        </p>
      </div>
    </div>
  );
}

/** Course files flowing into a cited solution. */
export function MaterialToAnswer() {
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto_1.2fr]" aria-hidden="true">
      <div className="space-y-2">
        {["Lecture 7 · Linked Lists.pdf", "CS-201 Syllabus.docx", "Week 6 notes.pptx"].map((f, i) => (
          <div key={f} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm">
            <IconFile className={`size-4 shrink-0 ${["text-red-500", "text-sky-600", "text-amber-600"][i]}`} />
            <span className="truncate">{f}</span>
          </div>
        ))}
      </div>
      <IconArrowRight className="mx-auto size-5 rotate-90 text-brand-600 sm:rotate-0" />
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
        <p className="text-xs font-semibold text-slate-900">Q2. Reverse a singly linked list in place.</p>
        <div className="mt-2.5 space-y-1.5">
          <div className="h-1.5 w-full rounded-full bg-slate-200" />
          <div className="h-1.5 w-11/12 rounded-full bg-slate-200" />
          <div className="h-1.5 w-4/5 rounded-full bg-slate-200" />
        </div>
        <p className="mt-2.5 rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-700">prev ← null; while (cur) …</p>
        <p className="mt-2.5 inline-flex rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-800">[M2] Lecture 7, slide 12</p>
      </div>
    </div>
  );
}

/** The kinds of posts QuickAssign understands. */
export function FormatChips() {
  const chips = [
    ["PDF", "bg-red-50 text-red-700 ring-red-200"],
    ["Photo of the board", "bg-sky-50 text-sky-700 ring-sky-200"],
    ["Slides", "bg-amber-50 text-amber-800 ring-amber-200"],
    ["Word file", "bg-indigo-50 text-indigo-700 ring-indigo-200"],
    ["Plain text", "bg-slate-50 text-slate-700 ring-slate-200"],
    ["Roman Urdu", "bg-brand-50 text-brand-800 ring-brand-200"],
  ] as const;
  return (
    <div className="flex flex-wrap gap-2" aria-hidden="true">
      {chips.map(([label, cls]) => (
        <span key={label} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${cls}`}>
          {label === "Photo of the board" ? <IconCamera className="size-3.5" /> : null}
          {label}
        </span>
      ))}
    </div>
  );
}

/** Reminder timeline before a deadline. */
export function ReminderTimeline() {
  const steps = [
    ["Mon", "Assignment spotted", "bg-brand-600"],
    ["Thu", "24 hours to go", "bg-amber-500"],
    ["Fri", "3 hours to go", "bg-red-500"],
  ] as const;
  return (
    <ol className="relative space-y-3 pl-5" aria-hidden="true">
      <span className="absolute top-1.5 bottom-1.5 left-[5px] w-px bg-slate-200" />
      {steps.map(([day, text, dot]) => (
        <li key={text} className="relative flex items-baseline gap-3 text-sm">
          <span className={`absolute top-1.5 -left-5 size-[11px] rounded-full ring-4 ring-white ${dot}`} />
          <span className="w-8 text-xs font-semibold text-slate-400">{day}</span>
          <span className="font-medium text-slate-800">{text}</span>
        </li>
      ))}
    </ol>
  );
}

/** A miniature of the solution PDF's first page. */
export function MiniPdf() {
  return (
    <div className="mx-auto w-full max-w-[15rem] rotate-1 rounded-lg border border-slate-200 bg-white p-4 shadow-lg shadow-slate-900/10" aria-hidden="true">
      <div className="flex items-start justify-between border-b border-slate-200 pb-2">
        <div>
          <p className="text-[10px] font-bold text-slate-900">Ayesha Khan · 21L-1234</p>
          <p className="text-[9px] text-slate-500">CS-201 Data Structures</p>
        </div>
        <p className="text-[9px] text-slate-400">Page 1 of 6</p>
      </div>
      <p className="mt-3 font-display text-[12px] font-bold text-slate-900">Assignment 3: Linked Lists</p>
      <p className="mt-2 text-center font-serif text-[13px] text-slate-800 italic">∑ i = n(n + 1) ⁄ 2</p>
      <div className="mt-2 space-y-1">
        <div className="h-1 w-full rounded-full bg-slate-200" />
        <div className="h-1 w-11/12 rounded-full bg-slate-200" />
        <div className="h-1 w-3/4 rounded-full bg-slate-200" />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded border border-slate-200 bg-slate-200 text-center text-[8px] text-slate-600">
        {["n", "steps", "time", "10", "10", "O(n)"].map((c, i) => (
          <span key={i} className={`bg-white py-0.5 ${i < 3 ? "font-bold" : ""}`}>
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Quizzes are only ever reminded. */
export function QuizLock() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
        <span className="font-medium text-slate-800">Quiz 3 · CS-201</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-200">
          <IconBell className="size-3" /> Reminder only
        </span>
      </div>
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
        <span className="font-medium text-slate-800">Midterm · MT-101</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
          <IconLock className="size-3" /> Never solved
        </span>
      </div>
    </div>
  );
}
