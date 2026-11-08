# TicketLine — agent notes (Phase 0)

## Environment (WSL2 Ubuntu 24.04, user root)
| Tool | Version | Path |
|---|---|---|
| rustc/cargo | 1.99.1 stable | ~/.cargo/bin |
| Agave CLI (active, for `anchor build`) | 4.1.2 | ~/.local/share/solana/install/active_release/bin |
| Agave 4.3.2 binaries (test-validator) | 4.3.2 | ~/.local/share/solana/install/releases/4.3.2/solana-release/bin |
| Anchor | 1.2.2 (via avm 1.2.2) | ~/.avm/bin via cargo |
| Node | 22.23.4 (nvm) | ~/.nvm |
| pnpm | 12.18.0 (corepack) | |

PATH notes: `avm install` RE-POINTED `active_release` at 4.1.2 — that is the intended
state: anchor 1.2.2 builds with 4.1.2 platform tools; run the **4.3.2**
`solana-test-validator` by absolute path:
`/root/.local/share/solana/install/releases/4.3.2/solana-release/bin/solana-test-validator`.
`bash -lc` is a login shell → reads `~/.bash_profile` (sources `.profile` + `.bashrc`);
nvm is initialized in `~/.profile`. `wsl bash -s` has NO PATH — always use `bash -lc`.
CLI keypair: `~/.config/solana/id.json`, RPC url = localhost.

## Commands
- `anchor build` — normal build (.so + IDL without sim ix).
- `anchor build -- --features demo-sim` — build WITH `sim_ticket_burn` (.so + IDL both include it).
  NOTE: `cargo test -p ticketline --features demo-sim` needs the .so from the demo-sim
  build (LiteSVM loads `target/deploy/ticketline.so`); run the demo-sim anchor build first.
- `cargo test -p ticketline` / `cargo test -p ticketline --features demo-sim` — all green.
- Program ID: `HDbnoeCddu4hK3JzX78TS4RAq6ZVypvqMhXwk7CEbHyq`; .so ~318 KB.

## Program layout (post-Phase-0)
`programs/ticketline/src`: lib.rs, state.rs (Pool/Position), errors.rs, events.rs,
math.rs (pure, unit-tested), vote.rs (V4 fixed-offset parser + hand-built vote ixs,
no solana-vote-interface runtime dep — dev-dep only),
instructions/{init_pool,update_params,deposit,withdraw,enroll,set_credit_limit,
top_up,sweep,withdraw_surplus,exit,sim}.rs.
LP = classic SPL mint `["lp", pool]` (anchor-spl 1.2.2, 9 dec, authority=pool PDA);
vault = system-owned PDA `["vault", pool]` funded with rent_min(0).
Anchor 1.2.2 notes: `CpiContext::new(program_id: Pubkey, ..)` (not AccountInfo);
anchor-spl needs `idl-build = [.., "anchor-spl/idl-build"]`; `init-if-needed` feature on.
Tests: `tests/common/mod.rs` helpers; vote accounts crafted via solana-vote-interface 6.0.3;
`Rent::default()` applies (rent_min(0)=890_880, rent_min(3762)=27_074_400).
- Localnet: `…/releases/4.3.2/…/solana-test-validator --reset --ledger /root/solanaHack/.localnet/ledger --slots-per-epoch 128`

## Spike findings

### S1 (PDA vote CPI) — PASS
`programs/ticketline/src/spike.rs` + `tests/spike_vote.rs`:
- Hand-encoded vote `Withdraw` = `[3,0,0,0]++u64le` and `Authorize(new,Withdrawer)` =
  `[1,0,0,0]++pubkey++[1,0,0,0]` are byte-identical to `solana-vote-interface` 6.0.3 builders.
- PDA (`["auth", vote_account]`) successfully signs both via `invoke_signed`; lamports move,
  `authorized_withdrawer` changes (verified by re-deserialize + fixed-offset parser).
