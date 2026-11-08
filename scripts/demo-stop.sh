#!/usr/bin/env bash
cd "$(dirname "$0")/.."
[ -f .localnet/web.pid ] && { WP=$(cat .localnet/web.pid); kill -- -"$WP" 2>/dev/null || kill "$WP" 2>/dev/null || true; }
[ -f .localnet/backend.pid ] && { BP=$(cat .localnet/backend.pid); kill -- -"$BP" 2>/dev/null || kill "$BP" 2>/dev/null || true; }
pkill -f "tsx src/serve[r].ts" 2>/dev/null || true
pkill -f "next start" 2>/dev/null || true
pkill -f "solana-test-validator" 2>/dev/null || true
exit 0
