/* Bite Index — rendering and interaction.

   Reads one scored hourly array and paints every instrument from it: the dial,
   the 72-hour timeline, the conditions readout, the run panel and the factor
   breakdown. Dragging the timeline scrubs to any hour and every other panel
   follows, so the page is a time machine rather than a snapshot.
*/
(function () {
  'use strict';

  var B = window.BITE;
  var NS = 'http://www.w3.org/2000/svg';
  var PREF_KEY = 'bite-prefs-v1';
  var DEFAULT_SPOT = 'sac-freeport';

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var state = {
    spot: null,
    speciesId: null,
    env: null,
    scored: null,
    scrub: null,
    units: 'us',
    shown: 0,
    reqId: 0
  };

  /* ------------------------------------------------------------- utilities */

  function $(id) { return document.getElementById(id); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function el(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    if (text !== null && text !== undefined) n.textContent = text;
    return n;
  }

  function html(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== null && text !== undefined) n.textContent = text;
    return n;
  }

  /* Empty an SVG but keep its <title> so the accessible name survives. */
  function clearSvg(svg) {
    for (var i = svg.childNodes.length - 1; i >= 0; i--) {
      var n = svg.childNodes[i];
      if (n.nodeType === 1 && n.nodeName.toLowerCase() === 'title') continue;
      svg.removeChild(n);
    }
  }

  var BANDS = [
    { key: 'dormant', label: 'DORMANT', min: 0, max: 20, color: '#3d5b64' },
    { key: 'slow', label: 'SLOW', min: 20, max: 40, color: '#47859b' },
    { key: 'fair', label: 'FAIR', min: 40, max: 60, color: '#46b2d4' },
    { key: 'good', label: 'GOOD', min: 60, max: 75, color: '#2fd49b' },
    { key: 'prime', label: 'PRIME', min: 75, max: 90, color: '#ffc93d' },
    { key: 'blitz', label: 'BLITZ', min: 90, max: 100, color: '#ff6a4a' }
  ];

  var INK = '#eaf6f4';
  var SILT = '#8ba9af';
  var SILT2 = '#5f7d85';
  var TIDE = '#4fc3d9';
  var SALMON = '#ff7a55';
  var LINE = 'rgba(79,195,217,.16)';

  function bandFor(score) {
    for (var i = BANDS.length - 1; i >= 0; i--) if (score >= BANDS[i].min) return BANDS[i];
    return BANDS[0];
  }

  /* ------------------------------------------------------- time formatting */

  function offset() { return state.env ? state.env.utcOffsetSeconds : 0; }
  function parts(ms) {
    var d = new Date(ms + offset() * 1000);
    return { h: d.getUTCHours(), m: d.getUTCMinutes(), dow: d.getUTCDay(), date: d.getUTCDate(), mon: d.getUTCMonth() };
  }
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fmtHM(ms) {
    var p = parts(ms);
    var h = p.h % 12 || 12;
    return h + ':' + (p.m < 10 ? '0' : '') + p.m + (p.h < 12 ? 'am' : 'pm');
  }
  function fmtH(ms) {
    var p = parts(ms);
    var h = p.h % 12 || 12;
    return h + (p.h < 12 ? 'a' : 'p');
  }
  function fmtDay(ms) { return DOW[parts(ms).dow]; }

  function relativeDay(ms) {
    if (!state.env) return fmtDay(ms);
    var nowDay = Math.floor((state.env.series[state.env.nowIndex].t + offset() * 1000) / 86400000);
    var thatDay = Math.floor((ms + offset() * 1000) / 86400000);
    var diff = thatDay - nowDay;
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return DOW[parts(ms).dow];
  }

  /* ------------------------------------------------------------ unit sugar */

  function tempVal(f) { return state.units === 'us' ? f : (f - 32) * 5 / 9; }
  function tempStr(f, digits) {
    if (!isNum(f)) return '—';
    var v = tempVal(f);
    return (digits ? v.toFixed(digits) : Math.round(v)) + '°';
  }
  function tempUnit() { return state.units === 'us' ? '°F' : '°C'; }
  function speedVal(mph) { return state.units === 'us' ? mph : mph * 0.868976; }
  function speedUnit() { return state.units === 'us' ? 'mph' : 'kt'; }
  function num(v, digits) {
    if (!isNum(v)) return '—';
    return v.toLocaleString(undefined, { maximumFractionDigits: digits === undefined ? 0 : digits });
  }

  /* --------------------------------------------------------------- prefs */

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
      if (p.units === 'metric') state.units = 'metric';
      return p;
    } catch (e) { return {}; }
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({
        spot: state.spot && state.spot.id, species: state.speciesId, units: state.units
      }));
    } catch (e) { /* storage disabled */ }
  }

  /* ============================================================ THE DIAL == */

  var GX = 170, GY = 162, GR = 118, GLABEL = 142, SWEEP = 120;

  function angleFor(score) { return -SWEEP + (2 * SWEEP) * (score / 100); }

  function polar(r, a) {
    var rad = a * Math.PI / 180;
    return [GX + r * Math.sin(rad), GY - r * Math.cos(rad)];
  }

  function arc(r, a0, a1) {
    var p0 = polar(r, a0), p1 = polar(r, a1);
    var large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    return 'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) +
      'A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2);
  }

  var gaugeDyn = null;

  function buildGauge() {
    var svg = $('gauge');
    clearSvg(svg);

    var defs = el('defs');
    var glow = el('filter', { id: 'dialGlow', x: '-60%', y: '-60%', width: '220%', height: '220%' });
    glow.appendChild(el('feGaussianBlur', { stdDeviation: '5', result: 'b' }));
    var merge = el('feMerge');
    merge.appendChild(el('feMergeNode', { in: 'b' }));
    merge.appendChild(el('feMergeNode', { in: 'SourceGraphic' }));
    glow.appendChild(merge);
    defs.appendChild(glow);
    svg.appendChild(defs);

    var stat = el('g');

    // Ghosted track: every band at low opacity, separated by a 2px gap.
    BANDS.forEach(function (b) {
      var a0 = angleFor(b.min) + 1.1;
      var a1 = angleFor(b.max) - 1.1;
      stat.appendChild(el('path', {
        d: arc(GR, a0, a1), fill: 'none', stroke: b.color,
        'stroke-width': 15, 'stroke-linecap': 'butt', opacity: .22
      }));
      // Band name outside the arc — colour is never the only cue.
      var mid = (angleFor(b.min) + angleFor(b.max)) / 2;
      var p = polar(GLABEL, mid);
      var anchor = mid < -18 ? 'end' : mid > 18 ? 'start' : 'middle';
      stat.appendChild(el('text', {
        x: p[0].toFixed(1), y: (p[1] + 3).toFixed(1), 'text-anchor': anchor,
        fill: SILT2, 'font-size': 8.5, 'font-family': 'IBM Plex Mono, monospace',
        'letter-spacing': '.08em'
      }, b.label));
    });

    // Boundary ticks inside the arc.
    [20, 40, 60, 75, 90].forEach(function (s) {
      var a = angleFor(s);
      var p0 = polar(GR - 9, a), p1 = polar(GR - 15, a);
      stat.appendChild(el('line', {
        x1: p0[0].toFixed(1), y1: p0[1].toFixed(1), x2: p1[0].toFixed(1), y2: p1[1].toFixed(1),
        stroke: 'rgba(139,169,175,.4)', 'stroke-width': 1
      }));
    });

    // Confidence ring track.
    stat.appendChild(el('path', {
      d: arc(90, -SWEEP, SWEEP), fill: 'none', stroke: 'rgba(79,195,217,.13)',
      'stroke-width': 3, 'stroke-linecap': 'round'
    }));

    svg.appendChild(stat);
    gaugeDyn = el('g');
    svg.appendChild(gaugeDyn);
  }

  function paintGauge(score, confidence) {
    if (!gaugeDyn) return;
    while (gaugeDyn.firstChild) gaugeDyn.removeChild(gaugeDyn.firstChild);
    var band = bandFor(score);
    var valAngle = angleFor(score);

    // Filled portion, drawn band by band so the fill shows the true ramp.
    BANDS.forEach(function (b) {
      var a0 = angleFor(b.min) + 1.1;
      var a1 = Math.min(angleFor(b.max) - 1.1, valAngle);
      if (a1 <= a0) return;
      gaugeDyn.appendChild(el('path', {
        d: arc(GR, a0, a1), fill: 'none', stroke: b.color,
        'stroke-width': 15, 'stroke-linecap': 'butt',
        filter: b.key === band.key ? 'url(#dialGlow)' : null
      }));
    });

    if (isNum(confidence) && confidence > 0) {
      gaugeDyn.appendChild(el('path', {
        d: arc(90, -SWEEP, -SWEEP + 2 * SWEEP * confidence), fill: 'none',
        stroke: TIDE, 'stroke-width': 3, 'stroke-linecap': 'round', opacity: .75
      }));
    }

    // Needle.
    var tip = polar(GR - 24, valAngle);
    var b1 = polar(7, valAngle - 90);
    var b2 = polar(7, valAngle + 90);
    gaugeDyn.appendChild(el('path', {
      d: 'M' + tip[0].toFixed(1) + ' ' + tip[1].toFixed(1) +
        'L' + b1[0].toFixed(1) + ' ' + b1[1].toFixed(1) +
        'L' + b2[0].toFixed(1) + ' ' + b2[1].toFixed(1) + 'Z',
      fill: band.color, opacity: .95
    }));
  }

  var animHandle = null;

  function setScore(score, confidence, verdictLabel) {
    var scoreEl = $('scoreValue');
    var verdictEl = $('verdict');
    verdictEl.textContent = verdictLabel;
    verdictEl.style.color = bandFor(score).color;

    if (animHandle) cancelAnimationFrame(animHandle);
    var from = state.shown;
    var delta = score - from;
    if (reduceMotion || Math.abs(delta) < 1) {
      state.shown = score;
      scoreEl.textContent = score;
      paintGauge(score, confidence);
      return;
    }
    var start = null, dur = 620;
    function step(ts) {
      if (start === null) start = ts;
      var t = Math.min(1, (ts - start) / dur);
      var eased = 1 - Math.pow(1 - t, 3);
      var v = from + delta * eased;
      scoreEl.textContent = Math.round(v);
      paintGauge(v, confidence * eased + confidence * (1 - eased));
      if (t < 1) animHandle = requestAnimationFrame(step);
      else { state.shown = score; scoreEl.textContent = score; paintGauge(score, confidence); }
    }
    animHandle = requestAnimationFrame(step);
  }

  /* ======================================================== THE TIMELINE == */

  var TL = { w: 980, l: 36, r: 12, top: 14, scoreH: 176, gap: 18, tideH: 54 };
  TL.scoreBottom = TL.top + TL.scoreH;
  TL.tideTop = TL.scoreBottom + TL.gap;
  TL.tideBottom = TL.tideTop + TL.tideH;

  function tlRange() {
    var n = state.env.nowIndex;
    return { i0: Math.max(0, n - 12), i1: Math.min(state.env.series.length - 1, n + 72) };
  }
  function tlX(i, rng) {
    return TL.l + (i - rng.i0) / (rng.i1 - rng.i0) * (TL.w - TL.l - TL.r);
  }
  function tlY(score) { return TL.scoreBottom - (score / 100) * TL.scoreH; }

  function drawTimeline() {
    var svg = $('timeline');
    clearSvg(svg);
    if (!state.scored) return;

    var rng = tlRange();
    var hours = state.scored.hours;
    var series = state.env.series;

    var defs = el('defs');
    var grad = el('linearGradient', {
      id: 'scoreGrad', gradientUnits: 'userSpaceOnUse',
      x1: 0, y1: TL.top, x2: 0, y2: TL.scoreBottom
    });
    // Hard stops at the band edges, so height in the chart maps to the same
    // colour the dial uses for that band.
    for (var bi = BANDS.length - 1; bi >= 0; bi--) {
      var b = BANDS[bi];
      grad.appendChild(el('stop', { offset: ((100 - b.max) / 100 * 100).toFixed(2) + '%', 'stop-color': b.color }));
      grad.appendChild(el('stop', { offset: ((100 - b.min) / 100 * 100).toFixed(2) + '%', 'stop-color': b.color }));
    }
    defs.appendChild(grad);
    svg.appendChild(defs);

    var gBack = el('g');
    var gMain = el('g');
    var gFront = el('g');

    // Night shading across both panels.
    var runStart = null;
    for (var i = rng.i0; i <= rng.i1; i++) {
      var dark = isNum(series[i].sunAltDeg) && series[i].sunAltDeg < -6;
      if (dark && runStart === null) runStart = i;
      if ((!dark || i === rng.i1) && runStart !== null) {
        var x0 = tlX(runStart, rng), x1 = tlX(i, rng);
        gBack.appendChild(el('rect', {
          x: x0.toFixed(1), y: TL.top, width: Math.max(1, x1 - x0).toFixed(1),
          height: TL.tideBottom - TL.top, fill: 'rgba(2,12,16,.55)'
        }));
        runStart = null;
      }
    }

    // Best windows.
    (state.scored.windows || []).forEach(function (w) {
      var a = idxOfTime(w.start), bIdx = idxOfTime(w.end);
      if (a === null || bIdx === null) return;
      var x0 = tlX(Math.max(a, rng.i0), rng), x1 = tlX(Math.min(bIdx, rng.i1), rng);
      if (x1 <= x0) return;
      gBack.appendChild(el('rect', {
        x: x0.toFixed(1), y: TL.top, width: (x1 - x0).toFixed(1), height: TL.scoreH,
        fill: 'rgba(255,122,85,.12)', stroke: 'rgba(255,122,85,.3)', 'stroke-width': 1
      }));
    });

    // Grid.
    [25, 50, 75].forEach(function (s) {
      var y = tlY(s);
      gBack.appendChild(el('line', { x1: TL.l, y1: y, x2: TL.w - TL.r, y2: y, stroke: LINE, 'stroke-width': 1 }));
      gBack.appendChild(el('text', {
        x: TL.l - 7, y: y + 3, 'text-anchor': 'end', fill: SILT2,
        'font-size': 9.5, 'font-family': 'IBM Plex Mono, monospace'
      }, String(s)));
    });

    // Score area and line.
    var pts = [], linePts = [];
    for (var j = rng.i0; j <= rng.i1; j++) {
      var x = tlX(j, rng), y = tlY(hours[j].score);
      pts.push(x.toFixed(1) + ',' + y.toFixed(1));
      linePts.push(x.toFixed(1) + ' ' + y.toFixed(1));
    }
    gMain.appendChild(el('polygon', {
      points: TL.l + ',' + TL.scoreBottom + ' ' + pts.join(' ') + ' ' + (TL.w - TL.r) + ',' + TL.scoreBottom,
      fill: 'url(#scoreGrad)', opacity: .34
    }));
    gMain.appendChild(el('path', {
      d: 'M' + linePts.join('L'), fill: 'none', stroke: 'url(#scoreGrad)',
      'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
    }));

    // Day dividers and labels at local midnight.
    for (var k = rng.i0; k <= rng.i1; k++) {
      var p = parts(series[k].t);
      if (p.h !== 0) continue;
      var dx = tlX(k, rng);
      gBack.appendChild(el('line', {
        x1: dx, y1: TL.top, x2: dx, y2: TL.tideBottom, stroke: 'rgba(139,169,175,.22)',
        'stroke-width': 1, 'stroke-dasharray': '2 4'
      }));
      gFront.appendChild(el('text', {
        x: dx + 5, y: TL.top + 11, fill: SILT, 'font-size': 10,
        'font-family': 'IBM Plex Mono, monospace'
      }, DOW[p.dow] + ' ' + MON[p.mon] + ' ' + p.date));
    }

    // Sunrise and sunset ticks.
    for (var s = rng.i0 + 1; s <= rng.i1; s++) {
      var prev = series[s - 1].sunAltDeg, cur = series[s].sunAltDeg;
      if (!isNum(prev) || !isNum(cur)) continue;
      if (prev < 0 && cur >= 0) sunTick(gFront, tlX(s, rng), 'rise');
      if (prev >= 0 && cur < 0) sunTick(gFront, tlX(s, rng), 'set');
    }

    // Solunar majors.
    (state.env.solunar || []).forEach(function (per) {
      if (per.type !== 'major') return;
      var idx = idxOfTime(per.peak);
      if (idx === null || idx < rng.i0 || idx > rng.i1) return;
      var mx = tlX(idx, rng);
      gFront.appendChild(el('path', {
        d: 'M' + (mx - 4) + ' ' + (TL.scoreBottom - 1) + 'L' + (mx + 4) + ' ' + (TL.scoreBottom - 1) +
          'L' + mx + ' ' + (TL.scoreBottom - 8) + 'Z',
        fill: 'rgba(234,246,244,.5)'
      }));
    });

    // Tide strip, its own scale under a shared x-axis — never a second y-axis
    // on the score plot.
    var tideVals = [];
    for (var t = rng.i0; t <= rng.i1; t++) if (isNum(series[t].tideFt)) tideVals.push(series[t].tideFt);
    if (tideVals.length > 4) {
      var lo = Math.min.apply(null, tideVals), hi = Math.max.apply(null, tideVals);
      if (hi - lo < 0.5) hi = lo + 0.5;
      var ty = function (v) { return TL.tideBottom - (v - lo) / (hi - lo) * TL.tideH; };
      var tp = [], tline = [];
      for (var u = rng.i0; u <= rng.i1; u++) {
        if (!isNum(series[u].tideFt)) continue;
        var tx = tlX(u, rng), tyy = ty(series[u].tideFt);
        tp.push(tx.toFixed(1) + ',' + tyy.toFixed(1));
        tline.push(tx.toFixed(1) + ' ' + tyy.toFixed(1));
      }
      gMain.appendChild(el('polygon', {
        points: TL.l + ',' + TL.tideBottom + ' ' + tp.join(' ') + ' ' + (TL.w - TL.r) + ',' + TL.tideBottom,
        fill: TIDE, opacity: .14
      }));
      gMain.appendChild(el('path', { d: 'M' + tline.join('L'), fill: 'none', stroke: TIDE, 'stroke-width': 1.8 }));
      gFront.appendChild(el('text', {
        x: TL.l - 7, y: TL.tideTop + 10, 'text-anchor': 'end', fill: SILT2,
        'font-size': 9.5, 'font-family': 'IBM Plex Mono, monospace'
      }, fmtFt(hi)));
      gFront.appendChild(el('text', {
        x: TL.l - 7, y: TL.tideBottom, 'text-anchor': 'end', fill: SILT2,
        'font-size': 9.5, 'font-family': 'IBM Plex Mono, monospace'
      }, fmtFt(lo)));
      gFront.appendChild(el('text', {
        x: TL.l + 2, y: TL.tideTop - 5, fill: SILT, 'font-size': 10,
        'font-family': 'IBM Plex Mono, monospace'
      }, 'Tide, ft'));

      (state.env.tideExtremes || []).forEach(function (ex) {
        var xi = idxOfTime(ex.t);
        if (xi === null || xi < rng.i0 || xi > rng.i1) return;
        var ex_x = tlX(xi, rng), ex_y = ty(ex.v);
        gFront.appendChild(el('circle', { cx: ex_x, cy: ex_y, r: 2.6, fill: TIDE }));
        gFront.appendChild(el('text', {
          x: ex_x, y: ex.type === 'H' ? ex_y - 6 : ex_y + 12, 'text-anchor': 'middle',
          fill: SILT, 'font-size': 9, 'font-family': 'IBM Plex Mono, monospace'
        }, ex.type + ' ' + fmtH(ex.t)));
      });
    } else {
      gFront.appendChild(el('text', {
        x: TL.l, y: TL.tideTop + 30, fill: SILT2, 'font-size': 11,
        'font-family': 'IBM Plex Mono, monospace'
      }, 'No tide at this spot'));
    }

    // Hour axis.
    for (var a = rng.i0; a <= rng.i1; a++) {
      var ap = parts(series[a].t);
      if (ap.h % 6 !== 0) continue;
      gFront.appendChild(el('text', {
        x: tlX(a, rng), y: TL.tideBottom + 30, 'text-anchor': 'middle', fill: SILT2,
        'font-size': 9.5, 'font-family': 'IBM Plex Mono, monospace'
      }, fmtH(series[a].t)));
    }

    // Now.
    var nx = tlX(state.env.nowIndex, rng);
    gFront.appendChild(el('line', {
      x1: nx, y1: TL.top, x2: nx, y2: TL.tideBottom, stroke: 'rgba(234,246,244,.5)',
      'stroke-width': 1, 'stroke-dasharray': '3 3'
    }));
    gFront.appendChild(el('text', {
      x: nx, y: TL.tideBottom + 44, 'text-anchor': 'middle', fill: SILT,
      'font-size': 9.5, 'font-family': 'IBM Plex Mono, monospace'
    }, 'now'));

    // Scrubber.
    var si = state.scrub === null ? state.env.nowIndex : state.scrub;
    var sx = tlX(si, rng), sy = tlY(hours[si].score);
    gFront.appendChild(el('line', { x1: sx, y1: TL.top, x2: sx, y2: TL.tideBottom, stroke: SALMON, 'stroke-width': 1.5 }));
    gFront.appendChild(el('circle', { cx: sx, cy: sy, r: 6, fill: '#08222a', stroke: bandFor(hours[si].score).color, 'stroke-width': 2.5 }));

    var chipW = 92, chipX = Math.min(Math.max(sx - chipW / 2, TL.l), TL.w - TL.r - chipW);
    gFront.appendChild(el('rect', {
      x: chipX, y: 0, width: chipW, height: 17, rx: 5, fill: '#0d2b34', stroke: 'rgba(255,122,85,.5)'
    }));
    gFront.appendChild(el('text', {
      x: chipX + chipW / 2, y: 12, 'text-anchor': 'middle', fill: INK, 'font-size': 10.5,
      'font-family': 'IBM Plex Mono, monospace'
    }, relativeDay(series[si].t) + ' ' + fmtHM(series[si].t) + ' · ' + hours[si].score));

    svg.appendChild(gBack);
    svg.appendChild(gMain);
    svg.appendChild(gFront);
  }

  function fmtFt(v) { return (Math.abs(v) < 0.05 ? 0 : v).toFixed(1); }

  function sunTick(g, x, kind) {
    g.appendChild(el('line', {
      x1: x, y1: TL.scoreBottom, x2: x, y2: TL.scoreBottom + 6,
      stroke: kind === 'rise' ? '#ffc93d' : '#ff8a5c', 'stroke-width': 1.6
    }));
  }

  function idxOfTime(ms) {
    if (!state.env) return null;
    var s = state.env.series;
    var i = Math.round((ms - s[0].t) / 3600000);
    if (i < 0 || i >= s.length) return null;
    return i;
  }

  function wireTimeline() {
    var svg = $('timeline');
    var dragging = false;

    function toIndex(clientX) {
      var rect = svg.getBoundingClientRect();
      var vx = (clientX - rect.left) / rect.width * TL.w;
      var rng = tlRange();
      var frac = (vx - TL.l) / (TL.w - TL.l - TL.r);
      var i = Math.round(rng.i0 + frac * (rng.i1 - rng.i0));
      return Math.min(rng.i1, Math.max(rng.i0, i));
    }

    svg.addEventListener('pointerdown', function (e) {
      if (!state.scored) return;
      dragging = true;
      svg.setPointerCapture(e.pointerId);
      setScrub(toIndex(e.clientX));
    });
    svg.addEventListener('pointermove', function (e) {
      if (!dragging || !state.scored) return;
      e.preventDefault();
      setScrub(toIndex(e.clientX));
    });
    ['pointerup', 'pointercancel'].forEach(function (evt) {
      svg.addEventListener(evt, function (e) {
        dragging = false;
        if (svg.hasPointerCapture && svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
      });
    });
  }

  function setScrub(i) {
    if (!state.scored) return;
    state.scrub = i === state.env.nowIndex ? null : i;
    renderHour();
    drawTimeline();
  }

  /* ====================================================== SMALL INSTRUMENTS */

  function drawMoon() {
    var svg = $('moonDial');
    clearSvg(svg);
    var m = state.env.moon;
    if (!m) return;
    var cx = 36, cy = 34, r = 24;
    svg.appendChild(el('circle', { cx: cx, cy: cy, r: r + 3, fill: 'none', stroke: LINE, 'stroke-width': 1 }));
    svg.appendChild(el('circle', { cx: cx, cy: cy, r: r, fill: '#122e37' }));

    var t = Math.cos(2 * Math.PI * m.phase);   // +1 new, -1 full
    var waxing = m.phase < 0.5;
    var rx = Math.abs(t) * r;
    var limbSweep = waxing ? 1 : 0;
    var termSweep = waxing ? (t > 0 ? 0 : 1) : (t > 0 ? 1 : 0);
    var d = 'M' + cx + ' ' + (cy - r) +
      'A' + r + ' ' + r + ' 0 0 ' + limbSweep + ' ' + cx + ' ' + (cy + r) +
      'A' + rx.toFixed(2) + ' ' + r + ' 0 0 ' + termSweep + ' ' + cx + ' ' + (cy - r) + 'Z';
    svg.appendChild(el('path', { d: d, fill: '#dceef1' }));
    svg.appendChild(el('circle', { cx: cx, cy: cy, r: r, fill: 'none', stroke: 'rgba(139,169,175,.35)', 'stroke-width': 1 }));
  }

  function drawWind(h) {
    var svg = $('windDial');
    clearSvg(svg);
    var cx = 36, cy = 34, r = 24;
    svg.appendChild(el('circle', { cx: cx, cy: cy, r: r, fill: 'none', stroke: LINE, 'stroke-width': 1 }));
    ['N', 'E', 'S', 'W'].forEach(function (lab, i) {
      var a = i * 90 * Math.PI / 180;
      var x = cx + (r - 4) * Math.sin(a), y = cy - (r - 4) * Math.cos(a);
      svg.appendChild(el('text', {
        x: x, y: y + 3, 'text-anchor': 'middle', fill: i === 0 ? SILT : SILT2,
        'font-size': 7.5, 'font-family': 'IBM Plex Mono, monospace'
      }, lab));
    });
    if (isNum(h.windDirDeg) && isNum(h.windMph)) {
      // Points the way the wind is going: from the source, through the centre.
      var a = (h.windDirDeg + 180) * Math.PI / 180;
      var tipx = cx + (r - 9) * Math.sin(a), tipy = cy - (r - 9) * Math.cos(a);
      var tailx = cx - (r - 12) * Math.sin(a), taily = cy + (r - 12) * Math.cos(a);
      svg.appendChild(el('line', {
        x1: tailx, y1: taily, x2: tipx, y2: tipy, stroke: TIDE, 'stroke-width': 2, 'stroke-linecap': 'round'
      }));
      svg.appendChild(el('circle', { cx: tipx, cy: tipy, r: 3, fill: TIDE }));
    }
    svg.appendChild(el('text', {
      x: cx, y: cy + 2, 'text-anchor': 'middle', fill: INK, 'font-size': 14,
      'font-family': 'Chakra Petch, sans-serif', 'font-weight': 700
    }, isNum(h.windMph) ? String(Math.round(speedVal(h.windMph))) : '—'));
    svg.appendChild(el('text', {
      x: cx, y: cy + 12, 'text-anchor': 'middle', fill: SILT2, 'font-size': 7,
      'font-family': 'IBM Plex Mono, monospace'
    }, speedUnit()));
  }

  function drawPressure(idx) {
    var svg = $('pressSpark');
    clearSvg(svg);
    var series = state.env.series;
    var from = Math.max(0, idx - 47);
    var vals = [];
    for (var i = from; i <= idx; i++) if (isNum(series[i].pressureHpa)) vals.push({ i: i, v: series[i].pressureHpa });
    if (vals.length < 4) return;
    var lo = Math.min.apply(null, vals.map(function (p) { return p.v; }));
    var hi = Math.max.apply(null, vals.map(function (p) { return p.v; }));
    if (hi - lo < 2) { var mid = (hi + lo) / 2; lo = mid - 1; hi = mid + 1; }
    var W = 96, H = 48, TOP = 12;
    var x = function (i) { return 4 + (i - from) / (idx - from) * (W - 8); };
    var y = function (v) { return TOP + (hi - v) / (hi - lo) * H; };
    var d = vals.map(function (p, n) { return (n ? 'L' : 'M') + x(p.i).toFixed(1) + ' ' + y(p.v).toFixed(1); }).join('');
    svg.appendChild(el('path', { d: d, fill: 'none', stroke: SILT, 'stroke-width': 1.6, 'stroke-linejoin': 'round' }));
    var last = vals[vals.length - 1];
    svg.appendChild(el('circle', { cx: x(last.i), cy: y(last.v), r: 3, fill: SALMON }));
  }

  function drawTempScale(hour) {
    var host = $('tempScale');
    host.innerHTML = '';
    var sp = B.species.byId[state.speciesId];
    if (!sp) return;
    var lo = sp.survive[0] - 2, hi = sp.survive[1] + 2;
    var pct = function (f) { return Math.max(0, Math.min(100, (f - lo) / (hi - lo) * 100)); };

    host.appendChild(html('div', 'ts-track'));
    var band = html('div', 'ts-band');
    band.style.left = pct(sp.opt[0]) + '%';
    band.style.width = (pct(sp.opt[1]) - pct(sp.opt[0])) + '%';
    host.appendChild(band);

    [lo + 1, (sp.opt[0] + sp.opt[1]) / 2, hi - 1].forEach(function (f, i) {
      var lab = html('div', 'ts-label', tempStr(f));
      lab.style.left = pct(f) + '%';
      if (i === 0) lab.style.transform = 'translateX(0)';
      if (i === 2) lab.style.transform = 'translateX(-100%)';
      host.appendChild(lab);
    });

    if (isNum(hour.waterF)) {
      var marker = html('div', 'ts-marker');
      marker.style.left = pct(hour.waterF) + '%';
      host.appendChild(marker);
    }

    var caption = $('tempCaption');
    if (!isNum(hour.waterF)) {
      caption.textContent = 'No water temperature available for this spot.';
      return;
    }
    var verdict = hour.waterF < sp.opt[0] ? 'below' : hour.waterF > sp.opt[1] ? 'above' : 'inside';
    caption.innerHTML = 'Water <b>' + tempStr(hour.waterF, 1) + tempUnit().slice(1) + '</b> — ' +
      verdict + ' the ' + tempStr(sp.opt[0]) + '–' + tempStr(sp.opt[1]) +
      ' band ' + sp.name + ' feed hardest in.';
  }

  /* ============================================================ RUN PANEL = */

  function drawRunCurve() {
    var svg = $('runCurve');
    clearSvg(svg);
    var sp = B.species.byId[state.speciesId];
    if (!sp) return;
    var W = 420, H = 150, L = 8, R = 8, T = 12, Bm = 24;
    var x = function (d) { return L + (d - 1) / 364 * (W - L - R); };
    var y = function (v) { return (H - Bm) - v * (H - Bm - T); };

    var pts = [], line = [];
    for (var d = 1; d <= 365; d += 2) {
      var v = B.species.runStrength(sp, d, state.spot.system);
      if (v === null) v = 0;
      pts.push(x(d).toFixed(1) + ',' + y(v).toFixed(1));
      line.push(x(d).toFixed(1) + ' ' + y(v).toFixed(1));
    }
    svg.appendChild(el('line', { x1: L, y1: H - Bm, x2: W - R, y2: H - Bm, stroke: LINE, 'stroke-width': 1 }));
    svg.appendChild(el('polygon', {
      points: L + ',' + (H - Bm) + ' ' + pts.join(' ') + ' ' + (W - R) + ',' + (H - Bm),
      fill: SALMON, opacity: .2
    }));
    svg.appendChild(el('path', { d: 'M' + line.join('L'), fill: 'none', stroke: SALMON, 'stroke-width': 2 }));

    var cum = 0;
    [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].forEach(function (len, mi) {
      var mid = cum + len / 2;
      cum += len;
      svg.appendChild(el('text', {
        x: x(mid), y: H - 9, 'text-anchor': 'middle', fill: SILT2,
        'font-size': 9, 'font-family': 'IBM Plex Mono, monospace'
      }, 'JFMAMJJASOND'[mi]));
    });

    var hour = currentHour();
    var today = B.model.dayOfYear(hour.t, offset());
    var tv = B.species.runStrength(sp, today, state.spot.system) || 0;
    svg.appendChild(el('line', { x1: x(today), y1: T - 6, x2: x(today), y2: H - Bm, stroke: INK, 'stroke-width': 1.4 }));
    svg.appendChild(el('circle', { cx: x(today), cy: y(tv), r: 4, fill: INK }));
    var anchor = x(today) > W - 90 ? 'end' : 'start';
    svg.appendChild(el('text', {
      x: x(today) + (anchor === 'end' ? -6 : 6), y: T, 'text-anchor': anchor, fill: INK,
      'font-size': 10, 'font-family': 'IBM Plex Mono, monospace'
    }, 'today · ' + Math.round(tv * 100) + '%'));
  }

  function drawHydrograph() {
    var svg = $('hydrograph');
    clearSvg(svg);
    var flow = state.env.gaugeSeries && state.env.gaugeSeries.flow;
    var cap = $('hydroCap');
    var W = 420, H = 150, L = 40, R = 8, T = 14, Bm = 24;

    if (!flow || flow.points.length < 4) {
      cap.textContent = 'No live flow gauge covers this reach';
      svg.appendChild(el('text', {
        x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: SILT2, 'font-size': 12,
        'font-family': 'IBM Plex Mono, monospace'
      }, 'no flow gauge'));
      return;
    }
    cap.textContent = 'Flow, last 10 days — ' + flow.siteName;

    var pts = flow.points;
    var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    var lo = Math.min.apply(null, pts.map(function (p) { return p.v; }));
    var hi = Math.max.apply(null, pts.map(function (p) { return p.v; }));
    if (hi - lo < hi * 0.04) { hi = hi * 1.04; lo = lo * 0.96; }
    var x = function (t) { return L + (t - t0) / (t1 - t0) * (W - L - R); };
    var y = function (v) { return (H - Bm) - (v - lo) / (hi - lo) * (H - Bm - T); };

    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.v).toFixed(1); }).join('');
    var poly = pts.map(function (p) { return x(p.t).toFixed(1) + ',' + y(p.v).toFixed(1); }).join(' ');

    svg.appendChild(el('polygon', {
      points: L + ',' + (H - Bm) + ' ' + poly + ' ' + (W - R) + ',' + (H - Bm),
      fill: TIDE, opacity: .16
    }));
    svg.appendChild(el('path', { d: line, fill: 'none', stroke: TIDE, 'stroke-width': 1.8 }));

    // Last 24 hours picked out — that is the freshet the model reads.
    var cut = t1 - 24 * 3600000;
    var recent = pts.filter(function (p) { return p.t >= cut; });
    if (recent.length > 2) {
      var rising = recent[recent.length - 1].v > recent[0].v * 1.03;
      var falling = recent[recent.length - 1].v < recent[0].v * 0.97;
      svg.appendChild(el('path', {
        d: recent.map(function (p, i) { return (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.v).toFixed(1); }).join(''),
        fill: 'none', stroke: rising ? SALMON : falling ? '#ffc93d' : INK, 'stroke-width': 2.6
      }));
    }

    [hi, lo].forEach(function (v, i) {
      svg.appendChild(el('text', {
        x: L - 6, y: i === 0 ? T + 4 : H - Bm, 'text-anchor': 'end', fill: SILT2,
        'font-size': 9, 'font-family': 'IBM Plex Mono, monospace'
      }, num(v)));
    });
    for (var d = 8; d >= 0; d -= 2) {
      var tt = t1 - d * 86400000;
      if (tt < t0) continue;
      svg.appendChild(el('text', {
        x: x(tt), y: H - 9, 'text-anchor': 'middle', fill: SILT2, 'font-size': 9,
        'font-family': 'IBM Plex Mono, monospace'
      }, d === 0 ? 'now' : '-' + d + 'd'));
    }
  }

  /* ================================================================ COPY == */

  var WHY = {
    run: 'Whether the fish are in this water at all. For the migratory runs this is a multiplier, not an opinion — a river in perfect shape scores low when the run has not started or is over. Curves follow the usual CDFW and PFMC windows for this system.',
    flow: 'Migrating fish move on water. A rain-driven rise pulls salmon upriver; a dropping, clearing river is when steelhead fish best; a trickle holds fish down and a flood scatters them. Read as the change over the last 24 hours against the ten-day baseline.',
    temp: 'The strongest single predictor of whether a fish feeds. Each species has a band it feeds hardest in and a wider band it merely tolerates; salmon migration stalls above about 68 °F however good everything else looks.',
    clarity: 'About a foot or two of visibility is the sweet spot — enough colour to hide you, enough clarity for the fish to find the lure. Gin-clear water makes them wary, chocolate water makes the lure invisible.',
    tide: 'Moving water feeds fish and slack water does not. Salmon push into a river mouth on the flood, perch work the incoming, and the strongest bite usually sits either side of the middle of the tide where the current runs fastest.',
    light: 'Most predators feed hardest in the low-angle light around dawn and dusk. Heavy cloud extends that window through the day; several species here do their best work after full dark.',
    pressure: 'Fish sense pressure through the swim bladder and lateral line. A falling barometer ahead of a front is the classic feeding window; the hard rise behind that front is the classic shutdown.',
    solunar: 'Feeding periods keyed to the moon: strongest when it is overhead or underfoot, decent at moonrise and moonset, and stronger overall near the new and full moon. Computed here from actual lunar position, not a table.',
    sky: 'Overcast puts predators on the feed by dulling the light. On the rivers rain counts as a positive — it is the trigger that moves fish — while a squall or a thunderstorm shuts things down.',
    wind: 'A light chop breaks up the surface, pushes bait against a bank and hides you. Dead calm is hard work and a gale is harder.',
    swell: 'How big the ocean is. Mostly a question of whether you can fish safely and hold bottom, but big water also scatters the inshore bite.',
    upwelling: 'Sustained northwesterlies drive cold water up the coast and push the salmon bite around. The relaxation right after a blow is the window everybody waits for.',
    front: 'The bluebird day after a hard cold front — sharp pressure rise, big temperature drop — is reliably the worst day of the week to fish.'
  };

  function factorDetail(f) {
    var d = f.detail || {};
    switch (f.key) {
      case 'run':
        return Math.round(f.value * 100) + '% of peak' + (state.spot.system ? ' · ' + state.spot.system.replace('-', ' ') : '');
      case 'temp':
        return isNum(d.waterF)
          ? tempStr(d.waterF, 1) + tempUnit().slice(1) + (d.opt ? ' · band ' + tempStr(d.opt[0]) + '–' + tempStr(d.opt[1]) : '') +
            (d.source ? ' · ' + d.source : '')
          : '—';
      case 'flow':
        if (!isNum(d.cfs)) return '—';
        return num(d.cfs) + ' cfs' +
          (isNum(d.delta24) ? ' · ' + (d.delta24 >= 0 ? '+' : '') + Math.round(d.delta24 * 100) + '% in 24h' : '') +
          ' · ' + d.pref + ' preferred';
      case 'clarity':
        return isNum(d.ntu) ? d.ntu.toFixed(1) + ' NTU' + (d.estimated ? ' (estimated from flow and rain)' : ' measured') : '—';
      case 'tide':
        return isNum(d.ft) ? d.ft.toFixed(2) + ' ft · ' + (d.state || '—') +
          (isNum(d.rate) ? ' · ' + (d.rate >= 0 ? '+' : '') + d.rate.toFixed(2) + ' ft/h' : '') : '—';
      case 'pressure':
        return (isNum(d.hpa) ? d.hpa.toFixed(1) + ' hPa' : '—') +
          (isNum(d.delta3) ? ' · ' + (d.delta3 >= 0 ? '+' : '') + d.delta3.toFixed(1) + ' over 3h' : '');
      case 'light':
        return isNum(d.sunAltDeg) ? 'sun ' + d.sunAltDeg.toFixed(0) + '° above horizon' : '—';
      case 'wind':
        return isNum(d.mph) ? Math.round(speedVal(d.mph)) + ' ' + speedUnit() + (isNum(d.dir) ? ' from ' + compass(d.dir) : '') : '—';
      case 'sky':
        return (isNum(d.cloudPct) ? Math.round(d.cloudPct) + '% cloud' : '') +
          (isNum(d.precipIn) && d.precipIn > 0 ? ' · ' + d.precipIn.toFixed(2) + ' in rain' : ' · dry');
      case 'swell':
        return isNum(d.ft) ? d.ft.toFixed(1) + ' ft' : '—';
      case 'upwelling':
        return isNum(d.nwRecent) ? 'NW peak ' + Math.round(speedVal(d.nwRecent)) + ' ' + speedUnit() + ' in 24h' : '—';
      default:
        return '';
    }
  }

  var COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  function compass(deg) { return COMPASS[Math.round(deg / 22.5) % 16]; }

  /* ============================================================ RENDERING = */

  function currentHour() {
    var i = state.scrub === null ? state.env.nowIndex : state.scrub;
    return state.env.series[i];
  }
  function currentScored() {
    var i = state.scrub === null ? state.env.nowIndex : state.scrub;
    return state.scored.hours[i];
  }

  function renderHour() {
    var h = currentScored();
    var env = h.env;

    setScore(h.score, h.confidence, h.verdict.label);
    $('gaugeWhen').textContent = state.scrub === null
      ? 'right now'
      : relativeDay(env.t) + ' ' + fmtHM(env.t);
    $('nowBtn').textContent = state.scrub === null
      ? 'Drag the chart to read any hour'
      : 'Back to now';

    $('confFill').style.width = Math.round(h.confidence * 100) + '%';
    $('confText').textContent = h.missing.length
      ? Math.round(h.confidence * 100) + '% confidence · no data for ' + h.missing.join(', ').toLowerCase()
      : Math.round(h.confidence * 100) + '% confidence · every factor has data';

    $('readLine').innerHTML = readSentence(h);

    drawTempScale(env);
    renderReadout(env, h);
    drawMoon();
    drawWind(env);
    drawPressure(state.scrub === null ? state.env.nowIndex : state.scrub);
    renderMoonCaps(env);
    renderSafety(h);
    renderFactors(h);
    if (!$('runCard').hidden) { drawRunCurve(); renderRunRead(h); }
    renderTimelineFoot(h);
  }

  function readSentence(h) {
    var sp = B.species.byId[state.speciesId];
    var avail = h.factors.filter(function (f) { return f.available; });
    if (!avail.length) return 'Not enough live data to score this spot right now.';
    var sorted = avail.slice().sort(function (a, b) { return b.contribution - a.contribution; });
    var best = sorted[0], worst = sorted[sorted.length - 1];

    var lead = '<b>' + h.verdict.label + '</b> for ' + sp.name + '. ';
    if (h.gates.length) {
      return lead + h.gates.map(function (g) { return g.label; }).join('; ') + '.';
    }
    var up = best.contribution > 1 ? phraseFor(best, true) : null;
    var down = worst.contribution < -1 ? phraseFor(worst, false) : null;
    if (up && down) return lead + cap(up) + ', but ' + down + '.';
    if (up) return lead + cap(up) + '.';
    if (down) return lead + 'Nothing is standing out, and ' + down + '.';
    return lead + 'Conditions are middling across the board.';
  }

  function cap(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

  function phraseFor(f, positive) {
    var d = f.detail || {};
    var strong = Math.abs(f.contribution) > 4;
    switch (f.key) {
      case 'run': return positive
        ? 'the run is ' + (f.value > 0.85 ? 'at its peak' : 'well under way')
        : 'the run is thin right now';
      case 'flow': return positive
        ? 'the river is ' + (isNum(d.delta24) && d.delta24 > 0.05 ? 'coming up' : isNum(d.delta24) && d.delta24 < -0.05 ? 'dropping and clearing' : 'holding steady')
        : 'the flow is working against you';
      case 'temp': return positive
        ? 'the water is right in the band'
        : 'the water is ' + (isNum(d.waterF) && d.waterF > (d.opt ? d.opt[1] : 60) ? 'too warm at ' + tempStr(d.waterF, 1) : 'too cold at ' + tempStr(d.waterF, 1));
      case 'tide': return positive ? 'the tide is running hard' : 'the tide has gone slack';
      case 'light': return positive ? 'the light is low' : 'the sun is high and hard';
      case 'pressure': return positive ? 'the barometer is falling' : 'the barometer is climbing behind a front';
      case 'solunar': return positive ? 'a solunar period is open' : 'the moon is doing nothing for you';
      case 'clarity': return positive ? 'the water has good colour' : (isNum(d.ntu) && d.ntu > 30 ? 'the water is dirty' : 'the water is too clear');
      case 'wind': return positive ? 'there is a good working chop' : (isNum(d.mph) && d.mph > 18 ? 'it is blowing hard' : 'it is flat calm');
      case 'swell': return positive ? 'the swell is fishable' : 'the swell is up';
      case 'sky': return positive ? 'the sky is helping' : 'it is bright and clear';
      case 'upwelling': return positive ? 'the wind has laid down after a blow' : 'the northwesterly is pumping';
      default: return (positive ? '' : 'the ') + f.label.toLowerCase() + (positive ? ' is helping' : ' is against you');
    }
    void strong;
  }

  function renderReadout(env, h) {
    var dl = $('readout');
    dl.innerHTML = '';
    var rows = [];

    rows.push(['Water', isNum(env.waterF) ? tempVal(env.waterF).toFixed(1) : '—', tempUnit()]);
    rows.push(['Air', isNum(env.airF) ? String(Math.round(tempVal(env.airF))) : '—', tempUnit()]);
    var dp = null;
    var i = state.scrub === null ? state.env.nowIndex : state.scrub;
    if (i >= 3 && isNum(env.pressureHpa) && isNum(state.env.series[i - 3].pressureHpa)) {
      dp = env.pressureHpa - state.env.series[i - 3].pressureHpa;
    }
    rows.push(['Pressure', isNum(env.pressureHpa) ? env.pressureHpa.toFixed(0) : '—',
      dp === null ? 'hPa' : 'hPa · ' + (dp >= 0 ? '+' : '') + dp.toFixed(1) + '/3h']);
    rows.push(['Wind', isNum(env.windMph) ? String(Math.round(speedVal(env.windMph))) : '—',
      speedUnit() + (isNum(env.gustMph) ? ' · g' + Math.round(speedVal(env.gustMph)) : '')]);
    rows.push(['Sky', isNum(env.cloudPct) ? Math.round(env.cloudPct) + '%' : '—', 'cloud']);
    if (isNum(env.precipIn)) rows.push(['Rain', env.precipIn.toFixed(2), 'in/h']);
    if (isNum(env.tideFt)) {
      var tideF = h.factors.filter(function (f) { return f.key === 'tide'; })[0];
      var st = tideF && tideF.detail ? tideF.detail.state : null;
      rows.push(['Tide', env.tideFt.toFixed(1), 'ft' + (st ? ' · ' + st : '')]);
    }
    if (isNum(env.flowCfs)) rows.push(['Flow', num(env.flowCfs), 'cfs']);
    if (isNum(env.turbidityNtu)) rows.push(['Turbidity', env.turbidityNtu.toFixed(1), 'NTU']);
    if (isNum(env.waveFt)) {
      rows.push(['Swell', env.waveFt.toFixed(1), 'ft' + (isNum(env.wavePeriodS) ? ' · ' + Math.round(env.wavePeriodS) + 's' : '')]);
    }

    rows.forEach(function (r) {
      var wrap = document.createElement('div');
      wrap.appendChild(html('dt', null, r[0]));
      var dd = html('dd', null, r[1]);
      var small = html('small', null, ' ' + r[2]);
      dd.appendChild(small);
      wrap.appendChild(dd);
      dl.appendChild(wrap);
    });
  }

  function renderMoonCaps(env) {
    var m = state.env.moon;
    $('moonCap').textContent = m ? m.name + ' · ' + Math.round(m.fraction * 100) + '%' : '—';
    $('windCap').textContent = isNum(env.windDirDeg)
      ? 'wind from ' + compass(env.windDirDeg)
      : 'wind';
    var i = state.scrub === null ? state.env.nowIndex : state.scrub;
    var dp = i >= 3 && isNum(env.pressureHpa) && isNum(state.env.series[i - 3].pressureHpa)
      ? env.pressureHpa - state.env.series[i - 3].pressureHpa : null;
    $('pressCap').textContent = dp === null ? 'pressure, 48h'
      : 'pressure ' + (dp > 0.4 ? 'rising' : dp < -0.4 ? 'falling' : 'steady');
  }

  function renderSafety(h) {
    var box = $('safety');
    var f = h.fishability;
    if (!f) { box.hidden = true; return; }
    box.hidden = false;
    box.className = 'safety' + (f.score < 38 ? ' danger' : f.score < 58 ? ' rough' : '');
    box.innerHTML = '';
    var score = html('div', 'safety-score', String(f.score));
    score.style.color = f.score >= 58 ? '#2fd49b' : f.score >= 38 ? '#ffc93d' : '#ff4d6a';
    box.appendChild(score);
    var p = document.createElement('p');
    p.innerHTML = '<strong>' + f.label + '</strong> to be out there. <span>' +
      (isNum(f.waveFt) ? f.waveFt.toFixed(1) + ' ft swell' : 'no swell data') +
      (isNum(f.wind) ? ', ' + Math.round(speedVal(f.wind)) + ' ' + speedUnit() + ' wind or gusts' : '') +
      '. This is separate from the bite score.</span>';
    box.appendChild(p);
  }

  function renderFactors(h) {
    var list = $('factorList');
    list.innerHTML = '';
    var sorted = h.factors.slice().sort(function (a, b) { return b.weight - a.weight; });
    sorted.forEach(function (f) {
      var li = document.createElement('li');
      var det = document.createElement('details');
      det.className = 'factor' + (f.available ? '' : ' missing');

      var sum = document.createElement('summary');
      sum.appendChild(html('span', 'factor-name', f.label));
      sum.appendChild(html('span', 'factor-value',
        f.available ? Math.round(f.value * 100) + ' / 100 · w' + f.weight : 'no data · w' + f.weight));

      var meter = html('div', 'factor-meter');
      var fill = document.createElement('i');
      if (f.available) {
        var pctv = f.value * 100;
        if (pctv >= 50) { fill.style.left = '50%'; fill.style.width = (pctv - 50) + '%'; }
        else { fill.style.left = pctv + '%'; fill.style.width = (50 - pctv) + '%'; }
        fill.style.background = pctv >= 50 ? '#2fd49b' : '#ff6a4a';
      }
      meter.appendChild(fill);
      sum.appendChild(meter);

      var sub = factorDetail(f);
      if (sub) sum.appendChild(html('div', 'factor-sub', sub));
      det.appendChild(sum);
      det.appendChild(html('p', null, WHY[f.key] || ''));
      li.appendChild(det);
      list.appendChild(li);
    });
  }

  function renderWindows() {
    var host = $('windows');
    host.innerHTML = '';
    var wins = state.scored.windows || [];
    if (!wins.length) {
      host.appendChild(html('p', 'none', 'No stretch in the next 72 hours clears the bar. Worth waiting for a change.'));
      return;
    }
    wins.forEach(function (w, i) {
      var row = html('div', 'window');
      row.appendChild(html('span', 'window-rank', String(i + 1)));
      var when = html('span', 'window-when');
      when.appendChild(html('span', 'window-day', relativeDay(w.start) + ' '));
      when.appendChild(document.createTextNode(fmtHM(w.start) + ' – ' + fmtHM(w.end)));
      row.appendChild(when);
      var pill = html('span', 'window-score', String(w.peak));
      var band = bandFor(w.peak);
      pill.style.background = band.color + '26';
      pill.style.color = band.color;
      pill.style.border = '1px solid ' + band.color + '66';
      row.appendChild(pill);
      host.appendChild(row);
    });
  }

  function renderRunRead(h) {
    var sp = B.species.byId[state.speciesId];
    var runF = h.factors.filter(function (f) { return f.key === 'run'; })[0];
    var flowF = h.factors.filter(function (f) { return f.key === 'flow'; })[0];
    var tempF = h.factors.filter(function (f) { return f.key === 'temp'; })[0];
    var bits = [];

    if (runF && runF.available) {
      var pct = Math.round(runF.value * 100);
      bits.push(pct >= 85 ? '<b>' + sp.name + ' are at peak</b> for this system'
        : pct >= 50 ? sp.name + ' are <b>well into the run</b> here'
          : pct >= 20 ? sp.name + ' are <b>just starting to show</b>'
            : '<b>' + sp.name + ' are not really here yet</b>');
    }
    if (flowF && flowF.available && flowF.detail && isNum(flowF.detail.cfs)) {
      var d24 = flowF.detail.delta24;
      bits.push(num(flowF.detail.cfs) + ' cfs' + (isNum(d24)
        ? (Math.abs(d24) < 0.03 ? ', flat' : d24 > 0 ? ', up ' + Math.round(d24 * 100) + '% in a day' : ', down ' + Math.round(-d24 * 100) + '% in a day')
        : ''));
    }
    if (tempF && tempF.available && tempF.detail && isNum(tempF.detail.waterF)) {
      var wf = tempF.detail.waterF;
      var stall = sp.stallAbove;
      bits.push('water ' + tempStr(wf, 1) + tempUnit().slice(1) +
        (isNum(stall) && wf > stall ? ' — above the ' + tempStr(stall) + ' line where migration stalls'
          : isNum(stall) && wf > stall - 4 ? ' — close to the ' + tempStr(stall) + ' stall line'
            : ' — comfortable'));
    }
    $('runRead').innerHTML = bits.length ? bits.join(' · ') + '.' : 'No river data for this reach.';
  }

  function renderTimelineFoot(h) {
    var sun = state.env.sun;
    var mt = state.env.moonTimes;
    var bits = [];
    if (sun && sun.sunrise) bits.push('Sunrise <b>' + fmtHM(sun.sunrise.valueOf()) + '</b>');
    if (sun && sun.sunset) bits.push('sunset <b>' + fmtHM(sun.sunset.valueOf()) + '</b>');
    if (mt && mt.transit) bits.push('moon overhead <b>' + fmtHM(mt.transit.valueOf()) + '</b>');
    if (mt && mt.underfoot) bits.push('underfoot <b>' + fmtHM(mt.underfoot.valueOf()) + '</b>');
    $('timelineFoot').innerHTML = bits.join(' · ') + '. Shaded bands are the best windows; ticks under the score are sunrise and sunset.';
    void h;
  }

  function renderWeights() {
    var host = $('weights');
    host.innerHTML = '';
    var w = state.scored.weights;
    var keys = Object.keys(w).sort(function (a, b) { return w[b] - w[a]; });
    var max = w[keys[0]];
    keys.forEach(function (k) {
      var row = html('div', 'weight-row');
      row.appendChild(html('span', null, B.model.FACTOR_LABELS[k] || k));
      var bar = html('div', 'weight-bar');
      var fill = document.createElement('i');
      fill.style.width = (w[k] / max * 100) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(html('span', 'wt', w[k] + '%'));
      host.appendChild(row);
    });
    $('profileNote').textContent = state.scored.profileLabel + ' profile';
  }

  function renderSources() {
    var host = $('statusLeds');
    host.innerHTML = '';
    (state.env.sources || []).forEach(function (s) {
      var li = document.createElement('li');
      var led = html('span', 'led ' + (s.status === 'live' ? 'live' : s.status === 'stale' ? 'stale' : s.status === 'down' ? 'down' : 'na'));
      li.appendChild(led);
      li.appendChild(document.createTextNode(s.label));
      li.title = s.label + ': ' + (s.status === 'na' ? 'not used at this spot' : s.status) + (s.error ? ' (' + s.error + ')' : '');
      host.appendChild(li);
    });
  }

  /* ============================================================== LOADING = */

  function setSpot(spot, skipSave) {
    state.spot = spot;
    $('spotName').textContent = spot.name;
    $('spotMeta').textContent = clsLabel(spot.cls) + ' · ' + spot.region;
    buildSpeciesSelect();
    if (!skipSave) savePrefs();
    refresh();
  }

  function clsLabel(cls) {
    return {
      river: 'River', 'tidal-river': 'Tidal river', delta: 'Delta',
      bay: 'Bay', ocean: 'Open coast', surf: 'Surf', lake: 'Lake'
    }[cls] || cls;
  }

  function buildSpeciesSelect() {
    var sel = $('speciesSelect');
    sel.innerHTML = '';
    var ids = state.spot.species || [];
    var groups = {};
    ids.forEach(function (id) {
      var sp = B.species.byId[id];
      if (!sp) return;
      (groups[sp.group] = groups[sp.group] || []).push(sp);
    });
    Object.keys(groups).forEach(function (g) {
      var og = document.createElement('optgroup');
      og.label = g;
      groups[g].forEach(function (sp) {
        var o = document.createElement('option');
        o.value = sp.id;
        o.textContent = sp.name + (sp.protected ? ' (protected)' : '');
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    if (ids.indexOf(state.speciesId) === -1) {
      state.speciesId = ids.indexOf('chinook-fall') !== -1 ? 'chinook-fall' : ids[0];
    }
    sel.value = state.speciesId;
  }

  function refresh() {
    if (!state.spot) return;
    var id = ++state.reqId;
    document.body.classList.add('is-loading');
    $('readLine').textContent = 'Reading gauges, tide and weather for ' + state.spot.name + '…';

    B.data.load(state.spot).then(function (env) {
      if (id !== state.reqId) return;
      state.env = env;
      state.scrub = null;
      score();
      document.body.classList.remove('is-loading');
    }).catch(function (err) {
      if (id !== state.reqId) return;
      document.body.classList.remove('is-loading');
      $('readLine').innerHTML = '<span class="error-note">Could not reach the data services. ' +
        'Check your connection and try again — the last good reading is used when there is one.</span>';
      if (window.console) console.error('Bite Index load failed', err);
    });
  }

  function score() {
    var env = state.env;
    state.scored = B.model.scoreSeries({
      spot: state.spot,
      speciesId: state.speciesId,
      utcOffsetSeconds: env.utcOffsetSeconds,
      series: env.series,
      solunar: env.solunar,
      nowIndex: env.nowIndex
    });

    var badge = $('waterBadge');
    badge.textContent = env.water.label + (env.water.distanceMi !== null && env.water.distanceMi !== undefined
      ? ' · ' + env.water.distanceMi.toFixed(1) + ' mi' : '');
    badge.className = 'badge' + (env.water.source === 'modeled' ? ' modeled' : '');
    badge.title = env.water.siteName || '';

    var isRiver = ['river', 'tidal-river', 'delta'].indexOf(state.spot.cls) !== -1;
    $('runCard').hidden = !isRiver;
    if (isRiver) {
      $('runHeading').textContent = 'Run & river';
      $('runNote').textContent = state.spot.gaugeNote || (env.gauge ? env.gauge.siteName : '');
      drawRunCurve();
      drawHydrograph();
    }

    renderSources();
    renderWindows();
    renderWeights();
    renderHour();
    drawTimeline();
  }

  /* =============================================================== WIRING = */

  function buildSpotList(query) {
    var list = $('spotList');
    list.innerHTML = '';
    var items = query ? B.spots.search(query) : nearestOrAll();
    if (!items.length) {
      list.appendChild(html('li', 'sl-empty', 'Nothing matches “' + query + '”. Bite Index covers Northern California only.'));
      return;
    }
    items.slice(0, 40).forEach(function (entry) {
      var spot = entry.spot || entry;
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.appendChild(html('span', 'sl-name', spot.name));
      btn.appendChild(html('span', 'sl-meta',
        entry.miles !== undefined ? entry.miles.toFixed(0) + ' mi' : clsLabel(spot.cls)));
      btn.addEventListener('click', function () {
        closeSpotPanel();
        setSpot(spot);
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  var lastFix = null;
  function nearestOrAll() {
    if (lastFix) return B.spots.nearest(lastFix.lat, lastFix.lon, 40);
    return B.spots.list.slice();
  }

  function openSpotPanel() {
    $('spotPanel').hidden = false;
    $('spotToggle').setAttribute('aria-expanded', 'true');
    buildSpotList('');
    $('spotSearch').value = '';
    $('spotSearch').focus();
  }
  function closeSpotPanel() {
    $('spotPanel').hidden = true;
    $('spotToggle').setAttribute('aria-expanded', 'false');
  }

  function locate(silent) {
    if (!navigator.geolocation) {
      if (!silent) alert('This browser will not share a location. Pick a spot from the list instead.');
      return;
    }
    var btn = $('gpsBtn');
    btn.disabled = true;
    navigator.geolocation.getCurrentPosition(function (pos) {
      btn.disabled = false;
      lastFix = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      var near = B.spots.nearest(lastFix.lat, lastFix.lon, 1)[0];
      if (!near) return;
      setSpot(near.spot);
      $('spotMeta').textContent = clsLabel(near.spot.cls) + ' · ' + near.miles.toFixed(1) + ' mi away';
    }, function () {
      btn.disabled = false;
      if (!silent) {
        $('spotMeta').textContent = 'Location unavailable — pick a spot below';
        openSpotPanel();
      }
    }, { enableHighAccuracy: false, timeout: 9000, maximumAge: 300000 });
  }

  function tickClock() {
    var d = new Date();
    var h = d.getHours() % 12 || 12;
    var m = d.getMinutes();
    $('clock').textContent = h + ':' + (m < 10 ? '0' : '') + m + (d.getHours() < 12 ? ' am' : ' pm');
  }

  function init() {
    if (!B || !B.spots || !B.model || !B.data) {
      if (window.console) console.error('Bite Index modules failed to load');
      return;
    }
    var prefs = loadPrefs();
    $('unitToggle').textContent = state.units === 'us' ? '°F · mph' : '°C · kt';

    buildGauge();
    wireTimeline();
    tickClock();
    setInterval(tickClock, 30000);

    $('spotToggle').addEventListener('click', function () {
      if ($('spotPanel').hidden) openSpotPanel(); else closeSpotPanel();
    });
    $('spotSearch').addEventListener('input', function (e) { buildSpotList(e.target.value); });
    document.addEventListener('click', function (e) {
      if (!$('spotPanel').hidden && !e.target.closest('.spot-picker')) closeSpotPanel();
    });
    $('gpsBtn').addEventListener('click', function () { locate(false); });
    $('speciesSelect').addEventListener('change', function (e) {
      state.speciesId = e.target.value;
      savePrefs();
      if (state.env) score();
    });
    $('unitToggle').addEventListener('click', function () {
      state.units = state.units === 'us' ? 'metric' : 'us';
      $('unitToggle').textContent = state.units === 'us' ? '°F · mph' : '°C · kt';
      savePrefs();
      if (state.scored) { renderHour(); }
    });
    $('nowBtn').addEventListener('click', function () {
      if (state.scrub !== null) setScrub(state.env.nowIndex);
    });

    state.speciesId = prefs.species || 'chinook-fall';
    var spot = (prefs.spot && B.spots.byId[prefs.spot]) || B.spots.byId[DEFAULT_SPOT];
    setSpot(spot, true);

    // Only auto-locate when the browser already holds permission, so the page
    // never opens with a prompt in your face.
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then(function (res) {
        if (res.state === 'granted') locate(true);
      }).catch(function () { /* permissions API unavailable */ });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
