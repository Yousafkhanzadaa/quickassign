"use client";
import { useActionState } from "react";
import { changePassword, deleteAccount, updateProfile, type SettingsState } from "@/lib/actions/settings";

type ProfileValues = {
  full_name: string;
  roll_number: string;
  university: string;
  department: string;
  program: string;
  semester: string;
  auto_solve: boolean;
};

export function ProfileForm({ profile }: { profile: ProfileValues }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateProfile, {});
  const fields: Array<[keyof ProfileValues, string, number]> = [
    ["full_name", "Full name", 120],
    ["roll_number", "Roll / registration number", 64],
    ["university", "University", 160],
    ["department", "Department", 160],
    ["program", "Program", 120],
    ["semester", "Semester", 40],
  ];
  return (
    <form action={action} className="card space-y-3">
      <h2 className="font-semibold">Profile (printed on your PDFs)</h2>
      {fields.map(([name, label, max]) => (
        <div key={name}>
          <label className="label" htmlFor={name}>
            {label}
          </label>
          <input id={name} name={name} className="input" defaultValue={String(profile[name])} maxLength={max} required={name === "full_name"} />
        </div>
      ))}
      <label className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm">
        <input type="checkbox" name="auto_solve" value="on" defaultChecked={profile.auto_solve} className="mt-1 size-4" />
        <span>Solve detected assignments automatically (uses 1 credit each). Off means QuickAssign asks you first on WhatsApp.</span>
      </label>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      {state.ok && <p className="text-sm text-brand-700">Saved.</p>}
      <button className="btn-primary" disabled={pending}>
        Save
      </button>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<SettingsState, FormData>(changePassword, {});
  return (
    <form action={action} className="card space-y-3">
      <h2 className="font-semibold">Change password</h2>
      <div>
        <label className="label" htmlFor="current_password">
          Current password
        </label>
        <input id="current_password" name="current_password" type="password" className="input" autoComplete="current-password" required maxLength={128} />
      </div>
      <div>
        <label className="label" htmlFor="new_password">
          New password <span className="font-normal text-slate-500">(at least 10 characters)</span>
        </label>
        <input
          id="new_password"
          name="new_password"
          type="password"
          className="input"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={128}
        />
      </div>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      {state.ok && <p className="text-sm text-brand-700">Password changed. Your other devices were signed out.</p>}
      <button className="btn-secondary" disabled={pending}>
        {pending ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState<SettingsState, FormData>(deleteAccount, {});
  return (
    <form id="delete" action={action} className="card space-y-3 border-red-200">
      <h2 className="font-semibold text-red-800">Delete account</h2>
      <p className="text-sm text-slate-600">
        Unlinks WhatsApp, destroys its keys, and permanently deletes your messages, files, tasks and solutions, then your account. This
        can&apos;t be undone.
      </p>
      <input name="confirm" className="input" placeholder='Type "DELETE" to confirm' required autoComplete="off" aria-label="Confirmation" />
      <input
        name="password"
        type="password"
        className="input"
        placeholder="Your password"
        required
        autoComplete="current-password"
        maxLength={128}
        aria-label="Your password"
      />
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      <button className="btn-danger" disabled={pending}>
        {pending ? "Deleting…" : "Delete my account"}
      </button>
    </form>
  );
}
