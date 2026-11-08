import { PublicKey } from "@solana/web3.js";
import idl from "./idl/ticketline.json" with { type: "json" };

export const PROGRAM_ID = new PublicKey(idl.address);
export const VOTE_PROGRAM_ID = new PublicKey("Vote111111111111111111111111111111111111111");
export const INCINERATOR = new PublicKey("1nc1nerator11111111111111111111111111111111");
export const CLOCK_SYSVAR = new PublicKey("SysvarC1ock11111111111111111111111111111111");

export function poolPda(programId = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("pool")], programId);
}
export function vaultPda(pool: PublicKey, programId = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), pool.toBuffer()], programId);
}
export function lpPda(pool: PublicKey, programId = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("lp"), pool.toBuffer()], programId);
}
export function posPda(vote: PublicKey, programId = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("pos"), vote.toBuffer()], programId);
}
export function authPda(vote: PublicKey, programId = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("auth"), vote.toBuffer()], programId);
}
