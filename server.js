import express from "express";
import { WebSocket } from "ws";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import zlib from "node:zlib";

dotenv.config();
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

// no browser caching for code — but let the big static datasets cache so page
// refreshes don't re-download the multi-MB global base network every time.
app.use((req, res, next) => {
  if (/\.geojson$/.test(req.path)) res.set("Cache-Control", "public, max-age=3600");
  else res.set("Cache-Control", "no-store, must-revalidate");
  next();
});
app.use(express.static(join(__dirname, "public"), { etag: false, lastModified: false }));

/* ------------------------------------------------------------------ *
 *  AIRCRAFT  —  OpenSky Network ADS-B  (military heuristic)
 * ------------------------------------------------------------------ */

// ICAO24 hex address ranges allocated to military operators (public OSINT
// list, same approach tar1090/dump1090 use). NOT exhaustive — edit freely.
const MIL_HEX_RANGES = [
  ["adf7c8", "afffff"], // United States
  ["010070", "01008f"], // Egypt
  ["0a4000", "0a4fff"], // Algeria
  ["33ff00", "33ffff"], // Italy
  ["350000", "37ffff"], // Spain
  ["3aa000", "3affff"], // France
  ["3b7000", "3bffff"], // France
  ["3ea000", "3ebfff"], // Germany
  ["3f4000", "3fbfff"], // Germany
  ["43c000", "43cfff"], // United Kingdom
  ["444000", "446fff"], // Austria
  ["44f000", "44ffff"], // Belgium
  ["457000", "457fff"], // Bulgaria
  ["45f400", "45f4ff"], // Denmark
  ["468000", "4683ff"], // Greece
  ["473c00", "473c0f"], // Hungary
  ["478100", "4781ff"], // Norway
  ["480000", "480fff"], // Netherlands
  ["48d800", "48d87f"], // Poland
  ["497c00", "497cff"], // Portugal
  ["498420", "49842f"], // Czechia
  ["4b7000", "4b7fff"], // Switzerland
  ["4b8200", "4b82ff"], // Turkey
  ["70c070", "70c07f"], // Oman
  ["710258", "71027f"], // Saudi Arabia
  ["738a00", "738aff"], // Israel
  ["7c8000", "7c8fff"], // Australia (mil block)
  ["7cf800", "7cfaff"], // Australia
  ["800200", "8002ff"], // India
  ["c0cdf9", "c3ffff"], // Canada (mil)
  ["e40000", "e41fff"], // Brazil (mil)
];

// Callsign prefixes commonly used by military/state flights.
const MIL_CALLSIGN_PREFIXES = [
  "RCH",  "REACH", "RRR", "ASCOT", "CFC", "CTM", "GAF", "IAM", "BAF",
  "NATO", "AWACS", "FORTE", "HOMER", "JAKE", "MMF", "QID", "RFR",
  "SAM",  "SPAR", "TARTAN", "VVIP", "PLF", "BRK", "DUKE", "KNIFE",
  "SHELL","PETRO", "GRZLY", "NAVY", "ARMY", "EAGLE",
];

function hexInRange(hex) {
  const v = parseInt(hex, 16);
  for (const [lo, hi] of MIL_HEX_RANGES) {
    if (v >= parseInt(lo, 16) && v <= parseInt(hi, 16)) return true;
  }
  return false;
}

function isMilitaryAircraft(icao24, callsign) {
  if (icao24 && hexInRange(icao24.toLowerCase())) return true;
  if (callsign) {
    const cs = callsign.trim().toUpperCase();
    if (MIL_CALLSIGN_PREFIXES.some((p) => cs.startsWith(p))) return true;
  }
  return false;
}

// --- OpenSky OAuth2 token (optional, for higher rate limits) ---
let openskyToken = null;
let openskyTokenExp = 0;
async function getOpenskyToken() {
  const id = process.env.OPENSKY_CLIENT_ID;
  const secret = process.env.OPENSKY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (openskyToken && Date.now() < openskyTokenExp) return openskyToken;
  const url =
    "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: id,
    client_secret: secret,
  });
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) return null;
  const j = await r.json();
  openskyToken = j.access_token;
  openskyTokenExp = Date.now() + (j.expires_in - 30) * 1000;
  return openskyToken;
}

