// Curated dataset of overseas / foreign military installations — a base whose
// OPERATING nation differs from its HOST country. This is the strategically
// significant "force projection" picture (US/RU/FR/UK/CN/TR/AE/IN abroad).
// Each entry: [name, type, opA2, opName, hostA2, hostName, lon, lat]
import { writeFileSync } from "node:fs";

const E = [
  // ===== United States =====
  ["Ramstein Air Base", "air", "US", "United States", "DE", "Germany", 7.600, 49.437],
  ["Spangdahlem Air Base", "air", "US", "United States", "DE", "Germany", 6.6925, 49.9727],
  ["USAG Stuttgart (EUCOM/AFRICOM HQ)", "hq", "US", "United States", "DE", "Germany", 9.234, 48.728],
  ["Grafenwöhr Training Area", "training", "US", "United States", "DE", "Germany", 11.94, 49.70],
  ["RAF Lakenheath", "air", "US", "United States", "GB", "United Kingdom", 0.561, 52.409],
  ["RAF Mildenhall", "air", "US", "United States", "GB", "United Kingdom", 0.486, 52.361],
  ["RAF Fairford", "air", "US", "United States", "GB", "United Kingdom", -1.790, 51.682],
  ["Aviano Air Base", "air", "US", "United States", "IT", "Italy", 12.596, 46.031],
  ["NAS Sigonella", "naval", "US", "United States", "IT", "Italy", 14.922, 37.401],
  ["Caserma Ederle (Vicenza)", "hq", "US", "United States", "IT", "Italy", 11.553, 45.561],
  ["Camp Darby", "logistics", "US", "United States", "IT", "Italy", 10.45, 43.66],
  ["Naval Station Rota", "naval", "US", "United States", "ES", "Spain", -6.349, 36.645],
  ["Morón Air Base", "air", "US", "United States", "ES", "Spain", -5.617, 37.175],
  ["Incirlik Air Base", "air", "US", "United States", "TR", "Turkey", 35.426, 37.002],
  ["NSA Souda Bay", "naval", "US", "United States", "GR", "Greece", 24.149, 35.533],
  ["Pituffik Space Base (Thule)", "space", "US", "United States", "GL", "Greenland", -68.703, 76.531],
  ["Camp Bondsteel", "fob", "US", "United States", "XK", "Kosovo", 21.283, 42.366],
  ["SHAPE / Chièvres AB", "hq", "US", "United States", "BE", "Belgium", 3.831, 50.575],
  ["Al Udeid Air Base", "air", "US", "United States", "QA", "Qatar", 51.315, 25.117],
  ["Al Dhafra Air Base", "air", "US", "United States", "AE", "UAE", 54.547, 24.248],
  ["Ali Al Salem Air Base", "air", "US", "United States", "KW", "Kuwait", 47.520, 29.347],
  ["Camp Arifjan", "logistics", "US", "United States", "KW", "Kuwait", 48.158, 28.870],
  ["NSA Bahrain (US 5th Fleet)", "naval", "US", "United States", "BH", "Bahrain", 50.612, 26.211],
  ["Camp Lemonnier", "fob", "US", "United States", "DJ", "Djibouti", 43.146, 11.547],
  ["Camp Humphreys (USFK HQ)", "hq", "US", "United States", "KR", "South Korea", 127.030, 36.964],
  ["Osan Air Base", "air", "US", "United States", "KR", "South Korea", 127.030, 37.090],
  ["Kunsan Air Base", "air", "US", "United States", "KR", "South Korea", 126.616, 35.903],
  ["Kadena Air Base", "air", "US", "United States", "JP", "Japan", 127.767, 26.356],
  ["MCAS Futenma", "air", "US", "United States", "JP", "Japan", 127.755, 26.272],
  ["Yokota Air Base", "air", "US", "United States", "JP", "Japan", 139.348, 35.748],
  ["Misawa Air Base", "air", "US", "United States", "JP", "Japan", 141.368, 40.703],
  ["Fleet Activities Yokosuka", "naval", "US", "United States", "JP", "Japan", 139.662, 35.293],
  ["Sasebo Naval Base", "naval", "US", "United States", "JP", "Japan", 129.715, 33.160],
  ["MCAS Iwakuni", "air", "US", "United States", "JP", "Japan", 132.236, 34.146],
  ["Naval Support Facility Diego Garcia", "naval", "US", "United States", "IO", "British Indian Ocean Terr.", 72.411, -7.313],
  ["Pine Gap (joint SIGINT)", "sigint", "US", "United States", "AU", "Australia", 133.737, -23.799],
  ["NCS Harold E. Holt", "sigint", "US", "United States", "AU", "Australia", 114.166, -21.816],
  ["Soto Cano Air Base", "air", "US", "United States", "HN", "Honduras", -87.621, 14.382],
  ["Guantanamo Bay Naval Station", "naval", "US", "United States", "CU", "Cuba", -75.140, 19.902],
  // ===== Russia =====
  ["Khmeimim Air Base", "air", "RU", "Russia", "SY", "Syria", 35.948, 35.401],
  ["Tartus Naval Base", "naval", "RU", "Russia", "SY", "Syria", 35.870, 34.895],
  ["102nd Military Base Gyumri", "fob", "RU", "Russia", "AM", "Armenia", 43.840, 40.787],
  ["Kant Air Base", "air", "RU", "Russia", "KG", "Kyrgyzstan", 74.846, 42.853],
  ["201st Military Base", "fob", "RU", "Russia", "TJ", "Tajikistan", 68.78, 38.55],
  ["Baikonur Cosmodrome (leased)", "space", "RU", "Russia", "KZ", "Kazakhstan", 63.342, 45.965],
  ["Operational Group of Russian Forces", "fob", "RU", "Russia", "MD", "Moldova (Transnistria)", 29.48, 47.20],
  ["Black Sea Fleet, Sevastopol", "naval", "RU", "Russia", "UA", "Ukraine (Crimea)", 33.53, 44.62],
  // ===== France =====
  ["Base aérienne 188 Djibouti", "air", "FR", "France", "DJ", "Djibouti", 43.159, 11.547],
  ["Forces françaises (Camp de la Paix)", "naval", "FR", "France", "AE", "UAE", 54.55, 24.50],
  ["Camp de Port-Bouët", "fob", "FR", "France", "CI", "Côte d'Ivoire", -3.93, 5.26],
  ["Base Kosseï N'Djamena", "air", "FR", "France", "TD", "Chad", 15.034, 12.131],
  ["Éléments français au Sénégal", "fob", "FR", "France", "SN", "Senegal", -17.49, 14.74],
  ["Camp De Gaulle, Libreville", "fob", "FR", "France", "GA", "Gabon", 9.41, 0.46],
  // ===== United Kingdom =====
  ["RAF Akrotiri", "air", "GB", "United Kingdom", "CY", "Cyprus", 32.987, 34.590],
  ["Dhekelia Garrison", "fob", "GB", "United Kingdom", "CY", "Cyprus", 33.70, 34.99],
  ["UK Naval Support Facility (HMS Juffair)", "naval", "GB", "United Kingdom", "BH", "Bahrain", 50.61, 26.21],
  ["BATUK (British Army Training Unit)", "training", "GB", "United Kingdom", "KE", "Kenya", 37.10, -0.05],
  ["British Forces Brunei Garrison", "fob", "GB", "United Kingdom", "BN", "Brunei", 114.93, 4.92],
  ["UK Joint Logistics Support Base Duqm", "naval", "GB", "United Kingdom", "OM", "Oman", 57.70, 19.67],
  // ===== China =====
  ["PLA Support Base Djibouti", "naval", "CN", "China", "DJ", "Djibouti", 43.07, 11.59],
  ["Ream Naval Base (PLA access)", "naval", "CN", "China", "KH", "Cambodia", 103.62, 10.51],
  // ===== Turkey =====
  ["Camp TURKSOM, Mogadishu", "training", "TR", "Turkey", "SO", "Somalia", 45.30, 2.01],
  ["Qatar-Turkey Combined Joint Force Cmd", "fob", "TR", "Turkey", "QA", "Qatar", 51.49, 25.32],
  ["Al-Watiya Air Base", "air", "TR", "Turkey", "LY", "Libya", 11.22, 32.0],
  ["Turkish Forces, Northern Cyprus", "fob", "TR", "Turkey", "CY", "Cyprus", 33.36, 35.18],
  // ===== UAE =====
  ["Assab Base", "air", "AE", "UAE", "ER", "Eritrea", 42.65, 13.07],
  ["Berbera Base", "air", "AE", "UAE", "SO", "Somalia (Somaliland)", 44.94, 10.39],
  // ===== India =====
  ["Ayni / Farkhor Air Base", "air", "IN", "India", "TJ", "Tajikistan", 68.81, 38.54],
  ["INS overseas facility, Agalega", "naval", "IN", "India", "MU", "Mauritius", 56.61, -10.42],
  // ===== Iran =====
  ["Tiyas (T-4) Air Base (IRGC presence)", "air", "IR", "Iran", "SY", "Syria", 37.63, 34.52],
];

