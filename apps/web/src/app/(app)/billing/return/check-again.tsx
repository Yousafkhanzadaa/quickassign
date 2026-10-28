"use client";
import { useRouter } from "next/navigation";

export function CheckAgain() {
  const router = useRouter();
  return (
    <button type="button" className="btn-secondary" onClick={() => router.refresh()}>
      Check again
    </button>
  );
}
