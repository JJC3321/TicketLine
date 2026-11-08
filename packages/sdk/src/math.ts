// math.ts — mirrors programs/ticketline/src/math.rs
export function required(rent: bigint, pending: bigint, ticket: bigint, buffer: bigint): bigint {
  return rent + pending + ticket + buffer;
}
export function deficit(requiredLamports: bigint, lamports: bigint): bigint {
  return requiredLamports > lamports ? requiredLamports - lamports : 0n;
}
export function sweepable(lamports: bigint, requiredLamports: bigint): bigint {
  return lamports > requiredLamports ? lamports - requiredLamports : 0n;
}
/** ceil(amount * feeBps / 10_000) */
export function fee(amount: bigint, feeBps: number): bigint {
  return (amount * BigInt(feeBps) + 9999n) / 10000n;
}
export function sharesForDeposit(lamports: bigint, supply: bigint, poolValue: bigint): bigint {
  if (supply === 0n) return lamports;
  return (lamports * supply) / poolValue;
}
export function lamportsForWithdraw(shares: bigint, supply: bigint, poolValue: bigint): bigint {
  if (supply === 0n) throw new Error("supply=0");
  return (shares * poolValue) / supply;
}
export function poolValue(vaultAvailable: bigint, totalPrincipal: bigint): bigint {
  return vaultAvailable + totalPrincipal;
}
export function runwayEpochs(freeLamports: bigint, ticketLamports: bigint): number {
  if (freeLamports <= 0n) return 0;
  return Number(freeLamports / ticketLamports);
}
