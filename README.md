# Mars Route Planner — Mount Sharp, Gale Crater

Base Python model that integrates orbital data layers of Mars and computes a safe route from Bradbury Landing to the summit of Mount Sharp (Aeolis Mons), Gale Crater. Project for the NASA Space Apps Challenge 2026.

![Computed route](maps/route_map.png)

## Study Area

| Parameter | Value |
|---|---|
| Site | Gale Crater, Mount Sharp massif (Aeolis Mons) |
| Bounding box | 137.18 °E – 138.08 °E, 5.45 °S – 4.55 °S |
| CRS | Mars 2000 planetocentric (EPSG:104905) |
| Extent | 53.1 km × 53.3 km |
| Grid | 1200 × 1200 cells (44.3 m × 44.5 m) |
| Start | 137.4416 °E, 4.5895 °S (Bradbury Landing, −4503 m) |
| Goal | 137.8599 °E, 5.3709 °S (summit, +830 m) |
| Elevation gain | +5 333 m |

The summit of the massif lies at the southern end of the area: the 200 m DEM places it at 137.86 °E, 5.37 °S at 832 m, about 5.3 km above the crater floor. The area includes the landing corridor, the Bagnold dune field and the northern, western and southern flanks of the mound.

## Data Layers

| Layer | Type | Product | Resolution | Source |
|---|---|---|---|---|
| `dem` | Topographic | MOLA/HRSC blended DEM `Mars_MOLA_blend200ppx_HRSC_DEM` | 200 m | NASA Mars Trek |
| `slope`, `roughness` | Topographic | DEM derivatives | 44 m | Own computation |
| `optical` | Optical | MOLA/HRSC color shaded relief `..._ClrShade_200mpp` | 200 m | NASA Mars Trek |
| `texture`, `gradient` | Optical | Relief derivatives | 44 m | Own computation |
| `thermal` | Thermal | THEMIS Day IR 100 m | 100 m | ASU JMARS |
| `color_index` | Multispectral | Viking MDIM 2.1 color | 232 m | NASA Mars Trek |
| `spectral_coverage` | Spectral | CRISM MTRDR footprints (FRT sites) | vector | NASA Mars Trek |
| `mineral_distance` | Spectral | Hydrated OMEGA/CRISM detections | points | NASA Mars Trek |
| `traverse_distance` | Reference | Curiosity traverse (19,188 points) | 44 m | NASA Mars Trek |
| REMS | Atmospheric | ENVRDR sol 100 and sol 4488 | 1 s | NASA PDS |

Six data types overlap on the same grid: topographic, optical, thermal, multispectral, spectral and atmospheric. CRISM MTRDR coverage spans only 6.4% of the area (western flank, product `FRT0000A091_07_IF165J_MTR3`). There is one hydrated-mineral detection OMEGA/CRISM on the western edge of the box (137.20°E, 5.00°S) and another outside, to the east.

![Layers](maps/layers_overview.png)

## Base Model
Random-forest classifier trained with Curiosity's real traverse as the positive label.

- Positives: cells within ≤ 60 m of the traverse (995 samples).
- Negatives: cells > 200 m from the traverse with slope > 15° or optical texture above the 75th percentile (995 samples).
- Variables: slope, roughness, optical texture, optical gradient and thermal. Optical albedo and color index are excluded as predictors because their calibration changes with illumination and dust cover between the landing corridor and the massif; they remain as context layers.
- Forest of 300 trees, depth 12, minimum 5 samples per leaf, balanced classes.
- Spatial 70/15/15 split by progress along the traverse, not random, to avoid information leakage.

| Set | Samples | Positives | ROC AUC | Average precision | F1 |
|---|---|---|---|---|---|
| Test | 928 | 184 | 0.913 | 0.715 | 0.498 |

Relative importance: roughness 0.45, slope 0.43, optical texture 0.08, optical gradient 0.03, thermal 0.01.

## Route Planning
The traversability probability `p` is converted into a per-cell cost:
```
cost = 1 + 4·(1 − p)² + 3·slope_penalty²
```
Cells with slope > 20° are blocked, with a 2-cell (89 m) margin. The route is computed with 8-neighbor A* over 1.44 million cells and simplified with Douglas-Peucker (tolerance 1.5 cells).

The hard probability threshold is 0: the model was trained on a 19 km corridor next to the landing site and does not certify terrain 47 km away, so probability acts on cost and the hard veto stays on slope.

## Results

| Metric | Learned model | Slope-only reference |
|---|---|---|
| Length | 72.0 km | 59.0 km |
| Mean slope | 5.6° | 7.5° |
| Max slope | 18.0° | 16.6° |
| Mean roughness | 8.8 m | 11.8 m |
| Mean traversability | 0.67 | 0.34 |
| Traverse-like terrain | 64 % | 21 % |
| Expanded cells | 1,121,787 | 466,324 |

The learned route travels 13 km more than the reference, but doubles the mean traversability and triples the fraction of the traverse over terrain comparable to what Curiosity already crossed. The reference cuts diagonally across the northern flank of the massif; the learned route skirts the mound to the west, crosses the plain south of the dune field and ascends the southern slope to the summit.

![Comparison](maps/route_comparison.png)

![Profile](maps/route_profile.png)

![3D view](maps/route_3d.png)

![Integrated view](maps/integrated_view.png)

## Atmospheric Conditions
REMS records the diurnal cycle at two mission moments: air temperature between 207 and 273 K on sol 100 and between 194 and 254 K on sol 4488, mean pressure 840–843 Pa, and maximum humidity 6% and 23% respectively. Peak UV radiation drops from 16.6 to 7.8 W/m² due to the higher dust load.

