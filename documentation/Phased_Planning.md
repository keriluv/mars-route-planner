# Phased planning of the GaleX prototype

## 1. Project constraints

- **Deadline:** Sunday, November 15, 2026, 11:59 p.m.
- **Time zone:** America/Bogota.
- **Available team:** 6 people.
- **Product:** interactive web MVP for modern browsers.
- **Operation:** offline-first.
- **Regions:** complete Gale and demonstrative Jezero.
- **Baseline:** keep the current prototype and its results.

This planning is an emergency delivery plan. The goal is not to complete the operational vision, but to demonstrate an end-to-end, scientifically honest traverse.

## 2. Expected result

At the end, the team must be able to demonstrate in under five minutes:

1. offline opening of the application;
2. selection of Gale or Jezero;
3. activation of layers and grid;
4. selection of start, targets and shelter;
5. comparison of safe, fast and scientific routes;
6. display of resources and explanations;
7. execution of an environmental replay;
8. simulated MDA alert and replanning;
9. creation of a persistent report;
10. Spanish/English language switch.

## 3. Priorities

### P0 - Mandatory for the delivery

- web application that runs offline;
- Gale and a Jezero selector;
- map with grid, layers, start, targets and shelter;
- three route profiles;
- demonstrative hard constraints;
- astronaut resources;
- replay and simulated MDA event;
- explainable alerts;
- SQLite persistence;
- basic Spanish and English;
- demo script and offline package.

### P1 - Important if P0 is stable

- automatic ordering of multiple targets;
- interactive 2.5D topographic view;
- structured MEDA/PIXL/SHERLOC data for Jezero;
- logbook export/import;
- detailed comparison between alternatives;
- uncertainty and age of observations.

### P2 - After the delivery

- network synchronization;
- automatic updating of PDS files;
- regional climate model;
- advanced multi-objective optimization;
- authentication and access control;
- global cartographic packages;
- integration with real MDA hardware.

## 4. Suggested team distribution

| Participant | Main front | Secondary responsibility |
|---|---|---|
| 1. Integration | architecture, contracts, merge and packaging | support for blockers |
| 2. Routes | constraints, costs, alternatives and resources | metrics and tests |
| 3. Data | Gale, Jezero, catalog and provenance | scientific targets |
| 4. Environment | replay, MDA, alerts and scenarios | REMS/MEDA/RAD data |
| 5. Web Frontend | web client interface, navigation and map | offline web optimization |
| 6. UX/QA | panels, i18n, logbook, tests and demo | documentation |

Each front must work on contracts agreed in Phase 1. The numbers identify owners by role; names can be associated later. Participant 1 (integration) decides on incompatible contract changes during the delivery period.

## 5. Branch and integration strategy

Before developing:

1. document the existing dirty state without overwriting it;
2. create a baseline reference point when the team authorizes the commit;
3. use short branches per front;
4. integrate small changes several times a day;
5. avoid a single integration at the end;
6. do not regenerate heavy data or models during demo packaging.

Suggested branches:

```text
feature/domain-routing
feature/data-regions
feature/environment-mda
feature/web-ui
feature/reports-i18n
```

## 6. Phase 0 - Scope freeze and baseline

**Maximum duration:** 60 minutes.

**Status:** closed. The baseline, board and script are documented in [Phase_0_Baseline_and_Scope.md](Phase_0_Baseline_and_Scope.md). Owners are identified by role as Participant 1 to 6.

### Tasks

- approve the P0/P1/P2 scope;
- assign owners by role as Participant 1 to 6;
- back up the current state;
- verify that the existing pipeline and Gale route still work;
- record hashes or versions of the demo artifacts;
- define the five-minute script before writing code.

### Deliverables

- identifiable baseline;
- task board with owners;
- preliminary script;
- closed list of P0 functions.

### Exit gate

Nobody starts a P1 function while a P0 task without an owner exists.

## 7. Phase 1 - Contracts, configuration and skeleton

**Maximum duration:** 2 hours.

### Tasks

- create minimal contracts for region, observation, MDA, target, shelter, resources, route request, alternative, alert and report;
- create separate configurations for Gale and Jezero;
- create safe, fast and scientific profiles;
- define the SQLite schema;
- integrate a web shell with local navigation;
- prepare a reproducible JSON MDA scenario;
- add smoke tests.

### Target files

```text
config/regions/gale.yaml
config/regions/jezero.yaml
config/route_profiles.yaml
src/marsroute/domain.py
src/marsroute/storage.py
web/index.html
data/simulated/demo_scenario.json
tests/test_smoke.py
```

### Exit gate

- the application opens;
- both regions load configuration;
- SQLite can save and read a report;
- all fronts can consume the same contracts.

## 8. Phase 2 - Regional data and catalog

**Maximum duration:** 4 hours, in parallel with Phase 3.

### Gale

- reuse existing layers and results;
- add a provenance catalog;
- add simulated shelters and MDA stations;
- link available REMS and RAD;
- keep the current route as a baseline.

### Jezero

- prepare a minimal package with bbox, image/relief, traverse and points of interest;
- add MEDA as a local environmental source;
- include some scientific targets with coordinates and source;
- add shelters and simulated MDAs;
- if a layer is missing, use a visible placeholder such as `NOT AVAILABLE`, do not invent observations.

### Deliverables

- Gale/Jezero selector;
- layer manifest per region;
- `OBSERVED/DERIVED/SIMULATED` catalog;
- loadable targets and shelters.

### Exit gate

The map can switch regions without modifying code and always shows the provenance of the layers.

## 9. Phase 3 - Hybrid planner and resources

**Maximum duration:** 5 hours, in parallel with Phase 2.