// Authoritative military feed (ADSB-Exchange via RapidAPI) — used when a key
// is present. Its /v2/mil/ endpoint returns every aircraft tagged military.
async function fetchADSBX() {
  const key = process.env.ADSBX_API_KEY;
  const r = await fetch("https://adsbexchange-com1.p.rapidapi.com/v2/mil/", {
    headers: {
      "X-RapidAPI-Key": key,
      "X-RapidAPI-Host": "adsbexchange-com1.p.rapidapi.com",
    },
  });
  if (!r.ok) throw new Error(`ADSBX ${r.status}`);
  const j = await r.json();
  return (j.ac || [])
    .filter((a) => a.lat != null && a.lon != null)
    .map((a) => ({
      id: a.hex,
      callsign: (a.flight || "").trim(),
      country: a.r || "",
      lat: a.lat,
      lon: a.lon,
      alt: typeof a.alt_baro === "number" ? a.alt_baro * 0.3048 : null, // ft→m
      onGround: a.alt_baro === "ground",
      velocity: a.gs != null ? a.gs / 1.944 : null, // kt→m/s
      heading: a.track,
      squawk: a.squawk || null,
      military: true,
      ...classify(a.t, a.flight),
    }));
}

// Fallback: OpenSky + military heuristic (no key needed).
async function fetchOpenSky(q) {
  const { lamin, lomin, lamax, lomax } = q;
  const milOnly = q.mil !== "0";
  let url = "https://opensky-network.org/api/states/all";
  if (lamin && lomin && lamax && lomax) {
    url += `?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
  }
  const token = await getOpenskyToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const r = await fetch(url, { headers });
  if (r.status === 429) { const e = new Error("OpenSky rate-limited — try again shortly or add OAuth credentials."); e.status = 429; throw e; }
  if (!r.ok) { const e = new Error(`OpenSky ${r.status}`); e.status = 502; throw e; }
  const data = await r.json();
  const out = [];
  for (const s of data.states || []) {
    const [icao24, callsign, country, , , lon, lat, baroAlt, onGround, vel, track] = s;
    if (lat == null || lon == null) continue;
    const mil = isMilitaryAircraft(icao24, callsign);
    if (milOnly && !mil) continue;
    out.push({ id: icao24, callsign: (callsign || "").trim(), country, lat, lon, alt: baroAlt, onGround, velocity: vel, heading: track, military: mil });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  MILITARY AIRCRAFT CLASSIFICATION
 *  ICAO type designator -> [role, human label]. The role drives map
 *  symbology/colour; the label is shown in the popup. Source feeds are
 *  already military-only, so this just refines WHAT each contact is.
 * ------------------------------------------------------------------ */
const TYPE_INFO = {
  // ---- tankers ----
  K35R: ["tanker", "KC-135R Stratotanker"], K35E: ["tanker", "KC-135E Stratotanker"], K35D: ["tanker", "KC-135D"],
  KC10: ["tanker", "KC-10 Extender"], KC30: ["tanker", "KC-30 MRTT"], KC46: ["tanker", "KC-46 Pegasus"],
  A332: ["tanker", "A330 MRTT"], A310: ["tanker", "A310 MRTT"], K767: ["tanker", "KC-767"], VC10: ["tanker", "VC10 tanker"],
  // ---- airborne early warning / AWACS ----
  E3CF: ["aew", "E-3 Sentry AWACS"], E3TF: ["aew", "E-3 Sentry AWACS"], E3SE: ["aew", "E-3 Sentry AWACS"], E3: ["aew", "E-3 Sentry AWACS"],
  E767: ["aew", "E-767 AWACS"], A50: ["aew", "Beriev A-50 Mainstay"], E2: ["aew", "E-2 Hawkeye"], E2C: ["aew", "E-2 Hawkeye"], E2D: ["aew", "E-2D Hawkeye"],
  E7: ["aew", "E-7 Wedgetail"], E737: ["aew", "E-7 Wedgetail"], KJ20: ["aew", "KJ-2000 Mainring"],
  // ---- ISR / reconnaissance / surveillance ----
  R135: ["isr", "RC-135 Rivet Joint"], RC135: ["isr", "RC-135"], C135: ["isr", "C-135"], U2: ["isr", "U-2 Dragon Lady"],
  RQ4: ["drone", "RQ-4 Global Hawk"], MQ4: ["drone", "MQ-4C Triton"], MQ9: ["drone", "MQ-9 Reaper"], MQ1: ["drone", "MQ-1 Predator"],
  RPA: ["drone", "Remotely Piloted Aircraft"], GHWK: ["drone", "RQ-4 Global Hawk"], TUAV: ["drone", "Tactical UAV"], BAYR: ["drone", "Bayraktar TB2"],
  EP3: ["isr", "EP-3 Aries"], E11: ["isr", "E-11A BACN"], E8: ["isr", "E-8 JSTARS"], WC135: ["isr", "WC-135 Constant Phoenix"],
  GL5T: ["isr", "Gulfstream ISR"], SENT: ["isr", "Sentinel R1"], CL60: ["isr", "Challenger ISR"], SW3: ["isr", "Merlin ISR"],
  // ---- maritime patrol ----
  P8: ["patrol", "P-8 Poseidon"], P3: ["patrol", "P-3 Orion"], P3C: ["patrol", "P-3C Orion"], AT3: ["patrol", "Atlantique 2"], ATL2: ["patrol", "Atlantique 2"],
  // ---- bombers ----
  B52: ["bomber", "B-52 Stratofortress"], B1: ["bomber", "B-1 Lancer"], B2: ["bomber", "B-2 Spirit"], B21: ["bomber", "B-21 Raider"],
  TU95: ["bomber", "Tu-95 Bear"], T160: ["bomber", "Tu-160 Blackjack"], TU22: ["bomber", "Tu-22M Backfire"], H6: ["bomber", "Xian H-6"],
  // ---- fighters ----
  F16: ["fighter", "F-16 Fighting Falcon"], F15: ["fighter", "F-15 Eagle"], F18: ["fighter", "F/A-18 Hornet"], FA18: ["fighter", "F/A-18 Hornet"],
  F22: ["fighter", "F-22 Raptor"], F35: ["fighter", "F-35 Lightning II"], F14: ["fighter", "F-14 Tomcat"], F5: ["fighter", "F-5"], F4: ["fighter", "F-4 Phantom"],
  EUFI: ["fighter", "Eurofighter Typhoon"], TYP: ["fighter", "Eurofighter Typhoon"], RFAL: ["fighter", "Dassault Rafale"], GRIP: ["fighter", "Saab Gripen"],
  MG29: ["fighter", "MiG-29 Fulcrum"], MG31: ["fighter", "MiG-31 Foxhound"], S27: ["fighter", "Su-27 Flanker"], S30: ["fighter", "Su-30 Flanker"],
  S35: ["fighter", "Su-35 Flanker"], S34: ["fighter", "Su-34 Fullback"], S24: ["fighter", "Su-24 Fencer"], S25: ["fighter", "Su-25 Frogfoot"],
  J10: ["fighter", "Chengdu J-10"], J11: ["fighter", "Shenyang J-11"], J20: ["fighter", "Chengdu J-20"], A10: ["fighter", "A-10 Thunderbolt II"],
  AV8B: ["fighter", "AV-8B Harrier II"], JF17: ["fighter", "JF-17 Thunder"], MIR2: ["fighter", "Mirage 2000"], GR4: ["fighter", "Tornado GR4"], TOR: ["fighter", "Panavia Tornado"],
  // ---- transport ----
  C17: ["transport", "C-17 Globemaster III"], C130: ["transport", "C-130 Hercules"], C30J: ["transport", "C-130J Super Hercules"],
  A400: ["transport", "A400M Atlas"], C5M: ["transport", "C-5M Super Galaxy"], C5: ["transport", "C-5 Galaxy"], C27J: ["transport", "C-27J Spartan"],
  AN12: ["transport", "Antonov An-12"], AN26: ["transport", "Antonov An-26"], A124: ["transport", "Antonov An-124"], A225: ["transport", "Antonov An-225"],
  IL76: ["transport", "Ilyushin Il-76"], C295: ["transport", "C-295"], CN35: ["transport", "CN-235"], C160: ["transport", "Transall C-160"], C212: ["transport", "C-212"],
  // ---- helicopters ----
  H60: ["helo", "UH/MH-60 Black Hawk"], S70: ["helo", "S-70 Black Hawk"], H64: ["helo", "AH-64 Apache"], H47: ["helo", "CH-47 Chinook"],
  H53: ["helo", "CH-53"], H1: ["helo", "UH-1 Huey"], EC35: ["helo", "H135"], A139: ["helo", "AW139"], NH90: ["helo", "NH90"],
  MI8: ["helo", "Mil Mi-8"], MI17: ["helo", "Mil Mi-17"], MI24: ["helo", "Mil Mi-24 Hind"], MI28: ["helo", "Mil Mi-28"], KA52: ["helo", "Kamov Ka-52"],
  H225: ["helo", "H225M Caracal"], EH10: ["helo", "AW101 Merlin"], H92: ["helo", "CH-148 Cyclone"],
  // ---- command & control / strategic ----
  E4: ["c2", "E-4B Nightwatch"], E6: ["c2", "E-6B Mercury (TACAMO)"],
  // ---- VIP / head-of-state transport ----
  B748: ["vip", "VC-25 / 747 (state)"], B742: ["vip", "747 (state)"], C32: ["vip", "C-32 (757)"], B752: ["vip", "C-32 (757)"],
  C40: ["vip", "C-40 Clipper (737)"], C37: ["vip", "C-37 Gulfstream"], GLF5: ["vip", "C-37 Gulfstream V"], GLF6: ["vip", "Gulfstream 650"],
  GLF4: ["vip", "C-20 Gulfstream IV"], LJ35: ["vip", "C-21 Learjet"], A319: ["vip", "ACJ319 (state)"], A320: ["vip", "ACJ320 (state)"],
  // ---- trainers ----
  T6: ["trainer", "T-6 Texan II"], T38: ["trainer", "T-38 Talon"], T45: ["trainer", "T-45 Goshawk"], HAWK: ["trainer", "BAE Hawk"],
  PC9: ["trainer", "PC-9"], PC21: ["trainer", "PC-21"], M346: ["trainer", "M-346 Master"], L39: ["trainer", "L-39 Albatros"], K8: ["trainer", "Hongdu K-8"], TEX2: ["trainer", "T-6 Texan II"],
  // ---- light ISR / utility (King Air, Citation, Pilatus families) ----
  B350: ["isr", "King Air 350 ISR / MC-12"], BE20: ["isr", "King Air ISR / C-12"], C12: ["isr", "C-12 Huron"], B300: ["isr", "King Air 350"],
  C560: ["isr", "Citation ISR"], C56X: ["isr", "Citation ISR"], PC12: ["isr", "U-28A Draco"], DHC6: ["transport", "DHC-6 Twin Otter"], B190: ["transport", "Beech 1900"],
  EC45: ["helo", "UH-72 Lakota"], EC30: ["helo", "H125 / AS350"], H125: ["helo", "Airbus H125"], A109: ["helo", "AW109"], B06: ["helo", "Bell 206"], B412: ["helo", "Bell 412"],
};
// Family fallbacks when the exact code isn't mapped (longest prefix wins).
const TYPE_PREFIX = [
  ["E3", ["aew", "E-3 Sentry AWACS"]], ["RC13", ["isr", "RC-135"]], ["F16", ["fighter", "F-16"]], ["F15", ["fighter", "F-15"]],
  ["F35", ["fighter", "F-35"]], ["F18", ["fighter", "F/A-18"]], ["C13", ["transport", "C-130 Hercules"]], ["H60", ["helo", "H-60"]],
  ["MI", ["helo", "Mil helicopter"]], ["KA", ["helo", "Kamov helicopter"]], ["SU", ["fighter", "Sukhoi"]], ["MG", ["fighter", "MiG"]],
];
const CALLSIGN_ROLE = [
  [/^(SHELL|PETRO|GOLD|TEAM|QID|BLUE|TOGA)\d/, "tanker"], [/^(FORTE|HOMER|JAKE|RJ|MAGMA|JANUS)/, "isr"],
  [/^(REACH|RCH|CTM|ASCOT|CFC|GAF|RRR)/, "transport"], [/^(SAM|SPAR|VENUS|VVIP|EXEC)/, "vip"],
  [/^(NATO|MAGIC|SENTRY|DARKSTAR)/, "aew"], [/^(NAVY|ARMY|TRITON|PEACH)/, "patrol"],
];
function classify(typeCode, callsign) {
  const t = (typeCode || "").toUpperCase().trim();
  if (t && TYPE_INFO[t]) return { role: TYPE_INFO[t][0], typeLabel: TYPE_INFO[t][1], type: t };
  if (t) {
    let best = null;
    for (const [pfx, info] of TYPE_PREFIX) if (t.startsWith(pfx) && (!best || pfx.length > best[0].length)) best = [pfx, info];
    if (best) return { role: best[1][0], typeLabel: best[1][1], type: t };
  }
  const cs = (callsign || "").toUpperCase().trim();
  for (const [re, role] of CALLSIGN_ROLE) if (re.test(cs)) return { role, typeLabel: t || "Military aircraft", type: t || null };
  return { role: "mil", typeLabel: t || "Military aircraft", type: t || null };
}

// Free global military ADS-B feeds (no API key). Both expose /mil. We merge and
// dedupe by hex for the widest coverage, then classify each contact.
const MIL_FEEDS = [
  "https://opendata.adsb.fi/api/v2/mil",
  "https://api.airplanes.live/v2/mil",
];
async function fetchMilAir() {
  const settled = await Promise.allSettled(MIL_FEEDS.map((u) =>
    fetch(u, { headers: { "User-Agent": "ObsidianTracker/0.4 (OSINT GIS)" }, signal: AbortSignal.timeout(9000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${u} ${r.status}`))))));
  const byHex = new Map();
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const a of s.value.ac || []) {
      if (a.lat == null || a.lon == null) continue;
      const hex = (a.hex || "").toLowerCase();
      if (!hex || byHex.has(hex)) continue;
      const cls = classify(a.t, a.flight);
      byHex.set(hex, {
        id: hex,
        callsign: (a.flight || "").trim(),
        country: a.r || "",
        lat: a.lat,
        lon: a.lon,
        alt: typeof a.alt_baro === "number" ? a.alt_baro * 0.3048 : null, // ft→m
        onGround: a.alt_baro === "ground",
        velocity: a.gs != null ? a.gs / 1.944 : null, // kt→m/s
        heading: a.track != null ? a.track : (a.true_heading != null ? a.true_heading : 0),
        squawk: a.squawk || null,
        military: true,
        ...cls,
      });
    }
  }
  return [...byHex.values()];
}