![REMS](maps/rems_environment.png)

## Interactive Web Application — GaleX
GaleX is a **100% web, offline-first** application with a local Python backend for predictive planning and interactive EVA simulation on Mars.

### Quick Start in One Step
- **Linux / macOS:**
  ```bash
  ./run_galex.sh
  ```
- **Windows:**
  ```bat
  run_galex.bat
  ```
- **Manual (any platform):**
  ```bash
  python3 backend/server.py
  # Open http://127.0.0.1:8000 in your browser
  ```

### GaleX Features
1. **Multi-region (Gale and Jezero):**
   - **Gale Crater (Curiosity / MSL):** 1200 × 1200 cell mosaics (44 m/cell), deterministic Random Forest, 12 raster layers, Bradbury Landing and Mount Sharp Base shelters.
   - **Jezero Crater (Perseverance / Mars 2020):** georeferenced bounding box, Octavia Butler Landing and Delta Front shelters, with scientific-honesty labeling (`NOT AVAILABLE` on locally uncovered layers).
2. **Three multi-criteria route profiles:**
   - **Safe:** minimizes environmental risk, slopes > 15°, and requires O₂ reserve > 20% upon reaching a verified shelter.
   - **Fast:** minimizes EVA exposure time via Tobler kinematics ($v = 6 \cdot e^{-3.5|grade+0.05|} \cdot 0.55$).
   - **Scientific:** maximizes visits to geological targets (CRISM, hydrated minerals, lacustrine sediments).
3. **Hard constraints and life support:**
   - Mandatory verified pressurized shelter at the end of the traverse (automatic rejection if shelter distance > 1.0 km).
   - Real-time monitoring of O₂ consumption, battery (pressurized rover vs. EVA suit) and accumulated ionizing radiation dose.
4. **Planetary 3D relief (engine `mars-terreno-3d`):**
   - Planetocentric coordinates ($X = lon$, $Z = -lat$, $Y = elev \cdot exag / 59200$).
   - Dynamic streaming of NASA Mars Trek WMTS MOLA tiles with level-of-detail zoom (LOD 0–6).
   - Offline contingency mode: procedural FBM relief + hypsometric ramp + local Gale DEM sampling.
   - Kinematic `flyTo` controls for Gale, Jezero, Olympus Mons, Valles Marineris and Global view.
5. **MDA weather network and replanning:**
   - Network of simulated weather stations (`MDA-GALE-01` to `MDA-GALE-22`).
   - Demonstrative scenario Sol 1 (11:30 LTST): wind storm (28.4 m/s) and opacity ($\tau = 2.15$) at `MDA-GALE-14` (Bagnold Dunes) with explainable alert and one-click replanning.
6. **SQLite persistence and bilingual support:**
   - Relational database `mars_route.sqlite` (`report`, `finding`, `message`, `explorer`, `mission`).
   - Language toggle button Spanish (ES) / English (EN).

### Smoke Tests and Verification
```bash
python3 -m pytest tests/test_smoke.py
```
Runs 7 exhaustive tests validating domain contracts, Gale and Jezero configuration consistency, multi-criteria profiles, SQLite persistence, simulated scenario and route computation with shelter constraints.

## Structure
```
config/mission.yaml          mission parameters
config/regions/              regional configurations (Gale and Jezero)
config/route_profiles.yaml   multi-criteria profiles and hard constraints
data/simulated/              MDA meteorological alert scenario
src/marsroute/domain.py      domain models and data contracts
src/marsroute/multicriteria.py multi-criteria A* planner and resources
src/marsroute/storage.py     relational SQLite store
backend/server.py            multithreaded HTTP/JSON server
backend/schema.sql           SQLite schema (report, finding, etc.)
web/index.html               main web interface
web/css/app.css              responsive and accessible styles
web/js/scene3d.js            3D relief engine with MOLA tiles
web/js/app.js                interface controller, simulation and alerts
web/js/core.js               support algorithms and speed models
tests/test_smoke.py          smoke test suite
run_galex.sh / run_galex.bat one-click startup scripts
```
```
scripts/download_data.py     data download and clipping
scripts/build_layers.py      layer grid construction
scripts/prepare_rems.py      REMS parsing to CSV
scripts/train_model.py       training and metrics
scripts/plan_route.py        cost, A* and evaluation
scripts/make_maps.py         maps and environmental summary
src/marsroute/               geometry, layers, model, planner, evaluation
data/raw/                    original data
data/processed/              layers and processed CSVs
models/                      trained model and metrics
outputs/                     route and evaluation in JSON
maps/                        figures
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

`download_data.py` downloads a 632 MB THEMIS mosaic to `data/cache/` (git-ignored) and clips it to the study area. Raw REMS TAB files (22 MB each) are also excluded from the repository; `prepare_rems.py` converts them into compact CSVs.

## Limitations
- The model was trained on a single 19 km corridor; the summit is 47 km away and lies outside the training distribution, so probability is not used as a veto.
- Negatives are sampled only in dangerous cells, so the model ranks relative risk, not absolute traversability.
- CRISM spectral coverage is partial (6.4% of the area) and hydrated mineral detections are point-like.
- The 44 m grid does not resolve individual rocks or dunes: the Bagnold field is crossed along its southern edge.
- REMS covers two sols, not all Martian seasons.
- Cost is static: it does not model dust, visibility or suit energy.

## Credits
NASA/JPL/University of Arizona (HiRISE), Arizona State University (THEMIS, JMARS), NASA Mars Trek, NASA PDS Atmospheres Node (REMS), USGS Astrogeology.