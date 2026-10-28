"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function MaterialUpload({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (file.size > 20 * 1024 * 1024) {
      setError("File is larger than 20 MB.");
      return;
    }
    setPending(true);
    const body = new FormData();
    body.set("course_id", courseId);
    body.set("file", file);
    const res = await fetch("/api/materials", { method: "POST", body });
    setPending(false);
    e.target.value = "";
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Upload failed.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <label className="btn-secondary cursor-pointer">
        {pending ? "Uploading…" : "Upload file"}
        <input type="file" className="sr-only" accept=".pdf,.docx,.pptx,.txt" onChange={onChange} disabled={pending} />
      </label>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
