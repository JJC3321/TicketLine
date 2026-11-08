import { describe, expect, it } from "vitest";
import { anchorErrorName } from "../src/errdecode.ts";

describe("anchorErrorName", () => {
  it("decodes verbose 'Error Code: X' log form", () => {
    const e = new Error(
      'FailedTransactionMetadata { logs: ["Program log: AnchorError occurred. Error Code: AlreadyToppedUpThisEpoch. Error Number: 6009."] }',
    );
    expect(anchorErrorName(e)).toBe("AlreadyToppedUpThisEpoch");
  });
  it("decodes web3.js preflight 'custom program error: 0x177N' numeric form", () => {
    const e = new Error("Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1780");
    expect(anchorErrorName(e)).toBe("InsufficientHeadroom"); // 6016
    const e2 = new Error("Transaction simulation failed: Error processing Instruction 0: custom program error: 0x177a");
    expect(anchorErrorName(e2)).toBe("AlreadyToppedUpThisEpoch"); // 6009
  });
  it("falls back to custom:N for unknown codes", () => {
    expect(anchorErrorName(new Error("custom program error: 0x9999"))).toBe("custom:39321");
  });
  it("matches plain embedded names", () => {
    expect(anchorErrorName(new Error("NothingToSweep"))).toBe("NothingToSweep");
  });
  it("returns null for non-program errors", () => {
    expect(anchorErrorName(new Error("fetch failed"))).toBeNull();
  });
});
