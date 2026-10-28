# Configuration

QuickAssign is configured with environment variables. For the Docker Compose stack they live in `.env` at the repository root. `scripts/gen-env.sh` creates it, and [`.env.example`](../.env.example) documents the same variables without values.

Every service validates its settings at startup. When something is missing or invalid, the error names the variables and never prints their values.

## How settings reach the services

Docker Compose reads `.env` and substitutes the values into [`docker-compose.yml`](../docker-compose.yml). **A service only sees the variables that `docker-compose.yml` passes to it.** The tables below mark those with ✓ in the *In .env* column. To change any other setting, set it in a `docker-compose.override.yml`:

```yaml
# docker-compose.override.yml
services:
  worker:
    environment:
      WORKER_CONCURRENCY: "8"
```

Compose loads `docker-compose.override.yml` automatically, unless you choose files with `-f` or `COMPOSE_FILE`.

After changing `.env` or an override, run `./scripts/start.sh` (or `docker compose up -d`). Compose recreates the services whose settings changed.

## Secrets

`gen-env.sh` fills all of these with random values. They are secrets: keep them out of git, chat and logs, and in production keep them in a secret manager. In the *Service* column, "role setup" means `db/init/00-roles.sh`, which the local `postgres` container runs on its first start.

| Variable | Service | In .env | What it is |
|---|---|---|---|
| `POSTGRES_PASSWORD` | postgres | ✓ | Superuser password of the local Postgres container. No application service uses it. |
| `QA_OWNER_PASSWORD` | migrate, role setup | ✓ | `qa_owner`, the only role that can change the schema. Used only by the `migrate` job. |
| `QA_QUEUE_PASSWORD` | migrate, worker, role setup | ✓ | `qa_queue`, the job-queue role (graphile-worker). |
| `QA_WEB_PASSWORD` | web, role setup | ✓ | `qa_web`. |
| `QA_WORKER_PASSWORD` | worker, role setup | ✓ | `qa_worker`. |
| `QA_GATEWAY_PASSWORD` | gateway, role setup | ✓ | `qa_gateway`. It can only call the `app.gw_*` functions. |
| `GATEWAY_KEK` | gateway | ✓ | 32 random bytes, base64. Wraps each student's WhatsApp session key. Only the gateway gets it, and it must differ from `APP_KEK`. |
| `GATEWAY_KEK_ID` | gateway | ✓ | Label stored next to keys wrapped by `GATEWAY_KEK`. Default `gw-local-v1`. |
| `APP_KEK` | web, worker, gateway | ✓ | 32 random bytes, base64. Wraps each student's content key (messages, files, solutions). |
| `APP_KEK_ID` | web, worker, gateway | ✓ | Label stored next to keys wrapped by `APP_KEK`. Default `app-local-v1`. |
| `GATEWAY_SECRET_WEB` | web, gateway | ✓ | HMAC secret for web → gateway requests. At least 32 characters, and different from the worker's. |
| `GATEWAY_SECRET_WORKER` | worker, gateway | ✓ | HMAC secret for worker → gateway requests. |
| `SANDBOX_TOKEN` | worker, sandbox | ✓ | Bearer token for worker → sandbox requests. At least 32 characters. |

> [!CAUTION]
> **Back up `APP_KEK` and `GATEWAY_KEK`.** If you lose them, every student's data and WhatsApp link becomes unreadable. If they leak, together with a copy of the database or session volume, that data is exposed. Key rotation isn't implemented yet; the `*_KEK_ID` labels exist to support it.

## Site

| Variable | Service | In .env | Default | What it is |
|---|---|---|---|---|
| `APP_BASE_URL` | web, worker | ✓ | `http://localhost:3000` | The site's public URL, used for redirects and in links sent over WhatsApp. Use your `https://` domain in production. Test users and mock payments only work while it is a localhost URL. |
| `FREE_SIGNUP_CREDITS` | web | ✓ | `5` | Free credits each new account gets once (0–20). They never expire. |
| `LEGAL_NAME` | web | ✓ | `QuickAssign` | The person or company that runs the site. Shown in the footer and on the legal pages. |
| `CONTACT_EMAIL` | web | ✓ | — | Support and privacy contact shown on the legal pages. |
| `CONTACT_ADDRESS` | web | ✓ | — | Business address for the legal pages. Payment providers usually require one. |
| `REPO_URL` | web | ✓ | — | `https://` link to the source code. The footer and legal pages link to it. |

## Accounts

