-- Billing and credit invariants (db/migrations/0004_billing.sql), checked against a
-- migrated database through the real application roles. Run as a superuser; every
-- check raises on failure, and the whole run is rolled back:
--
--   docker compose exec -T postgres psql -U postgres -d quickassign -f - < db/tests/billing_test.sql
\set ON_ERROR_STOP on
\set QUIET on
BEGIN;

CREATE SCHEMA qa_test;
GRANT USAGE ON SCHEMA qa_test TO PUBLIC;
CREATE FUNCTION qa_test.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF ok IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL: %', what;
    END IF;
    RAISE NOTICE 'ok: %', what;
END $$;
-- Runs stmt as the current role and requires it to fail with a message containing expected.
CREATE FUNCTION qa_test.fails(stmt text, expected text, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE stmt;
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT ILIKE '%' || expected || '%' THEN
            RAISE EXCEPTION 'FAIL: % (got "%", expected "%")', what, SQLERRM, expected;
        END IF;
        RAISE NOTICE 'ok: %', what;
        RETURN;
    END;
    RAISE EXCEPTION 'FAIL: % (statement succeeded)', what;
END $$;
CREATE FUNCTION qa_test.as_tenant(t text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('app.user_id', t, true) $$;

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
SET ROLE qa_web;
SELECT qa_test.check(
    (SELECT string_agg(format('%s:%s:%s:%s', id, price_paisa, solves, period_days), ',' ORDER BY sort_order) FROM app.plans)
        = 'basic:50000:10:30,pro:100000:25:30',
    'plans are Basic PKR 500 / 10 solves and Pro PKR 1,000 / 25 solves, 30 days each');
SELECT qa_test.check((SELECT count(*) FROM app.payments) = 0, 'without tenant context the web role sees no payments');
SELECT qa_test.check(app.credit_balance() = 0, 'without tenant context the balance is 0');

-- ---------------------------------------------------------------------------
-- Student A: trial credits and direct-write refusals (web role)
-- ---------------------------------------------------------------------------
SELECT qa_test.as_tenant('tenantAAAAAAAA');
SELECT app.grant_signup_credits(5);
SELECT app.grant_signup_credits(5);
SELECT qa_test.check(app.credit_balance() = 5, 'free trial credits are granted once');

SELECT qa_test.fails($$INSERT INTO app.credit_grants (user_id, source, quantity) VALUES ('tenantAAAAAAAA', 'admin', 100)$$,
    'permission denied', 'web cannot insert credit grants');
SELECT qa_test.fails($$UPDATE app.credit_grants SET used = 0$$, 'permission denied', 'web cannot reset used credits');
SELECT qa_test.fails($$INSERT INTO app.payments (user_id, plan_id, amount_paisa, provider) VALUES ('tenantAAAAAAAA', 'basic', 1, 'safepay')$$,
    'permission denied', 'web cannot insert payments');
SELECT qa_test.fails($$UPDATE app.payments SET status = 'paid'$$, 'permission denied', 'web cannot mark payments paid');
SELECT qa_test.fails($$UPDATE app.plans SET price_paisa = 1$$, 'permission denied', 'web cannot change prices');
SELECT qa_test.fails($$SELECT app.refund_payment(gen_random_uuid(), 'x')$$, 'permission denied', 'web cannot refund');
SELECT qa_test.fails($$SELECT app.reserve_credit(gen_random_uuid())$$, 'permission denied', 'web cannot reserve credits');

-- ---------------------------------------------------------------------------
-- Checkout
-- ---------------------------------------------------------------------------
SELECT payment_id AS pay1, amount_paisa AS amt1 FROM app.start_checkout('basic', 'safepay') \gset
SELECT qa_test.check(:amt1 = 50000, 'Basic checkout charges 50000 paisa, taken from app.plans');
SELECT amount_paisa AS amt_pro FROM app.start_checkout('pro', 'safepay') \gset
SELECT qa_test.check(:amt_pro = 100000, 'Pro checkout charges 100000 paisa');
SELECT qa_test.fails($$SELECT app.start_checkout('platinum', 'safepay')$$, 'unknown plan', 'unknown plans are refused');
SELECT qa_test.fails($$SELECT app.start_checkout('basic', 'paypal')$$, 'unknown payment provider', 'unknown providers are refused');
SELECT qa_test.fails($$SELECT app.start_checkout('basic', 'mock')$$, 'mock payments are disabled',
    'mock checkout is refused unless the database allows it');

-- Student B cannot see or take over A's checkout.
SELECT qa_test.as_tenant('tenantBBBBBBBB');
SELECT qa_test.check((SELECT count(*) FROM app.payments) = 0, 'student B sees none of A''s payments');
SELECT qa_test.fails(format('SELECT app.attach_payment_ref(%L::uuid, %L)', :'pay1', 'track_evil0000001'),
    'payment not found', 'student B cannot attach a reference to A''s checkout');

SELECT qa_test.as_tenant('tenantAAAAAAAA');
SELECT app.attach_payment_ref(:'pay1'::uuid, 'track_test0000001');
SELECT qa_test.fails(format('SELECT app.attach_payment_ref(%L::uuid, %L)', :'pay1', 'track_test0000009'),
    'already started', 'a checkout reference cannot be replaced');

-- ---------------------------------------------------------------------------
-- Fulfilment
-- ---------------------------------------------------------------------------
SELECT qa_test.fails(format('SELECT app.fulfill_payment(%L::uuid, %L, 50000, %L)', :'pay1', 'track_wrong000001', 'PKR'),
    'reference mismatch', 'fulfilment requires the payment''s own provider reference');
SELECT qa_test.check(NOT app.fulfill_payment(:'pay1'::uuid, 'track_test0000001', 100, 'PKR'), 'an underpayment is not fulfilled');
SELECT qa_test.check(
    (SELECT status::text || '/' || failure_reason FROM app.payments WHERE id = :'pay1') = 'failed/amount_mismatch',
    'an underpayment marks the payment failed (amount_mismatch)');
SELECT qa_test.check(NOT app.fulfill_payment(:'pay1'::uuid, 'track_test0000001', 50000, 'PKR'),
    'an amount mismatch is never fulfilled later');
SELECT qa_test.check(NOT app.fulfill_payment(:'pay1'::uuid, 'track_test0000001', 50000, 'USD') , 'wrong currency is never fulfilled');
SELECT qa_test.check(app.credit_balance() = 5, 'no credits from a mismatched payment');

SELECT payment_id AS pay2 FROM app.start_checkout('basic', 'safepay') \gset
SELECT app.attach_payment_ref(:'pay2'::uuid, 'track_test0000002');
SELECT app.close_payment(:'pay2'::uuid, 'failed', 'cancelled');
SELECT qa_test.check(app.fulfill_payment(:'pay2'::uuid, 'track_test0000002', 50000, 'PKR'),
    'a checkout closed as failed is still fulfilled when the provider confirms payment');
SELECT qa_test.check(app.credit_balance() = 15, 'Basic adds 10 credits');
SELECT qa_test.check(NOT app.fulfill_payment(:'pay2'::uuid, 'track_test0000002', 50000, 'PKR'), 'fulfilling twice is a no-op');
SELECT qa_test.check(app.credit_balance() = 15, 'credits are granted only once per payment');
SELECT qa_test.check(
    (SELECT expires_at BETWEEN now() + interval '29 days 23 hours' AND now() + interval '30 days 1 hour'
     FROM app.credit_grants WHERE payment_id = :'pay2'),
    'plan credits expire after 30 days');

-- ---------------------------------------------------------------------------
-- Spending credits (worker role)
-- ---------------------------------------------------------------------------
SELECT gen_random_uuid() AS task1 \gset
SELECT app.create_manual_task(:'task1'::uuid, 'Billing test task', NULL, NULL, '\x00'::bytea);
RESET ROLE;
SET ROLE qa_worker;
SELECT qa_test.as_tenant('tenantAAAAAAAA');
SELECT app.reserve_credit(:'task1'::uuid) AS grant1 \gset
SELECT qa_test.check((SELECT source FROM app.credit_grants WHERE id = :'grant1'::uuid) = 'plan',
    'the credits that expire first (the plan''s) are spent before trial credits');
SELECT qa_test.check(app.credit_balance() = 14, 'reserving a solve takes one credit');
SELECT app.release_credit(:'task1'::uuid);
SELECT qa_test.check(app.credit_balance() = 15, 'a failed solve gets its credit back');
SELECT app.release_credit(:'task1'::uuid);
SELECT qa_test.check(app.credit_balance() = 15, 'releasing twice returns only one credit');
SELECT qa_test.as_tenant('tenantBBBBBBBB');
SELECT qa_test.fails(format('SELECT app.reserve_credit(%L::uuid)', :'task1'), 'task not found',
    'student B cannot spend credits on A''s task');

-- Reconciliation picks pending and recently closed payments, never amount mismatches.
RESET ROLE;
SET ROLE qa_web;
SELECT qa_test.as_tenant('tenantAAAAAAAA');
SELECT payment_id AS pay4 FROM app.start_checkout('pro', 'safepay') \gset
SELECT app.attach_payment_ref(:'pay4'::uuid, 'track_test0000004');
SELECT payment_id AS pay5 FROM app.start_checkout('pro', 'safepay') \gset
SELECT app.attach_payment_ref(:'pay5'::uuid, 'track_test0000005');
SELECT app.close_payment(:'pay5'::uuid, 'failed', 'cancelled');
RESET ROLE;
SET ROLE qa_worker;
SELECT qa_test.check(:'pay4'::uuid IN (SELECT payment_id FROM app.open_payments(100)), 'reconciliation re-checks pending payments');
SELECT qa_test.check(:'pay5'::uuid IN (SELECT payment_id FROM app.open_payments(100)), 'reconciliation re-checks recently failed payments');
SELECT qa_test.check(:'pay1'::uuid NOT IN (SELECT payment_id FROM app.open_payments(100)), 'reconciliation skips amount mismatches');
SELECT qa_test.check(:'pay2'::uuid NOT IN (SELECT payment_id FROM app.open_payments(100)), 'reconciliation skips paid payments');

-- ---------------------------------------------------------------------------
-- Mock provider: only where the database allows it
-- ---------------------------------------------------------------------------
RESET ROLE;
SET ROLE qa_web;
SELECT qa_test.as_tenant('tenantAAAAAAAA');
SET LOCAL app.allow_mock_payments = 'on';
SELECT payment_id AS pay3 FROM app.start_checkout('pro', 'mock') \gset
SELECT app.attach_payment_ref(:'pay3'::uuid, 'mock_test');
SET LOCAL app.allow_mock_payments = 'off';
SELECT qa_test.fails(format('SELECT app.fulfill_payment(%L::uuid, %L, 100000, %L)', :'pay3', 'mock_test', 'PKR'),
    'mock payments are disabled', 'a mock payment cannot be fulfilled where mock payments are disabled');
SET LOCAL app.allow_mock_payments = 'on';
SELECT qa_test.check(app.fulfill_payment(:'pay3'::uuid, 'mock_test', 100000, 'PKR'), 'a mock payment works where allowed');
SELECT qa_test.check(app.credit_balance() = 40, 'Pro adds 25 credits');

-- ---------------------------------------------------------------------------
-- Refunds (operator tool)
-- ---------------------------------------------------------------------------
RESET ROLE;
SET ROLE qa_owner;
SELECT app.refund_payment(:'pay2'::uuid, 'billing test') AS removed \gset
SELECT qa_test.check(:removed = 10, 'a refund removes the plan''s unused credits');
SELECT qa_test.fails(format('SELECT app.refund_payment(%L::uuid, %L)', :'pay2', 'again'), 'only paid payments',
    'a payment cannot be refunded twice');
SELECT qa_test.fails(format('SELECT app.fulfill_payment(%L::uuid, %L, 50000, %L)', :'pay2', 'track_test0000002', 'PKR'),
    'not payable', 'a refunded payment cannot be fulfilled again');
RESET ROLE;
SET ROLE qa_web;
SELECT qa_test.as_tenant('tenantAAAAAAAA');
SELECT qa_test.check(app.credit_balance() = 30, 'the refunded plan no longer counts towards the balance');
SELECT qa_test.check((SELECT status::text FROM app.payments WHERE id = :'pay2') = 'refunded', 'the payment shows as refunded');

-- ---------------------------------------------------------------------------
-- Retention: abandoned checkouts are closed
-- ---------------------------------------------------------------------------
SELECT payment_id AS pay6 FROM app.start_checkout('basic', 'safepay') \gset
RESET ROLE;
UPDATE app.payments SET expires_at = now() - interval '1 minute' WHERE id = :'pay6';
UPDATE app.payments SET created_at = now() - interval '8 days' WHERE id = :'pay4';
SET ROLE qa_worker;
SELECT app.purge_expired();
RESET ROLE;
SELECT qa_test.check((SELECT status::text FROM app.payments WHERE id = :'pay6') = 'expired', 'a checkout never started expires after 3 hours');
SELECT qa_test.check((SELECT status::text FROM app.payments WHERE id = :'pay4') = 'expired', 'a checkout pending for 7 days expires');

ROLLBACK;
\echo 'billing_test.sql: all checks passed'
