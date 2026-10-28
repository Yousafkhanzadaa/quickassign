"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { completeMockPayment } from "@/lib/actions/billing";

export function MockPay({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {["JazzCash", "Easypaisa", "Card"].map((method) => (
        <button
          key={method}
          type="button"
          className="btn-secondary w-full"
          onClick={async () => {
            const r = await completeMockPayment(paymentId);
            if (!r.ok) setError(r.error ?? "Failed.");
            else router.push(`/billing/return/${paymentId}`);
          }}
        >
          Pay with {method} (simulated)
        </button>
      ))}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
