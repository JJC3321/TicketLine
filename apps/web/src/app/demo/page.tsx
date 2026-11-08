"use client";
import useSWR from "swr";
import { get, post, sol, fmt, short, EXPLORER, type LocalState } from "@/lib/api";
import { useEvents } from "@/lib/useEvents";
import { BackendDown } from "@/components/BackendDown";
import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

export default function Demo() {
  const { data, error, mutate } = useSWR<LocalState>("/localnet/state", () => get("/localnet/state"), { refreshInterval: 2000 });
  const evs = useEvents();
  const [busy, setBusy] = useState("");
  const [sched, setSched] = useState("0.3,0.3,0.3,2.0");
  if (error || !data) return error ? <BackendDown /> : <div className="text-zinc-500">Loading…</div>;
  const st = data;
  const pos = st.positions[0];
  const act = async (p: string, body?: unknown) => { setBusy(p); try { await post(p, body); } finally { setBusy(""); mutate(); } };
  const steps: { label: string; done: boolean; run?: () => void }[] = [
    { label: "Setup pool", done: !!st.setupDone || !!st.pool, run: () => act("/demo/setup") },
    { label: "Deposit A 30 / B 20", done: st.pool ? Number(st.pool.vaultBalance) > 1e9 : false,
      run: async () => { setBusy("dep"); await post("/demo/deposit", { lender: "A", sol: 30 }); await post("/demo/deposit", { lender: "B", sol: 20 }); setBusy(""); mutate(); } },
    { label: "Drain vote account", done: pos?.vote ? sol(pos.vote.lamports) < 2 : false, run: () => act("/demo/drain") },
    { label: "Enroll validator", done: st.keeper.enrolled, run: () => act("/demo/enroll") },
    { label: st.keeper.running ? "Keeper running (auto)" : "Keeper", done: st.keeper.running },
    { label: "Exit", done: st.keeper.exited, run: () => act("/demo/exit") },
  ];
  const pct = Math.round((st.epoch.slotIndex / st.epoch.slotsInEpoch) * 100);
  const keeperX = Math.round(((st.epoch.slotsInEpoch - 48) / st.epoch.slotsInEpoch) * 100);
  const chart = st.history.map((h) => ({
    epoch: h.epoch,
    balance: h.balanceBefore / 1e9,
    afterBurn: h.balanceAfterBurn / 1e9,
    afterCommission: h.balanceAfterCommission / 1e9,
    debt: h.debt / 1e9,
  }));
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Localnet demo</h1>
        <span className="text-xs px-2 py-0.5 rounded bg-amber-900/60 text-amber-200 border border-amber-800">Localnet demo · simulated VAT burn & commission</span>
      </div>
      {st.inconsistent && <div className="rounded border border-amber-800 bg-amber-950/50 p-3 text-amber-200 text-sm">{st.inconsistent}</div>}
      <div className="flex flex-wrap gap-2">
        {steps.map((s, i) => (
          <button key={i} disabled={!s.run || s.done || !!busy} onClick={s.run}
            className={`px-3 py-1.5 rounded text-sm border ${s.done ? "border-emerald-800 bg-emerald-950/50 text-emerald-300" : "border-zinc-700 bg-zinc-900 hover:bg-zinc-800"} disabled:opacity-60`}>
            {s.done ? "✓ " : ""}{s.label}{busy ? "…" : ""}
          </button>
        ))}
        <button onClick={() => act("/demo/reset")} className="px-3 py-1.5 rounded text-sm border border-red-900 text-red-300">Reset</button>
      </div>
      <div className="flex gap-2 items-center text-sm">
        <span className="text-zinc-500">Commission schedule (SOL/epoch):</span>
        <input value={sched} onChange={(e) => setSched(e.target.value)} className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 w-56 font-mono" />
        <button onClick={() => act("/demo/commission-schedule", { lamportsPerEpoch: sched.split(",").map((x) => Math.round(Number(x) * 1e9)) })}
          className="px-3 py-1 rounded bg-zinc-800 text-sm">Apply</button>
      </div>
      <div>
        <div className="flex justify-between text-xs text-zinc-500 mb-1">
          <span>epoch {st.epoch.epoch} · slot {st.epoch.slotIndex}/{st.epoch.slotsInEpoch}</span>
          <span>{st.epoch.slotsRemaining} slots left (keeper window at {keeperX}%)</span>
        </div>
        <div className="h-3 rounded bg-zinc-900 border border-zinc-800 relative overflow-hidden">
          <div className="h-full bg-sky-600" style={{ width: `${pct}%` }} />
          <div className="absolute top-0 h-full w-0.5 bg-amber-400" style={{ left: `${keeperX}%` }} />
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <div className="text-sm text-zinc-400 mb-2">Vote balance vs required (per epoch)</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chart}>
              <XAxis dataKey="epoch" stroke="#71717a" fontSize={11} /><YAxis stroke="#71717a" fontSize={11} /><Tooltip />
              <ReferenceLine y={0.837} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: "required", fill: "#f59e0b", fontSize: 10 }} />
              <Line type="monotone" dataKey="balance" stroke="#38bdf8" dot={false} name="before burn" />
              <Line type="monotone" dataKey="afterCommission" stroke="#34d399" dot={false} name="after commission+sweep" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <div className="text-sm text-zinc-400 mb-2">Debt per epoch</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chart}>
              <XAxis dataKey="epoch" stroke="#71717a" fontSize={11} /><YAxis stroke="#71717a" fontSize={11} /><Tooltip />
              <Line type="monotone" dataKey="debt" stroke="#f87171" dot />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      {pos?.position && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm grid grid-cols-2 md:grid-cols-4 gap-2">
          <div>principal <b>{fmt(sol(pos.position.principal))}</b></div>
          <div>fees <b>{fmt(sol(pos.position.fees))}</b></div>
          <div>credit limit <b>{fmt(sol(pos.position.creditLimit))}</b></div>
          <div>debt <b>{fmt(sol(BigInt(pos.position.principal) + BigInt(pos.position.fees)))}</b></div>
          <div>deficit <b>{pos.vote ? fmt(sol(pos.vote.deficit)) : "—"}</b></div>
          <div>sweepable <b>{pos.vote ? fmt(sol(pos.vote.sweepable)) : "—"}</b></div>
          <div className="col-span-2">withdrawer {pos.vote && pos.vote.withdrawer === pos.vote.authPda ? <span className="text-emerald-400">= auth PDA ✓</span> : <span className="font-mono">{pos.vote ? short(pos.vote.withdrawer) : "—"}</span>}</div>
        </div>
      )}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <div className="text-sm text-zinc-400 mb-2">Events</div>
        <div className="space-y-1 max-h-80 overflow-y-auto text-sm">
          {evs.length === 0 && <div className="text-zinc-600">waiting for events…</div>}
          {evs.map((e) => (
            <div key={e.seq} className="flex gap-2 items-center">
              {e.name === "AdmissionCheck" && e.data.admitted === true ? (
                <span className="text-emerald-400 font-semibold">✓ Validator admitted for epoch {String(e.data.epoch)}</span>
              ) : e.name === "WouldBeExcluded" ? (
                <span className="text-red-400 font-semibold">✗ Would be excluded — epoch {String(e.data.epoch)}</span>
              ) : (
                <span className={e.kind === "keeper" ? "text-sky-300" : "text-violet-300"}>{e.name}</span>
              )}
              {e.simulated && <span className="text-[10px] px-1 rounded bg-amber-900 text-amber-200">SIMULATED</span>}
              {e.signature && <a className="text-zinc-500 font-mono text-xs hover:text-sky-400" href={EXPLORER(e.signature)} target="_blank">{short(e.signature)}</a>}
              <span className="text-zinc-600 text-xs ml-auto">{new Date(e.ts).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
