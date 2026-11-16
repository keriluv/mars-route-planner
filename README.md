# Mars Route Planner — Mount Sharp, Gale Crater

Baseline Python model that integrates orbital Mars data layers and computes a safe route from Bradbury Landing to the summit of Mount Sharp (Aeolis Mons), Gale Crater. Project for the NASA Space Apps Challenge 2026.

![Computed route](maps/route_map.png)

## Study area

| Parameter | Value |
|---|---|
| Site | Gale Crater, Mount Sharp massif (Aeolis Mons) |
| Bounding box | 137.18 °E – 138.08 °E, 5.45 °S – 4.55 °S |
| CRS | Mars 2000 planetocentric (EPSG:104905) |
| Extent | 53.1 km × 53.3 km |
| Grid | 1200 × 1200 cells (44.3 m × 44.5 m) |
| Start | 137.4416 °E, 4.5895 °S (Bradbury Landing, −4503 m) |
| Goal | 137.8599 °E, 5.3709 °S (summit, +830 m) |
| Elevation gain | +5,333 m |

The summit of the massif sits at the southern end of the area: the 200 m DEM places it at 137.86 °E, 5.37 °S with 832 m, about 5.3 km above the crater floor. The area includes the landing corridor, the Bagnold dune field and the north, west and south flanks of the mound.

## Data layers

| Layer | Type | Product | Resolution | Source |
|---|---|---|---|---|
| `dem` | Topographic | MOLA/HRSC blended DEM `Mars_MOLA_blend200ppx_HRSC_DEM` | 200 m | NASA Mars Trek |
| `slope`, `roughness` | Topographic | Derived from the DEM | 44 m | Own computation |
| `optical` | Optical | MOLA/HRSC color shaded relief `..._ClrShade_200mpp` | 200 m | NASA Mars Trek |
| `texture`, `gradient` | Optical | Derived from the relief | 44 m | Own computation |
| `thermal` | Thermal | THEMIS Day IR 100 m | 100 m | ASU JMARS |
| `color_index` | Multispectral | Viking MDIM 2.1 color | 232 m | NASA Mars Trek |
| `spectral_coverage` | Spectral | CRISM MTRDR footprints (FRT sites) | vector | NASA Mars Trek |
| `mineral_distance` | Spectral | OMEGA/CRISM hydrated detections | points | NASA Mars Trek |
| `traverse_distance` | Reference | Curiosity traverse (19,188 points) | 44 m | NASA Mars Trek |
| REMS | Atmospheric | ENVRDR sol 100 and sol 4500 | 1 s | NASA PDS |

Six data types are overlaid on the same grid: topographic, optical, thermal, multispectral, spectral and atmospheric. CRISM MTRDR coverage spans only 6.4 % of the area (west flank, product `FRT0000A091_07_IF165J_MTR3`). There is one OMEGA/CRISM hydrated-mineral detection on the west edge of the frame (137.20 °E, 5.00 °S) and another outside it, to the east.

![Layers](maps/layers_overview.png)

## Baseline model

Random forest classifier trained with Curiosity's actual traverse as the positive label.

- Positives: cells ≤ 60 m from the traverse (995 samples).
- Negatives: cells > 200 m from the traverse with slope > 15° or optical texture above the 75th percentile (995 samples).
- Features: slope, roughness, optical texture, optical gradient and thermal. Optical albedo and color index are excluded as predictors because their calibration changes with illumination and dust cover between the landing corridor and the massif; they remain as context layers.
- Forest of 300 trees, depth 12, minimum 5 samples per leaf, balanced classes.
- 70/15/15 spatial split by progress along the traverse, not random, to avoid information leakage.

| Set | Samples | Positives | ROC AUC | Average precision | F1 |
|---|---|---|---|---|---|
| Test | 928 | 184 | 0.913 | 0.715 | 0.498 |

Relative importance: roughness 0.45, slope 0.43, optical texture 0.08, optical gradient 0.03, thermal 0.01.

## Route planning

The traversability probability `p` is converted into a cost per cell:

