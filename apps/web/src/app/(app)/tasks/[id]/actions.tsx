"use client";
import type { TaskStatus } from "@qa/core";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestSolve, skipTask } from "@/lib/actions/tasks";

export function TaskActions({ taskId, status, isTest, hasSolution }: { taskId: string; status: TaskStatus; isTest: boolean; hasSolution: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (isTest) return null;
  const busy = status === "queued" || status === "solving";

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setPending(true);
    setError(null);
    const r = await fn();
    setPending(false);
    if (!r.ok) setError(r.error ?? "Something went wrong.");
    router.refresh();
  }

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">Actions</h2>
      {busy ? (
        <p className="text-sm text-slate-600">⏳ Preparing your worked solution. It will also arrive in your WhatsApp &ldquo;Message yourself&rdquo; chat.</p>
      ) : (
        <button type="button" className="btn-primary w-full" disabled={pending} onClick={() => run(() => requestSolve(taskId))}>
          {hasSolution ? "Generate a new version (1 credit)" : "Get worked solution (1 credit)"}
        </button>
      )}
      {(status === "awaiting_confirmation" || status === "needs_content" || status === "failed") && (
        <button type="button" className="btn-secondary w-full" disabled={pending} onClick={() => run(() => skipTask(taskId))}>
          Skip
        </button>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </section>
  );
}

export function TaskFileUpload({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <label className="btn-secondary cursor-pointer">
        {pending ? "Uploading…" : "Upload file"}
        <input
          type="file"
          className="sr-only"
          accept=".pdf,.docx,.pptx,.txt,.jpg,.jpeg,.png"
          disabled={pending}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setPending(true);
            setError(null);
            const body = new FormData();
            body.set("file", file);
            const res = await fetch(`/api/tasks/${taskId}/files`, { method: "POST", body });
            setPending(false);
            e.target.value = "";
            if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Upload failed.");
            router.refresh();
          }}
        />
      </label>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