app.get("/api/aircraft", async (req, res) => {
  try {
    // Free global military feeds first; fall back to ADSBX (if keyed) then OpenSky.
    let aircraft = [];
    let source = "milfeed";
    try {
      aircraft = await fetchMilAir();
      if (!aircraft.length) throw new Error("empty mil feed");
    } catch (e1) {
      if (process.env.ADSBX_API_KEY) { aircraft = await fetchADSBX(); source = "adsbx"; }
      else { aircraft = await fetchOpenSky(req.query); source = "opensky"; }
    }
    // role breakdown for the client legend / counts
    const roles = {};
    for (const a of aircraft) roles[a.role || "mil"] = (roles[a.role || "mil"] || 0) + 1;
    res.json({ source, count: aircraft.length, roles, aircraft });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
});

/* ------------------------------------------------------------------ *
 *  LIVE EVENTS  —  GDELT 2.0 raw event stream (geolocated, keyless)
 *  Pulls the latest 15-min Events export, keeps "Material Conflict"
 *  (QuadClass 4: assault/fight/mass-violence) rows, aggregates by place.
 * ------------------------------------------------------------------ */
// Minimal single-entry ZIP extractor (GDELT files are one DEFLATE'd CSV).
function unzipSingle(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error("not a zip");
  const method = buf.readUInt16LE(8);
  const compSize = buf.readUInt32LE(18);
  const fnLen = buf.readUInt16LE(26), exLen = buf.readUInt16LE(28);
  const start = 30 + fnLen + exLen;
  const comp = compSize > 0 ? buf.subarray(start, start + compSize) : buf.subarray(start);
  return method === 0 ? comp : zlib.inflateRawSync(comp);
}
// Derive a readable headline from an article URL slug (GDELT export has no title).
function titleFromUrl(u) {
  try {
    const { hostname, pathname } = new URL(u);
    const domain = hostname.replace(/^www\./, "");
    let seg = decodeURIComponent((pathname.split("/").filter(Boolean).pop() || ""));
    seg = seg.replace(/\.(s?html?|php|aspx?|jsp)$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\b(?=\w*\d)(?=\w*[a-z])\w{5,}\b/gi, "")   // drop id-like alphanumeric tokens
      .replace(/\b\d{4,}\b/g, "")                          // drop long numbers / dates
      .replace(/\s+/g, " ").trim();
    let title = seg.length > 6 ? seg.charAt(0).toUpperCase() + seg.slice(1) : domain;
    if (title.length > 90) title = title.slice(0, 88) + "…";
    return { url: u, domain, title };
  } catch { return { url: u, domain: "", title: String(u).slice(0, 60) }; }
}
let eventsCache = { ts: 0, data: null };
app.get("/api/events", async (req, res) => {
  try {
    if (eventsCache.data && Date.now() - eventsCache.ts < 10 * 60 * 1000) return res.json(eventsCache.data);
    const lu = await (await fetch("http://data.gdeltproject.org/gdeltv2/lastupdate.txt", { signal: AbortSignal.timeout(8000) })).text();
    const line = lu.split("\n").find((l) => /export\.CSV\.zip/i.test(l));
    if (!line) throw new Error("no export file listed");
    const url = line.trim().split(/\s+/).pop();
    const buf = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(15000) })).arrayBuffer());
    const csv = unzipSingle(buf).toString("utf8");
    const agg = new Map();
    for (const row of csv.split("\n")) {
      if (!row) continue;
      const c = row.split("\t");
      if (c.length < 59 || c[29] !== "4") continue;           // QuadClass 4 = material conflict
      const lat = parseFloat(c[56]), lon = parseFloat(c[57]);
      if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) continue;
      const arts = parseInt(c[33], 10) || 1;                  // NumArticles
      const surl = (c[60] || "").trim();                      // SOURCEURL
      const key = c[58] || lat.toFixed(2) + "," + lon.toFixed(2);
      const cur = agg.get(key);
      if (cur) { cur.count += arts; if (surl) cur.urls.add(surl); }
      else agg.set(key, { lat, lon, name: c[52] || c[53] || "", count: arts, urls: new Set(surl ? [surl] : []) });
    }
    const events = [...agg.values()].sort((a, b) => b.count - a.count).slice(0, 400)
      .map((e) => ({ lat: e.lat, lon: e.lon, name: e.name, count: e.count, articles: [...e.urls].slice(0, 6).map(titleFromUrl) }));
    const out = { source: "gdelt-events", count: events.length, events };
    eventsCache = { ts: Date.now(), data: out };
    res.json(out);
  } catch (e) {
    res.status(502).json({ error: "events: " + String(e.message || e) });
  }
});

