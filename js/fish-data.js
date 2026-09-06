/* Bite Index — live data layer.

   Every source below is keyless and CORS-open, because this page is served as
   static files with no server of its own:

     Open-Meteo forecast   air temperature, barometric pressure, cloud, wind,
                           gusts, rain, weather code, sunrise/sunset
     Open-Meteo marine     sea surface temperature, swell height and period
     USGS NWIS             river temperature, discharge, stage, turbidity
     NOAA CO-OPS           tide predictions, and water temperature where the
                           station carries a sensor
     CDEC (via data/cdec.js)  Feather River temperature and flow. CDEC sends no
                           CORS headers, so a scheduled job commits its readings
                           into the repo and the page loads them same-origin.

   Everything is cached in localStorage with a per-source TTL. When a source
   fails we fall back to the last good copy and mark it stale; when there is no
   copy at all the factor is simply missing and the model renormalises around
   it, which is what drives the confidence readout.
*/
(function (root) {
  'use strict';

  var astro = root.BITE && root.BITE.astro;
  var spotsApi = root.BITE && root.BITE.spots;

  var HOUR = 3600000;
  var CACHE_PREFIX = 'bite-cache-v1:';
  var TIMEOUT_MS = 14000;

  var TTL = {
    weather: 30 * 60000,
    marine: 60 * 60000,
    usgs: 20 * 60000,
    tide: 12 * 3600000,
    stationTemp: 40 * 60000
  };

  /* ------------------------------------------------------------- utilities */

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function cToF(c) { return isNum(c) ? c * 9 / 5 + 32 : null; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function cacheGet(key) {
    try {
      var raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      var box = JSON.parse(raw);
      if (!box || !box.savedAt) return null;
      return box;
    } catch (e) { return null; }
  }

  function cacheSet(key, payload) {
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ savedAt: Date.now(), payload: payload }));
    } catch (e) { /* private mode, quota, or storage disabled — caching is optional */ }
  }

  function fetchJson(url) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    return fetch(url, ctrl ? { signal: ctrl.signal } : {})
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) { clearTimeout(timer); return json; })
      .catch(function (err) { clearTimeout(timer); throw err; });
  }

  /* Fetch with a cache in front and the last good copy behind. */
  function cached(key, ttl, url, parse) {
    var box = cacheGet(key);
    if (box && Date.now() - box.savedAt < ttl) {
      return Promise.resolve({ data: box.payload, status: 'live', at: box.savedAt, cached: true });
    }
    return fetchJson(url)
      .then(function (json) {
        var parsed = parse(json);
        cacheSet(key, parsed);
        return { data: parsed, status: 'live', at: Date.now(), cached: false };
      })
      .catch(function (err) {
        if (box) return { data: box.payload, status: 'stale', at: box.savedAt, error: String(err && err.message || err) };
        return { data: null, status: 'down', at: null, error: String(err && err.message || err) };
      });
  }

  /* Open-Meteo returns local wall-clock strings plus the offset. */
  function localToEpoch(str, offsetSeconds) {
    return Date.parse(str + ':00Z') - offsetSeconds * 1000;
  }

  function ymdHm(ms) {
    var d = new Date(ms);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + '%20' +
      p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  }

  /* ------------------------------------------------------------- providers */

  function loadWeather(lat, lon) {
    var url = 'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
      '&hourly=temperature_2m,pressure_msl,cloud_cover,wind_speed_10m,wind_direction_10m,' +
      'wind_gusts_10m,precipitation,weather_code,relative_humidity_2m' +
      '&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min' +
      '&past_days=10&forecast_days=4&timezone=auto' +
      '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch';

    return cached('wx:' + lat.toFixed(3) + ',' + lon.toFixed(3), TTL.weather, url, function (j) {
      var off = j.utc_offset_seconds || 0;
      var h = j.hourly || {};
      var times = (h.time || []).map(function (s) { return localToEpoch(s, off); });
      return {
        offsetSeconds: off,
        timezone: j.timezone,
        elevation: j.elevation,
        times: times,
        airF: h.temperature_2m || [],
        pressureHpa: h.pressure_msl || [],
        cloudPct: h.cloud_cover || [],
        windMph: h.wind_speed_10m || [],
        windDirDeg: h.wind_direction_10m || [],
        gustMph: h.wind_gusts_10m || [],
        precipIn: h.precipitation || [],
        weatherCode: h.weather_code || [],
        humidity: h.relative_humidity_2m || [],
        daily: {
          date: (j.daily && j.daily.time) || [],
          sunrise: ((j.daily && j.daily.sunrise) || []).map(function (s) { return localToEpoch(s, off); }),
          sunset: ((j.daily && j.daily.sunset) || []).map(function (s) { return localToEpoch(s, off); }),
          maxF: (j.daily && j.daily.temperature_2m_max) || [],
          minF: (j.daily && j.daily.temperature_2m_min) || []
        }
      };
    });
  }

  function loadMarine(lat, lon) {
    var url = 'https://marine-api.open-meteo.com/v1/marine' +
      '?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
      '&hourly=sea_surface_temperature,wave_height,wave_period' +
      '&past_days=3&forecast_days=4&timezone=auto' +
      '&temperature_unit=fahrenheit&length_unit=imperial';

    return cached('marine:' + lat.toFixed(3) + ',' + lon.toFixed(3), TTL.marine, url, function (j) {
      var off = j.utc_offset_seconds || 0;
      var h = j.hourly || {};
      var sst = h.sea_surface_temperature || [];
      var hasSst = sst.some(isNum);
      return {
        times: (h.time || []).map(function (s) { return localToEpoch(s, off); }),
        sstF: sst,
        hasSst: hasSst,
        waveFt: h.wave_height || [],
        wavePeriodS: h.wave_period || []
      };
    });
  }

  function loadUsgs(siteIds) {
    if (!siteIds || !siteIds.length) return Promise.resolve({ data: null, status: 'n/a' });
    var url = 'https://waterservices.usgs.gov/nwis/iv/?format=json' +
      '&sites=' + siteIds.join(',') +
      '&parameterCd=00010,00060,00065,63680&period=P10D&siteStatus=all';

    return cached('usgs:' + siteIds.join(','), TTL.usgs, url, function (j) {
      var out = { params: {}, sites: {} };
      var ts = (j.value && j.value.timeSeries) || [];
      ts.forEach(function (t) {
        var code = t.variable.variableCode[0].value;
        var noData = parseFloat(t.variable.noDataValue);
        var info = t.sourceInfo;
        var site = info.siteCode[0].value;
        var geo = info.geoLocation && info.geoLocation.geogLocation;
        out.sites[site] = {
          id: site,
          name: titleCase(info.siteName),
          lat: geo ? geo.latitude : null,
          lon: geo ? geo.longitude : null
        };
        var points = [];
        ((t.values[0] && t.values[0].value) || []).forEach(function (p) {
          var v = parseFloat(p.value);
          if (!isNum(v) || v === noData) return;
          points.push({ t: Date.parse(p.dateTime), v: v });
        });
        if (!points.length) return;
        points.sort(function (a, b) { return a.t - b.t; });
        if (!out.params[code]) out.params[code] = [];
        out.params[code].push({ site: site, points: points });
      });
      return out;
    });
  }

  /* Only hi/lo predictions are offered at every station — the hourly interval
     is refused at subordinate stations — so we take the extremes and rebuild a
     smooth curve from them. That is also about seventy times less data. */
  function loadTides(stationId, fromMs, hours) {
    if (!stationId) return Promise.resolve({ data: null, status: 'n/a' });
    var url = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter' +
      '?begin_date=' + ymdHm(fromMs) + '&range=' + hours +
      '&station=' + stationId +
      '&product=predictions&datum=MLLW&interval=hilo&units=english&time_zone=gmt&format=json';

    var bucket = Math.floor(fromMs / (6 * HOUR));
    return cached('tide:' + stationId + ':' + bucket, TTL.tide, url, function (j) {
      if (!j.predictions) throw new Error(j.error ? j.error.message : 'no predictions');
      return j.predictions.map(function (p) {
        return { t: Date.parse(p.t.replace(' ', 'T') + 'Z'), v: parseFloat(p.v), type: p.type };
      }).filter(function (p) { return isNum(p.v) && isNum(p.t); });
    });
  }

  function loadStationTemp(stationId) {
    if (!stationId) return Promise.resolve({ data: null, status: 'n/a' });
    var url = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter' +
      '?date=latest&station=' + stationId +
      '&product=water_temperature&units=english&time_zone=gmt&format=json';

    return cached('wtemp:' + stationId, TTL.stationTemp, url, function (j) {
      if (!j.data || !j.data.length) throw new Error('no water temperature at this station');
      var last = j.data[j.data.length - 1];
      var v = parseFloat(last.v);
      if (!isNum(v)) throw new Error('no water temperature reading');
      return { f: v, t: Date.parse(last.t.replace(' ', 'T') + 'Z'), name: j.metadata && j.metadata.name };
    });
  }

  /* CDEC readings arrive as a global from data/cdec.js rather than a fetch,
     because CDEC serves no CORS headers and a static page cannot call it. The
     file is refreshed by a scheduled job; if it is absent, every spot simply
     behaves as it did before CDEC existed. */
  var CDEC_STALE_MS = 6 * 3600000;

  function cdecSeries(spot, key) {
    var box = root.BITE_CDEC;
    if (!box || !spot.cdec || !spot.cdec[key]) return null;
    var id = spot.cdec[key];
    var station = box.stations && box.stations[id];
    if (!station || !station[key] || !station[key].length) return null;
    return {
      siteId: id,
      siteName: station.name || id,
      lat: null,
      lon: null,
      points: station[key]
    };
  }

  function cdecStatus(spot) {
    if (!spot.cdec) return 'n/a';
    var box = root.BITE_CDEC;
    if (!box || !box.stations) return 'down';
    var age = Date.now() - (box.fetchedAt || 0);
    return age > CDEC_STALE_MS ? 'stale' : 'live';
  }

  function titleCase(s) {
    return String(s || '').toLowerCase().replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); })
      .replace(/\bR\b/g, 'River').replace(/\bA\b/g, 'at').replace(/\bBl\b/g, 'below')
      .replace(/\bAb\b/g, 'above').replace(/\bNr\b/g, 'near').replace(/\bCa\b/g, 'CA');
  }

  /* -------------------------------------------------------- series helpers */

  /* Nearest reading within a tolerance, from a time-sorted point list. */
  function sampleAt(points, ms, toleranceMs) {
    if (!points || !points.length) return null;
    var lo = 0, hi = points.length - 1;
    if (ms <= points[0].t) return Math.abs(points[0].t - ms) <= toleranceMs ? points[0].v : null;
    if (ms >= points[hi].t) return Math.abs(points[hi].t - ms) <= toleranceMs ? points[hi].v : null;
    while (lo < hi - 1) {
      var mid = (lo + hi) >> 1;
      if (points[mid].t <= ms) lo = mid; else hi = mid;
    }
    var a = points[lo], b = points[hi];
    var pick = Math.abs(a.t - ms) <= Math.abs(b.t - ms) ? a : b;
    return Math.abs(pick.t - ms) <= toleranceMs ? pick.v : null;
  }

  /* Tide height between two extremes follows a cosine — the smooth form behind
     the old rule of twelfths, and exact at the turns. */
  function tideAt(extremes, ms) {
    if (!extremes || extremes.length < 2) return null;
    if (ms < extremes[0].t || ms > extremes[extremes.length - 1].t) return null;
    for (var i = 0; i < extremes.length - 1; i++) {
      var a = extremes[i], b = extremes[i + 1];
      if (ms >= a.t && ms <= b.t) {
        var frac = (ms - a.t) / (b.t - a.t);
        var mid = (a.v + b.v) / 2, amp = (a.v - b.v) / 2;
        return mid + amp * Math.cos(Math.PI * frac);
      }
    }
    return null;
  }

  function meanOf(arr, from, to) {
    var sum = 0, n = 0;
    for (var i = Math.max(0, from); i <= Math.min(arr.length - 1, to); i++) {
      if (isNum(arr[i])) { sum += arr[i]; n++; }
    }
    return n ? sum / n : null;
  }

  /* Water temperature with no sensor anywhere: air temperature is averaged into
     daily means first (so the time of day you happen to open the app cannot
     tilt the answer), then exponentially weighted with a three-day half-life
     over the last ten days, then shifted by a per-class offset.

     The offsets are measured, not guessed. Comparing this estimate against the
     live USGS gauges at ten NorCal spots gave mean errors of -3.5 °F on free-
     flowing rivers (n=5, sd 2.6) and +0.8 °F on tidal river reaches (n=4,
     sd 4.0); the tidal spread is real, because coastal fog holds the air down
     while the river still carries warm water from inland. Lakes get +1.5: the
     only lake-tagged gauge available is a cold dam release and is not
     representative of a lake surface, so that one comes from the physics rather
     than the fit. Overall mean absolute error is about 2.6 °F.

     Always flagged as modeled, and counted at half weight toward confidence. */
  var CLASS_OFFSET_F = {
    river: -3.5,
    'tidal-river': 0.8,
    delta: 0.8,
    lake: 1.5,
    bay: 0,
    ocean: -2,
    surf: -2
  };

  function modelWaterF(weather, nowMs, waterClass) {
    if (!weather || !weather.times.length) return null;
    var offsetSeconds = weather.offsetSeconds || 0;
    var days = {};
    for (var i = 0; i < weather.times.length; i++) {
      var dt = (nowMs - weather.times[i]) / 86400000;
      if (dt < 0 || dt > 10 || !isNum(weather.airF[i])) continue;
      var day = Math.floor((weather.times[i] + offsetSeconds * 1000) / 86400000);
      if (!days[day]) days[day] = { sum: 0, n: 0 };
      days[day].sum += weather.airF[i];
      days[day].n++;
    }
    var nowDay = Math.floor((nowMs + offsetSeconds * 1000) / 86400000);
    var k = Math.LN2 / 3;
    var sum = 0, wsum = 0;
    Object.keys(days).forEach(function (day) {
      var d = days[day];
      if (d.n < 12) return;                 // ignore partial days at either end
      var w = Math.exp(-k * (nowDay - Number(day)));
      sum += w * (d.sum / d.n);
      wsum += w;
    });
    if (!wsum) return null;
    var offset = CLASS_OFFSET_F[waterClass];
    return clamp(sum / wsum + (isNum(offset) ? offset : 0), 33, 92);
  }

  /* --------------------------------------------------------------- loading */

  var PAST_HOURS = 72;
  var FUTURE_HOURS = 72;

  function load(spot) {
    var nowMs = Math.floor(Date.now() / HOUR) * HOUR;
    var startMs = nowMs - PAST_HOURS * HOUR;
    var wantsMarine = ['ocean', 'surf', 'bay', 'tidal-river'].indexOf(spot.cls) !== -1;

    return Promise.all([
      loadWeather(spot.lat, spot.lon),
      wantsMarine ? loadMarine(spot.lat, spot.lon) : Promise.resolve({ data: null, status: 'n/a' }),
      loadUsgs(spot.gauges),
      loadTides(spot.tide, startMs - 6 * HOUR, PAST_HOURS + FUTURE_HOURS + 12)
    ]).then(function (res) {
      var wx = res[0], marine = res[1], usgs = res[2], tide = res[3];

      // Water temperature falls back to a CO-OPS station only when nothing
      // better exists, since many stations do not carry the sensor.
      var haveGaugeTemp = !!(usgs.data && usgs.data.params['00010']) ||
        !!(root.BITE_CDEC && spot.cdec && spot.cdec.temp);
      var haveSst = !!(marine.data && marine.data.hasSst);
      var needStation = !haveGaugeTemp && !haveSst && !!spot.tide;
      return (needStation ? loadStationTemp(spot.tide) : Promise.resolve({ data: null, status: 'n/a' }))
        .then(function (stationTemp) {
          return assemble(spot, nowMs, wx, marine, usgs, tide, stationTemp);
        });
    });
  }

  function assemble(spot, nowMs, wx, marine, usgs, tide, stationTemp) {
    var weather = wx.data;
    var offsetSeconds = weather ? weather.offsetSeconds : -8 * 3600;

    var wxIndex = {};
    if (weather) weather.times.forEach(function (t, i) { wxIndex[t] = i; });
    var marineIndex = {};
    if (marine.data) marine.data.times.forEach(function (t, i) { marineIndex[t] = i; });

    // CDEC first where the spot declares it: on the Feather the USGS fallback
    // is a different river 25 miles downstream and reads well over ten degrees
    // warm, which is enough to flip a salmon score on its own.
    var cdecTemp = cdecSeries(spot, 'temp');
    var cdecFlow = cdecSeries(spot, 'flow');
    var tempSeries = cdecTemp || pickParam(usgs.data, '00010');
    var flowSeries = cdecFlow || pickParam(usgs.data, '00060');
    var stageSeries = pickParam(usgs.data, '00065');
    var turbSeries = pickParam(usgs.data, '63680');

    // Where the water temperature comes from, best source first.
    var water = { source: null, label: null, siteName: null, distanceMi: null };
    if (cdecTemp) {
      water.source = 'cdec';
      water.label = 'CDEC';
      water.siteName = cdecTemp.siteName;
    } else if (tempSeries) {
      water.source = 'gauge';
      water.label = 'Gauge';
      water.siteName = tempSeries.siteName;
      water.distanceMi = tempSeries.lat != null && spotsApi
        ? spotsApi.haversineMi(spot.lat, spot.lon, tempSeries.lat, tempSeries.lon) : null;
    } else if (marine.data && marine.data.hasSst) {
      water.source = 'satellite';
      water.label = 'Satellite SST';
      water.siteName = 'Open-Meteo marine model';
    } else if (stationTemp.data) {
      water.source = 'station';
      water.label = 'NOAA station';
      water.siteName = stationTemp.data.name || 'Tide station';
    } else {
      water.source = 'modeled';
      water.label = 'Modeled';
      water.siteName = 'From 10-day air temperature';
    }

    var modeled = modelWaterF(weather, nowMs, spot.cls);
    var tempIsCelsius = !cdecTemp;   // USGS reports deg C, CDEC reports deg F
    var toF = function (v) { return tempIsCelsius ? cToF(v) : v; };
    var lastGaugeF = tempSeries ? toF(tempSeries.points[tempSeries.points.length - 1].v) : null;
    var lastGaugeT = tempSeries ? tempSeries.points[tempSeries.points.length - 1].t : null;
    var lastFlow = flowSeries ? flowSeries.points[flowSeries.points.length - 1].v : null;
    var lastFlowT = flowSeries ? flowSeries.points[flowSeries.points.length - 1].t : null;
    var lastTurb = turbSeries ? turbSeries.points[turbSeries.points.length - 1].v : null;
    var lastTurbT = turbSeries ? turbSeries.points[turbSeries.points.length - 1].t : null;

    var nowIndex = PAST_HOURS;
    var series = [];
    for (var i = 0; i <= PAST_HOURS + FUTURE_HOURS; i++) {
      var t = nowMs + (i - PAST_HOURS) * HOUR;
      var wi = wxIndex[t];
      var mi = marineIndex[t];
      var h = {
        t: t,
        airF: pick(weather && weather.airF, wi),
        pressureHpa: pick(weather && weather.pressureHpa, wi),
        cloudPct: pick(weather && weather.cloudPct, wi),
        windMph: pick(weather && weather.windMph, wi),
        windDirDeg: pick(weather && weather.windDirDeg, wi),
        gustMph: pick(weather && weather.gustMph, wi),
        precipIn: pick(weather && weather.precipIn, wi),
        weatherCode: pick(weather && weather.weatherCode, wi),
        waveFt: pick(marine.data && marine.data.waveFt, mi),
        wavePeriodS: pick(marine.data && marine.data.wavePeriodS, mi),
        sunAltDeg: astro ? astro.sunPosition(new Date(t), spot.lat, spot.lon).altitude : null,
        tideFt: tide.data ? tideAt(tide.data, t) : null,
        flowCfs: null,
        stageFt: null,
        turbidityNtu: null,
        waterF: null,
        waterSource: water.source,
        projected: false,
        waterProjected: false
      };

      // River sensors: measured up to the last reading, then held forward.
      if (flowSeries) {
        h.flowCfs = sampleAt(flowSeries.points, t, 90 * 60000);
        if (h.flowCfs === null && t > lastFlowT) { h.flowCfs = lastFlow; h.projected = true; }
      }
      if (stageSeries) h.stageFt = sampleAt(stageSeries.points, t, 90 * 60000);
      if (turbSeries) {
        h.turbidityNtu = sampleAt(turbSeries.points, t, 120 * 60000);
        if (h.turbidityNtu === null && lastTurbT !== null && t > lastTurbT) h.turbidityNtu = lastTurb;
      }

      // Water temperature per the resolved source.
      if (water.source === 'gauge' || water.source === 'cdec') {
        var g = sampleAt(tempSeries.points, t, 90 * 60000);
        if (g !== null) h.waterF = toF(g);
        else if (t > lastGaugeT && isNum(lastGaugeF)) {
          h.waterF = lastGaugeF; h.waterProjected = true;
        }
      } else if (water.source === 'satellite') {
        h.waterF = pick(marine.data.sstF, mi);
      } else if (water.source === 'station') {
        h.waterF = stationTemp.data.f;
      } else if (water.source === 'modeled') {
        h.waterF = modeled;
      }
      series.push(h);
    }

    // Forecast water temperature: hold the last reading, nudged by the damped
    // air-temperature trend. Rivers follow the air slowly, so 15% of the swing
    // over a day, capped at four degrees.
    if ((water.source === 'gauge' || water.source === 'station' || water.source === 'cdec') && weather) {
      var airNow = meanOf(series.map(function (h) { return h.airF; }), nowIndex - 23, nowIndex);
      for (var k = nowIndex + 1; k < series.length; k++) {
        if (!series[k].waterProjected || !isNum(series[k].waterF)) continue;
        var airThen = meanOf(series.map(function (h) { return h.airF; }), k - 23, k);
        if (isNum(airNow) && isNum(airThen)) {
          series[k].waterF = series[k].waterF + clamp(0.15 * (airThen - airNow), -4, 4);
        }
      }
    }

    // Solunar periods for every local day the window touches.
    var solunar = [];
    if (astro) {
      var firstLocalMidnight = Math.floor((series[0].t + offsetSeconds * 1000) / 86400000) * 86400000 - offsetSeconds * 1000;
      for (var d = 0; d <= 8; d++) {
        var dayStart = firstLocalMidnight + d * 86400000;
        if (dayStart > series[series.length - 1].t) break;
        solunar = solunar.concat(astro.solunarPeriods(new Date(dayStart), spot.lat, spot.lon));
      }
      solunar = solunar.map(function (p) {
        return {
          type: p.type, label: p.label, strength: p.strength,
          peak: p.peak.valueOf(), start: p.start.valueOf(), end: p.end.valueOf()
        };
      });
    }

    var sun = astro ? astro.sunTimes(new Date(nowMs), spot.lat, spot.lon) : null;
    var moon = astro ? astro.moonIllumination(new Date(nowMs)) : null;
    var moonTimes = astro ? astro.moonTimes(new Date(nowMs - 12 * HOUR), spot.lat, spot.lon) : null;

    return {
      spot: spot,
      utcOffsetSeconds: offsetSeconds,
      timezone: weather ? weather.timezone : null,
      series: series,
      nowIndex: nowIndex,
      solunar: solunar,
      sun: sun,
      moon: moon,
      moonTimes: moonTimes,
      water: water,
      gauge: tempSeries || flowSeries || null,
      // Raw ten-day gauge records, for the hydrograph and the river read.
      gaugeSeries: { temp: tempSeries, flow: flowSeries, stage: stageSeries, turbidity: turbSeries },
      tideExtremes: tide.data || null,
      tideStation: spot.tide && spotsApi ? spotsApi.tideStations[spot.tide] : null,
      elevationM: weather ? weather.elevation : null,
      sources: [
        { key: 'weather', label: 'Weather', status: wx.status, at: wx.at, error: wx.error },
        { key: 'marine', label: 'Marine', status: marine.status, at: marine.at, error: marine.error },
        { key: 'river', label: 'River gauge', status: spot.gauges ? usgs.status : 'n/a', at: usgs.at, error: usgs.error },
        { key: 'tide', label: 'Tide', status: spot.tide ? tide.status : 'n/a', at: tide.at, error: tide.error },
        {
          key: 'cdec', label: 'CDEC', status: cdecStatus(spot),
          at: (root.BITE_CDEC && root.BITE_CDEC.fetchedAt) || null,
          error: cdecStatus(spot) === 'stale' ? 'readings have not refreshed in over 6 hours' : null
        }
      ],
      stale: [wx, marine, usgs, tide].some(function (r) { return r.status === 'stale'; }),
      offline: wx.status === 'down'
    };
  }

  function pick(arr, i) {
    if (!arr || i === undefined || i === null) return null;
    var v = arr[i];
    return isNum(v) ? v : null;
  }

  /* First site in the response that actually reports this parameter. */
  function pickParam(usgsData, code) {
    if (!usgsData || !usgsData.params[code] || !usgsData.params[code].length) return null;
    var entry = usgsData.params[code][0];
    var site = usgsData.sites[entry.site] || {};
    return {
      siteId: entry.site,
      siteName: site.name,
      lat: site.lat,
      lon: site.lon,
      points: entry.points
    };
  }

  var api = {
    load: load,
    tideAt: tideAt,
    sampleAt: sampleAt,
    modelWaterF: modelWaterF,
    clearCache: function () {
      try {
        Object.keys(localStorage).forEach(function (k) {
          if (k.indexOf(CACHE_PREFIX) === 0) localStorage.removeItem(k);
        });
      } catch (e) { /* storage unavailable */ }
    }
  };

  root.BITE = root.BITE || {};
  root.BITE.data = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
