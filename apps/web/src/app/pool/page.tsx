"use client";
import useSWR from "swr";
import { get, post, sol, fmt, type LocalState } from "@/lib/api";
import { BackendDown } from "@/components/BackendDown";
import { useState } from "react";

export default function Pool() {
  const { data, error, mutate } = useSWR<LocalState>("/localnet/state", () => get("/localnet/state"), { refreshInterval: 2000 });
  const [amt, setAmt] = useState<Record<string, string>>({ A: "5", B: "5", wA: "all", wB: "all" });
  const [busy, setBusy] = useState("");
  if (error || !data) return error ? <BackendDown /> : <div className="text-zinc-500">Loading…</div>;
  const p = data.pool;
  const act = async (fn: () => Promise<unknown>, k: string) => { setBusy(k); try { await fn(); } finally { setBusy(""); mutate(); } };
  const apy = p && Number(p.vaultAvailable) > 0
    ? (Number(p.totalFeesEarned) / (Number(p.vaultAvailable) + Number(p.totalPrincipal))) * 182.5 : 0;
  const Card = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className="text-xs text-zinc-500">{k}</div><div className="text-xl font-semibold">{v}</div>
    </div>
  );
  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">tlSOL Pool</h1>
      {!p ? <div className="text-zinc-500">Pool not initialized — run Setup on the demo page.</div> : (
      <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card k="Pool value (TVL)" v={`${fmt(sol(BigInt(p.vaultAvailable) + BigInt(p.totalPrincipal)))} SOL`} />
        <Card k="Vault liquidity" v={`${fmt(sol(p.vaultAvailable))} SOL`} />
        <Card k="Outstanding principal" v={`${fmt(sol(p.totalPrincipal))} SOL`} />
        <Card k="Utilization" v={`${fmt(p.utilization * 100, 1)}%`} />
        <Card k="Fees earned" v={`${fmt(sol(p.totalFeesEarned), 4)} SOL`} />
        <Card k="tlSOL price" v={`${p.sharePrice.toFixed(6)} SOL`} />
        <Card k="Est. APY" v={`${fmt(apy * 100, 1)}%`} />
        <Card k="Top-ups" v={p.totalTopups} />
      </div>
      <div className="text-xs text-zinc-500">Est. APY = fees earned / pool value × 182.5 epochs (mainnet ≈1 day); labeled estimate.</div>
      <div className="grid md:grid-cols-2 gap-4">
        {(["A", "B"] as const).map((l) => {
          const ld = data.lenders[l];
          return (
            <div key={l} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-2">
              <div className="font-semibold">Lender {l}</div>
              <div className="text-sm text-zinc-400">SOL: {fmt(ld?.sol ?? 0)} · tlSOL: {ld ? fmt(Number(BigInt(ld.lpShares)) / 1e9, 3) : "0"} · value ≈ {ld ? fmt(Number(BigInt(ld.lpShares)) / 1e9 * p.sharePrice) : "0"} SOL</div>
              <div className="flex gap-2 items-center">
                <input value={amt[l]} onChange={(e) => setAmt({ ...amt, [l]: e.target.value })} className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm" />
                <button disabled={busy === `d${l}`} onClick={() => act(() => post("/demo/deposit", { lender: l, sol: Number(amt[l]) }), `d${l}`)}
                  className="px-3 py-1 rounded bg-sky-700 hover:bg-sky-600 text-sm disabled:opacity-50">Deposit SOL</button>
                <button disabled={busy === `w${l}`} onClick={() => act(() => post("/demo/withdraw", { lender: l, shares: "all" }), `w${l}`)}
                  className="px-3 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-sm disabled:opacity-50">Withdraw all</button>
              </div>
            </div>
          );
        })}
      </div>
      </>)}
    </div>
  );
}
