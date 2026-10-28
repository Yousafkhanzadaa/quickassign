-- Billing: prepaid 30-day plans paid with JazzCash, Easypaisa or cards through Safepay.
--
-- Money rules (see docs/security-architecture.md §3.10):
--   * Prices exist only in app.plans. app.start_checkout copies the amount from there;
--     no client-supplied amount is ever used.
--   * A payment is fulfilled only by app.fulfill_payment, which the application calls
--     after confirming the payment with the provider's server-side API. Fulfilment is
--     idempotent: a unique constraint allows one credit grant per payment.
--   * Credits are reserved before a solve (app.reserve_credit) from the grant that
--     expires first, and returned if the solve fails (app.release_credit).
--   * Payments and the ledger are financial records: kept after account deletion
--     (pseudonymous user id only).
--   * The "mock" provider (local testing) only works where the database itself allows
--     it: the setting app.allow_mock_payments = 'on' is applied to qa_web by the local
--     bootstrap (db/init/00-roles.sh) and never on a hosted database. A web server
--     misconfigured with PAYMENTS_PROVIDER=mock therefore can't mint credits in production.

CREATE TABLE app.plans (
    id          text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]{1,30}$'),
    name        text NOT NULL,
    price_paisa integer NOT NULL CHECK (price_paisa > 0),
    currency    text NOT NULL DEFAULT 'PKR' CHECK (currency = 'PKR'),
    solves      integer NOT NULL CHECK (solves > 0),
    period_days integer NOT NULL DEFAULT 30 CHECK (period_days BETWEEN 1 AND 366),
    active      boolean NOT NULL DEFAULT true,
    sort_order  integer NOT NULL DEFAULT 0
);

INSERT INTO app.plans (id, name, price_paisa, solves, period_days, sort_order) VALUES
    ('basic', 'Basic',  50000, 10, 30, 1),   -- PKR 500 / 30 days / 10 assignments
    ('pro',   'Pro',   100000, 25, 30, 2);   -- PKR 1,000 / 30 days / 25 assignments

CREATE TYPE app.payment_status AS ENUM ('created', 'pending', 'paid', 'failed', 'expired', 'refunded');

CREATE TABLE app.payments (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        text NOT NULL,
    plan_id        text NOT NULL REFERENCES app.plans (id),
    amount_paisa   integer NOT NULL CHECK (amount_paisa > 0),
    currency       text NOT NULL DEFAULT 'PKR',
    provider       text NOT NULL CHECK (provider IN ('safepay', 'mock')),
    provider_ref   text UNIQUE CHECK (length(provider_ref) <= 128),
    status         app.payment_status NOT NULL DEFAULT 'created',
    failure_reason text CHECK (length(failure_reason) <= 200),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    paid_at        timestamptz,
    expires_at     timestamptz NOT NULL DEFAULT now() + interval '3 hours'
);
CREATE INDEX payments_user_idx ON app.payments (user_id, created_at DESC);
CREATE INDEX payments_open_idx ON app.payments (created_at) WHERE status IN ('created', 'pending', 'failed', 'expired');

CREATE TABLE app.credit_grants (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    text NOT NULL,
    source     text NOT NULL CHECK (source IN ('signup', 'plan', 'admin')),
    plan_id    text REFERENCES app.plans (id),
    payment_id uuid UNIQUE REFERENCES app.payments (id),
    quantity   integer NOT NULL CHECK (quantity > 0),
    used       integer NOT NULL DEFAULT 0 CHECK (used >= 0 AND used <= quantity),
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_grants_user_idx ON app.credit_grants (user_id, expires_at);
-- Free trial credits can be granted only once per student.
CREATE UNIQUE INDEX credit_grants_signup_once ON app.credit_grants (user_id) WHERE source = 'signup';

ALTER TABLE app.tasks ADD COLUMN credit_grant_id uuid REFERENCES app.credit_grants (id) ON DELETE SET NULL;

ALTER TABLE app.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.payments
    USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
-- Webhooks and reconciliation identify a payment by the provider reference before the
-- tenant is known; only the billing functions below (owned by qa_owner) may do that.
CREATE POLICY billing_functions ON app.payments TO qa_owner USING (true) WITH CHECK (true);

ALTER TABLE app.credit_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.credit_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.credit_grants
    USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());

