"use client";
import { useState } from "react";
import { refreshGroups } from "@/lib/actions/whatsapp";

export function RefreshGroupsButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="text-right">
      <button
        type="button"
        className="btn-secondary"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const r = await refreshGroups();
          setPending(false);
          if (!r.ok) setError(r.error ?? "Refresh failed.");
        }}
      >
        {pending ? "Refreshing…" : "Refresh groups"}
      </button>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
