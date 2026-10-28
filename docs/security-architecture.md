# QuickAssign security architecture

QuickAssign holds the most sensitive thing a student has on their phone: a linked WhatsApp device. This document lists what we protect, who we protect it from, and every control in the code that does it.

## 1. Assets, ranked

| Asset | Where it lives | Impact if leaked |
|---|---|---|
| WhatsApp device keys (Signal identity, sessions, pre-keys, app-state keys) | Per-student encrypted SQLite file on the gateway volume | Attacker can read the student's **entire** WhatsApp and send as them |
| Group messages from selected groups (incl. classmates' and instructors' text) | `app.inbound_messages` (encrypted) | Privacy breach of third parties |
| Files, course material, solutions | `app.blobs` (encrypted) | Academic and personal data |
| Passwords and sessions | Salted scrypt hashes and SHA-256 token hashes in `qa_auth`; session tokens in HttpOnly cookies | Account takeover |
| OpenAI API key, service secrets, KEKs | Environment / secret manager | Cost abuse, decryption of everything |
| Payment records, credit balances, Safepay secret and webhook keys | `app.payments`, `app.credit_grants`; environment | Free credits, forged payments, refunds abuse |

## 2. Trust boundaries

```
Internet ──► web (Next.js) ──HMAC──► gateway (Go) ──► WhatsApp servers
                │   └──► Safepay API (checkout, verification)
                ▼                       │
            Postgres ◄──────────────────┘
                ▲
                └── worker (Node) ──► OpenAI API (store:false), Safepay API (reconciliation)
                            │
                            ▼ bearer token, no internet
                        sandbox (pandoc/XeLaTeX)
```

- **Only `web` is exposed.** Everything else is on Docker networks marked `internal: true`. Only the gateway (WhatsApp), the worker (OpenAI, Safepay) and web (Safepay) have outbound internet.
- **Postgres runs beside the services.** It's a container on the internal network, with no published port (§3.11).
- **The sandbox has no network at all** besides the worker, and holds no secrets except its own bearer token.

## 3. Controls

### 3.1 WhatsApp session keys: encrypted per student, crypto-shreddable
- Each student's whatsmeow store is a separate SQLite file encrypted with **AES-256-XTS** (`gateway/internal/wastore`), keyed by a random **512-bit per-student key**.
- That key is stored only **wrapped** (AES-256-GCM) by `GATEWAY_KEK`, which is given to the gateway and nothing else (`gateway.sessions.wrapped_dek`). The web and worker can't decrypt WhatsApp keys even if fully compromised.
- The key is applied via `PRAGMA hexkey` in the connection hook, never in a DSN, so it never appears in logs or errors.
- Store files are mode `0600`; file names are random and validated against path traversal.
- **Unlink / logout / account deletion**: `Logout` removes the device from the phone; the file and the wrapped key are deleted. Without the wrapped key, backup copies of the file are unreadable (crypto-shredding).
- Test: `wastore/store_test.go` proves the file has no plaintext SQLite header and won't open with the wrong key.

### 3.2 The gateway can only talk to the student
- **One send path.** `session/outbound.go` is the only file allowed to call `SendMessage`. The recipient is computed from the device's own identity and re-checked immediately before sending. Group, broadcast and other-user JIDs are rejected.
- **Static invariant test.** `TestOnlyOutboundSends` parses every Go file and fails the build if anything else calls `SendMessage`, or if anything calls `MarkRead`, `SendPresence`, `JoinGroupWithLink`, `LeaveGroup`, `CreateGroup`, and similar.
- **Invisible companion.** The gateway never marks messages read, never sends presence, and never posts statuses, so the phone behaves exactly as before.
- **Rate limit.** At most `GATEWAY_SEND_PER_HOUR` sends per student.
- **Edge filter.** Messages from unselected chats are dropped in the event handler before any storage or logging. History sync from unselected groups is held **in memory only**, for at most 45 minutes, then discarded. The database independently refuses messages for unmonitored groups (`app.gw_ingest_message`).
- **Commands.** Self-chat messages are forwarded only if they reply to one of our messages or start with `qa`, so personal notes stay private.

