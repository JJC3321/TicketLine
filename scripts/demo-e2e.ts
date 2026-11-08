// pnpm demo:e2e — drives the full localnet rescue scenario through the real backend.
// Requires scripts/localnet.sh running. Spawns the backend as a child process so the
// same keeper code path is exercised.
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "http://127.0.0.1:8787";
const DEADLINE = Date.now() + 9 * 60 * 1000;

let failures = 0;
function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "  PASS" : "  FAIL"} ${msg}`);
  if (!cond) failures++;
}
async function post(p: string, body?: unknown) {
  const r = await fetch(`${API}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${p}: ${JSON.stringify(j)}`);
  return j;
}
const get = (p: string) => fetch(`${API}${p}`).then((r) => r.json());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url: string, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error(`timeout waiting for ${url}`);
}

let backend: ChildProcess | null = null;
try {
  // backend already running? reuse
  let reuse = false;
  try {
    await waitFor(`${API}/health`, 2);
    reuse = true;
    console.log("reusing running backend");
  } catch {}
  if (!reuse) {
    backend = spawn("pnpm", ["--filter", "@ticketline/backend", "exec", "tsx", "src/server.ts"], {
      cwd: path.join(ROOT, "services/backend"),
      env: { ...process.env, SCAN_INTERVAL_MS: "999999999" }, // don't spam mainnet during e2e
      stdio: ["ignore", "pipe", "pipe"],
    });
    backend.stdout?.on("data", (d) => process.stdout.write(`[backend] ${d}`));
    backend.stderr?.on("data", (d) => process.stdout.write(`[backend!] ${d}`));
    await waitFor(`${API}/health`, 60);
  }

  console.log("== setup ==");
  await post("/demo/reset");
  const setup = await post("/demo/setup");
  console.log("  pool:", setup);
  await post("/demo/deposit", { lender: "A", sol: 30 });
  await post("/demo/deposit", { lender: "B", sol: 20 });
  console.log("  deposited 30 + 20 SOL");
  const drain = await post("/demo/drain");
  console.log("  drained:", drain);
  const enr = await post("/demo/enroll");
  console.log("  enrolled, auth PDA:", enr.auth);
  ok(!!enr.sig, "enroll tx confirmed");

  const s0 = await get("/localnet/state");
  const startSlot = s0.epoch.absoluteSlot;
  const startEpoch = s0.epoch.epoch;
  const vote = s0.positions[0].vote;
  ok(vote.withdrawer === vote.authPda, "vote withdrawer is auth PDA after enroll");
  const baselineBalance = BigInt(vote.lamports);
  console.log(`  vote balance after drain: ${Number(baselineBalance) / 1e9} SOL, required ${Number(vote.required) / 1e9}`);

  console.log("== keeper running: watching epochs ==");
  let admittedEvery = true;
  let sawTopUps = 0;
  let sawSweeps = 0;
  let lastSlot = startSlot;
  let slotAdvanced = true;
  while (true) {
    if (Date.now() > DEADLINE) throw new Error("deadline exceeded");
    await sleep(5000);
    const st = await get("/localnet/state");
    const pos = st.positions[0]?.position;
    const debt = pos ? BigInt(pos.principal) + BigInt(pos.fees) : 0n;
    sawTopUps = st.keeper.counters.topUps;
    sawSweeps = st.keeper.counters.sweeps;
    if (st.epoch.absoluteSlot <= lastSlot) slotAdvanced = false;
    lastSlot = st.epoch.absoluteSlot;
    for (const h of st.history) {
      if (!h.admitted) admittedEvery = false;
    }
    process.stdout.write(
      `  e${st.epoch.epoch} slot+${st.epoch.slotIndex} bal=${(Number(st.positions[0]?.vote?.lamports ?? 0) / 1e9).toFixed(2)} ` +
      `debt=${(Number(debt) / 1e9).toFixed(3)} topUps=${sawTopUps} sweeps=${sawSweeps} fees=${st.pool?.totalFeesEarned}\n`,
    );
    // done when we have >=2 sweeps and debt back to 0 after having had debt
    if (sawTopUps >= 2 && sawSweeps >= 2 && debt === 0n && st.history.length >= 4) break;
    if (!st.keeper.running && st.keeper.enrolled) throw new Error("keeper stopped unexpectedly");
  }

  const st1 = await get("/localnet/state");
  ok(sawTopUps >= 2, `>=2 top-ups (got ${sawTopUps})`);
  ok(sawSweeps >= 2, `>=2 sweeps (got ${sawSweeps})`);
  ok(admittedEvery, "admission check admitted=true every epoch");
  ok(slotAdvanced, "slots kept advancing");
  const debtEnd = BigInt(st1.positions[0].position.principal) + BigInt(st1.positions[0].position.fees);
  ok(debtEnd === 0n, `debt repaid to 0 (got ${debtEnd})`);
  ok(BigInt(st1.pool.totalFeesEarned) > 0n, `fees earned > 0 (got ${st1.pool.totalFeesEarned})`);
  ok(st1.pool.sharePrice > 1.0, `share price > 1.0 (got ${st1.pool.sharePrice})`);

  console.log("== exit ==");
  const ex = await post("/demo/exit");
  ok(!!ex.sig, "exit tx confirmed");
  const st3 = await get("/localnet/state");
  const voteInfo = st3.positions[0].vote;
  // withdrawer should be restored to the bootstrap vote-withdrawer (= vote account pubkey)
  const votePk = s0.positions[0].position.voteAccount;
  ok(voteInfo.withdrawer === votePk, `withdrawer restored to ${votePk.slice(0, 8)}… (got ${voteInfo.withdrawer.slice(0, 8)}…)`);

  console.log("\n===== DEMO SUMMARY =====");
  console.log(`epochs observed:      ${st3.epoch.epoch - startEpoch}`);
  console.log(`top-ups:              ${sawTopUps}`);
  console.log(`sweeps:               ${sawSweeps}`);
  console.log(`fees earned:          ${st3.pool.totalFeesEarned} lamports`);
  console.log(`final share price:    ${st3.pool.sharePrice}`);
  console.log(`admission each epoch: ${admittedEvery}`);
  console.log(`withdrawer restored:  true`);
  console.log(`runtime:              ${((Date.now() - (DEADLINE - 9 * 60 * 1000)) / 1000).toFixed(0)}s`);
} finally {
  if (backend) backend.kill();
}
process.exit(failures ? 1 : 0);
