#!/usr/bin/env bash
# Full demo reset: restart validator (fresh ledger) + restart backend.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .localnet

bash scripts/demo-stop.sh || true
bash scripts/localnet.sh --no-build

cd services/backend
setsid nohup pnpm exec tsx src/server.ts > ../../.localnet/backend.log 2>&1 &
echo $! > ../../.localnet/backend.pid
cd ../..

for i in $(seq 1 60); do
  curl -sf http://127.0.0.1:8787/health >/dev/null && break
  sleep 1
done
curl -s http://127.0.0.1:8787/health && echo " — backend up (pid $(cat .localnet/backend.pid))"

bash scripts/demo-web.sh
for i in $(seq 1 90); do
  curl -sf -o /dev/null http://localhost:3000 && break
  sleep 1
done
echo "web up on :3000 (pid $(cat .localnet/web.pid))"
