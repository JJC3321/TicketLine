import fs from "node:fs";
import path from "node:path";
import { parseVoteV4 } from "@ticketline/sdk";
import { cfg } from "./config.ts";

interface RpcError extends Error { retriable?: boolean }

let rpcId = 0;
async function rpc<T = unknown>(method: string, params: unknown[], tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(cfg.mainnetRpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
        signal: AbortSignal.timeout(30_000),
      });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.error) {
        if (j.error.code === -32009 || /rate/i.test(j.error.message ?? "")) throw new Error(JSON.stringify(j.error));
        const e: RpcError = new Error(JSON.stringify(j.error));
        e.retriable = false;
        throw e;
      }
      return j.result as T;
    } catch (e) {
      lastErr = e;
      if ((e as RpcError).retriable === false) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw lastErr;
}

export interface RunwayAccount {
  votePubkey: string;
  nodePubkey: string;
  activatedStake: string;
  rank: number;
  lamports: string;
  pendingDelegatorRewards: string;
  rentExempt: string;
  freeLamports: string;
  runwayEpochs: number;
  avgCommissionLamports: string;
  coverage: number;
  hasBls: boolean;
  delinquent: boolean;
  status: "SAFE" | "WATCH" | "AT_RISK" | "NO_BLS";
}

export interface Snapshot {
  epoch: number;
  slot: number;
  epochLenSlots: number;
  scannedAt: string;
  stale?: boolean;
  ticketLamports: string;
  summary: {
    total: number;
    counts: Record<string, number>;
    stakeAtRisk: string;
    eligibleCount: number;
    cutoffBinding: boolean;
    cutoffStake: string | null;
  };
  accounts: RunwayAccount[];
}

