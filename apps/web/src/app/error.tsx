"use client";
import Link from "next/link";

// Shown when a page fails on the server. In production the details stay in the server log;
// during development the message is shown too, so a setup problem is obvious.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[70dvh] flex-col items-center justify-center px-5 py-16 text-center">
      <h1 className="font-display text-3xl font-bold tracking-tight text-slate-950">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-slate-600">Please try again. If you were paying, don&apos;t pay twice: your payment is checked again automatically.</p>
      {process.env.NODE_ENV === "development" && (
        <pre className="mt-6 max-w-2xl whitespace-pre-wrap rounded-xl bg-slate-100 px-4 py-3 text-left text-sm text-slate-800">{error.message}</pre>
      )}
      <div className="mt-8 flex gap-3">
        <button type="button" className="btn-primary" onClick={() => reset()}>
          Try again
        </button>
        <Link href="/dashboard" className="btn-secondary">
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
