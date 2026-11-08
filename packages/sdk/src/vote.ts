import { PublicKey } from "@solana/web3.js";

export interface VoteHeader {
  nodePubkey: PublicKey;
  authorizedWithdrawer: PublicKey;
  inflationRewardsCollector: PublicKey;
  blockRevenueCollector: PublicKey;
  inflationRewardsCommissionBps: number;
  blockRevenueCommissionBps: number;
  pendingDelegatorRewards: bigint;
  hasBls: boolean;
}

/** VoteStateV4 header parser — same fixed offsets as programs/ticketline/src/vote.rs. */
export function parseVoteV4(data: Uint8Array): VoteHeader {
  if (data.length < 145) throw new Error("not V4: len < 145");
  const dv = new DataView(data.buffer, data.byteOffset, data.length);
  if (dv.getUint32(0, true) !== 3) throw new Error("not V4: tag != 3");
  return {
    nodePubkey: new PublicKey(data.subarray(4, 36)),
    authorizedWithdrawer: new PublicKey(data.subarray(36, 68)),
    inflationRewardsCollector: new PublicKey(data.subarray(68, 100)),
    blockRevenueCollector: new PublicKey(data.subarray(100, 132)),
    inflationRewardsCommissionBps: dv.getUint16(132, true),
    blockRevenueCommissionBps: dv.getUint16(134, true),
    pendingDelegatorRewards: dv.getBigUint64(136, true),
    hasBls: data[144] === 1,
  };
}

/** VoteInstruction::Withdraw — [3,0,0,0] ++ u64le */
export function withdrawData(lamports: bigint): Buffer {
  const b = Buffer.alloc(12);
  b.writeUInt32LE(3, 0);
  b.writeBigUInt64LE(lamports, 4);
  return b;
}

/** VoteInstruction::Authorize(new, Withdrawer) — [1,0,0,0] ++ pk ++ [1,0,0,0] */
export function authorizeWithdrawerData(newWithdrawer: PublicKey): Buffer {
  const b = Buffer.alloc(40);
  b.writeUInt32LE(1, 0);
  newWithdrawer.toBuffer().copy(b, 4);
  b.writeUInt32LE(1, 36);
  return b;
}
