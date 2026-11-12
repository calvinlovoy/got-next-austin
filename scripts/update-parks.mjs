#!/usr/bin/env node
// Refreshes the PARK_DATA block in index.html from the City of Austin parks facility inventory.
// Runs weekly from .github/workflows/refresh.yml. Writes nothing unless the new data passes its checks.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SRC = "https://services.arcgis.com/0L95CJ0VTaxqcmED/ArcGIS/rest/services/pard_facility_points/FeatureServer/0/query";
const WHERE = "(ASSET_CLASS='8' AND ASSET_TYPE IN ('Tennis','Futsal','Volleyball','Basketball','Multipurpose','Pickleball')) OR (ASSET_CLASS='10' AND ASSET_TYPE IN ('Soccer','Mixed Use Field'))";
const FIELDS = "PARK_NAME,ASSET_NAME,ADDRESS,ASSET_TYPE,DESCRIPTION,ASSET_STATUS,RESERVATIONS";
const clean = s => String(s || "").replace(/[|`]/g, "").replace(/\$\{/g, "").replace(/\s+/g, " ").trim();

// One line per park: name|address|lat|lon|tennis dedicated.shared|pickleball dedicated.shared|basketball|volleyball (n = no net)|
// soccer fields.multipurpose fields.mini pitches|lit sports|flags (F all fee, f some fee, R restricted, Y reservable)
export function reduce(features) {
  const P = {};
  for (const f of features) {
    const a = f.attributes || {}, g = f.geometry;
    if (a.ASSET_STATUS === "Closed" || !g || !isFinite(g.x) || !isFinite(g.y)) continue;
    const k = clean(a.PARK_NAME);
    if (!k) continue;
    const v = P[k] || (P[k] = { name: k, addr: "", lats: [], lons: [], tD: 0, tS: 0, pD: 0, pS: 0, b: 0, v: 0, vNet: false, sF: 0, sM: 0, sP: 0, lit: new Set(), fee: 0, restr: 0, resv: 0, n: 0 });
    const D = a.DESCRIPTION || "", T = a.ASSET_TYPE, L = /Lights/i.test(D);
    v.n++; v.lats.push(g.y); v.lons.push(g.x);
    if (!v.addr && a.ADDRESS) v.addr = clean(String(a.ADDRESS).replace(/,?\s*Austin,?\s*Tex\w*\.?\s*/i, " ").replace(/\./g, ""));
    if (a.ASSET_STATUS === "Open Fee") v.fee++;
    if (a.ASSET_STATUS === "Open Restricted") v.restr++;
    if (a.RESERVATIONS === "Yes") v.resv++;
    if (T === "Tennis") { v.tD++; L && v.lit.add("t"); }
    else if (T === "Pickleball") { v.pD++; L && v.lit.add("p"); }
    else if (T === "Basketball") { v.b++; L && v.lit.add("b"); }
    else if (T === "Volleyball") { v.v++; if (/Net/i.test(D)) v.vNet = true; L && v.lit.add("v"); }
    else if (T === "Futsal") { v.sP++; L && v.lit.add("s"); }
    else if (T === "Soccer") { v.sF++; L && v.lit.add("s"); }
    else if (T === "Mixed Use Field") { v.sM++; L && v.lit.add("s"); }
    else if (T === "Multipurpose") {
      let x;
      if ((x = D.match(/(\d+)\s+(?:QuickStart\s+)?Tennis/i))) { v.tS += +x[1]; L && v.lit.add("t"); }
      if ((x = D.match(/(\d+)\s+Pickleball/i))) { v.pS += +x[1]; L && v.lit.add("p"); }
      if (/Basketball/i.test(D)) { v.b++; L && v.lit.add("b"); }
      if (/Volleyball/i.test(D)) { v.v++; if (/Net/i.test(D)) v.vNet = true; L && v.lit.add("v"); }
    }
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  return Object.values(P)
    .filter(v => v.tD + v.tS + v.pD + v.pS + v.b + v.v + v.sF + v.sM + v.sP > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(v => [v.name, v.addr, avg(v.lats).toFixed(4), avg(v.lons).toFixed(4), v.tD + "." + v.tS, v.pD + "." + v.pS, v.b,
      v.v + (v.v && !v.vNet ? "n" : ""), v.sF + "." + v.sM + "." + v.sP, [...v.lit].join(""),
      (v.fee ? (v.fee === v.n ? "F" : "f") : "") + (v.restr ? "R" : "") + (v.resv ? "Y" : "")].join("|"));
}

export function validate(lines, previousCount, minParks = 80) {
  if (lines.length < minParks) return `only ${lines.length} parks came back (expected at least ${minParks})`;
  if (previousCount && Math.abs(lines.length - previousCount) / previousCount > 0.25) return `park count moved from ${previousCount} to ${lines.length}, which is more than 25%`;
  for (const l of lines) {
    const p = l.split("|");
    if (p.length !== 11) return `bad line: ${l}`;
    const lat = +p[2], lon = +p[3];
    if (!(lat > 29.9 && lat < 30.7 && lon > -98.2 && lon < -97.4)) return `coordinates outside the Austin area: ${l}`;
  }
  return null;
}

async function load() {
  if (process.env.PARKS_SOURCE_FILE) return JSON.parse(readFileSync(process.env.PARKS_SOURCE_FILE, "utf8"));
  const all = [];
  for (let offset = 0; offset < 20000;) {
    const url = `${SRC}?where=${encodeURIComponent(WHERE)}&outFields=${FIELDS}&returnGeometry=true&outSR=4326&resultOffset=${offset}&resultRecordCount=1000&f=json`;
    const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`inventory request failed with status ${r.status}`);
    const j = await r.json();
    if (j.error) throw new Error(`inventory error: ${JSON.stringify(j.error).slice(0, 200)}`);
    all.push(...(j.features || []));
    if (!j.exceededTransferLimit || !(j.features || []).length) break;
    offset += j.features.length;
  }
  return all;
}

async function main() {
  const out = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  const html = readFileSync("index.html", "utf8");
  const m = html.match(/(const PARK_DATA=`\n)([\s\S]*?)(\n`;)/);
  if (!m) throw new Error("PARK_DATA block not found in index.html");
  const before = m[2].split("\n");
  const lines = reduce(await load());
  const problem = validate(lines, before.length, +process.env.MIN_PARKS || 80);
  if (problem) throw new Error(`New park data rejected: ${problem}`);
  if (lines.join("\n") === m[2]) { console.log(`Parks unchanged (${lines.length}).`); out("changed", "false"); return; }
  const names = a => new Set(a.map(l => l.split("|")[0]));
  const was = names(before), now = names(lines);
  console.log(`Parks updated: ${before.length} -> ${lines.length}`);
  console.log("Added:", [...now].filter(n => !was.has(n)).join("; ") || "none");
  console.log("Removed:", [...was].filter(n => !now.has(n)).join("; ") || "none");
  const stamp = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });
  const next = html.replace(m[0], () => m[1] + lines.join("\n") + m[3]).replace(/pulled [A-Z][a-z]{2} \d{1,2}, \d{4}/, `pulled ${stamp}`);
  writeFileSync("index.html", next);
  out("changed", "true");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exit(1); });
