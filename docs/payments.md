# Payments

Students buy prepaid plans of credits. One credit pays for one worked solution. Detection, tracking and reminders are free.

QuickAssign ships with three payment providers, chosen with `PAYMENTS_PROVIDER`:

| Provider | Use it for | How it works |
|---|---|---|
| `disabled` (default) | Running without payments | Students only get the free trial credits (`FREE_SIGNUP_CREDITS`). **Buy** shows "Payments aren't available yet". |
| `mock` | Local development and tests | A simulated JazzCash/Easypaisa checkout that grants the plan without payment. |
| `safepay` | Real payments in Pakistan | [Safepay](https://getsafepay.com)'s hosted checkout: cards, Google Pay, and JazzCash, Easypaisa and bank apps through Raast. |

## The mock provider

`scripts/gen-env.sh` sets `PAYMENTS_PROVIDER=mock`, so the whole purchase flow works locally without a payment account. Because it grants credits for free, it is locked down three ways. It only works when all of these hold:

1. `PAYMENTS_PROVIDER=mock`;
2. `APP_BASE_URL` is `localhost` or `127.0.0.1`;
3. the database setting `app.allow_mock_payments` is on. Only the local setup script (`db/init/00-roles.sh`) turns it on, and only for `qa_web`.

Never set `app.allow_mock_payments` on a production database.

## Safepay

Safepay is a payment gateway licensed by the State Bank of Pakistan. Students pay on Safepay's hosted checkout, so QuickAssign never sees card or wallet details. The checkout offers:

- **Cards** (Visa, Mastercard) and Google Pay.
- **Raast**, Pakistan's instant-payment network. This is how **JazzCash and Easypaisa** users pay: they scan the Raast QR code in their wallet or bank app, or enter their Raast ID (mobile number) and approve the request in the app.
  - Raast appears only when Safepay has enabled the `RAAST` capability on your merchant account. Ask Safepay to enable it for your live account.
  - Safepay's checkout never shows Raast in the sandbox, so sandbox testing uses cards.

### Set it up

1. **Open a merchant account** at [getsafepay.com](https://getsafepay.com) and complete onboarding. Payment gateways review your website, so make sure the landing page shows your prices and that `/privacy`, `/terms` and `/refunds` show your details: set `LEGAL_NAME`, `CONTACT_EMAIL` and `CONTACT_ADDRESS`.
2. **Copy the sandbox keys.** In the Safepay dashboard, copy the API key (it starts with `sec_`) and the secret key.
3. **Configure `.env`:**
   ```bash
   PAYMENTS_PROVIDER=safepay
   SAFEPAY_ENV=sandbox
   SAFEPAY_API_KEY=...
   SAFEPAY_SECRET_KEY=...
   SAFEPAY_WEBHOOK_SECRET=...   # once you have a public HTTPS URL
   ```
   Then run `docker compose up -d`.
4. **Add the webhook** once the site is on a public HTTPS domain. In Safepay, go to **Developers → Endpoints**, add `https://<your-domain>/api/payments/safepay/webhook`, and put its secret in `SAFEPAY_WEBHOOK_SECRET`. Locally there is no webhook. The return page and the reconciliation job complete payments without it.

### Test in the sandbox

- Pay with Safepay's sandbox test Visa `4456 5300 0000 1005` (frictionless 3-D Secure, approved), any future expiry date and any CVC.
- `E2E_SAFEPAY=1 ./scripts/e2e.sh` runs the whole flow in a browser. It refuses to enter a card unless the checkout is on Safepay's sandbox domain.
- Ask Safepay for the card and Raast fees that will apply to your live account.

### Go live

1. Finish Safepay's business verification and get the live keys.
2. Put the live keys straight into the server's environment, with `SAFEPAY_ENV=production`. Don't paste keys into chats or tickets.
3. Register the webhook for your production domain.
4. Ask Safepay to enable Raast.
5. Make one real payment by card and one through Raast, then refund one of them (see [Refunds](#refunds)).

## How a payment completes

The browser is never trusted with anything that decides money.

1. The browser sends only a plan id. `app.start_checkout` copies that plan's price from `app.plans` into a new row in `app.payments`, and QuickAssign creates a Safepay checkout for exactly that amount. Each student can start at most 10 checkouts an hour.
2. After paying, Safepay sends the student back to `/billing/return/<payment id>`. The payment id is in the path because Safepay appends `?tracker=…` to the return URL; QuickAssign ignores that parameter.
3. Credits are added only after Safepay's server-side API confirms the payment. The tracker must be finished, be a payment, belong to your merchant key and to this order id, and match the stored amount and currency exactly.
4. Three paths run that same check, and it is idempotent, so they can race safely:
   - the return page;
   - the signed webhook, which is treated only as a hint to check;
   - a reconciliation job every 5 minutes. It re-checks pending payments up to 7 days old, and payments closed as failed or expired in the last 24 hours.

If the amount doesn't match, the payment is marked failed with `amount_mismatch` and is never fulfilled automatically. Watch for `payment_amount_mismatch` in `app.audit_log`. The full design is in [security-architecture.md §3.10](security-architecture.md#310-payments-and-credits).

## Credits

- New accounts get `FREE_SIGNUP_CREDITS` once. They never expire.
- A plan adds its credits for `period_days` (30 by default). The credits that expire first are used first.
- `app.reserve_credit` takes one credit before a solve, and `app.release_credit` returns it if the solve fails.
- Balances come from `app.credit_grants`. Every change is also recorded in the append-only `app.credit_ledger`.

## Run SQL as the owner

Changing plans and issuing refunds are operator tasks. No application role can do them; they run as `qa_owner`. On the machine that runs QuickAssign:

```bash
docker compose exec postgres psql -U qa_owner -d quickassign
```

## Plans and prices

Plans live in `app.plans`. Migration `0004_billing.sql` creates two:

| id | Name | Price | Credits | Valid for |
|---|---|---|---|---|
| `basic` | Basic | PKR 500 | 10 | 30 days |
| `pro` | Pro | PKR 1,000 | 25 | 30 days |

Prices are stored in paisa (1 PKR = 100 paisa). As `qa_owner`:

```sql
-- Change a price. New checkouts use it; plans already paid for are unaffected.
UPDATE app.plans SET price_paisa = 60000 WHERE id = 'basic';

-- Add a plan.
INSERT INTO app.plans (id, name, price_paisa, solves, period_days, sort_order)
VALUES ('exam_week', 'Exam week', 30000, 5, 7, 3);

-- Retire a plan. It disappears from the plans page.
UPDATE app.plans SET active = false WHERE id = 'pro';
```

The landing page and the **Plans & credits** page read `app.plans`, so they follow these changes by themselves. Two things don't:
- `apps/web/src/lib/plans.ts` has a fallback copy of the plans, shown only when the database can't be reached. Keep it in step.
- The terms (`/terms`) mention 30-day plans, and the refund policy (`/refunds`) a 7-day window. Review them if you change your offer.

## Refunds

1. Refund the payment in the Safepay dashboard first.
2. As `qa_owner`, run:
   ```sql
   SELECT app.refund_payment('<payment id>', 'reason');
   ```
   It marks the payment refunded and removes the plan's unused credits.

Students quote an 8-character reference, shown on their **Plans & credits** page. Find the payment it belongs to with:

```sql
SELECT id FROM app.payments WHERE replace(id::text, '-', '') LIKE lower('<REF>') || '%';
```

## Adding another provider

The providers are wired up in a few places:

- `apps/web/src/lib/billing.ts` chooses the provider.
- `apps/web/src/lib/actions/billing.ts` starts a checkout.
- `packages/core/src/billing/` holds the Safepay client and the shared fulfilment check.
- `apps/web/src/app/api/payments/` receives webhooks.
- `apps/worker/src/tasks/reconcile-payments.ts` re-checks pending payments.

A new provider must follow the same rules:

- prices come only from `app.plans`;
- credits are granted only by `app.fulfill_payment`, after the provider's server-side API confirms the payment;
- nothing from the browser, the return URL or a webhook body is trusted.

`app.plans` currently allows only PKR, so another currency needs a migration. Read [SECURITY.md](../SECURITY.md) before you start.
