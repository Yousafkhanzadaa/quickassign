import { PageHeader } from "@/components/ui";
import { signOutEverywhere } from "@/lib/actions/auth";
import { requireProfile } from "@/lib/session";
import { ChangePasswordForm, DeleteAccountForm, ProfileForm } from "./forms";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user, profile } = await requireProfile();
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <ProfileForm
          profile={{
            full_name: profile.full_name,
            roll_number: profile.roll_number ?? "",
            university: profile.university ?? "",
            department: profile.department ?? "",
            program: profile.program ?? "",
            semester: profile.semester ?? "",
            auto_solve: profile.auto_solve,
          }}
        />
        <div className="space-y-6">
          <section className="card space-y-3">
            <h2 className="font-semibold">Sign-in</h2>
            <p className="text-sm text-slate-600">
              You sign in as <span className="font-medium text-slate-900">{user.email}</span>. QuickAssign stores only a salted hash of
              your password, never the password itself.
            </p>
            <form action={signOutEverywhere}>
              <button type="submit" className="btn-secondary">
                Sign out of all devices
              </button>
            </form>
          </section>
          <ChangePasswordForm />
          <DeleteAccountForm />
        </div>
      </div>
    </>
  );
}
