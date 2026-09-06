/* Bite Index — Northern California species table.

   Every species here actually swims in NorCal water: the coast, the coastal
   inlets and bays, the inland river systems and the lakes. Salmon and the other
   anadromous runs come first because that is what the app is built around.

   Temperatures are Fahrenheit.
     opt      — the band where the fish feeds hardest
     ok       — workable water
     survive  — outside this the score is gated down hard

   Run curves are control points on the calendar, interpolated linearly and
   wrapped across New Year. `run` is the default; `runBySystem` overrides it for
   a named river system, because the same fall Chinook shows up in the lower
   Klamath in August and in the American in November.

   Sources for the timing are the standard CDFW/PFMC run windows and long-
   established NorCal angling seasons. They describe when fish are typically
   present — they are not regulations. Seasons and closures change every year:
   check current CDFW rules before fishing.
*/
(function (root) {
  'use strict';

  var MONTH_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

  /* 'MM-DD' -> day of year (1-365, non-leap basis). */
  function doy(md) {
    var p = md.split('-');
    return MONTH_DAYS[parseInt(p[0], 10) - 1] + parseInt(p[1], 10);
  }

  /* Turn ['MM-DD', v] pairs into sorted [doy, v] control points. */
  function curve(pairs) {
    return pairs.map(function (p) { return [doy(p[0]), p[1]]; })
      .sort(function (a, b) { return a[0] - b[0]; });
  }

  /* Linear interpolation with wraparound at the year boundary. */
  function sampleCurve(points, dayOfYear) {
    if (!points || !points.length) return null;
    if (points.length === 1) return points[0][1];
    var d = ((dayOfYear - 1) % 365 + 365) % 365 + 1;
    var first = points[0], last = points[points.length - 1];
    if (d <= first[0] || d >= last[0]) {
      // wrap segment: last point -> first point across 1 Jan
      var span = (365 - last[0]) + first[0];
      var into = d >= last[0] ? d - last[0] : (365 - last[0]) + d;
      return last[1] + (first[1] - last[1]) * (span === 0 ? 0 : into / span);
    }
    for (var i = 0; i < points.length - 1; i++) {
      var a = points[i], b = points[i + 1];
      if (d >= a[0] && d <= b[0]) {
        var t = b[0] === a[0] ? 0 : (d - a[0]) / (b[0] - a[0]);
        return a[1] + (b[1] - a[1]) * t;
      }
    }
    return last[1];
  }

  /* Reusable run shapes ------------------------------------------------- */

  var FALL_CHINOOK_VALLEY = curve([
    ['06-15', 0.03], ['07-01', 0.10], ['07-20', 0.25], ['08-10', 0.45],
    ['09-01', 0.70], ['09-20', 0.95], ['10-10', 1.00], ['10-25', 0.90],
    ['11-10', 0.65], ['11-25', 0.40], ['12-10', 0.18], ['12-28', 0.05]
  ]);

  var FALL_CHINOOK_UPPER_SAC = curve([
    ['06-10', 0.05], ['07-10', 0.35], ['07-25', 0.65], ['08-10', 0.90],
    ['08-25', 1.00], ['09-15', 0.90], ['10-01', 0.70], ['10-20', 0.45],
    ['11-10', 0.20], ['12-01', 0.05]
  ]);

  var FALL_CHINOOK_AMERICAN = curve([
    ['08-25', 0.10], ['09-20', 0.45], ['10-05', 0.75], ['10-20', 0.95],
    ['11-05', 1.00], ['11-20', 0.85], ['12-05', 0.50], ['12-25', 0.18],
    ['01-10', 0.04]
  ]);

  var FALL_CHINOOK_FEATHER = curve([
    ['08-10', 0.15], ['09-05', 0.60], ['09-20', 0.90], ['10-05', 1.00],
    ['10-20', 0.90], ['11-05', 0.65], ['11-25', 0.30], ['12-15', 0.08]
  ]);

  var FALL_CHINOOK_KLAMATH = curve([
    ['07-10', 0.12], ['08-05', 0.55], ['08-20', 0.90], ['09-05', 1.00],
    ['09-20', 0.90], ['10-05', 0.65], ['10-25', 0.35], ['11-15', 0.10]
  ]);

  var FALL_CHINOOK_TRINITY = curve([
    ['08-15', 0.18], ['09-05', 0.50], ['09-25', 0.85], ['10-10', 1.00],
    ['10-25', 0.90], ['11-10', 0.60], ['11-30', 0.25], ['12-20', 0.08]
  ]);

  var FALL_CHINOOK_COAST = curve([
    ['09-20', 0.08], ['10-15', 0.40], ['11-01', 0.70], ['11-15', 0.95],
    ['12-01', 1.00], ['12-20', 0.80], ['01-05', 0.45], ['01-25', 0.12]
  ]);

  var WINTER_STEELHEAD_COAST = curve([
    ['11-10', 0.12], ['12-10', 0.55], ['12-28', 0.85], ['01-15', 1.00],
    ['02-05', 0.95], ['02-25', 0.80], ['03-15', 0.55], ['04-05', 0.20],
    ['04-25', 0.05]
  ]);

  var WINTER_STEELHEAD_VALLEY = curve([
    ['12-10', 0.18], ['01-10', 0.60], ['01-30', 0.90], ['02-15', 1.00],
    ['03-05', 0.85], ['03-25', 0.50], ['04-15', 0.15], ['05-05', 0.04]
  ]);

  var SPECIES = [

    /* ---------- anadromous: the main event ---------- */

    {
      id: 'chinook-fall',
      flowPref: 'rising',
      name: 'Fall-run Chinook',
      short: 'King salmon',
      group: 'Salmon & steelhead',
      icon: 'salmon',
      classes: ['river', 'tidal-river', 'delta'],
      profile: 'riverRun',
      opt: [52, 60], ok: [44, 66], survive: [36, 74],
      stallAbove: 68,
      run: FALL_CHINOOK_VALLEY,
      runBySystem: {
        'sacramento-upper': FALL_CHINOOK_UPPER_SAC,
        american: FALL_CHINOOK_AMERICAN,
        feather: FALL_CHINOOK_FEATHER,
        yuba: FALL_CHINOOK_FEATHER,
        mokelumne: FALL_CHINOOK_AMERICAN,
        klamath: FALL_CHINOOK_KLAMATH,
        trinity: FALL_CHINOOK_TRINITY,
        eel: FALL_CHINOOK_COAST,
        smith: FALL_CHINOOK_COAST,
        mad: FALL_CHINOOK_COAST,
        russian: FALL_CHINOOK_COAST,
        navarro: FALL_CHINOOK_COAST
      },
      note: 'Kings push upriver on rising, cooling water. A rain-driven flow bump with river temps dropping under about 60 °F is the classic trigger; above 68 °F migration stalls and fish sulk in the deep holes.'
    },

    {
      id: 'chinook-spring',
      flowPref: 'steady',
      name: 'Spring-run Chinook',
      short: 'Springer',
      group: 'Salmon & steelhead',
      icon: 'salmon',
      classes: ['river'],
      profile: 'riverRun',
      opt: [50, 58], ok: [44, 64], survive: [36, 72],
      stallAbove: 66,
      protected: true,
      run: curve([
        ['04-10', 0.10], ['05-05', 0.45], ['05-25', 0.85], ['06-10', 1.00],
        ['06-30', 0.85], ['07-20', 0.50], ['08-10', 0.25], ['08-31', 0.08]
      ]),
      note: 'Spring kings run early and then hold all summer in cold water. Several NorCal populations are listed — check current CDFW closures before targeting them.'
    },

    {
      id: 'chinook-ocean',
      name: 'Chinook (ocean)',
      short: 'Ocean king',
      group: 'Salmon & steelhead',
      icon: 'salmon',
      classes: ['ocean', 'bay'],
      profile: 'ocean',
      opt: [52, 58], ok: [48, 62], survive: [43, 68],
      run: curve([
        ['03-15', 0.20], ['04-15', 0.60], ['05-10', 0.85], ['06-01', 0.95],
        ['07-01', 1.00], ['08-01', 0.90], ['08-25', 0.75], ['09-15', 0.45],
        ['10-05', 0.15]
      ]),
      note: 'Ocean kings hold on the temperature break and follow the bait. The 52–58 °F band with a colour change and a working tide is the water you want. Ocean salmon seasons are set annually — confirm the current CDFW/PFMC dates.'
    },

    {
      id: 'steelhead-winter',
      flowPref: 'dropping',
      name: 'Winter steelhead',
      short: 'Steelhead',
      group: 'Salmon & steelhead',
      icon: 'steelhead',
      classes: ['river', 'tidal-river'],
      profile: 'riverRun',
      opt: [44, 54], ok: [38, 62], survive: [33, 70],
      stallAbove: 66,
      run: WINTER_STEELHEAD_COAST,
      runBySystem: {
        sacramento: WINTER_STEELHEAD_VALLEY,
        'sacramento-upper': WINTER_STEELHEAD_VALLEY,
        american: WINTER_STEELHEAD_VALLEY,
        feather: WINTER_STEELHEAD_VALLEY,
        yuba: WINTER_STEELHEAD_VALLEY,
        mokelumne: WINTER_STEELHEAD_VALLEY
      },
      note: 'Winter fish move on the storm. The prime window is the dropping, clearing limb one to three days after a freshet, with a foot or two of visibility.'
    },

    {
      id: 'steelhead-half-pounder',
      flowPref: 'steady', clarityPref: 'clear',
      name: 'Half-pounder steelhead',
      short: 'Half-pounders',
      group: 'Salmon & steelhead',
      icon: 'steelhead',
      classes: ['river', 'tidal-river'],
      profile: 'riverRun',
      opt: [48, 58], ok: [42, 64], survive: [34, 72],
      stallAbove: 68,
      run: curve([
        ['08-20', 0.15], ['09-10', 0.55], ['09-30', 0.90], ['10-15', 1.00],
        ['11-01', 0.85], ['11-20', 0.50], ['12-10', 0.20], ['12-31', 0.08]
      ]),
      systems: ['klamath', 'trinity', 'eel'],
      note: 'The Klamath and Trinity fall specialty — small ocean-run steelhead in big numbers, best on low clear autumn water at first and last light.'
    },

    {
      id: 'coho',
      flowPref: 'rising',
      name: 'Coho salmon',
      short: 'Silver',
      group: 'Salmon & steelhead',
      icon: 'salmon',
      classes: ['river', 'tidal-river'],
      profile: 'riverRun',
      opt: [48, 56], ok: [42, 62], survive: [34, 70],
      stallAbove: 64,
      protected: true,
      run: curve([
        ['10-20', 0.10], ['11-10', 0.45], ['11-25', 0.85], ['12-10', 1.00],
        ['12-28', 0.85], ['01-15', 0.50], ['02-05', 0.20], ['02-25', 0.05]
      ]),
      note: 'Central California Coast coho are listed as endangered — no take. Shown here for identification and awareness of when they are in the river.'
    },

    {
      id: 'striper',
      flowPref: 'rising', nightBias: 0.70,
      name: 'Striped bass',
      short: 'Striper',
      group: 'Anadromous',
      icon: 'striper',
      classes: ['river', 'tidal-river', 'delta', 'bay', 'surf', 'lake'],
      profile: 'riverRun',
      profiles: { delta: 'bay', bay: 'bay', surf: 'surf', lake: 'lake' },
      opt: [58, 68], ok: [50, 75], survive: [40, 82],
      run: curve([
        ['01-15', 0.50], ['03-01', 0.65], ['04-10', 0.95], ['05-01', 1.00],
        ['05-25', 0.85], ['06-15', 0.60], ['07-20', 0.40], ['08-20', 0.40],
        ['09-20', 0.55], ['10-20', 0.78], ['11-20', 0.80], ['12-20', 0.62]
      ]),
      note: 'Stripers run up the valley rivers to spawn in spring and drop back to the bays and Delta for the rest of the year. Moving water beats slack water almost every time.'
    },

    {
      id: 'shad',
      flowPref: 'steady',
      name: 'American shad',
      short: 'Shad',
      group: 'Anadromous',
      icon: 'shad',
      classes: ['river', 'tidal-river'],
      profile: 'riverRun',
      opt: [62, 70], ok: [56, 75], survive: [48, 80],
      run: curve([
        ['04-15', 0.08], ['05-05', 0.50], ['05-20', 0.95], ['06-05', 1.00],
        ['06-20', 0.70], ['07-05', 0.30], ['07-20', 0.06]
      ]),
      systems: ['sacramento', 'american', 'feather', 'yuba'],
      note: 'A short, dense run. Evening into dark on the American, Feather and Yuba once the water hits the low sixties.'
    },

    {
      id: 'sturgeon-white',
      flowPref: 'rising', nightBias: 0.72,
      name: 'White sturgeon',
      short: 'Sturgeon',
      group: 'Anadromous',
      icon: 'sturgeon',
      classes: ['delta', 'bay', 'tidal-river'],
      profile: 'bay',
      opt: [46, 58], ok: [42, 66], survive: [36, 74],
      run: curve([
        ['09-15', 0.28], ['11-01', 0.50], ['12-10', 0.80], ['01-15', 1.00],
        ['02-15', 0.95], ['03-15', 0.80], ['04-20', 0.50], ['06-15', 0.30],
        ['08-15', 0.25]
      ]),
      note: 'Sturgeon fishing turns on after winter storms push muddy water and food into San Pablo and Suisun. Big tide swings around the new and full moon are the classic call.'
    },

    {
      id: 'sturgeon-green',
      flowPref: 'rising',
      name: 'Green sturgeon',
      short: 'Green sturgeon',
      group: 'Anadromous',
      icon: 'sturgeon',
      classes: ['delta', 'bay', 'tidal-river'],
      profile: 'bay',
      opt: [50, 60], ok: [44, 68], survive: [38, 74],
      protected: true,
      run: curve([
        ['03-15', 0.40], ['05-01', 0.80], ['06-15', 1.00], ['08-01', 0.75],
        ['09-15', 0.45], ['11-01', 0.25], ['01-01', 0.20]
      ]),
      note: 'Southern DPS green sturgeon are threatened — no take. Included so you can tell them from whites.'
    },

    /* ---------- lakes and warmwater ---------- */

    {
      id: 'largemouth',
      nightBias: 0.55,
      name: 'Largemouth bass',
      short: 'Largemouth',
      group: 'Bass & panfish',
      icon: 'bass',
      classes: ['lake', 'delta', 'tidal-river'],
      profile: 'lake',
      profiles: { delta: 'bay', 'tidal-river': 'bay' },
      opt: [68, 80], ok: [58, 86], survive: [42, 92],
      run: curve([
        ['02-01', 0.45], ['03-15', 0.80], ['04-10', 1.00], ['05-05', 0.95],
        ['06-01', 0.80], ['07-15', 0.70], ['09-01', 0.75], ['10-10', 0.85],
        ['11-15', 0.60], ['12-20', 0.40]
      ]),
      note: 'Clear Lake and the Delta are the NorCal standouts. Pre-spawn spring and the autumn feed are the peaks; a falling barometer ahead of a front fires them up.'
    },

    {
      id: 'smallmouth',
      name: 'Smallmouth bass',
      short: 'Smallmouth',
      group: 'Bass & panfish',
      icon: 'bass',
      classes: ['lake', 'river'],
      profile: 'lake',
      profiles: { river: 'riverRun' },
      opt: [65, 75], ok: [55, 82], survive: [40, 88],
      run: curve([
        ['03-01', 0.45], ['04-15', 0.90], ['05-10', 1.00], ['06-15', 0.85],
        ['08-01', 0.75], ['09-20', 0.85], ['11-01', 0.55], ['12-15', 0.35]
      ])
    },

    {
      id: 'spotted',
      name: 'Spotted bass',
      short: 'Spots',
      group: 'Bass & panfish',
      icon: 'bass',
      classes: ['lake'],
      profile: 'lake',
      opt: [64, 78], ok: [54, 84], survive: [40, 90],
      run: curve([
        ['02-15', 0.50], ['04-01', 0.95], ['05-01', 1.00], ['06-15', 0.80],
        ['08-01', 0.70], ['10-01', 0.85], ['11-20', 0.55], ['01-01', 0.40]
      ]),
      note: 'Shasta, Oroville, Berryessa and Bullards Bar all hold strong spotted bass populations.'
    },

    {
      id: 'trout-rainbow',
      name: 'Rainbow trout',
      short: 'Rainbow',
      group: 'Trout & kokanee',
      icon: 'trout',
      classes: ['lake', 'river'],
      profile: 'lake',
      profiles: { river: 'riverRun' },
      opt: [52, 64], ok: [44, 70], survive: [34, 77],
      stallAbove: 72,
      run: curve([
        ['01-15', 0.55], ['03-15', 0.85], ['04-25', 1.00], ['06-01', 0.80],
        ['07-15', 0.55], ['09-01', 0.70], ['10-15', 0.90], ['12-01', 0.60]
      ])
    },

    {
      id: 'trout-brown',
      nightBias: 0.68,
      name: 'Brown trout',
      short: 'Brown',
      group: 'Trout & kokanee',
      icon: 'trout',
      classes: ['lake', 'river'],
      profile: 'lake',
      profiles: { river: 'riverRun' },
      opt: [54, 66], ok: [45, 72], survive: [34, 78],
      stallAbove: 74,
      run: curve([
        ['02-01', 0.55], ['04-01', 0.80], ['05-15', 0.75], ['07-01', 0.55],
        ['09-01', 0.80], ['10-10', 1.00], ['11-05', 0.90], ['12-15', 0.60]
      ]),
      note: 'Big browns get aggressive in the autumn pre-spawn, especially at low light.'
    },

    {
      id: 'kokanee',
      name: 'Kokanee',
      short: 'Kokanee',
      group: 'Trout & kokanee',
      icon: 'salmon',
      classes: ['lake'],
      profile: 'lake',
      opt: [50, 58], ok: [45, 64], survive: [38, 70],
      run: curve([
        ['04-15', 0.35], ['05-20', 0.70], ['06-20', 0.95], ['07-20', 1.00],
        ['08-20', 0.85], ['09-15', 0.50], ['10-10', 0.15], ['11-15', 0.08]
      ]),
      note: 'Land-locked sockeye. Tahoe, Berryessa, Bullards Bar, Whiskeytown and Shasta — troll the thermocline through summer.'
    },

    {
      id: 'mackinaw',
      name: 'Mackinaw',
      short: 'Lake trout',
      group: 'Trout & kokanee',
      icon: 'trout',
      classes: ['lake'],
      profile: 'lake',
      opt: [44, 52], ok: [38, 58], survive: [33, 66],
      run: curve([
        ['01-15', 0.70], ['03-15', 0.85], ['05-01', 0.95], ['06-15', 1.00],
        ['08-01', 0.90], ['09-20', 0.85], ['11-01', 0.70], ['12-10', 0.65]
      ]),
      systems: ['tahoe'],
      note: 'Tahoe deep-water fish. Dawn is the whole game.'
    },

    {
      id: 'catfish',
      nightBias: 0.92,
      name: 'Catfish',
      short: 'Catfish',
      group: 'Bass & panfish',
      icon: 'catfish',
      classes: ['lake', 'delta', 'river', 'tidal-river'],
      profile: 'lake',
      profiles: { delta: 'bay', river: 'riverRun', 'tidal-river': 'bay' },
      opt: [70, 85], ok: [60, 90], survive: [45, 95],
      run: curve([
        ['03-01', 0.30], ['05-01', 0.75], ['06-15', 1.00], ['08-01', 1.00],
        ['09-15', 0.80], ['11-01', 0.45], ['01-01', 0.22]
      ]),
      note: 'Warm summer nights in the Delta and Clear Lake.'
    },

    {
      id: 'crappie',
      nightBias: 0.6,
      name: 'Crappie',
      short: 'Crappie',
      group: 'Bass & panfish',
      icon: 'panfish',
      classes: ['lake', 'delta'],
      profile: 'lake',
      opt: [64, 74], ok: [55, 80], survive: [40, 86],
      run: curve([
        ['02-15', 0.45], ['03-25', 0.90], ['04-20', 1.00], ['05-20', 0.80],
        ['07-01', 0.55], ['09-15', 0.70], ['11-01', 0.50], ['01-01', 0.35]
      ])
    },

    {
      id: 'bluegill',
      name: 'Bluegill & sunfish',
      short: 'Panfish',
      group: 'Bass & panfish',
      icon: 'panfish',
      classes: ['lake', 'delta'],
      profile: 'lake',
      opt: [70, 82], ok: [60, 88], survive: [45, 92],
      run: curve([
        ['03-15', 0.40], ['05-01', 0.85], ['06-01', 1.00], ['07-15', 0.90],
        ['09-01', 0.75], ['10-20', 0.45], ['01-01', 0.20]
      ])
    },

    /* ---------- salt water ---------- */

    {
      id: 'rockfish',
      name: 'Rockfish & lingcod',
      short: 'Rockfish',
      group: 'Saltwater',
      icon: 'rockfish',
      classes: ['ocean', 'bay'],
      profile: 'ocean',
      opt: [48, 58], ok: [44, 63], survive: [40, 70],
      run: curve([
        ['03-15', 0.45], ['04-15', 0.90], ['05-20', 1.00], ['07-01', 0.95],
        ['08-15', 0.90], ['09-20', 0.95], ['10-25', 0.85], ['12-01', 0.50],
        ['01-15', 0.35]
      ]),
      note: 'Bottom fish care far more about whether you can safely reach the reef than about the barometer. Watch the swell panel.'
    },

    {
      id: 'halibut-ca',
      name: 'California halibut',
      short: 'Halibut',
      group: 'Saltwater',
      icon: 'halibut',
      classes: ['bay', 'ocean', 'surf'],
      profile: 'bay',
      profiles: { ocean: 'ocean', surf: 'surf' },
      opt: [58, 68], ok: [52, 72], survive: [46, 78],
      run: curve([
        ['03-15', 0.30], ['05-01', 0.80], ['06-01', 1.00], ['07-15', 0.95],
        ['08-20', 0.85], ['09-20', 0.60], ['10-25', 0.30], ['12-15', 0.12]
      ]),
      note: 'Drift the flats on a moving tide once the bay warms past the high fifties.'
    },

    {
      id: 'surfperch',
      nightBias: 0.5,
      name: 'Surfperch',
      short: 'Perch',
      group: 'Saltwater',
      icon: 'perch',
      classes: ['surf', 'bay', 'tidal-river'],
      profile: 'surf',
      profiles: { 'tidal-river': 'bay' },
      opt: [50, 60], ok: [46, 66], survive: [42, 72],
      run: curve([
        ['01-15', 0.65], ['03-01', 0.90], ['04-10', 1.00], ['05-15', 0.90],
        ['07-01', 0.70], ['09-01', 0.65], ['11-01', 0.60], ['12-10', 0.60]
      ]),
      note: 'Tide is nearly everything. Fish the incoming into a high, work the troughs and holes, and keep an eye on the sneaker sets.'
    },

    {
      id: 'albacore',
      name: 'Albacore',
      short: 'Albacore',
      group: 'Saltwater',
      icon: 'tuna',
      classes: ['ocean'],
      profile: 'ocean',
      opt: [60, 66], ok: [58, 70], survive: [54, 75],
      run: curve([
        ['06-20', 0.08], ['07-25', 0.40], ['08-15', 0.85], ['09-05', 1.00],
        ['09-25', 0.90], ['10-15', 0.55], ['11-01', 0.20]
      ]),
      note: 'A long run offshore for warm blue water. Needs a flat forecast as much as it needs 60 °F-plus temperature.'
    }
  ];

  var byId = {};
  SPECIES.forEach(function (s) { byId[s.id] = s; });

  /* Run strength 0..1 for a species on a given day, honouring system overrides. */
  function runStrength(species, dayOfYear, system) {
    if (!species) return null;
    var points = (species.runBySystem && system && species.runBySystem[system]) || species.run;
    if (!points) return null;
    return sampleCurve(points, dayOfYear);
  }

  /* Which weight profile applies for this species in this kind of water. */
  function profileFor(species, waterClass) {
    if (!species) return 'lake';
    if (species.profiles && species.profiles[waterClass]) return species.profiles[waterClass];
    return species.profile || 'lake';
  }

  var api = {
    list: SPECIES,
    byId: byId,
    doy: doy,
    curve: curve,
    sampleCurve: sampleCurve,
    runStrength: runStrength,
    profileFor: profileFor
  };

  root.BITE = root.BITE || {};
  root.BITE.species = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
