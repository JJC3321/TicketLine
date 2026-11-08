import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  ata, authPda, enrollIx, exitIx, initPoolIx, lpPda, parseVoteV4, poolPda,
  setCreditLimitIx, vaultPda, voteAuthorizeWithdrawerIx, voteWithdrawIx, withdrawIx,
  depositIx,
} from "@ticketline/sdk";
import BN from "bn.js";
import { bus } from "./events.ts";
import { ensureFunded } from "./keys.ts";
import { sendTx } from "./keeper.ts";
import type { Demo } from "./state.ts";

const TICKET = 800_000_000n;
const BUFFER = 10_000_000n;

export async function demoSetup(d: Demo) {
  d.initKeys();
  await ensureFunded(d.conn, d.keys);
  // also fund bootstrap identity (payer for enroll/exit)
  const ibal = await d.conn.getBalance(d.keys.identity.publicKey);
  if (ibal < 1_000_000_000) {
    const sig = await d.conn.requestAirdrop(d.keys.identity.publicKey, 10_000_000_000);
    await d.conn.confirmTransaction(sig);
  }
  const [pool] = poolPda();
  const existing = await d.conn.getAccountInfo(pool);
  if (!existing) {
    const ix = await initPoolIx(d.program, {
      admin: d.keys.admin.publicKey,
      oracle: d.keys.admin.publicKey,
      feeBps: 150,
      ticketLamports: new BN(TICKET.toString()),
      bufferLamports: new BN(BUFFER.toString()),
      defaultCreditTickets: 5,
    });
    const sig = await sendTx(d, [ix], [d.keys.admin]);
    bus.keeper("PoolInit", { sig, pool: pool.toBase58() }, false, sig);
    return { created: true, sig };
  }
  return { created: false };
}

export async function demoDeposit(d: Demo, lender: "A" | "B", sol: number) {
  const k = lender === "A" ? d.keys.lenderA : d.keys.lenderB;
  const ix = await depositIx(d.program, {
    lender: k.publicKey,
    lamports: new BN(Math.round(sol * 1e9).toString()),
  });
  const sig = await sendTx(d, [ix], [k]);
  return { sig };
}

export async function demoWithdraw(d: Demo, lender: "A" | "B", shares: string) {
  const k = lender === "A" ? d.keys.lenderA : d.keys.lenderB;
  const [pool] = poolPda();
  const [lp] = lpPda(pool);
  let sh: bigint;
  if (shares === "all") {
    const a = await d.conn.getTokenAccountBalance(ata(k.publicKey, lp));
    sh = BigInt(a.value.amount);
  } else {
    sh = BigInt(shares);
  }
  const ix = await withdrawIx(d.program, { lender: k.publicKey, shares: new BN(sh.toString()) });
  const sig = await sendTx(d, [ix], [k]);
  return { sig };
}

/** Pre-enroll drain: voteWithdrawer withdraws down to rent+ticket+buffer+0.2 SOL. */
export async function demoDrain(d: Demo) {
  if (!d.vote) throw new Error("no vote account");
  const vote = d.vote;
  const rent = BigInt(await d.conn.getMinimumBalanceForRentExemption(3762));
  const target = rent + TICKET + BUFFER + 200_000_000n;
  const bal = BigInt(await d.conn.getBalance(vote));
  if (bal <= target) return { skipped: true, balance: String(bal) };
  const ix = voteWithdrawIx(vote, d.keys.voteWithdrawer.publicKey, d.keys.rewards.publicKey, bal - target);
  const sig = await sendTx(d, [ix], [d.keys.keeper, d.keys.voteWithdrawer]);
  bus.keeper("Drain", { sig, to: String(target) }, false, sig);
  return { sig, newBalance: String(target) };
}

/** One tx: Authorize(voteWithdrawer -> auth PDA) + enroll (owner = identity). */
export async function demoEnroll(d: Demo) {
  if (!d.vote) throw new Error("no vote account");
  const vote = d.vote;
  const [auth] = authPda(vote);
  const payout = d.keys.identity.publicKey;
  const ixs: TransactionInstruction[] = [
    voteAuthorizeWithdrawerIx(vote, d.keys.voteWithdrawer.publicKey, auth),
    await enrollIx(d.program, { owner: d.keys.identity.publicKey, vote, payout }),
  ];
  const sig = await sendTx(d, ixs, [d.keys.identity, d.keys.voteWithdrawer]);
  d.enrolled = true;
  d.exited = false;
  d.lastSeenEpoch = (await d.conn.getEpochInfo()).epoch;
  d.startKeeper();
  bus.keeper("Enrolled", { sig, vote: vote.toBase58(), auth: auth.toBase58() }, false, sig);
  return { sig, auth: auth.toBase58() };
}

export async function demoExit(d: Demo) {
  if (!d.vote) throw new Error("no vote account");
  const ix = await exitIx(d.program, {
    owner: d.keys.identity.publicKey,
    vote: d.vote,
    newWithdrawer: d.keys.voteWithdrawer.publicKey,
  });
  const sig = await sendTx(d, [ix], [d.keys.identity]);
  d.exited = true;
  d.stopKeeper();
  bus.keeper("Exited", { sig }, false, sig);
  return { sig };
}

/** limit = min(5 x ticket, 3 x avg simulated commission); default 5 x ticket. */
export async function oracleApply(d: Demo) {
  if (!d.vote) throw new Error("no vote account");
  const hist = d.commissionHistory;
  const avg = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
  const def = 5 * Number(TICKET);
  const limit = hist.length ? Math.min(def, Math.floor(3 * avg)) : def;
  const ix = await setCreditLimitIx(d.program, {
    oracle: d.keys.admin.publicKey,
    vote: d.vote,
    limit: new BN(limit.toString()),
  });
  const sig = await sendTx(d, [ix], [d.keys.admin]);
  return { sig, creditLimit: limit };
}