### 3.3 Service-to-service authentication
- **web/worker → gateway.** HMAC-SHA256 over the service, timestamp, nonce, method, path and body hash. Requests must be within ±60 s, and each nonce is single-use.
  - Each service has its own secret, and routes have per-service allowlists: only the worker can send messages or fetch media; only web can link or unlink.
  - Cross-language test vectors in Go and TypeScript prove both implementations agree.
- **worker → sandbox.** A constant-time compared bearer token.

### 3.4 Database: least privilege + row-level security
- **One login role per service**: `qa_web`, `qa_worker`, `qa_gateway`, `qa_queue`, and `qa_owner` (migrations only). `qa_maint` can't log in.
- **Row-level security** is `ENABLE`d and `FORCE`d on every tenant table, keyed on `app.current_user_id()`, which services set per transaction (`withTenant`). A forgotten `WHERE` clause can't leak another student's rows.
  - Verified live: tenant B can't read, update, delete or forge tenant A's rows, and a session without tenant context sees nothing.
- **The gateway has no table access** in schema `app`; it can only call `app.gw_*` `SECURITY DEFINER` functions, each scoped to one tenant.
- **Narrow privileges for web.** Column-level `UPDATE` only. Credits can only be granted through `app.grant_signup_credits` (fixed amount, idempotent). Task status changes go through `app.enqueue_solve` / `app.skip_task`, which check ownership.
- **Append-only records.** The audit log and credit ledger can't be updated or deleted by app roles.
- **Retention.** The purge runs as `qa_maint` (BYPASSRLS), reachable only through `app.purge_expired()`.
- **Safety nets.** Every `SECURITY DEFINER` function pins `search_path`. Per-role statement and idle-transaction timeouts are set.

### 3.5 Encryption of content at rest
- **Per-student content key.** Each student has a random 256-bit content key, wrapped by `APP_KEK` (`app.tenant_keys`).
- **What's encrypted.** Message text, file names, sender display names, media descriptors, task summaries, files, course material chunks and solutions are AES-256-GCM.
- **AAD binding.** Each ciphertext's AAD binds `purpose/tenant/record`, so moving it to another row or tenant fails decryption.
- **Pseudonymous senders.** Senders are stored as a keyed per-tenant HMAC; no phone numbers or LIDs are stored.
- **Account deletion.** It deletes every row and then the content key.

### 3.6 Untrusted documents and model output are handled only in the sandbox
- **Container hardening.** Read-only root, tmpfs `/tmp`, all capabilities dropped, `no-new-privileges`, pids/memory/CPU limits, unprivileged user, no network.
- **Parse first, inspect, then render.** Markdown is parsed to the pandoc AST with raw TeX/HTML/attributes disabled. The AST is inspected:
  - raw nodes are rejected;
  - images are removed;
  - every math node is checked against a denylist (`\input`, `\write18`, `\csname`, `\catcode`, `^^` escapes, `\directlua`, …) and brace balance.
- **The worker validates first.** Every formula is also checked by KaTeX (an allowlist) before it is sent.
- **Student details never reach a parser.** They are inserted into the AST as literal strings, so pandoc escapes them.
- **XeLaTeX restrictions.** It runs with `-no-shell-escape`, `openin_any=p`, `openout_any=p`, `shell_escape=f`, per-job temp dirs, timeouts and process-group kill.
- **Uploads.** Uploads are identified by magic bytes, not names. Zip archives are checked for bombs before extraction. XML is parsed with Go's `encoding/xml`, which does not resolve external entities.
- **Verified live.** `\input{/etc/passwd}` in math, `\immediate\write18`, `\csname` and `^^5c` tricks are all rejected. Payloads in names and text render literally.

### 3.7 LLM data handling (OpenAI)
- **`store: false` on every call** (`apps/worker/src/llm/openai.ts`). The Responses API defaults to storing for 30 days; we override it in one choke point.
- **No training by default.** API data isn't used for training by default.
  - Zero Data Retention / Modified Abuse Monitoring can be requested from OpenAI for production.
  - Data residency (e.g. UAE) is available for eligible accounts.
- **`safety_identifier`** is a keyed hash of the tenant, never an email.
- **Minimal identity.** Classmates appear to the model as `S1`, `S2`… with a role; names and numbers are never sent.
- **Prompt injection.** Group messages and files are wrapped as data. The models have **no tools**: they can't send messages, read other tenants' data, or reach the network. Output is validated with zod, rendered in the sandbox, and only ever delivered to its owner.
- **Exams.** Quizzes and exams are never solved; this is enforced in the database (`app.enqueue_solve`) and again in the worker.