-- ---------------------------------------------------------------------------
-- Checkout (web)
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.start_checkout(p_plan_id text, p_provider text)
RETURNS TABLE (payment_id uuid, amount_paisa integer, currency text, plan_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user   text := app.current_user_id();
    v_plan   app.plans%ROWTYPE;
    v_recent integer;
    v_id     uuid;
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'tenant context missing';
    END IF;
    IF p_provider NOT IN ('safepay', 'mock') THEN
        RAISE EXCEPTION 'unknown payment provider';
    END IF;
    IF p_provider = 'mock' AND coalesce(current_setting('app.allow_mock_payments', true), '') <> 'on' THEN
        RAISE EXCEPTION 'mock payments are disabled on this database';
    END IF;
    SELECT * INTO v_plan FROM app.plans p WHERE p.id = p_plan_id AND p.active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unknown plan';
    END IF;
    SELECT count(*) INTO v_recent FROM app.payments p
    WHERE p.user_id = v_user AND p.created_at > now() - interval '1 hour';
    IF v_recent >= 10 THEN
        RAISE EXCEPTION 'too many checkout attempts; try again later';
    END IF;
    INSERT INTO app.payments (user_id, plan_id, amount_paisa, currency, provider)
    VALUES (v_user, v_plan.id, v_plan.price_paisa, v_plan.currency, p_provider)
    RETURNING id INTO v_id;
    INSERT INTO app.audit_log (user_id, actor, action, details)
    VALUES (v_user, 'user', 'checkout_started', jsonb_build_object('plan', v_plan.id, 'provider', p_provider));
    RETURN QUERY SELECT v_id, v_plan.price_paisa, v_plan.currency, v_plan.name;
END $$;

-- Records the provider's reference (Safepay tracker) for a checkout the caller owns.
CREATE FUNCTION app.attach_payment_ref(p_payment_id uuid, p_ref text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user text := app.current_user_id();
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'tenant context missing';
    END IF;
    UPDATE app.payments SET provider_ref = p_ref, status = 'pending', updated_at = now()
    WHERE id = p_payment_id AND user_id = v_user AND status = 'created' AND provider_ref IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'payment not found or already started';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Verification and fulfilment (web return page, webhook, worker reconciliation)
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.payment_by_ref(p_ref text)
RETURNS TABLE (payment_id uuid, user_id text, plan_id text, amount_paisa integer, currency text,
               status app.payment_status, provider text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
    SELECT p.id, p.user_id, p.plan_id, p.amount_paisa, p.currency, p.status, p.provider
    FROM app.payments p WHERE p.provider_ref = p_ref
$$;

CREATE FUNCTION app.open_payments(p_limit integer)
RETURNS TABLE (payment_id uuid, provider_ref text, provider text, created_at timestamptz, expires_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
    -- Pending payments, plus failed/expired ones closed in the last day: the student may have
    -- retried on the same checkout and paid after all. Amount mismatches are never retried.
    SELECT p.id, p.provider_ref, p.provider, p.created_at, p.expires_at
    FROM app.payments p
    WHERE p.provider_ref IS NOT NULL
      AND p.created_at > now() - interval '7 days'
      AND (p.status = 'pending'
           OR (p.status IN ('failed', 'expired')
               AND p.failure_reason IS DISTINCT FROM 'amount_mismatch'
               AND p.updated_at > now() - interval '24 hours'))
    ORDER BY p.created_at
    LIMIT least(greatest(p_limit, 1), 500)
$$;

-- Call ONLY after confirming the payment with the provider's server-side API.
-- Returns true when this call fulfilled the payment, false when it was already paid
-- or the amount did not match (which marks it failed).
CREATE FUNCTION app.fulfill_payment(p_payment_id uuid, p_provider_ref text, p_amount_paisa integer, p_currency text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_pay  app.payments%ROWTYPE;
    v_plan app.plans%ROWTYPE;
BEGIN
    SELECT * INTO v_pay FROM app.payments WHERE id = p_payment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'payment not found';
    END IF;
    -- Scope the rest of this transaction to the payment's owner (RLS on grants, ledger,
    -- audit). Callers invoke this as the last statement of their transaction.
    PERFORM set_config('app.user_id', v_pay.user_id, true);
    IF v_pay.status = 'paid' THEN
        RETURN false;
    END IF;
    IF v_pay.provider = 'mock' AND coalesce(current_setting('app.allow_mock_payments', true), '') <> 'on' THEN
        RAISE EXCEPTION 'mock payments are disabled on this database';
    END IF;
    IF v_pay.provider_ref IS DISTINCT FROM p_provider_ref THEN
        RAISE EXCEPTION 'payment reference mismatch';
    END IF;
    -- A wrong amount needs a human: it is never fulfilled automatically, even on a later check.
    IF v_pay.status = 'failed' AND v_pay.failure_reason = 'amount_mismatch' THEN
        RETURN false;
    END IF;
    -- failed/expired are accepted: the provider has just confirmed the money arrived.
    IF v_pay.status NOT IN ('created', 'pending', 'expired', 'failed') THEN
        RAISE EXCEPTION 'payment is not payable (status %)', v_pay.status;
    END IF;
    IF p_amount_paisa IS DISTINCT FROM v_pay.amount_paisa OR p_currency IS DISTINCT FROM v_pay.currency THEN
        UPDATE app.payments SET status = 'failed', failure_reason = 'amount_mismatch', updated_at = now()
        WHERE id = v_pay.id;
        INSERT INTO app.audit_log (user_id, actor, action, details)
        VALUES (v_pay.user_id, 'system', 'payment_amount_mismatch',
                jsonb_build_object('expected', v_pay.amount_paisa, 'received', p_amount_paisa));
        RETURN false;
    END IF;

    SELECT * INTO v_plan FROM app.plans WHERE id = v_pay.plan_id;
    UPDATE app.payments SET status = 'paid', paid_at = now(), failure_reason = NULL, updated_at = now()
    WHERE id = v_pay.id;
    INSERT INTO app.credit_grants (user_id, source, plan_id, payment_id, quantity, expires_at)
    VALUES (v_pay.user_id, 'plan', v_plan.id, v_pay.id, v_plan.solves, now() + make_interval(days => v_plan.period_days))
    ON CONFLICT (payment_id) DO NOTHING;
    INSERT INTO app.credit_ledger (user_id, delta, reason, ref)
    VALUES (v_pay.user_id, v_plan.solves, 'plan', v_pay.id::text)
    ON CONFLICT (user_id, reason, ref) DO NOTHING;
    INSERT INTO app.audit_log (user_id, actor, action, details)
    VALUES (v_pay.user_id, 'system', 'payment_fulfilled',
            jsonb_build_object('plan', v_plan.id, 'amount_paisa', v_pay.amount_paisa, 'provider', v_pay.provider));
    RETURN true;
END $$;

-- Closes a payment the provider reports as failed/cancelled/expired.
CREATE FUNCTION app.close_payment(p_payment_id uuid, p_status app.payment_status, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF p_status NOT IN ('failed', 'expired') THEN
        RAISE EXCEPTION 'invalid closing status';
    END IF;
    UPDATE app.payments SET status = p_status, failure_reason = left(p_reason, 200), updated_at = now()
    WHERE id = p_payment_id AND status IN ('created', 'pending');
END $$;

-- Operator tool, run as qa_owner after refunding the payment in the Safepay dashboard:
--   select app.refund_payment('<payment id>', 'reason');
-- Marks the payment refunded and removes the plan's unused credits (used ones stay used).
-- Returns the number of credits removed. No application role can call it.
CREATE FUNCTION app.refund_payment(p_payment_id uuid, p_reason text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_pay   app.payments%ROWTYPE;
    v_grant app.credit_grants%ROWTYPE;
    v_left  integer := 0;
BEGIN
    SELECT * INTO v_pay FROM app.payments WHERE id = p_payment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'payment not found';
    END IF;
    IF v_pay.status <> 'paid' THEN
        RAISE EXCEPTION 'only paid payments can be refunded (status %)', v_pay.status;
    END IF;
    PERFORM set_config('app.user_id', v_pay.user_id, true);
    SELECT * INTO v_grant FROM app.credit_grants WHERE payment_id = v_pay.id FOR UPDATE;
    IF FOUND THEN
        v_left := greatest(v_grant.quantity - v_grant.used, 0);
        UPDATE app.credit_grants SET expires_at = now() WHERE id = v_grant.id;
        IF v_left > 0 THEN
            INSERT INTO app.credit_ledger (user_id, delta, reason, ref)
            VALUES (v_pay.user_id, -v_left, 'plan_refund', v_pay.id::text)
            ON CONFLICT (user_id, reason, ref) DO NOTHING;
        END IF;
    END IF;
    UPDATE app.payments SET status = 'refunded', failure_reason = left(p_reason, 200), updated_at = now()
    WHERE id = v_pay.id;
    INSERT INTO app.audit_log (user_id, actor, action, details)
    VALUES (v_pay.user_id, 'admin', 'payment_refunded', jsonb_build_object('credits_removed', v_left));
    RETURN v_left;
END $$;

-- ---------------------------------------------------------------------------
-- Credits
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.credit_balance()
RETURNS integer
LANGUAGE sql STABLE
AS $$
    SELECT coalesce(sum(quantity - used), 0)::integer
    FROM app.credit_grants
    WHERE user_id = app.current_user_id() AND (expires_at IS NULL OR expires_at > now())
$$;

-- Reserves one credit for a solve; NULL when the student has none left.
CREATE FUNCTION app.reserve_credit(p_task_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user  text := app.current_user_id();
    v_grant uuid;
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'tenant context missing';
    END IF;
    PERFORM 1 FROM app.tasks WHERE id = p_task_id AND user_id = v_user;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'task not found';
    END IF;
    SELECT g.id INTO v_grant FROM app.credit_grants g
    WHERE g.user_id = v_user AND g.used < g.quantity AND (g.expires_at IS NULL OR g.expires_at > now())
    ORDER BY g.expires_at NULLS LAST, g.created_at
    LIMIT 1
    FOR UPDATE;
    IF v_grant IS NULL THEN
        RETURN NULL;
    END IF;
    UPDATE app.credit_grants SET used = used + 1 WHERE id = v_grant;
    UPDATE app.tasks SET credit_grant_id = v_grant WHERE id = p_task_id;
    INSERT INTO app.credit_ledger (user_id, delta, reason, ref)
    VALUES (v_user, -1, 'solve', p_task_id::text || ':' || gen_random_uuid()::text);
    RETURN v_grant;
END $$;

-- Returns the credit reserved for a task whose solve failed.
CREATE FUNCTION app.release_credit(p_task_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user  text := app.current_user_id();
    v_grant uuid;
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'tenant context missing';
    END IF;
    SELECT credit_grant_id INTO v_grant FROM app.tasks WHERE id = p_task_id AND user_id = v_user FOR UPDATE;
    IF v_grant IS NULL THEN
        RETURN;
    END IF;
    UPDATE app.credit_grants SET used = used - 1 WHERE id = v_grant AND used > 0;
    UPDATE app.tasks SET credit_grant_id = NULL WHERE id = p_task_id;
    INSERT INTO app.credit_ledger (user_id, delta, reason, ref)
    VALUES (v_user, 1, 'refund', p_task_id::text || ':' || gen_random_uuid()::text);
END $$;

-- Free trial credits now go into a grant (once per student, never expire).
CREATE OR REPLACE FUNCTION app.grant_signup_credits(p_amount integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user text := app.current_user_id();
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'tenant context missing';
    END IF;
    IF p_amount < 0 OR p_amount > 20 THEN
        RAISE EXCEPTION 'invalid signup credit amount';
    END IF;
    IF p_amount = 0 THEN
        RETURN;
    END IF;
    INSERT INTO app.credit_grants (user_id, source, quantity)
    VALUES (v_user, 'signup', p_amount)
    ON CONFLICT (user_id) WHERE source = 'signup' DO NOTHING;
    IF FOUND THEN
        INSERT INTO app.credit_ledger (user_id, delta, reason, ref)
        VALUES (v_user, p_amount, 'signup', 'signup')
        ON CONFLICT (user_id, reason, ref) DO NOTHING;
    END IF;
END $$;

-- Retention purge also expires abandoned checkouts (never started with the provider).
CREATE OR REPLACE FUNCTION app.purge_expired()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    n_msgs     integer;
    n_blobs    integer;
    n_cmds     integer;
    n_checkout integer;
BEGIN
    DELETE FROM app.inbound_messages WHERE created_at < now() - interval '30 days';
    GET DIAGNOSTICS n_msgs = ROW_COUNT;
    DELETE FROM app.blobs WHERE expires_at IS NOT NULL AND expires_at < now();
    GET DIAGNOSTICS n_blobs = ROW_COUNT;
    DELETE FROM app.self_commands WHERE created_at < now() - interval '7 days';
    GET DIAGNOSTICS n_cmds = ROW_COUNT;
    UPDATE app.payments SET status = 'expired', updated_at = now()
    WHERE (status = 'created' AND expires_at < now())
       OR (status = 'pending' AND created_at < now() - interval '7 days');
    GET DIAGNOSTICS n_checkout = ROW_COUNT;
    RETURN jsonb_build_object('messages', n_msgs, 'blobs', n_blobs, 'commands', n_cmds, 'checkouts', n_checkout);
END $$;
ALTER FUNCTION app.purge_expired() OWNER TO qa_maint;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION app.start_checkout(text, text), app.attach_payment_ref(uuid, text),
    app.payment_by_ref(text), app.open_payments(integer), app.fulfill_payment(uuid, text, integer, text),
    app.close_payment(uuid, app.payment_status, text), app.refund_payment(uuid, text), app.credit_balance(),
    app.reserve_credit(uuid), app.release_credit(uuid) FROM PUBLIC;

GRANT SELECT ON app.plans TO qa_web, qa_worker;
GRANT SELECT ON app.payments, app.credit_grants TO qa_web;
GRANT SELECT ON app.payments TO qa_worker;
GRANT SELECT, DELETE ON app.credit_grants TO qa_worker;      -- account purge
GRANT UPDATE (credit_grant_id) ON app.tasks TO qa_worker;
GRANT SELECT, UPDATE ON app.payments TO qa_maint;             -- checkout expiry in purge (WHERE needs SELECT)

GRANT EXECUTE ON FUNCTION app.start_checkout(text, text), app.attach_payment_ref(uuid, text),
    app.payment_by_ref(text), app.fulfill_payment(uuid, text, integer, text),
    app.close_payment(uuid, app.payment_status, text), app.credit_balance() TO qa_web;
GRANT EXECUTE ON FUNCTION app.open_payments(integer), app.payment_by_ref(text),
    app.fulfill_payment(uuid, text, integer, text), app.close_payment(uuid, app.payment_status, text),
    app.credit_balance(), app.reserve_credit(uuid), app.release_credit(uuid) TO qa_worker;
