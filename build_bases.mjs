/* One-time builder: scrape global military installations from OpenStreetMap
 * (Overpass), dedupe, tag an importance score, and write a compact GeoJSON
 * the front-end preloads once and clusters client-side.
 *
 *   node build_bases.mjs            # full world build → public/bases_global.geojson
 *
 * Bases don't move, so this is run rarely. The output is a static asset.       */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "public", "bases_global.geojson");

const MIRRORS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

// 15° grid, skipping empty polar bands. 24 lon × 9 lat = 216 tiles.
const STEP = 15, LAT0 = -60, LAT1 = 75, LON0 = -180, LON1 = 180;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tileQuery(s, w, n, e) {
  const bb = `(${s},${w},${n},${e})`;
  return `[out:json][timeout:80];
( way["landuse"="military"]${bb};
  relation["landuse"="military"]${bb};
  node["military"]${bb};
  way["military"]${bb};
  node["aeroway"="aerodrome"]["military"="airfield"]${bb};
);
out center tags 3000;`;
}

async function fetchTile(q, idx) {
  for (let attempt = 0; attempt < MIRRORS.length * 2; attempt++) {
    const url = MIRRORS[attempt % MIRRORS.length];
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 90000);
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "ObsidianTracker/0.4 (OSINT GIS build)" },
        body: "data=" + encodeURIComponent(q),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!r.ok) { await sleep(1500); continue; }
      const j = await r.json();
      return j.elements || [];
    } catch (e) { await sleep(1500); }
  }
  return null; // tile failed all mirrors
}

// Importance score (1-5) from OSM tags — drives marker size at street zoom.
function scoreOf(t) {
  const m = (t.military || "").toLowerCase();
  const lu = (t.landuse || "").toLowerCase();
  if (/air|naval_base|harbour|airfield/.test(m) || t.aeroway) return 4;
  if (/naval|base|barracks|depot|ammunition|range|nuclear/.test(m)) return 3;
  if (lu === "military" || /training_area|danger_area|exercise/.test(m)) return 2;
  return 1;
}
function kindOf(t) { return t.military || t.landuse || "military"; }
function nameOf(t) { return t.name || t["name:en"] || t.military || t.landuse || "Military area"; }

async function run() {
  const seen = new Map(); // "type/id" -> feature
  const tiles = [];
  for (let lat = LAT0; lat < LAT1; lat += STEP)
    for (let lon = LON0; lon < LON1; lon += STEP)
      tiles.push([lat, lon, Math.min(lat + STEP, LAT1), Math.min(lon + STEP, LON1)]);

  let done = 0, failed = 0;
  const CONCURRENCY = 4;
  for (let i = 0; i < tiles.length; i += CONCURRENCY) {
    const batch = tiles.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(([s, w, n, e], k) => fetchTile(tileQuery(s, w, n, e), i + k)));
    for (const els of results) {
      done++;
      if (els == null) { failed++; continue; }
      for (const el of els) {
        const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
        if (lat == null || lon == null) continue;
        const key = `${el.type}/${el.id}`;
        if (seen.has(key)) continue;
        const t = el.tags || {};
        seen.set(key, {
          type: "Feature",
          geometry: { type: "Point", coordinates: [+lon.toFixed(4), +lat.toFixed(4)] },
          properties: { name: nameOf(t), kind: kindOf(t), imp: scoreOf(t) },
        });
      }
    }
    process.stdout.write(`\r  tiles ${done}/${tiles.length}  features ${seen.size}  failed ${failed}   `);
  }

  // Fold in curated bases (authoritative names/importance), deduped by ~proximity.
  const curatedPath = join(__dirname, "public", "major_bases.geojson");
  if (existsSync(curatedPath)) {
    const cur = JSON.parse(readFileSync(curatedPath, "utf8")).features || [];
    const occupied = new Set([...seen.values()].map((f) => f.geometry.coordinates.map((c) => c.toFixed(1)).join(",")));
    for (const f of cur) {
      const k = f.geometry.coordinates.map((c) => c.toFixed(1)).join(",");
      if (occupied.has(k)) continue; // already represented nearby
      seen.set(`curated/${f.properties.name}`, {
        type: "Feature", geometry: f.geometry,
        properties: { name: f.properties.name, kind: f.properties.kind, imp: f.properties.imp, country: f.properties.country },
      });
    }
  }

  const fc = { type: "FeatureCollection", features: [...seen.values()] };
  writeFileSync(OUT, JSON.stringify(fc));
  const mb = (JSON.stringify(fc).length / 1048576).toFixed(2);
  console.log(`\n  ✓ wrote ${fc.features.length} bases → ${OUT}  (${mb} MB, ${failed} tiles failed)`);
}

run();
