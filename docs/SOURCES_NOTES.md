# Source notes — what each input contributes and what can be reused

Status: Phase 0 (input review). Last review: 2026-11-15.

## How it was reviewed

- The inputs are **not inside the repo**: they live in `Nasa_Challenge/Fuentes/` (a sibling folder of the project). They were read there, without copying them into the repo.
- The PDFs were read through their text layer (`pdftotext`). **Figures, image tables and margin notes were not interpreted**: if a figure appears only in an image, it is not captured here.
- `SPOC-master.zip` and `spoc_lite-master.zip` were extracted to a temporary folder outside the repo and inspected without running anything.
- `Fuentes/Codes/` also contains `ISIS3-dev.zip` and `open-source-rover-master.zip`. They were not in the task list and **were not read**.
- The PDF «Base interaction flow» (UX rules) is **not** in the repo or in `Fuentes/`. The UX rules that apply are those given in the task statement (at most 5 live readings, each with a "?" and a source, lightly loaded panels).

## Summary by input

| Input | What it is | Phases it supports | Reusable? |
|---|---|---|---|
| Simonsen (NASA HQ, 6 Aug 2024) | Presentation on the Martian radiation environment and health risks | 1 | Citable figures (with source). No code. |
| Tasoula et al., *Space Radiation Book Chapter* | Book chapter on space radiation and health | 1 | Citable figures and limits. No code. |
| Nelson (NASA, 14 Oct 2021), *Beyond Artemis III – EVA Gap* | Summary of EVA technology gaps | 3 (qualitative framework only) | No operational figures. |
| Bennett et al. 2023 (JGR Planets) | Curiosity's Glen Torridon campaign | 2 | Only as a citation. Restrictive license. |
| Brown et al. 2024 (JOSS 07256) | Article on the `pdr` library (PDS data reader) | Optional, scripts | Tool idea; the software license is not in the article. |
| SPOC-master.zip | SPOC website (HTML/CSS/images) | 2 (concepts only) | **No** (no code, no license). |
| spoc_lite-master.zip | C++/ROS sand classifier | 2 (concepts only) | **No** (license "TODO", no LICENSE). |

## 1. Simonsen — *The Martian Radiation Environment and Human Health Risks* (NASA HQ, 6 Aug 2024)

Presentation for the National Academies panel *A Science Strategy for the Human Exploration of Mars*. It is agency material, publicly accessible. It is cited by slide title (the extracted text does not keep the numbering).

**Values that can be cited** (all with their slide):

| Datum | Value | Slide |
|---|---|---|
| Equivalent dose rate on the surface of Mars | ≈ 0.65 mSv/day, similar to the ISS | *Comparison of Radiation Exposures & Environments* |
| MSL-RAD on the Gale floor (23 g/cm² of CO₂), 2012–2017 | ≈ 0.64 mSv/day (0.21 mGy/day); in transit 1.7 mSv/day | *MSL RAD measured Dose Rates* |
| Atmosphere column at Gale | ≈ 21–23 g/cm² (≈ 1000 g/cm² on Earth) | *Interaction of free space radiation…* |
| GCR (galactic cosmic rays) | ~89 % protons, ~10 % He, ~1 % heavy nuclei; hard to shield | *Space Radiation Environment* |
| Solar cycle | Solar maximum: higher probability of SPE and less GCR (≈ 50 % less effective GCR dose) | *Space Radiation Environment*, *GCR Shielding* |
| SPE (solar particle events) in MSL-RAD | The dose rate jumps ×10 to ×100 in transit, but contributes only ≈ 5 % of the total dose of the trip | *MSL RAD measured Dose Rates* |
| Permissible effective dose limit for an SPE | 250 mSv | *Solar Particle Events – Requirements & Design Guidance* |
| Estimated dose from a large SPE on the Martian surface | ≈ 40 mSv unshielded; ≈ 25 mSv with a 10 cm water-equivalent shelter (reference spectrum: sum of the Oct 1989 events) | same |
| Career limit | 600 mSv | *Risk Posture for Mars Demo Mission* |
| Lunar excursions (Artemis, 30 days) | 40–60 mSv | *Comparison of Radiation Exposures…* |
| Declared gap | SPE forecasting and independent monitoring from Earth remain a shortcoming | *Space Radiation Protection Gaps* |