/* ------------------------------------------------------------------ *
 *  MILITARY BASES  —  OpenStreetMap via Overpass API
 * ------------------------------------------------------------------ */

const baseCache = new Map(); // bboxKey -> { ts, data }
const BASE_TTL = 10 * 60 * 1000;

// Overpass is frequently overloaded — try several mirrors in order, first win.
const OVERPASS_MIRRORS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
async function overpassFetch(q) {
  let lastErr;
  for (const url of OVERPASS_MIRRORS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 18000);
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "ObsidianTracker/0.3 (OSINT GIS)" },
        body: "data=" + encodeURIComponent(q),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!r.ok) { lastErr = new Error(`${url} -> ${r.status}`); continue; }
      return await r.json();
    } catch (e) { lastErr = e; continue; }
  }
  throw lastErr || new Error("all Overpass mirrors unreachable");
}

app.get("/api/bases", async (req, res) => {
  const { lamin, lomin, lamax, lomax } = req.query;
  if (!lamin || !lomin || !lamax || !lomax)
    return res.status(400).json({ error: "bbox required" });
  const key = `${lamin},${lomin},${lamax},${lomax}`;
  const cached = baseCache.get(key);
  if (cached && Date.now() - cached.ts < BASE_TTL) return res.json(cached.data);

  // landuse=military, military=*, and aeroway military airfields
  const q = `
    [out:json][timeout:25];
    (
      way["landuse"="military"](${lamin},${lomin},${lamax},${lomax});
      relation["landuse"="military"](${lamin},${lomin},${lamax},${lomax});
      node["military"](${lamin},${lomin},${lamax},${lomax});
      way["military"](${lamin},${lomin},${lamax},${lomax});
    );
    out center tags 800;`;
  try {
    const data = await overpassFetch(q);
    const bases = (data.elements || [])
      .map((el) => {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (lat == null || lon == null) return null;
        const t = el.tags || {};
        return {
          id: `${el.type}/${el.id}`,
          lat, lon,
          name: t.name || t["name:en"] || t.military || "Military area",
          kind: t.military || t.landuse || "military",
          operator: t.operator || null,
        };
      })
      .filter(Boolean);
    const payload = { count: bases.length, bases };
    baseCache.set(key, { ts: Date.now(), data: payload });
    res.json(payload);
  } catch (e) {
    res.status(503).json({ error: "OSM detail unavailable (Overpass down) — curated bases shown", detail: String(e.message || e) });
  }
});

