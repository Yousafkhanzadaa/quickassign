"use client";
import { useActionState } from "react";
import { completeOnboarding, type FormState } from "@/lib/actions/onboarding";

const FIELDS: Array<[string, string, string, number]> = [
  ["roll_number", "Roll / registration number", "e.g. 21L-1234", 64],
  ["university", "University", "e.g. FAST NUCES Lahore", 160],
  ["department", "Department", "e.g. Computer Science", 160],
  ["program", "Program", "e.g. BS Computer Science", 120],
  ["semester", "Semester", "e.g. 5th", 40],
];

export function OnboardingForm({ defaultName, plan }: { defaultName: string; plan?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(completeOnboarding, {});
  return (
    <form action={action} className="card mt-6 space-y-4">
      {plan && <input type="hidden" name="plan" value={plan} />}
      <div>
        <label className="label" htmlFor="full_name">
          Full name (as on university records)
        </label>
        <input id="full_name" name="full_name" className="input" defaultValue={defaultName} required maxLength={120} />
      </div>
      {FIELDS.map(([name, label, ph, max]) => (
        <div key={name}>
          <label className="label" htmlFor={name}>
            {label} <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input id={name} name={name} className="input" placeholder={ph} maxLength={max} />
        </div>
      ))}

      <fieldset className="space-y-3 rounded-xl bg-slate-50 p-4 text-sm">
        <label className="flex gap-3">
          <input type="checkbox" name="adult" className="mt-1 size-4" required />
          <span>I am 18 or older.</span>
        </label>
        <label className="flex gap-3">
          <input type="checkbox" name="terms" className="mt-1 size-4" required />
          <span>
            I accept the{" "}
            <a className="link" href="/terms" target="_blank" rel="noopener">
              Terms
            </a>{" "}
            and{" "}
            <a className="link" href="/privacy" target="_blank" rel="noopener">
              Privacy Policy
            </a>
            . I&apos;ll use worked solutions to learn, follow my university&apos;s rules on AI assistance, and disclose AI use where
            required (HEC policy).
          </span>
        </label>
        <label className="flex gap-3">
          <input type="checkbox" name="wa_risk" className="mt-1 size-4" required />
          <span>
            <strong>I link WhatsApp at my own risk.</strong> I understand that it uses an <strong>unofficial</strong> connection that
            WhatsApp does not endorse, and WhatsApp may restrict or ban my account. Like WhatsApp Web, the linked device can read all my
            chats and send messages as me. QuickAssign&apos;s code only reads the groups I choose and only messages my own chat, and
            messages from those groups are processed by an AI service.
          </span>
        </label>
      </fieldset>

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}
