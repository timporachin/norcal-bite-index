/* Bite Index — Northern California spot registry.

   "Closest area" resolves to the nearest entry here. Each spot names the real
   live sensors that cover it: a USGS gauge for river temperature, flow and
   turbidity, and a NOAA CO-OPS station for tide. Both were checked against the
   live services — every id below returns data today.

   cls (water class) drives which scoring profile the model uses:
     river        free-flowing, no tidal influence
     tidal-river  river reach that still breathes with the tide
     delta        the Sacramento-San Joaquin Delta
     bay          coastal bays and inlets
     ocean        open coast
     surf         beach fishing
     lake         reservoirs and natural lakes
*/
(function (root) {
  'use strict';

  /* NOAA CO-OPS tide prediction stations used below. */
  var TIDE_STATIONS = {
    '9419945': { name: 'Pyramid Point, Smith River', lat: 41.9453, lon: -124.2009 },
    '9419750': { name: 'Crescent City', lat: 41.7456, lon: -124.1844 },
    '9419059': { name: 'Trinidad Harbor', lat: 41.0567, lon: -124.1470 },
    '9418865': { name: 'Mad River Slough', lat: 40.8650, lon: -124.1480 },
    '9418817': { name: 'Samoa', lat: 40.8267, lon: -124.1800 },
    '9418767': { name: 'Humboldt Bay, North Spit', lat: 40.7669, lon: -124.2173 },
    '9418637': { name: 'Cockrobin Island, Eel River', lat: 40.6372, lon: -124.2822 },
    '9418024': { name: 'Shelter Cove', lat: 40.0250, lon: -124.0580 },
    '9417426': { name: 'Noyo Harbor', lat: 39.4258, lon: -123.8051 },
    '9416841': { name: 'Arena Cove', lat: 38.9146, lon: -123.7111 },
    '9416174': { name: 'Sacramento', lat: 38.5800, lon: -121.5070 },
    '9416024': { name: 'Fort Ross', lat: 38.5133, lon: -123.2450 },
    '9415846': { name: 'Clarksburg', lat: 38.4167, lon: -121.5230 },
    '9415625': { name: 'Bodega Harbor entrance', lat: 38.3083, lon: -123.0550 },
    '9415469': { name: 'Tomales Bay entrance', lat: 38.2283, lon: -122.9770 },
    '9415339': { name: 'Marshall, Tomales Bay', lat: 38.1617, lon: -122.8930 },
    '9415316': { name: 'Rio Vista', lat: 38.1450, lon: -121.6920 },
    '9415287': { name: 'Georgiana Slough', lat: 38.1250, lon: -121.5780 },
    '9415144': { name: 'Port Chicago, Suisun Bay', lat: 38.0560, lon: -122.0395 },
    '9415111': { name: 'Benicia', lat: 38.0433, lon: -122.1300 },
    '9415064': { name: 'Antioch', lat: 38.0200, lon: -121.8150 },
    '9415020': { name: 'Point Reyes', lat: 37.9942, lon: -122.9736 },
    '9415009': { name: 'Point San Pedro', lat: 37.9933, lon: -122.4470 },
    '9414883': { name: 'Stockton', lat: 37.9583, lon: -121.2900 },
    '9414818': { name: 'Angel Island', lat: 37.8633, lon: -122.4200 },
    '9414816': { name: 'Berkeley', lat: 37.8650, lon: -122.3070 },
    '9414290': { name: 'San Francisco, Golden Gate', lat: 37.8063, lon: -122.4659 },
    '9414275': { name: 'Ocean Beach', lat: 37.7750, lon: -122.5130 },
    '9414262': { name: 'Southeast Farallon Island', lat: 37.7000, lon: -123.0000 },
    '9414131': { name: 'Pillar Point Harbor', lat: 37.5025, lon: -122.4822 },
    '9413878': { name: 'Ano Nuevo Island', lat: 37.1083, lon: -122.3380 },
    '9413745': { name: 'Santa Cruz', lat: 36.9583, lon: -122.0170 }
  };

  var VALLEY_SALMON = ['chinook-fall', 'steelhead-winter', 'striper', 'shad'];
  var COAST_SALMON = ['chinook-fall', 'steelhead-winter', 'coho'];
  var LAKE_WARM = ['largemouth', 'spotted', 'smallmouth', 'crappie', 'bluegill', 'catfish', 'trout-rainbow'];

  var SPOTS = [

    /* ---------- Sacramento River system ---------- */
    {
      id: 'sac-freeport', name: 'Sacramento River — Freeport', region: 'Sacramento Valley',
      lat: 38.4557, lon: -121.5016, cls: 'tidal-river', system: 'sacramento',
      gauges: ['11447650'], tide: '9415846',
      species: VALLEY_SALMON.concat(['sturgeon-white', 'catfish']),
      blurb: 'The valley salmon highway. Tidal all the way through, with a live gauge in the river reading temperature, flow and turbidity.'
    },
    {
      id: 'sac-discovery', name: 'Sacramento River — Discovery Park', region: 'Sacramento Valley',
      lat: 38.6009, lon: -121.5064, cls: 'tidal-river', system: 'sacramento',
      gauges: ['11447650', '11446500'], tide: '9416174',
      species: VALLEY_SALMON.concat(['striper', 'sturgeon-white']),
      blurb: 'The American meets the Sacramento. Kings stack at the confluence and stripers work it hard in spring.'
    },
    {
      id: 'sac-verona', name: 'Sacramento River — Verona', region: 'Sacramento Valley',
      lat: 38.7743, lon: -121.5983, cls: 'river', system: 'sacramento',
      gauges: ['11425500'],
      species: VALLEY_SALMON,
      blurb: 'Just below the Feather confluence. The gauge here reads temperature, flow and turbidity for the whole middle river.'
    },
    {
      id: 'sac-grimes', name: 'Sacramento River — Grimes', region: 'Sacramento Valley',
      lat: 39.0099, lon: -121.8247, cls: 'river', system: 'sacramento',
      gauges: ['11390500'],
      species: VALLEY_SALMON,
      blurb: 'Wilkins Slough reach — quiet water, good early-autumn king trolling.'
    },
    {
      id: 'sac-colusa', name: 'Sacramento River — Colusa', region: 'Sacramento Valley',
      lat: 39.2140, lon: -122.0002, cls: 'river', system: 'sacramento',
      gauges: ['11389500', '11390500'],
      species: VALLEY_SALMON,
      blurb: 'Classic mid-valley bank and boat water for autumn kings.'
    },
    {
      id: 'sac-red-bluff', name: 'Sacramento River — Red Bluff', region: 'Upper Sacramento',
      lat: 40.1785, lon: -122.2011, cls: 'river', system: 'sacramento-upper',
      gauges: ['11377100'],
      species: ['chinook-fall', 'chinook-spring', 'steelhead-winter', 'trout-rainbow'],
      blurb: 'Upper river fish arrive weeks earlier than the valley. Bend Bridge gauge covers this reach.'
    },
    {
      id: 'sac-barge-hole', name: 'Sacramento River — Barge Hole', region: 'Upper Sacramento',
      lat: 40.4487, lon: -122.2969, cls: 'river', system: 'sacramento-upper',
      gauges: ['11377100', '11370500'],
      species: ['chinook-fall', 'chinook-spring', 'steelhead-winter', 'trout-rainbow'],
      blurb: 'Anderson to Balls Ferry — cold Keswick releases keep kings comfortable through August.'
    },
    {
      id: 'sac-delta-cross', name: 'Sacramento River — Walnut Grove', region: 'Delta',
      lat: 38.2577, lon: -121.5183, cls: 'tidal-river', system: 'sacramento',
      gauges: ['11447890'], tide: '9415287',
      species: ['chinook-fall', 'striper', 'sturgeon-white', 'largemouth', 'catfish'],
      blurb: 'Delta Cross Channel reach. Live temperature and turbidity right where the kings turn upriver.'
    },

    /* ---------- American, Feather, Yuba, Mokelumne ---------- */
    {
      id: 'american-fair-oaks', name: 'American River — Sailor Bar', region: 'Sacramento Valley',
      lat: 38.6354, lon: -121.2277, cls: 'river', system: 'american',
      gauges: ['11446500'],
      species: ['chinook-fall', 'steelhead-winter', 'shad', 'smallmouth'],
      blurb: 'Fair Oaks gauge sits in the run. Cold Folsom water makes this the last valley river to warm out.'
    },
    {
      id: 'american-watt', name: 'American River — Watt Avenue', region: 'Sacramento Valley',
      lat: 38.5836, lon: -121.3872, cls: 'river', system: 'american',
      gauges: ['11446500'],
      species: ['chinook-fall', 'steelhead-winter', 'shad'],
      blurb: 'Lower river bank water. Shad in May and June, kings from late September.'
    },
    {
      id: 'feather-gridley', name: 'Feather River — Gridley', region: 'Sacramento Valley',
      lat: 39.3638, lon: -121.6919, cls: 'river', system: 'feather',
      gauges: ['11425500'],
      gaugeNote: 'The Feather is metered by CDEC, not the USGS live feed, so readings come from the nearest live gauge downstream.',
      species: ['chinook-fall', 'steelhead-winter', 'shad', 'striper'],
      blurb: 'The low-flow section below the hatchery — September and October are the peak.'
    },
    {
      id: 'feather-yuba-city', name: 'Feather River — Yuba City', region: 'Sacramento Valley',
      lat: 39.1338, lon: -121.6069, cls: 'river', system: 'feather',
      gauges: ['11425500', '11421000'],
      gaugeNote: 'The Feather is metered by CDEC, not the USGS live feed, so readings come from the nearest live gauges.',
      species: ['chinook-fall', 'steelhead-winter', 'shad', 'striper'],
      blurb: 'Boat water through town, with the Yuba pouring in just upstream.'
    },
    {
      id: 'yuba-marysville', name: 'Yuba River — Marysville', region: 'Sacramento Valley',
      lat: 39.1757, lon: -121.5250, cls: 'river', system: 'yuba',
      gauges: ['11421000'],
      species: ['chinook-fall', 'steelhead-winter', 'shad', 'trout-rainbow'],
      blurb: 'Small, clear and cold. Wild steelhead water in winter.'
    },
    {
      id: 'mokelumne-new-hope', name: 'Mokelumne River — New Hope', region: 'Delta',
      lat: 38.2256, lon: -121.4911, cls: 'tidal-river', system: 'mokelumne',
      gauges: ['11336680'], tide: '9415287',
      species: ['chinook-fall', 'steelhead-winter', 'striper', 'largemouth', 'catfish'],
      blurb: 'South Mokelumne at New Hope Bridge — temperature, flow and turbidity all live.'
    },

    /* ---------- Klamath and Trinity ---------- */
    {
      id: 'klamath-glen', name: 'Klamath River — Glen', region: 'North Coast',
      lat: 41.5233, lon: -124.0122, cls: 'tidal-river', system: 'klamath',
      gauges: ['11530500'], tide: '9419750',
      species: ['chinook-fall', 'steelhead-half-pounder', 'steelhead-winter', 'coho'],
      blurb: 'The lower river inside the tide. Kings stage on the incoming and push through on the top of the tide.'
    },
    {
      id: 'klamath-orleans', name: 'Klamath River — Orleans', region: 'North Coast',
      lat: 41.3034, lon: -123.5345, cls: 'river', system: 'klamath',
      gauges: ['11523000'],
      species: ['chinook-fall', 'steelhead-half-pounder', 'steelhead-winter'],
      blurb: 'Mid-Klamath. Half-pounders show from September on low, clear water.'
    },
    {
      id: 'trinity-hoopa', name: 'Trinity River — Hoopa', region: 'North Coast',
      lat: 41.0498, lon: -123.6736, cls: 'river', system: 'trinity',
      gauges: ['11530000'],
      species: ['chinook-fall', 'steelhead-half-pounder', 'steelhead-winter', 'trout-rainbow'],
      blurb: 'Lower Trinity, no tide. Autumn kings then a long steelhead season.'
    },
    {
      id: 'trinity-willow-creek', name: 'Trinity River — Willow Creek', region: 'North Coast',
      lat: 40.9401, lon: -123.6300, cls: 'river', system: 'trinity',
      gauges: ['11530000'],
      species: ['chinook-fall', 'steelhead-half-pounder', 'steelhead-winter'],
      blurb: 'Drift water through the canyon reach.'
    },
    {
      id: 'trinity-junction-city', name: 'Trinity River — Junction City', region: 'North Coast',
      lat: 40.7357, lon: -122.9787, cls: 'river', system: 'trinity',
      gauges: ['11525655'],
      species: ['chinook-fall', 'steelhead-winter', 'trout-rainbow', 'trout-brown'],
      blurb: 'Upper river fly water below Lewiston.'
    },

    /* ---------- North coast rivers ---------- */
    {
      id: 'smith-jed', name: 'Smith River — Jedediah Smith', region: 'North Coast',
      lat: 41.7915, lon: -124.0762, cls: 'river', system: 'smith',
      gauges: ['11532500'],
      species: COAST_SALMON,
      blurb: 'The clearest big river in the state. It rises and drops fast — fish it on the shoulder of a storm.'
    },
    {
      id: 'smith-mouth', name: 'Smith River — mouth', region: 'North Coast',
      lat: 41.9350, lon: -124.2000, cls: 'tidal-river', system: 'smith',
      gauges: ['11532500'], tide: '9419945',
      species: COAST_SALMON.concat(['surfperch']),
      blurb: 'Tidewater at Pyramid Point. Chrome kings on the incoming from late October.'
    },
    {
      id: 'eel-scotia', name: 'Eel River — Scotia', region: 'North Coast',
      lat: 40.4915, lon: -124.0997, cls: 'river', system: 'eel',
      gauges: ['11477000'],
      species: COAST_SALMON.concat(['steelhead-half-pounder']),
      blurb: 'The Eel needs rain to open. Watch for the flow spike, then fish the drop.'
    },
    {
      id: 'eel-fernbridge', name: 'Eel River — Fernbridge', region: 'North Coast',
      lat: 40.6169, lon: -124.1988, cls: 'tidal-river', system: 'eel',
      gauges: ['11477000'], tide: '9418637',
      species: COAST_SALMON.concat(['surfperch']),
      blurb: 'Lower river inside the tide, with the estuary gauge at Cockrobin Island.'
    },
    {
      id: 'vanduzen', name: 'Van Duzen River — Bridgeville', region: 'North Coast',
      lat: 40.4804, lon: -123.8908, cls: 'river', system: 'eel',
      gauges: ['11478500'],
      species: ['chinook-fall', 'steelhead-winter', 'coho'],
      blurb: 'Small tributary water that clears before the main Eel.'
    },
    {
      id: 'mad-river', name: 'Mad River — Arcata', region: 'North Coast',
      lat: 40.9098, lon: -124.0606, cls: 'river', system: 'mad',
      gauges: ['11481000'], tide: '9418865',
      species: ['chinook-fall', 'steelhead-winter', 'coho'],
      blurb: 'Hatchery steelhead river, best on a dropping green flow.'
    },
    {
      id: 'russian-hacienda', name: 'Russian River — Hacienda', region: 'Sonoma Coast',
      lat: 38.5085, lon: -122.9277, cls: 'river', system: 'russian',
      gauges: ['11467000'],
      species: ['chinook-fall', 'steelhead-winter', 'coho', 'smallmouth'],
      blurb: 'Temperature, flow and turbidity all live at the Hacienda bridge.'
    },
    {
      id: 'russian-jenner', name: 'Russian River — Jenner', region: 'Sonoma Coast',
      lat: 38.4497, lon: -123.1130, cls: 'tidal-river', system: 'russian',
      gauges: ['11467000'], tide: '9416024',
      species: ['chinook-fall', 'steelhead-winter', 'surfperch', 'striper'],
      blurb: 'The estuary. Whether the mouth is open to the ocean decides everything here.'
    },
    {
      id: 'navarro', name: 'Navarro River — Navarro', region: 'Mendocino Coast',
      lat: 39.1704, lon: -123.6680, cls: 'river', system: 'navarro',
      gauges: ['11468000'], tide: '9416841',
      species: ['chinook-fall', 'steelhead-winter', 'coho'],
      blurb: 'Short coastal river that opens only after real rain.'
    },

    /* ---------- Delta and bays ---------- */
    {
      id: 'delta-rio-vista', name: 'Delta — Rio Vista', region: 'Delta',
      lat: 38.1450, lon: -121.6920, cls: 'delta', system: 'delta',
      gauges: ['11447890'], tide: '9415316',
      species: ['striper', 'sturgeon-white', 'chinook-fall', 'largemouth', 'catfish', 'crappie'],
      blurb: 'Where the Sacramento goes wide. Stripers, sturgeon and passing kings all move on the tide here.'
    },
    {
      id: 'delta-antioch', name: 'Delta — Antioch', region: 'Delta',
      lat: 38.0200, lon: -121.8150, cls: 'delta', system: 'delta',
      tide: '9415064',
      species: ['striper', 'sturgeon-white', 'largemouth', 'catfish', 'crappie', 'bluegill'],
      blurb: 'The west Delta. Big tide swings, big stripers.'
    },
    {
      id: 'delta-stockton', name: 'Delta — Stockton', region: 'Delta',
      lat: 37.9583, lon: -121.2900, cls: 'delta', system: 'delta',
      tide: '9414883',
      species: ['largemouth', 'striper', 'catfish', 'crappie', 'bluegill'],
      blurb: 'South Delta bass country.'
    },
    {
      id: 'suisun-bay', name: 'Suisun Bay — Port Chicago', region: 'San Francisco Bay',
      lat: 38.0560, lon: -122.0395, cls: 'bay', system: 'bay',
      tide: '9415144',
      species: ['sturgeon-white', 'striper'],
      blurb: 'Winter sturgeon water. Storm runoff and a big outgoing put them on the feed.'
    },
    {
      id: 'carquinez-benicia', name: 'Carquinez Strait — Benicia', region: 'San Francisco Bay',
      lat: 38.0433, lon: -122.1300, cls: 'bay', system: 'bay',
      tide: '9415111',
      species: ['sturgeon-white', 'striper'],
      blurb: 'Deep, fast water through the strait. Fish the tide, not the clock.'
    },
    {
      id: 'san-pablo-bay', name: 'San Pablo Bay', region: 'San Francisco Bay',
      lat: 38.0700, lon: -122.4200, cls: 'bay', system: 'bay',
      tide: '9415009',
      species: ['sturgeon-white', 'striper', 'halibut-ca'],
      blurb: 'Shallow mud flats — the classic sturgeon ground after a storm.'
    },
    {
      id: 'sf-berkeley-flats', name: 'San Francisco Bay — Berkeley Flats', region: 'San Francisco Bay',
      lat: 37.8650, lon: -122.3070, cls: 'bay', system: 'bay',
      tide: '9414816',
      species: ['halibut-ca', 'striper', 'chinook-ocean'],
      blurb: 'Drift the flats for halibut through summer, stripers on the tide line.'
    },
    {
      id: 'sf-raccoon-strait', name: 'San Francisco Bay — Raccoon Strait', region: 'San Francisco Bay',
      lat: 37.8633, lon: -122.4200, cls: 'bay', system: 'bay',
      tide: '9414818',
      species: ['halibut-ca', 'striper', 'chinook-ocean', 'rockfish'],
      blurb: 'Angel Island current seam. Strong tides stack bait against the point.'
    },

    /* ---------- Coastal inlets ---------- */
    {
      id: 'humboldt-bay', name: 'Humboldt Bay', region: 'North Coast',
      lat: 40.7669, lon: -124.2173, cls: 'bay', system: 'bay',
      tide: '9418767',
      species: ['halibut-ca', 'surfperch', 'chinook-ocean', 'rockfish'],
      blurb: 'The bar is the thing. Check the swell and tide panel before you commit.'
    },
    {
      id: 'crescent-city-harbor', name: 'Crescent City Harbor', region: 'North Coast',
      lat: 41.7456, lon: -124.1844, cls: 'bay', system: 'bay',
      tide: '9419750',
      species: ['rockfish', 'chinook-ocean', 'surfperch', 'halibut-ca'],
      blurb: 'Sheltered launch with reef fishing minutes away.'
    },
    {
      id: 'noyo-harbor', name: 'Noyo Harbor — Fort Bragg', region: 'Mendocino Coast',
      lat: 39.4258, lon: -123.8051, cls: 'bay', system: 'bay',
      tide: '9417426',
      species: ['rockfish', 'chinook-ocean', 'halibut-ca'],
      blurb: 'Narrow river mouth. An ebb against a big westerly swell makes the entrance ugly.'
    },
    {
      id: 'bodega-harbor', name: 'Bodega Harbor', region: 'Sonoma Coast',
      lat: 38.3083, lon: -123.0550, cls: 'bay', system: 'bay',
      tide: '9415625',
      species: ['chinook-ocean', 'rockfish', 'halibut-ca', 'surfperch'],
      blurb: 'The main Sonoma coast salmon port.'
    },
    {
      id: 'tomales-bay', name: 'Tomales Bay', region: 'Marin Coast',
      lat: 38.1617, lon: -122.8930, cls: 'bay', system: 'bay',
      tide: '9415339',
      species: ['halibut-ca', 'surfperch', 'striper'],
      blurb: 'Long shallow bay — halibut on the flood through summer.'
    },
    {
      id: 'half-moon-bay', name: 'Pillar Point — Half Moon Bay', region: 'San Mateo Coast',
      lat: 37.5025, lon: -122.4822, cls: 'bay', system: 'bay',
      tide: '9414131',
      species: ['chinook-ocean', 'rockfish', 'halibut-ca'],
      blurb: 'Protected harbour with salmon grounds straight out the gap.'
    },

    /* ---------- Open coast ---------- */
    {
      id: 'ocean-farallones', name: 'Gulf of the Farallones', region: 'Open coast',
      lat: 37.7000, lon: -123.0000, cls: 'ocean', system: 'ocean',
      tide: '9414262',
      species: ['chinook-ocean', 'rockfish', 'albacore'],
      blurb: 'The San Francisco salmon grounds. Look for the 52–58 °F break and working birds.'
    },
    {
      id: 'ocean-duxbury', name: 'Duxbury Reef — Point Reyes', region: 'Open coast',
      lat: 37.8900, lon: -122.7000, cls: 'ocean', system: 'ocean',
      tide: '9415020',
      species: ['chinook-ocean', 'rockfish', 'halibut-ca'],
      blurb: 'Close-in reef and the salmon shelf just outside it.'
    },
    {
      id: 'ocean-pigeon-point', name: 'Pigeon Point', region: 'Open coast',
      lat: 37.1810, lon: -122.4000, cls: 'ocean', system: 'ocean',
      tide: '9413878',
      species: ['chinook-ocean', 'rockfish', 'albacore'],
      blurb: 'South of the Gate. Often fishable when the north coast is blown out.'
    },
    {
      id: 'ocean-shelter-cove', name: 'Shelter Cove', region: 'Lost Coast',
      lat: 40.0250, lon: -124.0580, cls: 'ocean', system: 'ocean',
      tide: '9418024',
      species: ['chinook-ocean', 'rockfish', 'albacore', 'halibut-ca'],
      blurb: 'Beach launch on the Lost Coast — swell height decides whether you go at all.'
    },
    {
      id: 'ocean-trinidad', name: 'Trinidad Head', region: 'North Coast',
      lat: 41.0567, lon: -124.1470, cls: 'ocean', system: 'ocean',
      tide: '9419059',
      species: ['chinook-ocean', 'rockfish', 'halibut-ca', 'albacore'],
      blurb: 'Reef fishing in the lee of the head, salmon on the shelf outside.'
    },
    {
      id: 'ocean-eureka-bar', name: 'Humboldt Bar — outside', region: 'North Coast',
      lat: 40.7500, lon: -124.2600, cls: 'ocean', system: 'ocean',
      tide: '9418767',
      species: ['chinook-ocean', 'rockfish', 'albacore', 'halibut-ca'],
      blurb: 'Outside the entrance. A hard ebb into a big swell stands the bar up — read the safety panel first.'
    },

    /* ---------- Surf ---------- */
    {
      id: 'surf-ocean-beach', name: 'Ocean Beach — San Francisco', region: 'Surf',
      lat: 37.7750, lon: -122.5130, cls: 'surf', system: 'surf',
      tide: '9414275',
      species: ['surfperch', 'striper', 'halibut-ca'],
      blurb: 'Perch year round and stripers in the wash through summer and autumn.'
    },
    {
      id: 'surf-dillon-beach', name: 'Dillon Beach', region: 'Surf',
      lat: 38.2500, lon: -122.9700, cls: 'surf', system: 'surf',
      tide: '9415469',
      species: ['surfperch', 'halibut-ca'],
      blurb: 'Troughs and holes right off the sand at the mouth of Tomales.'
    },
    {
      id: 'surf-samoa', name: 'Samoa & Manila Beaches', region: 'Surf',
      lat: 40.8267, lon: -124.1800, cls: 'surf', system: 'surf',
      tide: '9418817',
      species: ['surfperch'],
      blurb: 'Redtail perch on the North Spit — fish the incoming.'
    },
    {
      id: 'surf-crescent-city', name: 'Crescent City beaches', region: 'Surf',
      lat: 41.7600, lon: -124.2100, cls: 'surf', system: 'surf',
      tide: '9419750',
      species: ['surfperch'],
      blurb: 'Long sand beaches north and south of the harbour.'
    },

    /* ---------- Lakes and reservoirs ---------- */
    {
      id: 'clear-lake', name: 'Clear Lake', region: 'Lake County',
      lat: 39.0200, lon: -122.7900, cls: 'lake', system: 'lake',
      species: ['largemouth', 'crappie', 'bluegill', 'catfish'],
      blurb: 'The best largemouth lake in the state. Shallow and warm — it moves fast with the weather.'
    },
    {
      id: 'lake-berryessa', name: 'Lake Berryessa', region: 'Napa County',
      lat: 38.5800, lon: -122.2300, cls: 'lake', system: 'lake',
      species: ['spotted', 'largemouth', 'smallmouth', 'kokanee', 'trout-rainbow', 'crappie'],
      blurb: 'Deep and clear, with a strong kokanee troll through summer.'
    },
    {
      id: 'lake-shasta', name: 'Lake Shasta', region: 'Shasta County',
      lat: 40.7500, lon: -122.3400, cls: 'lake', system: 'lake',
      species: ['spotted', 'smallmouth', 'largemouth', 'kokanee', 'trout-rainbow', 'trout-brown', 'crappie'],
      blurb: 'Big water with four arms and a deep summer thermocline.'
    },
    {
      id: 'lake-oroville', name: 'Lake Oroville', region: 'Butte County',
      lat: 39.5400, lon: -121.4900, cls: 'lake', system: 'lake',
      species: ['spotted', 'smallmouth', 'largemouth', 'kokanee', 'crappie', 'catfish'],
      blurb: 'Steep canyon reservoir with a serious spotted bass fishery.'
    },
    {
      id: 'folsom-lake', name: 'Folsom Lake', region: 'Sacramento Valley',
      lat: 38.7100, lon: -121.1500, cls: 'lake', system: 'lake',
      gauges: ['11446220'],
      species: ['spotted', 'smallmouth', 'largemouth', 'trout-rainbow', 'kokanee', 'crappie'],
      blurb: 'The gauge below the dam gives a real water temperature for the lower lake.'
    },
    {
      id: 'trinity-lake', name: 'Trinity Lake', region: 'Trinity County',
      lat: 40.8000, lon: -122.7500, cls: 'lake', system: 'lake',
      species: ['smallmouth', 'largemouth', 'kokanee', 'trout-rainbow', 'trout-brown'],
      blurb: 'Cold, clear and quiet. Strong smallmouth and kokanee.'
    },
    {
      id: 'whiskeytown', name: 'Whiskeytown Lake', region: 'Shasta County',
      lat: 40.6100, lon: -122.5400, cls: 'lake', system: 'lake',
      species: ['kokanee', 'trout-rainbow', 'smallmouth', 'spotted'],
      blurb: 'Cold water year round — kokanee and rainbow trolling.'
    },
    {
      id: 'bullards-bar', name: 'New Bullards Bar', region: 'Yuba County',
      lat: 39.3900, lon: -121.1400, cls: 'lake', system: 'lake',
      species: ['spotted', 'kokanee', 'trout-rainbow', 'smallmouth'],
      blurb: 'Deep, steep and clear. Record-class spotted bass water.'
    },
    {
      id: 'lake-tahoe', name: 'Lake Tahoe', region: 'Sierra Nevada',
      lat: 39.0968, lon: -120.0324, cls: 'lake', system: 'tahoe',
      species: ['mackinaw', 'kokanee', 'trout-rainbow', 'trout-brown', 'smallmouth'],
      blurb: 'Deep-water mackinaw and a short, sharp kokanee season.'
    },
    {
      id: 'lake-almanor', name: 'Lake Almanor', region: 'Plumas County',
      lat: 40.2400, lon: -121.1300, cls: 'lake', system: 'lake',
      species: ['trout-rainbow', 'trout-brown', 'smallmouth', 'kokanee'],
      blurb: 'Big shallow mountain lake — the spring and autumn trout bite is the draw.'
    },
    {
      id: 'lake-camanche', name: 'Lake Camanche', region: 'Mother Lode',
      lat: 38.2200, lon: -120.9700, cls: 'lake', system: 'lake',
      species: LAKE_WARM,
      blurb: 'Planted trout in the cool months, bass and panfish the rest of the year.'
    },
    {
      id: 'lake-amador', name: 'Lake Amador', region: 'Mother Lode',
      lat: 38.4200, lon: -120.9200, cls: 'lake', system: 'lake',
      species: ['trout-rainbow', 'largemouth', 'bluegill', 'catfish', 'crappie'],
      blurb: 'Small foothill lake with a heavy trout plant through winter.'
    },
    {
      id: 'del-valle', name: 'Lake Del Valle', region: 'East Bay',
      lat: 37.5800, lon: -121.7200, cls: 'lake', system: 'lake',
      species: ['trout-rainbow', 'largemouth', 'striper', 'catfish', 'crappie', 'bluegill'],
      blurb: 'Close-in East Bay lake, stocked hard in the cool months.'
    },
    {
      id: 'ruth-lake', name: 'Ruth Lake', region: 'Trinity County',
      lat: 40.3400, lon: -123.4000, cls: 'lake', system: 'lake',
      species: ['smallmouth', 'largemouth', 'trout-rainbow', 'catfish'],
      blurb: 'Quiet Mad River reservoir well off the highway.'
    }
  ];

  var byId = {};
  SPOTS.forEach(function (s) { byId[s.id] = s; });

  var EARTH_MI = 3958.8;
  function haversineMi(lat1, lon1, lat2, lon2) {
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLon = (lon2 - lon1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return EARTH_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* Spots sorted by distance from a position, nearest first. */
  function nearest(lat, lon, limit) {
    return SPOTS.map(function (s) {
      return { spot: s, miles: haversineMi(lat, lon, s.lat, s.lon) };
    }).sort(function (a, b) { return a.miles - b.miles; }).slice(0, limit || SPOTS.length);
  }

  /* Loose name/region search for the spot picker. */
  function search(query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    var words = q.split(/\s+/);
    return SPOTS.filter(function (s) {
      var hay = (s.name + ' ' + s.region + ' ' + (s.system || '')).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    });
  }

  var api = {
    list: SPOTS,
    byId: byId,
    tideStations: TIDE_STATIONS,
    haversineMi: haversineMi,
    nearest: nearest,
    search: search
  };

  root.BITE = root.BITE || {};
  root.BITE.spots = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
