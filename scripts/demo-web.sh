#!/usr/bin/env bash
# Production web app on :3000, detached (setsid) so it survives the caller.
# Restarts are safe: kills the old server's whole process group + anything on :3000.
set -euo pipefail
cd "$(dirname "$0")/../apps/web"
PIDFILE=../../.localnet/web.pid

if [ -f "$PIDFILE" ]; then
  OLDPID=$(cat "$PIDFILE")
  kill -- -"$OLDPID" 2>/dev/null || kill "$OLDPID" 2>/dev/null || true
fi
# fallback: whatever still listens on :3000
fuser -k 3000/tcp 2>/dev/null || true
for i in $(seq 1 30); do
  curl -sf -o /dev/null http://localhost:3000 || break
  sleep 1
done
curl -sf -o /dev/null http://localhost:3000 && { echo "ERROR: :3000 still busy"; exit 1; } || true

pnpm build >> ../../.localnet/web.log 2>&1
setsid nohup pnpm start >> ../../.localnet/web.log 2>&1 &
NEWPID=$!
echo $NEWPID > "$PIDFILE"

for i in $(seq 1 90); do
  if ! kill -0 $NEWPID 2>/dev/null; then
    echo "ERROR: web server pid $NEWPID died — see .localnet/web.log"
    tail -15 ../../.localnet/web.log
    exit 1
  fi
  curl -sf -o /dev/null http://localhost:3000 && break
  sleep 1
done
curl -sf -o /dev/null http://localhost:3000 || { echo "ERROR: :3000 never came up"; exit 1; }
echo "web up on :3000 (pid $NEWPID)"
