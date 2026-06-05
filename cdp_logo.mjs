// Convert the white-on-black MENACE JPEG into a transparent PNG using a
// headless-Chrome canvas: alpha = pixel luminance, RGB forced white so the
// wordmark is clean white with smooth anti-aliased edges and no background.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import WebSocket from "ws";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9336;
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--no-default-browser-check",
  "--user-data-dir=/tmp/veng_logo", "about:blank",
], { stdio: "ignore" });
const die = (m, c = 1) => { try { chrome.kill("SIGKILL"); } catch {} console.log(m); process.exit(c); };
const hard = setTimeout(() => die("LOGO_TIMEOUT", 2), 30000);

async function getWsUrl() {
  for (let i = 0; i < 30; i++) {
    try { const l = await (await fetch(`http://localhost:${PORT}/json`)).json();
      const p = l.find(t => t.type === "page" && t.webSocketDebuggerUrl); if (p) return p.webSocketDebuggerUrl; } catch {}
    await new Promise(r => setTimeout(r, 250));
  } throw new Error("no page target");
}

(async () => {
  const ws = new WebSocket(await getWsUrl());
  let id = 0; const pend = new Map();
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.on("message", b => { const m = JSON.parse(b.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
  await new Promise(r => ws.on("open", r));
  await send("Runtime.enable"); await send("Page.enable");
  await send("Page.navigate", { url: "http://localhost:8080/" });
  await new Promise(r => setTimeout(r, 1500));

  const r = await send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `(async () => {
    const bmp = await fetch('/menace-logo.jpg').then(r => r.blob()).then(createImageBitmap);
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const cx = cv.getContext('2d');
    cx.drawImage(bmp, 0, 0);
    const W = cv.width, H = cv.height;
    const im = cx.getImageData(0, 0, W, H);
    const d = im.data;
    const colCount = new Array(W).fill(0), rowCount = new Array(H).fill(0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const lum = Math.max(d[i], d[i+1], d[i+2]); // white text high, black bg ~0
      d[i] = 255; d[i+1] = 255; d[i+2] = 255;      // force pure white
      d[i+3] = lum;                                 // luminance -> alpha
      if (lum > 110) { colCount[x]++; rowCount[y]++; }
    }
    cx.putImageData(im, 0, 0);
    // Longest contiguous run of "active" lines = the wordmark; discards thin
    // edge artifacts that are separated from the text by empty space.
    const longestRun = (counts, thresh) => {
      let bs = 0, be = -1, cs = -1;
      for (let i = 0; i <= counts.length; i++) {
        const on = i < counts.length && counts[i] > thresh;
        if (on && cs < 0) cs = i;
        if (!on && cs >= 0) { if (i - 1 - cs > be - bs) { bs = cs; be = i - 1; } cs = -1; }
      }
      return [bs, be];
    };
    const [minX, maxX] = longestRun(colCount, Math.max(3, H * 0.03));
    const [minY, maxY] = longestRun(rowCount, Math.max(3, W * 0.02));
    const pad = Math.round((maxY - minY) * 0.18);
    const cropX = Math.max(0, minX - pad), cropY = Math.max(0, minY - pad);
    const cropW = Math.min(W, maxX + pad) - cropX, cropH = Math.min(H, maxY + pad) - cropY;
    const enc = async (canvas) => {
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const u = new Uint8Array(await blob.arrayBuffer());
      let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
      return btoa(s);
    };
    const out = new OffscreenCanvas(cropW, cropH);
    out.getContext('2d').drawImage(cv, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    // dark-bg preview so we can eyeball it
    const pv = new OffscreenCanvas(cropW, cropH);
    const px = pv.getContext('2d'); px.fillStyle = '#1c1c1e'; px.fillRect(0, 0, cropW, cropH);
    px.drawImage(out, 0, 0);
    return { logo: await enc(out), preview: await enc(pv), box: [cropW, cropH] };
  })()` });
  const v = r?.result?.value;
  if (!v || !v.logo) die("LOGO_FAIL: no data (" + JSON.stringify(r).slice(0, 200) + ")", 1);
  writeFileSync("public/menace-logo.png", Buffer.from(v.logo, "base64"));
  writeFileSync("/tmp/menace_preview.png", Buffer.from(v.preview, "base64"));
  clearTimeout(hard);
  die("LOGO_DONE box=" + v.box.join("x") + " bytes=" + Buffer.from(v.logo, "base64").length, 0);
})().catch(e => die("LOGO_FAIL: " + e.message, 1));