- Fixed-offset V4 parser (plan §5.1 offsets) verified against `VoteStateVersions::deserialize`.
- **Vote `Withdraw` floor (agave 4.1.2 source `vote_state::withdraw`):** remaining balance must
  be ≥ `rent_exempt(data_len) + pending_delegator_rewards`, OR withdraw ALL to 0 (deinitializes
  the account; refused if `pending>0` or account had credits within last 2 epochs
  `ActiveVoteAccountClose`). Test asserts the into-pending withdrawal fails.
- `solana-vote-interface` **6.0.3** with `features=["bincode"]` is the dev-dep (already in tree
  via solana-vote-program 4.1.2). Vote program runs as a **builtin in LiteSVM** — no .so needed.
- VoteStateV4::size_of() = **3762**; rent-exempt for 3762 = **27,074,400 lamports** (localnet,
  Rent::default; mainnet RPC says 19,761,200 — different rent parameters!).

### S2 (localnet, Agave 4.3.2) — findings
- `--slots-per-epoch 128` accepted; epoch ≈ **30 s** (~4.3 slots/s, ~230 ms/slot).
- Features **active since epoch 0**: SIMD-0357 (Alpenglow VAT), SIMD-0185 (VoteState v4),
  SIMD-0387 (BLS mgmt), SIMD-0388 (BLS syscalls). **SIMD-0326 (Votor/new consensus) INACTIVE.**
- Bootstrap vote account = V4, BLS key **present**, `authorized_withdrawer` = the vote account
  itself → keypair at **`.localnet/ledger/vote-account-keypair.json`**. Identity =
  `validator-keypair.json`. inflation_rewards_collector = vote account, commission **0 bps**.
- Genesis pre-funds vote account with **1,000,000 SOL** (not "100 tickets").
- **VAT is NOT burned on localnet** (Votor inactive): balance flat across 11 epochs; log only
  prints `VAT: epoch N in (stake: …), epoch N+2: eligible if staked`. Stake grows ~31 SOL/epoch.
- **No inflation commission to vote account** (`getInflationReward` amount=0, commission=null;
  0 bps anyway). → Both `demo-sim` `sim_ticket_burn` and `/demo/sim-commission` are REQUIRED.
- Drained vote account to 1.5 SOL via `solana withdraw-from-vote-account
  --authorized-withdrawer ledger/vote-account-keypair.json`: chain kept producing across ≥3
  boundaries, still "eligible". → localnet never halts on balance; drain is safe for demos.
- Validator cannot pay fees from the vote account keypair (use default payer for the withdraw tx).

### S3 (mainnet, public RPC) — numbers
- `getVoteAccounts`: 664 current + 33 delinquent = **697**; `getMultipleAccounts` base64
  batches of 100 fine.
