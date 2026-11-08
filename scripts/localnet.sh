#!/usr/bin/env bash
# Starts Agave 4.3.2 test-validator with the ticketline program (demo-sim build).
set -euo pipefail
cd "$(dirname "$0")/.."

PROGRAM_ID="HDbnoeCddu4hK3JzX78TS4RAq6ZVypvqMhXwk7CEbHyq"
AGAVE_432="$HOME/.local/share/solana/install/releases/4.3.2/solana-release/bin"
LEDGER=.localnet/ledger
KEYS=.localnet/keys

if [[ "${1:-}" != "--no-build" ]]; then
  anchor build -- --features demo-sim
fi

mkdir -p "$KEYS"
# kill anything on 8899
pkill -f "solana-test-validator" 2>/dev/null && sleep 2 || true

nohup "$AGAVE_432/solana-test-validator" \
  --reset --ledger "$LEDGER" --slots-per-epoch 128 \
  --bpf-program "$PROGRAM_ID" target/deploy/ticketline.so \
  > .localnet/validator.log 2>&1 &
echo "validator pid $!"

# wait for RPC
for i in $(seq 1 60); do
  if curl -s http://127.0.0.1:8899 -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | grep -q '"ok"'; then
    break
  fi
  sleep 1
done

for i in $(seq 1 30); do [ -f "$LEDGER/validator-keypair.json" ] && [ -f "$LEDGER/vote-account-keypair.json" ] && break; sleep 1; done

cp "$LEDGER/validator-keypair.json" "$KEYS/identity.json"
cp "$LEDGER/vote-account-keypair.json" "$KEYS/vote-withdrawer.json"

VOTE=$(solana-keygen pubkey "$KEYS/vote-withdrawer.json")
IDENT=$(solana-keygen pubkey "$KEYS/identity.json")
cat <<MSG
=== localnet ready ===
program:   $PROGRAM_ID (demo-sim build)
identity:  $IDENT   (.localnet/keys/identity.json)
vote acct: $VOTE    (withdrawer: .localnet/keys/vote-withdrawer.json)
slots/epoch: 128 (~30s)
log: .localnet/validator.log
MSG
