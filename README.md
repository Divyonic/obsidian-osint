# OBSIDIAN

**A real-time OSINT military common-operating-picture on a 3D globe.**

OBSIDIAN aggregates *publicly broadcast* military-relevant signals — aircraft, vessels, bases, and live conflict events — onto a single interactive globe with a tactical HUD. Everything it shows is open data, legally collected: the same category of signal behind FlightRadar24, MarineTraffic, and ADSB-Exchange. No keys are required to run it.

> Built by [Drexon Industries](https://drexonindustries.com). Node/Express backend, MapLibre GL JS frontend, zero build step.

---

## What it shows

| Layer | Source | Detail |
|---|---|---|
| ✈️ **Military aircraft** | Free global `/mil` feeds: [adsb.fi](https://adsb.fi) + [airplanes.live](https://airplanes.live), merged & deduped | Live ADS-B, classified by ICAO type code into 12 roles (tanker, AEW, ISR, fighter, bomber, transport, drone, VIP, C2, helo, patrol, trainer) with role-colored icons and a live legend |
| 🛡️ **Military bases** | OpenStreetMap (`military=*`, `landuse=military`) | ~70k installations, attributed to country via **OSM-derived 1-metre borders** (not Natural Earth — NE misplaces disputed borders). Click a base for curated order-of-battle + a live "aircraft on ground" count from ADS-B |
| 🌍 **Foreign / overseas bases** | Curated dataset | 70 installations where the operating nation ≠ the host country, colored by operator |
| 🔥 **Live conflict events** | [GDELT](https://www.gdeltproject.org) 15-min event stream | Material-conflict hotspots aggregated by location. Click a hotspot to read the **actual source news articles** behind it |
| 🚢 **Vessels** | [aisstream.io](https://aisstream.io) (optional key) | Live AIS; military-ops type highlighted. Falls back to a sample fleet without a key |

**Basemaps:** Tactical (dark ops) · Satellite (Esri/Maxar imagery, sub-metre in developed areas) · Sentinel (Sentinel-2 cloudless, ~10 m, keyless) · Terrain.

**Interface:** amber-on-black tactical HUD · contact trails · auto-orbit · measure-distance · range rings (100/250/500/1000 km) · country/rating base filters · live contact counters · one-click GeoJSON export of the current view · responsive collapsible panel (drawer on mobile).

---

## Run

```bash
git clone git@github.com:Divyonic/obsidian-osint.git
cd obsidian-osint
npm install
npm start                 # → http://localhost:8080
```

Everything works with **zero API keys** — military aircraft, bases, foreign bases, and live conflict events are all keyless. Optional keys unlock more:

```bash
cp .env.example .env
```

| Key | Unlocks |
|---|---|
| `AISSTREAM_API_KEY` | Live AIS vessel layer ([free](https://aisstream.io)) |
| `ADSBX_API_KEY` | Authoritative ADSB-Exchange military feed (fallback) |
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | Higher OpenSky rate limits (fallback feed) |

> Requires Node 18+ (built on Node 25). No build step, no bundler.

---

## Architecture

```
 Browser  (MapLibre GL JS · globe projection · tactical HUD)
    │   /api/aircraft   /api/bases   /api/events   /api/ships
    ▼
 Node / Express  ──►  adsb.fi + airplanes.live  /mil   (pull, merged & deduped)
                 ──►  GDELT 15-min event export        (pull + unzip + 10-min cache)
                 ──►  aisstream.io WebSocket            (persistent stream → in-memory)
                 ──►  static GeoJSON (bases, borders, foreign bases)
```

**Endpoints**

- `GET /api/aircraft` — live military aircraft + per-role counts
- `GET /api/bases?bbox=…` — OSM military bases for the viewport
- `GET /api/events` — GDELT conflict hotspots with source-article links
- `GET /api/ships` — live AIS (or sample fleet)

### Data accuracy decisions (the non-obvious parts)

- **Country attribution uses OSM-derived 1 m coastline borders**, not Natural Earth. NE disagrees with OSM at disputed frontiers (e.g. it places a Pakistani post ~17 km inside India). Build pipeline: `build_countries.mjs` (point-in-polygon + coast-snap). 99.84% of bases resolved.
- **Aircraft roles** are derived from ICAO type codes in `server.js`, not callsign guessing.
- **GDELT's hosted GEO 2.0 API is dead (404).** OBSIDIAN instead pulls the raw 15-min Events export (`lastupdate.txt` → `export.CSV.zip`), unzips it in-process, keeps material-conflict rows, and aggregates by location — giving you the underlying news URLs the hosted API never exposed.

### Regenerating the datasets

The runtime GeoJSON in `public/` is committed, so the app runs immediately after clone. The heavy source data (`data/`, including a 106 MB OSM boundary file) is **not** in the repo — regenerate it with the build scripts:

```bash
node build_countries.mjs   # country borders + base attribution
node build_bases.mjs       # OSM military bases → public/bases_global.geojson
node build_foreign.mjs     # curated overseas-base dataset
```

---

## What this honestly cannot do

| | Why |
|---|---|
| **Submarines, real-time** | Submerged subs emit nothing trackable — that's the entire point of a submarine. Open data only ever shows surfaced/in-port sightings. |
| **Most drones** | The majority of military UAVs don't broadcast ADS-B. The few that do appear in the aircraft layer like any other contact. |
| **Warships running dark** | Combatants routinely disable or spoof AIS. You see auxiliaries, logistics, and ships that *choose* to transmit — never a complete order of battle. |
| **Personnel / weapon counts** | Not open data. Base popups show curated public order-of-battle plus live on-ground aircraft — nothing classified. |

Anyone offering a live, complete feed of every sub and stealth asset on earth is guessing or lying. OBSIDIAN is deliberately scoped to what is real and verifiable.

---

## License

MIT. Use responsibly and lawfully. All data sources are open and credited above.
