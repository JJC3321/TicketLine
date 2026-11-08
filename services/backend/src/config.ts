import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../../..");

export const cfg = {
  port: Number(process.env.PORT ?? 8787),
  mainnetRpc: process.env.MAINNET_RPC_URL ?? process.env.HELIUS_MAINNET_URL ?? "https://api.mainnet-beta.solana.com",
  localnetRpc: process.env.LOCALNET_URL ?? "http://127.0.0.1:8899",
  localnetWs: process.env.LOCALNET_WS ?? "ws://127.0.0.1:8900",
  keysDir: process.env.KEYS_DIR ?? path.join(REPO_ROOT, ".localnet", "keys"),
  ticketLamports: BigInt(process.env.MAINNET_TICKET_LAMPORTS ?? "800000000"),
  snapshotPath: process.env.SNAPSHOT_PATH ?? path.join(REPO_ROOT, "data", "mainnet-snapshot.json"),
  scanIntervalMs: Number(process.env.SCAN_INTERVAL_MS ?? 600_000),
};
if (!path.isAbsolute(cfg.keysDir)) cfg.keysDir = path.resolve(REPO_ROOT, cfg.keysDir);
