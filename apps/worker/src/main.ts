import { run } from "graphile-worker";
import { loadConfig } from "./config.js";
import { createContext } from "./context.js";
import { classifyGroup } from "./tasks/classify-group.js";
import { inboundMessage } from "./tasks/inbound-message.js";
import { ingestMaterial } from "./tasks/ingest-material.js";
import { purgeAccount, purgeExpired, sendReminder } from "./tasks/maintenance.js";
import { reconcilePayments } from "./tasks/reconcile-payments.js";
import { selfCommand } from "./tasks/self-command.js";
import { solveTask } from "./tasks/solve-task.js";

const cfg = loadConfig();
const ctx = createContext(cfg);
if (!ctx.llm.enabled) ctx.log.warn("OPENAI_API_KEY is not set: detection and solving are disabled");

const runner = await run({
  connectionString: cfg.QUEUE_DATABASE_URL,
  maxPoolSize: cfg.QUEUE_POOL_MAX,
  concurrency: cfg.WORKER_CONCURRENCY,
  pollInterval: 2000,
  taskList: {
    inbound_message: inboundMessage(ctx),
    classify_group: classifyGroup(ctx),
    self_command: selfCommand(ctx),
    solve_task: solveTask(ctx),
    ingest_material: ingestMaterial(ctx),
    send_reminder: sendReminder(ctx),
    purge_expired: purgeExpired(ctx),
    purge_account: purgeAccount(ctx),
    reconcile_payments: reconcilePayments(ctx),
  },
  // Retention purge every hour at :17; payment reconciliation every 5 minutes.
  crontab: "17 * * * * purge_expired ?max=1\n*/5 * * * * reconcile_payments ?max=1\n",
});

ctx.log.info({ concurrency: cfg.WORKER_CONCURRENCY }, "worker started");
await runner.promise;
await ctx.close();
