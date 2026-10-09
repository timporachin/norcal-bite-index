import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { pacificToEpoch, parseSeries, buildPayload, refresh } from './fetch-cdec.mjs';

const NOW = Date.parse('2026-10-09T22:00:00Z');
const row = (value, obsDate = '2026-10-9 14:00', units = 'DEG F') => ({ value, obsDate, units });
const response = rows => ({ ok: true, text: async () => JSON.stringify(rows) });
const goodFetch = async url => {
  const sensor = new URL(url).searchParams.get('SensorNums');
  return response([row(sensor === '25' ? 59.4 : sensor === '20' ? 4439 : 74.13,
    '2026-10-9 14:00', sensor === '25' ? 'DEG F' : sensor === '20' ? 'CFS' : 'FEET')]);
};

test('Pacific wall-clock conversion and malformed dates', () => {
  assert.equal(pacificToEpoch('2026-10-9 14:00'), Date.parse('2026-10-09T21:00:00Z'));
  assert.equal(pacificToEpoch('2026-1-9 14:00'), Date.parse('2026-01-09T22:00:00Z'));
  for (const invalid of ['bad', '2026-02-30 12:00', '2026-10-9 24:00', '2026-10-9 12:60']) {
    assert.equal(pacificToEpoch(invalid), null);
  }
});

test('Fahrenheit stays Fahrenheit; explicitly declared Celsius converts', () => {
  assert.equal(parseSeries([row(59.4)], 25, NOW).points[0].v, 59.4);
  assert.equal(parseSeries([row(15, undefined, 'DEG C')], 25, NOW).points[0].v, 59);
  assert.equal(parseSeries([row(59.4, undefined, 'unknown')], 25, NOW).quality.status, 'invalid');
});

test('32°F outage is isolated while all eight flow/stage series update', async () => {
  const payload = await buildPayload({ now: NOW, fetchImpl: async url => {
    if (new URL(url).searchParams.get('SensorNums') === '25') {
      return response([row(59.2, '2026-10-5 00:45'), row(32, '2026-10-5 01:00'), row(32)]);
    }
    return goodFetch(url);
  } });
  assert.equal(payload.fetchedAt, NOW);
  assert.equal(payload.stations.GRL.temp, undefined);
  assert.equal(payload.stations.GRL.quality.temp.status, 'invalid');
  assert.equal(payload.stations.GRL.quality.temp.latestAt, pacificToEpoch('2026-10-5 00:45'));
  for (const station of Object.values(payload.stations)) {
    for (const key of ['flow', 'stage']) {
      assert.equal(station.quality[key].status, 'live');
      assert.equal(station[key].at(-1).t, pacificToEpoch('2026-10-9 14:00'));
    }
  }
});

test('invalid historical values never enter a recovered temperature series', () => {
  const result = parseSeries([
    row(32, '2026-10-9 12:00'), row(110, '2026-10-9 12:15'),
    row(-9999, '2026-10-9 12:30'), row(59, '2026-10-9 13:00'), row(60)
  ], 25, NOW);
  assert.equal(result.quality.status, 'live');
  assert.equal(result.quality.rejected, 2);
  assert.deepEqual(result.points.map(p => p.v), [59, 60]);
});

test('bad latest reading withholds sensor even if earlier reading is fresh', () => {
  for (const value of [32, 32.001, 89.999, 90, 102, 0]) {
    const result = parseSeries([row(59, '2026-10-9 13:45'), row(value)], 25, NOW);
    assert.equal(result.quality.status, 'invalid');
    assert.deepEqual(result.points, []);
  }
});

test('missing, stale, malformed and future data cannot masquerade as live', () => {
  assert.equal(parseSeries([], 25, NOW).quality.status, 'missing');
  assert.equal(parseSeries([row(-9999), row(null), row('59'), row(NaN)], 25, NOW).points.length, 0);
  assert.equal(parseSeries([row(59, '2026-10-9 09:00')], 25, NOW).quality.status, 'stale');
  assert.equal(parseSeries([row(59, '2026-10-9 09:01')], 25, NOW).quality.status, 'live');
  assert.equal(parseSeries([row(59, '2026-10-9 17:00')], 25, NOW).quality.status, 'invalid');
  assert.equal(parseSeries([row(59, 'invalid')], 25, NOW).quality.status, 'invalid');
  assert.throws(() => parseSeries({}, 25, NOW), /JSON array/);
});

test('negative flow rejected, zero flow valid, stage not confused with temperature', () => {
  assert.equal(parseSeries([row(-1)], 20, NOW).quality.status, 'invalid');
  assert.equal(parseSeries([row(0)], 20, NOW).points[0].v, 0);
  assert.equal(parseSeries([row(32)], 1, NOW).points[0].v, 32);
});

test('hourly thinning retains the real newest timestamp', () => {
  const result = parseSeries([row(59, '2026-10-9 13:00'), row(60, '2026-10-9 13:15'), row(61, '2026-10-9 13:30')], 25, NOW);
  assert.equal(result.points.at(-1).t, pacificToEpoch('2026-10-9 13:30'));
  assert.equal(result.quality.latestAt, result.points.at(-1).t);
});

test('individual network, HTTP, malformed JSON and non-array failures stay isolated', async () => {
  for (const failed of [
    async () => { throw new Error('network timeout'); },
    async () => ({ ok: false, status: 503 }),
    async () => ({ ok: true, text: async () => '<html>down</html>' }),
    async () => response({ error: 'unavailable' })
  ]) {
    const payload = await buildPayload({ now: NOW, fetchImpl: url =>
      new URL(url).searchParams.get('SensorNums') === '25' ? failed() : goodFetch(url) });
    assert.equal(payload.stations.GRL.quality.temp.status, 'down');
    assert.equal(payload.stations.GRL.temp, undefined);
    assert.equal(payload.stations.FSB.flow[0].v, 4439);
  }
});

test('a total outage or wholly stale data preserves existing file byte-for-byte', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cdec-test-'));
  const out = join(dir, 'cdec.js');
  const original = 'last good data must stay unchanged\n';
  try {
    writeFileSync(out, original);
    for (const fetchImpl of [
      async () => { throw new Error('CDEC down'); },
      async () => response([row(59, '2026-10-5 12:00')]),
      async () => response([])
    ]) {
      await assert.rejects(refresh({ out, now: NOW, fetchImpl }), /no fresh valid CDEC series/);
      assert.equal(readFileSync(out, 'utf8'), original);
    }
  } finally { rmSync(dir, { recursive: true }); }
});

test('partial refresh writes a loadable browser payload with explicit quality', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cdec-test-'));
  const out = join(dir, 'data', 'cdec.js');
  try {
    const payload = await refresh({ out, now: NOW, fetchImpl: url =>
      new URL(url).searchParams.get('SensorNums') === '25' ? response([row(32)]) : goodFetch(url) });
    const context = { window: {} };
    vm.runInNewContext(readFileSync(out, 'utf8'), context);
    assert.equal(context.window.BITE_CDEC.fetchedAt, NOW);
    assert.equal(context.window.BITE_CDEC.stations.GRL.quality.temp.status, 'invalid');
    assert.equal(context.window.BITE_CDEC.stations.GRL.temp, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(context.window.BITE_CDEC)), payload);
  } finally { rmSync(dir, { recursive: true }); }
});
