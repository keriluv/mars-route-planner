# GaleX technical plan

## 1. Project identification

- **Category:** climate mapping, route planning and exploration support.
- **Product:** interactive web application, offline-first.
- **Event:** NASA Space Apps Challenge.
- **MVP delivery:** November 15, 2026, 11:59 p.m. (America/Bogota).
- **Team:** 6 people.
- **Language:** Spanish by default, with a selector to English.

## 2. Executive summary

GaleX will be a decision-support prototype for human and robotic exploration of Mars. The application will integrate topographic, environmental and scientific layers from NASA missions with simulated information from automatic weather stations distributed over a Martian grid.

The astronaut will be able to select a starting point, one or several scientific targets and a final shelter. The system will propose alternative routes —safe, fast and scientific— considering slope, terrain characteristics, time, energy, oxygen, temperature, radiation and shelter availability. Mission operators and scientists will be able to inspect the same conditions, routes, alerts and reports.

GaleX is a **scientific and technological demo**, not a system certified for human operations. All displayed information must identify its provenance as `OBSERVED`, `DERIVED` or `SIMULATED`.

## 3. Problem

A walk or robotic traverse on Mars requires combining information that is normally separate:

- relief, slope and roughness;
- temperature, pressure, wind, humidity and dust;
- UV and ionizing radiation;
- the explorer's mobility capacity;
- oxygen, energy, EVA time and emergency reserves;
- scientific targets, minerals and places previously observed by rovers;
- reachable shelters or safe points.

A short route can be unfeasible because of slope, unstable terrain, temperature, radiation or lack of reserves. GaleX will organize these variables in a common view and explain why it recommends or rejects each alternative.

## 4. General objective

Build an offline-first web MVP that integrates Martian data by layers and generates explainable routes for astronauts and rovers, working offline, with multiple regions and simulation of environmental changes through MDA stations.

## 5. Specific objectives

1. Visualize Gale Crater and Jezero Crater through layered maps and a 2.5D topographic view.
2. Allow selecting the start, one or several targets and a final shelter.
3. Generate alternative routes with safe, fast and scientific priorities.
4. Apply hard constraints on slope, resources, temperature, radiation and reach to shelters.
5. Represent oxygen, energy, EVA duration and accumulated dose as consumable resources.
6. Simulate observations from MDA stations over a Martian grid.
7. Replay NASA historical data as an accelerated time sequence.
8. Issue short alerts with detail, cause, threshold, affected section and recommended action.
9. Record discoveries, coordinates, routes and reports in a local logbook.
10. Preserve the current Gale prototype as a reproducible baseline.

## 6. Users and roles

### 6.1 Astronaut

- plans and executes excursions;
- selects targets and priorities;
- consults resources, risks and shelters;
- receives alerts and alternatives;
- records discoveries and observed conditions.

### 6.2 Mission operator

- monitors position, route, resources and alerts;
- reviews the logbook;
- prepares data packages for synchronization;
- analyzes deviations between planned and executed routes.

### 6.3 Scientist

- consults layers and instruments;
- filters targets by material or scientific interest;
- reviews reports and coordinates;
- evaluates the provenance and uncertainty of the data.

## 7. MVP regions

### 7.1 Gale Crater

It will be the most complete scenario because the repository already contains:

- DEM and derived layers;
- Curiosity traverse;
- REMS data;
- THEMIS, Viking, CRISM and mineral detections;
- baseline model and A* planning;
- maps, metrics and reference route.

The Bradbury Landing–Mount Sharp route will be kept as a technical example, not as a recommended EVA mission.

### 7.2 Jezero Crater

It will be the second MVP scenario to demonstrate the multi-region architecture. Depending on local availability and implementation time, it will integrate:

- Perseverance traverse and places;
- topographic and visual context of Jezero;
- MEDA observations;
- PIXL, SHERLOC or SuperCam targets;
- simulated shelters and MDA stations.

