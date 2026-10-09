/* Public data-layer regression tests. No network, browser, or dependencies.
   Run: node --test scripts/fish-data.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HOUR = 3600000;
const NOW = Date.parse('2026-10-09T22:30:00Z');
const NOW_HOUR = Math.floor(NOW / HOUR) * HOUR;
const ROOT = new URL('../', import.meta.url);
const CODE = Object.fromEntries(['fish-spots', 'fish-species', 'fish-model', 'fish-data']
  .map((name) => [name, readFileSync(new URL(`js/${name}.js`, ROOT), 'utf8')]));
const FEATHER_SPOTS = ['feather-outlet', 'feather-gridley', 'feather-yuba-city'];

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}

function weatherFixture() {
  const time = Array.from({ length: 14 * 24 }, (_, i) =>
    new Date(NOW_HOUR + (i - 10 * 24) * HOUR).toISOString().slice(0, 16));
  const fill = (value) => time.map(() => value);
  return {
    utc_offset_seconds: 0,
    timezone: 'UTC',
    hourly: {
      time,
      temperature_2m: fill(70),
      pressure_msl: fill(1014),
      cloud_cover: fill(50),
      wind_speed_10m: fill(5),
      wind_direction_10m: fill(270),
      wind_gusts_10m: fill(8),
      precipitation: fill(0),
      weather_code: fill(1),
      relative_humidity_2m: fill(60)
    }
  };
}

function points(value) {
  return Array.from({ length: 73 }, (_, i) => ({ t: NOW_HOUR + (i - 72) * HOUR, v: value }));
}

function cdecFixture({ legacy = false } = {}) {
  const box = {
    fetchedAt: NOW,
    source: 'CDEC',
    stations: {
      GRL: { name: 'Feather River at Gridley', temp: points(60), flow: points(1205), stage: points(45) },
      FSB: { name: 'Feather River at Shanghai Bend', flow: points(2350), stage: points(15) }
    }
  };
  if (!legacy) {
    for (const station of Object.values(box.stations)) {
      station.quality = Object.fromEntries(['temp', 'flow', 'stage']
        .filter((key) => station[key])
        .map((key) => [key, { status: 'live', latestAt: NOW_HOUR, error: null }]));
    }
  }
  return box;
}

function withoutTemperature() {
  const box = cdecFixture();
  delete box.stations.GRL.temp;
  box.stations.GRL.quality.temp = {
    status: 'invalid', latestAt: NOW_HOUR, error: 'GRL temperature out of plausible range'
  };
  return box;
}

async function loadFixture({ box = cdecFixture(), spotId = 'feather-gridley', weatherDown = false } = {}) {
  const requests = [];
  const storage = new Map();
  const context = vm.createContext({
    Date: FixedDate,
    Promise,
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    },
    BITE_CDEC: box,
    fetch: async (url) => {
      requests.push(url);
      assert.match(url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/,
        'Feather fixtures must not borrow a sensor from another river');
      if (weatherDown) throw new Error('weather unavailable in test');
      return { ok: true, json: async () => weatherFixture() };
    }
  });
  for (const [name, code] of Object.entries(CODE)) {
    vm.runInContext(code, context, { filename: fileURLToPath(new URL(`js/${name}.js`, ROOT)) });
  }
  const spot = context.BITE.spots.byId[spotId];
  assert.ok(spot, `Unknown test spot: ${spotId}`);
  const env = await context.BITE.data.load(spot);
  return { env, spot, context, requests, now: env.series[env.nowIndex] };
}

function cdecSource(env) {
  const source = env.sources.find((entry) => entry.key === 'cdec');
  assert.ok(source, 'CDEC source status should be present');
  return source;
}

function assertModeled(result, expectedFlow = 1205) {
  const { env, now } = result;
  assert.equal(env.water.source, 'modeled');
  assert.match(env.water.label, /modeled/i);
  assert.equal(now.waterSource, 'modeled');
  assert.ok(Math.abs(now.waterF - 66.5) < 1e-9, 'Use the air-based model, not the rejected reading');
  assert.equal(now.flowCfs, expectedFlow);
  assert.equal(env.gaugeSeries.temp, null);
  assert.match(env.cdecWarning, /(?:GRL|Gridley).*temperature unavailable/i);
  assert.match(env.cdecWarning, /using (?:an )?air-based estimate/i);
  assert.match(cdecSource(env).label, /temperature unavailable/i);
  assert.equal(cdecSource(env).status, expectedFlow === null ? 'down' : 'stale');
}

test('fresh CDEC readings remain measured at all three Feather spots', async (t) => {
  for (const spotId of FEATHER_SPOTS) {
    await t.test(spotId, async () => {
      const { env, now, requests } = await loadFixture({ spotId });
      assert.equal(env.water.source, 'cdec');
      assert.equal(now.waterSource, 'cdec');
      assert.equal(now.waterF, 60);
      assert.equal(now.flowCfs, spotId === 'feather-yuba-city' ? 2350 : 1205);
      assert.equal(env.gaugeSeries.flow.siteId, spotId === 'feather-yuba-city' ? 'FSB' : 'GRL');
      assert.equal(cdecSource(env).status, 'live');
      assert.ok(!env.cdecWarning);
      assert.equal(env.stale, false);
      assert.equal(requests.length, 1);
    });
  }
});

test('invalid temperature does not suppress fresh flow at any Feather spot', async (t) => {
  for (const spotId of FEATHER_SPOTS) {
    await t.test(spotId, async () => {
      const result = await loadFixture({ box: withoutTemperature(), spotId });
      assertModeled(result, spotId === 'feather-yuba-city' ? 2350 : 1205);
      assert.equal(result.env.stale, true);
    });
  }
});

test('legacy payload with fresh fetchedAt cannot revive a 48-hour-old temperature', async () => {
  const box = cdecFixture({ legacy: true });
  box.stations.GRL.temp = [{ t: NOW - 48 * HOUR, v: 60 }];
  const result = await loadFixture({ box });
  assertModeled(result);
  assert.equal(box.stations.GRL.temp[0].t, NOW - 48 * HOUR, 'Do not rewrite observation timestamps');
});

test('fresh legacy payload remains supported without quality metadata', async () => {
  const { env, now } = await loadFixture({ box: cdecFixture({ legacy: true }) });
  assert.equal(env.water.source, 'cdec');
  assert.equal(now.waterF, 60);
  assert.equal(cdecSource(env).status, 'live');
});

test('every non-live quality status excludes even otherwise plausible readings', async (t) => {
  for (const status of ['invalid', 'stale', 'down', 'missing']) {
    await t.test(status, async () => {
      const box = cdecFixture();
      box.stations.GRL.quality.temp.status = status;
      box.stations.GRL.quality.temp.error = `GRL temperature ${status}`;
      assertModeled(await loadFixture({ box }));
    });
  }
});

test('missing and empty temperature arrays fall back safely', async (t) => {
  for (const [name, value] of [['undefined', undefined], ['null', null], ['empty array', []]]) {
    await t.test(name, async () => {
      const box = cdecFixture({ legacy: true });
      box.stations.GRL.temp = value;
      assertModeled(await loadFixture({ box }));
    });
  }
});

test('temperature observation freshness uses strict six-hour and two-hour boundaries', async (t) => {
  for (const [name, timestamp] of [
    ['exactly six hours old', NOW - 6 * HOUR],
    ['older than six hours', NOW - 6 * HOUR - 1],
    ['exactly two hours in the future', NOW + 2 * HOUR],
    ['more than two hours in the future', NOW + 2 * HOUR + 1]
  ]) {
    await t.test(name, async () => {
      const box = cdecFixture();
      box.stations.GRL.temp = [{ t: timestamp, v: 60 }];
      box.stations.GRL.quality.temp.latestAt = timestamp;
      assertModeled(await loadFixture({ box }));
    });
  }
});

test('an observation just inside the freshness limit remains usable', async () => {
  const box = cdecFixture({ legacy: true });
  box.stations.GRL.temp = [{ t: NOW - 6 * HOUR + 1, v: 60 }];
  const { env, now } = await loadFixture({ box });
  assert.equal(env.water.source, 'cdec');
  assert.equal(now.waterF, 60);
  assert.equal(cdecSource(env).status, 'live');
});

test('live metadata cannot hide an old actual observation timestamp', async () => {
  const box = cdecFixture();
  box.stations.GRL.temp = [{ t: NOW - 12 * HOUR, v: 60 }];
  // Deliberately leave quality.latestAt and fetchedAt fresh.
  assertModeled(await loadFixture({ box }));
});

test('latest temperature must have finite numeric timestamp and plausible numeric value', async (t) => {
  for (const [name, point] of [
    ['too warm', { t: NOW_HOUR, v: 102 }],
    ['too cold', { t: NOW_HOUR, v: 20 }],
    ['lower range boundary', { t: NOW_HOUR, v: 32 }],
    ['upper range boundary', { t: NOW_HOUR, v: 90 }],
    ['numeric string', { t: NOW_HOUR, v: '60' }],
    ['null value', { t: NOW_HOUR, v: null }],
    ['nonfinite value', { t: NOW_HOUR, v: Infinity }],
    ['NaN value', { t: NOW_HOUR, v: NaN }],
    ['string timestamp', { t: 'invalid', v: 60 }],
    ['nonfinite timestamp', { t: Infinity, v: 60 }]
  ]) {
    await t.test(name, async () => {
      const box = cdecFixture({ legacy: true });
      box.stations.GRL.temp = [{ t: NOW_HOUR - HOUR, v: 60 }, point];
      assertModeled(await loadFixture({ box }));
    });
  }
});

test('historical invalid temperature points never enter sampled or raw model series', async () => {
  const box = cdecFixture({ legacy: true });
  box.stations.GRL.temp = [
    { t: NOW_HOUR - 4 * HOUR, v: 103 },
    { t: NOW_HOUR - 3 * HOUR, v: null },
    { t: NOW_HOUR - 2 * HOUR, v: '60' },
    { t: NOW_HOUR - HOUR, v: NaN },
    { t: NOW_HOUR, v: 60 }
  ];
  const { env, now } = await loadFixture({ box });
  assert.equal(env.water.source, 'cdec');
  assert.equal(now.waterF, 60);
  assert.equal(env.gaugeSeries.temp.points.length, 1);
  assert.ok(env.series.every((hour) => hour.waterF === null ||
    (Number.isFinite(hour.waterF) && hour.waterF > 32 && hour.waterF < 90)));
});

test('temperature unavailable plus weather failure shows no invented estimate', async () => {
  const { env, now } = await loadFixture({ box: withoutTemperature(), weatherDown: true });
  assert.equal(now.waterF, null);
  assert.equal(now.flowCfs, 1205);
  assert.equal(env.offline, true);
  assert.match(env.cdecWarning, /temperature unavailable/i);
  assert.doesNotMatch(env.cdecWarning, /using (?:an )?air-based estimate/i);
  assert.equal(cdecSource(env).status, 'stale');
});

test('stale flow cannot invalidate independently fresh measured temperature', async () => {
  const box = cdecFixture();
  box.stations.GRL.flow = [{ t: NOW - 12 * HOUR, v: 1205 }];
  box.stations.GRL.quality.flow = { status: 'stale', latestAt: NOW - 12 * HOUR, error: 'flow stale' };
  const { env, now } = await loadFixture({ box });
  assert.equal(now.waterF, 60);
  assert.equal(env.water.source, 'cdec');
  assert.equal(now.flowCfs, null);
  assert.equal(env.gaugeSeries.flow, null);
  assert.equal(cdecSource(env).status, 'stale');
  assert.doesNotMatch(cdecSource(env).label, /temperature unavailable/i);
});

test('invalid latest flow is excluded independently from fresh temperature', async (t) => {
  for (const [name, value] of [['negative', -1], ['nonfinite', Infinity], ['numeric string', '1205']]) {
    await t.test(name, async () => {
      const box = cdecFixture({ legacy: true });
      box.stations.GRL.flow = [{ t: NOW_HOUR - HOUR, v: 1205 }, { t: NOW_HOUR, v: value }];
      const { env, now } = await loadFixture({ box });
      assert.equal(now.waterF, 60);
      assert.equal(now.flowCfs, null);
      assert.equal(env.gaugeSeries.flow, null);
      assert.equal(cdecSource(env).status, 'stale');
      assert.match(cdecSource(env).label, /flow unavailable/i);
    });
  }
});

test('no usable requested CDEC series is down even with fresh fetchedAt', async () => {
  const box = withoutTemperature();
  delete box.stations.GRL.flow;
  box.stations.GRL.quality.flow = { status: 'down', latestAt: null, error: 'flow request failed' };
  assertModeled(await loadFixture({ box }), null);
});

test('absent CDEC payload still loads weather and reports unavailable river data', async () => {
  const { env, now } = await loadFixture({ box: null });
  assert.equal(env.water.source, 'modeled');
  assert.ok(Math.abs(now.waterF - 66.5) < 1e-9);
  assert.equal(now.flowCfs, null);
  assert.equal(cdecSource(env).status, 'down');
});

test('modeled fallback remains estimated and contributes half temperature confidence', async () => {
  const { env, context } = await loadFixture({ box: withoutTemperature() });
  const score = (series) => context.BITE.model.scoreSeries({
    spot: env.spot,
    speciesId: 'chinook-fall',
    utcOffsetSeconds: env.utcOffsetSeconds,
    series,
    solunar: env.solunar,
    nowIndex: env.nowIndex
  }).hours[env.nowIndex];
  const modeled = score(env.series);
  const measuredControl = score(env.series.map((hour) => ({ ...hour, waterSource: 'cdec' })));
  const temp = modeled.factors.find((factor) => factor.key === 'temp');
  const totalWeight = modeled.factors.reduce((sum, factor) => sum + factor.weight, 0);
  assert.equal(temp.available, true);
  assert.equal(temp.estimated, true);
  assert.equal(temp.detail.source, 'modeled');
  assert.ok(Math.abs(measuredControl.confidence - modeled.confidence - temp.weight / (2 * totalWeight)) < 1e-12);
  assert.ok(Number.isFinite(modeled.score));
  assert.ok(!modeled.gates.some((gate) => gate.key === 'lethal'), 'Rejected sensor outlier must not trigger lethal gate');
});

test('all stale legacy CDEC readings retain the amber stale status', async () => {
  const box = cdecFixture({ legacy: true });
  for (const station of Object.values(box.stations)) {
    for (const key of ['temp', 'flow', 'stage']) {
      if (station[key]) station[key] = station[key].map(p => ({ ...p, t: p.t - 48 * HOUR }));
    }
  }
  const { env } = await loadFixture({ box });
  assert.equal(cdecSource(env).status, 'stale');
  assert.equal(env.stale, true);
});
