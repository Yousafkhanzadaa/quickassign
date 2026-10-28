import { withTenant } from "@qa/core";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/logo";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";
import { OnboardingForm } from "./form";

export const metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const raw = (await searchParams).plan;
  const plan = raw && /^[a-z][a-z0-9_]{1,30}$/.test(raw) ? raw : undefined;
  const user = await requireUser();
  const existing = await withTenant(db(), user.id, (trx) =>
    trx.selectFrom("app.profiles").select("user_id").where("user_id", "=", user.id).executeTakeFirst(),
  );
  if (existing) redirect(plan ? `/billing?plan=${plan}` : "/dashboard");
  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-xl items-center px-5">
          <Wordmark />
        </div>
      </header>
      <main className="mx-auto max-w-xl px-5 py-10">
        <p className="eyebrow">Step 1 of 2 · Your details</p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-950">Set up QuickAssign</h1>
        <p className="mt-2 text-slate-600">
          These details go on your worked-solution PDFs. Only you can see them. Next, you&apos;ll {plan ? "choose how to pay" : "link WhatsApp"}.
        </p>
        <OnboardingForm defaultName={user.name} plan={plan} />
      </main>
    </div>
  );
}
