import { withTenant } from "@qa/core";
import Link from "next/link";
import { IconSparkle } from "@/components/icons";
import { Wordmark } from "@/components/logo";
import { creditBalance } from "@/lib/billing";
import { db } from "@/lib/server";
import { requireProfile } from "@/lib/session";
import { AppNav } from "./nav";
import { SignOutButton } from "./sign-out";

// Every signed-in page is per-request: never statically rendered or cached.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireProfile();
  const credits = await withTenant(db(), user.id, (trx) => creditBalance(trx));
  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4">
          <Link href="/dashboard" aria-label="QuickAssign home">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-2 text-sm">
            <Link
              href="/billing"
              data-testid="credits"
              className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 transition hover:bg-brand-100"
            >
              <IconSparkle className="size-3.5" />
              {credits} credits
            </Link>
            <SignOutButton />
          </div>
        </div>
        <div className="mx-auto max-w-5xl px-2">
          <AppNav />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