Accounts need no settings. They are stored in the database (schema `qa_auth`), and session cookies are marked `Secure` whenever `APP_BASE_URL` starts with `https://`. The attempt limits for sign-in and sign-up are in `limits()` in `apps/web/src/lib/auth.ts`. Resetting a forgotten password is described in [getting-started.md](getting-started.md#accounts-and-passwords).

## OpenAI

All of these are read by the worker. Without `OPENAI_API_KEY`, detection, indexing and solving don't run. Messages that might be assignments are kept and classified once a key is added.

| Variable | In .env | Default | What it is |
|---|---|---|---|
| `OPENAI_API_KEY` | ✓ | — | API key. Use a project key with a monthly budget. |
| `OPENAI_DETECT_MODEL` | ✓ | `gpt-6-luna` | Classifies candidate messages into tasks. |
| `OPENAI_SOLVE_MODEL` | ✓ | `gpt-6.1-sol` | Writes worked solutions. |
| `OPENAI_SOLVE_EFFORT` | ✓ | `high` | Reasoning effort for solving: `none`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`. |
| `OPENAI_DETECT_EFFORT` | | `low` | Reasoning effort for detection. Same values. |
| `OPENAI_REPAIR_MODEL` | | `gpt-6-luna` | Repairs math that fails validation before rendering. |
| `OPENAI_EMBED_MODEL` | | `text-embedding-3-small` | Embeds course material. It must support 1536-dimension output, because the database column is `vector(1536)`. |
| `OPENAI_SOLVE_MAX_OUTPUT_TOKENS` | | `32000` | Output cap per solve (4,000–128,000). |

Every call sends `store: false`, through one choke point: `apps/worker/src/llm/openai.ts`.

## Payments

| Variable | Service | In .env | Default | What it is |
|---|---|---|---|---|
| `PAYMENTS_PROVIDER` | web | ✓ | `disabled` | `safepay` for real payments, `mock` for a simulated checkout (localhost and the local database only), or `disabled`. `gen-env.sh` sets `mock`. |
| `SAFEPAY_ENV` | web, worker | ✓ | `sandbox` | `sandbox` (test cards, no real money) or `production`. |
| `SAFEPAY_API_KEY` | web, worker | ✓ | — | Safepay API key. |
| `SAFEPAY_SECRET_KEY` | web, worker | ✓ | — | Safepay secret key. Secret. |
| `SAFEPAY_WEBHOOK_SECRET` | web | ✓ | — | Secret of the Safepay webhook endpoint. Secret. |

The worker uses the Safepay keys to re-check pending payments every 5 minutes; without them it skips that job. See [payments.md](payments.md).

## Tuning

None of these are passed by `docker-compose.yml`; set them in an override file. The defaults suit a small deployment.

**Worker**

| Variable | Default | What it is |
|---|---|---|
| `WORKER_CONCURRENCY` | `4` | Jobs run in parallel (1–32). |
| `DB_POOL_MAX` | `10` | Database connections (1–50). |
| `QUEUE_POOL_MAX` | `10` | Job-queue connections (2–50). |
| `CLASSIFY_DEBOUNCE_SECONDS` | `90` | How long to wait for related messages, such as a PDF following "Assignment 3", before classifying (10–600). |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug` or `trace`. |

**Web**

| Variable | Default | What it is |
|---|---|---|
| `DB_POOL_MAX` | `10` | Database connections (1–50). |

**Gateway**

| Variable | Default | What it is |
|---|---|---|
| `GATEWAY_DEVICE_OS` | `QuickAssign` | Device name students see in WhatsApp → Linked devices. |
| `GATEWAY_SEND_PER_HOUR` | `40` | Maximum WhatsApp messages sent to each student per hour. |
| `GATEWAY_HISTORY_DAYS` | `14` | How far back the history sent at link time is considered (at most 30). |
| `GATEWAY_HISTORY_TTL_MINUTES` | `45` | How long that history stays in memory while the student picks groups. It is then discarded. |
| `GATEWAY_MEDIA_MAX_BYTES` | `26214400` (25 MiB) | Largest attachment the gateway downloads. |
| `GATEWAY_STORE_DIR` | `/data/sessions` | Where the encrypted per-student session files live (the `wa_sessions` volume). |
| `GATEWAY_INSTANCE_ID` | `gateway-1` in Compose | Instance name, used in logs and for the database leases that stop two gateways running the same session. |
| `GATEWAY_LISTEN` | `:8081` | Listen address on the internal network. |
| `LOG_LEVEL` | `info` | Log level. |

**Sandbox**

| Variable | Default | What it is |
|---|---|---|
| `SANDBOX_LISTEN` | `:8090` | Listen address on the sandbox network. |
| `SANDBOX_WORKDIR` | `/tmp` | Per-job temporary directories (a tmpfs in Compose). |
| `SANDBOX_TEMPLATE` | `/app/templates/qa.latex` | LaTeX template for PDFs. The source is [`sandbox/templates/qa.latex`](../sandbox/templates/qa.latex). |

**Set by Compose.** Don't put these in `.env`; `docker-compose.yml` builds them from the values above: `WEB_DATABASE_URL`, `WORKER_DATABASE_URL`, `GATEWAY_DATABASE_URL`, `QUEUE_DATABASE_URL`, `OWNER_DATABASE_URL`, `MIGRATIONS_DIR`, `GATEWAY_URL` and `SANDBOX_URL`.

## End-to-end test

Read by [`scripts/e2e.sh`](../scripts/e2e.sh), never by the services. See [getting-started.md](getting-started.md#running-the-tests).

| Variable | What it is |
|---|---|
| `E2E_SOLVE` | `1` also solves a task with OpenAI (uses a credit). |
| `E2E_SAFEPAY` | `1` pays on Safepay's sandbox checkout. |

Set them in the shell, for example `E2E_SOLVE=1 ./scripts/e2e.sh`.