Targets associated with minerals, habitable environments or possible biosignatures will be shown as **places of scientific interest**, never as confirmed evidence of microbial life.

## 8. Grid and MDA stations

In GaleX, **MDA** is the project's name for hypothetical automatic weather stations. Their purpose is to measure local conditions and transmit them to a satellite or communications node. It will not be claimed that this network currently exists on Mars.

![Proposed Mars grid](image-2.png)

![Visual reference of an MDA station](image-3.png)

### 8.1 Grid model

- Each region is divided into identifiable cells.
- The conceptual design proposes one MDA for each cell of the grid.
- The MVP may instantiate only a representative sample of stations to keep the demonstration executable within the deadline.
- Each MDA is represented as a georeferenced point within its cell.
- An inactive or not-yet-simulated station will be shown as `NO DATA`; derived estimates will never silently replace an observation.
- The visual resolution will not be confused with the real resolution of the instruments.

### 8.2 Proposed MDA variables

- air and ground temperature;
- atmospheric pressure;
- wind speed and direction;
- relative humidity;
- dust opacity and concentration;
- UV radiation;
- ionizing radiation or estimated dose, when a valid source exists;
- station status, Martian date, quality and uncertainty.

### 8.3 Provenance states

| State | Meaning | Example |
|---|---|---|
| `OBSERVED` | Measured by a real instrument | REMS, MEDA, RAD |
| `DERIVED` | Computed from observations | slope, roughness, energy cost |
| `SIMULATED` | Generated for the demo | messages from a hypothetical MDA |

## 9. Information layers

### 9.1 Terrain

- elevation;
- slope;
- roughness;
- shadows and optical context;
- blocked zones;
- distance to shelters and stations.

### 9.2 Environment

- temperature;
- pressure;
- wind;
- humidity;
- dust and visibility;
- UV radiation;
- ionizing radiation and accumulated dose.

![Thermal map reference](image.png)

![Wind visualization reference](image-1.png)

### 9.3 Science

- hydrated minerals;
- spectral coverage;
- PIXL, SHERLOC and SuperCam targets;
- photographs linked to coordinates;
- places of geological or astrobiological interest;
- reported samples and discoveries.

### 9.4 Operation

- current position;
- start, destinations and final shelter;
- planned route and traveled route;
- remaining resources;
- active alerts;
- MDA stations and communication status.

## 10. Data and sources

### 10.1 Current and planned sources

| Region/scope | Source | Use |
|---|---|---|
| Global/regional | NASA Mars Trek | DEM, images, traverses and context layers |
| Global/regional | MRO MARCI/MCS | dust and regional weather context |
| Gale | Curiosity/REMS | local temperature, pressure, humidity and UV |
| Gale | Curiosity/RAD | ionizing radiation and dose |
| Gale | Curiosity traverse | mobility reference |
| Jezero | Perseverance/MEDA | wind, temperature, pressure, humidity, dust and optical radiation |
| Jezero | Rover PLACES | rover position and traverse |
| Jezero | PIXL/SHERLOC/SuperCam | scientific targets and composition |
| Spectral | CRISM/OMEGA | minerals and spectral coverage |
| Simulation | Hypothetical MDAs | environmental updates of the demo |

### 10.2 Official resources

