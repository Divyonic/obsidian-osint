// Assign a country to every base via point-in-polygon against OSM-derived 1m
// boundaries (simonepri/geo-maps). OSM-sourced so disputed borders (India/
// Pakistan/China, Crimea, etc.) match exactly how OSM — and our base data —
// depict them. A3 codes are mapped to display names + ISO-A2 via Natural Earth.
import { readFileSync, writeFileSync } from "node:fs";

const OSM = JSON.parse(readFileSync("data/osm_1m.geojson", "utf8"));
const NE = JSON.parse(readFileSync("data/ne_10m.geojson", "utf8"));
const BASES = JSON.parse(readFileSync("public/bases_global.geojson", "utf8"));

// A3 (ISO alpha-3) -> { name, a2 }. Index NE by every A3-ish field it carries.
const A3 = {};
for (const f of NE.features) {
  const p = f.properties;
  const name = p.ADMIN || p.NAME || p.SOVEREIGNT;
  const valid2 = (s) => (s && /^[A-Za-z]{2}$/.test(s) ? s.toUpperCase() : "");
  const a2 = valid2(p.ISO_A2) || valid2(p.ISO_A2_EH) || "";
  for (const code of [p.ADM0_A3, p.ISO_A3, p.ISO_A3_EH, p.SOV_A3, p.GU_A3, p.BRK_A3]) {
    if (code && code !== "-99" && !A3[code]) A3[code] = { name, a2 };
  }
}
// A few codes the OSM set uses that NE labels differently / not at all.
const FALLBACK = { KOS: { name: "Kosovo", a2: "XK" }, SAH: { name: "Western Sahara", a2: "EH" }, PSX: { name: "Palestine", a2: "PS" }, CYN: { name: "Northern Cyprus", a2: "" }, SOL: { name: "Somaliland", a2: "" }, ATC: { name: "Ashmore and Cartier Is.", a2: "" } };
const nameFor = (a3) => A3[a3] || FALLBACK[a3] || { name: a3, a2: "" };

// Precompute per-country polygon entries with outer-ring bbox for fast rejection.
const countries = OSM.features.map((f) => {
  const info = nameFor(f.properties.A3);
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  const entries = polys.map((rings) => {
    let minX = 180, minY = 90, maxX = -180, maxY = -90;
    for (const [x, y] of rings[0]) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    return { rings, bbox: [minX, minY, maxX, maxY] };
  });
  return { name: info.name, cc: info.a2, entries };
});

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function inPoly(x, y, rings) {
  if (!inRing(x, y, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) if (inRing(x, y, rings[h])) return false;
  return true;
}
function countryOf(x, y) {
  for (const c of countries) for (const e of c.entries) {
    const [minX, minY, maxX, maxY] = e.bbox;
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    if (inPoly(x, y, e.rings)) return c;
  }
  return null;
}
// Coastal/island points just outside the 1m coastline snap to the nearest land.
function nearestCountry(x, y, tol) {
  let best = null, bestD = tol * tol;
  for (const c of countries) for (const e of c.entries) {
    const [minX, minY, maxX, maxY] = e.bbox;
    if (x < minX - tol || x > maxX + tol || y < minY - tol || y > maxY + tol) continue;
    for (const ring of e.rings) for (let i = 0; i < ring.length; i++) {
      const dx = ring[i][0] - x, dy = ring[i][1] - y, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = c; }
    }
  }
  return best;
}

let hit = 0, miss = 0, snapped = 0;
const t0 = Date.now();
for (const f of BASES.features) {
  const c = f.geometry && f.geometry.coordinates;
  if (!c) { miss++; continue; }
  let found = countryOf(c[0], c[1]);
  if (!found) { found = nearestCountry(c[0], c[1], 0.2); if (found) snapped++; }
  if (found) {
    f.properties.country = found.name;
    if (found.cc) f.properties.cc = found.cc; else delete f.properties.cc;
    hit++;
  } else { delete f.properties.country; delete f.properties.cc; miss++; }
}

const roster = {};
for (const f of BASES.features) { const n = f.properties.country; if (n) roster[n] = (roster[n] || 0) + 1; }
const sorted = Object.entries(roster).sort((a, b) => b[1] - a[1]);

writeFileSync("public/bases_global.geojson", JSON.stringify(BASES));
console.log(`assigned ${hit}/${BASES.features.length} (${snapped} coast-snapped, ${miss} unresolved) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`countries: ${sorted.length} · top 12: ${sorted.slice(0, 12).map(([n, c]) => n + " " + c).join(" · ")}`);
