import Link from "next/link";
import { Wordmark } from "@/components/logo";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="flex min-h-[70dvh] flex-col items-center justify-center px-5 py-16 text-center">
      <Link href="/" aria-label="QuickAssign home">
        <Wordmark />
      </Link>
      <p className="mt-10 font-display text-6xl font-bold tracking-tight text-slate-950">404</p>
      <h1 className="mt-3 font-display text-2xl font-semibold text-slate-900">This page could not be found</h1>
      <p className="mt-2 max-w-sm text-slate-600">The link may be old, or the page may belong to another account.</p>
      <div className="mt-8 flex gap-3">
        <Link href="/dashboard" className="btn-primary">
          Go to dashboard
        </Link>
        <Link href="/" className="btn-secondary">
          Home page
        </Link>
      </div>
    </main>
  );
}