export async function scanMainnet(): Promise<Snapshot> {
  const ticket = cfg.ticketLamports;
  const [epochInfo, va] = await Promise.all([
    rpc<{ epoch: number; absoluteSlot: number; slotsInEpoch: number }>("getEpochInfo", []),
    rpc<{ current: unknown[]; delinquent: unknown[] }>("getVoteAccounts", []),
  ]);
  type VA = { votePubkey: string; nodePubkey: string; activatedStake: number; epochCredits: unknown };
  const all = [
    ...(va.current as VA[]).map((v) => ({ ...v, delinquent: false })),
    ...(va.delinquent as VA[]).map((v) => ({ ...v, delinquent: true })),
  ];
  const pubkeys = all.map((v) => v.votePubkey);

  const infos: ({ lamports: number; data: [string, string] } | null)[] = [];
  for (let i = 0; i < pubkeys.length; i += 100) {
    const res = await rpc<{ value: ({ lamports: number; data: [string, string] } | null)[] }>(
      "getMultipleAccounts",
      [pubkeys.slice(i, i + 100), { encoding: "base64" }],
    );
    infos.push(...res.value);
  }

  const rent = BigInt(await rpc<number>("getMinimumBalanceForRentExemption", [3762]));

  // inflation rewards for the last epoch (max 32 addrs/call); keep it cheap: 5 epochs sampled
  // sequentially with retry — fall back to zeros on failure.
  const rewards = new Map<string, { total: bigint; n: number }>();
  const epochs = [epochInfo.epoch - 1, epochInfo.epoch - 2, epochInfo.epoch - 3, epochInfo.epoch - 4, epochInfo.epoch - 5]
    .filter((e) => e >= 0);
  for (const epoch of epochs) {
    for (let i = 0; i < pubkeys.length; i += 32) {
      try {
        const res = await rpc<({ amount: number; postBalance: number } | null)[]>(
          "getInflationReward",
          [pubkeys.slice(i, i + 32), { epoch }],
        );
        res.forEach((r, j) => {
          if (!r) return;
          const pk = pubkeys[i + j];
          const cur = rewards.get(pk) ?? { total: 0n, n: 0 };
          cur.total += BigInt(r.amount);
          cur.n += 1;
          rewards.set(pk, cur);
        });
      } catch {
        // leave missing epoch out of the average
      }
    }
  }

  const rows: RunwayAccount[] = [];
  for (let i = 0; i < all.length; i++) {
    const a = infos[i];
    if (!a) continue;
    const data = Buffer.from(a.data[0], "base64");
    let h;
    try {
      h = parseVoteV4(data);
    } catch {
      continue;
    }
    const lamports = BigInt(a.lamports);
    const free = lamports - h.pendingDelegatorRewards - rent;
    const rw = free <= 0n ? 0 : Number(free / ticket);
    const rwd = rewards.get(pubkeys[i]);
    const avgComm = rwd && rwd.n > 0 ? rwd.total / BigInt(rwd.n) : 0n;
    const coverage = ticket > 0n ? Number((avgComm * 1000n) / ticket) / 1000 : 0;
    const status = !h.hasBls ? "NO_BLS" : rw < 1 ? "AT_RISK" : rw < 3 ? "WATCH" : "SAFE";
    rows.push({
      votePubkey: pubkeys[i],
      nodePubkey: h.nodePubkey.toBase58(),
      activatedStake: String(all[i].activatedStake),
      rank: 0,
      lamports: String(lamports),
      pendingDelegatorRewards: String(h.pendingDelegatorRewards),
      rentExempt: String(rent),
      freeLamports: String(free),
      runwayEpochs: rw,
      avgCommissionLamports: String(avgComm),
      coverage,
      hasBls: h.hasBls,
      delinquent: all[i].delinquent,
      status,
    });
  }

  rows.sort((x, y) => (BigInt(y.activatedStake) > BigInt(x.activatedStake) ? 1 : -1));
  rows.forEach((r, i) => (r.rank = i + 1));

  const counts: Record<string, number> = { SAFE: 0, WATCH: 0, AT_RISK: 0, NO_BLS: 0 };
  let stakeAtRisk = 0n;
  let eligible = 0;
  for (const r of rows) {
    counts[r.status]++;
    if (r.status === "AT_RISK" || r.status === "NO_BLS") stakeAtRisk += BigInt(r.activatedStake);
    if (r.hasBls && BigInt(r.activatedStake) > 0n) eligible++;
  }
  const cutoffBinding = eligible > 2000;
  const cutoffStake = cutoffBinding ? rows.filter((r) => r.hasBls && BigInt(r.activatedStake) > 0n)[1999]?.activatedStake ?? null : null;

  const snap: Snapshot = {
    epoch: epochInfo.epoch,
    slot: epochInfo.absoluteSlot,
    epochLenSlots: epochInfo.slotsInEpoch,
    scannedAt: new Date().toISOString(),
    ticketLamports: String(ticket),
    summary: {
      total: rows.length,
      counts,
      stakeAtRisk: String(stakeAtRisk),
      eligibleCount: eligible,
      cutoffBinding,
      cutoffStake,
    },
    accounts: rows,
  };
  fs.mkdirSync(path.dirname(cfg.snapshotPath), { recursive: true });
  fs.writeFileSync(cfg.snapshotPath, JSON.stringify(snap));
  return snap;
}

let cached: Snapshot | null = null;
export function getCached(): Snapshot | null {
  if (cached) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(cfg.snapshotPath, "utf8"));
    return cached;
  } catch {
    return null;
  }
}
export function setCached(s: Snapshot) {
  cached = s;
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startScanner() {
  if (timer) return;
  const run = async () => {
    try {
      const s = await scanMainnet();
      setCached(s);
      console.log(`[scanner] ${s.summary.total} accounts, AT_RISK=${s.summary.counts.AT_RISK}`);
    } catch (e) {
      console.error("[scanner] failed:", (e as Error).message);
    }
  };
  void run();
  timer = setInterval(run, cfg.scanIntervalMs);
}
export function stopScanner() {
  if (timer) clearInterval(timer);
  timer = null;
}
