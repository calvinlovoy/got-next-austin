#!/usr/bin/env node
// Weekly watch on the City of Austin rec center pages.
// It fingerprints the schedule links and posted open play times on each page and compares them with last week's.
// It never edits the venue data. When something moves it writes schedule-report.md so the workflow can open an issue.
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadApp } from "./lib.mjs";

const STORE = "data/schedule-fingerprints.json";
const UA = "GotNextAustin-schedule-check/1.0 (+https://github.com/calvinlovoy/got-next-austin)";
const KEY = /gym|schedule|calendar|open\s*(play|gym)|pickleball|basketball|volleyball|badminton|futsal|soccer/i;
// Document links that match KEY but are about something else (fees, camps, senior program calendars).
const SKIP = /payment|after\s*school|camp|weight\s*room|rental|waiver|varsity\s*generation/i;
// Some centers label their gym schedule with a date range such as 10.18.26-10.31.26.
const DATED = /\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/;
const SPORT = /open\s*(play|gym)|pickleball|basketball|volleyball|badminton|futsal|soccer/i;
const TIME = /\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])|\bnoon\b/i;

const decode = s => s.replace(/&nbsp;|&#160;|&#xa0;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#0?39;|&[rl]squo;/gi, "'")
  .replace(/&[nm]dash;/gi, "-").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
const text = s => decode(String(s).replace(/<[^>]+>/g, " ")).replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").trim();

// Pulls the schedule-looking document links and the lines that pair a sport with a time out of a page.
export function extract(html, base) {
  const body = html.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const links = new Map();
  for (const m of body.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u;
    try { u = new URL(decode(m[1]).trim(), base); } catch { continue; }
    u.hash = "";
    const label = text(m[2]).slice(0, 140);
    let path = u.pathname;
    try { path = decodeURIComponent(path); } catch {}
    if (!/widen(cdn)?\.net|\.pdf($|\?)/i.test(u.href) || SKIP.test(label) || SKIP.test(path.replace(/-/g, " "))) continue;
    if (!(KEY.test(label) || DATED.test(label) || KEY.test(path))) continue;
    if (!links.has(u.href)) links.set(u.href, { href: u.href, text: label });
  }
  const lines = new Set();
  for (const raw of body.replace(/<(br|\/p|\/li|\/div|\/h\d|\/tr|\/td|\/th|\/dd|\/dt)\b[^>]*>/gi, "\n").split("\n")) {
    const t = text(raw);
    if (t.length >= 8 && t.length <= 300 && SPORT.test(t) && TIME.test(t)) lines.add(t);
  }
  return { links: [...links.values()].sort((a, b) => a.href.localeCompare(b.href)), lines: [...lines].sort() };
}

// The city hosts its PDFs in a viewer. The viewer page names the file and carries an id that changes when the file is replaced.
export function parseWiden(html) {
  const plain = html.replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&");
  return {
    title: text((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").slice(0, 160),
    asset: (plain.match(/asset-view\/([0-9a-f]{8}-[0-9a-f-]{27})/i) || [])[1] || "",
    pdf: (plain.match(/https:\/\/previews[a-z0-9.-]*\.widencdn\.net\/[^"'\s<>\\]+/i) || [])[0] || "",
  };
}

const sha = buf => createHash("sha256").update(buf).digest("hex").slice(0, 16);
const isPdf = buf => buf.length > 4 && buf.subarray(0, 4).toString() === "%PDF";

async function httpGet(url, kind = "text") {
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/pdf;q=0.9,*/*;q=0.8" }, redirect: "follow", signal: AbortSignal.timeout(45000) });
      if (!r.ok) throw new Error(`status ${r.status}`);
      return kind === "text" ? await r.text() : Buffer.from(await r.arrayBuffer());
    } catch (e) { last = e; await new Promise(res => setTimeout(res, 3000)); }
  }
  throw last;
}

async function describeLink(link, old, get) {
  const out = { ...link };
  try {
    if (/widen\.net/i.test(link.href)) {
      const w = parseWiden(await get(link.href, "text"));
      if (w.title) out.title = w.title;
      if (w.asset) out.asset = w.asset;
      if (w.pdf) { try { const b = await get(w.pdf, "bytes"); if (isPdf(b)) out.hash = sha(b); } catch {} }
    } else {
      const b = await get(link.href, "bytes");
      if (isPdf(b)) out.hash = sha(b);
    }
  } catch { /* fall through to last week's details below */ }
  // A detail we could not read this week keeps last week's value, so a flaky download never looks like a change.
  if (old) for (const k of ["title", "asset", "hash"]) if (out[k] === undefined && old[k] !== undefined) out[k] = old[k];
  return out;
}

// Page text goes into a GitHub issue, so it is quoted as code. That keeps stray @names or markup on a city page from doing anything.
const code = t => "`" + String(t).replace(/`/g, "'") + "`";
const mdLink = l => `[${(l.text || "link").replace(/[\[\]@`<>]/g, "")}](${l.href.replace(/[()\s]/g, encodeURIComponent)})`;

export function compare(old, now) {
  const notes = [];
  const was = new Map((old.links || []).map(l => [l.href, l]));
  for (const l of now.links) {
    const o = was.get(l.href);
    if (!o) { notes.push(`New schedule link: ${mdLink(l)}${l.title ? `, file ${code(l.title)}` : ""}`); continue; }
    const why = [];
    if (o.text !== l.text) why.push(`the link text was ${code(o.text)}`);
    if (o.title && l.title && o.title !== l.title) why.push(`the file name was ${code(o.title)} and is now ${code(l.title)}`);
    if (o.asset && l.asset && o.asset !== l.asset) why.push("a different file sits behind the link");
    else if (o.hash && l.hash && o.hash !== l.hash) why.push("the file contents changed");
    if (why.length) notes.push(`Changed: ${mdLink(l)}: ${why.join(", ")}`);
    was.delete(l.href);
  }
  for (const l of was.values()) notes.push(`Removed schedule link: ${code(l.text)}${l.title ? `, file ${code(l.title)}` : ""}`);
  const before = new Set(old.lines || []), after = new Set(now.lines);
  for (const t of after) if (!before.has(t)) notes.push(`New text on the page: ${code(t)}`);
  for (const t of before) if (!after.has(t)) notes.push(`Text no longer on the page: ${code(t)}`);
  return notes;
}

// pages: [{url, venues:[names]}]. store: last week's file contents. get(url, "text"|"bytes") fetches.
export async function check(pages, store, get, today) {
  const next = { note: "Written by scripts/check-schedules.mjs. Last week's view of each rec center page, used to spot schedule changes.", lastChecked: today, pages: {} };
  const changed = [], unreadable = [], watching = [];
  for (const p of pages) {
    const old = (store.pages || {})[p.url];
    let found, error = "";
    try { found = extract(await get(p.url, "text"), p.url); } catch (e) { error = e.message || String(e); }
    if (found && old && !found.links.length && !found.lines.length && ((old.links || []).length || (old.lines || []).length)) {
      found = null; error = "the page loaded but had none of the schedule content it had before";
    }
    if (!found) {
      const fails = ((old && old.fails) || 0) + 1;
      next.pages[p.url] = { ...(old || { links: [], lines: [] }), venues: p.venues, fails, lastError: error };
      if (fails === 2 || fails % 8 === 0) unreadable.push({ ...p, fails, error });
      watching.push(`${p.venues.join(", ")}: could not be read (${error})`);
      continue;
    }
    const prior = new Map(((old && old.links) || []).map(l => [l.href, l]));
    const links = [];
    for (const l of found.links) links.push(await describeLink(l, prior.get(l.href), get));
    const rec = { venues: p.venues, links, lines: found.lines, fails: 0, lastOk: today };
    next.pages[p.url] = rec;
    watching.push(`${p.venues.join(", ")}: ${links.length} schedule link${links.length === 1 ? "" : "s"}, ${found.lines.length} line${found.lines.length === 1 ? "" : "s"} of posted times${!links.length && !found.lines.length ? " (nothing to watch on this page)" : ""}`);
    if (old && old.lastOk) { const notes = compare(old, rec); if (notes.length) changed.push({ ...p, notes }); }
  }
  let report = "", title = "";
  if (changed.length || unreadable.length) {
    const short = n => n.replace(/ Rec(reation)? Center$/i, "");
    const names = [...changed, ...unreadable].flatMap(c => c.venues.map(short));
    title = `Rec center schedule check: ${changed.length ? "changes at" : "could not read"} ${names.slice(0, 4).join(", ")}${names.length > 4 ? ` and ${names.length - 4} more` : ""}`;
    const out = [`Weekly schedule check, ${today}.`, ""];
    if (changed.length) out.push(`The city pages for ${changed.length === 1 ? "this rec center" : "these rec centers"} changed since the last check. Got Next Austin keeps showing the old times until the venue data is updated.`, "");
    for (const c of changed) out.push(`### ${c.venues.join(", ")}`, `Page: ${c.url}`, "", ...c.notes.map(n => `- ${n}`), "");
    if (unreadable.length) {
      out.push("### Pages the check could not read", "");
      for (const u of unreadable) out.push(`- ${u.venues.join(", ")} (${u.url}): failed ${u.fails} checks in a row. Last error: ${u.error}`);
      out.push("");
    }
    out.push("To update the site, open a Claude session and ask it to update the Got Next Austin schedules for the centers listed above.");
    report = out.join("\n");
  }
  return { next, report, title, watching, firstRun: !store.lastChecked };
}

async function main() {
  const { VENUES } = loadApp();
  const byUrl = new Map();
  for (const v of VENUES.filter(v => v.kind === "indoor" && v.url)) byUrl.set(v.url, [...(byUrl.get(v.url) || []), v.name]);
  const pages = [...byUrl].map(([url, venues]) => ({ url, venues }));
  const store = existsSync(STORE) ? JSON.parse(readFileSync(STORE, "utf8")) : {};
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const r = await check(pages, store, httpGet, today);
  mkdirSync("data", { recursive: true });
  writeFileSync(STORE, JSON.stringify(r.next, null, 1) + "\n");
  const summary = [`### Rec center schedule check, ${today}`, r.firstRun ? "First run. This is the starting point that later runs compare against." : (r.report ? "Changes found. See the issue this run opened." : "No changes since the last check."), "", ...r.watching.map(w => `- ${w}`)].join("\n");
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  if (r.report) writeFileSync("schedule-report.md", r.report + "\n");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${r.report ? "true" : "false"}\ntitle=${r.title.replace(/[\r\n]/g, " ")}\n`);
  const read = Object.values(r.next.pages).filter(p => !p.fails).length;
  if (!read) { console.error("None of the rec center pages could be read."); process.exit(1); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exit(1); });