**What it contributes to the project:** the base GCR rate on the surface and the scale of the SPE risk, with official limits to set the warning and critical thresholds.

**Limits of the source:** these are average values measured on the crater floor, not a dose per hour, per elevation, or inside an EVA suit. No datum here makes it possible to compute the dose of an astronaut in a suit on a specific slope.

## 2. Tasoula et al. — *Health Impacts of Radiation in Space and Countermeasures* (book chapter)

Co-author: Gregory A. Nelson (NASA JSC, CNS discipline of the space radiation element). The PDF carries no year or publisher; it cites literature up to 2025. **The license does not appear in the text**: it can be cited, but its content cannot be copied or redistributed until it is confirmed.

**Values that can be cited:**

| Datum | Value |
|---|---|
| MSL-RAD (Zeitlin et al. 2013) | 1.84 mSv/day in transit and 0.7 mSv/day on the surface |
| Martian atmosphere | 15–25 g/cm² depending on topography; it stops a good part of the SPE, but almost none of the GCR |
| SPE and EVA | Protons > 30 MeV pass through EVA suits and can cause acute radiation syndrome (ARS) |
| Operational mitigation | Forecasting, real-time monitoring and delaying, aborting or cancelling the EVA; storm shelters |
| Natural shelters | «Natural geological structures can be used as shelter against intense SPEs» |
| NASA limits (cites NASA 2023) | Career: 600 mSv. SPE: effective dose < 250 mSv. Lens of the eye: 1000 mGy-Eq in 30 days and 4000 mGy-Eq over the career |
| ARS | Hematopoietic effects from ~1 Gy; the text describes prodromal, latent and manifest phases |
| Uncertainty | NASA's cancer risk model estimates a relative uncertainty of ≈ 260 % |

**Noted discrepancy:** 0.7 mSv/day (chapter, citing Zeitlin 2013) versus 0.64–0.65 mSv/day (Simonsen, citing Hassler 2014). They are compatible within the variability. The current code already uses `0.027 mSv/h` in EVA (`core.js:208`), which at 24 h gives 0.648 mSv/day, consistent with both figures.

**What it contributes:** the qualitative justification of the radiation alerts (why an EVA is the critical case and which actions to offer: pause, abort, return to shelter), and the idea that relief can provide shelter.

## 3. Nelson — *Beyond Artemis III: EVA Gap Update & Overview* (14 Oct 2021, STI 20210021737)

Public presentation by Chris Nelson (EVA Strategic Planning & Architecture Lead). No export restrictions.

**What it says (text):**
- More than 100 gaps affect EVA in the exploration architecture, ~88 of them in Mars EVA.
- Three kinds of gap: **knowledge** (unknown mission parameters that will set the requirements), **development** and **technology**.
- Four big development areas: mass reduction, suitport system, informatics (autonomy, communications, navigation, lighting) and systems for vacuum/partial atmosphere (CO₂, thermal).
- Artemis context: two crew members, 6.5 days on the lunar surface, up to four walks plus a fifth as a contingency reserve.

**What it does NOT say, and this matters for Phase 3:** it contains no EVA duration, walking pace, breaks or reserve margin in hours or consumables. The 08:00 to 17:00 workday and the adapted Tobler function **cannot be numerically justified with this document**.

**Honest use in Phase 3:** cite it for the *framework*: the parameters of EVA on Mars are open knowledge gaps, which is why the workday, breaks and reserve are exposed as **configurable assumptions labeled as such**. The structure «planned walks + one reserve» serves as an analogy for the safety reserve, always stating that it is lunar, not Martian.

## 4. Bennett et al. 2023 — *The Curiosity Rover's Exploration of Glen Torridon* (JGR Planets, 10.1029/2022JE007185)

