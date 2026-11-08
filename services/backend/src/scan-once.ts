import { scanMainnet } from "./scanner.ts";
const s = await scanMainnet();
const c = s.summary.counts;
console.log(`epoch=${s.epoch} slot=${s.slot} accounts=${s.summary.total}`);
console.log(`SAFE=${c.SAFE} WATCH=${c.WATCH} AT_RISK=${c.AT_RISK} NO_BLS=${c.NO_BLS}`);
console.log(`stakeAtRisk=${s.summary.stakeAtRisk} eligible=${s.summary.eligibleCount} cutoffBinding=${s.summary.cutoffBinding}`);
const top = s.accounts.filter((a) => a.status !== "SAFE").slice(0, 10);
for (const a of top) {
  console.log(`  ${a.status.padEnd(7)} runway=${a.runwayEpochs} free=${(Number(a.freeLamports) / 1e9).toFixed(2)}SOL avgComm=${(Number(a.avgCommissionLamports) / 1e9).toFixed(3)} ${a.votePubkey}`);
}
