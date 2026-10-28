# Security

QuickAssign links to students' WhatsApp accounts, so security is the top priority. The full threat model and every control are documented in [docs/security-architecture.md](docs/security-architecture.md).

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub's **Report a vulnerability** button (Security tab), or by email to the contact address on the website. Don't open a public issue, and don't access, modify or keep other people's data. We'll acknowledge reports within 72 hours and credit you when the fix ships, if you'd like.

In scope: anything that exposes a student's WhatsApp, messages, files or solutions to anyone else; anything that sends WhatsApp messages to anyone but the owner; signing in as someone else or bypassing the sign-in limits; getting credits without paying; reaching the sandbox, the gateway or the database from the internet.

## Non-negotiable rules for contributors

1. Only `gateway/internal/session/outbound.go` may send WhatsApp messages, and only to the account owner. `TestOnlyOutboundSends` enforces this.
2. Never mark messages read, send presence, or join/leave/modify groups.
3. Never log message content, file contents, keys, tokens, phone numbers or names.
4. Every tenant query runs inside `withTenant(...)`. Never add `BYPASSRLS` to an application role.
5. Every OpenAI call goes through `apps/worker/src/llm/openai.ts` (`store: false`).
6. Untrusted documents and model output are only converted inside the `sandbox` service.
7. Quizzes and exams are never solved.
8. Prices come only from `app.plans`, and credits are granted only by `app.fulfill_payment` after the provider's server-side API confirms the payment. Never trust amounts, statuses or ids from the browser, the return URL or a webhook body.
9. The `mock` payment provider must never work in production: it needs a localhost URL **and** the database setting `app.allow_mock_payments`, which only the local bootstrap sets.
10. Never create tables in the `public` schema (hosted Postgres may expose it), and every new tenant table gets `ENABLE` + `FORCE ROW LEVEL SECURITY`. `db/tests/schema_test.sql` checks both in CI.
11. Identify students only through `getUser()` / `requireUser()` in `apps/web/src/lib/session.ts`, which checks the session cookie against `qa_auth.session_account` in the database. Never trust a user id from the browser.
12. Passwords are only ever hashed with `hashPassword()` in `packages/core/src/password.ts`. Never log, store or send a password or a session token in plain form; the database keeps only their hashes, and no application role may read the `qa_auth` tables directly.
