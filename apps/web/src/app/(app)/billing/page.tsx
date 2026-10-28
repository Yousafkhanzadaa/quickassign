import { withTenant } from "@qa/core";
import Link from "next/link";
import { IconCheck, IconLock } from "@/components/icons";
import { formatPk, Notice, PageHeader } from "@/components/ui";
import { creditBalance, formatPkr, paymentRef, paymentsProvider } from "@/lib/billing";
import { db } from "@/lib/server";
import { requireProfile } from "@/lib/session";
import { BuyButton } from "./buy-button";

export const metadata = { title: "Plans & credits" };

const STATUS: Record<string, string> = {
  created: "Not started",
  pending: "Awaiting payment",
  paid: "Paid",
  failed: "Failed",
  expired: "Expired",
  refunded: "Refunded",
};

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ plan?: string; canceled?: string }> }) {
  const { user, profile } = await requireProfile();
  const sp = await searchParams;
  const data = await withTenant(db(), user.id, async (trx) => ({
    balance: await creditBalance(trx),
    plans: await trx.selectFrom("app.plans").selectAll().where("active", "=", true).orderBy("sort_order").execute(),
    grants: await trx
      .selectFrom("app.credit_grants")
      .leftJoin("app.plans", "app.plans.id", "app.credit_grants.plan_id")
      .select(["app.credit_grants.id", "source", "quantity", "used", "expires_at", "app.plans.name as plan_name"])
      .where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", new Date())]))
      .where((eb) => eb("used", "<", eb.ref("quantity")))
      .orderBy("expires_at", (ob) => ob.asc().nullsLast())
      .execute(),
    payments: await trx
      .selectFrom("app.payments")
      .innerJoin("app.plans", "app.plans.id", "app.payments.plan_id")
      .select(["app.payments.id", "app.plans.name as plan", "amount_paisa", "status", "app.payments.created_at"])
      .orderBy("app.payments.created_at", "desc")
      .limit(20)
      .execute(),
  }));
  const provider = paymentsProvider();
  const highlight = sp.plan;
  const bestId =
    data.plans.length > 1 ? data.plans.reduce((a, b) => (b.price_paisa / b.solves < a.price_paisa / a.solves ? b : a)).id : undefined;

  return (
    <>
      <PageHeader title="Plans & credits" subtitle="One credit = one worked solution. Tracking, reminders and quizzes are always free." />
      {sp.canceled && (
        <div className="mb-4">
          <Notice tone="warn">Payment canceled. You haven&apos;t been charged.</Notice>
        </div>
      )}
      {provider === "disabled" && (
        <div className="mb-4">
          <Notice>Online payments aren&apos;t switched on for this server yet.</Notice>
        </div>
      )}
      {provider === "mock" && (
        <div className="mb-4">
          <Notice tone="warn">Test mode: payments are simulated (localhost only).</Notice>
        </div>
      )}

      <section className="card flex flex-wrap items-center justify-between gap-6">
        <div>
          <p className="text-sm font-medium text-slate-500">Credits available</p>
          <p className="mt-1 font-display text-5xl font-bold tracking-tight text-slate-950">{data.balance}</p>
          <p className="mt-1 text-sm text-slate-500">One credit = one worked solution.</p>
        </div>
        {data.grants.length > 0 && (
          <ul className="min-w-60 space-y-2 text-sm">
            {data.grants.map((g) => (
              <li key={g.id} className="rounded-xl bg-slate-50 px-3.5 py-2.5">
                <span className="font-semibold text-slate-900">
                  {g.source === "signup" ? "Free trial" : `${g.plan_name ?? "Plan"} plan`}
                </span>
                <span className="text-slate-600">
                  {" "}
                  · {g.quantity - g.used} of {g.quantity} left
                </span>
                <span className="block text-xs text-slate-500">
                  {g.expires_at ? `Expires ${formatPk(g.expires_at, profile.timezone)}` : "Never expires"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 grid gap-5 md:grid-cols-2">
        {data.plans.map((p) => {
          const chosen = highlight === p.id;
          const best = bestId === p.id;
          return (
            <div
              key={p.id}
              className={`relative flex flex-col rounded-3xl border bg-white p-7 shadow-sm ${chosen ? "border-brand-500 ring-4 ring-brand-500/15" : "border-slate-200"}`}
            >
              {best && <span className="absolute -top-3 left-7 rounded-full bg-brand-600 px-3 py-1 text-xs font-bold text-white shadow">Best value</span>}
              <h2 className="font-display text-lg font-semibold text-slate-950">{p.name}</h2>
              <p className="mt-3 flex items-baseline gap-1.5">
                <span className="font-display text-4xl font-bold tracking-tight text-slate-950">{formatPkr(p.price_paisa)}</span>
                <span className="text-sm text-slate-500">/ {p.period_days} days</span>
              </p>
              <p className="mt-1 text-sm font-medium text-brand-700">{formatPkr(Math.round(p.price_paisa / p.solves))} per solution</p>
              <ul className="mt-5 flex-1 space-y-2.5 text-sm text-slate-700">
                {[`${p.solves} worked solutions`, "PDF + editable Word for each", "Unlimited tracking and reminders", `Valid ${p.period_days} days, no auto-renewal`].map((l) => (
                  <li key={l} className="flex items-start gap-2.5">
                    <IconCheck className="mt-0.5 size-4 shrink-0 text-brand-600" />
                    {l}
                  </li>
                ))}
              </ul>
              <div className="mt-7">
                <BuyButton planId={p.id} disabled={provider === "disabled"} label={`Buy ${p.name}`} />
              </div>
            </div>
          );
        })}
      </section>
      <p className="mt-4 flex items-start gap-2 text-sm text-slate-500">
        <IconLock className="mt-0.5 size-4 shrink-0" />
        <span>
          Pay from your JazzCash, Easypaisa or bank app through Raast, or with a debit/credit card, on Safepay&apos;s secure checkout. We
          never see your card or wallet details. See the <Link className="link" href="/refunds">refund policy</Link>.
        </span>
      </p>

      {data.payments.length > 0 && (
        <section className="card mt-6 p-0">
          <h2 className="px-5 pt-5 font-semibold">Payments</h2>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {data.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2 px-5 py-3">
                <span>
                  {p.plan} · {formatPkr(p.amount_paisa)} <span className="font-mono text-xs text-slate-500">Ref {paymentRef(p.id)}</span>
                </span>
                <span className="flex gap-3 text-slate-600">
                  <span>{formatPk(p.created_at, profile.timezone)}</span>
                  <span className={p.status === "paid" ? "font-semibold text-brand-700" : ""}>{STATUS[p.status] ?? p.status}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
