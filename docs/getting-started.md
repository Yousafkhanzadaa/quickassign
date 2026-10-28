# Getting started

This guide runs the whole of QuickAssign on your own machine: start it, create an account, link a WhatsApp account and get a first worked solution. To run it for other people, read [deployment.md](deployment.md) afterwards.

## What you need

- **Docker Desktop** (or Docker with Compose v2 on Linux). The database, Go, LaTeX and the Node builds all run in containers, so you don't need to install them.
- **An OpenAI API key** (optional). Without one, everything except detecting assignments, indexing material and solving works. Messages that might be assignments are kept and classified once you add a key.
- **A WhatsApp account** to link. Use a spare number or one you're happy to test with (see the WhatsApp warning in the [README](../README.md)).

No other accounts are needed. The database, sign-in and every service run on your computer.

## 1. Start QuickAssign

```bash
git clone <repository-url> quickassign
cd quickassign
./scripts/start.sh
```

`start.sh` does everything in one go:

1. It checks that Docker is running.
2. On the first run, it creates `.env` with random database passwords, encryption keys and service secrets, readable only by you (mode 600).
3. It builds and starts the six services with Docker Compose:
   - `postgres` creates one database role per service the first time it starts (`db/init/00-roles.sh`).
   - `migrate` applies `db/migrations` and exits. A status of `exited (0)` is correct.
   - `gateway`, `sandbox`, `worker` and `web` then start.
4. It waits for the website and prints its address, <http://localhost:3000>.

The first build takes a while, because the sandbox image includes a LaTeX distribution. Later starts are quick. `npm start` (or `pnpm start`) in the repository root runs the same script.

> [!WARNING]
> `.env` holds every secret. It is in `.gitignore`; never commit it or paste it anywhere. `APP_KEK` and `GATEWAY_KEK` encrypt all stored data. If you lose them, the data can't be read, so keep `.env` and the Docker volumes together.

> [!NOTE]
> Don't run `npm run dev` inside `apps/web` to start QuickAssign. That starts only the website, without its settings, database or other services, so every page fails with "Something went wrong". `start.sh` refuses to start while something else is using port 3000.

## 2. Add an OpenAI key (optional)

Set `OPENAI_API_KEY` in `.env`, then run `./scripts/start.sh` again. The default models are `gpt-6-luna` (detection and repair) and `gpt-6.1-sol` (solving). If your account doesn't have them, set `OPENAI_DETECT_MODEL` and `OPENAI_SOLVE_MODEL` to models it does have. [configuration.md](configuration.md) lists every model setting.

## 3. First run

1. **Create an account** at <http://localhost:3000/sign-up> with your name, email address and a password of at least 10 characters. Then fill in your profile. Your name, roll number, university, department, program and semester are printed on your PDFs.
2. **Link WhatsApp** under **WhatsApp**:
   - **On your phone:** choose "Link with phone number" and enter your number with the country code. QuickAssign shows an 8-character code. In WhatsApp, go to **Linked devices → Link a device → Link with phone number instead** and type the code.
   - **On a laptop:** scan the QR code from **WhatsApp → Linked devices → Link a device**.
3. **Choose groups** under **Groups**. Switch on the class groups to watch, map each one to a course, and tag who posts assignments (instructor, TA or class rep). Messages from groups you don't switch on are never stored.
4. **Add courses** under **Courses**, and upload slides or notes (PDF, DOCX, PPTX or TXT, up to 20 MB each). Solutions use this material.
5. **Get a solution.** When an assignment is posted in a watched group, a notice arrives in your "Message yourself" chat. Reply **solve**. You can also add an assignment by hand under **Tasks → New** and click **Get worked solution**.

`.env` starts with `PAYMENTS_PROVIDER=mock`, so **Plans & credits → Buy** opens a simulated checkout. It only works on `localhost` with the local database. New accounts start with `FREE_SIGNUP_CREDITS` free credits (5 by default).

The [user guide](user-guide.md) covers everything a student can do, including the WhatsApp commands.

## Accounts and passwords

