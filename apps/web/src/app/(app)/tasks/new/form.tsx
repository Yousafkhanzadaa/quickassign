"use client";
import { useActionState } from "react";
import { createManualTask, type ActionResult } from "@/lib/actions/tasks";

export function NewTaskForm({ courses }: { courses: Array<{ id: string; name: string; code: string | null }> }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(createManualTask, { ok: true });
  return (
    <form action={action} className="card max-w-xl space-y-4">
      <div>
        <label className="label" htmlFor="title">
          Title
        </label>
        <input id="title" name="title" className="input" required minLength={3} maxLength={200} placeholder="e.g. OS Assignment 2: Scheduling" />
      </div>
      <div>
        <label className="label" htmlFor="course_id">
          Course
        </label>
        <select id="course_id" name="course_id" className="input" defaultValue="">
          <option value="">No course</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code ? `${c.code} · ` : ""}
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="deadline">
          Deadline (Pakistan time)
        </label>
        <input id="deadline" name="deadline" type="datetime-local" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="description">
          Instructions
        </label>
        <textarea id="description" name="description" className="input min-h-40" maxLength={8000} placeholder="Paste the assignment text or describe what's required." />
      </div>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      <button className="btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save task"}
      </button>
    </form>
  );
}
