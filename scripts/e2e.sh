#!/usr/bin/env bash
# Runs the browser end-to-end test against the running stack (./scripts/start.sh).
# Usage: ./scripts/e2e.sh                # everything except AI solving
#        E2E_SOLVE=1 ./scripts/e2e.sh    # also solves a task with OpenAI (uses 1 credit)
#        E2E_SAFEPAY=1 ./scripts/e2e.sh  # pays on Safepay's sandbox checkout (PAYMENTS_PROVIDER=safepay, sandbox keys)
#
# The test signs up two throwaway accounts on the real sign-up page and deletes both at
# the end through Settings → Delete account.
set -euo pipefail
cd "$(dirname "$0")/.."
WEB=$(docker compose ps -q web)
if [ -z "$WEB" ]; then echo "The stack isn't running. Start it with: ./scripts/start.sh" >&2; exit 1; fi

CID=""
cleanup() { [ -n "$CID" ] && docker rm -f "$CID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

rm -rf tests/e2e/results
# Share the web container's network namespace so the browser sees the real origin.
CID=$(docker create --network "container:$WEB" -e E2E_SOLVE="${E2E_SOLVE:-0}" -e E2E_SAFEPAY="${E2E_SAFEPAY:-0}" -w /e2e \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  sh -c "npm install --silent --no-audit --no-fund >/dev/null 2>&1 && node test.mjs")
docker cp tests/e2e/. "$CID:/e2e/" >/dev/null
status=0
docker start -a "$CID" || status=$?
docker cp "$CID:/e2e/results" tests/e2e/results >/dev/null 2>&1 || true
echo "Screenshots and files: tests/e2e/results/"
exit $status
