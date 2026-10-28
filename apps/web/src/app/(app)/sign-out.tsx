import { signOut } from "@/lib/actions/auth";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button type="submit" className="btn-ghost px-3 py-1.5 text-sm">
        Sign out
      </button>
    </form>
  );
}
