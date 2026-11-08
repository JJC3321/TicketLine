import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { authorizeWithdrawerData, parseVoteV4, withdrawData } from "../src/vote.ts";
import { PublicKey } from "@solana/web3.js";

const fixtures = JSON.parse(
  readFileSync(new URL("../../../data/fixtures/vote-accounts.json", import.meta.url), "utf8"),
);

describe("V4 parser vs mainnet fixtures", () => {
  for (const f of fixtures) {
    it(`parses ${f.pubkey.slice(0, 8)}…`, () => {
      const b = Buffer.from(f.base64, "base64");
      const h = parseVoteV4(b);
      const info = f.jsonParsed.info;
      expect(h.nodePubkey.toBase58()).toBe(info.nodePubkey);
      expect(h.authorizedWithdrawer.toBase58()).toBe(info.authorizedWithdrawer);
      expect(h.inflationRewardsCollector.toBase58()).toBe(info.inflationRewardsCollector);
      expect(h.blockRevenueCollector.toBase58()).toBe(info.blockRevenueCollector);
      expect(h.inflationRewardsCommissionBps).toBe(info.inflationRewardsCommissionBps);
      expect(h.blockRevenueCommissionBps).toBe(info.blockRevenueCommissionBps);
      expect(h.pendingDelegatorRewards).toBe(BigInt(info.pendingDelegatorRewards ?? 0));
      expect(h.hasBls).toBe(!!info.blsPubkeyCompressed);
      expect(b.length).toBe(f.data_len);
    });
  }
  it("rejects tag != 3 and short data", () => {
    const b = Buffer.from(fixtures[0].base64, "base64");
    expect(() => parseVoteV4(b.subarray(0, 144))).toThrow();
    b[0] = 2;
    expect(() => parseVoteV4(b)).toThrow();
  });
});

describe("vote ix encodings (plan §5.2)", () => {
  it("withdraw", () => {
    const d = withdrawData(123456789n);
    expect([...d.subarray(0, 4)]).toEqual([3, 0, 0, 0]);
    expect(d.readBigUInt64LE(4)).toBe(123456789n);
  });
  it("authorize withdrawer", () => {
    const pk = PublicKey.unique();
    const d = authorizeWithdrawerData(pk);
    expect([...d.subarray(0, 4)]).toEqual([1, 0, 0, 0]);
    expect(new PublicKey(d.subarray(4, 36)).equals(pk)).toBe(true);
    expect([...d.subarray(36, 40)]).toEqual([1, 0, 0, 0]);
  });
});
