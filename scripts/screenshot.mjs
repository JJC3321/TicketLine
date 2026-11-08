import { chromium } from "playwright";
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1500, height: 1000 } });
for (const [name, url] of [["home","http://localhost:3000/"],["pool","http://localhost:3000/pool"],["demo","http://localhost:3000/demo"]]) {
  await pg.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch(()=>{});
  await pg.waitForTimeout(2500);
  await pg.screenshot({ path: `/root/solanaHack/.localnet/screens/${name}.png`, fullPage: true });
  console.log("shot", name);
}
await b.close();
