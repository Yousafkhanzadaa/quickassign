import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { SignUpForm } from "../forms";

export const metadata = { title: "Create your account" };

const PLAN = /^[a-z][a-z0-9_]{1,30}$/;

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const sp = await searchParams;
  const plan = sp.plan && PLAN.test(sp.plan) ? sp.plan : undefined;
  if (await getUser()) redirect(plan ? `/onboarding?plan=${plan}` : "/onboarding");
  return (
    <>
      <h1 className="font-display text-3xl font-bold tracking-tight text-slate-950">Create your account</h1>
      <p className="mt-2 text-slate-600">
        {plan
          ? `You picked the ${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan. You'll pay after setting up your account.`
          : "Start with free worked solutions. No card needed."}
      </p>
      <div className="mt-8">
        <SignUpForm plan={plan} />
      </div>
      <p className="mt-6 text-sm text-slate-600">
        Already have an account?{" "}
        <Link className="link" href="/sign-in">
          Sign in
        </Link>
      </p>
      <p className="mt-8 text-xs leading-relaxed text-slate-500">
        By continuing you agree to our{" "}
        <Link className="link" href="/terms">
          Terms
        </Link>{" "}
        and{" "}
        <Link className="link" href="/privacy">
          Privacy Policy
        </Link>
        . Use a password you don&apos;t use anywhere else.
      </p>
    </>
  );
}
