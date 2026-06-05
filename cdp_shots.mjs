// Headless screenshots for the README. Drives Chrome-for-Testing (puppeteer cache)
// via CDP, waits on MapLibre 'idle' so every frame is fully tile-loaded.
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import WebSocket from "ws";

const CHROME =
  "/Users/drexonindustries/.cache/puppeteer/chrome/mac_arm-147.0.7727.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PORT = 9344;
const OUT = "/Users/drexonindustries/mil-tracker/public/shots";
mkdirSync(OUT, { recursive: true });

const chrome = spawn(
  CHROME,
  ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-first-run", "--no-default-browser-check",
   "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--hide-scrollbars",
   "--window-size=1440,900", "--user-data-dir=/tmp/obs_shots", "about:blank"],
  { stdio: "ignore" }
);
const die = (m, c = 1) => { try { chrome.kill("SIGKILL"); } catch {} console.log(m); process.exit(c); };
const hard = setTimeout(() => die("TIMEOUT", 2), 150000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const l = await (await fetch(`http://localhost:${PORT}/json`)).json();
      const p = l.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("no devtools target");
}

(async () => {
  const ws = new WebSocket(await wsUrl());
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on("message", (b) => { const m = JSON.parse(b.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
  await new Promise((r) => ws.on("open", r));
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  const ev = (e) => send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });

  async function waitReady() {
    for (let i = 0; i < 40; i++) {
      await sleep(1000);
      const r = await ev(`(document.getElementById("c-bases")||{}).textContent`);
      if (r?.result?.value && r.result.value !== "—") return;
    }
  }
  const waitIdle = (cap = 9000) =>
    ev(`new Promise(res => { let done=false; const f=()=>{if(!done){done=true;res(true);}}; map.once('idle', f); map.triggerRepaint(); setTimeout(f, ${cap}); })`);

  async function shot(name) {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(`${OUT}/${name}`, Buffer.from(r.data, "base64"));
    console.log("  saved", name);
  }
  async function go(url) {
    await send("Page.navigate", { url });
    await waitReady();
    await waitIdle();
    await sleep(1200);
    await waitIdle();
  }

  // 1) HERO — tactical HUD over Europe: live aircraft + bases + borders
  console.log("shot 1: tactical hero");
  await go("http://localhost:8080/?lat=47&lon=15&z=4.1");
  await sleep(800);
  await shot("01-tactical.png");

  // 2) SATELLITE — Esri/Maxar imagery zoomed onto a major airbase
  console.log("shot 2: satellite");
  await go("http://localhost:8080/?bm=satellite&lat=49.4369&lon=7.6003&z=13");
  await waitIdle(12000); // raster imagery can be slow
  await sleep(1500);
  await shot("02-satellite.png");

  // 3) EVENTS — GDELT conflict hotspots + a source-news popup
  console.log("shot 3: live events + news popup");
  await go("http://localhost:8080/?lat=33&lon=40&z=4");
  await ev(`(() => { const c=document.getElementById('t-events'); if(!c.checked){c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true}));} })()`);
  for (let i = 0; i < 25; i++) { // wait for GDELT fetch to populate
    await sleep(1000);
    const r = await ev(`(document.getElementById('c-events')||{}).textContent`);
    if (r?.result?.value && r.result.value !== "—" && r.result.value !== "0") break;
  }
  await waitIdle();
  // center on the densest hotspot, then real-click it to open the news popup
  const top = (await ev(`(() => {
    const f = map.querySourceFeatures('events').filter(x=>x.properties && x.properties.count);
    if(!f.length) return null;
    f.sort((a,b)=> (b.properties.count|0)-(a.properties.count|0));
    const g = f[0].geometry.coordinates; return { lon:g[0], lat:g[1], count:f[0].properties.count };
  })()`)).result.value;
  if (top) {
    await ev(`map.jumpTo({ center:[${top.lon},${top.lat}], zoom:4.6 })`);
    await waitIdle();
    await sleep(600);
    const px = (await ev(`(() => { const p = map.project([${top.lon},${top.lat}]); return {x:Math.round(p.x), y:Math.round(p.y)}; })()`)).result.value;
    for (const type of ["mousePressed", "mouseReleased"])
      await send("Input.dispatchMouseEvent", { type, x: px.x, y: px.y, button: "left", clickCount: 1 });
    await sleep(900);
  }
  await shot("03-events.png");

  clearTimeout(hard);
  die("DONE", 0);
})().catch((e) => die("FAIL: " + e.message, 1));
