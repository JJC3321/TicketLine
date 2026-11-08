import { AnchorProvider, Program, type Idl } from "@anchor-lang/core";
import {
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import idl from "./idl/ticketline.json" with { type: "json" };
import {
  authPda, lpPda, poolPda, posPda, vaultPda, CLOCK_SYSVAR, INCINERATOR, PROGRAM_ID,
  VOTE_PROGRAM_ID,
} from "./pdas.ts";
import { authorizeWithdrawerData, withdrawData } from "./vote.ts";

export type TicketlineProgram = Program<Idl>;

export function makeProgram(provider: AnchorProvider): TicketlineProgram {
  return new Program(idl as Idl, provider);
}

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM,
  )[0];
}
export { TOKEN_PROGRAM, ATA_PROGRAM };

export function initPoolIx(
  program: TicketlineProgram,
  args: {
    admin: PublicKey; oracle: PublicKey; feeBps: number;
    ticketLamports: BN; bufferLamports: BN; defaultCreditTickets: number;
  },
): Promise<TransactionInstruction> {
  const [pool] = poolPda();
  const [vault] = vaultPda(pool);
  const [lp] = lpPda(pool);
  return program.methods
    .initPool(args.feeBps, args.ticketLamports, args.bufferLamports, args.defaultCreditTickets, args.oracle)
    .accounts({
      admin: args.admin, pool, vault, lpMint: lp,
      tokenProgram: TOKEN_PROGRAM, systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
}

export function updateParamsIx(
  program: TicketlineProgram,
  args: {
    admin: PublicKey; feeBps?: number | null; ticketLamports?: BN | null;
    bufferLamports?: BN | null; defaultCreditTickets?: number | null; oracle?: PublicKey | null;
  },
): Promise<TransactionInstruction> {
  const [pool] = poolPda();
  return program.methods
    .updateParams(
      args.feeBps ?? null, args.ticketLamports ?? null, args.bufferLamports ?? null,
      args.defaultCreditTickets ?? null, args.oracle ?? null,
    )
    .accounts({ admin: args.admin, pool })
    .instruction();
}

export function depositIx(
  program: TicketlineProgram,
  args: { lender: PublicKey; lamports: BN },
): Promise<TransactionInstruction> {
  const [pool] = poolPda();
  const [vault] = vaultPda(pool);
  const [lp] = lpPda(pool);
  return program.methods
    .deposit(args.lamports)
    .accounts({
      lender: args.lender, pool, vault, lpMint: lp, lenderAta: ata(args.lender, lp),
      tokenProgram: TOKEN_PROGRAM, associatedTokenProgram: ATA_PROGRAM,
      systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
}

export function withdrawIx(
  program: TicketlineProgram,
  args: { lender: PublicKey; shares: BN },
): Promise<TransactionInstruction> {
  const [pool] = poolPda();
  const [vault] = vaultPda(pool);
  const [lp] = lpPda(pool);
  return program.methods
    .withdraw(args.shares)
    .accounts({
      lender: args.lender, pool, vault, lpMint: lp, lenderAta: ata(args.lender, lp),
      tokenProgram: TOKEN_PROGRAM, systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
}

export function enrollIx(
  program: TicketlineProgram,
  args: { owner: PublicKey; vote: PublicKey; payout: PublicKey },
): Promise<TransactionInstruction> {
  const [pool] = poolPda();
  return program.methods
    .enroll(args.payout)
    .accounts({
      owner: args.owner, voteAccount: args.vote, auth: authPda(args.vote)[0],
      position: posPda(args.vote)[0], pool, systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export function setCreditLimitIx(
  program: TicketlineProgram,
  args: { oracle: PublicKey; vote: PublicKey; limit: BN },
): Promise<TransactionInstruction> {
  const [pool] = poolPda();
  return program.methods
    .setCreditLimit(args.limit)
    .accounts({ oracle: args.oracle, pool, position: posPda(args.vote)[0] })
    .instruction();
}

export function topUpIx(
  program: TicketlineProgram,
  args: { payer: PublicKey; vote: PublicKey },
): Promise<TransactionInstruction> {
  const [pool] = poolPda();
  return program.methods
    .topUp()
    .accounts({
      payer: args.payer, pool, vault: vaultPda(pool)[0], position: posPda(args.vote)[0],
      voteAccount: args.vote, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
}

export function sweepIx(
  program: TicketlineProgram,
  args: { payer: PublicKey; vote: PublicKey },
): Promise<TransactionInstruction> {
  const [pool] = poolPda();
  return program.methods
    .sweep()
    .accounts({
      payer: args.payer, pool, vault: vaultPda(pool)[0], position: posPda(args.vote)[0],
      voteAccount: args.vote, auth: authPda(args.vote)[0], voteProgram: VOTE_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
}

export function withdrawSurplusIx(
  program: TicketlineProgram,
  args: { owner: PublicKey; vote: PublicKey; payout: PublicKey; lamports: BN },
): Promise<TransactionInstruction> {
  const [pool] = poolPda();
  return program.methods
    .withdrawSurplus(args.lamports)
    .accounts({
      owner: args.owner, pool, position: posPda(args.vote)[0], voteAccount: args.vote,
      auth: authPda(args.vote)[0], payout: args.payout, voteProgram: VOTE_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
}

export function exitIx(
  program: TicketlineProgram,
  args: { owner: PublicKey; vote: PublicKey; newWithdrawer: PublicKey },
): Promise<TransactionInstruction> {
  return program.methods
    .exit(args.newWithdrawer)
    .accounts({
      owner: args.owner, position: posPda(args.vote)[0], voteAccount: args.vote,
      auth: authPda(args.vote)[0], clock: CLOCK_SYSVAR, voteProgram: VOTE_PROGRAM_ID,
    })
    .instruction();
}

export function simTicketBurnIx(
  program: TicketlineProgram,
  args: { payer: PublicKey; vote: PublicKey },
): Promise<TransactionInstruction> {
  const [pool] = poolPda();
  const m = program.methods as Record<string, (...a: unknown[]) => { accounts: (a: Record<string, PublicKey>) => { instruction: () => Promise<TransactionInstruction> } }>;
  return m["simTicketBurn"]()
    .accounts({
      payer: args.payer, pool, position: posPda(args.vote)[0], voteAccount: args.vote,
      auth: authPda(args.vote)[0], incinerator: INCINERATOR, voteProgram: VOTE_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
}

/** Raw vote-program Authorize(new, Withdrawer) signed by `withdrawer`. */
export function voteAuthorizeWithdrawerIx(vote: PublicKey, withdrawer: PublicKey, newWithdrawer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: VOTE_PROGRAM_ID,
    keys: [
      { pubkey: vote, isSigner: false, isWritable: true },
      { pubkey: CLOCK_SYSVAR, isSigner: false, isWritable: false },
      { pubkey: withdrawer, isSigner: true, isWritable: false },
    ],
    data: authorizeWithdrawerData(newWithdrawer),
  });
}

/** Raw vote-program Withdraw(lamports) signed by `withdrawer`. */
export function voteWithdrawIx(vote: PublicKey, withdrawer: PublicKey, to: PublicKey, lamports: bigint): TransactionInstruction {
  return new TransactionInstruction({
    programId: VOTE_PROGRAM_ID,
    keys: [
      { pubkey: vote, isSigner: false, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: true },
      { pubkey: withdrawer, isSigner: true, isWritable: false },
    ],
    data: withdrawData(lamports),
  });
}
