"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * The header's credit count renders in parallel with this page, before the payment is
 * confirmed. Refresh once so it shows the new balance.
 */
export function RefreshOnce() {
  const router = useRouter();
  useEffect(() => {
    router.refresh();
  }, [router]);
  return null;
}
