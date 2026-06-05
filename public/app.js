/* OBSIDIAN — 3D-globe OSINT GIS (MapLibre GL) */

const EMPTY = { type: "FeatureCollection", features: [] };
const $ = (id) => document.getElementById(id);
const status = (m) => ($("status").textContent = m || "");
const FONT = ["Open Sans Regular"];

// Sentinel-2 cloudless — recent global mosaic at ~10 m, free/keyless (EOX).
// 25× sharper than the daily VIIRS layer; cloud-free, near-current year.
const S2_YEAR = "2024";
const S2_TILES = `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${S2_YEAR}_3857/default/g/{z}/{y}/{x}.jpg`;

const STYLE = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  projection: { type: "globe" },
  sources: {
    dark: { type: "raster", tileSize: 256, maxzoom: 16, attribution: "© Esri",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"] },
    sat: { type: "raster", tileSize: 256, maxzoom: 19, attribution: "© Esri, Maxar, Earthstar Geographics",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] },
    topo: { type: "raster", tileSize: 256, maxzoom: 16, attribution: "© Esri",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"] },
    dem: { type: "raster-dem", tileSize: 256, encoding: "terrarium", maxzoom: 14,
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"] },
    s2: { type: "raster", tileSize: 256, maxzoom: 14, attribution: `Sentinel-2 cloudless ${S2_YEAR} · s2maps.eu © EOX`,
      tiles: [S2_TILES] },
  },
  layers: [
    { id: "space", type: "background", paint: { "background-color": "#04070a" } },
    { id: "r-dark", type: "raster", source: "dark", paint: { "raster-brightness-max": 0.62, "raster-saturation": -0.35, "raster-contrast": 0.12 } },
    { id: "r-sat", type: "raster", source: "sat", layout: { visibility: "none" } },
    { id: "r-s2", type: "raster", source: "s2", layout: { visibility: "none" } },
    { id: "r-topo", type: "raster", source: "topo", layout: { visibility: "none" } },
    { id: "hillshade", type: "hillshade", source: "dem", layout: { visibility: "none" }, paint: { "hillshade-exaggeration": 0.5, "hillshade-shadow-color": "#000", "hillshade-accent-color": "#1a2530" } },
  ],
};

const map = new maplibregl.Map({
  container: "map", style: STYLE, center: [20, 25], zoom: 1.7, maxZoom: 17,
  attributionControl: { compact: true },
  fadeDuration: 0,            // no tile/label fade → contacts appear instantly
  maxTileCacheSize: 1024,     // keep more tiles cached for snappy pan/zoom
  localIdeographFontFamily: "sans-serif", // skip downloading CJK glyph ranges
  refreshExpiredTiles: false,
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");

const state = { aircraft: [], ships: [], bases: [], major: [], foreign: [], events: [] };
const trailStore = new Map();
let minImp = 1, countryFilter = "ALL"; // base filters
let measuring = false; const measurePts = []; // distance tool

function planeIcon(size, color) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const x = c.getContext("2d");
  x.translate(size / 2, size / 2); x.beginPath();
  x.moveTo(0, -size * 0.42); x.lineTo(size * 0.34, size * 0.40); x.lineTo(0, size * 0.20); x.lineTo(-size * 0.34, size * 0.40); x.closePath();
  x.fillStyle = color; x.strokeStyle = "rgba(0,0,0,0.65)"; x.lineWidth = size * 0.06; x.fill(); x.stroke();
  return x.getImageData(0, 0, size, size);
}

// Military aircraft role → colour + label. Drives icon colour, popup and legend.
const ROLE_META = {
  fighter:   { c: "#ff453a", label: "Fighter" },
  bomber:    { c: "#ff2d55", label: "Bomber" },
  tanker:    { c: "#ffb000", label: "Tanker" },
  aew:       { c: "#22d3ee", label: "AEW / AWACS" },
  isr:       { c: "#38bdf8", label: "ISR / Recon" },
  drone:     { c: "#bf5af2", label: "Drone / UAV" },
  patrol:    { c: "#5ac8fa", label: "Maritime patrol" },
  c2:        { c: "#ff9f0a", label: "Command / C2" },
  vip:       { c: "#ffd60a", label: "VIP / State" },
  transport: { c: "#9aa7b3", label: "Transport" },
  helo:      { c: "#2dd4bf", label: "Helicopter" },
  trainer:   { c: "#aab4be", label: "Trainer" },
  mil:       { c: "#7dffc0", label: "Military" },
};
const ROLE_IMG = ["match", ["coalesce", ["get", "role"], "mil"], ...Object.keys(ROLE_META).flatMap((r) => [r, "plane-" + r]), "plane-mil"];
const ROLE_SIZE = ["match", ["coalesce", ["get", "role"], "mil"], "aew", 0.82, "tanker", 0.76, "isr", 0.72, "bomber", 0.82, "c2", 0.82, "vip", 0.74, "drone", 0.7, "fighter", 0.66, 0.56];

// Operating-nation palette for foreign / overseas installations.
const OP_META = {
  US: { c: "#3b82f6", name: "United States" }, RU: { c: "#ef4444", name: "Russia" }, FR: { c: "#2563eb", name: "France" },
  GB: { c: "#818cf8", name: "United Kingdom" }, CN: { c: "#f59e0b", name: "China" }, TR: { c: "#fb7185", name: "Turkey" },
  AE: { c: "#22c55e", name: "UAE" }, IN: { c: "#fb923c", name: "India" }, IR: { c: "#34d399", name: "Iran" },
};
const OP_COLOR = ["match", ["get", "op"], ...Object.entries(OP_META).flatMap(([k, v]) => [k, v.c]), "#94a3b8"];

map.on("load", () => {
  map.setProjection({ type: "globe" });
  try { map.setSky({ "sky-color": "#0a1018", "horizon-color": "#1b2a36", "fog-color": "#04070a", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.8, 5, 0.3, 7, 0] }); } catch (e) {}
  map.addImage("plane", planeIcon(40, "#7dffc0"), { pixelRatio: 2.6 });
  for (const [role, m] of Object.entries(ROLE_META)) map.addImage("plane-" + role, planeIcon(40, m.c), { pixelRatio: 2.6 });

  for (const id of ["aircraft", "trails", "majorBases", "foreign", "events", "rings"]) map.addSource(id, { type: "geojson", data: EMPTY });
  map.addSource("bases", { type: "geojson", data: EMPTY, cluster: true, clusterRadius: 55, clusterMaxZoom: 9, maxzoom: 12 });
  map.addSource("ships", { type: "geojson", data: EMPTY, cluster: true, clusterRadius: 40, clusterMaxZoom: 7 });
  map.addSource("borders", { type: "geojson", data: "/borders.geojson?v=2-osm" });

  // International borders — drawn first so all markers sit on top of them.
  map.addLayer({ id: "borders-line", type: "line", source: "borders", layout: { "line-join": "round" }, paint: { "line-color": "#7f93a3", "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 4, 0.9, 8, 1.5], "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.32, 4, 0.5, 8, 0.66] } });
  map.addLayer({ id: "trails-line", type: "line", source: "trails", layout: { visibility: "none" }, paint: { "line-color": "#5dd6a0", "line-width": 1, "line-opacity": 0.45 } });
  map.addLayer({ id: "major-bases-glow", type: "circle", source: "majorBases", minzoom: 2.8, filter: [">=", ["get", "imp"], 4], paint: { "circle-radius": ["interpolate", ["linear"], ["get", "imp"], 4, 11, 5, 17], "circle-color": "#ff5a2a", "circle-blur": 1, "circle-opacity": 0.32 } });
  map.addLayer({ id: "major-bases", type: "circle", source: "majorBases", minzoom: 2.8, paint: { "circle-radius": ["interpolate", ["linear"], ["get", "imp"], 1, 3, 3, 5, 5, 8.5], "circle-color": ["interpolate", ["linear"], ["get", "imp"], 1, "#ffd2a6", 3, "#ff9a5a", 5, "#ff4d24"], "circle-stroke-color": "#160a06", "circle-stroke-width": 1 } });
  map.addLayer({ id: "major-bases-label", type: "symbol", source: "majorBases", minzoom: 2.2, layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": ["interpolate", ["linear"], ["get", "imp"], 1, 9, 5, 13], "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true, "symbol-sort-key": ["-", 6, ["get", "imp"]] }, paint: { "text-color": "#ffc7a8", "text-halo-color": "#0a0d10", "text-halo-width": 1.3 } });
  // Foreign / overseas installations — coloured by operating nation, code badge on top.
  map.addLayer({ id: "foreign-glow", type: "circle", source: "foreign", paint: { "circle-color": OP_COLOR, "circle-blur": 1, "circle-opacity": 0.35, "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 12, 6, 22] } });
  map.addLayer({ id: "foreign-dot", type: "circle", source: "foreign", paint: { "circle-color": OP_COLOR, "circle-opacity": 0.92, "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 8, 6, 12], "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.4 } });
  map.addLayer({ id: "foreign-code", type: "symbol", source: "foreign", layout: { "text-field": ["get", "op"], "text-font": FONT, "text-size": ["interpolate", ["linear"], ["zoom"], 2, 8.5, 6, 11], "text-allow-overlap": true }, paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.55)", "text-halo-width": 1 } });
  map.addLayer({ id: "foreign-label", type: "symbol", source: "foreign", minzoom: 4.2, layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": 11, "text-offset": [0, 1.3], "text-anchor": "top", "text-optional": true }, paint: { "text-color": "#dbe4ee", "text-halo-color": "#0a0d10", "text-halo-width": 1.3 } });
  // Live geolocated events (GDELT news) — red, sized by report volume.
  map.addLayer({ id: "events-glow", type: "circle", source: "events", paint: { "circle-color": "#ff3b30", "circle-blur": 1, "circle-opacity": 0.32, "circle-radius": ["interpolate", ["linear"], ["coalesce", ["get", "count"], 1], 1, 9, 10, 16, 60, 26, 200, 38] } });
  map.addLayer({ id: "events-point", type: "circle", source: "events", paint: { "circle-color": "#ff5a4a", "circle-opacity": 0.9, "circle-radius": ["interpolate", ["linear"], ["coalesce", ["get", "count"], 1], 1, 3.5, 10, 6, 60, 9, 200, 13], "circle-stroke-color": "#2a0805", "circle-stroke-width": 0.8 } });
  // Range / weapon-envelope rings — analytical overlay drawn above everything.
  map.addLayer({ id: "rings-line", type: "line", source: "rings", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#ff9f0a", "line-width": 1.2, "line-opacity": 0.6, "line-dasharray": [3, 2] } });
  map.addLayer({ id: "rings-center", type: "circle", source: "rings", filter: ["==", ["coalesce", ["get", "center"], 0], 1], paint: { "circle-radius": 4, "circle-color": "#ff9f0a", "circle-stroke-color": "#1a0a04", "circle-stroke-width": 1.5 } });
  map.addLayer({ id: "rings-label", type: "symbol", source: "rings", filter: ["has", "label"], layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 10.5, "text-offset": [0, -0.7], "text-anchor": "bottom", "text-allow-overlap": true }, paint: { "text-color": "#ffd9a0", "text-halo-color": "#1a0a04", "text-halo-width": 1.4 } });
  map.addLayer({ id: "bases-cluster-glow", type: "circle", source: "bases", filter: ["has", "point_count"], paint: { "circle-color": ["step", ["get", "point_count"], "#ff9a4a", 50, "#ff6a2a", 250, "#ff3a1a"], "circle-blur": 1, "circle-opacity": 0.28, "circle-radius": ["step", ["get", "point_count"], 22, 10, 28, 50, 36, 250, 46, 1000, 58] } });
  map.addLayer({ id: "bases-cluster", type: "circle", source: "bases", filter: ["has", "point_count"], paint: { "circle-color": ["step", ["get", "point_count"], "rgba(60,24,12,0.92)", 50, "rgba(78,28,12,0.94)", 250, "rgba(96,26,12,0.95)"], "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 50, 25, 250, 31, 1000, 39], "circle-stroke-color": ["step", ["get", "point_count"], "#ffb070", 50, "#ff7a3a", 250, "#ff4422"], "circle-stroke-width": 2 } });
  map.addLayer({ id: "bases-cluster-count", type: "symbol", source: "bases", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": FONT, "text-size": ["step", ["get", "point_count"], 12, 10, 14, 50, 16, 250, 19, 1000, 22], "text-allow-overlap": true }, paint: { "text-color": "#fff0e4", "text-halo-color": "#1a0a04", "text-halo-width": 1.2 } });
  map.addLayer({ id: "bases-point", type: "circle", source: "bases", filter: ["!", ["has", "point_count"]], paint: { "circle-radius": ["interpolate", ["linear"], ["coalesce", ["get", "imp"], 1], 1, 3, 3, 4.5, 4, 6, 5, 8], "circle-color": ["interpolate", ["linear"], ["coalesce", ["get", "imp"], 1], 1, "#ffd2a6", 3, "#ff9a5a", 5, "#ff4d24"], "circle-stroke-color": "#160a06", "circle-stroke-width": 0.7 } });
  map.addLayer({ id: "ships-cluster", type: "circle", source: "ships", filter: ["has", "point_count"], paint: { "circle-color": "#143a5a", "circle-radius": ["step", ["get", "point_count"], 13, 50, 18, 500, 24], "circle-stroke-color": "#4aa3ff", "circle-stroke-width": 1 } });
  map.addLayer({ id: "ships-cluster-count", type: "symbol", source: "ships", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": FONT, "text-size": 11 }, paint: { "text-color": "#cfe6ff" } });
  map.addLayer({ id: "ships-point", type: "circle", source: "ships", filter: ["!", ["has", "point_count"]], paint: { "circle-radius": 3.6, "circle-color": ["case", ["get", "military"], "#ff4a4a", "#4aa3ff"], "circle-stroke-color": "#0a141d", "circle-stroke-width": 0.6 } });
  map.addLayer({ id: "aircraft-point", type: "symbol", source: "aircraft", layout: { "icon-image": ROLE_IMG, "icon-size": ROLE_SIZE, "icon-rotate": ["get", "heading"], "icon-rotation-alignment": "map", "icon-allow-overlap": true } });

  map.addSource("measure", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "measure-line", type: "line", source: "measure", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#ffae3b", "line-width": 1.6, "line-dasharray": [2, 1.5] } });
  map.addLayer({ id: "measure-pts", type: "circle", source: "measure", filter: ["all", ["==", ["geometry-type"], "Point"], ["!", ["has", "label"]]], paint: { "circle-radius": 4.5, "circle-color": "#ffae3b", "circle-stroke-color": "#0a0704", "circle-stroke-width": 1.5 } });
  map.addLayer({ id: "measure-label", type: "symbol", source: "measure", filter: ["has", "label"], layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": ["case", ["has", "total"], 13, 11], "text-offset": ["case", ["has", "total"], ["literal", [0, -1.6]], ["literal", [0, -1.1]]], "text-anchor": "bottom", "text-allow-overlap": true }, paint: { "text-color": ["case", ["has", "total"], "#ffd27a", "#ffe0b0"], "text-halo-color": "#0a0704", "text-halo-width": 1.8 } });

  setVisible("bases", $("t-bases").checked);
  setVisible("ships", $("t-ships").checked);
  setVisible("foreign", $("t-foreign").checked);
  setVisible("events", $("t-events").checked);
  wireInteractions();
  loadMajorBases();
  loadForeign();
  refreshAll();

  // deep-link state: ?bm=satellite|terrain  ?ships=1  ?lat=&lon=&z=
  // applied after the first idle so it never races the initial load transition.
  map.once("idle", () => {
    const q = new URLSearchParams(location.search);
    if (q.get("z")) map.jumpTo({ center: [+q.get("lon") || 0, +q.get("lat") || 0], zoom: +q.get("z") });
    if (q.get("ships") === "1") { $("t-ships").checked = true; setVisible("ships", true); loadShips(); }
    if (q.get("bm")) setBasemap(q.get("bm"));
  });
});

/* ---- layer groups & visibility ---- */
const GROUPS = {
  aircraft: ["aircraft-point"],
  bases: ["major-bases-glow", "major-bases", "major-bases-label", "bases-cluster-glow", "bases-cluster", "bases-cluster-count", "bases-point"],
  ships: ["ships-cluster", "ships-cluster-count", "ships-point"],
  foreign: ["foreign-glow", "foreign-dot", "foreign-code", "foreign-label"],
  events: ["events-glow", "events-point"],
};
function setVisible(group, on) { for (const id of GROUPS[group]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); }

/* ---- basemap switcher ---- */
let basemap = "tactical";
function setBasemap(mode) {
  basemap = mode;
  map.setMaxZoom(mode === "satellite" ? 20 : mode === "terrain" ? 16 : mode === "s2" ? 16 : 17);
  if (mode === "satellite") status("Esri / Maxar imagery · sub-metre in developed areas");
  const show = (id, on) => map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  show("r-dark", mode === "tactical");
  show("r-sat", mode === "satellite" || mode === "terrain");
  show("r-s2", mode === "s2");
  show("r-topo", false);
  show("hillshade", mode === "terrain");
  if (mode === "s2") status(`Sentinel-2 cloudless ${S2_YEAR} · 10 m`);
  document.querySelectorAll(".bm").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  if (mode === "terrain") {
    map.setProjection({ type: "mercator" });
    map.setTerrain({ source: "dem", exaggeration: 1.4 });
    map.easeTo({ pitch: 62, duration: 900 });
  } else {
    map.setTerrain(null);
    map.easeTo({ pitch: 0, duration: 700 });
    map.setProjection({ type: "globe" });
  }
}

/* ---- viewport ---- */
function view() {
  const b = map.getBounds();
  const s = Math.max(-85, b.getSouth()), n = Math.min(85, b.getNorth());
  return { lamin: s, lamax: n, lomin: b.getWest(), lomax: b.getEast(), spanLat: n - s, spanLon: b.getEast() - b.getWest() };
}

/* ---- loaders ---- */
async function loadMajorBases() {
  try { const r = await fetch("/major_bases.geojson"); const j = await r.json(); state.major = j.features || []; map.getSource("majorBases").setData(j); populateCountries(j.features); loadBases(); } catch (e) {}
}
// Foreign / overseas installations (operating nation ≠ host country).
async function loadForeign() {
  try {
    const r = await fetch("/foreign_bases.geojson"); const j = await r.json();
    state.foreign = j.features || [];
    map.getSource("foreign").setData(j);
    $("c-foreign").textContent = state.foreign.length;
  } catch (e) { $("c-foreign").textContent = "—"; }
}
function populateCountries(feats) {
  const sel = $("country-filter"); if (!sel || sel.dataset.filled) return;
  const set = new Set(feats.map((f) => f.properties.country));
  sel.innerHTML = ["ALL", ...[...set].sort()].map((c) => `<option value="${c}">${c === "ALL" ? "◆ ALL COUNTRIES (" + feats.length + ")" : c}</option>`).join("");
  sel.dataset.filled = "1";
}
// Rebuild the country selector from the full preloaded base set (≈176 nations).
function rebuildCountryFilter() {
  const sel = $("country-filter"); if (!sel) return;
  const counts = {};
  for (const f of state.bases) { const c = f.properties.country; if (c) counts[c] = (counts[c] || 0) + 1; }
  const names = Object.keys(counts).sort();
  if (!names.length) return;
  const cur = countryFilter;
  sel.innerHTML = `<option value="ALL">◆ All countries (${names.length})</option>` +
    names.map((c) => `<option value="${esc(c)}">${esc(c)} · ${counts[c].toLocaleString()}</option>`).join("");
  sel.value = cur === "ALL" || counts[cur] ? cur : "ALL";
  sel.dataset.filled = "1";
}
function applyBaseFilter() {
  const parts = [];
  if (minImp > 1) parts.push([">=", ["get", "imp"], minImp]);
  if (countryFilter !== "ALL") parts.push(["==", ["get", "country"], countryFilter]);
  const f = parts.length ? ["all", ...parts] : null;
  map.setFilter("major-bases", f);
  map.setFilter("major-bases-label", f);
  map.setFilter("major-bases-glow", ["all", [">=", ["get", "imp"], 4], ...parts]);

  // Clustered global network: re-feed filtered features so clusters recompute
  // around the selected country / rating instead of the whole world.
  if (basesLoaded && map.getSource("bases")) {
    let feats = state.bases;
    if (countryFilter !== "ALL") feats = feats.filter((ft) => ft.properties.country === countryFilter);
    if (minImp > 1) feats = feats.filter((ft) => (+ft.properties.imp || 1) >= minImp);
    map.getSource("bases").setData({ type: "FeatureCollection", features: feats });
    if (countryFilter !== "ALL") {
      const b = new maplibregl.LngLatBounds(); let n = 0;
      for (const ft of feats) { b.extend(ft.geometry.coordinates); n++; }
      if (n) map.fitBounds(b, { padding: 80, maxZoom: 7, duration: 900 });
      status(`${countryFilter}: ${n.toLocaleString()} installation${n === 1 ? "" : "s"}${minImp > 1 ? " ≥" + minImp + "★" : ""}`);
    } else status(minImp > 1 ? `showing ≥${minImp}★ installations` : `${feats.length.toLocaleString()} installations`);
    return;
  }
  // Fallback (full network not loaded yet): curated bases only.
  if (countryFilter !== "ALL") {
    const b = new maplibregl.LngLatBounds(); let n = 0;
    for (const ft of state.major) if (ft.properties.country === countryFilter && ft.properties.imp >= minImp) { b.extend(ft.geometry.coordinates); n++; }
    if (n) map.fitBounds(b, { padding: 130, maxZoom: 6, duration: 900 });
    status(`${countryFilter}: ${n} base${n === 1 ? "" : "s"}${minImp > 1 ? " ≥" + minImp + "★" : ""}`);
  } else status(minImp > 1 ? "showing ≥" + minImp + "★ bases" : "");
}
async function loadAircraft() {
  if (!$("t-aircraft").checked) return;
  try {
    const r = await fetch("/api/aircraft"); const j = await r.json();
    if (!r.ok) { status(j.error || "aircraft error"); return; }
    $("src-tag").textContent = j.source === "milfeed" ? "ADSB mil" : j.source === "adsbx" ? "ADS-B Exch" : "OpenSky";
    const feats = j.aircraft.map((a) => ({ type: "Feature", geometry: { type: "Point", coordinates: [a.lon, a.lat] }, properties: { layer: "aircraft", name: a.callsign || a.id, country: a.country || "", alt: a.alt, velocity: a.velocity, heading: a.heading || 0, id: a.id, role: a.role || "mil", type: a.type || "", typeLabel: a.typeLabel || "", squawk: a.squawk || "", onGround: !!a.onGround } }));
    state.aircraft = feats;
    map.getSource("aircraft").setData({ type: "FeatureCollection", features: feats });
    $("c-aircraft").textContent = j.count;
    state.airRoles = j.roles || {};
    renderAirLegend(state.airRoles);
    updateTrails(j.aircraft); telemetry();
  } catch (e) { status("aircraft: " + e.message); }
}
// Live role legend (military air picture) — colour-coded counts by role.
let airLegendOpen = true;
function renderAirLegend(roles) {
  const el = $("airlegend"); if (!el) return;
  const total = Object.values(roles).reduce((a, b) => a + b, 0);
  const show = $("t-aircraft").checked && total > 0;
  el.hidden = !show;
  if (!show) return;
  const order = Object.keys(ROLE_META);
  const rows = Object.entries(roles).filter(([, n]) => n > 0)
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([role, n]) => { const m = ROLE_META[role] || ROLE_META.mil; return `<div class="leg-row"><span class="rdot" style="background:${m.c}"></span><span class="leg-l">${m.label}</span><span class="leg-n">${n}</span></div>`; }).join("");
  el.classList.toggle("collapsed", !airLegendOpen);
  el.innerHTML = `<button class="leg-h" id="leg-toggle" aria-expanded="${airLegendOpen}">Military air · ${total}<span class="leg-cx">${airLegendOpen ? "▾" : "▸"}</span></button><div class="leg-body">${rows}</div>`;
  $("leg-toggle").addEventListener("click", () => { airLegendOpen = !airLegendOpen; renderAirLegend(state.airRoles || {}); });
}
function updateTrails(list) {
  for (const a of list) { if (a.lat == null) continue; const h = trailStore.get(a.id) || []; const l = h[h.length - 1]; if (!l || l[0] !== a.lon || l[1] !== a.lat) h.push([a.lon, a.lat]); if (h.length > 20) h.shift(); trailStore.set(a.id, h); }
  if (!$("trails").checked) return;
  const lines = []; for (const [id, p] of trailStore) if (p.length > 1) lines.push({ type: "Feature", geometry: { type: "LineString", coordinates: p }, properties: { id } });
  map.getSource("trails").setData({ type: "FeatureCollection", features: lines });
}
// Global base network is preloaded ONCE and clustered client-side, so the
// "big number per region → splits into smaller clusters → individual bases"
// drill-down is instant with no waiting for on-zoom fetches.
let basesLoaded = false;
async function loadBases() {
  if (!$("t-bases").checked || basesLoaded) return;
  status("loading global base network…");
  try {
    const r = await fetch("/bases_global.geojson?v=4-osm1m", { cache: "force-cache" });
    if (!r.ok) throw new Error("global set not built yet");
    const j = await r.json();
    state.bases = (j.features || []).map((f) => ({ ...f, properties: { layer: "base", ...f.properties } }));
    map.getSource("bases").setData({ type: "FeatureCollection", features: state.bases });
    basesLoaded = true;
    $("c-bases").textContent = state.bases.length.toLocaleString();
    rebuildCountryFilter();
    status(`${state.bases.length.toLocaleString()} installations · zoom a cluster to drill in`);
    telemetry();
  } catch (e) {
    loadBasesViewport(); // build not ready → fall back to live per-viewport OSM
  }
}
// Fallback only: live Overpass detail for the current viewport (used until the
// global file exists). Removed from the hot path once the global set loads.
async function loadBasesViewport() {
  if (!$("t-bases").checked || basesLoaded) return;
  const v = view();
  if (v.spanLon < 0 || v.spanLat > 10 || v.spanLon > 16) {
    map.getSource("bases").setData(EMPTY); state.bases = [];
    $("c-bases").textContent = state.major.length; status("zoom in for full base detail"); telemetry(); return;
  }
  status("loading bases…");
  try {
    const r = await fetch(`/api/bases?lamin=${v.lamin}&lomin=${v.lomin}&lamax=${v.lamax}&lomax=${v.lomax}`); const j = await r.json();
    if (!r.ok) { map.getSource("bases").setData(EMPTY); state.bases = []; $("c-bases").textContent = state.major.length; status(j.error || "OSM detail unavailable — curated bases shown"); telemetry(); return; }
    const feats = j.bases.map((b) => ({ type: "Feature", geometry: { type: "Point", coordinates: [b.lon, b.lat] }, properties: { layer: "base", name: b.name, kind: b.kind, operator: b.operator || "" } }));
    state.bases = feats; map.getSource("bases").setData({ type: "FeatureCollection", features: feats });
    $("c-bases").textContent = state.major.length + j.count; status(""); telemetry();
  } catch (e) { status("bases: " + e.message); }
}
async function loadShips() {
  if (!$("t-ships").checked) return;
  const v = view();
  try {
    const r = await fetch(`/api/ships?lamin=${v.lamin}&lomin=${v.lomin}&lamax=${v.lamax}&lomax=${v.lomax}&mil=0`); const j = await r.json();
    const mode = $("ships-mode");
    if (j.demo) { mode.textContent = "SAMPLE"; mode.className = "mode demo"; $("ships-note").hidden = false; }
    else { mode.textContent = "LIVE"; mode.className = "mode live"; $("ships-note").hidden = true; }
    const feats = j.ships.map((s) => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] }, properties: { layer: "ship", name: s.name || s.mmsi, mmsi: s.mmsi, military: !!s.military } }));
    state.ships = feats; map.getSource("ships").setData({ type: "FeatureCollection", features: feats });
    $("c-ships").textContent = j.count; telemetry();
  } catch (e) { status("ships: " + e.message); }
}
function refreshAll() { loadAircraft(); loadBases(); loadShips(); }

/* ---- telemetry HUD ---- */
function telemetry() {
  const air = $("t-aircraft").checked ? state.aircraft.length : 0;
  const shp = $("t-ships").checked ? state.ships.length : 0;
  const bse = $("t-bases").checked ? (state.bases.length || state.major.length) : 0;
  $("tl-contacts").textContent = String(air + shp + bse).padStart(4, "0");
}
function tick() { const d = new Date(); $("tl-clock").textContent = d.toISOString().slice(11, 19) + "Z"; }
setInterval(tick, 1000); tick();

/* ---- range rings (weapon / sensor envelopes) ---- */
function destPoint(lon, lat, brgDeg, distKm) {
  const R = 6371, d = distKm / R, br = (brgDeg * Math.PI) / 180, la1 = (lat * Math.PI) / 180, lo1 = (lon * Math.PI) / 180;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br));
  const lo2 = lo1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [(((lo2 * 180) / Math.PI + 540) % 360) - 180, (la2 * 180) / Math.PI];
}
function ringCircle(center, km, pts = 96) { const c = []; for (let i = 0; i <= pts; i++) c.push(destPoint(center[0], center[1], (i / pts) * 360, km)); return c; }
const RING_KM = [100, 250, 500, 1000];
function drawRings(center) {
  const feats = [{ type: "Feature", geometry: { type: "Point", coordinates: center }, properties: { center: 1 } }];
  for (const km of RING_KM) {
    feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: ringCircle(center, km) }, properties: { km } });
    feats.push({ type: "Feature", geometry: { type: "Point", coordinates: destPoint(center[0], center[1], 0, km) }, properties: { label: km >= 1000 ? km / 1000 + "k km" : km + " km" } });
  }
  map.getSource("rings").setData({ type: "FeatureCollection", features: feats });
}
function clearRings() { const s = map.getSource("rings"); if (s) s.setData(EMPTY); }

/* ---- base intel: live aircraft on the ground + curated order of battle ---- */
function onGroundAt(center, km = 7) {
  const out = [];
  if (!center || !state.aircraft.length) return out;
  for (const f of state.aircraft) { const p = f.properties; if (!(p.onGround === true || p.onGround === "true")) continue; if (haversine(center, f.geometry.coordinates) <= km) out.push(p); }
  return out;
}
function intelBlock(p, coords) {
  let html = "";
  const ob = [];
  if (p.garrison) ob.push(`Garrison ≈ ${esc(p.garrison)}`);
  if (p.units) ob.push(esc(p.units));
  if (p.basedAircraft) ob.push(`Aircraft: ${esc(p.basedAircraft)}`);
  if (ob.length) html += `<div class="intel">${ob.join("<br>")}<div class="intel-src">public order-of-battle</div></div>`;
  const g = onGroundAt(coords);
  if (g.length) {
    const types = {};
    for (const a of g) { const k = a.typeLabel || (ROLE_META[a.role] && ROLE_META[a.role].label) || "aircraft"; types[k] = (types[k] || 0) + 1; }
    const top = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${n}× ${esc(k)}`).join(", ");
    html += `<div class="intel live">▲ ${g.length} mil aircraft on ground now${top ? " — " + top : ""}</div>`;
  }
  return html;
}

/* ---- live events (GDELT geolocated news) ---- */
let eventsTimer = null;
async function loadEvents() {
  if (!$("t-events").checked) return;
  try {
    const r = await fetch("/api/events"); const j = await r.json();
    if (!r.ok) { status(j.error || "events unavailable"); return; }
    const feats = (j.events || []).map((e) => ({ type: "Feature", geometry: { type: "Point", coordinates: [e.lon, e.lat] }, properties: { layer: "event", name: e.name || "", count: e.count || 1, articles: JSON.stringify(e.articles || []) } }));
    state.events = feats;
    map.getSource("events").setData({ type: "FeatureCollection", features: feats });
    $("c-events").textContent = j.count;
    status(`${j.count} live conflict hotspots · GDELT`);
  } catch (e) { status("events: " + e.message); }
}

/* ---- distance measure tool ---- */
function haversine(a, b) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR, dLon = (b[0] - a[0]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// Multi-point path: every click adds a waypoint; each leg is labelled and a
// running cumulative total is shown. Right-click undoes, double-click clears.
function renderMeasure() {
  const feats = measurePts.map((p, i) => ({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: { idx: i + 1 } }));
  let total = 0;
  if (measurePts.length >= 2) {
    feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: measurePts }, properties: {} });
    for (let i = 1; i < measurePts.length; i++) {
      const a = measurePts[i - 1], b = measurePts[i];
      const leg = haversine(a, b); total += leg;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      feats.push({ type: "Feature", geometry: { type: "Point", coordinates: mid }, properties: { label: `${leg < 10 ? leg.toFixed(2) : leg.toFixed(1)} km` } });
    }
    // bold cumulative total anchored at the last waypoint
    feats.push({ type: "Feature", geometry: { type: "Point", coordinates: measurePts[measurePts.length - 1] }, properties: { label: `Σ ${total.toFixed(1)} km`, total: 1 } });
    status(`PATH ${measurePts.length} pts · ${total.toFixed(1)} km · ${(total * 0.539957).toFixed(1)} nm · ${(total * 0.621371).toFixed(1)} mi`);
  } else if (measurePts.length === 1) {
    status("measure: click next point · right-click undo · double-click clear");
  }
  map.getSource("measure").setData({ type: "FeatureCollection", features: feats });
}

/* ---- interactions ---- */
const esc = (s) => (s == null ? "" : String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));
// ISO-3166 alpha-2 -> regional-indicator flag emoji
const flag = (cc) => (cc && /^[A-Za-z]{2}$/.test(cc) ? cc.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0))) : "");
function basePopupHTML(p, coords) {
  const imp = +p.imp || 1;
  const stars = "★".repeat(imp) + "☆".repeat(5 - imp);
  const fl = flag(p.cc);
  const ctry = p.country || "Unknown / disputed territory";
  const meta = [p.kind, p.operator].filter(Boolean).map(esc).join(" · ");
  return `<b>${esc(p.name) || "Military installation"}</b>
    <div class="pc">${fl ? fl + " " : ""}${esc(ctry)}</div>
    ${meta ? `<div class="pk">${meta}</div>` : ""}
    <span style="color:#ffae3b;letter-spacing:3px">${stars}</span> <small style="color:#9fb">${imp}/5</small>
    ${intelBlock(p, coords)}`;
}
function popup(e, html) { if (measuring) return; new maplibregl.Popup({ closeButton: true, maxWidth: "250px" }).setLngLat(e.lngLat).setHTML(html).addTo(map); }
function wireInteractions() {
  map.on("click", "aircraft-point", (e) => {
    const p = e.features[0].properties;
    const meta = ROLE_META[p.role] || ROLE_META.mil;
    const alttxt = p.onGround === true || p.onGround === "true" ? "on ground" : (num(p.alt) ? Math.round(p.alt) + " m (" + Math.round(p.alt * 3.281).toLocaleString() + " ft)" : "—");
    popup(e, `<b>${esc(p.name)}</b>
      <div class="pc"><span class="rdot" style="background:${meta.c}"></span>${esc(p.typeLabel) || "Military aircraft"}</div>
      <div class="pk">${meta.label}${p.country ? " · " + esc(p.country) : ""}${p.squawk ? " · sqwk " + esc(p.squawk) : ""}</div>
      alt ${alttxt} · ${num(p.velocity) ? Math.round(p.velocity * 1.944) + " kt" : "—"} · hdg ${Math.round(p.heading)}°`);
  });
  const onBaseClick = (e) => { const f = e.features[0]; const c = f.geometry.coordinates; popup(e, basePopupHTML(f.properties, c)); if ($("t-rings").checked) drawRings(c); };
  map.on("click", "major-bases", onBaseClick);
  map.on("click", "bases-point", onBaseClick);
  map.on("click", "foreign-dot", (e) => {
    const f = e.features[0]; const p = f.properties; const c = f.geometry.coordinates;
    const meta = OP_META[p.op] || { c: "#94a3b8" };
    popup(e, `<b>${esc(p.name)}</b>
      <div class="pc"><span class="rdot" style="background:${meta.c}"></span>${flag(p.op)} ${esc(p.opName)} installation</div>
      <div class="pk">in ${flag(p.host)} ${esc(p.hostName)} · ${esc(p.typeLabel)}</div>
      ${intelBlock(p, c)}
      <small style="color:#9fb">overseas / foreign presence</small>`);
    if ($("t-rings").checked) drawRings(c);
  });
  map.on("click", "events-point", (e) => {
    if (measuring) return;
    const p = e.features[0].properties;
    let arts = []; try { arts = JSON.parse(p.articles || "[]"); } catch (err) {}
    const list = arts.length
      ? `<div class="arts">${arts.map((a) => `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}<span>${esc(a.domain)}</span></a>`).join("")}</div>`
      : `<div class="pk">no source links in this window</div>`;
    new maplibregl.Popup({ closeButton: true, maxWidth: "330px" }).setLngLat(e.lngLat)
      .setHTML(`<b>${esc(p.name) || "Conflict hotspot"}</b><div class="pk">${p.count} report${p.count == 1 ? "" : "s"} · material conflict (GDELT, live)</div>${list}`)
      .addTo(map);
  });
  map.on("click", "ships-point", (e) => { const p = e.features[0].properties; const mil = p.military === "true" || p.military === true; popup(e, `<b>${p.name}</b><br>MMSI ${p.mmsi}${mil ? '<br><span style="color:#ff6a6a">⚑ military</span>' : ""}`); });
  for (const [layer, src] of [["bases-cluster", "bases"], ["ships-cluster", "ships"]]) {
    map.on("click", layer, async (e) => { if (measuring) return; const f = map.queryRenderedFeatures(e.point, { layers: [layer] })[0]; const z = await map.getSource(src).getClusterExpansionZoom(f.properties.cluster_id); map.easeTo({ center: f.geometry.coordinates, zoom: z }); });
  }
  for (const l of ["aircraft-point", "major-bases", "bases-point", "ships-point", "bases-cluster", "ships-cluster", "foreign-dot", "events-point"]) {
    map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
  }
  map.on("mousemove", (e) => { $("tl-coord").textContent = `${e.lngLat.lat.toFixed(2)}, ${e.lngLat.lng.toFixed(2)}`; });
  map.on("move", () => { $("tl-zoom").textContent = map.getZoom().toFixed(1); });
}
const num = (v) => v != null && v !== "null" && !Number.isNaN(+v);

/* ---- controls ---- */
for (const g of ["aircraft", "bases", "ships"]) $(`t-${g}`).addEventListener("change", (e) => { setVisible(g, e.target.checked); if (e.target.checked) refreshAll(); if (g === "aircraft") renderAirLegend(e.target.checked ? (state.airRoles || {}) : {}); telemetry(); });
$("t-foreign").addEventListener("change", (e) => { setVisible("foreign", e.target.checked); if (e.target.checked && !state.foreign.length) loadForeign(); telemetry(); });
$("t-events").addEventListener("change", (e) => {
  setVisible("events", e.target.checked);
  clearInterval(eventsTimer);
  if (e.target.checked) { loadEvents(); eventsTimer = setInterval(loadEvents, 180000); }
});
$("t-rings").addEventListener("change", (e) => { if (e.target.checked) status("range rings: click any base to draw envelopes"); else clearRings(); });
$("trails").addEventListener("change", (e) => { map.setLayoutProperty("trails-line", "visibility", e.target.checked ? "visible" : "none"); if (e.target.checked) updateTrails([]); });
$("measure").addEventListener("change", (e) => {
  measuring = e.target.checked;
  map.getCanvas().style.cursor = measuring ? "crosshair" : "";
  if (measuring) { map.doubleClickZoom.disable(); status("measure: click to drop waypoints"); }
  else { map.doubleClickZoom.enable(); measurePts.length = 0; map.getSource("measure").setData(EMPTY); status(""); }
});
map.on("click", (e) => {
  if (!measuring) return;
  measurePts.push([e.lngLat.lng, e.lngLat.lat]);
  renderMeasure();
});
map.on("dblclick", (e) => { if (!measuring) return; e.preventDefault(); measurePts.length = 0; map.getSource("measure").setData(EMPTY); status("measure: cleared · click to start a new path"); });
map.on("contextmenu", (e) => { if (!measuring) return; e.preventDefault(); measurePts.pop(); renderMeasure(); if (!measurePts.length) status("measure: click to drop waypoints"); });
document.querySelectorAll(".bm").forEach((b) => b.addEventListener("click", () => setBasemap(b.dataset.mode)));

$("country-filter").addEventListener("change", (e) => { countryFilter = e.target.value; if (!$("t-bases").checked) { $("t-bases").checked = true; setVisible("bases", true); } applyBaseFilter(); if (window.innerWidth <= 700) setNav(false); });

/* ---- collapsible panel (all screen sizes) ---- */
function setNav(open) { document.body.classList.toggle("nav-open", open); const b = $("menuToggle"); if (b) b.setAttribute("aria-expanded", open ? "true" : "false"); }
$("menuToggle") && $("menuToggle").addEventListener("click", () => setNav(!document.body.classList.contains("nav-open")));
$("panelCollapse") && $("panelCollapse").addEventListener("click", () => setNav(false));
$("scrim") && $("scrim").addEventListener("click", () => setNav(false));
window.addEventListener("keydown", (e) => { if (e.key === "Escape") setNav(false); });
document.querySelectorAll(".star").forEach((s) => s.addEventListener("click", () => {
  const v = +s.dataset.imp; minImp = minImp === v ? 1 : v;
  document.querySelectorAll(".star").forEach((x) => x.classList.toggle("on", minImp > 1 && +x.dataset.imp <= minImp));
  applyBaseFilter();
}));

let interacting = false;
for (const ev of ["dragstart", "zoomstart", "rotatestart"]) map.on(ev, () => (interacting = true));
for (const ev of ["dragend", "zoomend", "rotateend"]) map.on(ev, () => (interacting = false));
setInterval(() => { if (!$("spin").checked || interacting || basemap === "terrain") return; const c = map.getCenter(); map.jumpTo({ center: [c.lng + 0.3, c.lat] }); }, 80);

$("export").addEventListener("click", () => {
  const all = [...state.aircraft, ...state.major, ...state.bases, ...state.ships];
  if (!all.length) { status("nothing to export yet"); return; }
  download("obsidian_view.geojson", JSON.stringify({ type: "FeatureCollection", features: all }), "application/geo+json");
  const rows = ["layer,name,country,lat,lon,detail"];
  for (const f of all) { const [lon, lat] = f.geometry.coordinates; const p = f.properties; const d = (p.kind || p.mmsi || "").toString().replace(/,/g, " "); rows.push(`${p.layer},"${(p.name || "").replace(/"/g, "'")}","${(p.country || "").replace(/"/g, "'")}",${lat},${lon},${d}`); }
  download("obsidian_view.csv", rows.join("\n"), "text/csv");
  status(`exported ${all.length} contacts`);
});
function download(name, text, mime) { const url = URL.createObjectURL(new Blob([text], { type: mime })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }

let moveTimer;
map.on("moveend", () => { clearTimeout(moveTimer); moveTimer = setTimeout(() => { if (!basesLoaded) loadBasesViewport(); loadShips(); }, 600); });
setInterval(() => { loadAircraft(); loadShips(); }, 15000);
