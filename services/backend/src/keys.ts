import fs from "node:fs";
import path from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { cfg } from "./config.ts";

export interface DemoKeys {
  admin: Keypair;      // pool admin + oracle
  lenderA: Keypair;
  lenderB: Keypair;
  rewards: Keypair;    // source of simulated commission
  keeper: Keypair;     // pays for keeper txs
  identity: Keypair;   // bootstrap validator identity (copied by localnet.sh)
  voteWithdrawer: Keypair; // bootstrap vote account withdrawer (copied by localnet.sh)
}

function loadOrCreate(dir: string, name: string): Keypair {
  const p = path.join(dir, `${name}.json`);
  if (fs.existsSync(p)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
  const k = Keypair.generate();
  fs.writeFileSync(p, JSON.stringify(Array.from(k.secretKey)));
  return k;
}

function loadRequired(dir: string, name: string): Keypair | null {
  const p = path.join(dir, `${name}.json`);
  if (!fs.existsSync(p)) return null;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

export function loadKeys(): DemoKeys {
  const dir = cfg.keysDir;
  fs.mkdirSync(dir, { recursive: true });
  const identity = loadRequired(dir, "identity");
  const voteWithdrawer = loadRequired(dir, "vote-withdrawer");
  if (!identity || !voteWithdrawer) {
    throw new Error("identity/vote-withdrawer keypairs missing — run scripts/localnet.sh first");
  }
  return {
    admin: loadOrCreate(dir, "admin"),
    lenderA: loadOrCreate(dir, "lender-a"),
    lenderB: loadOrCreate(dir, "lender-b"),
    rewards: loadOrCreate(dir, "rewards"),
    keeper: loadOrCreate(dir, "keeper"),
    identity,
    voteWithdrawer,
  };
}

export async function ensureFunded(conn: Connection, keys: DemoKeys): Promise<void> {
  for (const [name, k] of Object.entries({
    admin: keys.admin, lenderA: keys.lenderA, lenderB: keys.lenderB,
    rewards: keys.rewards, keeper: keys.keeper,
  })) {
    const bal = await conn.getBalance(k.publicKey);
    if (bal < 50 * LAMPORTS_PER_SOL) {
      const sig = await conn.requestAirdrop(k.publicKey, 100 * LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig);
      console.log(`airdropped 100 SOL to ${name}`);
    }
  }
}
