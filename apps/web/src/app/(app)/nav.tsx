"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  ["/dashboard", "Home"],
  ["/tasks", "Tasks"],
  ["/groups", "Groups"],
  ["/courses", "Courses"],
  ["/whatsapp", "WhatsApp"],
  ["/billing", "Plans"],
  ["/settings", "Settings"],
] as const;

export function AppNav() {
  const path = usePathname();
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto text-sm" aria-label="Main">
      {NAV.map(([href, label]) => {
        const active = path === href || path.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`border-b-2 px-3 py-3 font-medium whitespace-nowrap transition ${
              active ? "border-brand-600 text-slate-950" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
