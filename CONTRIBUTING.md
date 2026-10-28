# Contributing

Thanks for helping improve QuickAssign. It holds students' linked WhatsApp devices, so every change is judged on security first.

## Before you start

- **Read the rules.** The non-negotiable rules are in [SECURITY.md](SECURITY.md), and the design behind them is in [docs/security-architecture.md](docs/security-architecture.md). Pull requests that break a rule won't be merged.
- **Report vulnerabilities privately,** as SECURITY.md describes. Never report them in an issue or pull request.
- **Discuss larger changes first** by opening an issue, so you don't build something that can't be merged.

## Development setup

You need Docker with Compose v2, Node 22 or later, and pnpm 10 (`corepack enable` provides the pinned version).

```bash
pnpm install
pnpm --filter @qa/core build     # web and worker import the built core package
```

To run the whole stack, follow [docs/getting-started.md](docs/getting-started.md). The quickest way to try a change is to rebuild just that service, for example `docker compose up -d --build web`.

Running `pnpm --filter @qa/web dev` outside Docker only works if the database and gateway are reachable from your machine. The default Compose networks keep them private.

## Checks before you open a pull request

CI runs all of these, so run them first:

```bash
pnpm -r typecheck
pnpm -r test
pnpm --filter @qa/web build
docker run --rm -v "$PWD/gateway":/src -w /src golang:1.26-bookworm sh -c "go vet ./... && go test ./..."
docker run --rm -v "$PWD/sandbox":/src -w /src golang:1.26-bookworm sh -c "go vet ./... && go test ./..."
```

Also:
- If you changed anything in `db/`, run the database tests ([getting-started.md](docs/getting-started.md#running-the-tests)).
- If you changed a user flow, run `./scripts/e2e.sh`.

## Rules for changes

**Database**
- Add a new numbered migration in `db/migrations`. Never edit one that has already been applied.
- Every new tenant table gets `ENABLE` and `FORCE ROW LEVEL SECURITY`, with policies on `app.current_user_id()`. Never create tables in `public`.
- Add checks to `db/tests/` for new grants, functions and policies.

**Data and secrets**
- Never log message content, file contents, keys, tokens, phone numbers or names.
- Keep secrets, real keys, personal data and real WhatsApp content out of code, tests, fixtures, screenshots and issues. Use obviously fake values, such as `example.com` addresses and `+92 300 1234567`.
- Every tenant query runs inside `withTenant(...)`.

**Boundaries**
- Only `gateway/internal/session/outbound.go` sends WhatsApp messages, and only to the account owner. `TestOnlyOutboundSends` enforces this.
- Every OpenAI call goes through `apps/worker/src/llm/openai.ts`.
- Untrusted documents and model output are converted only inside the `sandbox` service.

**Dependencies**
- Keep versions pinned, and commit lockfile changes.
- A package may run install scripts only if it is listed under `onlyBuiltDependencies` in `pnpm-workspace.yaml`, and adding one needs review.

**Style**
- Match the surrounding code, and add tests for new behavior.

## Pull requests

- Keep each pull request to one logical change, and explain what it changes and why.
- Say whether it affects data access, sign-in, payments or WhatsApp sending.
- CI must pass: TypeScript, Go, the database security tests, the image build and CodeQL.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
