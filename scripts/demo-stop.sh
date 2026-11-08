#!/usr/bin/env bash
cd "$(dirname "$0")/.."
[ -f .localnet/backend.pid ] && kill "$(cat .localnet/backend.pid)" 2>/dev/null || true
pkill -f "tsx src/serve[r].ts" 2>/dev/null || true
pkill -f "solana-test-validator" 2>/dev/null || true
exit 0
