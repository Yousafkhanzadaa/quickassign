import { verifyAndFulfil, withTenant } from "@qa/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { formatPk, PageHeader } from "@/components/ui";
import { formatPkr, paymentRef, paymentsProvider, safepay } from "@/lib/billing";
import { db } from "@/lib/server";
import { requireProfile } from "@/lib/session";
import { CheckAgain } from "../check-again";
import { RefreshOnce } from "../refresh-once";

export const metadata = { title: "Payment" };

/**
 * Where Safepay sends the student back (/billing/return/<payment id>; Safepay appends
 * ?tracker=…, which we ignore). Nothing in the redirect is trusted: we look up our own
 * payment (RLS guarantees it belongs to this student) and ask Safepay's reporter API
 * what really happened.
 */
export default async function PaymentReturnPage({ params }: { params: Promise<{ payment: string }> }) {
  const { user, profile } = await requireProfile();
  const id = (await params).payment;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const load = () =>
    withTenant(db(), user.id, (trx) =>
      trx
        .selectFrom("app.payments")
        .innerJoin("app.plans", "app.plans.id", "app.payments.plan_id")
        .select(["app.payments.id", "status", "provider", "provider_ref", "amount_paisa", "app.plans.name as plan", "app.plans.solves"])
        .where("app.payments.id", "=", id)
        .executeTakeFirst(),
    );
  let payment = await load();
  if (!payment) notFound();
  const open = payment.status === "pending" || payment.status === "failed" || payment.status === "expired";
  if (open && payment.provider === "safepay" && payment.provider_ref && paymentsProvider() === "safepay") {
    try {
      await verifyAndFulfil(db(), safepay(), payment.provider_ref);
    } catch (err) {
      // The reconciliation job and webhook will finish it; log without secrets.
      console.error("payment verification failed:", (err as Error).name, (err as { detail?: string }).detail ?? "");
    }
    payment = (await load()) ?? payment;
  }
  const { expiry, linked } = await withTenant(db(), user.id, async (trx) => ({
    expiry: await trx.selectFrom("app.credit_grants").select("expires_at").where("payment_id", "=", id).executeTakeFirst(),
    linked: (await trx.selectFrom("app.wa_links").select("status").executeTakeFirst())?.status === "linked",
  }));

  return (
    <>
      <PageHeader title="Payment" />
      <div className="card max-w-lg space-y-3">
        {payment.status === "paid" ? (
          <>
            <RefreshOnce />
            <p className="text-lg font-semibold text-brand-700">✅ Payment received</p>
            <p className="text-sm text-slate-700">
              {payment.plan} plan · {formatPkr(payment.amount_paisa)}: {payment.solves} worked solutions
              {expiry?.expires_at ? `, valid until ${formatPk(expiry.expires_at, profile.timezone)}` : ""}.
            </p>
            {linked ? (
              <Link className="btn-primary" href="/tasks">
                Go to tasks
              </Link>
            ) : (
              <>
                <p className="text-sm text-slate-700">Next, link your WhatsApp so QuickAssign can start tracking your class groups.</p>
                <Link className="btn-primary" href="/whatsapp">
                  Link WhatsApp
                </Link>
              </>
            )}
          </>
        ) : payment.status === "pending" || payment.status === "created" ? (
          <>
            <p className="text-lg font-semibold">⏳ Confirming your payment…</p>
            <p className="text-sm text-slate-600">
              This usually takes a few seconds. If you paid and this doesn&apos;t update, don&apos;t pay again: we re-check with the
              gateway every few minutes.
            </p>
            <CheckAgain />
          </>
        ) : (
          <>
            <p className="text-lg font-semibold text-red-700">Payment not completed</p>
            <p className="text-sm text-slate-600">
              No credits were added. If money did leave your account, contact us with reference{" "}
              <span className="font-mono font-semibold">{paymentRef(payment.id)}</span> and we&apos;ll add the credits or refund you (see
              the <Link className="link" href="/refunds">refund policy</Link>).
            </p>
            <Link className="btn-secondary" href="/billing">
              Back to plans
            </Link>
          </>
        )}
      </div>
    </>
  );
}
