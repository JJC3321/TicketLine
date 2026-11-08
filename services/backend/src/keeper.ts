import { PublicKey, Signer, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  parseVoteV4, posPda, simTicketBurnIx, sweepIx, topUpIx,
} from "@ticketline/sdk";
import { bus } from "./events.ts";
import type { Demo } from "./state.ts";

const EXPECTED = ["AlreadyToppedUpThisEpoch", "NoDeficit", "NothingToSweep", "0x177"]; // custom errs
function isExpected(e: unknown): boolean {
  const s = String(e);
  return EXPECTED.some((x) => s.includes(x));
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

async function topUpIfNeeded(d: Demo, slotsRemaining: number) {
  if (!d.vote || !d.enrolled || d.exited) return;
  if (slotsRemaining > 48) return;
  try {
    const ix = await topUpIx(d.program, { payer: d.keys.keeper.publicKey, vote: d.vote });
    const sig = await sendTx(d, [ix], [d.keys.keeper]);
    d.counters.topUps++;
    bus.keeper("KeeperTopUp", { sig, vote: d.vote.toBase58() }, false, sig);
  } catch (e) {
    if (!isExpected(e)) throw e;
  }
}

async function boundary(d: Demo, epoch: number) {
  if (!d.vote || !d.enrolled) return;
  const vote = d.vote;
  const acct = await d.conn.getAccountInfo(vote);
  if (!acct) return;
  const h = parseVoteV4(acct.data);
  const rent = await voteRent(d);
  const ticket = 800_000_000n;
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
      if (!isExpected(e) && !String(e).includes("InsufficientHeadroom")) throw e;
    }
  } else if (!admitted) {
    bus.keeper("WouldBeExcluded", { epoch, vote: vote.toBase58(), simulated: true }, true);
  }

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
    if (!isExpected(e)) throw e;
  }

  const acct2 = await d.conn.getAccountInfo(vote);
  rec.balanceAfterCommission = acct2 ? acct2.lamports : 0;
  const posAcct = await d.conn.getAccountInfo(posPda(vote)[0]);
  if (posAcct) {
    const dv = new DataView(posAcct.data.buffer, posAcct.data.byteOffset, posAcct.data.length);
    rec.debt = Number(dv.getBigUint64(8 + 96, true)) + Number(dv.getBigUint64(8 + 104, true));
  }
  rec.balanceAfterBurn = rec.balanceAfterCommission;
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
