#!/usr/bin/env bash
# Production web app on :3000, detached (setsid) so it survives the caller.
set -euo pipefail
cd "$(dirname "$0")/../apps/web"
pnpm build > ../../.localnet/web.log 2>&1
setsid nohup pnpm start > ../../.localnet/web.log 2>&1 &
echo $! > ../../.localnet/web.pid
echo "web pid $(cat ../../.localnet/web.pid)"