**License: CC BY-NC-ND.** It can be cited and paraphrased with attribution, without commercial use and **without adapting or modifying** the text. Figures and tables are not copied.

**Facts that support Phase 2 (limits of using the rover's traverse as a label):**
- The Glen Torridon traverse was defined with **science waypoints** («identified by the science team in response to the overarching science questions»), not as the easiest path. The shape of the traverse reflects where the geology of interest was.
- Some waypoints are imposed by the terrain: the entrance to Glen Torridon is a cliff «for the most part not traversable by a rover», and the only safe descent point fixed the start of the section. The route to the sulfate unit had to go around the **Sands of Forvie** (ripple field).
- The rover reached a record inclination of **32.0°** when climbing the Greenheugh pediment scarp. This shows that the traverse contains sections steeper than the planner's 20° veto. It is a **rover inclination**, not a mean slope of a 44 m cell, and they cannot be directly compared.
- Rover operations requirements: to drill it needs a flat surface of at least 10 cm; the wheel tracks measure 40 cm.
- Total traverse up to sol 3072: 24.9 km and 430 m of ascent; within Glen Torridon ≈ 5 km.

**What the article does not cover** (must not be attributed to Bennett): EVA suits, human walking, falls, dust on the visor, fatigue. Those rover–astronaut contrasts are our own reasoning and must appear in `docs/` marked as **assumptions**, not as findings of the source.

## 5. Brown et al. 2024 — *PDR: The Planetary Data Reader* (JOSS 9(102), 7256)

- Article under **CC BY 4.0**. It can be reused with attribution.
- It describes `pdr`, a Python library that reads PDS3/PDS4 products (images as `ndarray`, tables as DataFrames). The code is not included; only the article.
- **The license of the `pdr` software is not in the article**. It must be verified in its repository before depending on it.
- Possible use (optional, not needed for the web): replace the manual parser in `scripts/prepare_rems.py` or read MSL-RAD PDS data to replace, with measurements, the dose figures taken from the presentations. It would require a new dependency and network downloads; **it will not be done without your approval**.

## 6. SPOC and SPOC-Lite (JPL/Caltech)

**`SPOC-master.zip`:** contains only the website (`index.html`, CSS, fonts, images and videos). **There is no classifier code.** Footer: «© 2020 California Institute of Technology». There is no license file.

**`spoc_lite-master.zip`:** C++/ROS sand classifier (Ubuntu 14.04, ROS Indigo, `catkin`) with SVM (`.model` models, LBP/DCT features). **All three `package.xml` files declare `<license>TODO</license>` and there is no `LICENSE`.** It includes a copy of third-party `libsvm.cpp` and `linearsvm/blas`.

**License decision: no SPOC or SPOC-Lite code is reused.** Without an explicit license, rights are reserved by default, and technically it does not fit either: it operates on rover camera images in ROS, not on orbital layers in JavaScript.

**Concepts that can be cited as context** (claims from the SPOC site, not verified by us):
- Rover mobility is very sensitive to terrain type; Spirit got trapped in sand and Opportunity and Curiosity also got stuck.
- SPOC-HiRISE classifies each HiRISE pixel into 17 classes at 25 cm and claims >90 % accuracy against human labels.
- AI4Mars gathered 10,000+ citizen labels on Curiosity NAVCAM images.
- SPOC-Lite delivers a sand probability with a configurable threshold (default 0.8): a design pattern comparable to the configurable threshold of our alerts.

**What it contributes to Phase 2:** our traversability model **has no sand/soil class**, only slope, roughness, optical texture, gradient and thermal. This must be stated in «Limitations and assumptions», because sand is the main documented risk for rovers.

## Observations about the repo that affect the following phases

They arose while reviewing `core.js`, `app.js` and the data. They are facts of the review, not changes made.

1. **There is no git repository** in the project folder, so commits per phase require `git init` first.
2. **Radiation already partly exists** (`core.js:208`): `radRate = 0.027 mSv/h` in EVA and `0.012 mSv/h` in rover. The EVA value is equivalent to ≈ 0.65 mSv/day (matches Simonsen). **The 0.012 one has no source** and must be marked as an assumption. Today it is only shown in the profile metrics panel (`app.js:350`).
3. **The live data panel already has exactly 5 cards** (Temperature, Slope, Traversability, UV, Pressure; `app.js:1823`). Adding radiation forces replacing or merging one.
4. **The workday is fixed in the code:** `EVA_START = 8`, `EVA_END = 17` (`app.js:24`), and the simulation advances at 2 Martian minutes per real second.
5. **The default mobility is `rover`** (`newTrip`, `app.js:30`) and `estimateHours` defaults to the rover speed (`core.js:173`). The briefing calls those hours «walking». In Phase 3 it must be checked whether the briefing hours come from the walking function or the rover one, before explaining why they come out as «4 to 5 sols».
6. **The web bundle only carries** `dem, slope, roughness, traversability, thermal, color_index, spectral, traverse_km, blocked`. **It does not include `texture` or `gradient`**, and `data/processed/layers.npz` is not in the repo (it is in `.gitignore`). `data/raw/` does contain the DEM, the optical image, THEMIS, Viking and the traverse. To measure uncertainty between trees (Phase 2), the layers must be regenerated with `scripts/build_layers.py` and `models/terrain_model.joblib` loaded (scikit-learn 1.8.0 is installed); it cannot be done with only what already travels to the web.
7. **Backend persistence:** SQLite already has `finding`, `message`, `mission` and `report`; the JSONL store (`backend/docstore.py`) handles telemetry and targets. It fits Phase 4 without changing the architecture.

## Table of assumptions pending labeling

| Assumption | Where | Status |
|---|---|---|
| EVA dose 0.027 mSv/h | `core.js` | Backed (≈ 0.65 mSv/day, Simonsen) |
| Rover dose 0.012 mSv/h (× 0.44 versus walking) | `core.js` (`MR.radiation.P.roverFactor`) | Labeled «assumption» in the interface (Phase 1) |
| EVA workday 08:00–17:00, breaks and reserve | `MR.eva` in `core.js` | Configurable and labeled «assumption» (Phase 3, `docs/EVA_WORKDAY.md`) |
| Suit factor 0.55, 0.35 for terrain and × 0.6 on steep sections | `core.js` (`walkSpeed`, `speedAt`) | No source → «assumption» (Phase 3) |
| O₂ 72 L/h, 576 L (8 h) for EVA; battery 12 kWh | `core.js:199–204` | No source → «assumption» |
| 20° slope veto | `core.js:134` | Planner design decision, not a measured limit |

## Phase 1 radiation model: what is source and what is assumption

Implemented in `MR.radiation` (`web/js/core.js`). The interface labels each parameter as SOURCE or ASSUMPTION in Conditions → Radiation.

| Parameter | Type | Origin |
|---|---|---|
| Base rate 0.65 mSv/day | Source | Simonsen 2024 (MSL-RAD, Gale floor); Tasoula et al. cite 0.7 |
| Reference atmosphere ≈ 23 g/cm² | Source | Simonsen 2024 |
| 20 % of the dose from albedo (not blocked by relief) | Source | Simonsen 2024 |
| Scale height 11.1 km | Prototype approximation | Already used for pressure in `MR.weather` |
| Sensitivity to elevation (+50 % with no atmosphere) | **Assumption** | Only the direction is supported |
| Shielding by visible sky of the DEM | **Assumption** | Simple geometry at 177 m per cell |
| Pressurized rover × 0.44 | **Assumption** | Inherited from the prototype |
| Solar event × 40 for 36 h | **Assumption** | Compatible with ×10–×100 measured in transit and with the 40 mSv unshielded reference |
| No dose inside the shelter | **Assumption** | Simplification |
| Alert threshold 5 mSv per workday | **Assumption** | Operational threshold of the app, not a NASA limit |

It only applies to Gale: in Jezero the base rate is used without adjustment for elevation or relief.
