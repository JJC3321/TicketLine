import Fastify from "fastify";
import cors from "@fastify/cors";
import { Connection, PublicKey } from "@solana/web3.js";
import { ata, authPda, lpPda, parseVoteV4, poolPda, posPda, vaultPda, math } from "@ticketline/sdk";
import { cfg } from "./config.ts";
import { bus } from "./events.ts";
import { demo } from "./state.ts";
import {
  demoDeposit, demoDrain, demoEnroll, demoExit, demoSetup, demoWithdraw, oracleApply,
} from "./demo.ts";
import { getCached, scanMainnet, setCached, startScanner } from "./scanner.ts";
import { subscribeProgramLogs } from "./logevents.ts";

const app = Fastify({ logger: false });
await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true }));

app.get("/mainnet/runway", async (_q, reply) => {
  const snap = getCached();
  if (!snap) return reply.code(503).send({ error: "no snapshot yet" });
  return snap;
});
app.post("/mainnet/refresh", async () => {
  const s = await scanMainnet();
  setCached(s);
  return { ok: true, total: s.summary.total };
});

const wrap = (f: (b: never) => Promise<unknown>) =>
  async (req: { body: unknown }, reply: { code: (n: number) => { send: (x: unknown) => unknown } }) => {
    try {
      return await f((req.body ?? {}) as never);
    } catch (e) {
      return reply.code(400).send({ error: String((e as Error).message ?? e) });
    }
  };

app.post("/demo/setup", wrap(async () => demoSetup(demo)));
app.post("/demo/deposit", wrap(async (b) => {
  const { lender, sol } = b as { lender: "A" | "B"; sol: number };
  return demoDeposit(demo, lender, sol);
}));
app.post("/demo/withdraw", wrap(async (b) => {
  const { lender, shares } = b as { lender: "A" | "B"; shares: string };
  return demoWithdraw(demo, lender, shares);
}));
app.post("/demo/drain", wrap(async () => demoDrain(demo)));
app.post("/demo/enroll", wrap(async () => demoEnroll(demo)));
app.post("/demo/commission-schedule", wrap(async (b) => {
  demo.schedule = (b as { lamportsPerEpoch: number[] }).lamportsPerEpoch;
  return { schedule: demo.schedule };
}));
app.post("/demo/exit", wrap(async () => demoExit(demo)));
app.post("/demo/reset", wrap(async () => { demo.reset(); return { ok: true }; }));
app.post("/oracle/apply", wrap(async () => oracleApply(demo)));
app.post("/keeper/start", wrap(async () => { demo.startKeeper(); return { running: true }; }));
app.post("/keeper/stop", wrap(async () => { demo.stopKeeper(); return { running: false }; }));

