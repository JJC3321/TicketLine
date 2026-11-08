import { chromium } from "playwright";
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1500, height: 1000 } });
await pg.goto("http://localhost:3000/pool", { waitUntil: "networkidle", timeout: 45000 }).catch(()=>{});
await pg.waitForTimeout(3000);
console.log("TEXT:", (await pg.textContent("body")).slice(0, 300));
await pg.screenshot({ path: "/root/solanaHack/.localnet/screens/pool.png", fullPage: true });
await b.close();
