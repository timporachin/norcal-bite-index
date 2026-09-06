/* Bite Index — scoring engine.

   Pure functions: no DOM, no network. Takes an hourly environment series and
   returns an hourly bite score with a full factor breakdown, so the gauge, the
   timeline and the scrubber all read from one array.

   What this is: a transparent weighted index over measured conditions. Every
   factor curve below is a published fish-behaviour relationship or a long-
   established Northern California angling rule of thumb, written down where you
   can see it and argue with it. It is not a validated predictor and it does not
   know whether the fish are actually there.

   Each factor returns 0..1. The score is a weighted mean of the factors that
   have data, multiplied by any gates that fire. Factors without data are
   dropped and the remaining weights renormalised, which is also how confidence
   is computed — a dead sensor lowers confidence instead of quietly skewing the
   result.
*/
(function (root) {
  'use strict';

  var species = (root.BITE && root.BITE.species) ||
    (typeof require === 'function' ? require('./fish-species.js') : null);

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /* Piecewise-linear lookup through [x, y] control points. */
  function ramp(points, x) {
    if (!isNum(x)) return null;
    if (x <= points[0][0]) return points[0][1];
    var last = points[points.length - 1];
    if (x >= last[0]) return last[1];
    for (var i = 0; i < points.length - 1; i++) {
      var a = points[i], b = points[i + 1];
      if (x >= a[0] && x <= b[0]) {
        var t = b[0] === a[0] ? 0 : (x - a[0]) / (b[0] - a[0]);
        return a[1] + (b[1] - a[1]) * t;
      }
    }
    return last[1];
  }

  /* ---------------------------------------------------------------- weights */

  var PROFILES = {
    riverRun: {
      label: 'River run',
      weights: { run: 22, flow: 20, temp: 16, clarity: 10, tide: 10, light: 8, pressure: 6, solunar: 5, sky: 3 }
    },
    ocean: {
      label: 'Open coast',
      weights: { temp: 20, swell: 18, upwelling: 12, tide: 12, light: 12, run: 12, pressure: 8, solunar: 6 }
    },
    bay: {
      label: 'Bay & Delta',
      weights: { tide: 24, temp: 16, light: 14, run: 12, pressure: 12, solunar: 10, wind: 6, sky: 6 }
    },
    surf: {
      label: 'Surf',
      weights: { tide: 30, swell: 20, light: 12, run: 10, temp: 10, wind: 10, pressure: 8 }
    },
    lake: {
      label: 'Lake',
      weights: { temp: 22, pressure: 18, solunar: 14, light: 14, run: 10, wind: 10, sky: 8, front: 4 }
    }
  };

  var FACTOR_LABELS = {
    run: 'Run timing',
    flow: 'Flow & freshet',
    temp: 'Water temperature',
    clarity: 'Water clarity',
    tide: 'Tide movement',
    light: 'Light window',
    pressure: 'Barometric trend',
    solunar: 'Solunar',
    sky: 'Sky & rain',
    wind: 'Wind',
    swell: 'Swell',
    upwelling: 'Upwelling',
    front: 'Frontal shock'
  };

  var VERDICTS = [
    { min: 90, label: 'Blitz', tone: 'blitz' },
    { min: 75, label: 'Prime', tone: 'prime' },
    { min: 60, label: 'Good', tone: 'good' },
    { min: 40, label: 'Fair', tone: 'fair' },
    { min: 20, label: 'Slow', tone: 'slow' },
    { min: 0, label: 'Dormant', tone: 'dormant' }
  ];

  function verdictFor(score) {
    for (var i = 0; i < VERDICTS.length; i++) if (score >= VERDICTS[i].min) return VERDICTS[i];
    return VERDICTS[VERDICTS.length - 1];
  }

  /* ---------------------------------------------------------------- factors */

  /* Water temperature against the species bands. Anchored at the edges of the
     optimal, workable and survivable ranges, so an asymmetric species (cold
     tolerant, heat intolerant) gets an asymmetric curve for free. */
  function tempFactor(waterF, sp) {
    if (!isNum(waterF) || !sp) return null;
    var opt = sp.opt, ok = sp.ok, sv = sp.survive;
    var pts = [
      [sv[0], 0.04], [ok[0], 0.38], [opt[0], 1], [opt[1], 1], [ok[1], 0.38], [sv[1], 0.04]
    ];
    var v = ramp(pts, waterF);
    if (waterF < sv[0] || waterF > sv[1]) v = 0.02;
    // Migration and feeding stall above the species' stress threshold.
    if (isNum(sp.stallAbove) && waterF > sp.stallAbove) {
      v *= ramp([[sp.stallAbove, 1], [sp.stallAbove + 6, 0.25]], waterF);
    }
    return clamp01(v);
  }

  /* Barometric trend over three hours. Falling ahead of a front is the classic
     feeding window; a hard post-front rise is the classic shutdown. */
  function pressureFactor(delta3) {
    if (!isNum(delta3)) return null;
    return clamp01(ramp([
      [-7, 0.45], [-5, 0.62], [-3.5, 1.0], [-1.5, 1.0], [-0.6, 0.78],
      [0, 0.56], [0.6, 0.46], [2, 0.30], [3.5, 0.20], [6, 0.15]
    ], delta3));
  }

  /* Solunar: strongest inside a major period (moon overhead or underfoot),
     decent inside a minor (moonrise, moonset), quiet in between. */
  function solunarFactor(ms, periods) {
    if (!periods || !periods.length) return null;
    var best = 0.34;
    for (var i = 0; i < periods.length; i++) {
      var p = periods[i];
      var span = p.end - p.start;
      if (ms < p.start || ms > p.end || span <= 0) continue;
      var off = Math.abs(ms - p.peak) / (span / 2);
      var taper = 0.5 + 0.5 * Math.cos(Math.min(1, off) * Math.PI);
      var v = 0.34 + (p.strength * taper) * 0.66;
      if (v > best) best = v;
    }
    return clamp01(best);
  }

  /* Light. Predators feed hardest in the low-angle light either side of
     sunrise and sunset; heavy cloud softens the midday penalty; some species
     do their best work in the dark. */
  function lightFactor(sunAltDeg, cloudPct, nightBias) {
    if (!isNum(sunAltDeg)) return null;
    var v = ramp([
      [-18, 0.42], [-12, 0.5], [-6, 0.88], [-1, 1.0], [4, 1.0],
      [10, 0.74], [22, 0.46], [35, 0.32], [60, 0.28]
    ], sunAltDeg);
    if (sunAltDeg > 8 && isNum(cloudPct)) v += (cloudPct / 100) * 0.26;
    if (sunAltDeg < -6 && isNum(nightBias) && nightBias > 0) {
      v = Math.max(v, nightBias);
    }
    return clamp01(v);
  }

  /* Wind. A light chop breaks up the surface and pushes bait; dead calm is
     hard, and a gale is harder. */
  function windFactor(mph) {
    if (!isNum(mph)) return null;
    return clamp01(ramp([
      [0, 0.5], [4, 0.76], [7, 0.94], [10, 1.0], [14, 0.95],
      [18, 0.76], [22, 0.52], [28, 0.26], [38, 0.1]
    ], mph));
  }

  /* Sky and rain, still water version: overcast helps, a squall hurts. */
  function skyFactor(cloudPct, precipIn) {
    if (!isNum(cloudPct) && !isNum(precipIn)) return null;
    var v = isNum(cloudPct) ? ramp([[0, 0.55], [30, 0.68], [60, 0.88], [85, 0.97], [100, 0.92]], cloudPct) : 0.7;
    if (isNum(precipIn)) {
      if (precipIn > 0.3) v *= 0.55;
      else if (precipIn > 0.08) v *= 0.85;
      else if (precipIn > 0.005) v = Math.min(1, v + 0.08);
    }
    return clamp01(v);
  }

  /* Sky and rain, river version: rain is the migration trigger, not a nuisance. */
  function skyFactorRiver(cloudPct, precipIn) {
    if (!isNum(cloudPct) && !isNum(precipIn)) return null;
    var v = isNum(cloudPct) ? ramp([[0, 0.55], [40, 0.72], [75, 0.92], [100, 0.95]], cloudPct) : 0.7;
    if (isNum(precipIn) && precipIn > 0.005) {
      v = Math.max(v, ramp([[0.005, 0.85], [0.05, 1.0], [0.35, 0.9], [0.8, 0.7]], precipIn));
    }
    return clamp01(v);
  }

  /* Tide. Moving water feeds fish; slack water does not. `rate` is ft/hr,
     `maxRate` the biggest swing in the window, `pref` the species' preference. */
  function tideFactor(rate, maxRate, pref) {
    if (!isNum(rate) || !isNum(maxRate) || maxRate <= 0) return null;
    var moving = clamp01(Math.pow(Math.abs(rate) / maxRate, 0.75));
    var v = 0.22 + 0.78 * moving;
    if (pref === 'flood' && rate < 0) v *= 0.78;       // salmon pushing in on the incoming
    if (pref === 'ebb' && rate > 0) v *= 0.82;
    return clamp01(v);
  }

  /* Flow. The heart of the river-salmon model: a rain-driven rise moves fish,
     a dropping and clearing river fishes best for steelhead, a trickle and a
     flood are both bad. */
  function flowFactor(ratio, delta24, pref) {
    if (!isNum(delta24)) return null;
    var rising = ramp([
      [-0.5, 0.42], [-0.25, 0.62], [-0.08, 0.72], [0, 0.6],
      [0.05, 0.82], [0.25, 1.0], [0.7, 0.95], [1.5, 0.6], [3, 0.32]
    ], delta24);
    var dropping = ramp([
      [-0.5, 0.5], [-0.3, 0.82], [-0.12, 1.0], [-0.03, 0.9],
      [0, 0.72], [0.1, 0.62], [0.4, 0.42], [1.2, 0.25]
    ], delta24);
    var steady = ramp([
      [-0.4, 0.45], [-0.15, 0.72], [0, 0.9], [0.15, 0.8], [0.6, 0.5], [1.5, 0.28]
    ], delta24);
    var v = pref === 'dropping' ? dropping : pref === 'steady' ? steady : rising;
    // A river running well under its recent baseline holds fewer moving fish.
    if (isNum(ratio)) v *= ramp([[0.25, 0.55], [0.5, 0.8], [0.8, 1], [3, 1], [6, 0.7], [10, 0.5]], ratio);
    return clamp01(v);
  }

  /* Clarity. Around a foot or two of visibility is the sweet spot: enough
     colour to hide the angler, enough clarity for the fish to find the lure. */
  function clarityFactor(ntu, pref) {
    if (!isNum(ntu)) return null;
    var v = ramp([
      [0, 0.58], [1.5, 0.72], [4, 1.0], [14, 1.0], [25, 0.82],
      [45, 0.55], [90, 0.28], [180, 0.12]
    ], ntu);
    // Half-pounders and summer steelhead want the low, clear water.
    if (pref === 'clear') v = ramp([[0, 1.0], [6, 1.0], [18, 0.72], [40, 0.42], [90, 0.18]], ntu);
    return clamp01(v);
  }

  /* Swell: fishability first, but big water also scatters the bite inshore. */
  function swellFactor(ft) {
    if (!isNum(ft)) return null;
    return clamp01(ramp([
      [0, 0.86], [1.5, 0.95], [3, 1.0], [5, 0.95], [7, 0.78],
      [9, 0.55], [12, 0.28], [16, 0.1]
    ], ft));
  }

  /* Upwelling. Sustained northwesterlies drive cold water up the coast and push
     the salmon bite around; the relaxation right after is the window. */
  function upwellingFactor(nwRecent, windNow, dirNow) {
    if (!isNum(nwRecent) || !isNum(windNow)) return null;
    var blowingNow = isNum(dirNow) && dirNow >= 285 && dirNow <= 360 && windNow > 14;
    if (nwRecent > 12 && windNow < 10) return 1.0;        // relaxation after a blow
    if (blowingNow) return clamp01(ramp([[14, 0.55], [22, 0.35], [30, 0.2]], windNow));
    if (nwRecent > 8) return 0.82;
    return 0.62;
  }

  /* Frontal shock: the bluebird day right after a hard cold front. */
  function frontFactor(airDelta24, pressDelta24) {
    if (!isNum(airDelta24) && !isNum(pressDelta24)) return null;
    var v = 1;
    if (isNum(pressDelta24) && pressDelta24 > 4) v *= ramp([[4, 0.95], [8, 0.6], [14, 0.4]], pressDelta24);
    if (isNum(airDelta24) && airDelta24 < -12) v *= ramp([[-12, 0.95], [-22, 0.6], [-32, 0.45]], airDelta24);
    return clamp01(v);
  }

  /* ------------------------------------------------------------ derivations */

  function deltaBack(series, i, key, hoursBack) {
    var j = i - hoursBack;
    if (j < 0) return null;
    var a = series[j][key], b = series[i][key];
    return isNum(a) && isNum(b) ? b - a : null;
  }

  function relDeltaBack(series, i, key, hoursBack) {
    var j = i - hoursBack;
    if (j < 0) return null;
    var a = series[j][key], b = series[i][key];
    if (!isNum(a) || !isNum(b) || a <= 0) return null;
    return (b - a) / a;
  }

  function median(values) {
    var v = values.filter(isNum).slice().sort(function (a, b) { return a - b; });
    if (!v.length) return null;
    var mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  /* Turbidity estimate for rivers with no turbidity sensor: a rising river
     carries colour, a settled one runs clear. Flagged as estimated so it counts
     for half in the confidence total. */
  function estimateNtu(flowDelta24, precip24) {
    if (!isNum(flowDelta24) && !isNum(precip24)) return null;
    var ntu = 4;
    if (isNum(flowDelta24) && flowDelta24 > 0) ntu += flowDelta24 * 90;
    if (isNum(flowDelta24) && flowDelta24 < 0) ntu = Math.max(1.5, ntu + flowDelta24 * 6);
    if (isNum(precip24)) ntu += precip24 * 45;
    return Math.min(ntu, 250);
  }

  /* --------------------------------------------------------------- scoring */

  var THUNDER_CODES = { 95: 1, 96: 1, 99: 1 };

  /* env:
       { spot, speciesId, series: [hourly], solunar: [periods], nowIndex }
     Each series entry may carry:
       t, airF, waterF, waterSource, pressureHpa, cloudPct, windMph, gustMph,
       windDirDeg, precipIn, weatherCode, sunAltDeg, tideFt, flowCfs, turbidityNtu,
       waveFt
  */
  function scoreSeries(env) {
    var sp = species.byId[env.speciesId];
    var spot = env.spot || {};
    var series = env.series || [];
    var profileKey = species.profileFor(sp, spot.cls);
    var profile = PROFILES[profileKey] || PROFILES.lake;
    var weights = profile.weights;

    // Window-wide references.
    var tideRates = [];
    for (var i = 1; i < series.length; i++) {
      if (isNum(series[i].tideFt) && isNum(series[i - 1].tideFt)) {
        tideRates.push(Math.abs(series[i].tideFt - series[i - 1].tideFt));
      }
    }
    tideRates.sort(function (a, b) { return b - a; });
    var maxTideRate = tideRates.length ? tideRates[Math.floor(tideRates.length * 0.05)] : null;

    var flowBaseline = median(series.map(function (h) { return h.flowCfs; }));

    var tidePref = profileKey === 'riverRun' ? 'flood'
      : (sp && sp.id === 'surfperch') ? 'flood' : null;
    var flowPref = (sp && sp.flowPref) || 'rising';
    var clarityPref = (sp && sp.clarityPref) || null;
    var nightBias = (sp && sp.nightBias) || 0;

    var hours = series.map(function (h, idx) {
      var factors = [];
      var precip24 = 0, precipKnown = false;
      for (var k = Math.max(0, idx - 23); k <= idx; k++) {
        if (isNum(series[k].precipIn)) { precip24 += series[k].precipIn; precipKnown = true; }
      }

      function add(key, value, detail, estimated) {
        var w = weights[key];
        if (!w) return;
        factors.push({
          key: key,
          label: FACTOR_LABELS[key] || key,
          weight: w,
          value: value,
          available: isNum(value),
          estimated: !!estimated,
          detail: detail || null
        });
      }

      // Run timing
      var runV = null, runDetail = null;
      if (weights.run) {
        var d = dayOfYear(h.t, env.utcOffsetSeconds);
        runV = species.runStrength(sp, d, spot.system);
        runDetail = { dayOfYear: d, system: spot.system };
      }
      add('run', runV, runDetail);

      // Water temperature
      add('temp', tempFactor(h.waterF, sp), { waterF: h.waterF, source: h.waterSource, opt: sp && sp.opt },
        h.waterSource === 'modeled');

      // Barometric trend
      var dp3 = deltaBack(series, idx, 'pressureHpa', 3);
      add('pressure', pressureFactor(dp3), { delta3: dp3, hpa: h.pressureHpa });

      // Solunar
      add('solunar', solunarFactor(h.t, env.solunar), null);

      // Light
      add('light', lightFactor(h.sunAltDeg, h.cloudPct, nightBias), { sunAltDeg: h.sunAltDeg });

      // Wind
      add('wind', windFactor(h.windMph), { mph: h.windMph, dir: h.windDirDeg });

      // Sky
      add('sky', profileKey === 'riverRun'
        ? skyFactorRiver(h.cloudPct, h.precipIn)
        : skyFactor(h.cloudPct, h.precipIn), { cloudPct: h.cloudPct, precipIn: h.precipIn });

      // Tide
      var rate = null;
      if (idx > 0 && isNum(h.tideFt) && isNum(series[idx - 1].tideFt)) {
        rate = h.tideFt - series[idx - 1].tideFt;
      }
      add('tide', tideFactor(rate, maxTideRate, tidePref),
        { ft: h.tideFt, rate: rate, state: rate === null ? null : rate > 0.03 ? 'flood' : rate < -0.03 ? 'ebb' : 'slack' });

      // Flow
      var fd24 = relDeltaBack(series, idx, 'flowCfs', 24);
      var ratio = isNum(h.flowCfs) && isNum(flowBaseline) && flowBaseline > 0 ? h.flowCfs / flowBaseline : null;
      add('flow', flowFactor(ratio, fd24, flowPref), { cfs: h.flowCfs, delta24: fd24, ratio: ratio, pref: flowPref });

      // Clarity
      var ntu = h.turbidityNtu;
      var ntuEstimated = false;
      if (!isNum(ntu) && weights.clarity) {
        ntu = estimateNtu(fd24, precipKnown ? precip24 : null);
        ntuEstimated = isNum(ntu);
      }
      add('clarity', clarityFactor(ntu, clarityPref), { ntu: ntu, estimated: ntuEstimated }, ntuEstimated);

      // Swell
      add('swell', swellFactor(h.waveFt), { ft: h.waveFt });

      // Upwelling
      var nwRecent = null;
      if (weights.upwelling) {
        var nwMax = null;
        for (var m = Math.max(0, idx - 24); m <= idx; m++) {
          var s = series[m];
          if (isNum(s.windMph) && isNum(s.windDirDeg) && s.windDirDeg >= 285 && s.windDirDeg <= 360) {
            if (nwMax === null || s.windMph > nwMax) nwMax = s.windMph;
          }
        }
        nwRecent = nwMax === null ? 0 : nwMax;
      }
      add('upwelling', upwellingFactor(nwRecent, h.windMph, h.windDirDeg), { nwRecent: nwRecent });

      // Frontal shock
      add('front', frontFactor(deltaBack(series, idx, 'airF', 24), deltaBack(series, idx, 'pressureHpa', 24)), null);

      // Weighted mean over the factors that have data.
      var sumW = 0, sumWV = 0, availW = 0, totalW = 0, confW = 0;
      factors.forEach(function (f) {
        totalW += f.weight;
        if (f.available) {
          sumW += f.weight;
          sumWV += f.weight * f.value;
          availW += f.weight;
          confW += f.weight * (f.estimated ? 0.5 : 1);
        }
      });
      var base = sumW > 0 ? sumWV / sumW : 0.4;

      // Gates
      var gates = [];
      var mult = 1;
      if (h.weatherCode && THUNDER_CODES[h.weatherCode]) {
        mult *= 0.35; gates.push({ key: 'thunder', label: 'Thunderstorm — get off the water' });
      }
      if (isNum(h.waterF) && sp && (h.waterF < sp.survive[0] || h.waterF > sp.survive[1])) {
        mult *= 0.25; gates.push({ key: 'lethal', label: 'Water outside this species’ range' });
      }
      if (isNum(ratio) && ratio > 5) {
        mult *= 0.5; gates.push({ key: 'blownout', label: 'River blown out' });
      }
      if (isNum(h.waveFt) && h.waveFt > 12) {
        mult *= 0.6; gates.push({ key: 'swell', label: 'Swell too big to fish' });
      }
      // Presence gate. For the migratory profiles the run curve is not a
      // preference, it is whether the fish are in the system at all — and no
      // amount of perfect water makes up for an empty river. Weighted averaging
      // alone cannot express that, so it is applied as a multiplier.
      if ((profileKey === 'riverRun' || profileKey === 'ocean') && isNum(runV) && runV < 0.35) {
        mult *= ramp([[0, 0.28], [0.15, 0.45], [0.25, 0.68], [0.35, 1]], runV);
        if (runV < 0.2) {
          gates.push({
            key: 'offseason',
            label: sp && sp.name ? sp.name + ' are barely in the system yet' : 'Out of season'
          });
        }
      }

      var score = Math.round(clamp01(base * mult) * 100);
      factors.forEach(function (f) {
        f.contribution = f.available ? (f.value - 0.5) * (f.weight / (sumW || 1)) * 100 : 0;
        f.share = sumW > 0 && f.available ? f.weight / sumW : 0;
      });

      return {
        t: h.t,
        score: score,
        verdict: verdictFor(score),
        confidence: totalW > 0 ? confW / totalW : 0,
        factors: factors,
        gates: gates,
        missing: factors.filter(function (f) { return !f.available; }).map(function (f) { return f.label; }),
        env: h,
        profile: profileKey,
        fishability: fishability(h, spot)
      };
    });

    return {
      profile: profileKey,
      profileLabel: profile.label,
      weights: weights,
      hours: hours,
      windows: bestWindows(hours, env.nowIndex || 0)
    };
  }

  /* Separate from the bite score on purpose: a hot bite on a dangerous day must
     never read as "go". Ocean, bar and surf spots only. */
  function fishability(h, spot) {
    if (!spot || ['ocean', 'surf', 'bay'].indexOf(spot.cls) === -1) return null;
    if (!isNum(h.windMph) && !isNum(h.waveFt)) return null;
    var wind = isNum(h.gustMph) ? Math.max(h.windMph || 0, h.gustMph) : h.windMph;
    var windScore = isNum(wind) ? ramp([[0, 1], [12, 0.9], [18, 0.7], [25, 0.4], [33, 0.15], [45, 0]], wind) : 1;
    var waveScore = isNum(h.waveFt) ? ramp([[0, 1], [3, 0.95], [5, 0.8], [7, 0.6], [10, 0.3], [14, 0.05]], h.waveFt) : 1;
    var v = Math.min(windScore, waveScore) * 0.65 + (windScore + waveScore) / 2 * 0.35;
    var score = Math.round(clamp01(v) * 100);
    var label = score >= 78 ? 'Good' : score >= 58 ? 'Workable' : score >= 38 ? 'Marginal' : score >= 20 ? 'Rough' : 'Dangerous';
    return { score: score, label: label, wind: wind, waveFt: h.waveFt };
  }

  /* The three best windows to actually go fishing. Grown outward from the
     highest remaining hour and kept short — a nine-hour "window" tells nobody
     when to leave the house — then the neighbourhood is claimed so the three
     results are genuinely different sessions rather than one long peak sliced
     three ways. */
  var MAX_WINDOW_HOURS = 6;
  var WINDOW_TOLERANCE = 7;
  var WINDOW_FLOOR = 45;

  function bestWindows(hours, fromIndex) {
    var future = hours.slice(fromIndex);
    if (!future.length) return [];
    var claimed = new Array(future.length);
    var out = [];

    for (var pass = 0; pass < 3; pass++) {
      var peakIdx = -1, peakScore = -1;
      for (var i = 0; i < future.length; i++) {
        if (!claimed[i] && future[i].score > peakScore) { peakScore = future[i].score; peakIdx = i; }
      }
      if (peakIdx === -1 || peakScore < WINDOW_FLOOR) break;

      var floor = Math.max(WINDOW_FLOOR, peakScore - WINDOW_TOLERANCE);
      var lo = peakIdx, hi = peakIdx;
      while (hi - lo + 1 < MAX_WINDOW_HOURS) {
        var canLeft = lo > 0 && !claimed[lo - 1] && future[lo - 1].score >= floor;
        var canRight = hi < future.length - 1 && !claimed[hi + 1] && future[hi + 1].score >= floor;
        if (!canLeft && !canRight) break;
        if (canRight && (!canLeft || future[hi + 1].score >= future[lo - 1].score)) hi++;
        else lo--;
      }

      out.push({
        start: future[lo].t,
        end: future[hi].t + 3600000,
        peak: peakScore,
        peakAt: future[peakIdx].t,
        verdict: future[peakIdx].verdict
      });
      // Claim the window plus a buffer so the next pass finds a different session.
      for (var c = Math.max(0, lo - 4); c <= Math.min(future.length - 1, hi + 4); c++) claimed[c] = true;
    }

    return out.sort(function (a, b) { return a.start - b.start; });
  }

  /* Day of year in the spot's local time, which is what run timing keys off. */
  function dayOfYear(ms, utcOffsetSeconds) {
    var local = new Date(ms + (utcOffsetSeconds || 0) * 1000);
    var start = Date.UTC(local.getUTCFullYear(), 0, 1);
    return Math.floor((local.valueOf() - start) / 86400000) + 1;
  }

  var api = {
    PROFILES: PROFILES,
    VERDICTS: VERDICTS,
    FACTOR_LABELS: FACTOR_LABELS,
    verdictFor: verdictFor,
    scoreSeries: scoreSeries,
    dayOfYear: dayOfYear,
    estimateNtu: estimateNtu,
    factors: {
      temp: tempFactor,
      pressure: pressureFactor,
      solunar: solunarFactor,
      light: lightFactor,
      wind: windFactor,
      sky: skyFactor,
      skyRiver: skyFactorRiver,
      tide: tideFactor,
      flow: flowFactor,
      clarity: clarityFactor,
      swell: swellFactor,
      upwelling: upwellingFactor,
      front: frontFactor
    }
  };

  root.BITE = root.BITE || {};
  root.BITE.model = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