### Tasks

- separate hard constraints from soft costs;
- add astronaut and rover mobility profiles;
- incorporate oxygen, energy, time and dose;
- require a final shelter;
- compute the reserve to the next shelter;
- generate three alternatives through different weights;
- implement manual target ordering;
- implement simple automatic ordering as P1;
- produce a structured explanation per alternative;
- prevent ML from overriding hard constraints.

### Minimum tests

- blocked start or destination;
- insufficient oxygen;
- critical temperature;
- exceeded dose;
- destination without a shelter;
- valid route with reserve;
- verifiable differences between the three profiles.

### Exit gate

A route request returns alternatives, metrics, resources, alerts and explanation without depending on the interface.

## 10. Phase 4 - Web application and map

**Maximum duration:** 5 hours.

### P0 tasks

- integrate web frontend and 3D viewer;
- navigation between exploration, planning, simulation, alerts and reports;
- map with layers and grid;
- start, target and shelter controls;
- comparative panel of alternatives;
- resources panel;
- provenance badges;
- expandable alert detail.

### P1 tasks

- manipulable 2.5D relief;
- position animation;
- filters by material and scientific interest;
- visual editing of target order.

### Exit gate

The full script can be run with clicks and without using the terminal.

## 11. Phase 5 - Replay, MDA, reports and language

**Maximum duration:** 4 hours.

### Replay and MDA

- load a local historical sequence;
- run an accelerated clock;
- emit at least one simulated MDA event;
- change the environmental state;
- generate an alert and offer replanning.

### Reports

- record type, text, coordinates, author and date;
- save to SQLite;
- list reports after restart;
- mark synchronization status;
- export a package if time remains.

### Language

- Spanish by default;
- selector to English without restarting;
- translate navigation, buttons, alerts and main metrics;
- do not block the delivery for secondary translations.

### Exit gate

The application keeps a report, changes language and shows a replanning caused by a simulated event.

## 12. Phase 6 - Integration, QA and freeze

**Recommended start:** no later than 7:00 p.m. on November 15.

### Checklist

- run automated tests;
- run the full script on Windows and Linux;
- test start without internet;
- verify relative paths and packaged files;
- check that no secrets or personal paths appear;
- check provenance labels;
- check units and warnings;
- validate that Gale and Jezero open;
- restart and verify persistence;
- review readability of Spanish and English;
- record known failures.

### Freeze rule

After the freeze only failures that prevent the following are fixed:

- starting;
- loading a region;
- computing a route;
- running the replay;
- saving a report;
- completing the demo.

## 13. Phase 7 - Packaging and presentation

**Recommended window:** 9:00 p.m.–11:00 p.m. on November 15.

### Deliverables

- executable or single command for Windows;
- package or single command for Linux;
- offline datasets included;
- quick-install README;
- backup video or screenshots;
- demo script;
- architecture on one slide;
- limitations and future work;
- credits and NASA sources.

### Buffer

Reserve 11:00 p.m. to 11:59 p.m. exclusively for upload, verification and contingencies. Do not develop new features during that period.

## 14. Demonstration script

1. Open GaleX offline.
2. Show that Spanish is the default language and briefly switch to English.
3. Select Gale and activate relief, radiation and the MDA grid.
4. Define start, two scientific targets and a shelter.
5. Compare safe, fast and scientific routes.
6. Show why an alternative was penalized or rejected.
7. Start the replay.
8. Receive a critical alert from a simulated MDA.
9. Replan and show the change in resources.
10. Log a discovery.
11. Switch to Jezero and show Perseverance/MEDA data and scientific targets.
12. Close and reopen to verify that the report is still available.

## 15. Traceability matrix

| Requirement | Phase | Evidence |
|---|---|---|
| Offline Web Application | 4 and 7 | execution in modern browsers |
| Offline-first | 4 and 6 | demo without network |
| Gale and Jezero | 2 | regional selector |
| Grid and MDA | 2 and 5 | stations and simulated event |
| Multiple targets | 3 and 4 | manual/automatic ordering |
| Three routes | 3 | comparison of alternatives |
| Resources and shelter | 3 | metrics and mission rejection |
| Explainable alerts | 3, 4 and 5 | summary and detail |
| Environmental replay | 5 | clock and sequence |
| Persistent reports | 1 and 5 | SQLite after restart |
| Spanish/English | 5 | language selector |
| Scientific provenance | 2 and 4 | observed/derived/simulated badges |

## 16. Cut criteria if time runs short

Cut in this order:

1. network synchronization;
2. package export;
3. advanced automatic ordering;
4. complex 2.5D animation;
5. secondary scientific filters;
6. non-essential translations;
7. additional Jezero layers.

Do not cut:

- offline operation;
- explainable route;
- hard constraints;
- final shelter;
- data provenance;
- replay and MDA alert;
- basic persistence;
- demo script.

## 17. Definition of done

A task is done when:

- it is integrated in the delivery branch;
- it has at least one reproducible test or procedure;
- it works without the developer's absolute paths;
- it handles the main error case;
- it shows provenance and units when it uses data;
- it can be demonstrated by another team member;
- it does not break the main script.

## 18. Later work

After Space Apps:

1. validate the CRS, resolution and calibration of all layers;
2. extend Jezero to the same level as Gale;
3. incorporate RAD, MARCI/MCS and complete PDS science products;
4. replace demonstrative thresholds with expert-reviewed models;
5. optimize planning and multi-objective ordering;
6. implement secure synchronization;
7. create additional regional packages;
8. evaluate hardware and protocol of a physical MDA;
9. validate with specialists in geology, climate, EVA and space medicine.
