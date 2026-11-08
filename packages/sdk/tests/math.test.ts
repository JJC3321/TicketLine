// parity with programs/ticketline/src/math.rs unit tests
import { describe, expect, it } from "vitest";
import { deficit, fee, lamportsForWithdraw, required, runwayEpochs, sharesForDeposit, sweepable } from "../src/math.ts";

it("required/deficit/sweepable", () => {
  const r = required(1000n, 2000n, 3000n, 4000n);
  expect(r).toBe(10000n);
  expect(deficit(r, 4000n)).toBe(6000n);
  expect(deficit(r, 12000n)).toBe(0n);
  expect(sweepable(15000n, r)).toBe(5000n);
  expect(sweepable(9000n, r)).toBe(0n);
});

it("fee rounds up", () => {
  expect(fee(1_000_000_000n, 150)).toBe(15_000_000n);
  expect(fee(1n, 1)).toBe(1n);
  expect(fee(10_000n, 1)).toBe(1n);
  expect(fee(0n, 150)).toBe(0n);
});

it("share math", () => {
  expect(sharesForDeposit(1000n, 0n, 0n)).toBe(1000n);
  expect(sharesForDeposit(500n, 1000n, 1000n)).toBe(500n);
  expect(lamportsForWithdraw(1n, 3n, 10n)).toBe(3n);
  expect(lamportsForWithdraw(500n, 1500n, 3000n)).toBe(1000n);
});

it("runway", () => {
  expect(runwayEpochs(800_000_000n, 800_000_000n)).toBe(1);
  expect(runwayEpochs(1_599_999_999n, 800_000_000n)).toBe(1);
  expect(runwayEpochs(-5n, 800_000_000n)).toBe(0);
});
