# Architecture

This is a map of the codebase for developers and operators. The threat model and every security control are in [security-architecture.md](security-architecture.md).

## Services

```
Browser ──HTTPS──► web (Next.js) ──HMAC──► gateway (Go, whatsmeow) ──► WhatsApp
                    │   └──► Safepay (checkout)
                    ▼                          │
                 Postgres ◄────────────────────┘
                    ▲
                    └── worker (Node) ──► OpenAI, Safepay (reconciliation)
                           │
                           ▼ bearer token, no internet
                        sandbox (pandoc + XeLaTeX)
```

| Service | Code | Networks | What it does |
|---|---|---|---|
| `web` | `apps/web` | backend, frontend | The website and dashboard. Handles accounts and sessions, onboarding, uploads and checkout, and asks the gateway to link or unlink. It is the only service with a published port. |
| `worker` | `apps/worker` | backend, sandboxnet, egress | Runs every background job on graphile-worker: detection, solving, ingestion, reminders, retention, payment reconciliation and account purges. |
| `gateway` | `gateway` | backend, egress | Holds one WhatsApp companion session per student. It filters and encrypts incoming messages, and is the only code that can send a WhatsApp message, and then only to the student's own chat. |
| `sandbox` | `sandbox` | sandboxnet | Converts untrusted input: renders Markdown to PDF and DOCX, and extracts text from uploads. It has no internet access and holds no secrets except its own token. |
| `postgres` | `db/` | backend | Postgres 17 with pgvector: all application data, accounts and the job queue. |
| `migrate` | `apps/worker/src/migrate.ts` | backend | One-shot job that applies `db/migrations` as `qa_owner`, then exits. |

`backend` and `sandboxnet` are internal Docker networks with no internet access.

## How the main flows work

**Signing in**
1. Sign-up and sign-in are Server Actions (`apps/web/src/lib/actions/auth.ts`). They check attempt limits, then hash or verify the password with scrypt (`packages/core/src/password.ts`).
2. A successful sign-in creates a random 32-byte token. The browser gets it in an HttpOnly cookie; the database stores only its SHA-256 (`qa_auth.start_session`).
3. Every page resolves the cookie to an account with `qa_auth.session_account` (`apps/web/src/lib/auth.ts`), once per request. The account id is the tenant id for row-level security.

**Linking WhatsApp**
1. The web app asks the gateway, over an HMAC-signed request, to start pairing by phone code or QR.
2. Progress streams to the browser through `apps/web/src/app/api/whatsapp/events`.
3. The gateway creates a per-student session store encrypted with a new random key. That key is wrapped by `GATEWAY_KEK` and saved in `gateway.sessions`.

**A message becomes a task**
1. The gateway receives a group message. It drops it at once unless the group is switched on.
2. Otherwise it normalizes the message, encrypts it with the student's content key, and calls `app.gw_ingest_message`. That function stores it and queues an `inbound_message` job.
3. The worker's pre-filter (`apps/worker/src/prefilter.ts`) scores the message without an LLM. Likely candidates schedule a `classify_group` job after `CLASSIFY_DEBOUNCE_SECONDS`, so a burst ("Assignment 3", then a PDF, then "due Monday") is classified together.
4. `classify_group` asks the detect model for tasks and updates: new assignments, quizzes, extensions and corrections. It writes tasks, schedules reminders, and queues notices for the student.

**Commands and solving**
1. The gateway forwards a self-chat message only if it replies to one of QuickAssign's messages or starts with `qa`.
2. A `self_command` job parses it (`apps/worker/src/commands.ts`).
3. **solve** calls `app.enqueue_solve`, which checks ownership and refuses quizzes and exams, then queues `solve_task`.
4. `solve_task` takes a credit (`app.reserve_credit`). It gathers the assignment text and files, with the sandbox extracting text, and retrieves relevant course chunks (`apps/worker/src/retrieval.ts`).
5. It calls the solve model, validates every formula with KaTeX, and asks the repair model to fix any that fail. The sandbox then renders the PDF and DOCX.
6. The files are stored encrypted, and the PDF goes to the student's own chat through the gateway. If anything fails, the credit is released.

**Course material.** An upload to `/api/materials` is stored encrypted. An `ingest_material` job extracts its text in the sandbox, splits it into chunks (`chunk.ts`), embeds them, and stores the vectors in pgvector.

