#!/usr/bin/env bash
# Generates a .env with strong random secrets for local development.
# Production: put these in a secret manager / KMS instead of a file.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -e .env ]; then
  echo ".env already exists; refusing to overwrite (delete it first if you really mean it)." >&2
  exit 1
fi
rand_hex() { openssl rand -hex "$1"; }
rand_b64() { openssl rand -base64 32 | tr -d '\n'; }
umask 177
cat > .env <<ENV
# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) by scripts/gen-env.sh. Never commit this file.

# --- Postgres (one login role per service) ---
POSTGRES_PASSWORD=$(rand_hex 24)
QA_OWNER_PASSWORD=$(rand_hex 24)
QA_QUEUE_PASSWORD=$(rand_hex 24)
QA_WEB_PASSWORD=$(rand_hex 24)
QA_WORKER_PASSWORD=$(rand_hex 24)
QA_GATEWAY_PASSWORD=$(rand_hex 24)

# --- Encryption keys (32 bytes, base64). Losing these makes stored data unreadable. ---
# GATEWAY_KEK wraps WhatsApp session keys and is given ONLY to the gateway.
GATEWAY_KEK=$(rand_b64)
GATEWAY_KEK_ID=gw-local-v1
# APP_KEK wraps per-student content keys (messages, files, solutions).
APP_KEK=$(rand_b64)
APP_KEK_ID=app-local-v1

# --- Service-to-service authentication ---
GATEWAY_SECRET_WEB=$(rand_hex 32)
GATEWAY_SECRET_WORKER=$(rand_hex 32)
SANDBOX_TOKEN=$(rand_hex 32)

# --- App ---
APP_BASE_URL=http://localhost:3000
FREE_SIGNUP_CREDITS=5

# --- Payments ---
# "mock" simulates JazzCash/Easypaisa checkout for local testing only (refused on any
# non-localhost URL and on any database not set up by db/init/00-roles.sh).
# For real payments: PAYMENTS_PROVIDER=safepay plus the Safepay keys.
PAYMENTS_PROVIDER=mock
SAFEPAY_ENV=sandbox
SAFEPAY_API_KEY=
SAFEPAY_SECRET_KEY=
SAFEPAY_WEBHOOK_SECRET=

# --- Public site details (footer and legal pages) ---
LEGAL_NAME=QuickAssign
CONTACT_EMAIL=
CONTACT_ADDRESS=
REPO_URL=

# --- OpenAI (required for detection and solving) ---
OPENAI_API_KEY=
OPENAI_DETECT_MODEL=gpt-6-luna
OPENAI_SOLVE_MODEL=gpt-6.1-sol
OPENAI_SOLVE_EFFORT=high
ENV
echo "Wrote .env (mode 600). Add your OPENAI_API_KEY to enable AI features."
