import { cookies } from "next/headers";
import Link from "next/link";
import { IconMenu } from "@/components/icons";
import { Wordmark } from "@/components/logo";
import { site } from "@/lib/site";
import { hasSessionCookie } from "@/lib/session-cookie";

const NAV = [
  ["/#how-it-works", "How it works"],
  ["/#features", "Features"],
  ["/#security", "Security"],
  ["/#pricing", "Pricing"],
  ["/#faq", "FAQ"],
] as const;

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  // Optimistic (cookie-only) check, just to choose which buttons to show.
  const signedIn = Boolean(hasSessionCookie((await cookies()).getAll()));
  const s = site();
  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-white/75 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <Link href="/" aria-label="QuickAssign home">
            <Wordmark />
          </Link>
          <nav className="hidden items-center gap-1 text-sm font-medium text-slate-600 lg:flex">
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className="rounded-lg px-3 py-2 hover:bg-slate-900/5 hover:text-slate-950">
                {label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-1.5">
            {signedIn ? (
              <Link href="/dashboard" className="btn-dark">
                Open dashboard
              </Link>
            ) : (
              <>
                <Link href="/sign-in" className="btn-ghost hidden sm:inline-flex">
                  Sign in
                </Link>
                <Link href="/sign-up" className="btn-dark">
                  Start free
                </Link>
              </>
            )}
            <details className="group relative lg:hidden">
              <summary className="btn-ghost cursor-pointer list-none px-2.5 [&::-webkit-details-marker]:hidden" aria-label="Menu">
                <IconMenu className="size-5" />
              </summary>
              <div className="absolute top-12 right-0 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10">
                {NAV.map(([href, label]) => (
                  <Link key={href} href={href} className="block rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    {label}
                  </Link>
                ))}
                {!signedIn && (
                  <Link href="/sign-in" className="mt-1 block rounded-lg border-t border-slate-100 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    Sign in
                  </Link>
                )}
              </div>
            </details>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <Link href="/" aria-label="QuickAssign home">
              <Wordmark />
            </Link>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-600">
              A private study assistant for your class WhatsApp groups. Made for university students in Pakistan.
            </p>
            {s.contactAddress && <p className="mt-3 max-w-sm text-sm text-slate-500">{s.contactAddress}</p>}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-950">Product</h2>
            <ul className="mt-4 space-y-2.5 text-sm text-slate-600">
              {NAV.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="hover:text-slate-950">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-950">Trust</h2>
            <ul className="mt-4 space-y-2.5 text-sm text-slate-600">
              <li>
                <Link href="/privacy" className="hover:text-slate-950">
                  Privacy policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-slate-950">
                  Terms of service
                </Link>
              </li>
              <li>
                <Link href="/refunds" className="hover:text-slate-950">
                  Refund policy
                </Link>
              </li>
              {s.repoUrl && (
                <li>
                  <a href={s.repoUrl} className="hover:text-slate-950" rel="noopener noreferrer">
                    Source code
                  </a>
                </li>
              )}
              {s.contactEmail && (
                <li>
                  <a href={`mailto:${s.contactEmail}`} className="hover:text-slate-950">
                    {s.contactEmail}
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-200">
          <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-5 py-5 text-xs text-slate-500">
            <p>
              © {new Date().getFullYear()} {s.legalName}. QuickAssign is not affiliated with WhatsApp or Meta.
            </p>
            <p>Payments are processed by Safepay.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
