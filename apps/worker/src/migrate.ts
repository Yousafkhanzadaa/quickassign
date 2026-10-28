// One-shot migration job: installs the job-queue schema (as qa_queue) and then applies
// db/migrations (as qa_owner). Only this job ever receives owner credentials.
import { migrate } from "@qa/core";
import { runMigrations } from "graphile-worker";

const queueUrl = process.env.QUEUE_DATABASE_URL;
const ownerUrl = process.env.OWNER_DATABASE_URL;
const dir = process.env.MIGRATIONS_DIR ?? "/app/db/migrations";
if (!queueUrl || !ownerUrl) {
  console.error("QUEUE_DATABASE_URL and OWNER_DATABASE_URL are required");
  process.exit(2);
}

await runMigrations({ connectionString: queueUrl });
console.log("job queue schema ready");
const applied = await migrate(ownerUrl, dir);
console.log(applied.length ? `applied: ${applied.join(", ")}` : "schema up to date");