- Accounts live in your own database (schema `qa_auth`). Passwords are stored only as salted scrypt hashes.
- Email addresses aren't verified, and there is no "forgot password" email. To set a new password for someone, run this while QuickAssign is running:
  ```bash
  ./scripts/reset-password.sh student@example.com
  ```
  It asks for the new password without showing it, and signs the account out everywhere.
- Students can change their own password, and sign out of all devices, under **Settings**.

## Everyday commands

| Task | Command |
|---|---|
| Start, or apply a `.env` or code change | `./scripts/start.sh` |
| See what's running | `docker compose ps` |
| Follow logs | `docker compose logs -f web worker gateway` |
| Rebuild one service after a code change | `docker compose up -d --build <service>` (for example `web`) |
| Stop, keeping data | `docker compose down` |
| Delete all local data | `docker compose down -v` |

`down -v` deletes the database **and** the WhatsApp session volume. Every account is gone, and every linked device stops working and has to be linked again.

## Running the tests

**TypeScript unit tests.** These need Node 22 or later and pnpm 10, and don't need the stack:

```bash
pnpm install
pnpm --filter @qa/core build
pnpm -r typecheck
pnpm -r test
```

**Go tests,** run in Docker so you don't need Go installed:

```bash
docker run --rm -v "$PWD/gateway":/src -w /src golang:1.26-bookworm go test ./...
docker run --rm -v "$PWD/sandbox":/src -w /src golang:1.26-bookworm go test ./...
```

**Database security tests,** against the running stack. They check row-level security, grants, roles, accounts, payments and credits:

```bash
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d quickassign -f - < db/tests/schema_test.sql
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d quickassign -f - < db/tests/billing_test.sql
```

**End-to-end browser test.** `./scripts/e2e.sh` drives a real browser through the landing page, a plan, sign-up, a simulated payment, the WhatsApp QR code, courses, tasks and tenant isolation. It creates two throwaway accounts and deletes both at the end. Screenshots go to `tests/e2e/results/`, which git ignores.

Two variants:
- `E2E_SOLVE=1` also solves a task with OpenAI. It uses a credit and some API budget.
- `E2E_SAFEPAY=1` pays on Safepay's sandbox checkout (see [payments.md](payments.md)).

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Something went wrong" on every page, and `invalid web configuration: …` in the terminal | The website was started on its own (for example with `npm run dev` in `apps/web`). Stop it with Ctrl+C and run `./scripts/start.sh` instead. |
| `start.sh` says port 3000 is in use | Another program is serving on port 3000, usually a `npm run dev` left running. Stop it with Ctrl+C in its terminal. |
| `start.sh` says Docker isn't running | Open Docker Desktop, wait until it says it's running, and try again. |
| `migrate` exits with `password authentication failed` | `.env` was regenerated after Postgres first started, and the roles still have the old passwords. Put the old `.env` back, or run `docker compose down -v` to start fresh, which deletes local data. |
| "Email or password is incorrect" for a known account | Check for typos, or reset the password with `./scripts/reset-password.sh`. |
| "Too many attempts" | Sign-in is limited to 10 tries per email address every 15 minutes, and 20 per minute from one address. Wait, then try again. |
| Linking says your account "requires a passkey" | Some WhatsApp accounts require a passkey to link a device, and a third-party companion can't provide one. Use another number. |
| Linking fails right away | WhatsApp allows four linked devices. Remove one on your phone and try again. |
| "Our WhatsApp service needs an update" | WhatsApp changed its protocol. Update whatsmeow (`go get go.mau.fi/whatsmeow@latest` in `gateway/`), run the tests, and rebuild the gateway. |
| Nothing is detected | Check that `OPENAI_API_KEY` is set, that the group is switched on under **Groups**, and what `docker compose logs worker` says. If the message only links elsewhere ("check the portal"), add the task by hand. |
| **Buy** says "Payments aren't available yet" | `PAYMENTS_PROVIDER` is `disabled`, `safepay` without both Safepay keys, or `mock` on a non-localhost `APP_BASE_URL`. See [payments.md](payments.md). |
| The mock checkout won't complete | Mock payments also need the database setting `app.allow_mock_payments`, which only the local database setup applies. |
