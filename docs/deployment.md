# Deployment

This guide covers running QuickAssign for real students. Get it working locally first with [getting-started.md](getting-started.md).

Production runs the same Docker Compose stack as your laptop, on a server you control. The database, accounts and every service live on that server. You add:

- a server;
- a domain with HTTPS;
- backups;
- optionally, real payments.

`docker-compose.yml` already hardens every container, and it publishes the web app on `127.0.0.1:3000` only, so it sits behind a reverse proxy on the same host.

> [!IMPORTANT]
> Before you invite students, read the warnings in the [README](../README.md) about WhatsApp's terms, academic integrity and the legal pages. Also read the known gaps in [security-architecture.md §4](security-architecture.md#4-known-gaps-before-production).

## What you need

- **A Linux server with Docker and Compose v2.** It needs persistent disk for the database and WhatsApp session volumes.
- **A domain name.**
- **An OpenAI project key** with a monthly budget and usage alerts.
- **A Safepay merchant account,** if you take payments (see [payments.md](payments.md)).

Choose a server region close to your students.

## 1. Configure for production

Copy the repository to the server and generate fresh secrets there with `./scripts/gen-env.sh`. Never reuse development secrets. Then set:

```bash
APP_BASE_URL=https://<your-domain>
PAYMENTS_PROVIDER=safepay        # or disabled; never mock
SAFEPAY_ENV=production
LEGAL_NAME=...                   # who runs the service
CONTACT_EMAIL=...
CONTACT_ADDRESS=...
REPO_URL=https://...             # your public source code
OPENAI_API_KEY=...
```

[configuration.md](configuration.md) explains every variable.

**Turn off mock payments in the database.** The local role setup lets `qa_web` use mock payments. They are already refused on any non-localhost URL, but turn the setting off as well. Start the stack once (next sections), then run:

```bash
docker compose exec postgres psql -U postgres -d quickassign -c "ALTER ROLE qa_web RESET app.allow_mock_payments;"
docker compose restart web   # open connections keep the old setting until they reconnect
```

**Keep the secrets safe:**
- Keep `.env` at mode 600, owned by the account that runs Compose, or better, load the values from a secret manager.
- Back up `APP_KEK` and `GATEWAY_KEK` offline, for example in a password manager plus one offline copy. Losing them makes all stored data unreadable.
- Moving the keys into a KMS, with rotation, is a known gap.

## 2. HTTPS and the reverse proxy

