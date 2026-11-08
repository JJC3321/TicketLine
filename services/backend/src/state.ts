import { AnchorProvider, Program, type Idl, type Wallet } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { idl as ticketlineIdl, PROGRAM_ID } from "@ticketline/sdk";
import { cfg } from "./config.ts";
import { loadKeys, type DemoKeys } from "./keys.ts";
import { authPda, parseVoteV4, poolPda, posPda } from "@ticketline/sdk";

export interface EpochRecord {
  epoch: number;
  balanceBefore: number;
  balanceAfterBurn: number;
  balanceAfterCommission: number;
  debt: number;
  admitted: boolean;
}

export class Demo {
  conn: Connection;
  keys!: DemoKeys;
  program!: Program<Idl>;
  provider!: AnchorProvider;

  // tracked state
  vote: PublicKey | null = null;   // bootstrap vote account
  enrolled = false;
  schedule: number[] = [300_000_000, 300_000_000, 300_000_000, 2_000_000_000]; // lamports/epoch
  commissionHistory: number[] = [];
  boundaryCount = 0;
  burnedThisEpoch: number | null = null;
  lastSeenEpoch = -1;
  keeperRunning = false;
  keeperTimer: ReturnType<typeof setInterval> | null = null;
  history: EpochRecord[] = [];
  counters = { topUps: 0, sweeps: 0, sweepsRepaid: 0n };
  exited = false;
  setupDone = false;
  recovering = false;
  inconsistent: string | null = null;

  constructor() {
    this.conn = new Connection(cfg.localnetRpc, "confirmed");
  }

  initKeys() {
    if (this.keys) return;
    this.keys = loadKeys();
    const kp = this.keys.keeper;
    const wallet: Wallet = {
      publicKey: kp.publicKey,
      async signTransaction<T extends Transaction | VersionedTransaction>(tx: T) {
        if (tx instanceof Transaction) tx.sign(kp); else tx.sign([kp]);
        return tx;
      },
      async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]) {
        for (const tx of txs) { if (tx instanceof Transaction) tx.sign(kp); else tx.sign([kp]); }
        return txs;
      },
      payer: kp,
    };
    this.provider = new AnchorProvider(this.conn, wallet, { commitment: "confirmed" });
    this.program = new Program(ticketlineIdl as Idl, this.provider);
    this.vote = this.keys.voteWithdrawer.publicKey; // bootstrap: vote account == its keypair
  }

  /** Reconstruct demo state from chain so a restart never breaks the demo. */
  async recover() {
    this.initKeys();
    const [pool] = poolPda();
    const poolAcct = await this.conn.getAccountInfo(pool);
    this.setupDone = !!poolAcct;
    this.inconsistent = null;
    if (!this.vote) return;
    const [pos] = posPda(this.vote);
    const posAcct = await this.conn.getAccountInfo(pos);
    const voteAcct = await this.conn.getAccountInfo(this.vote);
    if (posAcct) {
      this.enrolled = true;
      this.exited = false;
      const ei = await this.conn.getEpochInfo();
      this.lastSeenEpoch = ei.epoch;
      this.startKeeper();
    } else if (voteAcct) {
      try {
        const h = parseVoteV4(voteAcct.data);
        if (h.authorizedWithdrawer.equals(authPda(this.vote)[0])) {
          this.inconsistent =
            "vote withdrawer is the auth PDA but no position account exists — reset the ledger (pnpm demo:fresh) or re-enroll on-chain";
        }
      } catch { /* not a V4 account */ }
    }
  }

  reset() {
    this.stopKeeper();
    this.enrolled = false;
    this.exited = false;
    this.schedule = [300_000_000, 300_000_000, 300_000_000, 2_000_000_000];
    this.commissionHistory = [];
    this.boundaryCount = 0;
    this.burnedThisEpoch = null;
    this.lastSeenEpoch = -1;
    this.history = [];
    this.counters = { topUps: 0, sweeps: 0, sweepsRepaid: 0n };
    this.setupDone = false;
    this.inconsistent = null;
  }

  startKeeper() {
    if (this.keeperRunning) return;
    this.keeperRunning = true;
    this.keeperTimer = setInterval(() => {
      keeperTick(this).catch((e) => console.error("[keeper]", (e as Error).message));
    }, 1000);
  }
  stopKeeper() {
    this.keeperRunning = false;
    if (this.keeperTimer) clearInterval(this.keeperTimer);
    this.keeperTimer = null;
  }
}

import { keeperTick } from "./keeper.ts";

export const demo = new Demo();
export { PROGRAM_ID };
