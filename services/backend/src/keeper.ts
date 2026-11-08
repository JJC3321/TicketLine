import { PublicKey, Signer, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  parseVoteV4, posPda, simTicketBurnIx, sweepIx, topUpIx,
} from "@ticketline/sdk";
import { bus } from "./events.ts";
import type { Demo } from "./state.ts";

import { anchorErrorName } from "./errdecode.ts";

// expected no-op program errors (matched by IDL error name)
const EXPECTED = new Set(["AlreadyToppedUpThisEpoch", "NoDeficit", "NothingToSweep"]);
function isExpected(e: unknown): boolean {
  const n = anchorErrorName(e);
  return n !== null && EXPECTED.has(n);
}

// dedupe blocked notices: once per reason per epoch
const blockedSeen = new Set<string>();
function blockedOnce(key: string): boolean {
  if (blockedSeen.has(key)) return true;
  blockedSeen.add(key);
  if (blockedSeen.size > 256) blockedSeen.clear();
  return false;
}

export async function sendTx(
  d: Demo,
  ixs: TransactionInstruction[],
  signers: Signer[],
): Promise<string> {
  const tx = new Transaction();
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await d.conn.getLatestBlockhash()).blockhash;
  tx.add(...ixs);
  tx.sign(...signers);
  const sig = await d.conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await d.conn.confirmTransaction(sig, "confirmed");
  return sig;
}

async function voteRent(d: Demo): Promise<bigint> {
  return BigInt(await d.conn.getMinimumBalanceForRentExemption(3762));
}

async function poolTicket(d: Demo): Promise<bigint> {
  const { poolPda } = await import("@ticketline/sdk");
  const acct = await d.conn.getAccountInfo(poolPda()[0]);
  if (!acct) return 800_000_000n;
  const dv = new DataView(acct.data.buffer, acct.data.byteOffset, acct.data.length);
  return dv.getBigUint64(8 + 96 + 2, true); // disc + 3 pubkeys + u16
}

async function topUpIfNeeded(d: Demo, slotsRemaining: number) {
  if (!d.vote || !d.enrolled || d.exited) return;
  if (slotsRemaining > 48) return;
  try {
    const ix = await topUpIx(d.program, { payer: d.keys.keeper.publicKey, vote: d.vote });
    const sig = await sendTx(d, [ix], [d.keys.keeper]);
    d.counters.topUps++;
    bus.keeper("KeeperTopUp", { sig, vote: d.vote.toBase58() }, false, sig);
  } catch (e) {
    if (isExpected(e)) return;
    const reason = anchorErrorName(e) ?? String(e).slice(0, 120);
    const epoch = d.lastSeenEpoch;
    if (blockedOnce(`topup:${epoch}:${reason}`)) return;
    bus.keeper("TopUpBlocked", { epoch, reason, vote: d.vote.toBase58() });
  }
}

async function boundary(d: Demo, epoch: number) {
  if (!d.vote || !d.enrolled) return;
  const vote = d.vote;
  const acct = await d.conn.getAccountInfo(vote);
  if (!acct) return;
  const h = parseVoteV4(acct.data);
  const rent = await voteRent(d);
  const ticket = await poolTicket(d);
  const lamports = BigInt(acct.lamports);
  const admitted = lamports - h.pendingDelegatorRewards >= rent + ticket;
  const rec = {
    epoch,
    balanceBefore: Number(lamports),
    balanceAfterBurn: 0,
    balanceAfterCommission: 0,
    debt: 0,
    admitted,
  };
  bus.keeper("AdmissionCheck", {
    epoch, admitted, lamports: String(lamports),
    requiredForAdmission: String(rent + ticket), simulated: true,
  }, true);

  if (admitted && d.burnedThisEpoch !== epoch) {
    try {
      const ix = await simTicketBurnIx(d.program, { payer: d.keys.keeper.publicKey, vote });
      const sig = await sendTx(d, [ix], [d.keys.keeper]);
      d.burnedThisEpoch = epoch;
      bus.keeper("SimTicketBurn", { epoch, sig, simulated: true }, true, sig);
    } catch (e) {
      const n = anchorErrorName(e);
      if (n !== "InsufficientHeadroom" && !isExpected(e)) {
        bus.keeper("SimBurnFailed", { epoch, reason: n ?? String(e), simulated: true }, true);
      }
    }
  } else if (!admitted) {
    bus.keeper("WouldBeExcluded", { epoch, vote: vote.toBase58(), simulated: true }, true);
  }

  const acctBurn = await d.conn.getAccountInfo(vote);
  rec.balanceAfterBurn = acctBurn ? acctBurn.lamports : 0;

  // simulated commission per schedule
  const idx = Math.min(d.boundaryCount, d.schedule.length - 1);
  const comm = d.schedule[idx];
  if (comm > 0) {
    const ix = SystemProgram.transfer({
      fromPubkey: d.keys.rewards.publicKey,
      toPubkey: vote,
      lamports: comm,
    });
    const sig = await sendTx(d, [ix], [d.keys.rewards]);
    d.commissionHistory.push(comm);
    bus.keeper("SimCommission", { epoch, lamports: comm, sig, simulated: true }, true, sig);
  }
  d.boundaryCount++;

  try {
    const ix = await sweepIx(d.program, { payer: d.keys.keeper.publicKey, vote });
    const sig = await sendTx(d, [ix], [d.keys.keeper]);
    d.counters.sweeps++;
    bus.keeper("KeeperSweep", { epoch, sig }, false, sig);
  } catch (e) {
    if (!isExpected(e)) {
      bus.keeper("SweepFailed", { epoch, reason: anchorErrorName(e) ?? String(e), vote: vote.toBase58() });
    }
  }

  const acct2 = await d.conn.getAccountInfo(vote);
  rec.balanceAfterCommission = acct2 ? acct2.lamports : 0;
  try {
    type PosT = { principal: { toString(): string }; fees: { toString(): string } };
    type Accounts = Record<string, { fetch: (k: PublicKey) => Promise<PosT> }>;
    const pos = await (d.program.account as Accounts)["position"].fetch(posPda(vote)[0]);
    rec.debt = Number(BigInt(pos.principal.toString()) + BigInt(pos.fees.toString()));
  } catch { /* position may not exist */ }
  d.history.push(rec);
  if (d.history.length > 64) d.history.shift();
}

export async function keeperTick(d: Demo) {
  if (!d.keeperRunning) return;
  const ei = await d.conn.getEpochInfo();
  if (ei.epoch !== d.lastSeenEpoch) {
    const prev = d.lastSeenEpoch;
    d.lastSeenEpoch = ei.epoch;
    // first observation just anchors the epoch; run boundary on real transitions
    if (prev >= 0) await boundary(d, ei.epoch);
  }
  const slotsRemaining = ei.slotsInEpoch - ei.slotIndex;
  await topUpIfNeeded(d, slotsRemaining);
}
