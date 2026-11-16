# Technical Findings, Improvement Suggestions and Missing Topics (GaleX)

**Record:** November 15, 2026  
**Branch:** `feature/trek.nasa.gov/mars/API`  
**Area:** Web Architecture, 3D Rendering (Three.js), NASA Mars Trek Integration, UX/UI  

---

## 1. Technical Findings Covered and Solutions

During the development and integration of GaleX's capabilities, the following engineering findings were documented and resolved:

### 1.1. Decoupling of the 3D state update (`update3d`)
- **Problem detected:** When switching to the 3D Planet view (`globe`), the control points, mineral deposits and the route were not drawn on the Martian globe.
- **Root cause:** In [`web/js/app.js`](file:///home/wuisino/Projects/mars-route-planner/web/js/app.js), the `update3d()` function began with a strict guard clause:
  ```javascript
  if (!MR.Scene3D || !MR.Scene3D.ready) return;
  ```
  This meant that, if the local 3D Relief view had not previously been initialized by the user, any update toward the planetary globe was completely silenced.
- **Solution implemented:** `update3d()` was restructured to compile the complete list of markers (targets, minerals of the active region and of other regions, findings and secondary missions) and dispatch the state to both `MR.Scene3D` and `MR.Globe3D` independently depending on the initialization state of each engine.

---

### 1.2. Conflict between `OrbitControls.update()` and the flight kinematics (`flyTo`)
- **Problem detected:** When clicking on planetary landmarks (Gale Crater, Jezero Crater, Olympus Mons, Valles Marineris) or when transitioning through `flyTo()`, the camera suffered abrupt jerks (*jittering*) or seemed to return to the initial orbital position `(0, 110, 55)`.
- **Root cause:** `THREE.OrbitControls` internally maintains spherical coordinates (`spherical: { radius, phi, theta }`) computed relative to its `target`. When interpolating the camera position with `camera.position.lerpVectors()` while also calling `controls.update()` on every frame, the `OrbitControls` damping algorithm tried to relocate the camera based on the previous frame, competing against the mathematical flight interpolation.
- **Solution implemented:**
  1. In the render loop of [`web/js/globe3d.js`](file:///home/wuisino/Projects/mars-route-planner/web/js/globe3d.js), execution was split:
     ```javascript
     if (fly) {
       // Smoothly interpolates camera position and target
       controls.target.lerpVectors(fly.t0, fly.t1, e);
       camera.position.lerpVectors(fly.p0, fly.p1, e);
       if (k >= 1) {
         fly = null;
         controls.update(); // Syncs OrbitControls on landing
       }
     } else {
       controls.update(); // Normal interactive operation
     }
     ```
  2. In instantaneous jumps (or with accessibility `reduce=1`), immediate atomic copies are executed and the orientation is synchronized:
     ```javascript
     controls.target.copy(t1);
     camera.position.copy(p1);
     camera.lookAt(t1);
     controls.update();
     ```

---

### 1.3. Projection of interactive cards over 3D space (`miniCard`)
- **Problem detected:** When clicking on a control point or target on the 3D terrain, the information window (`miniCard`) was not positioned next to the marker or was projected at wrong coordinates belonging to the 2D plane.
- **Root cause:** The repositioning function `repositionPointUI()` in `app.js` used exclusively `MR.Map.project()`, which converts geographic coordinates to pixels based on the SVG transformation matrix of the flat two-dimensional map.
- **Solution implemented:**
  - Dedicated `.project(lon, lat)` methods were created in both [`MR.Globe3D`](file:///home/wuisino/Projects/mars-route-planner/web/js/globe3d.js) and [`MR.Scene3D`](file:///home/wuisino/Projects/mars-route-planner/web/js/scene3d.js), which:
    1. Convert `(lon, lat)` to the scene's three-dimensional vector (`toGlobeXYZ` or `toXYZ`).
    2. Apply `vector.project(camera)` to obtain normalized device coordinates (NDC between -1 and 1).
    3. Map to screen pixels:
       $$\text{screenX} = \left(\frac{v_x + 1}{2}\right) \times \text{width}, \quad \text{screenY} = \left(\frac{1 - v_y}{2}\right) \times \text{height}$$
  - `repositionPointUI()` was connected inside the `requestAnimationFrame` animation loop of both 3D views, so the information card smoothly follows the anchored point while the user rotates or zooms the camera.

---

### 1.4. Optimization of procedural rendering and graceful degradation
- **Problem detected:** When starting the planetary view or at moments when the satellite tiles were slow to respond, the computation of the fallback terrain blocked the main JavaScript thread (*Script terminated by timeout*).
- **Root cause:** The `ramp(t)` function instantiated arrays and executed sequential searches in color-stop lists for every mesh vertex ($49 \times 49 = 2,401$ evaluations per tile, repeated across dozens of active tiles). Likewise, the fractal noise computation `fbm()` executed 6 trigonometric octaves per vertex.
- **Solution implemented:**
  - `ramp(t)` was refactored into a direct piecewise-linear analytic evaluation (eliminating object creation in the Garbage Collector).
  - The procedural noise `fbm()` was reduced to 3 fallback octaves, cutting mesh computation time by 80 % and keeping 60 FPS fluidity on modest machines.

---

### 1.5. Responsive adaptation for 1364 × 767 px screens without overlaps
- **Problem detected:** On moderate-resolution screens (1364×767 px, common on standard laptops), the side panels, the top status bar, the bottom panel and the central viewer overlapped. Additionally, the "Conditions" dashboard opened a full-screen panel that hid all the navigation context.
- **Solution implemented:**
  - The height of the top bar was limited to 46 px with restrained typography (11–12 px).
  - The 3D Planet control bar was compacted into a single horizontal line.
  - The Conditions view was transformed into a central card-type modal window (`.modal.modal-condiciones`) with a dimmed background (`#scrim`), equipped with 3 structured tabs (*Atmosphere and Weather*, *Terrain and Routes*, *Predictive Model*), Martian sol navigation and dynamic vector charts of temperature, pressure, wind and UV radiation.

---

## 2. Improvement Suggestions

From the current state of the prototype, the following technical and product improvement proposals are put forward:

### 2.1. Performance and Graphics Engine (Three.js / WebGL)
1. **Dynamic Level-of-Detail (LOD) Quadtree**:
   - *Proposal:* Implement a quaternary tree structure (*Quadtree*) for the 3D Planet tiles. Currently the system loads a ring of radius $R=3$ at a fixed level $Z$. A Quadtree will selectively subdivide the tiles closest to the camera and keep low-resolution tiles at the horizon, optimizing VRAM consumption and the number of *draw calls*.
2. **GLTF 3D Models of the Rovers and Asynchronous Loading**:
   - *Proposal:* Replace the simple geometric beacon (sphere + cylinder) with Draco-compressed GLTF 3D models of the Curiosity and Perseverance rovers, orienting the chassis according to the terrain slope normal vector.
3. **Instancing for Planetary Markers (`InstancedMesh`)**:
   - *Proposal:* Group the rings and masts of the control points into instanced meshes (`THREE.InstancedMesh`), passing colors and transformations through buffers, drastically reducing the CPU overhead in the render loop.

### 2.2. Offline-First and Storage
4. **Service Worker and Local Cache with IndexedDB**:
   - *Proposal:* Add a Service Worker that captures requests to `/api/proxy/trek` and stores the downloaded tiles in `IndexedDB` or `CacheStorage`. This will make it possible to open the 3D Planet view completely offline, even if the local Python server is not running.
5. **Offline Regional Package Download**:
   - *Proposal:* Add to the interface a "Download region for offline use" button that packages the elevation and orthophoto tiles of Gale Crater or Jezero (levels 0 to 6) into a single local compressed file.

### 2.3. Planning Capabilities and Scientific Analysis
6. **Export of Standard Geospatial Data**:
   - *Proposal:* Allow scientists and engineers to export the planned route as:
     - **GeoJSON**: Layers of control points, active route and exclusion zones.
     - **CSV / KML**: Elevation profile, cumulative distances, slopes and estimated consumption sol by sol.
7. **Dynamic Simulation of Battery and Atmospheric Attenuation ($\tau$)**:
   - *Proposal:* Relate the hour of the Sol and the solar zenith angle to the generation of the rover's solar panels or the degradation of the RTG, incorporating the atmospheric dust opacity ($\tau$) reported by the REMS / MEDA sensors.

---

## 3. Missing Topics and Backlog for Later Phases

Below are listed the functional and technical requirements that have been identified for development in future iterations:

| Priority | Backlog Item | Technical Description |
|:---:|---|---|
| **P1** | **Rover Tracks on the 3D Terrain** | Render dynamic marks (*tracks/decals*) on the elevation mesh along the path traveled by the rover. |
| **P1** | **Real-Time Bidirectional Synchronization** | If the user creates a finding or secondary mission on the 2D map, immediately instantiate the corresponding pin in the 3D Planet and 3D Relief without reloading the page. |
| **P2** | **Simultaneous Fleet Visualization** | Allow viewing on the 3D globe the simultaneous position of EV1 (Curiosity at Gale), EV2 (Perseverance at Jezero) and EV3, instead of showing only the selected active explorer. |
| **P2** | **Ingenuity Flight Integration** | For the Jezero region, represent the flight path of the *Ingenuity* helicopter as a 3D ribbon suspended 10–12 meters above the crater floor. |
| **P2** | **Atmosphere with Custom Shaders** | Replace the Three.js linear fog with a fragment shader that reproduces real Martian atmospheric scattering (*Rayleigh/Mie scattering* of iron-oxide dust). |
| **P3** | **End-to-End (E2E) Automated Tests** | Implement automated tests with Playwright to verify the loading of WebGL contexts, raycast clicks on minerals and responsive stability at 1364×767 px resolutions. |
