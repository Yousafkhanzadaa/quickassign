import Link from "next/link";
import { IconBell, IconCheck } from "@/components/icons";
import { Wordmark } from "@/components/logo";

const POINTS = ["Reads only the class groups you pick", "Encrypted with a key that belongs to you", "Never posts in your groups or submits work"];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-white lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative isolate hidden flex-col overflow-hidden bg-ink-950 p-12 text-white lg:flex">
        <div className="bg-dots fade-radial absolute inset-0 -z-10" aria-hidden="true" />
        <div className="absolute -bottom-48 -left-24 -z-10 size-[34rem] rounded-full bg-brand-600/30 blur-3xl" aria-hidden="true" />
        <Link href="/" aria-label="QuickAssign home" className="w-fit">
          <Wordmark dark />
        </Link>
        <div className="my-auto max-w-md py-12">
          <h2 className="font-display text-5xl leading-[1.05] font-bold tracking-tight">Your class groups, sorted.</h2>
          <p className="mt-5 text-lg leading-relaxed text-slate-300">
            Every assignment and deadline from the groups you choose, with worked solutions delivered to your own chat.
          </p>
          <ul className="mt-8 space-y-3.5 text-slate-200">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3">
                <span className="grid size-6 place-items-center rounded-full bg-brand-500/20 text-brand-300">
                  <IconCheck className="size-3.5" />
                </span>
                {p}
              </li>
            ))}
          </ul>
          <div className="mt-12 w-80 rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-2xl shadow-black/30 backdrop-blur">
            <p className="flex items-center gap-2 text-xs font-semibold text-amber-300">
              <IconBell className="size-4" /> Reminder · Message yourself
            </p>
            <p className="mt-2 text-sm text-slate-100">CS-201 Assignment 2 is due in 3 hours. Your worked PDF is ready on the dashboard.</p>
          </div>
        </div>
        <p className="text-xs text-slate-500">QuickAssign is not affiliated with WhatsApp or Meta.</p>
      </aside>
      <main className="flex flex-col px-5 py-6 sm:px-10">
        <Link href="/" aria-label="QuickAssign home" className="w-fit lg:hidden">
          <Wordmark />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">{children}</div>
      </main>
    </div>
  );
}
