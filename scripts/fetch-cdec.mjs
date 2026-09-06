/* Refresh data/cdec.js from the California Data Exchange Center.

   The Feather River is metered by CDEC, not the USGS live feed, and CDEC sends
   no Access-Control-Allow-Origin header — checked with an explicit Origin and
   with an OPTIONS preflight, neither returns one. A browser on a static page
   therefore cannot read it. This script runs in CI, where CORS does not apply,
   and commits the result so the page can load it from its own origin.

   Run: node scripts/fetch-cdec.mjs
   Exits non-zero without writing if the fetch fails or the data looks wrong,
   so a bad run never overwrites a good file.
*/

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'cdec.js');
const ZONE = 'America/Los_Angeles';
const DAYS = 10;

/* sensor number -> the key we store it under */
const SENSORS = { 20: 'flow', 25: 'temp', 1: 'stage' };

const STATIONS = [
  { id: 'GRL', name: 'Feather River at Gridley', want: [20, 25, 1] },
  { id: 'FSB', name: 'Feather River at Shanghai Bend', want: [20, 1] },
  { id: 'VON', name: 'Sacramento River at Verona', want: [20, 1] },
  { id: 'MRY', name: 'Yuba River at Marysville', want: [20, 1] }
];

/* ---------------------------------------------------------------- time ---
   CDEC timestamps are wall-clock Pacific with no zone marker
   ("2026-9-3 23:00"). Reading them as UTC would shift every point seven or
   eight hours and wreck the 24-hour flow deltas the freshet factor reads.
   Resolve the real offset at that instant instead of assuming one.
*/

function zoneOffsetMs(ms) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asIfUtc - ms;          // + during DST-less UTC comparison; negative for Pacific
}

function pacificToEpoch(str) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/.exec(String(str).trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes settle the DST boundary case.
  let guess = naive - zoneOffsetMs(naive);
  guess = naive - zoneOffsetMs(guess);
  return guess;
}

/* --------------------------------------------------------------- fetch --- */

function ymd(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

async function fetchSeries(station, sensor, startMs, endMs) {
  const url = 'https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet' +
    `?Stations=${station}&SensorNums=${sensor}&dur_code=E` +
    `&Start=${ymd(startMs)}&End=${ymd(endMs)}`;

  const res = await fetch(url, { headers: { 'user-agent': 'norcal-bite-index refresher' } });
  if (!res.ok) throw new Error(`${station}/${sensor}: HTTP ${res.status}`);

  const text = await res.text();
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    throw new Error(`${station}/${sensor}: response was not JSON`);
  }
  if (!Array.isArray(rows)) return [];

  const points = [];
  for (const r of rows) {
    const v = r.value;
    if (typeof v !== 'number' || !isFinite(v) || v <= -9000) continue;
    const t = pacificToEpoch(r.obsDate || r.date);
    if (t === null) continue;
    // Trust the reported unit rather than assuming Fahrenheit.
    const units = String(r.units || '').toUpperCase();
    const value = units.includes('DEG C') ? v * 9 / 5 + 32 : v;
    points.push({ t, v: Math.round(value * 100) / 100 });
  }
  points.sort((a, b) => a.t - b.t);

  // Thin to hourly; CDEC records every 15 minutes and the charts read hourly.
  const thinned = [];
  let last = -Infinity;
  for (const p of points) {
    if (p.t - last >= 3540000) { thinned.push(p); last = p.t; }
  }
  return thinned;
}

/* ---------------------------------------------------------------- main --- */

const now = Date.now();
const start = now - DAYS * 86400000;
const stations = {};
const problems = [];

for (const st of STATIONS) {
  const entry = { name: st.name };
  for (const sensor of st.want) {
    const key = SENSORS[sensor];
    try {
      const series = await fetchSeries(st.id, sensor, start, now + 86400000);
      if (series.length) entry[key] = series;
    } catch (err) {
      problems.push(String(err.message || err));
    }
  }
  if (entry.flow || entry.temp || entry.stage) stations[st.id] = entry;
  else problems.push(`${st.id}: no usable series`);
}

/* Sanity gates — never write a file that would quietly mislead the app. */
const grl = stations.GRL;
if (!grl || !grl.temp || !grl.temp.length) {
  console.error('FAILED: no Gridley water temperature; refusing to write.');
  problems.forEach((p) => console.error('  ' + p));
  process.exit(1);
}

const newest = grl.temp[grl.temp.length - 1];
const ageHours = (now - newest.t) / 3600000;
if (!(ageHours > -2 && ageHours < 12)) {
  console.error(`FAILED: newest Gridley reading is ${ageHours.toFixed(1)}h old — timestamps look wrong; refusing to write.`);
  process.exit(1);
}
if (!(newest.v > 32 && newest.v < 90)) {
  console.error(`FAILED: Gridley water temperature ${newest.v} is out of plausible range; refusing to write.`);
  process.exit(1);
}

const payload = { fetchedAt: now, source: 'CDEC', stations };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT,
  '/* Generated by scripts/fetch-cdec.mjs — do not edit by hand.\n' +
  '   California Data Exchange Center readings, refreshed on a schedule because\n' +
  '   CDEC cannot be called directly from the browser. Timestamps are epoch ms. */\n' +
  'window.BITE_CDEC = ' + JSON.stringify(payload) + ';\n');

const kb = (Buffer.byteLength(JSON.stringify(payload)) / 1024).toFixed(0);
console.log(`Wrote ${OUT} (${kb} KB)`);
for (const [id, s] of Object.entries(stations)) {
  const bits = ['temp', 'flow', 'stage']
    .filter((k) => s[k])
    .map((k) => `${k}=${s[k][s[k].length - 1].v} (${s[k].length} pts)`);
  console.log(`  ${id}  ${s.name}: ${bits.join('  ')}`);
}
console.log(`  newest Gridley reading ${ageHours.toFixed(1)}h old`);
if (problems.length) {
  console.log('Non-fatal problems:');
  problems.forEach((p) => console.log('  ' + p));
}
