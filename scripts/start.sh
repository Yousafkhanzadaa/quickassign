#!/usr/bin/env bash
# Starts QuickAssign on this computer: creates .env on the first run, builds and starts
# every service with Docker Compose, waits for the website, and prints its address.
#
# Usage: ./scripts/start.sh            Stop with: docker compose down
set -euo pipefail
cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker isn't running. Start Docker Desktop, then run this again." >&2
  exit 1
fi
[ -e .env ] || ./scripts/gen-env.sh

# Port 3000 must be free for the web container (a stray `npm run dev` is the usual culprit).
if [ -z "$(docker compose ps --status running -q web 2>/dev/null)" ] && curl -s -o /dev/null --max-time 2 http://127.0.0.1:3000/; then
  echo "Something else is already using port 3000, for example \`npm run dev\`. Stop it, then run this again." >&2
  exit 1
fi

docker compose up -d --build

url=$(grep -E '^APP_BASE_URL=' .env | tail -n 1 | cut -d= -f2-)
printf 'Waiting for the website '
for _ in $(seq 1 90); do
  if curl -fs -o /dev/null --max-time 5 http://127.0.0.1:3000/; then
    printf '\n\nQuickAssign is running at %s\n' "${url:-http://localhost:3000}"
    grep -qE '^OPENAI_API_KEY=.+' .env || echo "Tip: add OPENAI_API_KEY to .env and run this again to turn on detection and solving."
    echo "Logs: docker compose logs -f    Stop: docker compose down"
    exit 0
  fi
  printf '.'
  sleep 2
done
printf '\n'
echo "The website didn't come up. See: docker compose ps, then docker compose logs migrate web" >&2
exit 1
