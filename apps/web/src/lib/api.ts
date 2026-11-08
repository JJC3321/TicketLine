export const API = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8787";
export const post = (p: string, body?: unknown) =>
  fetch(`${API}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).then((r) => r.json());
export const get = <T>(p: string): Promise<T> => fetch(`${API}${p}`).then((r) => r.json());
export const sol = (l: string | number | bigint) => (Number(l) / 1e9);
export const fmt = (n: number, d = 2) =>
  n !== 0 && Math.abs(n) < 1
    ? n.toLocaleString(undefined, { maximumFractionDigits: 6 })
    : n.toLocaleString(undefined, { maximumFractionDigits: d });
export const short = (k: string, n = 6) => `${k.slice(0, n)}…${k.slice(-4)}`;
export const EXPLORER = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=http://localhost:8899`;
export type Runway = {
  epoch: number; slot: number; epochLenSlots: number; scannedAt: string; stale?: boolean;
  ticketLamports: string;
  summary: { total: number; counts: Record<string, number>; stakeAtRisk: string; eligibleCount: number; cutoffBinding: boolean; cutoffStake: string | null };
  accounts: {
    votePubkey: string; nodePubkey: string; activatedStake: string; rank: number; lamports: string;
    pendingDelegatorRewards: string; rentExempt: string; freeLamports: string; runwayEpochs: number;
    avgCommissionLamports: string; coverage: number; hasBls: boolean; delinquent: boolean;
    status: "SAFE" | "WATCH" | "AT_RISK" | "NO_BLS";
  }[];
};
export type LocalState = {
  setupDone?: boolean; inconsistent?: string | null;
  pool: null | { totalPrincipal: string; totalFeesEarned: string; totalFeesOutstanding: string; vaultAvailable: string; vaultBalance: string; lpSupply: string; sharePrice: number; utilization: number; ticketLamports: string; bufferLamports: string; totalTopups: string; feeBps: number };
  lenders: Record<string, { pubkey: string; sol: number; lpShares: string }>;
  positions: { position: null | { voteAccount: string; owner: string; payout: string; principal: string; fees: string; creditLimit: string; topups: number; totalRepaid: string };
               vote: null | { lamports: string; withdrawer: string; authPda: string; required: string; deficit: string; sweepable: string; hasBls: boolean } }[];
  epoch: { epoch: number; slotIndex: number; slotsInEpoch: number; slotsRemaining: number; absoluteSlot: number };
  keeper: { running: boolean; enrolled: boolean; exited: boolean; counters: { topUps: number; sweeps: number }; boundaryCount: number };
  commissionSchedule: number[]; commissionHistory: number[];
  history: { epoch: number; balanceBefore: number; balanceAfterBurn: number; balanceAfterCommission: number; debt: number; admitted: boolean }[];
};
export type Ev = { seq: number; ts: number; kind: string; name: string; simulated?: boolean; signature?: string; data: Record<string, unknown> };
