/* Refresh data/cdec.js from the California Data Exchange Center.

   The Feather River is metered by CDEC, not the USGS live feed, and CDEC sends
   no Access-Control-Allow-Origin header — checked with an explicit Origin and
   with an OPTIONS preflight, neither returns one. A browser on a static page
   therefore cannot read it. This script runs in CI, where CORS does not apply,
   and commits the result so the page can load it from its own origin.

   Run: node scripts/fetch-cdec.mjs
   Validates each sensor independently. Unusable series are omitted and flagged;
   if no fresh valid series remain, exits non-zero without replacing the file.
*/

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'cdec.js');
const ZONE = 'America/Los_Angeles';
const DAYS = 10;
const MAX_AGE_MS = 6 * 3600000;
const MAX_FUTURE_MS = 2 * 3600000;

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

export function pacificToEpoch(str) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/.exec(String(str).trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(naive);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 ||
      check.getUTCDate() !== d || h > 23 || mi > 59) return null;
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

/* Do not loosen the Gridley temperature bounds to accept a failing sensor.
   CDEC has reported repeated 32 DEG F values during the October 2026 outage. */
export function parseSeries(rows, sensor, now) {
  if (!Array.isArray(rows)) throw new Error('response was not a JSON array');
  const points = [];
  let rejected = 0;
  let latestRejectedAt = null;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const v = r.value;
    // CDEC missing-value sentinels are not observations.
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= -9000) continue;
    const t = pacificToEpoch(r.obsDate || r.date);
    if (t === null) { rejected++; continue; }
    const units = String(r.units || '').trim().toUpperCase();
    const converted = sensor === 25 && units === 'DEG C' ? v * 9 / 5 + 32 : v;
    const value = Math.round(converted * 100) / 100;
    const valid = t < now + MAX_FUTURE_MS &&
      (sensor !== 25 || ((units === 'DEG F' || units === 'DEG C') && value > 32 && value < 90)) &&
      (sensor !== 20 || value >= 0);
    if (!valid) {
      rejected++;
      latestRejectedAt = Math.max(latestRejectedAt ?? -Infinity, t);
      continue;
    }
    points.push({ t, v: value });
  }
  points.sort((a, b) => a.t - b.t);
  const newest = points[points.length - 1];
  const quality = { status: 'live', latestAt: newest?.t ?? null, rejected };
  if (!newest || (latestRejectedAt !== null && latestRejectedAt >= newest.t)) {
    quality.status = rejected ? 'invalid' : 'missing';
    quality.error = rejected ? 'invalid readings; sensor withheld' : 'no usable readings';
    return { points: [], quality };
  }
  if (now - newest.t >= MAX_AGE_MS) {
    quality.status = 'stale';
    quality.error = 'latest valid reading is over 6 hours old';
    return { points: [], quality };
  }

  // Thin to hourly, but retain the actual newest observation for freshness.
  const thinned = [];
  let last = -Infinity;
  for (const p of points) {
    if (p.t - last >= 3540000) { thinned.push(p); last = p.t; }
  }
  if (thinned[thinned.length - 1] !== newest) thinned.push(newest);
  return { points: thinned, quality };
}

async function fetchSeries(station, sensor, startMs, now, fetchImpl) {
  const url = 'https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet' +
    `?Stations=${station}&SensorNums=${sensor}&dur_code=E` +
    `&Start=${ymd(startMs)}&End=${ymd(now + 86400000)}`;
  const res = await fetchImpl(url, {
    headers: { 'user-agent': 'norcal-bite-index refresher' },
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let rows;
  try { rows = JSON.parse(await res.text()); }
  catch { throw new Error('response was not JSON'); }
  return parseSeries(rows, sensor, now);
}

/* ---------------------------------------------------------------- main --- */

export async function buildPayload({ now = Date.now(), fetchImpl = fetch } = {}) {
  const stations = {};
  let usableSeries = 0;
  for (const st of STATIONS) {
    const entry = { name: st.name, quality: {} };
    for (const sensor of st.want) {
      const key = SENSORS[sensor];
      try {
        const result = await fetchSeries(st.id, sensor, now - DAYS * 86400000, now, fetchImpl);
        entry.quality[key] = result.quality;
        if (result.points.length) {
          entry[key] = result.points;
          usableSeries++;
        }
      } catch (err) {
        entry.quality[key] = { status: 'down', latestAt: null, error: String(err.message || err) };
      }
    }
    stations[st.id] = entry;
  }
  if (!usableSeries) {
    const failures = Object.entries(stations).flatMap(([id, station]) =>
      Object.entries(station.quality).map(([key, q]) => `${id}/${key}: ${q.error}`));
    throw new Error('no fresh valid CDEC series; refusing to write. ' + failures.join('; '));
  }
  return { fetchedAt: now, source: 'CDEC', stations };
}

export async function refresh({ out = OUT, now, fetchImpl } = {}) {
  // Build and validate before touching the existing file. An outage preserves it.
  const payload = await buildPayload({ now, fetchImpl });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out,
    '/* Generated by scripts/fetch-cdec.mjs — do not edit by hand.\n' +
    '   California Data Exchange Center readings, refreshed on a schedule because\n' +
    '   CDEC cannot be called directly from the browser. Timestamps are epoch ms. */\n' +
    'window.BITE_CDEC = ' + JSON.stringify(payload) + ';\n');

  console.log(`Wrote ${out}`);
  for (const [id, station] of Object.entries(payload.stations)) {
    for (const [key, quality] of Object.entries(station.quality)) {
      const points = station[key];
      if (points) {
        console.log(`  ${id}/${key}: ${points[points.length - 1].v} (${points.length} pts; ${quality.rejected} rejected)`);
      } else {
        console.warn(`  WARNING ${id}/${key}: ${quality.status} — ${quality.error}`);
      }
    }
  }
  return payload;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  refresh().catch((err) => {
    console.error(`FAILED: ${err.message || err}`);
    process.exitCode = 1;
  });
}