### 3.8 Web application
- **Local accounts: email and password, checked on the server.** Sign-up and sign-in are Server Actions; no browser code handles a password or a token.
  - **Password storage.** Passwords are hashed with scrypt (N=2^15, r=8, p=3, a 16-byte random salt each; `packages/core/src/password.ts`), after Unicode NFKC normalization. The parameters are stored with each hash, and a weaker hash is replaced at the next sign-in. Passwords are 10 to 128 characters.
  - **No account oracle.** An unknown email address costs the same scrypt work as a wrong password, and both get the same message.
  - **Attempt limits.** Sign-in allows 10 attempts per email address per 15 minutes and 20 per client address per minute; sign-up allows 20 per client address per hour; password re-checks in Settings allow 10 per account per 15 minutes. The counters live in the web process's memory, so a restart resets them, and several web instances each count separately.
  - **Sessions.** A session is 32 random bytes in an HttpOnly, SameSite=Lax cookie, which is Secure and `__Host-`-prefixed under HTTPS. The database stores only the token's SHA-256, so a copy of `qa_auth.sessions` can't be used to sign in. Sessions expire after 30 days without use. Signing in replaces any previous session in that browser.
  - **Verified on every request.** Every page and action resolves the cookie in the database (`qa_auth.session_account`); the proxy only uses the cookie's presence to send signed-out visitors to the sign-in page.
  - **Least privilege in the database.** The `qa_auth` tables have no grants. `qa_web` may call only the sign-up, sign-in, session and password-change functions; `qa_worker` only `qa_auth.delete_user`; nobody but the owner `qa_auth.reset_password`. `db/tests/schema_test.sql` checks this.
  - **Redirects.** After sign-in, students go back only to paths on this site. The path is parsed as a browser would, which blocks `//evil.com`, `/\evil.com` and `/\t/evil.com`.
  - **Sign out everywhere** deletes every session of the account. Changing the password signs out every other device.
- **Content Security Policy.** Strict per-request nonce CSP with `'strict-dynamic'` and no `unsafe-inline` in production, plus HSTS, `frame-ancestors 'none'`/`X-Frame-Options: DENY`, `nosniff`, COOP/CORP, Referrer- and Permissions-Policy.
- **Server actions.** Every action re-validates the session, validates input with zod, and runs inside the student's RLS scope. Next.js verifies the Origin on server actions (CSRF).
- **Downloads.** Downloads are `no-store` and `Content-Disposition: attachment`, with `CSP: sandbox`. Open-redirects on sign-in are blocked.
- **Account deletion** needs the account's password again (so an unlocked laptop isn't enough), then:
  1. unlinks WhatsApp and destroys its keys;
  2. signs the account out on every device;
  3. the worker purges every data row and the content key;
  4. the worker deletes the account through `qa_auth.delete_user`, which only `qa_worker` may execute.

### 3.9 Logging and supply chain
- **Logs.** Logs never contain message content, keys, tokens or phone numbers. Go logs redact digit runs; pino redacts content-like fields; tenants are logged as an 8-character prefix.
- **Containers.** They run as non-root on read-only filesystems. The gateway image is distroless (no shell).
- **Dependencies.** Versions are pinned and lockfiles committed. `go mod verify` runs in the build, and only allow-listed npm packages may run install scripts. Tests run inside every image build.

### 3.10 Payments and credits
- **Hosted checkout.** Payments go through Safepay, a payment service provider licensed by the State Bank of Pakistan. Students enter card or JazzCash/Easypaisa details on Safepay's page; QuickAssign never sees or stores them.
- **Prices live only on the server.** Prices exist only in `app.plans`. `app.start_checkout` copies the plan's amount into `app.payments`; the browser only sends a plan id. Checkouts are limited to 10 per student per hour.
- **Nothing from the browser is trusted.** The return URL carries only our own payment id, in the path (Safepay appends `?tracker=…`, which we ignore). The page loads that payment under RLS (another student gets a 404) and asks Safepay's reporter API what happened.
- **Webhooks are a hint, never proof.**
  - `X-SFPY-SIGNATURE` is a hex HMAC-SHA512 of the JSON body, checked in constant time. We accept the raw body (as in Safepay's PHP SDK) or its compact re-encoding (as in Safepay's WooCommerce plugin). The body is limited to 64 KB.
  - A valid webhook only triggers the same server-side lookup, whatever its event type. Its body is never used to fulfil anything.
