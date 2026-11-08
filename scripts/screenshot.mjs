// Screenshots that FAIL on blank pages: waits for real content selectors.
import { chromium } from "playwright";
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1500, height: 1000 } });
const shots = [
  ["home", "http://localhost:3000/", "tbody tr td"],
  ["pool", "http://localhost:3000/pool", "text=Pool value"],
  ["demo", "http://localhost:3000/demo", "text=Events"],
];
let fail = false;
for (const [name, url, sel] of shots) {
  try {
    await pg.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await pg.waitForSelector(sel, { timeout: 30000 });
    await pg.waitForTimeout(2500);
    const path = `/root/solanaHack/.localnet/screens/${name}.png`;
    await pg.screenshot({ path, fullPage: true });
    const { size } = (await import("node:fs")).statSync(path);
    if (size < 20_000) { console.error(`FAIL ${name}: screenshot too small (${size}b) — likely blank`); fail = true; }
    else console.log(`shot ${name} ${(size/1024).toFixed(0)}KB`);
  } catch (e) { console.error(`FAIL ${name}: ${e.message.split("\n")[0]}`); fail = true; }
}
await b.close();
process.exit(fail ? 1 : 0);
