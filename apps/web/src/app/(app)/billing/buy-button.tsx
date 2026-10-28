"use client";
import { useState } from "react";
import { startCheckout } from "@/lib/actions/billing";

export function BuyButton({ planId, label, disabled }: { planId: string; label: string; disabled?: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        className="btn-primary h-11 w-full"
        disabled={disabled || pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const r = await startCheckout(planId);
          if (r.url) {
            window.location.assign(r.url);
            return;
          }
          setPending(false);
          setError(r.error ?? "Couldn't start checkout.");
        }}
      >
        {pending ? "Opening secure checkout…" : label}
      </button>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