- **100% parse as V4**, all data len **3762**, BLS present on **684 (98.1%)**.
- `pending_delegator_rewards` = 0 on **all** accounts (field exists, currently always 0 on mainnet).
- mainnet rent-exempt(3762) = **19,761,200 lamports** (~0.0198 SOL).
- free = lamports−pending−rent: **33 < 0.8 SOL**, **41 < 1.6 SOL**.
- `getInflationReward`: works on public RPC but **max 32 addresses/call** (not 100);
  `commission` field returns `null` (public RPC doesn't expose it); `amount`+`postBalance` present.
- Fixed-offset parser verified field-for-field against `jsonParsed` on a live account.
- Fixtures: `data/fixtures/vote-accounts.json` (3 accounts, base64+jsonParsed),
  `data/fixtures/s3-summary.json`. Scripts: `scripts/s3-scan.mjs`, `scripts/inspect-vote.mjs`.

## Decisions encoded by spikes
- Build/test with Agave 4.1.2 (active_release); localnet runs 4.3.2 binary by path.
- Real-vs-sim: VAT burn and commission are **simulated** on localnet (`demo-sim` feature +
  `/demo/sim-commission`), labeled per plan. PDA withdraw-authority enforcement is real.

## Off-chain (Phase: sdk+backend+e2e)
- `packages/sdk` (@ticketline/sdk): TS SDK — pdas.ts, vote.ts (V4 parser + vote ix encoders),
  math.ts (math.rs mirror + runway), client.ts (@anchor-lang/core 1.2.2 builders, incl.
  sim_ticket_burn + raw vote Authorize/Withdraw ixs). `pnpm sdk:idl` copies target/idl.
  NOTE: core 1.2.2 exports no Wallet/NodeWallet at runtime — backend implements the Wallet
  interface inline (state.ts).
- `services/backend` (@ticketline/backend): Fastify :8787, CORS on.
  Run: `cd services/backend && pnpm exec tsx src/server.ts` (or `pnpm dev`).
  Endpoints: /health, /mainnet/runway (+POST /mainnet/refresh), /localnet/state, /events (SSE),
  POST /demo/{setup,deposit,withdraw,drain,enroll,commission-schedule,exit,reset},
  POST /oracle/apply, POST /keeper/{start,stop}.
  Scanner: `pnpm scan:once` writes data/mainnet-snapshot.json (committed); 10-min background
  refresh in server; getInflationReward batched 32/call with backoff.
- `scripts/localnet.sh` (`--no-build` to skip anchor build): builds demo-sim .so, starts
  4.3.2 validator on .localnet/ledger (slots-per-epoch 128), copies identity+vote-withdrawer
  keypairs into .localnet/keys (identity.json = validator, vote-withdrawer.json = vote acct).
- `pnpm demo:e2e` (scripts/demo-e2e.ts): spawns backend if not running; full rescue scenario.
  LAST GREEN: 145 s, 3 top-ups, 2 sweeps, debt->0, fees 19,500,000 lamports, exit restores
  withdrawer, admission check admitted every epoch.
- Keeper boundary order per epoch: computed admission check -> sim_ticket_burn (once/epoch)
  -> sim commission (schedule, default [0.3,0.3,0.3,then 2.0] SOL) -> sweep; in-epoch top_up
  when slotsRemaining <= 48. Expected errors treated as no-ops.
- Root package.json has "type":"module" (needed for tsx on scripts/*.ts).
- pnpm: onlyBuiltDependencies in pnpm-workspace.yaml (esbuild/bufferutil/utf-8-validate).

## Web + ops (phase: web)
- `apps/web` (@ticketline/web): Next.js 15 App Router + Tailwind + Recharts + SWR(2s)
  + EventSource(/events). Pages: `/` mainnet runway (cards, histogram, sortable table),
  `/pool` (TVL/utilization/fees/est-APY + lender deposit/withdraw), `/demo` (stepper,
  epoch progress + keeper-window marker, history charts, position card, SSE feed with
  SIMULATED tags + explorer custom-cluster tx links). Env: NEXT_PUBLIC_BACKEND_URL
  (default http://localhost:8787). `pnpm --filter web dev|build|typecheck`.
- `pnpm demo:fresh` (scripts/demo-fresh.sh): stops old procs, `localnet.sh --no-build`
  (ledger reset), restarts backend via `setsid` (survives the calling shell —
  plain `nohup ... &` children get reaped when the wsl session exits). Pid file:
  .localnet/backend.pid. `pnpm demo:stop` stops both.
- Backend additions: recover-on-boot (reconstructs setupDone/enrolled/inconsistent
  from chain on start and lazily on /localnet/state); keeper emits TopUpBlocked /
  SweepFailed / SimBurnFailed on non-expected errors (expected set = IDL error names
  AlreadyToppedUpThisEpoch|NoDeficit|NothingToSweep; InsufficientHeadroom for sim burn);
  admission check reads ticket_lamports from on-chain Pool; position decoded via
  program.account.position.fetch; history records real balances after burn/commission.
- `scripts/screenshot.mjs`: playwright screenshots (playwright is a root devDep;
  chromium at ~/.cache/ms-playwright). Output .localnet/screens/*.png.

## Ops notes (web restart)
- WSL can idle-shut down when no Linux session is open, killing validator/backend/web.
  After a WSL restart: `pnpm demo:fresh`.
- Restart web: `pnpm demo:web` (prod build + next start, detached). It kills the old
  server's whole process group (setsid pid = group leader; kill -- -PID) and falls
  back to fuser -k 3000/tcp, so no stale `next start` keeps the port.
- `pnpm demo:stop` group-kills web+backend too.
