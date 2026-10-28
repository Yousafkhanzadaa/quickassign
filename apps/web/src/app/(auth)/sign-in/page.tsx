import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/ui";
import { safeNext } from "@/lib/redirects";
import { getUser } from "@/lib/session";
import { SignInForm } from "../forms";

export const metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; signed_out?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getUser()) redirect(next);
  return (
    <>
      <h1 className="font-display text-3xl font-bold tracking-tight text-slate-950">Sign in</h1>
      <p className="mt-2 text-slate-600">Welcome back. Your class groups have been busy.</p>
      <div className="mt-8 space-y-4">
        {sp.signed_out === "everywhere" && <Notice tone="success">You&apos;ve been signed out on every device.</Notice>}
        <SignInForm next={next} />
      </div>
      <p className="mt-6 text-sm text-slate-600">
        New here?{" "}
        <Link className="link" href="/sign-up">
          Create an account
        </Link>
      </p>
      <p className="mt-8 text-xs leading-relaxed text-slate-500">
        Forgot your password? The person who runs this QuickAssign site can reset it for you.
      </p>
    </>
  );
}