```
cost = 1 + 4·(1 − p)² + 3·slope_penalty²
```

Cells with slope > 20° are blocked, with a two-cell margin (89 m). The route is computed with an 8-neighbor A* over 1.44 million cells and simplified with Douglas-Peucker (tolerance 1.5 cells).

The hard probability threshold is 0: the model was trained on a 19 km corridor next to the landing site and does not certify terrain 47 km away, so the probability acts on the cost and the hard veto stays on the slope.

## Results

| Metric | Learned model | Slope-only baseline |
|---|---|---|
| Length | 72.0 km | 59.0 km |
| Mean slope | 5.6° | 7.5° |
| Max slope | 18.0° | 16.6° |
| Mean roughness | 8.8 m | 11.8 m |
| Mean traversability | 0.67 | 0.34 |
| Traverse-like terrain | 64 % | 21 % |
| Expanded cells | 1,121,787 | 466,324 |

The learned route is 13 km longer than the baseline, but it doubles the mean traversability and triples the fraction of the path over terrain comparable to what Curiosity has already crossed. The baseline cuts diagonally across the north flank of the massif; the learned route goes around the mound to the west, crosses the plain south of the dune field and climbs the south slope to the summit.

![Comparison](maps/route_comparison.png)

![Profile](maps/route_profile.png)

![3D view](maps/route_3d.png)

![Integrated view](maps/integrated_view.png)

## Atmospheric conditions

REMS records the daily cycle at two moments of the mission: air temperature between 207 and 273 K on sol 100 and between 194 and 254 K on sol 4500, mean pressure of 840–843 Pa and maximum humidity of 6 % and 23 % respectively. Maximum UV radiation drops from 16.6 to 7.8 W/m² because of the higher dust load.

![REMS](maps/rems_environment.png)

## Interactive Web Application — GaleX

