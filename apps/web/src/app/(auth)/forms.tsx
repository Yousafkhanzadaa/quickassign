"use client";
import { useActionState } from "react";
import { Notice } from "@/components/ui";
import { signIn, signUp, type AuthState } from "@/lib/actions/auth";

const MIN_PASSWORD = 10;

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(signIn, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" className="input" autoComplete="email" required maxLength={254} defaultValue={state.email} />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input id="password" name="password" type="password" className="input" autoComplete="current-password" required maxLength={128} />
      </div>
      <button className="btn-primary h-12 w-full text-base" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export function SignUpForm({ plan }: { plan?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(signUp, {});
  return (
    <form action={action} className="space-y-4">
      {plan && <input type="hidden" name="plan" value={plan} />}
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <div>
        <label className="label" htmlFor="name">
          Your name
        </label>
        <input id="name" name="name" className="input" autoComplete="name" required maxLength={120} defaultValue={state.name} />
      </div>
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" className="input" autoComplete="email" required maxLength={254} defaultValue={state.email} />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Password <span className="font-normal text-slate-500">(at least {MIN_PASSWORD} characters)</span>
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          maxLength={128}
        />
      </div>
      <button className="btn-primary h-12 w-full text-base" disabled={pending}>
        {pending ? "Creating your account…" : "Create account"}
      </button>
    </form>
  );
}
