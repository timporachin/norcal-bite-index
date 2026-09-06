# NorCal Bite Index

A live fishing bite score for the closest Northern California water — the coast, the coastal inlets and bays, the inland river systems and the lakes. The model is built around **salmon running into the inland rivers**, and it changes shape depending on where you are: a river run is scored on different things than an ocean troll or a surf session.

Everything runs in your browser. There is no server, no account and no API key, and nothing is uploaded — your spot and units are remembered on your device only.

## What it reads

| Source | What comes from it |
| --- | --- |
| [USGS NWIS](https://waterdata.usgs.gov/nwis/rt) | River temperature, discharge, stage and turbidity from the actual gauge nearest your spot |
| [NOAA CO-OPS](https://tidesandcurrents.noaa.gov/) | Tide predictions, and station water temperature where the sensor exists |
| [Open-Meteo](https://open-meteo.com/) | Barometric pressure, wind and gusts, cloud, rain, sea surface temperature and swell |
| [CDEC](https://cdec.water.ca.gov/) | Feather River temperature and flow — see below |
| Computed in the page | Sun and moon position, sunrise and sunset, moon phase, solunar periods — so light and solunar still work with no network |

**67 spots** are built in, each wired to the real gauge and tide station that covers it — from Freeport, Verona and Sailor Bar to Klamath Glen, Hoopa, Scotia, the Farallones, Clear Lake and Ocean Beach. Tap **Nearest to me** or search the list. **24 species** carry temperature bands and per-river run curves.

## The Feather River and CDEC

The Feather is metered by the California Data Exchange Center, not the USGS live feed, and **CDEC sends no CORS headers** — so a static page cannot read it from the browser.

It used to borrow readings from Sacramento @ Verona, 25 river miles downstream on a different river, and that was badly wrong where it mattered: Verona read **72 °F** on a day the Feather at Gridley was **59 °F**. Water temperature is the heaviest factor in the salmon profile after run timing, and 72 °F is past the line where Chinook migration stalls. The app was calling the river too warm to bother with while it was in perfect shape.

So `.github/workflows/refresh-cdec.yml` runs `scripts/fetch-cdec.mjs` every hour, fetches CDEC where CORS does not apply, and commits `data/cdec.js`. The page loads that from its own origin. Gridley supplies temperature for the whole river; flow comes from the station nearest each stretch.

Two things to know:

- **GitHub disables scheduled workflows on a public repo after 60 days with no activity.** If the Feather data goes stale the app shows an amber CDEC light rather than pretending the reading is current — re-run the workflow from the Actions tab to wake it up.
- **The Feather spots carry no USGS fallback gauge on purpose.** There is no USGS gauge on that river, and a flow number borrowed from the Sacramento or the Yuba is worse than none. If the refresher stops, flow drops out of the score and confidence falls, which is visible and honest.

## How the score works

Each factor scores 0–1 and is combined by a weight profile chosen from the species and the kind of water:

| Profile | Heaviest factors |
| --- | --- |
| River run | run timing 22, flow & freshet 20, water temperature 16 |
| Open coast | temperature break 20, swell 18, upwelling 12 |
| Bay & Delta | tide 24, water temperature 16, light 14 |
| Surf | tide 30, swell 20, light 12 |
| Lake | water temperature 22, pressure 18, solunar 14 |

Two behaviours worth knowing:

- **Run timing gates the migratory species.** If the fish are not in the system yet, the score collapses no matter how good the water looks — an empty river in perfect shape is still an empty river.
- **Missing data lowers confidence, it does not fake a number.** A factor with no reading is dropped and the remaining weights are renormalised, and the confidence figure tells you how much of the model actually had data.

Water temperature comes from the best available source and is labelled: **Gauge** (a real USGS sensor), **NOAA station**, **Satellite SST**, or **Modeled** — a fallback from ten days of air temperature, calibrated against the live gauges at ten NorCal spots to a mean error of about 2.6 °F and counted at half weight.

Ocean, bay and surf spots also get a separate **fishability** readout for wind and swell. It is deliberately kept apart from the bite score, because a hot bite on a dangerous day is still a dangerous day.

## What it is not

It has no idea whether anyone is catching. There are no creel counts and no reports in it. Use it to compare hours and days, not as a promise.

**Regulations are deliberately not encoded.** Seasons, closures and limits change every year, and a stale rule shown as fact is worse than none. Run timing describes when fish are usually present, not when it is legal to fish for them — check [current CDFW regulations](https://wildlife.ca.gov/Fishing/Inland/Regulations).

## Running it

No build step, no dependencies, no bundler. Open `index.html` in a browser and it works, including straight from disk — reference data ships as JavaScript rather than JSON so `file://` does not trip over CORS. The only outside asset is the Google Fonts stylesheet, which falls back to system faces if it cannot load.

### On GitHub Pages

**Settings → Pages → Deploy from a branch → `main` → `/(root)`.**

The site then serves at `https://<your-username>.github.io/norcal-bite-index/`. Nothing else to configure; every data call is made from the visitor's browser.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page markup |
| `fish.css` | The whole design system — a single dark instrument theme |
| `js/fish-astro.js` | Solar and lunar geometry: sun altitude, sunrise/sunset, moon phase, solunar periods |
| `js/fish-species.js` | 24 species with temperature bands and run-timing curves |
| `js/fish-spots.js` | The 67-spot registry, with gauge, tide and CDEC station IDs |
| `js/fish-model.js` | The scoring engine — pure functions, no DOM and no network, so it can be exercised from node |
| `js/fish-data.js` | Live data layer with timeouts, caching and last-good fallback |
| `js/fish-ui.js` | Rendering and interaction |
| `data/cdec.js` | Generated hourly by the workflow — CDEC readings for the Feather. Safe to delete; the app just loses the Feather's live numbers |
| `scripts/fetch-cdec.mjs` | The refresher. Refuses to write if CDEC is down or the data looks wrong |

## Credits

Data from the U.S. Geological Survey, NOAA Tides & Currents, Open-Meteo, and the California Data Exchange Center. Run timing follows the standard CDFW and PFMC windows and long-established Northern California angling seasons.
