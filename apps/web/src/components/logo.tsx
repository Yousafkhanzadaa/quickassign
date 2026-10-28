/** QuickAssign mark: a chat bubble with a tick (a task caught and done). */
export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path
        className="fill-brand-600"
        d="M9 3h14a6 6 0 0 1 6 6v10a6 6 0 0 1-6 6h-9.5l-5.6 4.2c-.7.5-1.6 0-1.6-.8v-3.1A6 6 0 0 1 3 19V9a6 6 0 0 1 6-6z"
      />
      <path d="M10.5 14.5l3.8 3.8 7.2-7.6" fill="none" stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ dark = false, className = "" }: { dark?: boolean; className?: string }) {
  return (
    <span className={`flex items-center gap-2 font-display text-[1.2rem] font-bold tracking-tight ${dark ? "text-white" : "text-slate-950"} ${className}`}>
      <Logo />
      QuickAssign
    </span>
  );
}
