# TicketLine

A credit line that keeps Solana validators admitted under Alpenglow — lenders
cover the Validator Admission Ticket (VAT) and are repaid automatically from
inflation commission, enforced on-chain by a PDA holding the vote account's
withdraw authority.

## The problem

Since **Alpenglow went live on mainnet (epoch 1064, 2026-10-21)**, every
validator must pay a **VAT of 0.8 SOL per epoch** (at 200ms slots; 1.6 at 400ms),
burned at epoch start for admission to the *next* epoch. Sources:
[solana.com/upgrades/bls-pubkey-vat](https://solana.com/upgrades/bls-pubkey-vat),
SIMD-0357, xroot.dev admission write-up.

Admission requires: BLS key present, stake > 0, and
`lamports − pending_delegator_rewards ≥ rent_exempt + VAT`. A validator that
misses admission produces no votes/blocks for an epoch and **its delegators
earn zero** that epoch.

## How TicketLine works

1. **Lenders** deposit SOL into a pool and receive `tlSOL` shares
   (`share price = pool value / supply`, only ever rises — fees accrue to it).
2. **Validator enrolls**: hands its vote account `authorized_withdrawer` to a
   program PDA (`["auth", vote]`) and calls `enroll` (verified: V4, BLS,
   collector = vote account, signer = node identity). While enrolled, SOL in the
   vote account can only go to VAT, or back to the pool/payout under reserve rules.
3. **Top-up** (keeper-permissionless): once per epoch, if the vote account is
   below `rent + pending + ticket + buffer`, the pool vault covers the *full*
   deficit, booked as principal + flat `fee_bps` fee (credit-limited).
4. **Sweep**: anyone can move the vote account's *surplus* above the reserve
   into the vault; repayment allocates **fees first, then principal**.
5. **Exit**: at zero debt the validator may `exit` — the PDA signs a vote
   `Authorize` restoring the original withdrawer; position closes. Surplus can
   also be withdrawn to the validator's payout (`withdraw_surplus`, debt = 0).

Invariants enforced by the program (each has a LiteSVM test):
lamports leave the vote account only to vault/payout/incinerator; reserves
(`rent + pending + ticket + buffer`) are never dipped; no exit with debt;
share price never decreases; ≤ 1 top-up/epoch, debt ≤ credit limit.

## Why only on Solana

Vote accounts with a programmable `authorized_withdrawer` + PDAs that can sign
vote-program `Withdraw`/`Authorize` CPIs — a lending protocol that takes custody
of nothing but a capability, not the keys. No equivalent exists on EVM chains.

## Architecture

```
lenders --SOL--> [vault PDA] --top_up--> [vote account (Vote program)]
   ^tlSOL mint        ^                          |
   |                  |---- sweep (fees+principal) |
   |                  +---- withdraw_surplus ----> payout
   |
program PDAs: pool, vault, lp mint, position, auth(=vote withdrawer)

keeper/backend (Fastify): epoch boundary → computed admission check →
  sim_ticket_burn* → sim commission* → sweep ; in-epoch top_up
web (Next.js): / mainnet runway · /pool · /demo
* = labeled simulations on localnet
```

## Live mainnet data (data/mainnet-snapshot.json, committed)

Scanned **697 vote accounts** (epoch 1080): 100% VoteStateV4, 684 with BLS.
Status: **SAFE 639 · WATCH 25 · AT_RISK 20 · NO_BLS 13** —
**~564,757 SOL** of activated stake on validators with < 1 ticket of runway.
(Refresh: `pnpm scan:once`; served at `GET /mainnet/runway`.)

## Run it

Prereqs: Node 22 + pnpm, Rust stable, Anchor 1.2.2 (avm), Agave CLI 4.1.2 for
builds, Agave 4.3.2 `solana-test-validator` at
`~/.local/share/solana/install/releases/4.3.2/solana-release/bin/` (see AGENTS.md).

```bash
pnpm install
pnpm demo:fresh        # localnet + backend :8787 (fresh ledger)
pnpm --filter web dev  # dashboard on :3000
pnpm demo:e2e          # end-to-end rescue scenario (~2.5 min)
cargo test -p ticketline && cargo test -p ticketline --features demo-sim
pnpm scan:once         # refresh mainnet snapshot (public RPC ok)
```

## What is simulated on localnet — and why

Agave 4.3.2 localnet activates SIMD-0357/V4/BLS but **Votor (SIMD-0326) is
inactive**: no VAT is burned, no inflation commission is produced, low balance
never halts the chain. To demo the real protocol we therefore simulate,
**labeled everywhere** (UI badges + `simulated: true` events):

- `sim_ticket_burn` — cargo-feature `demo-sim` only; a real on-chain
  PDA-signed vote `Withdraw(ticket)` to the incinerator, floored at
  `rent + pending`. The VAT itself is real program logic; only the trigger is simulated.
- Sim commission — a system transfer from a `rewards` demo key per a schedule
  (default 0.3×3 epochs dip → 2.0 SOL recovery).
- Admission check — the backend computes the SIMD-0357 check
  (`lamports − pending ≥ rent + ticket`) at each boundary and logs
  `Validator admitted for epoch N`; on-chain localnet wouldn't enforce it.

Everything else — pool accounting, PDA withdraw authority, top-up, fee-first
sweep, credit limits, exit — is 100% real program behavior.

## Trusted roles & limitations

- **Oracle** (demo: admin key) sets `credit_limit` per position; a production
  version derives it on-chain from reward history.
- **Admin** sets pool params (fee, ticket, buffer, default credit, oracle).
- **Position owner = vote `node_pubkey`** — identity key controls exit/payout.
- No liquidation/default path, no interest curve, inflation commission only
  (no block revenue). Roadmap: on-chain credit scoring, keeper rewards,
  multi-validator localnet, devnet deploy.
