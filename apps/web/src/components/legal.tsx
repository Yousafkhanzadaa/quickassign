import Link from "next/link";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="legal mx-auto max-w-3xl px-5 pt-16 pb-24 sm:pt-20">
      <p className="eyebrow">Legal</p>
      <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">{title}</h1>
      <p className="mt-3 text-sm text-slate-500">Last updated {updated}</p>
      <div className="mt-10 border-t border-slate-200 pt-2">{children}</div>
      <p className="mt-14 rounded-2xl bg-slate-50 px-5 py-4 text-sm text-slate-600">
        See also: <Link href="/privacy">Privacy policy</Link> · <Link href="/terms">Terms of service</Link> ·{" "}
        <Link href="/refunds">Refund policy</Link>
      </p>
    </article>
  );
}

/** "email us at x" when a contact address is configured, otherwise a pointer to the in-app settings. */
export function ContactLine({ email }: { email?: string }) {
  return email ? (
    <>
      email us at <a href={`mailto:${email}`}>{email}</a>
    </>
  ) : (
    <>contact us through the address shown on this website</>
  );
}
