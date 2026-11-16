# Executive Summary of Sessions, Technical Findings and Improvement Proposals (GaleX / Mars Route Planner)

**Record:** November 15, 2026  
**Working branch:** `feature/trek.nasa.gov/mars/API`  
**Runtime environment:** Linux (x86_64), Python 3.14.7, Three.js (WebGL), NASA Mars Trek API / WMTS  
**Target display resolution:** Compact laptops (1364 × 767 / 1366 × 768) and standard desktop  

---

## 1. Context and Objectives of the Intervention

Throughout the working sessions, fundamental requirements were addressed to evolve the **GaleX (Mars Route Planner)** prototype into an integrated, unified, responsive and scientifically rigorous planetary navigation platform. The main objectives were:

1. **Unification of the user experience in a single endpoint (`http://127.0.0.1:8000/`)**: Eliminate orphan tabs and pages (such as `mars-3d-terrain.html`), consolidating navigation between **2D Map**, **3D Relief** (local crater) and **3D Planet** (orbital globe with NASA Mars Trek data) under the same navigation bar, controls and reactive state.
2. **Synchronization and Merge with `origin/main`**: Integrate without conflicts the commits of the main branch (support for local DEM tiles in `3dView/dem_tiles/`, persistent NASA Trek tile proxy in `backend/server.py` and layer catalog).
3. **Integration of NASA Mars Trek Scientific Layers in the 3D Planet**: Incorporate hypsometric mosaics, morphological shading, optical albedo and spectral overlays (MOLA/HRSC, Viking MDIM 2.1, TES Thermal Inertia and TES Plagioclase) with real-time compositing over dynamic Canvas 2D textures.
4. **Responsive Design and Visual Ergonomics on Laptop Screens (1364 × 767)**: Restructure the user interface to ensure that no window or panel covers the work area or generates overlaps, transforming the "Mission Conditions" view from an invasive full screen into a modular floating central window.
5. **Homologation of Control Points, Minerals and Routes in the 3D Planet**: Transfer all the interactive and scientific richness of the 3D Relief view to the global 3D Planet view (3D target pins, rotating mineral crystals with colors by geological category, 3D tube routes, pulsing rover beacon and interactive raycasting with projected cards).

---

## 2. Chronology of Requests and Implemented Solutions

### 2.1. Synchronization and Merge of Changes from `main`
- **Requirement:** Evaluate which modifications `origin/main` brought (commit `3956504`), verify possible collisions with the working documents and perform the merge and integration into the prototype.
- **Solution:**
  - A clean *fast-forward merge* of `origin/main` was executed.
  - The availability of the local proxy at `/api/proxy/trek` was verified, with persistent disk storage to avoid overloading NASA's servers and guarantee offline-first operation.
  - The integrity of the 7 DEM zoom-level folders (`0` to `6`) in `3dView/dem_tiles/` was checked.

