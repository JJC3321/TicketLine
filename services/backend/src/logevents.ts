// Parses "Program data: <b64>" lines into Anchor events using the IDL.
import { createHash } from "node:crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import { idl as ticketlineIdl, PROGRAM_ID } from "@ticketline/sdk";
import { bus } from "./events.ts";

type IdlField = { name: string; type: unknown };
const eventMap = new Map<string, { name: string; fields: IdlField[] }>();
for (const ev of (ticketlineIdl as unknown as { events: { name: string; discriminator: number[] }[] }).events ?? []) {
  const defined = (ticketlineIdl as unknown as { types: { name: string; type: { kind: string; fields: IdlField[] } }[] })
    .types.find((t) => t.name === ev.name);
  if (!defined) continue;
  const disc = createHash("sha256").update(`event:${ev.name}`).digest().subarray(0, 8);
  eventMap.set(disc.toString("hex"), { name: ev.name, fields: defined.type.fields });
}

function readField(buf: Buffer, off: number, ty: unknown): [unknown, number] {
  const t = typeof ty === "string" ? ty : (ty as Record<string, unknown>);
  if (t === "pubkey") return [new PublicKey(buf.subarray(off, off + 32)).toBase58(), off + 32];
  if (t === "u64") return [buf.readBigUInt64LE(off).toString(), off + 8];
  if (t === "i64") return [buf.readBigInt64LE(off).toString(), off + 8];
  if (t === "u32") return [buf.readUInt32LE(off), off + 4];
  if (t === "u16") return [buf.readUInt16LE(off), off + 2];
  if (t === "u8") return [buf.readUInt8(off), off + 1];
  if (t === "bool") return [buf.readUInt8(off) === 1, off + 1];
  return ["<unparsed>", off];
}

export function decodeEvent(b64: string): { name: string; data: Record<string, unknown> } | null {
  const buf = Buffer.from(b64, "base64");
  const ev = eventMap.get(buf.subarray(0, 8).toString("hex"));
  if (!ev) return null;
  const data: Record<string, unknown> = {};
  let off = 8;
  for (const f of ev.fields) {
    const [v, o] = readField(buf, off, f.type);
    data[f.name] = v;
    off = o;
  }
  return { name: ev.name, data };
}

export function subscribeProgramLogs(conn: Connection) {
  conn.onLogs(PROGRAM_ID, (logs) => {
    for (const line of logs.logs) {
      if (line.startsWith("Program data:")) {
        const ev = decodeEvent(line.slice(14).trim());
        if (ev) bus.programEvent(ev.name, logs.signature, ev.data);
      }
    }
  }, "confirmed");
}
