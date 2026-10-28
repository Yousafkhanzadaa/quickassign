#!/usr/bin/env bash
# Runs once, as the Postgres superuser, when the data directory is first created.
# Creates one login role per service so that each service gets least privilege:
#
#   qa_owner    owns schemas, tables and SECURITY DEFINER functions; used only by migrations
#   qa_queue    owns the graphile_worker job-queue schema; used by the worker's queue pool
#   qa_web      the Next.js app; row-level security applies
#   qa_worker   background jobs; row-level security applies
#   qa_gateway  the WhatsApp gateway; can only call app.gw_* functions + its own schema
#   qa_maint    retention purges; BYPASSRLS, but only reachable through app.purge_expired()
set -euo pipefail

for v in QA_OWNER_PASSWORD QA_QUEUE_PASSWORD QA_WEB_PASSWORD QA_WORKER_PASSWORD QA_GATEWAY_PASSWORD; do
  if [ -z "${!v:-}" ]; then
    echo "missing required env var $v" >&2
    exit 1
  fi
done

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_pw="$QA_OWNER_PASSWORD" \
  -v queue_pw="$QA_QUEUE_PASSWORD" \
  -v web_pw="$QA_WEB_PASSWORD" \
  -v worker_pw="$QA_WORKER_PASSWORD" \
  -v gateway_pw="$QA_GATEWAY_PASSWORD" \
  -v dbname="$POSTGRES_DB" <<'EOSQL'
CREATE ROLE qa_owner   LOGIN PASSWORD :'owner_pw';
CREATE ROLE qa_queue   LOGIN PASSWORD :'queue_pw';
CREATE ROLE qa_web     LOGIN PASSWORD :'web_pw';
CREATE ROLE qa_worker  LOGIN PASSWORD :'worker_pw';
CREATE ROLE qa_gateway LOGIN PASSWORD :'gateway_pw';
CREATE ROLE qa_maint   NOLOGIN BYPASSRLS;

-- SECURITY DEFINER functions owned by qa_owner enqueue jobs into the queue schema.
GRANT qa_queue TO qa_owner;
-- qa_owner creates functions owned by qa_maint (purge) during migrations.
GRANT qa_maint TO qa_owner;

REVOKE ALL ON DATABASE :"dbname" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"dbname" TO qa_owner, qa_queue, qa_web, qa_worker, qa_gateway;
GRANT CREATE ON DATABASE :"dbname" TO qa_owner, qa_queue;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO qa_owner, qa_queue, qa_web, qa_worker, qa_gateway;

CREATE EXTENSION IF NOT EXISTS vector;

-- Search paths ("extensions" is where some hosted Postgres services install pgvector).
ALTER ROLE qa_owner   SET search_path = "$user", public, extensions;
ALTER ROLE qa_web     SET search_path = "$user", public, extensions;
ALTER ROLE qa_worker  SET search_path = "$user", public, extensions;
ALTER ROLE qa_gateway SET search_path = "$user", public, extensions;

-- LOCAL DEVELOPMENT ONLY: lets the web app use the simulated payment provider
-- (PAYMENTS_PROVIDER=mock). Never set this on a hosted database; see 0004_billing.sql.
ALTER ROLE qa_web SET app.allow_mock_payments = 'on';

-- Safety nets: stop runaway queries and idle transactions from holding locks.
ALTER ROLE qa_web     SET statement_timeout = '15s';
ALTER ROLE qa_gateway SET statement_timeout = '15s';
ALTER ROLE qa_worker  SET statement_timeout = '60s';
ALTER ROLE qa_web     SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE qa_worker  SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE qa_gateway SET idle_in_transaction_session_timeout = '30s';
EOSQL
