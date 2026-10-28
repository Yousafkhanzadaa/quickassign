# QuickAssign

> [!CAUTION]
> **USE AT YOUR OWN RISK.** Linking a WhatsApp account gives QuickAssign, and whoever runs its server, **full access to that account**. Messages are also read by an AI service.
>
> - **Your whole WhatsApp is exposed.** QuickAssign is a linked device, like WhatsApp Web. The keys stored on its server can read **all** your chats and **send messages as you**. The code only reads the groups you pick and only messages your own chat, but the server's operator, a bug, a modified version or an attacker could do anything the keys allow.
> - **AI reads your messages.** Messages and files from the groups you switch on, and the course material you upload, are sent to an AI service (OpenAI). AI answers can be wrong.
> - **WhatsApp may ban you.** This is not an official WhatsApp product. WhatsApp's terms don't allow unofficial clients, and WhatsApp may restrict or permanently ban any account that uses one.
> - **No warranty, no liability.** QuickAssign is experimental software, provided "as is". The authors accept no liability for banned accounts, leaked messages, wrong answers, academic penalties or any other harm.
>
> **Read the full [DISCLAIMER](DISCLAIMER.md) before you link an account. If you don't accept these risks, don't use QuickAssign.**

QuickAssign watches the class WhatsApp groups a student chooses. It spots assignments, quizzes and deadline changes, and sends reminders. When the student asks, it writes a worked solution from their own course material and delivers it as a PDF, plus an editable DOCX, to the student's **own** WhatsApp chat. It never posts in groups, never messages anyone else, and never submits anything.

It is a self-hosted, multi-tenant web app that runs entirely on your own machine or server. It needs no cloud accounts apart from an OpenAI key for the AI features. Each student creates an account with an email address and password, and links WhatsApp as a companion device. Their data is encrypted with a key of their own and kept apart from every other student's.

> [!IMPORTANT]
> **Running it for other people?** You will hold every student's WhatsApp keys. Read [DISCLAIMER.md §6](DISCLAIMER.md#6-if-you-run-quickassign-for-other-people) first.
> - Universities set their own rules on AI help, and some countries regulate commercial assignment services.
> - `/privacy`, `/terms` and `/refunds` are templates written for an operator in Pakistan. Have a lawyer adapt them before you launch.

## Features

- **Watches only the groups you choose.** Messages from every other chat are dropped on arrival.
- **Detects tasks.** A cheap keyword and attachment pre-filter, then an LLM classifier, turn messages into assignments, quiz or exam alerts and deadline updates.
- **Reminds.** A reminder 24 hours and 3 hours before each deadline, in the student's "Message yourself" chat.
- **Solves on request.** The student replies `solve`. The solver uses the assignment, its files and the student's course material, and the result is rendered to PDF and DOCX in an isolated sandbox.
- **Uses course material.** Students upload slides and notes, which are indexed for retrieval with pgvector.
- **Credits and payments.** Free trial credits, plus prepaid plans through [Safepay](https://getsafepay.com) (Pakistan). A mock checkout is included for local testing.
- **Security-first design.** Per-student encryption, row-level security, one database role per service, and a render sandbox with no network. See [docs/security-architecture.md](docs/security-architecture.md).

## How it works

| Service | Tech | Role |
|---|---|---|
| `gateway/` | Go, [whatsmeow](https://github.com/tulir/whatsmeow) | One linked companion device per student. Reads only selected groups; sends only to the student's own chat. Per-student AES-256-XTS encrypted session store. |
| `apps/worker/` | Node, graphile-worker, OpenAI | Pre-filter → classify → task tracking → solve → render → deliver; material indexing; reminders; retention; payment reconciliation. |
| `sandbox/` | Go + pandoc + XeLaTeX | Renders PDF/DOCX and extracts text from uploads. No network, read-only, no secrets. |
| `apps/web/` | Next.js 16 | Landing page, legal pages, accounts (email + password), onboarding, WhatsApp linking (pairing code or QR), groups, courses and material, tasks, plans and checkout, settings. |
| `packages/core/` | TypeScript | Shared crypto (byte-compatible with Go), password hashing, tenant-scoped database access, signed service clients, billing. |
| Postgres 17 + pgvector | Docker container | Row-level security on every tenant table; one role per service; accounts, sessions and billing behind `SECURITY DEFINER` functions. |

A group message goes to the gateway, which filters and encrypts it and stores it with `app.gw_ingest_message`. That queues a job. The worker pre-filters it and classifies it after a short debounce. If it's an assignment, the student gets a WhatsApp notice ("reply *solve*"). Replying starts a solve job; the sandbox renders the result, and the PDF arrives in "Message yourself".

More detail is in [docs/architecture.md](docs/architecture.md).

## Quick start

You need Docker Desktop (or Docker with Compose v2). Everything else runs in containers.

```bash
git clone <repository-url> quickassign && cd quickassign
./scripts/start.sh     # first run: creates .env with random secrets, then builds and starts everything
```

Open <http://localhost:3000> and create an account. To turn on detection and solving, add an [OpenAI](https://platform.openai.com) API key to `.env` as `OPENAI_API_KEY` and run `./scripts/start.sh` again. Stop everything with `docker compose down`.

Don't start the website on its own with `npm run dev`; it needs the database and the other services that `start.sh` runs. [docs/getting-started.md](docs/getting-started.md) walks through the first run, linking WhatsApp and getting a first solution.

## Documentation

| Guide | What's in it |
|---|---|
| [Getting started](docs/getting-started.md) | Run QuickAssign on your machine, first steps, tests, troubleshooting |
| [User guide](docs/user-guide.md) | For students: linking WhatsApp, groups, courses, commands, credits, privacy |
| [Configuration](docs/configuration.md) | Every environment variable, which service reads it, and its default |
| [Deployment](docs/deployment.md) | Running it for real users: server, HTTPS, accounts, backups, operations, launch checklist |
| [Payments](docs/payments.md) | Safepay setup, the mock provider, plans and prices, refunds |
| [Architecture](docs/architecture.md) | Services, data flows, database, background jobs, where to change things |
| [Security architecture](docs/security-architecture.md) | Threat model and every security control |
| [Contributing](CONTRIBUTING.md) | Development setup, tests, and the rules every change must follow |
| [Security policy](SECURITY.md) | How to report a vulnerability |
| [Disclaimer](DISCLAIMER.md) | The risks of linking WhatsApp, and why you use QuickAssign at your own risk |

## Repository layout

```
apps/web/        Next.js app: landing and legal pages, dashboard, API routes
apps/worker/     Background jobs: detection, solving, ingestion, reminders, payments, retention
packages/core/   Shared TypeScript: crypto, database access, service clients, billing
gateway/         Go WhatsApp gateway (whatsmeow)
sandbox/         Go document service (pandoc + XeLaTeX), no network
db/              Migrations, database role setup, SQL security tests
scripts/         start, .env generator, password reset, end-to-end test runner
tests/e2e/       Playwright browser test
docs/            Guides
```

## License

QuickAssign is released under the [MIT License](LICENSE).

Third-party components keep their own licenses. Among them:
- **Fonts:** Bricolage Grotesque and Plus Jakarta Sans are under the SIL Open Font License 1.1 (see [`apps/web/src/fonts`](apps/web/src/fonts)).
- **Gateway:** it is built on whatsmeow, which is under the Mozilla Public License 2.0.

QuickAssign is not affiliated with, endorsed by or sponsored by WhatsApp or Meta.