- **What counts as paid** (`interpretTracker`, `app.fulfill_payment`):
  - Safepay reports the tracker as `TRACKER_ENDED`, and its `mode` is `payment` (not, say, a saved-card session);
  - the tracker's merchant `client` equals our API key;
  - the tracker's `metadata.order_id` (set when we created it) equals our payment id;
  - the amount and currency equal what we stored at checkout.
  - These rules were checked against real responses from Safepay's sandbox.
  - A wrong amount marks the payment `failed` with `amount_mismatch`, and it is never fulfilled automatically, even on a later check.
- **Idempotent fulfilment.** A row lock, `UNIQUE (payment_id)` on credit grants and a unique ledger reference let the return page, the webhook and the reconciliation job race safely. Fulfilling twice never grants twice (covered by the e2e test).
- **Reconciliation.** Every 5 minutes the worker re-checks pending payments (up to 7 days old) and payments closed as failed/expired in the last 24 hours, since a student can retry and pay on the same checkout.
- **Credits.**
  - Before a solve, `app.reserve_credit` takes one credit from the grant that expires first (row-locked).
  - If the solve fails, `app.release_credit` returns it.
  - Balances come from `app.credit_grants`. The append-only `app.credit_ledger` records every change.
- **Least privilege.**
  - App roles can't insert credit grants or update payments; everything goes through the definer functions above.
  - Operator refunds use `app.refund_payment`, which no application role can execute.
- **The mock provider can't reach production.** Simulated payments need all three of:
  - `PAYMENTS_PROVIDER=mock`;
  - a localhost `APP_BASE_URL`;
  - the database setting `app.allow_mock_payments = on`, which only the local bootstrap (`db/init/00-roles.sh`) applies, and only to `qa_web`.
- **Secrets.** The Safepay secret key goes to web and worker; the webhook secret goes to web only. Safepay error bodies are redacted before logging.
- **Retention.** Payment records, the ledger and audit entries survive account deletion, keyed only by the pseudonymous user id.

### 3.11 The database stays on your server
- **No hosted services.** The database, accounts and sessions live in the `postgres` container on the internal Docker network. It has no published port, so only the services can reach it.
- **Nothing in `public`.** Data lives in `app`, `gateway`, `qa_auth`, `graphile_worker` and `qa_meta`.
- **Database hygiene.** Every `SECURITY DEFINER` function pins `search_path`, RLS policies evaluate the tenant once per statement, and every foreign key is indexed (migration 0006).

## 4. Known gaps before production

1. **KEKs come from environment variables.** Move them to a KMS (AWS KMS / GCP KMS) and implement key rotation (`kek_id` columns already exist for it).
2. **TLS between services.** The internal network is plaintext; add mTLS or a service mesh when services span hosts.
3. **Accounts.** Email addresses aren't verified, there is no self-service password reset (the operator runs `scripts/reset-password.sh`), and there is no second factor. Sign-in limits are per web process; add limits at the reverse proxy too.
4. **WhatsApp's Terms of Service.** The linked-device approach is unofficial. The ban rate must be a monitored metric ([deployment.md](deployment.md#6-operations)).
5. **Data-protection law.** Check the rules where you operate before launch, for example India's DPDP Act or Pakistan's pending data-protection bill.
6. **Penetration test** before public launch; consider a bug bounty.
7. **Backups.** The Postgres volume and the gateway session volume need encrypted, access-controlled backups. Restoring a session file without its `gateway.sessions` row is impossible by design.
8. **Payments.** Complete Safepay merchant onboarding, test end to end in Safepay's sandbox, and register the webhook (`/api/payments/safepay/webhook`) before switching `SAFEPAY_ENV=production`.
9. **Legal pages.** `/privacy`, `/terms` and `/refunds` describe how the code works, but they need review by a lawyer for the operating entity before launch.
