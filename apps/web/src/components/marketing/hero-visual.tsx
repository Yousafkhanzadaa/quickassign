import { IconCheck, IconClock, IconLock } from "@/components/icons";

/** Illustration of what arrives in the student's "Message yourself" chat. Decorative. */
export function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-[25rem]" role="img" aria-label="QuickAssign messages in a WhatsApp chat: a new assignment, a worked-solution PDF and a deadline reminder">
      <div className="absolute inset-x-6 top-10 bottom-0 -z-10 rounded-[3rem] bg-gradient-to-br from-brand-300/50 via-emerald-200/40 to-sky-300/40 blur-3xl" aria-hidden="true" />
      <div className="relative mx-auto w-[17.5rem] sm:w-[18.5rem]">
        <Phone />

        <div className="absolute top-[41%] -left-32 hidden w-40 -rotate-3 rounded-2xl border border-amber-200/80 bg-white/95 p-3 shadow-xl shadow-amber-900/10 backdrop-blur lg:block motion-safe:animate-float">
          <p className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
            <IconClock className="size-4" />
            Due in 3 hours
          </p>
          <p className="mt-1.5 text-sm font-semibold text-slate-900">Physics Lab 4</p>
          <p className="text-xs text-slate-500">PHY-102 · Sat, 11:59 PM</p>
        </div>

        <div className="absolute -top-8 -right-36 hidden w-48 rotate-2 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl shadow-slate-900/10 backdrop-blur lg:block motion-safe:animate-float-slow">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-red-500 text-[9px] font-bold text-white">PDF</span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-slate-900">CS201-A3-worked.pdf</p>
              <p className="text-[11px] text-slate-500">PDF + Word · 6 pages</p>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-2.5">
            <div className="h-1.5 w-24 rounded-full bg-slate-300" />
            <p className="mt-2 font-serif text-[12px] text-slate-700 italic">T(n) = T(n−1) + O(1) ⇒ O(n)</p>
            <div className="mt-2 space-y-1">
              <div className="h-1 w-full rounded-full bg-slate-200" />
              <div className="h-1 w-5/6 rounded-full bg-slate-200" />
              <div className="h-1 w-3/5 rounded-full bg-slate-200" />
            </div>
            <p className="mt-2 inline-flex rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-800">[M2] Lecture 7, slide 12</p>
          </div>
        </div>

        <div className="absolute -bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-brand-200 bg-white px-3.5 py-2 text-xs font-semibold whitespace-nowrap text-brand-800 shadow-lg shadow-brand-900/10">
          <IconLock className="size-4" />
          Encrypted for you only
        </div>
      </div>
    </div>
  );
}

function Phone() {
  return (
    <div className="relative overflow-hidden rounded-[2.75rem] border-[9px] border-slate-950 bg-slate-950 shadow-2xl shadow-slate-900/30">
      <div className="absolute top-2 left-1/2 z-10 h-5 w-20 -translate-x-1/2 rounded-full bg-slate-950" aria-hidden="true" />
      <div className="flex items-center justify-between bg-[#075e54] px-5 pt-2.5 pb-1 text-[10px] font-semibold text-white/90">
        <span>9:41</span>
        <span className="tracking-widest">●●●</span>
      </div>
      <div className="flex items-center gap-3 bg-[#075e54] px-4 pt-2 pb-3 text-white">
        <div className="grid size-9 place-items-center rounded-full bg-white/20 text-[11px] font-bold">You</div>
        <div>
          <p className="text-sm leading-tight font-semibold">You</p>
          <p className="text-[11px] text-white/70">Message yourself</p>
        </div>
      </div>
      <div className="bg-chat space-y-2.5 px-3 pt-4 pb-6 text-[12.5px] leading-snug text-slate-800">
        <p className="mx-auto w-fit rounded-md bg-white/80 px-2 py-0.5 text-[10px] font-medium text-slate-500 shadow-sm">Today</p>
        <Bubble time="4:12 PM">
          <span className="font-semibold text-brand-700">📚 New assignment</span> · CS-201
          <br />
          #3 Linked lists, 4 questions
          <br />
          Due <span className="font-semibold">Fri 14 Nov, 11:59 PM</span>
          <span className="mt-1 block text-slate-500">
            Reply <b>solve</b> for a worked solution.
          </span>
        </Bubble>
        <Bubble time="4:15 PM" mine>
          solve
        </Bubble>
        <Bubble time="4:19 PM">
          <span className="flex items-center gap-2 rounded-lg bg-slate-100 p-2">
            <span className="grid size-8 shrink-0 place-items-center rounded bg-red-500 text-[9px] font-bold text-white">PDF</span>
            <span className="min-w-0">
              <span className="block truncate font-medium">CS201-A3-worked.pdf</span>
              <span className="block text-[11px] text-slate-500">6 pages · 312 KB</span>
            </span>
          </span>
          <span className="mt-1.5 flex gap-1">
            <IconCheck className="mt-0.5 size-3.5 shrink-0 text-brand-600" />
            Solved step by step, citing your Lecture 7 slides.
          </span>
        </Bubble>
        <Bubble time="Thu 11:59 PM">⏰ Reminder: CS-201 #3 is due in 24 hours.</Bubble>
      </div>
    </div>
  );
}

function Bubble({ children, time, mine }: { children: React.ReactNode; time: string; mine?: boolean }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[86%] rounded-xl px-2.5 py-1.5 shadow-sm ${mine ? "rounded-tr-sm bg-[#d9fdd3]" : "rounded-tl-sm bg-white"}`}>
        {children}
        <span className="mt-0.5 block text-right text-[9.5px] text-slate-400">{time}</span>
      </div>
    </div>
  );
}
