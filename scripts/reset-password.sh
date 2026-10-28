#!/usr/bin/env bash
# Sets a new password for an account whose owner forgot theirs, and signs it out on every
# device. Run it on the machine that runs QuickAssign, while the stack is up.
#
# Usage: ./scripts/reset-password.sh student@example.com
#
# The password is typed without echo and hashed inside the worker container; only the hash
# reaches the database, through qa_auth.reset_password, which only the owner role may call.
set -euo pipefail
cd "$(dirname "$0")/.."

email=${1:-}
if [ -z "$email" ]; then
  echo "Usage: $0 <email>" >&2
  exit 2
fi
if [ -z "$(docker compose ps --status running -q worker 2>/dev/null)" ]; then
  echo "QuickAssign isn't running. Start it with ./scripts/start.sh first." >&2
  exit 1
fi

read -r -s -p "New password (at least 10 characters): " pw
echo
read -r -s -p "Type it again: " pw2
echo
if [ "$pw" != "$pw2" ]; then
  echo "The passwords don't match." >&2
  exit 1
fi
if [ ${#pw} -lt 10 ] || [ ${#pw} -gt 128 ]; then
  echo "Use 10 to 128 characters." >&2
  exit 1
fi

hash=$(printf '%s' "$pw" | docker compose exec -T worker node --input-type=module -e '
  import { hashPassword } from "@qa/core";
  let pw = "";
  for await (const chunk of process.stdin) pw += chunk;
  process.stdout.write(await hashPassword(pw));
')
unset pw pw2

result=$(printf "SELECT qa_auth.reset_password(:'email', :'hash');\n" |
  docker compose exec -T postgres psql -X -q -t -A -v ON_ERROR_STOP=1 -U qa_owner -d quickassign \
    -v email="$email" -v hash="$hash" -f -)
if [ "$result" = "t" ]; then
  echo "Password reset for $email. It has been signed out everywhere."
else
  echo "No account uses $email." >&2
  exit 1
fi