### 2.2. Integration of the Unified GUI for the 3D Planet
- **Requirement:** Attach the planet's 3D viewer inside the main application (`http://127.0.0.1:8000/`), sharing the top controls, region switching, view selector and missions, without jumping to independent tabs.
- **Solution:**
  - The `3D Planet` button was added to the `.viewswitch` view selector (`web/index.html` and `web/js/app.js`).
  - Dedicated containers `#mapGlobe` and the HUD control panel `#ctlGlobe` were created.
  - The engine was modularized in [`web/js/globe3d.js`](file:///home/wuisino/Projects/mars-route-planner/web/js/globe3d.js) (`MR.Globe3D`), with a full lifecycle (`init()`, `start()`, `stop()`, `resize()`, `goToRegion()`).

### 2.3. NASA Mars Trek Multi-Layer Catalog and Dynamic Compositing
- **Requirement:** Apply the official NASA scientific layers obtained from the Mars Trek API, with visibility control, opacity and explanatory metadata.
- **Implemented layers:**
  1. *MGS MOLA + Mars Express HRSC ClrShade* (Base, 200 m/px): Laser hypsometry from -8,200 m to +21,200 m.
  2. *MGS MOLA + Mars Express HRSC Shade* (Base, 200 m/px): Structural panchromatic shading.
  3. *Viking Orbiter Color Mosaic MDIM 2.1* (Base, 232 m/px): Optical true color of the surface albedo.
  4. *MGS TES Global Thermal Inertia* (Overlay, 3 km/px): Thermal inertia (dust vs. consolidated rock).
  5. *MGS TES Global Plagioclase Abundance* (Overlay, 3 km/px): Volumetric abundance of igneous feldspar.
- **Technical solution:**
  - Compositing on a 256×256 px Canvas 2D for each tile, rendering the base layer at 100 % and applying the overlay layers with their `globalAlpha` configurable through sliders.
  - Reactive side panel with thumbnails, toggle buttons, opacity controls and scientific description pop-ups.

### 2.4. UX/UI Optimization for Laptops (1364 × 767)
- **Requirement:** Adapt the interface to moderate-size laptop screens (specifically 1364×767 px), avoiding overlaps and redesigning the Conditions view so it does not block the canvas.
- **Solution:**
  - **Top status bar (`.statusbar`)**: Height reduced to 46 px, compact margins, optimized font size (11–12 px) and fluid horizontal layout.
  - **View selector (`.viewswitch`)**: Floating translucent pill design with `backdrop-filter: blur(8px)`.
  - **3D Planet control (`#ctlGlobe`)**: Grouped into a single compact row (exaggeration slider, quick layer buttons, shortcuts to planetary landmarks and coordinate readout).
  - **Bottom HUD Dock (`#dock`)**: Relocation and containment to avoid invading the interactive areas of the map.
  - **Refactoring of "Mission Conditions"**:
    - The `.fullview` class that took 100 % of the window was removed.
    - It was transformed into a central modal window (`.modal.modal-condiciones`) of at most 740 × 580 px (86vw × 84vh), centered with a blurred dark background (`#scrim`).
    - The 3 tabs were kept intact: *Atmosphere and Weather* (REMS charts of temperature, pressure, wind and UV radiation per Sol), *Terrain and Routes* (summary of slopes, roughness and traversability) and *Predictive Model* (Random Forest model coefficients and A* weights).

### 2.5. Control Points, Minerals and Routes in the 3D Planet
- **Requirement:** Implement in the 3D Planet view the control points, mineral deposits, active routes and rover position identically to 3D Relief.
- **Solution:**
  - **Differentiated 3D geometries**: Cones for goals, cylinders for bases, hexagonal prisms for shelters and octahedra for science/reference.
  - **Animated mineral crystals**: Octahedral diamonds that spin continuously around their Y axis, accompanied by a pulse ring on the ground and a luminous mast.
  - **Colors by mineralogical category**:
    - *Carbonates / Olivine*: `#00D26A` (emerald green).
    - *Clays / Phyllosilicates*: `#00C8E0` (cyan blue).
    - *Hydrated sulfates*: `#4DA6FF` (azure blue).
    - *Iron oxides*: `#FF7043` (amber / rust).
    - *Basaltic silicates*: `#90A4AE` (slate gray).
  - **3D tube routes**: Blue tube for the active route (`#4D8DFF`), green tube for the already completed path (`#46C882`), and violet tubes for secondary missions (`#A68BFF`).
  - **Rover beacon**: Sphere in the explorer's color with a translucent pulsing vertical beam that advances with the simulation in real time.
  - **Adaptive scale (`pinScale`)**: Dynamic computation in the render loop as a function of `camera.position.distanceTo(controls.target)`, so the pins are clearly visible both in global orbit and at crater level without covering the terrain.
  - **Screen projection and Raycasting**:
    - Implementation of [`MR.Globe3D.project(lon, lat)`](file:///home/wuisino/Projects/mars-route-planner/web/js/globe3d.js) and [`MR.Scene3D.project(lon, lat)`](file:///home/wuisino/Projects/mars-route-planner/web/js/scene3d.js) to anchor interactive cards (`miniCard`) over 3D space.
    - Precise click and hover detection: pointer cursor, immediate informative tooltips and opening of scientific and mission cards.

---

## 3. Technical and Architectural Findings

During development and integration, several relevant technical challenges were identified and solved:

| # | Technical Finding | Diagnosis | Implemented Solution |
|---|---|---|---|
| **1** | Block in state update (`update3d`) | `web/js/app.js` contained an early return `if (!MR.Scene3D \|\| !MR.Scene3D.ready) return;`, which prevented `MR.Globe3D` from receiving routes, minerals and pins if the local relief view had not been initialized. | The `update3d()` function was decoupled to update `MR.Scene3D` and `MR.Globe3D` independently depending on their availability. |
| **2** | Conflict between `OrbitControls` and flight interpolation | When running `flyTo()`, `camera.position.lerpVectors()` modified the camera position, but on every frame `controls.update()` recomputed the control's spherical coordinates with damping, causing jerks or position regression. | The render loop was made conditional: if `fly` is active the `controls.update()` computations are skipped, and when the flight ends `controls.update()` is invoked once to synchronize the orbital angles. |
| **3** | Projection of floating cards (`miniCard`) | The pop-up card system invoked exclusively `MR.Map.project()` (designed only for 2D SVG), so when clicking on a 3D pin the card appeared at offset or fixed coordinates. | `.project(lon, lat)` methods were added to `MR.Globe3D` and `MR.Scene3D` using `Vector3.project(camera)` and the viewport dimensions, linking them to `repositionPointUI()` on every frame. |
| **4** | Computational overload in procedural `ramp()` and `fbm()` | In situations without a connection or with slow tiles, generating meshes with resolution `SEGS = 48` evaluated 6-octave fractal noise and array searches for 2,401 vertices per tile synchronously, causing execution-time warnings in limited browsers. | `ramp(t)` was optimized to a direct analytic computation by branches without temporary array allocation, and `fbm` was reduced to 3 octaves for the fallback. |
| **5** | Screenshots in headless browsers | When taking automated screenshots with headless Firefox on Linux, the CSS transitions (.28s) produced semi-transparent captures. | Support for `reduce=1` through a URL parameter was added, forcing `html.reduce` so that all animations and cinematic flights are instantaneous during tests and visual verifications. |

---

## 4. Improvement Suggestions

Based on the experience gained in the integration, the following improvements are proposed for the next phases:

### 4.1. Performance and 3D Graphics
1. **Dynamic Level of Detail (LOD) through a Strict Quadtree**:
   - Implement a hierarchical quaternary tree (Quadtree) that splits only the tiles visible in the viewing cone (*frustum culling*) and merges distant tiles, drastically reducing memory consumption on mobile devices and integrated GPUs.
2. **GLTF/GLB 3D Rover Models**:
   - Replace the geometric primitives (sphere and cylinder) with optimized 3D models in GLTF format with PBR texture of the Curiosity and Perseverance rovers, including wheel orientation animation according to the slope.
3. **Martian Atmosphere Effect and Rayleigh Scattering**:
   - Replace the simple linear fog (`THREE.Fog`) with a custom atmospheric scattering shader that simulates the characteristic salmon/reddish sky of Mars and the bluish horizon at sunsets.

### 4.2. Persistence and Offline Capabilities
4. **Full Cache through Service Worker and IndexedDB**:
   - Although the local Python server caches the NASA Trek tiles, implement a client-side Service Worker that stores the viewed tiles in `CacheStorage` or `IndexedDB`, allowing the application to work 100 % autonomously even if the backend is temporarily shut down.
5. **Smart Regional Preload (Prefetch)**:
   - When selecting "Gale Crater" or "Jezero Crater", trigger a background preload of the zoom level 4, 5 and 6 tiles corresponding to the crater's bounding box.

### 4.3. Scientific and Analysis Tools
6. **Export of Geospatial Data**:
   - Enable download of the generated route plan in standard formats: **GeoJSON** (for visualization in QGIS/ArcGIS), **GeoTIFF** of the traverse strip and **CSV** with the elevation profile and battery/oxygen consumption estimate.
7. **Simulation of Solar Longitude ($L_s$) and Atmospheric Dust ($\tau$)**:
   - Connect the hour of the Sol with the inclination of the sunlight vector (`sun.position`) and the dust opacity parameter ($\tau$), simulating the real impact on solar panels and the visibility of optical instruments.

---

## 5. Missing Topics and Next Steps (Backlog)

The following items are identified as complementary topics that were not part of the immediate scope of this iteration or that require later development:

- [ ] **Animation of tracks and wheel marks on the terrain**: Generation of dynamic meshes or decals that leave the rover's wheel marks on the terrain texture as the simulation advances.
- [ ] **Live bidirectional synchronization of user markers**: When the user creates a finding or a new secondary mission on the 2D map through right click/context menu, immediately reflect the new 3D pin in the 3D Planet without requiring route recomputation.
- [ ] **Simultaneous support of multiple explorers in the 3D Planet**: Show simultaneously the positions of EV1, EV2 and EV3 on their respective routes on the globe instead of switching only to the active explorer.
- [ ] **Integration of the Ingenuity helicopter**: For the Jezero region, add the aerial trajectory of the Ingenuity flights as a 3D aerial route elevated above the crater floor.
- [ ] **End-to-End (E2E) Automated Tests**: Implement a test suite with Playwright or Cypress that verifies WebGL initialization, clicking on 3D markers through simulated coordinates and the correct opening of the modals.

---

## 6. Verification and Key Commits

The documented modifications have been validated through JavaScript syntax tests (`node -c`), the domain and storage test suite (`pytest tests/test_smoke.py`), and photographic captures at laptop resolution (1364×767 px).

**Reference commits in `feature/trek.nasa.gov/mars/API`:**
- `3956504`: Merge of `origin/main` with DEM tile support and persistent proxy.
- `5e82b5e`: Responsive interface optimization for laptops (1366×768 / 1364×767 px).
- `73adfc7`: Refactoring of Mission Conditions into a central modal window with 3 tabs.
- `76e13ed`: Implementation of control points, interactive mineral deposits, route tubes and telemetry in the 3D Planet.
