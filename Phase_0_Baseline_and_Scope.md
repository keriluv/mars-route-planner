# Phase 0 — baseline and delivery scope

**Record:** November 14, 2026, Bogotá time.

**MVP deadline:** November 15, 2026, 11:59 p.m., Bogotá time.

**Status:** Phase 0 closed; owners defined by role as Participant 1 to 6.

## 1. Scope frozen for the MVP

The P0 scope approved to start this phase is the one in [Phased_Planning.md](Phased_Planning.md#3-priorities): a modern web application that works offline; Gale and Jezero scenarios; layers and grid with simulated MDAs; safe, fast and scientific routes with demonstrative constraints, resources and a final shelter; environmental replay, explainable alerts, persistent reports and a Spanish/English selector.

**Execution order:** first a complete Gale flow; then enable Jezero with verifiable data and the same regional contract. Jezero must be selectable and able to demonstrate a route. If NASA layers are missing, they are flagged as `NOT AVAILABLE`, without presenting them as observations.

The P1 scope is conditional on P0 being integrated and working. P2 is left out of the delivery. One MDA per cell is the conceptual design; the demo will only instantiate a representative sample labeled as simulated.

## 2. Reproducible reference

- **Branch:** `feature/trek.nasa.gov/mars/API`.
- **Starting commit:** `1ac9e63e4fd0ed3d8b48546c2ba5345511a1fb06`.
- **Verified Python:** 3.14.7 in the local `.venv`.
- **Backup of pre-existing local changes:** [phase0_snapshot_2026-11-14.tar.gz](phase0_snapshot_2026-11-14.tar.gz).
- **SHA-256 of the backup:** `cf2e69dcb596d245aed2fd195dd79f5d104f4bd972604bdf1c3fdb578f343ae4`.

The commit keeps the code and data already versioned; the backup file keeps the modified binary model, the untracked PDF and Markdown documents and the four reference images. It does not represent a separate executable version of the repository. Before creating a baseline commit, the team must review which documents and binaries it wants to version.

### Main artifacts and SHA-256 hashes

| File | SHA-256 |
|---|---|
| `config/mission.yaml` | `72717dfde493dabd86e01920211adf0b3329264291da57f5a7ad9f3efa35f139` |
| `data/processed/layers_meta.json` | `387d08461a285fe5c2af073c7a8bf6c10f23ad8bdc90c8fe9eccf366acbcc657` |
| `data/processed/layers.npz` | `8aee2a2a2bc619867cb09c27a82652ad46023bf893b47b37155043d219b24e34` |
| `data/raw/gale_dem.tif` | `fa4763b1fdbe4f80ce710cbe72d65be06331dac994eb7445c739485b7a338ae7` |
| `models/terrain_model.joblib` | `dc70310a058688fa062d81160e0808a9c8ab17372948c5657819012945b2c422` |
| `models/metrics.json` | `395ddfab6af92346831a8d4651263fa6de150755e370f7c13d19df918bd91423` |
| `outputs/route.json` | `a8acfe1a4da1060e901be8ab321dbced924190e840969fad3313fcc1cdaf62f6` |
| `outputs/route_baseline.json` | `661e796ba1f4a27dd613f32bab884016dcc39ef49a51f2c69d91059c9e9b567c` |
| `outputs/traversability.npy` | `8d0b5f7afc8681670eb48d34d9b67ce8dfe8365807884184097a46bc09b7a93b` |
| `outputs/cost.npy` | `df4c39f3ab926eb065f917ffdf6daa33731b070f8cd09582f25f129e46988971` |
| `outputs/blocked.npy` | `6f67e1a8ea129c7cd8a296d6ded8bef2cc6b4f8a1a232b69aa542f30e8a97468` |

## 3. Gale verification result

The check was **read-only** over existing data and code:

| Check | Result |
|---|---|
| Grid and configuration | 1200 × 1200, bbox and size match |
| Layers loaded | 12, validity mask with 100 % coverage |
| Prediction vs. `traversability.npy` | exact match |
| Cost surface vs. `cost.npy` | exact match |
| Blocks vs. `blocked.npy` | exact match |
| New A* run vs. `route.json` | 1,390 identical cells, same cost |
| Blocked cells crossed | 0 |
| Recorded length | 71.957 km |
| REMS CSV for sols 100 and 4500 | available |
| Original REMS TAB files | not available locally |

Generating everything from scratch requires a connection to download the REMS TAB files and the THEMIS mosaic that the repository excludes. The operational flow from the processed artifacts can be verified offline. This route is a **technical reference**, not a validated EVA mission.

## 4. P0 board and owners

Owners are identified by role as Participant 1 to 6; their names are not needed to start. Participant 1 maintains the shared contract and resolves interface conflicts.

| ID | P0 deliverable | Owner | Status | Evidence of completion |
|---|---|---|---|---|
| P0-01 | Contracts, regional configuration and integration | Participant 1 — integration | pending | Gale and Jezero load the same contract |
| P0-02 | Safe/fast/scientific routes, constraints and resources | Participant 2 — routes | pending | valid route and reproducible rejection |
| P0-03 | Gale/Jezero catalog, targets, shelters and provenance | Participant 3 — data | pending | both regions selectable |
| P0-04 | Environmental replay, simulated MDA and alerts | Participant 4 — environment | pending | event causes alert and replanning |
| P0-05 | Web application, map, layers and grid | Participant 5 — web interface | pending | complete flow without a terminal |
| P0-06 | SQLite logbook, language, QA and demo | Participant 6 — UX/QA | pending | report persists; script works on both systems |
| P0-07 | Packaging and offline web execution | Participants 1 and 5 | pending | offline web server and client tested |

**Coordination rule:** each P0 deliverable has an owner by role. The team can later associate names or redistribute people without changing the contracts or blocking the start.

## 5. Preliminary script — five minutes maximum

| Time | Action | Visible evidence |
|---|---|---|
| 0:00–0:30 | Open the application offline; show the Spanish language | offline start and language selector |
| 0:30–1:10 | Select Gale, layers, grid and MDA | terrain, data and provenance labels |
| 1:10–2:00 | Choose start, targets and shelter; compare three routes | metrics, resources and explanation |
| 2:00–2:45 | Replay a sol and trigger a simulated MDA event | clock, detailed alert and new route |
| 2:45–3:30 | Log a discovery and check the logbook | coordinate and persistence |
| 3:30–4:15 | Select Jezero and show Perseverance/MEDA | second region and provenance |
| 4:15–5:00 | Summarize sources, limits and usefulness | traceability and prototype warning |

If a part fails, use backup screenshots or video identified as a recorded demonstration.

## 6. Gate to start Phase 1

- [x] P0/P1/P2 scope recorded.
- [x] Previous state documented and backed up.
- [x] Gale verified without altering its artifacts.
- [x] Hashes and commit recorded.
- [x] Preliminary script available.
- [x] Six owners identified by role as Participant 1 to 6.
- [x] Participant 1 designated as integration owner for this planning.

**Phase 1 enabled.** Associating real names and an eventual baseline commit are optional coordination decisions; the backup and the hashes already make it possible to identify the starting state.
