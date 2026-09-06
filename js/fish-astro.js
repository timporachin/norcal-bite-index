/* Bite Index — astronomy engine.
   Sun and moon geometry computed locally so the app still has solunar and light
   data when every network source is unreachable.

   Sun: standard low-precision solar position (Astronomical Almanac form).
   Moon: Meeus low-precision lunar series, good to about 1-2 arcminutes, which is
   far finer than the +/- 45-60 minute solunar windows built on top of it.

   Times are UTC Date objects. Callers format them with the spot's UTC offset.
*/
(function (root) {
  'use strict';

  var RAD = Math.PI / 180;
  var DEG = 180 / Math.PI;
  var DAY_MS = 86400000;
  var J1970 = 2440588;
  var J2000 = 2451545;
  var OBLIQUITY = RAD * 23.4397;
  var SUN_DIST_KM = 149598000;

  function toJulian(date) { return date.valueOf() / DAY_MS - 0.5 + J1970; }
  function fromJulian(j) { return new Date((j + 0.5 - J1970) * DAY_MS); }
  function toDays(date) { return toJulian(date) - J2000; }

  function rightAscension(l, b) {
    return Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
  }
  function declination(l, b) {
    return Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
  }
  function siderealTime(d, lw) { return RAD * (280.16 + 360.9856235 * d) - lw; }
  function altitudeOf(H, phi, dec) {
    return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  }
  function azimuthOf(H, phi, dec) {
    return Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  }

  /* ---------- sun ---------- */

  function solarMeanAnomaly(d) { return RAD * (357.5291 + 0.98560028 * d); }

  function eclipticLongitude(M) {
    var C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    return M + C + RAD * 102.9372 + Math.PI;
  }

  function sunCoords(d) {
    var M = solarMeanAnomaly(d);
    var L = eclipticLongitude(M);
    return { dec: declination(L, 0), ra: rightAscension(L, 0) };
  }

  function sunPosition(date, lat, lon) {
    var lw = RAD * -lon;
    var phi = RAD * lat;
    var d = toDays(date);
    var c = sunCoords(d);
    var H = siderealTime(d, lw) - c.ra;
    return {
      altitude: altitudeOf(H, phi, c.dec) * DEG,
      azimuth: (azimuthOf(H, phi, c.dec) * DEG + 180) % 360,
      declination: c.dec * DEG
    };
  }

  var J0 = 0.0009;
  function julianCycle(d, lw) { return Math.round(d - J0 - lw / (2 * Math.PI)); }
  function approxTransit(Ht, lw, n) { return J0 + (Ht + lw) / (2 * Math.PI) + n; }
  function solarTransitJ(ds, M, L) { return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L); }
  function hourAngle(h, phi, d) {
    return Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d)));
  }

  /* Sunrise, sunset, civil twilight and solar noon for the day containing `date`. */
  function sunTimes(date, lat, lon) {
    var lw = RAD * -lon;
    var phi = RAD * lat;
    var d = toDays(date);
    var n = julianCycle(d, lw);
    var ds = approxTransit(0, lw, n);
    var M = solarMeanAnomaly(ds);
    var L = eclipticLongitude(M);
    var dec = declination(L, 0);
    var Jnoon = solarTransitJ(ds, M, L);

    function pair(angleDeg) {
      var w = hourAngle(RAD * angleDeg, phi, dec);
      if (isNaN(w)) return { rise: null, set: null };
      var Jset = solarTransitJ(approxTransit(w, lw, n), M, L);
      var Jrise = Jnoon - (Jset - Jnoon);
      return { rise: fromJulian(Jrise), set: fromJulian(Jset) };
    }

    var official = pair(-0.833);
    var civil = pair(-6);
    return {
      solarNoon: fromJulian(Jnoon),
      sunrise: official.rise,
      sunset: official.set,
      dawn: civil.rise,
      dusk: civil.set
    };
  }

  /* ---------- moon ---------- */

  function moonCoords(d) {
    var L = RAD * (218.316 + 13.176396 * d);
    var M = RAD * (134.963 + 13.064993 * d);
    var F = RAD * (93.272 + 13.229350 * d);
    var l = L + RAD * 6.289 * Math.sin(M);
    var b = RAD * 5.128 * Math.sin(F);
    var dt = 385001 - 20905 * Math.cos(M);
    return { ra: rightAscension(l, b), dec: declination(l, b), dist: dt };
  }

  function moonPosition(date, lat, lon) {
    var lw = RAD * -lon;
    var phi = RAD * lat;
    var d = toDays(date);
    var c = moonCoords(d);
    var H = siderealTime(d, lw) - c.ra;
    var h = altitudeOf(H, phi, c.dec);
    // Refraction correction near the horizon.
    h = h + RAD * 0.017 / Math.tan(h + RAD * 10.26 / (h * DEG + 5.10));
    return {
      altitude: h * DEG,
      azimuth: (azimuthOf(H, phi, c.dec) * DEG + 180) % 360,
      distance: c.dist,
      hourAngle: H
    };
  }

  var PHASE_NAMES = [
    'New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
    'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'
  ];

  /* fraction = illuminated disc 0..1, phase = 0 new, 0.25 first quarter, 0.5 full. */
  function moonIllumination(date) {
    var d = toDays(date);
    var s = sunCoords(d);
    var m = moonCoords(d);
    var phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) +
      Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
    var inc = Math.atan2(SUN_DIST_KM * Math.sin(phi), m.dist - SUN_DIST_KM * Math.cos(phi));
    var angle = Math.atan2(
      Math.cos(s.dec) * Math.sin(s.ra - m.ra),
      Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra)
    );
    var phase = 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI;
    var idx = Math.floor(((phase + 0.0625) % 1) * 8) % 8;
    return {
      fraction: (1 + Math.cos(inc)) / 2,
      phase: phase,
      angle: angle,
      name: PHASE_NAMES[idx]
    };
  }

  /* Moonrise, moonset, upper culmination (overhead) and lower culmination
     (underfoot) within 24h of `start`. Found by sampling altitude every 10
     minutes: zero crossings give rise/set, turning points give the culminations.
     Any of them can be null — the moon does not rise every calendar day. */
  function moonTimes(start, lat, lon) {
    var STEP_MS = 10 * 60000;
    var steps = Math.round(DAY_MS / STEP_MS);
    var t0 = start.valueOf();
    var alt = new Array(steps + 1);
    for (var i = 0; i <= steps; i++) {
      alt[i] = moonPosition(new Date(t0 + i * STEP_MS), lat, lon).altitude;
    }

    var rise = null, set = null, transit = null, underfoot = null;
    var transitAlt = -Infinity, underfootAlt = Infinity;

    for (var j = 0; j < steps; j++) {
      var a = alt[j], b = alt[j + 1];
      if (a < 0 && b >= 0 && rise === null) {
        rise = new Date(t0 + (j + a / (a - b)) * STEP_MS);
      }
      if (a >= 0 && b < 0 && set === null) {
        set = new Date(t0 + (j + a / (a - b)) * STEP_MS);
      }
      if (j > 0) {
        var prev = alt[j - 1];
        if (a > prev && a >= b && a > transitAlt) { transitAlt = a; transit = refineExtreme(t0, j, prev, a, b, STEP_MS); }
        if (a < prev && a <= b && a < underfootAlt) { underfootAlt = a; underfoot = refineExtreme(t0, j, prev, a, b, STEP_MS); }
      }
    }
    return { rise: rise, set: set, transit: transit, underfoot: underfoot };
  }

  /* Parabolic vertex through three samples, clamped to the bracketing interval. */
  function refineExtreme(t0, idx, prev, cur, next, stepMs) {
    var denom = prev - 2 * cur + next;
    var offset = denom === 0 ? 0 : 0.5 * (prev - next) / denom;
    if (offset > 1) offset = 1;
    if (offset < -1) offset = -1;
    return new Date(t0 + (idx + offset) * stepMs);
  }

  /* Solunar feeding periods for the 24h from `start`.
     Major = moon overhead or underfoot (+/- 60 min).
     Minor = moonrise or moonset (+/- 45 min).
     Strength is scaled by phase: new and full moons run strongest. */
  function solunarPeriods(start, lat, lon) {
    var t = moonTimes(start, lat, lon);
    var illum = moonIllumination(start);
    // 1.0 at new/full, ~0.72 at the quarters.
    var phaseBoost = 0.72 + 0.28 * Math.abs(Math.cos(2 * Math.PI * illum.phase));
    var out = [];
    function push(peak, type, label) {
      if (!peak) return;
      var half = (type === 'major' ? 60 : 45) * 60000;
      out.push({
        type: type,
        label: label,
        peak: peak,
        start: new Date(peak.valueOf() - half),
        end: new Date(peak.valueOf() + half),
        strength: (type === 'major' ? 1 : 0.7) * phaseBoost
      });
    }
    push(t.transit, 'major', 'Moon overhead');
    push(t.underfoot, 'major', 'Moon underfoot');
    push(t.rise, 'minor', 'Moonrise');
    push(t.set, 'minor', 'Moonset');
    return out.sort(function (a, b) { return a.peak - b.peak; });
  }

  var api = {
    sunPosition: sunPosition,
    sunTimes: sunTimes,
    moonPosition: moonPosition,
    moonIllumination: moonIllumination,
    moonTimes: moonTimes,
    solunarPeriods: solunarPeriods
  };

  root.BITE = root.BITE || {};
  root.BITE.astro = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