const TYPE_LABEL = { air: "Air base", naval: "Naval base", hq: "HQ / command", logistics: "Logistics hub", sigint: "SIGINT / listening", fob: "Forward operating base", training: "Training facility", space: "Space / missile-warning", drone: "Drone base" };

// Curated PUBLIC order-of-battle for well-documented installations (approximate,
// from open sources — not precise/current counts). Obscure sites have none.
const OB = {
  "Ramstein Air Base": { garrison: "9,000 personnel", units: "86th Airlift Wing · USAFE-AFAFRICA HQ", basedAircraft: "C-130J, C-21, C-37, C-40" },
  "Al Udeid Air Base": { garrison: "8,000–10,000", units: "379th Air Expeditionary Wing · CENTCOM fwd HQ", basedAircraft: "KC-135, E-8, rotational bombers" },
  "Kadena Air Base": { garrison: "18,000 (base pop.)", units: "18th Wing", basedAircraft: "F-15 (rotational), KC-135, E-3, RC-135" },
  "Camp Humphreys (USFK HQ)": { garrison: "36,000 (largest US base abroad)", units: "Eighth Army · USFK HQ", basedAircraft: "AH-64, CH-47, UH-60" },
  "Fleet Activities Yokosuka": { garrison: "24,000 incl. dependents", units: "US 7th Fleet HQ", basedAircraft: "carrier strike group homeport" },
  "Incirlik Air Base": { units: "39th Air Base Wing", basedAircraft: "KC-135 (rotational)" },
  "Naval Station Rota": { units: "US Navy / NAVFAC", basedAircraft: "4× Arleigh Burke DDGs, P-8" },
  "Aviano Air Base": { units: "31st Fighter Wing", basedAircraft: "F-16C/D" },
  "RAF Lakenheath": { units: "48th Fighter Wing", basedAircraft: "F-15E, F-35A" },
  "RAF Mildenhall": { units: "100th ARW · 352d SOW", basedAircraft: "KC-135, CV-22, MC-130" },
  "NAS Sigonella": { units: "US Navy / NATO ISR hub", basedAircraft: "P-8, MQ-4C, MQ-9" },
  "Naval Support Facility Diego Garcia": { units: "Navy Support Facility", basedAircraft: "rotational B-52/B-2, P-8, KC-135" },
  "Misawa Air Base": { units: "35th Fighter Wing", basedAircraft: "F-16CM, P-8 (US/JMSDF)" },
  "Osan Air Base": { units: "51st Fighter Wing", basedAircraft: "F-16, A-10, U-2" },
  "Kunsan Air Base": { units: "8th Fighter Wing", basedAircraft: "F-16C/D" },
  "Camp Lemonnier": { garrison: "4,000", units: "CJTF-Horn of Africa", basedAircraft: "P-8, ISR drones (rotational)" },
  "NSA Bahrain (US 5th Fleet)": { units: "US 5th Fleet / NAVCENT HQ", basedAircraft: "patrol craft, MH-60" },
  "Pituffik Space Base (Thule)": { units: "Space Base Delta · missile warning", basedAircraft: "BMEWS radar; no based aircraft" },
  "Khmeimim Air Base": { units: "Russian Aerospace Forces", basedAircraft: "Su-34, Su-35, Su-24, Mi-8/24" },
  "Tartus Naval Base": { units: "Russian Navy logistics point", basedAircraft: "naval combatants (rotational)" },
  "RAF Akrotiri": { units: "Sovereign Base · 84 Sqn", basedAircraft: "Typhoon (rotational), helicopters" },
  "PLA Support Base Djibouti": { garrison: "1,000–2,000", units: "PLA Navy", basedAircraft: "naval logistics" },
  "Base aérienne 188 Djibouti": { units: "Forces françaises à Djibouti", basedAircraft: "Mirage 2000 (historically)" },
};

const fc = {
  type: "FeatureCollection",
  features: E.map(([name, type, op, opName, host, hostName, lon, lat]) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: { name, type, typeLabel: TYPE_LABEL[type] || type, op, opName, host, hostName, kind: "foreign", ...(OB[name] || {}) },
  })),
};
writeFileSync("public/foreign_bases.geojson", JSON.stringify(fc));
const byOp = {};
for (const f of fc.features) byOp[f.properties.op] = (byOp[f.properties.op] || 0) + 1;
console.log(`wrote ${fc.features.length} foreign installations`);
console.log("by operator:", Object.entries(byOp).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ":" + v).join(" "));