/* ------------------------------------------------------------------ *
 *  SHIPS  —  aisstream.io  live AIS websocket (military highlighted)
 * ------------------------------------------------------------------ */

const ships = new Map(); // mmsi -> { lat, lon, name, type, mil, ts }
const SHIP_TTL = 30 * 60 * 1000;
const SHIP_CAP = 30000;

function pruneShips() {
  const now = Date.now();
  for (const [mmsi, s] of ships) if (now - s.ts > SHIP_TTL) ships.delete(mmsi);
  if (ships.size > SHIP_CAP) {
    const sorted = [...ships.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < sorted.length - SHIP_CAP; i++) ships.delete(sorted[i][0]);
  }
}
setInterval(pruneShips, 60 * 1000).unref();

function connectAIS() {
  const key = process.env.AISSTREAM_API_KEY;
  if (!key) {
    console.log("[ais] no AISSTREAM_API_KEY — ships layer disabled.");
    return;
  }
  const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
  ws.on("open", () => {
    console.log("[ais] connected");
    ws.send(JSON.stringify({
      APIKey: key,
      BoundingBoxes: [[[-90, -180], [90, 180]]],
      FilterMessageTypes: ["PositionReport", "ShipStaticData"],
    }));
  });
  ws.on("message", (buf) => {
    try {
      const m = JSON.parse(buf.toString());
      const meta = m.MetaData || {};
      const mmsi = meta.MMSI || meta.mmsi;
      if (!mmsi) return;
      const prev = ships.get(mmsi) || {};
      if (m.MessageType === "PositionReport") {
        const p = m.Message.PositionReport;
        ships.set(mmsi, {
          ...prev,
          lat: p.Latitude, lon: p.Longitude,
          name: prev.name || (meta.ShipName || "").trim(),
          ts: Date.now(),
        });
      } else if (m.MessageType === "ShipStaticData") {
        const d = m.Message.ShipStaticData;
        const type = d.Type; // 35 = "Military ops"
        ships.set(mmsi, {
          ...prev,
          name: (d.Name || meta.ShipName || prev.name || "").trim(),
          type,
          mil: type === 35,
          ts: prev.ts || Date.now(),
        });
      }
    } catch { /* ignore malformed frames */ }
  });
  ws.on("close", () => { console.log("[ais] closed, reconnecting in 5s"); setTimeout(connectAIS, 5000); });
  ws.on("error", (e) => { console.log("[ais] error", e.message); ws.close(); });
}

