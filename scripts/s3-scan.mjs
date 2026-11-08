const RPC = "https://api.mainnet-beta.solana.com";
let id = 0;
async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(method + ": " + JSON.stringify(j.error));
  return j.result;
}
const va = await rpc("getVoteAccounts", []);
const all = [...va.current, ...va.delinquent];
console.log("current:", va.current.length, "delinquent:", va.delinquent.length, "total:", all.length);
const pubkeys = all.map(v => v.votePubkey);
// batched getMultipleAccounts
const infos = [];
for (let i = 0; i < pubkeys.length; i += 100) {
  const res = await rpc("getMultipleAccounts", [pubkeys.slice(i, i + 100), { encoding: "base64" }]);
  infos.push(...res.value);
  if (i % 500 === 0) console.error("fetched", i);
}
function parseV4(b) {
  if (b.length < 145) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.length);
  if (dv.getUint32(0, true) !== 3) return null;
  const b58 = (o) => {
    // base58 encode 32 bytes
    const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let d = [], s = "";
    for (let i = 0; i < 32; i++) {
      let c = b[o + i], j = 0;
      for (; c || j < d.length; j++) { c += (d[j] || 0) << 8; d[j] = c % 58; c = (c / 58) | 0; }
    }
    for (let k = 0; k < 32 && b[o + k] === 0; k++) s += "1";
    return s + d.reverse().map(x => A[x]).join("");
  };
  return {
    node: b58(4), withdrawer: b58(36), collector: b58(68),
    pending: dv.getBigUint64(136, true), blsTag: b[144],
  };
}
const lens = {}; let v4 = 0, bls = 0, unpar = 0;
const rows = [];
const fixtures = [];
for (let i = 0; i < all.length; i++) {
  const a = infos[i];
  if (!a) { unpar++; continue; }
  const b = Buffer.from(a.data[0], "base64");
  lens[b.length] = (lens[b.length] || 0) + 1;
  const p = parseV4(b);
  if (!p) { unpar++; continue; }
  v4++;
  if (p.blsTag === 1) bls++;
  rows.push({ pk: pubkeys[i], lamports: a.lamports, len: b.length, pending: Number(p.pending), bls: p.blsTag === 1, withdrawer: p.withdrawer });
  if (fixtures.length < 3 && a.lamports > 1e9) fixtures.push({ pubkey: pubkeys[i], lamports: a.lamports, owner: a.owner, data_len: b.length, base64: a.data[0] });
}
const rent = await rpc("getMinimumBalanceForRentExemption", [3762]);
console.log("rent-exempt for 3762:", rent, "=", rent / 1e9, "SOL");
const TICKET = 0.8e9;
let lt08 = 0, lt16 = 0;
const pendings = [];
for (const r of rows) {
  const free = r.lamports - r.pending - rent;
  r.free = free;
  if (free < TICKET) lt08++;
  if (free < 1.6e9) lt16++;
  pendings.push(r.pending);
}
pendings.sort((a, b) => a - b);
const q = (p) => pendings[Math.floor(p * pendings.length)];
console.log("V4 parsed:", v4, "/", rows.length + unpar, "unparsed:", unpar);
console.log("with BLS:", bls, `(${(100 * bls / v4).toFixed(1)}%)`);
console.log("data lengths:", lens);
console.log("pending rewards: min", q(0), "p50", q(0.5), "p90", q(0.9), "p99", q(0.99), "max", pendings[pendings.length - 1]);
console.log("free<0.8SOL:", lt08, " free<1.6SOL:", lt16);
// fixtures: also grab jsonParsed for the same 3
const fpks = fixtures.map(f => f.pubkey);
const jp = await rpc("getMultipleAccounts", [fpks, { encoding: "jsonParsed" }]);
fixtures.forEach((f, i) => f.jsonParsed = jp.value[i] ? jp.value[i].parsed : null);
const fs = await import("fs");
fs.writeFileSync("/root/solanaHack/data/fixtures/vote-accounts.json", JSON.stringify(fixtures, null, 2));
fs.writeFileSync("/root/solanaHack/data/fixtures/s3-summary.json", JSON.stringify({ total: all.length, v4, bls, lt08, lt16, rent, lens }, null, 2));
// getInflationReward test
try {
  const epochInfo = await rpc("getEpochInfo", []);
  const sample = pubkeys.slice(0, 50);
  const t0 = Date.now();
  const rew = await rpc("getInflationReward", [sample, { epoch: epochInfo.epoch - 1 }]);
  const n = rew.filter(Boolean).length;
  console.log(`getInflationReward epoch ${epochInfo.epoch - 1}: ${n}/50 returned in ${Date.now() - t0}ms; sample:`,
    rew.find(Boolean));
} catch (e) { console.log("getInflationReward FAILED:", e.message); }