The web app listens on `127.0.0.1:3000`. Put a reverse proxy on the same host to terminate TLS. Leave only ports 443 and 80 open (80 only for redirects and certificate issuance). For example, with [Caddy](https://caddyserver.com), which obtains certificates automatically:

```
your-domain.example {
	reverse_proxy 127.0.0.1:3000
}
```

- **Keep the original `Host` header.** Caddy does by default; with nginx, set `proxy_set_header Host $host;` and `X-Forwarded-Proto`. Next.js checks that server-action requests come from the same host, so a rewritten host breaks every form.
- **Let the proxy set `X-Forwarded-For`.** Sign-in limits per address use the last entry of that header, which must be the one your proxy added. With nginx, use `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`. With one proxy in front, nothing else is needed.
- **The app sends HSTS** with `includeSubDomains` and `preload`. Make sure every subdomain of your domain serves HTTPS, or change the header in `apps/web/next.config.ts` first.
- **Add rate limits at the proxy** for sign-in, uploads, server actions and the payment webhook. The app's own sign-in limits live in one process's memory, and the database caps checkouts per student, but nothing else is limited per address.

## 3. Start and verify

```bash
./scripts/start.sh
docker compose ps        # migrate exited (0); everything else running
```

Then prove it end to end before inviting anyone:

1. Create an account on your domain, sign out, and sign in again.
2. Link a **spare** WhatsApp number, switch on a test group, post an assignment, reply **solve**, and check that the PDF arrives in "Message yourself".
3. Make one real payment and refund it ([payments.md](payments.md#go-live)).
4. Run `db/tests/schema_test.sql` against the database ([getting-started.md](getting-started.md#running-the-tests)).
5. Practise a restore (section 5).

## 4. Accounts

- Students create accounts with an email address and a password of at least 10 characters. Passwords are stored as salted scrypt hashes, and sessions as SHA-256 hashes of random tokens.
- Email addresses aren't verified, and the app sends no email. A student who forgets their password needs you: run `./scripts/reset-password.sh <email>` on the server.
- Students change their own password, and sign out of all devices, under **Settings**. Deleting an account asks for the password again.

## 5. Backups and restore

- **Database.** Back up the `pgdata` volume with `pg_dump` (or volume snapshots) to encrypted, access-controlled storage, on a schedule, and keep several days.
- **WhatsApp sessions.** Back up the `wa_sessions` volume too. Each student's session file is encrypted. By design, it can't be restored without its row in `gateway.sessions`, so back up the database and the volume together.
- **Keys.** Backups are useless without `APP_KEK` and `GATEWAY_KEK`.
- **Practise a restore** before launch, and after any change to the setup.

## 6. Operations

- **Keep the gateway current.** WhatsApp changes its protocol from time to time. Update `go.mau.fi/whatsmeow` regularly (`go get go.mau.fi/whatsmeow@latest` in `gateway/`), run the tests, and redeploy promptly. A `ClientOutdated` log line means it's urgent.
- **Watch the ban rate.** Count rows in `app.wa_links` whose `status` is `logged_out` or `temp_banned`. A rising number means WhatsApp is pushing back, and it is the key health metric.
- **Retention runs hourly.** Group messages and their attachments are deleted after 30 days, and commands after 7 days. Unfinished checkouts are closed after 3 hours.
- **Payments.** Look into any `payment_amount_mismatch` in `app.audit_log`; such payments are never fulfilled automatically. Prices and refunds are in [payments.md](payments.md).
- **Logs** never contain message content, keys, tokens, passwords or phone numbers, and tenants appear as an 8-character prefix. Configure log rotation in Docker.
- **Monitoring.** Alert on uptime, server errors, failed jobs, the payment reconciliation job and the ban rate.

## Launch checklist

**Accounts and access**
- [ ] Two-step verification on every account you use to run it: OpenAI, Safepay, GitHub, your domain registrar and your hosting provider.
- [ ] Only you (and people you trust) can log in to the server.
- [ ] On GitHub: branch protection with required checks, secret scanning with push protection, Dependabot alerts and private vulnerability reporting.

**Configuration**
- [ ] Production secrets were generated on the server, and the KEKs are backed up offline.
- [ ] `APP_BASE_URL` is your `https://` domain.
- [ ] `PAYMENTS_PROVIDER` is `safepay` or `disabled`, never `mock`, and mock payments are reset in the database.
- [ ] `LEGAL_NAME`, `CONTACT_EMAIL`, `CONTACT_ADDRESS` and `REPO_URL` are set.
- [ ] The OpenAI key has a budget and alerts, and the configured models are available to it.

**Network and data**
- [ ] Only ports 443 and 80 are open, the proxy sets `X-Forwarded-For` and has rate limits, and every subdomain serves HTTPS.
- [ ] `schema_test.sql` passes against the production database.
- [ ] Backups run, and a restore drill worked.

**Money and legal**
- [ ] The Safepay webhook is registered, Raast is enabled, and one real payment and one refund have worked.
- [ ] A lawyer has reviewed `/privacy`, `/terms` and `/refunds` for your entity and country.
- [ ] You've checked business registration and tax with an accountant.

**Proof**
- [ ] A full test with a spare WhatsApp number worked, from detection through solving and delivery.
- [ ] `./scripts/e2e.sh` passed against a staging copy.

**After launch**
- [ ] Check the ban rate weekly, and update whatsmeow monthly.
- [ ] Answer the support inbox, including password resets. The refund policy promises a reply within 3 business days.
- [ ] Commission a penetration test, and consider a bug bounty.
