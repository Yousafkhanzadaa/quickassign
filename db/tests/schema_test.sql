-- Structural security invariants, read from the catalogue of a migrated database.
-- Catches a new table without row-level security, a SECURITY DEFINER function without a
-- pinned search_path, or an over-privileged role before it ships. Read-only (rolled back).
-- Plain SQL; run it against the local stack with:
--
--   docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d quickassign -f - < db/tests/schema_test.sql
BEGIN;

CREATE FUNCTION pg_temp.check(ok boolean, what text, detail text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF ok IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL: % %', what, coalesce('(' || detail || ')', '');
    END IF;
    RAISE NOTICE 'ok: %', what;
END $$;

-- Every table in "app" is tenant data behind forced RLS, except the public plan catalogue.
SELECT pg_temp.check(count(*) = 0, 'every app table has row-level security enabled and forced', string_agg(c.relname, ', '))
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p') AND c.relname <> 'plans'
  AND NOT (c.relrowsecurity AND c.relforcerowsecurity);

-- SECURITY DEFINER functions must not resolve names through a caller-controlled search_path.
SELECT pg_temp.check(count(*) = 0, 'every SECURITY DEFINER function pins search_path', string_agg(p.oid::regprocedure::text, ', '))
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('app', 'gateway', 'qa_meta', 'qa_auth') AND p.prosecdef
  AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) cfg WHERE cfg LIKE 'search_path=%');

-- Nothing in "public": QuickAssign keeps every table in its own schemas.
SELECT pg_temp.check(count(*) = 0, 'no QuickAssign tables, views or sequences in schema public', string_agg(c.relname, ', '))
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f');

-- Application roles are ordinary: no superuser, no RLS bypass, no role or database creation.
SELECT pg_temp.check(count(*) = 0, 'application roles cannot bypass RLS or escalate', string_agg(rolname, ', '))
FROM pg_roles
WHERE rolname IN ('qa_web', 'qa_worker', 'qa_gateway', 'qa_queue', 'qa_owner')
  AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb);
SELECT pg_temp.check(NOT rolcanlogin AND rolbypassrls, 'qa_maint bypasses RLS but cannot log in') FROM pg_roles WHERE rolname = 'qa_maint';
SELECT pg_temp.check(
    NOT pg_has_role('qa_web', 'qa_maint', 'MEMBER') AND NOT pg_has_role('qa_worker', 'qa_maint', 'MEMBER')
    AND NOT pg_has_role('qa_gateway', 'qa_maint', 'MEMBER'),
    'no application role can act as qa_maint');

-- (has_*_privilege works from any role; information_schema would only show grants that
-- involve the current role.)

-- The gateway reaches tenant data only through app.gw_* functions.
SELECT pg_temp.check(count(*) = 0, 'the gateway role has no table privileges in schema app', string_agg(c.relname, ', '))
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p', 'v', 'm')
  AND (has_any_column_privilege('qa_gateway', c.oid, 'SELECT') OR has_any_column_privilege('qa_gateway', c.oid, 'INSERT')
       OR has_any_column_privilege('qa_gateway', c.oid, 'UPDATE') OR has_table_privilege('qa_gateway', c.oid, 'DELETE')
       OR has_table_privilege('qa_gateway', c.oid, 'TRUNCATE'));

-- Money and security records are append-only for the application.
SELECT pg_temp.check(count(*) = 0, 'the credit ledger, audit log and payments cannot be rewritten by app roles',
    string_agg(format('%s:%s:%s', r.role, p.priv, t.tbl), ', '))
FROM unnest(ARRAY['qa_web', 'qa_worker', 'qa_gateway']) AS r(role)
CROSS JOIN unnest(ARRAY['credit_ledger', 'audit_log', 'payments', 'credit_grants', 'plans']) AS t(tbl)
CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p(priv)
WHERE CASE WHEN p.priv IN ('INSERT', 'UPDATE') THEN has_any_column_privilege(r.role, ('app.' || t.tbl)::regclass, p.priv)
           ELSE has_table_privilege(r.role, ('app.' || t.tbl)::regclass, p.priv) END
  AND NOT (r.role = 'qa_worker' AND t.tbl = 'credit_grants' AND p.priv = 'DELETE')       -- account purge
  AND NOT (t.tbl IN ('credit_ledger', 'audit_log') AND p.priv = 'INSERT');                -- append

-- Nothing is granted to PUBLIC on QuickAssign's tables.
SELECT pg_temp.check(count(*) = 0, 'no table privileges granted to PUBLIC', string_agg(n.nspname || '.' || c.relname, ', '))
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('app', 'gateway', 'qa_meta', 'qa_auth', 'graphile_worker') AND c.relkind IN ('r', 'p', 'v', 'm')
  AND (has_any_column_privilege('public', c.oid, 'SELECT') OR has_any_column_privilege('public', c.oid, 'INSERT')
       OR has_any_column_privilege('public', c.oid, 'UPDATE') OR has_table_privilege('public', c.oid, 'DELETE'));
SELECT pg_temp.check(count(*) = 0, 'no app function is executable by PUBLIC', string_agg(p.oid::regprocedure::text, ', '))
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('app', 'gateway', 'qa_auth') AND has_function_privilege('public', p.oid, 'EXECUTE')
  AND p.proname <> 'current_user_id';

-- Accounts: password hashes and session tokens are reachable only through qa_auth functions.
SELECT pg_temp.check(count(*) = 0, 'no application role has table privileges in schema qa_auth',
    string_agg(r.role || '->' || c.relname, ', '))
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN unnest(ARRAY['qa_web', 'qa_worker', 'qa_gateway', 'qa_queue']) AS r(role)
WHERE n.nspname = 'qa_auth' AND c.relkind IN ('r', 'p', 'v', 'm')
  AND (has_any_column_privilege(r.role, c.oid, 'SELECT') OR has_any_column_privilege(r.role, c.oid, 'INSERT')
       OR has_any_column_privilege(r.role, c.oid, 'UPDATE') OR has_table_privilege(r.role, c.oid, 'DELETE')
       OR has_table_privilege(r.role, c.oid, 'TRUNCATE'));

-- Only the web app signs people in, only the worker deletes accounts, and only the owner
-- resets passwords.
SELECT pg_temp.check(
    has_function_privilege('qa_web', 'qa_auth.session_account(bytea)', 'EXECUTE')
    AND NOT has_function_privilege('qa_worker', 'qa_auth.session_account(bytea)', 'EXECUTE')
    AND NOT has_function_privilege('qa_gateway', 'qa_auth.password_hash(text)', 'EXECUTE')
    AND NOT has_function_privilege('qa_worker', 'qa_auth.password_hash(text)', 'EXECUTE')
    AND has_function_privilege('qa_worker', 'qa_auth.delete_user(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('qa_web', 'qa_auth.delete_user(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('qa_web', 'qa_auth.reset_password(text, text)', 'EXECUTE')
    AND NOT has_function_privilege('qa_worker', 'qa_auth.reset_password(text, text)', 'EXECUTE'),
    'each account function is granted only to the role that needs it');

-- Reached only if every check passed (a failed check aborts the transaction).
SELECT 'schema_test.sql: all checks passed' AS result;
ROLLBACK;