- [NASA Mars Trek](https://trek.nasa.gov/mars/)
- [NASA Planetary Data System - Atmospheres](https://pds-atmospheres.nmsu.edu/)
- [NASA Planetary Data System - Geosciences](https://pds-geosciences.wustl.edu/)
- [Perseverance instruments](https://science.nasa.gov/mission/mars-2020-perseverance/science-instruments/)
- [Curiosity instruments](https://science.nasa.gov/mission/msl-curiosity/science-instruments/)
- [Mars Reconnaissance Orbiter instruments](https://science.nasa.gov/mission/mars-reconnaissance-orbiter/science-instruments/)
- [USGS Astrogeology - Mars maps](https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars)
- [Perseverance raw images](https://mars.nasa.gov/mars2020/multimedia/raw-images/)

Raw images will be used as visual evidence linked to coordinates. The identification of materials must come from structured scientific products, not just photographs.

## 11. Safety and scientific communication principles

1. Use **recommended route** and not **route guaranteed as safe**.
2. Show units, date, region, instrument and provenance.
3. Do not directly interpolate conditions between Gale and Jezero.
4. Do not present UV as equivalent to ionizing dose.
5. Do not present a simulated MDA as deployed infrastructure.
6. Do not present an astrobiological zone as proof of life.
7. Mark the MVP thresholds as demonstrative and not certified.
8. Include uncertainty or confidence level whenever possible.

## 12. Hybrid and explainable planner

### 12.1 Hard constraints

A route will be invalid if at least one critical condition occurs:

- slope above the limit of the mobility profile;
- blocked terrain or cell;
- insufficient oxygen or energy to reach the next shelter;
- EVA duration above the configured maximum;
- temperature outside the allowed range;
- radiation dose above the budget;
- final destination that is not a valid shelter;
- absence of an emergency reserve.

The initial values will be configurable and marked as demonstration thresholds.

### 12.2 Soft costs

Among the valid routes a composite cost will be evaluated:

```text
cost = distance
     + terrain risk
     + energy consumption
     + thermal exposure
     + radiation dose
     + dust/wind exposure
     - scientific interest reward
```

The weights change according to the profile:

| Profile | Priority |
|---|---|
| Safe | lowest risk and highest reserve |
| Fast | shortest time and distance within limits |
| Scientific | highest target value without breaking limits |

### 12.3 Multiple targets

- **Manual order:** the astronaut defines the sequence.
- **Automatic order:** the system proposes the order considering distance, risk, resources, scientific priority and final shelter.
- The “nearest to farthest” order will be a heuristic, not a guarantee of optimality.

### 12.4 Role of machine learning

ML may estimate traversability, relative risk, anomalies or missing conditions. It may not override a hard constraint. Every prediction must indicate confidence, features used and training region.

## 13. Time simulation

The MVP will combine:

1. **Historical replay:** accelerated playback of NASA data stored locally.
2. **Simulated MDA events:** changes in wind, temperature, radiation, dust or station availability.
3. **Replanning:** recomputation when a condition invalidates or degrades the route.

The interface will show the sol, Martian time, playback speed and origin of each datum.

## 14. Alerts

### 14.1 Levels

- `INFO`: relevant change without immediate risk.
- `CAUTION`: condition close to the threshold.
- `CRITICAL`: invalid route or resource.

### 14.2 Content

The notification shows:

- title and short message;
- level and triggering variable;
- affected section or coordinates;
- observed value and threshold;
- origin and age of the datum;
- recommended action;
- alternative or button to replan.

## 15. Web application

### 15.1 Recommended technology

- **Scientific core:** Python and the existing `marsroute` package.
- **Web interface:** HTML5, CSS3, JavaScript (Vanilla / WebGL Three.js) and a lightweight Python server.
- **MVP map:** embedded raster and interactive relief; later evolution to MapLibre with local resources.
- **Persistence:** SQLite.
- **Exchange:** JSON, GeoJSON and ZIP packages with a manifest.
- **Configuration:** YAML per region and route profile.
- **Tests:** pytest.

### 15.2 Main views

1. **Exploration:** map, layers, grid and targets.
2. **Planning:** start, destinations, shelter and route profiles.
3. **Simulation:** Martian clock, MDA, resources and position.
4. **Alerts:** summary and detail.
5. **Reports:** discoveries, coordinates and attachments.
6. **Data:** provenance, instruments, date and uncertainty.
7. **Settings:** language, region, units and thresholds.

### 15.3 Offline-first

- All P0 functions operate without internet.
- Scenario data is packaged with the application.
- Actions are saved first in SQLite.
- Pending messages are stored in a local queue.
- Future synchronization may send and receive packages when the connection returns.

## 16. Minimum data model

| Entity | Main fields |
|---|---|
| `Region` | id, name, bbox, CRS, effective resolution |
| `GridCell` | region, row, column, geometry, layers |
| `MDAStation` | id, cell, position, status, variables |
| `Observation` | variable, value, unit, time, origin, quality |
| `ScientificTarget` | type, material, coordinate, priority, source |
| `Shelter` | position, capacity, resources, status |
| `ResourceState` | oxygen, energy, time, dose, reserve |
| `RouteRequest` | region, start, targets, shelter, profile |
| `RouteAlternative` | geometry, metrics, alerts, explanation |
| `Alert` | level, variable, threshold, section, action |
| `Report` | author, type, coordinate, text, attachments, synchronization status |

## 17. Logical architecture

```text
Observed NASA data ────┐
                       ├─> Catalog and normalization ─> Regional layers ─┐
Simulated MDAs ────────┘                                                 │
                                                                         ├─> Hybrid planner
Astronaut state ─> Resources and limits ─────────────────────────────────┘
                                                                                  │
                                                                                  v
Web application <─ Alerts / explanation / routes <─ Results and metrics
          │
          └─> Local SQLite ─> synchronization queue / package export
```

## 18. Proposed repository organization

```text
web/                          web client interface and 3D viewer
config/regions/               Gale and Jezero
config/route_profiles.yaml    safe, fast and scientific
data/regions/                 regional packages
data/simulated/               MDA scenarios and messages
src/marsroute/                current core preserved and extended
src/marsroute/domain.py       domain contracts
src/marsroute/environment.py  environmental state and replay
src/marsroute/resources.py    consumption and reserves
src/marsroute/multicriteria.py hybrid planning
src/marsroute/alerts.py       rules and explanation
src/marsroute/storage.py      SQLite and logbook
tests/                        unit and integration tests
```

The final structure will be implemented without removing the current baseline until equivalence is validated.

## 19. MVP acceptance criteria

The MVP will be acceptable for the demonstration if it:

1. starts without internet on Windows and Linux;
2. allows switching between Gale and Jezero;
3. shows grid, layers, targets, shelters and MDA stations;
4. allows selecting start, multiple targets and final shelter;
5. supports manual and automatic target ordering;
6. generates safe, fast and scientific alternatives;
7. rejects a mission that violates a hard constraint;
8. shows estimated oxygen, energy, time and radiation;
9. replays an environmental scenario and generates at least one replanning;
10. explains each alert and distinguishes observed, derived and simulated data;
11. keeps reports after closing the application;
12. allows switching between Spanish and English;
13. keeps the current Gale route as a comparison baseline.

## 20. Scope excluded from the MVP

- operational or medical certification;
- real Earth-Mars communication;
- truly live data from Mars;
- deployed physical MDA network;
- high-resolution environmental coverage for all of Mars;
- validated global climate prediction;
- detection or confirmation of microbial life;
- advanced authentication or production multi-user synchronization;
- mathematical guarantee of the best global route under all variables.

## 21. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Deadline under two days | minimal vertical slice, parallel work and early freeze |
| Jezero without a full pipeline | reduced package and multi-region contracts |
| Confusing simulation with observation | mandatory provenance labels |
| Uncertified human thresholds | demonstrative configuration and visible warning |
| A* performance | regional cropping, cache and adaptive resolution |
| Network dependencies | packaged datasets and offline mode |
| Late integration | stable data contract and continuous smoke tests |

## 22. Product decision

For the immediate delivery, GaleX will prioritize a story that can be demonstrated from start to finish:

> The astronaut opens GaleX offline, selects Gale or Jezero, chooses targets and a shelter, compares three routes, starts an environmental replay, receives an alert from a simulated MDA, observes resource consumption, replans the route and logs a discovery that is saved locally.

The concrete execution is detailed in [Phased_Planning.md](Phased_Planning.md).
