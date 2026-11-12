#!/usr/bin/env node
// Loads the data part of index.html the way a browser would and fails if the venue list is broken.
// The weekly refresh runs this before saving anything, so a bad data pull can't blank the site.
import { loadApp } from "./lib.mjs";

const fail = msg => { console.error("Smoke check failed: " + msg); process.exit(1); };
let o;
try { o = loadApp(); } catch (e) { fail("the page script did not run: " + e.message); }
if (o.VENUES.length < 90) fail(`only ${o.VENUES.length} venues loaded`);
const ids = o.VENUES.map(v => v.id);
if (new Set(ids).size !== ids.length) fail("duplicate venue ids");
for (const v of o.VENUES) {
  if (!isFinite(v.lat) || !isFinite(v.lon)) fail(`bad coordinates for ${v.name}`);
  if (!o.FEATS[v.id]) fail(`no card details for ${v.name}`);
  if (!v.name || !v.addr) fail(`missing name or address for ${v.id}`);
}
for (const [key, label] of o.SPORTS) {
  const list = o.VENUES.filter(v => o.offers(v, key));
  if (!list.length) fail(`no venues for ${label}`);
  for (const v of list) for (let d = 0; d < 7; d++) o.winsOn(v, key, d);
}
console.log(`Smoke check passed: ${o.VENUES.length} venues.`);
