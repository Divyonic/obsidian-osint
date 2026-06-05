import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import WebSocket from "ws";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9337;
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-first-run", "--no-default-browser-check",
  "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--hide-scrollbars", "--window-size=1440,900",
  "--user-data-dir=/tmp/veng_verify", "about:blank"], { stdio: "ignore" });
const die = (m, c = 1) => { try { chrome.kill("SIGKILL"); } catch {} console.log(m); process.exit(c); };
const hard = setTimeout(() => die("TIMEOUT", 2), 55000);
async function ws_url() { for (let i = 0; i < 30; i++) { try { const l = await (await fetch(`http://localhost:${PORT}/json`)).json(); const p = l.find(t => t.type === "page" && t.webSocketDebuggerUrl); if (p) return p.webSocketDebuggerUrl; } catch {} await new Promise(r => setTimeout(r, 250)); } throw new Error("no target"); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const ws = new WebSocket(await ws_url()); let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on("message", b => { const m = JSON.parse(b.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
  await new Promise(r => ws.on("open", r));
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await send("Page.navigate", { url: "http://localhost:8080/" });
  const ev = e => send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  for (let i = 0; i < 30; i++) { await sleep(1000); const r = await ev(`(document.getElementById("c-bases")||{}).textContent`); if (r?.result?.value && r.result.value !== "—") break; }
  await sleep(1500);
  // zoom to a country so individual base points + borders show
  await ev(`map.jumpTo({ center: [44, 33], zoom: 5 })`); await sleep(2500);
  const info = (await ev(`(() => {
    const feats = map.querySourceFeatures("bases").filter(f=>f.properties && !f.properties.cluster);
    const withCountry = feats.filter(f=>f.properties.country).length;
    const sample = feats.slice(0,3).map(f=>({name:f.properties.name, country:f.properties.country, cc:f.properties.cc}));
    const bordersLoaded = !!(map.getSource("borders") && map.style.getOwnLayer ? true : map.getLayer("borders-line"));
    const borderFeats = map.querySourceFeatures("borders").length;
    return { renderedBasePts: feats.length, withCountry, sample, hasBordersLayer: !!map.getLayer("borders-line"), borderFeats, countriesInFilter: document.getElementById("country-filter").options.length };
  })()`)).result.value;
  const shot = async (name, clip) => { const r = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip } : {}) }); writeFileSync(name, Buffer.from(r.data, "base64")); };
  await shot("/tmp/obs_panel.png", { x: 0, y: 0, width: 340, height: 230, scale: 2 });
  await shot("/tmp/obs_map.png");
  clearTimeout(hard);
  console.log("VERIFY:", JSON.stringify(info, null, 2));
  die("DONE", 0);
})().catch(e => die("FAIL: " + e.message, 1));
