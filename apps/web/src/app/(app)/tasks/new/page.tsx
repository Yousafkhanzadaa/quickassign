import { withTenant } from "@qa/core";
import { PageHeader } from "@/components/ui";
import { db } from "@/lib/server";
import { requireProfile } from "@/lib/session";
import { NewTaskForm } from "./form";

export const metadata = { title: "Add task" };

export default async function NewTaskPage() {
  const { user } = await requireProfile();
  const courses = await withTenant(db(), user.id, (trx) => trx.selectFrom("app.courses").select(["id", "name", "code"]).orderBy("name").execute());
  return (
    <>
      <PageHeader title="Add a task" subtitle="For assignments you got outside WhatsApp. You can attach the file on the next screen." />
      <NewTaskForm courses={courses} />
    </>
  );
}