**Payments** are described in [payments.md](payments.md#how-a-payment-completes).

**Deleting an account**
1. The web app asks for the student's password again.
2. It unlinks WhatsApp, destroying the session keys, and signs the student out everywhere.
3. A `purge_account` job deletes every row and then the student's content key.
4. Last, the job deletes the account itself through `qa_auth.delete_user`.

## Background jobs

| Job | Queued by | Purpose |
|---|---|---|
| `inbound_message` | `app.gw_ingest_message` | Pre-filter one message; schedule classification. |
| `classify_group` | `inbound_message` (debounced per student and group) | Detect and update tasks; queue notices and reminders. |
| `self_command` | the gateway, through an `app.gw_*` function | Parse and answer a student's command. |
| `solve_task` | `app.enqueue_solve` | Write, render and deliver a worked solution. |
| `ingest_material` | a course-material upload | Extract, chunk and embed material. |
| `send_reminder` | `classify_group`, `solve_task` | Reminders 24 hours and 3 hours before a deadline. |
| `purge_account` | account deletion | Delete a student's data and key. |
| `purge_expired` | cron, hourly at :17 | Retention: messages after 30 days, commands after 7 days. |
| `reconcile_payments` | cron, every 5 minutes | Re-check open Safepay payments. |

The task list and the cron schedule are in `apps/worker/src/main.ts`.

## Database

| Schema | Contents |
|---|---|
| `app` | All tenant data: profiles, groups, messages, tasks, courses, material chunks, blobs, solutions, payments, credits and the audit log. Row-level security is on, and forced, for every tenant table. |
| `gateway` | Session rows: wrapped session keys and leases. Only the gateway's functions touch it. |
| `graphile_worker` | The job queue. |
| `qa_meta` | Which migrations have run. |
| `qa_auth` | Accounts (email, name, password hash) and sessions (token hashes). No role can read these tables; the web app and the worker each get only the functions they need. |

**Roles.** Each service logs in as its own role:
- `qa_web`, `qa_worker` and `qa_queue` have narrow grants.
- `qa_gateway` can only call `app.gw_*` functions.
- `qa_owner` runs migrations and operator tasks.
- `qa_maint` can't log in. It owns the retention purge.

Services set the current student for each transaction with `withTenant(...)` (`packages/core/src/db.ts`), and the RLS policies key on it.

**Migrations.** These are numbered SQL files in `db/migrations`, applied in order by the `migrate` job and recorded in `qa_meta.schema_migrations`.
- Never edit a migration that has been applied anywhere; add a new one.
- `0002` is intentionally missing: it was removed together with an earlier sign-in system. `0005` dropped that system's tables; `0007` adds today's accounts.
- `db/tests/schema_test.sql` and `db/tests/billing_test.sql` check roles, grants, RLS and billing. CI runs them.

## Where to change things

| To change… | Look in |
|---|---|
| Which messages count as candidates | `apps/worker/src/prefilter.ts` |
| Detection and solving prompts | `apps/worker/src/llm/prompts.ts` |
| Models and reasoning effort | environment variables ([configuration.md](configuration.md#openai)) |
| WhatsApp notice and reply wording | `apps/worker/src/notify.ts` |
| Self-chat commands | `apps/worker/src/commands.ts` |
| Reminder times | `scheduleReminders` in `apps/worker/src/util.ts` |
| PDF layout | `sandbox/templates/qa.latex` |
| The AI-use disclosure printed on PDFs | `DISCLOSURE` in `apps/worker/src/tasks/solve-task.ts` |
| Retention periods | `app.purge_expired()`, through a new migration |
| Plans and prices | `app.plans` ([payments.md](payments.md#plans-and-prices)) |
| Landing page and legal pages | `apps/web/src/app/(marketing)/` |
| Upload types and size limit | `apps/web/src/lib/uploads.ts` and the routes under `apps/web/src/app/api/` |
| Sign-in attempt limits | `limits()` in `apps/web/src/lib/auth.ts` |
| Password rules and hashing cost | `packages/core/src/password.ts` |

## Adapting it to another country

QuickAssign was built for students in Pakistan. To run it elsewhere, check each of these:

- **Time zone.** Deadlines and reminders use each profile's `timezone`. It defaults to `Asia/Karachi`, and there is no setting for it in the app yet. Change the column default (and existing rows) in a new migration.
- **Currency and payments.** `app.plans` only allows PKR, and Safepay serves Pakistan. Another country needs a migration and another payment provider (see [payments.md](payments.md#adding-another-provider)).
- **Phone numbers.** `apps/web/src/lib/phone.ts` accepts international numbers with a country code, and reads a leading `0` as a Pakistani mobile number.
- **Wording.** The landing page mentions JazzCash and Easypaisa. The legal pages cite Pakistani law and Higher Education Commission (HEC) guidance, and so does the AI-use disclosure. Commands also accept Roman Urdu words such as `haan` and `nahi`.
- **Law.** Rules on data protection, AI help and commercial assignment services differ by country. Have the legal pages reviewed locally.
