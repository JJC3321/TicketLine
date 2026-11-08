"use client";
import useSWR from "swr";
import { get, sol, fmt, short, type Runway } from "@/lib/api";
import { BackendDown } from "@/components/BackendDown";
import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const SEV = { NO_BLS: 0, AT_RISK: 1, WATCH: 2, SAFE: 3 } as const;
const PILL: Record<string, string> = {
  SAFE: "bg-emerald-900 text-emerald-200",
  WATCH: "bg-amber-900 text-amber-200",
  AT_RISK: "bg-red-900 text-red-200",
  NO_BLS: "bg-zinc-800 text-zinc-300",
};
const BUCKETS: [string, (r: number) => boolean][] = [
  ["0", (r) => r < 1], ["1", (r) => r >= 1 && r < 2], ["2", (r) => r >= 2 && r < 3],
  ["3–5", (r) => r >= 3 && r < 6], ["6–10", (r) => r >= 6 && r < 11],
  ["11–30", (r) => r >= 11 && r < 31], ["30+", (r) => r >= 31],
];

export default function Home() {
  const { data, error } = useSWR<Runway>("/mainnet/runway", () => get("/mainnet/runway"), { refreshInterval: 30000 });
  const [sort, setSort] = useState<"risk" | "runway" | "stake">("risk");
  const [filt, setFilt] = useState<string>("");
  if (error || !data) return error ? <BackendDown /> : <div className="text-zinc-500">Loading…</div>;
  const c = data.summary.counts;
  const hist = BUCKETS.map(([label, f]) => ({ label, n: data.accounts.filter((a) => f(a.runwayEpochs)).length }));
  const rows = data.accounts
    .filter((a) => !filt || a.status === filt || a.votePubkey.includes(filt))
    .sort((a, b) =>
      sort === "runway" ? a.runwayEpochs - b.runwayEpochs
      : sort === "stake" ? Number(BigInt(b.activatedStake) - BigInt(a.activatedStake))
      : SEV[a.status] - SEV[b.status] || a.runwayEpochs - b.runwayEpochs);
  return (
    <div className="space-y-6">
      <p className="text-zinc-400">Alpenglow charges every validator <b className="text-zinc-100">0.8 SOL per epoch (~1 day)</b>. Miss it and your delegators earn nothing.</p>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          ["Scanned", data.summary.total], ["AT_RISK", c.AT_RISK ?? 0], ["NO_BLS", c.NO_BLS ?? 0],
          ["WATCH", c.WATCH ?? 0], ["Stake at risk", `${fmt(sol(data.summary.stakeAtRisk), 0)} SOL`],
          [`Epoch ${data.epoch}`, `slot ${data.slot}`],
        ].map(([k, v]) => (
          <div key={String(k)} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
            <div className="text-xs text-zinc-500">{k}</div>
            <div className="text-xl font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <div className="text-xs text-zinc-500">
        scanned {new Date(data.scannedAt).toLocaleTimeString()} {data.stale && <span className="text-amber-400">(stale)</span>}
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <div className="text-sm text-zinc-400 mb-2">VAT runway distribution (epochs)</div>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={hist}><XAxis dataKey="label" stroke="#71717a" fontSize={12} /><YAxis stroke="#71717a" fontSize={12} /><Tooltip /><Bar dataKey="n" fill="#38bdf8" /></BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex gap-2 text-sm items-center">
        <input placeholder="filter status/pubkey" value={filt} onChange={(e) => setFilt(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 w-56" />
        {([["risk", "by risk"], ["runway", "runway"], ["stake", "stake"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setSort(v)} className={`px-2 py-1 rounded border ${sort === v ? "border-sky-500 text-sky-300" : "border-zinc-800 text-zinc-400"}`}>{l}</button>
        ))}
      </div>
      <table className="w-full text-sm">
        <thead className="text-zinc-500 text-left"><tr>
          <th>#</th><th>vote</th><th>stake</th><th>free</th><th>runway</th><th>avg comm/epoch</th><th>coverage</th><th>BLS</th><th>status</th>
        </tr></thead>
        <tbody>
          {rows.slice(0, 200).map((a) => (
            <tr key={a.votePubkey} className="border-t border-zinc-900 hover:bg-zinc-900/60">
              <td className="py-1.5 text-zinc-500">{a.rank}</td>
              <td className="font-mono cursor-pointer" title="click to copy" onClick={() => navigator.clipboard.writeText(a.votePubkey)}>{short(a.votePubkey)}</td>
              <td>{fmt(sol(a.activatedStake), 0)}</td>
              <td>{fmt(sol(a.freeLamports))}</td>
              <td>{a.runwayEpochs} <span className="text-zinc-600">(~{a.runwayEpochs}d)</span></td>
              <td>{fmt(sol(a.avgCommissionLamports), 3)}</td>
              <td>{Math.round(a.coverage * 100)}%</td>
              <td>{a.hasBls ? "✓" : "—"}</td>
              <td><span className={`px-2 py-0.5 rounded text-xs ${PILL[a.status]}`}>{a.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