GaleX is a **100 % web, offline-first** application for predictive planning and interactive EVA simulation on Mars. **It opens by double-clicking `web/index.html`** (file://), without a server: data travels as scripts (`web/data/*.js`), not through `fetch`. The local Python backend is optional and adds persistence (SQLite + JSONL), synchronization between browsers and the tile cache of the 3D Planet.

### Quick start

- **Without a server:** open `web/index.html` in the browser. You will see «Local mode» in the top bar.
- **With backend (Linux / macOS):** `./run_galex.sh`
- **With backend (Windows):** `run_galex.bat`
- **Manual:**
  ```bash
  python3 backend/server.py
  # Open http://127.0.0.1:8000 in your browser
  ```

### GaleX features

1. **Multi-region (Gale and Jezero):**
   - **Gale Crater (Curiosity / MSL):** 300 × 300 grid in the browser (177 m per cell; 1200 × 1200 and 44 m in the Python model), deterministic Random Forest, raster layers, Bradbury Landing and Mount Sharp Base shelters.
   - **Jezero Crater (Perseverance / Mars 2020):** georeferenced bounding box, Octavia Butler Landing and Delta Front shelters, with scientific-honesty labeling («GALE ONLY» on layers not covered locally).
2. **Three multi-criteria route profiles:**
   - **Safe:** minimizes environmental risk and slopes > 15°.
   - **Fast:** minimizes EVA exposure time with the Tobler function adapted ($v = 6 \cdot e^{-3.5|grade+0.05|} \cdot 0.55$ km/h).
   - **Scientific:** maximizes visits to geological targets (CRISM, hydrated minerals, lacustrine sediments).
3. **Radiation as a risk layer (simplified model):**
   - «Radiation» layer (relative exposure index) and indicator in the conditions bar, each with its «?» and its source.
   - Base rate from MSL-RAD on the Gale floor (≈ 0.65 mSv/day, Simonsen, NASA 2024), adjusted for elevation and for the visible sky of the relief. A demonstration solar event multiplies the rate.
   - EVA dose accumulated per workday (only outdoor hours count). Notice (50 % of the threshold) and critical alert (100 %) with **Pause, Abort or Return to shelter**. Threshold configurable in Conditions → Radiation. The dose appears in the final summary and on the dashboard.
   - Each parameter says whether it is a **source** or an **assumption**: it is neither a measurement nor a forecast. Details in `docs/SOURCES_NOTES.md`.
4. **Validation and confidence of the traversability model:**
   - «Model confidence» layer (disagreement among the 300 trees of the forest) and a confidence row in the route comparison.
   - Conditions → Predictive model: «Limitations and assumptions» section in plain language (rover versus astronaut in a suit, label biases, extrapolation). Details and figures in `docs/MODEL_LIMITATIONS.md`.
5. **Configurable EVA workday and honest sols:**
   - Route → EVA workday: start time, duration, breaks per walking hour and safety reserve. These are **assumptions** (NASA lists these parameters as open knowledge gaps).
   - The briefing shows how many sols the traverse takes (≈ 5 on foot with the default values) and explains why it is not 3. The estimate and the simulation use the same speed. Details in `docs/EVA_WORKDAY.md`.
   - Default mobility: **on foot in a suit**; the pressurized rover remains available.
6. **Collaboration between astronauts:**
   - A finding or an alert (slope or radiation) from one explorer reaches the others as a zone on the map, a marker and a message in their logbook. **Each one keeps their own separate trip.**
   - Persistence: `localStorage` (two tabs notify each other instantly, also over file://) and, with a backend, SQLite (`notice` table) plus events in JSONL. Details in `docs/COLLABORATION.md`.
7. **Hard constraints and life support:** verified pressurized shelter at the end of the path (rejection if the distance to the shelter > 1 km); O₂ and battery on foot measured **per workday** (the suit is recharged every night: assumption).
8. **3D planetary relief:**
   - **3D Relief** of the study frame, with the base map and the active layer as texture. It works over file://: the base maps travel as `data:` URIs in `web/data/basemaps_data.js` (loaded on demand), because the browser does not allow an image read from a file to be used as a WebGL texture.
   - **3D Planet** (`mars-3d-terrain` engine): NASA Mars Trek MOLA tiles with level-of-detail zoom. It needs internet or the backend; without them the procedural fallback relief remains. Over file:// the console may show CORS blocks for NASA tiles that do not exist.
9. **MDA weather network and replanning:** simulated stations (`MDA-GALE-01` to `MDA-GALE-22`) and a demonstration scenario (storm at `MDA-GALE-14`, sol 1, 11:30 LTST) with one-click replanning.
10. **SQLite persistence:** `mars_route.sqlite` (`report`, `finding`, `message`, `explorer`, `mission`, `notice`). The user interface is in English.

### Tests

**Python** (backend, model and notices):

```bash
python scripts/plan_route.py              # once: generates outputs/traversability.npy (ignored by git)
python -m pytest tests/test_smoke.py tests/test_notices.py
```

**Browser** (Playwright; opens `web/index.html` over file://, without a server, except for the backend test):

```bash
pip install playwright                    # uses the installed Edge/Chrome; it does not download browsers
python tests/run_web_tests.py             # all (≈ 3 min)
python tests/run_web_tests.py e2e fase4   # only some
```

| Test | What it checks |
|---|---|
| `web_fase1.py` | radiation layer and indicator, critical alert, pause and return to shelter |
| `web_fase2.py` | confidence layer, limitations, route comparison |
| `web_fase3.py` | configurable workday; the full simulation matches the estimate |
| `web_fase4.py` | shared notices without a server and with a backend (SQLite + JSONL) |
| `web_e2e.py` | full traverse: file://, 2D/3D, critical alert, shared finding and summary |

All of them require **zero console errors**.

### Data regenerated with scripts

```powershell
python scripts\build_layers.py        # data/processed/layers.npz (ignored by git)
python scripts\export_uncertainty.py  # model confidence → web/data/uncertainty_data.js
python scripts\export_basemaps.py     # base maps as data: URI → web/data/basemaps_data.js
```

### Documentation

| Document | Content |
|---|---|
| `docs/SOURCES_NOTES.md` | what each source contributes, licenses and assumptions table |
| `docs/MODEL_LIMITATIONS.md` | rover versus astronaut, biases and model confidence |
| `docs/EVA_WORKDAY.md` | walking speed, EVA workday and how many sols the traverse takes |
| `docs/COLLABORATION.md` | shared notices, API, persistence and limits |

## Structure

```
config/mission.yaml            mission parameters
config/regions/                regional configurations (Gale and Jezero)
config/route_profiles.yaml     multi-criteria profiles and hard constraints
data/simulated/                MDA weather alert scenario
src/marsroute/                 geometry, layers, model, planner, evaluation, domain and SQLite store
backend/server.py              multithreaded HTTP/JSON server (MARS_DATA_DIR variable for another data folder)
backend/schema.sql             SQLite schema (report, finding, notice, etc.)
backend/docstore.py            JSONL store (telemetry, targets, events)
web/index.html                 main web interface
web/css/app.css                responsive and accessible styles
web/js/core.js                 data, geometry, A*, weather, radiation and EVA workday
web/js/app.js                  expedition flow, simulation, alerts and interface
web/js/shared.js               notices shared between explorers
web/js/map2d.js, scene3d.js, globe3d.js   2D map, 3D relief and 3D Planet
web/js/api.js, charts.js       backend client and charts
web/data/                      data as scripts (mars_data.js, uncertainty_data.js, basemaps_data.js…)
scripts/download_data.py       layer download and cropping
scripts/build_layers.py        layer grid construction
scripts/prepare_rems.py        REMS parsing to CSV
scripts/train_model.py         training and metrics
scripts/plan_route.py          cost, A* and evaluation
scripts/make_maps.py           maps and environmental summary
scripts/export_web.py          exports layers, routes and targets for the web
scripts/export_uncertainty.py  model confidence (disagreement between trees)
scripts/export_basemaps.py     base maps as data: URI for the 3D relief
tests/                         Python and browser tests (see «Tests»)
docs/                          prototype documentation
data/raw/                      original data
data/processed/                processed layers and CSV
models/                        trained model, metrics and uncertainty summary
outputs/                       route and evaluation in JSON
maps/                          figures
run_galex.sh / run_galex.bat   one-click start scripts
```

## Reproduction

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python scripts\download_data.py
python scripts\build_layers.py
python scripts\prepare_rems.py
python scripts\train_model.py
python scripts\plan_route.py
python scripts\make_maps.py
```

`download_data.py` downloads a 632 MB THEMIS mosaic to `data/cache/` (ignored by git) and crops it to the study area. The raw REMS TAB files (22 MB each) are also excluded from the repository; `prepare_rems.py` converts them into compact CSVs.

## Limitations

- The model was trained on a single 19 km corridor; the summit is 47 km away and falls outside the training distribution, which is why the probability is not used as a veto.
- Negatives are sampled only in dangerous cells, so the model ranks relative risk, not absolute traversability.
- CRISM spectral coverage is partial (6.4 % of the area) and the hydrated-mineral detections are point-like.
- The 44 m grid does not resolve individual rocks or dunes: the Bagnold field is crossed along its southern edge.
- REMS covers two sols, without representing all Martian seasons.
- The cost is static: it does not model dust, visibility or suit energy.
- Traversability was learned from a rover's traverse, not from an astronaut in a suit, and the traverse was chosen by science, not by ease of passage (`docs/MODEL_LIMITATIONS.md`).
- Radiation, the EVA workday (08:00–17:00, breaks, reserve) and suit consumption are **simplified models with assumptions** labeled as such; no EVA figure has official backing (`docs/SOURCES_NOTES.md`, `docs/EVA_WORKDAY.md`).
- There is no identity or permissions between explorers: any client can publish a notice as any astronaut (`docs/COLLABORATION.md`).

## Credits

NASA/JPL/University of Arizona (HiRISE), Arizona State University (THEMIS, JMARS), NASA Mars Trek, NASA PDS Atmospheres Node (REMS), USGS Astrogeology.
