import { withTenant } from "@qa/core";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Notice, PageHeader } from "@/components/ui";
import { formatPkr, mockAllowed } from "@/lib/billing";
import { db } from "@/lib/server";
import { requireProfile } from "@/lib/session";
import { MockPay } from "./mock-pay";

export const metadata = { title: "Test checkout" };

/** Local-only stand-in for Safepay's hosted checkout (PAYMENTS_PROVIDER=mock on localhost). */
export default async function MockCheckoutPage({ searchParams }: { searchParams: Promise<{ payment?: string }> }) {
  if (!mockAllowed()) notFound();
  const { user } = await requireProfile();
  const id = (await searchParams).payment;
  if (!id || !z.string().uuid().safeParse(id).success) notFound();
  const p = await withTenant(db(), user.id, (trx) =>
    trx
      .selectFrom("app.payments")
      .innerJoin("app.plans", "app.plans.id", "app.payments.plan_id")
      .select(["app.payments.id", "amount_paisa", "status", "app.plans.name as plan"])
      .where("app.payments.id", "=", id)
      .executeTakeFirst(),
  );
  if (!p) notFound();
  return (
    <>
      <PageHeader title="Test checkout" />
      <div className="card max-w-md space-y-4">
        <Notice tone="warn">Simulated payment for local testing. No money moves.</Notice>
        <p>
          {p.plan} plan · <strong>{formatPkr(p.amount_paisa)}</strong>
        </p>
        <MockPay paymentId={p.id} />
      </div>
    </>
  );
}