app.get("/localnet/state", async () => {
  if (!demo.setupDone && !demo.enrolled && !demo.recovering) {
    demo.recovering = true;
    demo.recover().catch((e) => console.error("[recover]", e)).finally(() => { demo.recovering = false; });
  }
  const conn: Connection = demo.conn;
  const [pool] = poolPda();
  const [vault] = vaultPda(pool);
  const [lp] = lpPda(pool);
  const poolAcct = await conn.getAccountInfo(pool);
  let poolState: Record<string, unknown> | null = null;
  if (poolAcct) {
    const dv = new DataView(poolAcct.data.buffer, poolAcct.data.byteOffset, poolAcct.data.length);
    const pk = (o: number) => new PublicKey(poolAcct.data.subarray(o, o + 32)).toBase58();
    poolState = {
      admin: pk(8), oracle: pk(40), lpMint: pk(72),
      feeBps: dv.getUint16(104, true),
      ticketLamports: dv.getBigUint64(106, true).toString(),
      bufferLamports: dv.getBigUint64(114, true).toString(),
      defaultCreditTickets: dv.getUint8(122),
      totalPrincipal: dv.getBigUint64(123, true).toString(),
      totalFeesOutstanding: dv.getBigUint64(131, true).toString(),
      totalFeesEarned: dv.getBigUint64(139, true).toString(),
      totalTopups: dv.getBigUint64(147, true).toString(),
    };
  }
  const vaultBal = BigInt(await conn.getBalance(vault));
  const rent0 = BigInt(await conn.getMinimumBalanceForRentExemption(0));
  const vaultAvailable = vaultBal - rent0;
  const totalPrincipal = poolState ? BigInt(poolState.totalPrincipal as string) : 0n;
  const pv = math.poolValue(vaultAvailable, totalPrincipal);
  const lpInfo = await conn.getParsedAccountInfo(lp);
  const supply = BigInt(
    (lpInfo?.value?.data as { parsed?: { info?: { supply?: string } } })?.parsed?.info?.supply ?? "0",
  );
  const sharePrice = supply > 0n ? Number(pv) / Number(supply) : 1;

  const lenders: Record<string, unknown> = {};
  if (demo.keys) {
    for (const [name, k] of [["A", demo.keys.lenderA], ["B", demo.keys.lenderB]] as const) {
      lenders[name] = {
        pubkey: k.publicKey.toBase58(),
        sol: (await conn.getBalance(k.publicKey)) / 1e9,
        lpShares:
          (await conn.getTokenAccountBalance(ata(k.publicKey, lp)).catch(() => null))?.value.amount ?? "0",
      };
    }
  }

  const positions: Record<string, unknown>[] = [];
  if (demo.vote) {
    const [pos] = posPda(demo.vote);
    const posAcct = await conn.getAccountInfo(pos);
    const voteAcct = await conn.getAccountInfo(demo.vote);
    let posState: Record<string, unknown> | null = null;
    if (posAcct) {
      const dv = new DataView(posAcct.data.buffer, posAcct.data.byteOffset, posAcct.data.length);
      const pk = (o: number) => new PublicKey(posAcct.data.subarray(o, o + 32)).toBase58();
      posState = {
        voteAccount: pk(8), owner: pk(40), payout: pk(72),
        principal: dv.getBigUint64(104, true).toString(),
        fees: dv.getBigUint64(112, true).toString(),
        creditLimit: dv.getBigUint64(120, true).toString(),
        topups: dv.getUint32(128, true),
        lastTopupEpoch: dv.getBigUint64(132, true).toString(),
        enrolledEpoch: dv.getBigUint64(140, true).toString(),
        totalRepaid: dv.getBigUint64(148, true).toString(),
      };
    }
    let voteInfo: Record<string, unknown> | null = null;
    if (voteAcct) {
      const h = parseVoteV4(voteAcct.data);
      const rent = BigInt(await conn.getMinimumBalanceForRentExemption(voteAcct.data.length));
      const ticket = poolState ? BigInt(poolState.ticketLamports as string) : cfg.ticketLamports;
      const buffer = poolState ? BigInt(poolState.bufferLamports as string) : 0n;
      const req = math.required(rent, h.pendingDelegatorRewards, ticket, buffer);
      const lamports = BigInt(voteAcct.lamports);
      voteInfo = {
        lamports: String(lamports),
        node: h.nodePubkey.toBase58(),
        withdrawer: h.authorizedWithdrawer.toBase58(),
        authPda: authPda(demo.vote)[0].toBase58(),
        hasBls: h.hasBls,
        pending: String(h.pendingDelegatorRewards),
        required: String(req),
        deficit: String(math.deficit(req, lamports)),
        sweepable: String(math.sweepable(lamports, req)),
      };
    }
    positions.push({ position: posState, vote: voteInfo });
  }

  const ei = await conn.getEpochInfo();
  return {
    pool: poolState && {
      ...poolState,
      vaultBalance: String(vaultBal),
      vaultAvailable: String(vaultAvailable),
      lpSupply: String(supply),
      sharePrice,
      utilization: pv > 0n ? Number(totalPrincipal) / Number(pv) : 0,
    },
    lenders,
    positions,
    epoch: {
      epoch: ei.epoch, slotIndex: ei.slotIndex, slotsInEpoch: ei.slotsInEpoch,
      slotsRemaining: ei.slotsInEpoch - ei.slotIndex, absoluteSlot: ei.absoluteSlot,
    },
    setupDone: demo.setupDone,
    inconsistent: demo.inconsistent,
    keeper: {
      running: demo.keeperRunning,
      enrolled: demo.enrolled,
      exited: demo.exited,
      counters: { topUps: demo.counters.topUps, sweeps: demo.counters.sweeps },
      boundaryCount: demo.boundaryCount,
    },
    commissionSchedule: demo.schedule,
    commissionHistory: demo.commissionHistory,
    history: demo.history,
  };
});

app.get("/events", async (req, reply) => {
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });
  const send = (ev: unknown) => reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
  for (const ev of bus.ring) send(ev);
  const l = (ev: unknown) => send(ev);
  bus.on("event", l);
  req.raw.on("close", () => bus.off("event", l));
});

const port = cfg.port;
app.listen({ port, host: "0.0.0.0" }).then(() => {
  console.log(`backend on :${port}`);
  demo.initKeys();
  void demo.recover().catch((e) => console.error("[recover]", e));
  subscribeProgramLogs(demo.conn);
  startScanner();
});