// --- Sample fleet (shown when no live AIS key is configured) ---
// Plausible vessels across busy maritime regions so the layer, clustering and
// military highlighting are visible immediately. NOT real positions.
const SERVER_START = Date.now();
const DEMO = [
  ["USS ARLEIGH-class DDG", 1, 26.6, 52.1, 120, 28], ["TANKER HORIZON", 0, 26.9, 51.6, 300, 16],
  ["IRIN ALVAND FRIGATE", 1, 26.5, 56.3, 200, 20], ["FS FREMM", 1, 34.6, 33.2, 90, 24],
  ["BULK CARRIER OCEANIA", 0, 34.0, 32.0, 75, 18], ["RFN SLAVA CRUISER", 1, 34.9, 35.4, 180, 15],
  ["PLAN TYPE-052D", 1, 15.2, 114.0, 160, 26], ["MAERSK CONTAINER", 0, 14.0, 113.0, 210, 22],
  ["ROCN KANG DING", 1, 24.4, 119.3, 30, 20], ["PLAN TYPE-056", 1, 24.7, 119.8, 210, 18],
  ["HMS TYPE-23", 1, 50.3, 1.2, 240, 22], ["CH FERRY PRIDE", 0, 50.5, 0.8, 60, 28],
  ["TANKER NORTHSTAR", 0, 54.2, 3.4, 10, 16], ["USS NIMITZ-class CVN", 1, 36.7, -74.8, 100, 30],
  ["USNS OILER", 1, 36.9, -75.2, 120, 18], ["CARGO ATLANTIC", 0, 37.2, -74.5, 80, 20],
  ["JMSDF KONGO DDG", 1, 39.2, 135.2, 20, 24], ["ROKN SEJONG DDG", 1, 38.5, 134.0, 340, 20],
  ["RFN STEREGUSHCHY", 1, 55.4, 18.7, 80, 18], ["FGS SACHSEN F124", 1, 55.7, 18.0, 260, 20],
  ["TCG GABYA FRIGATE", 1, 43.6, 32.0, 150, 22], ["IN KOLKATA DDG", 1, 18.2, 64.0, 240, 26],
  ["VLCC GULF STAR", 0, 17.5, 63.0, 300, 14], ["EUNAVFOR FRIGATE", 1, 12.6, 46.2, 90, 22],
  ["COSCO CONTAINER", 0, 12.3, 45.5, 75, 20], ["ITS ORIZZONTE DDG", 1, 38.2, 5.5, 200, 22],
  ["PLAN TYPE-054A", 1, 10.5, 115.2, 0, 18], ["USS LOS ANGELES SSN", 1, 21.1, -158.2, 180, 12],
  ["USS LCS INDEPENDENCE", 1, 13.3, 144.9, 90, 28], ["BULK MED TRADER", 0, 35.2, 18.5, 110, 16],
  ["RAN ANZAC FFH", 1, -32.1, 115.6, 270, 22],
];
const rad = (d) => (d * Math.PI) / 180;
function getDemoShips() {
  const hrs = (Date.now() - SERVER_START) / 3.6e6;
  return DEMO.map((d, i) => {
    const [name, mil, lat0, lon0, hdg, spd] = d;
    const km = spd * hrs; // slow drift along heading
    const lat = lat0 + (km * Math.cos(rad(hdg))) / 111;
    const lon = lon0 + (km * Math.sin(rad(hdg))) / (111 * Math.cos(rad(lat0)));
    return { mmsi: 900000001 + i, name, military: !!mil, heading: hdg, lat, lon };
  });
}

app.get("/api/ships", (req, res) => {
  const { lamin, lomin, lamax, lomax } = req.query;
  const milOnly = req.query.mil === "1";
  const live = !!process.env.AISSTREAM_API_KEY;
  let list;
  if (live) {
    list = [];
    for (const [mmsi, s] of ships) {
      if (s.lat == null) continue;
      list.push({ mmsi, lat: s.lat, lon: s.lon, name: s.name, military: !!s.mil });
    }
  } else {
    list = getDemoShips();
  }
  const out = list.filter((s) => {
    if (lamin && (s.lat < +lamin || s.lat > +lamax || s.lon < +lomin || s.lon > +lomax)) return false;
    if (milOnly && !s.military) return false;
    return true;
  });
  res.json({ enabled: true, live, demo: !live, count: out.length, total: list.length, ships: out.slice(0, 5000) });
});

/* ------------------------------------------------------------------ */

app.listen(PORT, () => {
  console.log(`\n  ▰ OBSIDIAN  →  http://localhost:${PORT}\n`);
  connectAIS();
});
