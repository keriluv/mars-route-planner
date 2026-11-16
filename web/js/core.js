/* =========================================================
   core.js — data, geometry, A*, weather and walking model
   Everything that is not interface lives here.
   ========================================================= */
(function () {
  "use strict";
  const D = window.MARS_DATA;
  const MR = (window.MR = { D });
  const G = D.layers.grid;              // 300 × 300
  const R_MARS_KM = 3389.5;
  const KM_PER_DEG = (Math.PI / 180) * R_MARS_KM;
  MR.G = G; MR.WORLD = 1200;

  MR.REGIONS = {
    gale: {
      id: "gale",
      name: "Gale Crater (Curiosity)",
      rover: "Curiosity (MSL)",
      bbox: [137.18, -5.45, 138.08, -4.55],
      center: [137.44, -4.68],
      basemapRelief: "assets/basemap_relief.jpg",
      basemapColor: "assets/basemap_color.jpg",
      demMin: D.layers.dem.min,
      demMax: D.layers.dem.max
    },
    jezero: {
      id: "jezero",
      name: "Jezero Crater (Perseverance)",
      rover: "Perseverance (Mars 2020)",
      bbox: (window.JEZERO_DATA && window.JEZERO_DATA.bbox) || [77.05, 18.05, 77.68, 18.63],
      center: (window.JEZERO_DATA && window.JEZERO_DATA.center) || [77.365, 18.34],
      basemapRelief: "assets/basemap_jezero_relief.jpg",
      basemapColor: "assets/basemap_jezero_color.jpg",
      demMin: (window.JEZERO_DATA && window.JEZERO_DATA.dem && window.JEZERO_DATA.dem.min) || -2567.2,
      demMax: (window.JEZERO_DATA && window.JEZERO_DATA.dem && window.JEZERO_DATA.dem.max) || -1925.8
    }
  };

  MR.setRegion = function (regionId) {
    MR.currentRegion = regionId === "jezero" ? "jezero" : "gale";
    MR.activeRegion = MR.REGIONS[MR.currentRegion];
    MR.bbox = MR.activeRegion.bbox.slice();
    MR.W = MR.bbox[0]; MR.S = MR.bbox[1]; MR.E = MR.bbox[2]; MR.N = MR.bbox[3];
  };
  MR.setRegion("gale");

  /* ---------- layer decoding (base64 → arrays) ---------- */
  function decode(layer) {
    const bin = atob(layer.b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const raw = layer.dtype === "u16" ? new Uint16Array(u8.buffer) : u8;
    const top = layer.dtype === "u16" ? 65535 : 255;
    const out = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = layer.min + (raw[i] / top) * (layer.max - layer.min);
    return out;
  }
  MR.F = {};
  for (const k of Object.keys(D.layers)) if (k !== "grid") MR.F[k] = decode(D.layers[k]);
  // optional confidence layer (disagreement among the 300 trees of the forest), from scripts/export_uncertainty.py
  MR.EXTRA = window.MARS_EXTRA || null;
  if (MR.EXTRA && MR.EXTRA.confidence) MR.F.confidence = decode(MR.EXTRA.confidence);
  MR.J = {};
  if (window.JEZERO_DATA && window.JEZERO_DATA.layers) {
    for (const k of Object.keys(window.JEZERO_DATA.layers)) {
      MR.J[k] = decode(window.JEZERO_DATA.layers[k]);
    }
    MR.F.jezero_dem = MR.J.dem;
  } else if (window.JEZERO_DATA && window.JEZERO_DATA.dem) {
    MR.F.jezero_dem = decode(window.JEZERO_DATA.dem);
  }

  /* ---------- geometry ---------- */
  MR.toWorld = (lon, lat) => {
    const [w, s, e, n] = MR.bbox || D.bbox;
    return [((lon - w) / (e - w)) * 1200, ((n - lat) / (n - s)) * 1200];
  };
  MR.fromWorld = (x, y) => {
    const [w, s, e, n] = MR.bbox || D.bbox;
    return [w + (x / 1200) * (e - w), n - (y / 1200) * (n - s)];
  };
  MR.cellOf = (lon, lat) => {
    const [w, s, e, n] = MR.bbox || D.bbox;
    const c = Math.min(G - 1, Math.max(0, Math.floor(((lon - w) / (e - w)) * G)));
    const r = Math.min(G - 1, Math.max(0, Math.floor(((n - lat) / (n - s)) * G)));
    return [r, c];
  };
  MR.cellCenter = (r, c) => {
    const [w, s, e, n] = MR.bbox || D.bbox;
    return [w + ((c + 0.5) / G) * (e - w), n - ((r + 0.5) / G) * (n - s)];
  };
  MR.sample = (key, lon, lat) => {
    const [r, c] = MR.cellOf(lon, lat);
    if (MR.currentRegion === "jezero" && MR.J && MR.J[key]) {
      return MR.J[key][r * G + c];
    }
    if (MR.currentRegion === "jezero" && key === "dem" && MR.F.jezero_dem) {
      return MR.F.jezero_dem[r * G + c];
    }
    return MR.F[key] ? MR.F[key][r * G + c] : 0;
  };
  MR.distKm = (a, b) => {
    const kx = KM_PER_DEG * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
    return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * KM_PER_DEG);
  };
  MR.inBounds = (lon, lat) => {
    const [w, s, e, n] = MR.bbox || D.bbox;
    return lon >= w && lon <= e && lat >= s && lat <= n;
  };
  MR.fmt = (v, d = 1) => (v == null || isNaN(v) ? "—" : Number(v).toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/^-/, "−"));
  MR.fmtLL = (lon, lat) => `${MR.fmt(lat, 3)}° · ${MR.fmt(lon, 3)}°`;

  /* ---------- routes: format [lon, lat, km, elev, slope, rough, trav] ---------- */
  MR.withKm = function (pts) {
    let km = 0;
    return pts.map((p, i) => {
      if (i) km += MR.distKm(pts[i - 1], p);
      return [p[0], p[1], km, p[3], p[4], p[5], p[6]];
    });
  };
  MR.routeStats = function (pts) {
    const n = pts.length; if (!n) return null;
    let s = 0, smax = 0, tr = 0, ro = 0, steep = 0, low = 0, gain = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i]; s += p[4]; tr += p[6]; ro += p[5]; smax = Math.max(smax, p[4]);
      if (p[4] > MR.cfg.critSlope) steep++;
      if (p[6] < MR.cfg.travThr) low++;
      if (i && p[3] > pts[i - 1][3]) gain += p[3] - pts[i - 1][3];
    }
    const len = pts[n - 1][2], hrsAll = MR.estimateHours(pts);
    return { length: len, meanSlope: s / n, maxSlope: smax, meanTrav: tr / n, meanRough: ro / n,
      steepFrac: steep / n, lowFrac: low / n, gain, hours: hrsAll, solsC: Math.max(1, Math.ceil(hrsAll / MR.eva.windowH() - 1e-9)),
      hazards: MR.hazardZones(pts).length, meanConf: MR.routeConfidence(pts), minElev: Math.min(...pts.map(p => p[3])), maxElev: Math.max(...pts.map(p => p[3])) };
  };

  // mean model confidence along a route (0–1); null if there is no layer or the region is not Gale
  MR.routeConfidence = function (pts) {
    if (!MR.F.confidence || MR.currentRegion !== "gale" || !pts.length) return null;
    let s = 0; for (const p of pts) s += MR.sample("confidence", p[0], p[1]);
    return s / pts.length;
  };

  /* ---------- global configuration (thresholds and weights) ---------- */
  // radThr: EVA dose threshold per workday (mSv). Operational ASSUMPTION of the app, not a NASA limit.
  MR.cfg = { riskW: 4, slopeW: 3, maxSlope: 20, caution: 8, critSlope: 15, travThr: 0.25, radThr: 5 };

  /* ---------- danger zones along a route ---------- */
  MR.hazardZones = function (pts, crit = MR.cfg.critSlope) {
    const zones = []; let cur = null;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p[4] > crit) {
        if (cur && p[2] - cur.endKm < 0.3) { cur.end = i; cur.endKm = p[2]; cur.max = Math.max(cur.max, p[4]); cur.rough = Math.max(cur.rough, p[5]); }
        else { cur = { start: i, end: i, startKm: p[2], endKm: p[2], max: p[4], rough: p[5] }; zones.push(cur); }
      }
    }
    zones.forEach((z, i) => (z.id = "hz" + i + "_" + z.startKm.toFixed(2)));
    return zones;
  };
  MR.lowTravZones = function (pts, thr = MR.cfg.travThr) {
    const zones = []; let cur = null;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p[6] < thr) {
        if (cur && p[2] - cur.endKm < 0.4) { cur.end = i; cur.endKm = p[2]; cur.min = Math.min(cur.min, p[6]); }
        else { cur = { start: i, end: i, startKm: p[2], endKm: p[2], min: p[6] }; zones.push(cur); }
      }
    }
    return zones.filter(z => z.endKm - z.startKm > 0.15).map((z, i) => Object.assign(z, { id: "lt" + i + "_" + z.startKm.toFixed(2) }));
  };

  /* ---------- walking model (Tobler adapted to the EVA suit) ----------
     v = 6·e^(−3.5·|signed_slope + 0.05|) km/h  (Tobler function)
     × 0.55 for the pressurized suit and × (1 − 0.35·(1 − traversability))   */
  MR.walkSpeed = function (grade, trav) {
    const tob = 6 * Math.exp(-3.5 * Math.abs(grade + 0.05));
    return Math.max(0.4, tob * 0.55 * (1 - 0.35 * (1 - trav)));
  };
  MR.gradeAt = function (pts, i) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const d = (b[2] - a[2]) * 1000;
    return d > 1 ? (b[3] - a[3]) / d : 0;
  };
  // Speed (km/h) at point i: the same one used by the simulation, so that the estimates and the traverse match.
  // Includes the slower pace on steep sections (× 0.6, prototype assumption) and the configurable breaks (on foot only).
  MR.speedAt = function (pts, i, mobility, zones) {
    const rover = mobility === "rover";
    let v = rover ? MR.roverSpeed(pts[i][4], pts[i][6]) : MR.walkSpeed(MR.gradeAt(pts, i), pts[i][6]);
    if (zones && zones.some(z => pts[i][2] >= z.startKm - 0.05 && pts[i][2] <= z.endKm + 0.05)) v *= 0.6;
    return rover ? v : v * MR.eva.paceFactor();
  };
  MR.estimateHours = function (pts, mobility = MR.eva.mobility) {
    const zones = MR.hazardZones(pts);
    let h = 0;
    for (let i = 1; i < pts.length; i++) h += (pts[i][2] - pts[i - 1][2]) / MR.speedAt(pts, i, mobility, zones);
    return h;
  };

  /* ---------- EVA workday: CONFIGURABLE assumptions ----------
     None of these figures comes from an official source. Nelson (NASA, 2021) lists the duration and pace of
     EVAs on Mars as open knowledge gaps, so they are exposed as assumptions that can be changed.
     The default values reproduce the original behavior of the prototype (08:00–17:00, no breaks or reserve). */
  const EVA = (MR.eva = { mobility: "astronaut" });
  EVA.DEFAULTS = { startHour: 8, durationH: 9, pauseMinPerH: 0, reserveMin: 0 };
  EVA.cfg = Object.assign({}, EVA.DEFAULTS);
  EVA.LIMITS = { startHour: [6, 10], durationH: [4, 12], pauseMinPerH: [0, 30], reserveMin: [0, 120] };
  EVA.load = function (o) {
    Object.keys(EVA.DEFAULTS).forEach(k => {
      const v = +(o && o[k]); const [lo, hi] = EVA.LIMITS[k];
      EVA.cfg[k] = isFinite(v) && o[k] != null ? Math.min(hi, Math.max(lo, v)) : EVA.DEFAULTS[k];
    });
  };
  EVA.endHour = () => EVA.cfg.startHour + EVA.cfg.durationH;                 // end of the workday
  EVA.walkEndHour = () => EVA.endHour() - EVA.cfg.reserveMin / 60;           // walking stops earlier: time is left to return
  EVA.windowH = () => Math.max(0.25, EVA.cfg.durationH - EVA.cfg.reserveMin / 60); // walking hours per sol
  EVA.paceFactor = () => (60 - EVA.cfg.pauseMinPerH) / 60;                   // breaks are averaged into the pace
  // how many sols a route takes with the current workday
  EVA.plan = function (pts, mobility = EVA.mobility) {
    const hours = MR.estimateHours(pts, mobility), len = pts[pts.length - 1][2], win = EVA.windowH();
    return { hours, len, windowH: win, sols: hours / win, solsCeil: Math.max(1, Math.ceil(hours / win - 1e-9)), avgKmh: len / hours,
      needKmhFor: n => len / (n * win), needWindowFor: n => hours / n + EVA.cfg.reserveMin / 60 };
  };
  MR.fmtHM = h => { const m = Math.round(h * 60); return String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
  MR.roverSpeed = function (slopeDeg, trav) {
    const rad = ((slopeDeg || 0) * Math.PI) / 180;
    return Math.max(1.5, 12.0 * Math.max(0.2, Math.cos(rad)) * (0.6 + 0.4 * (trav != null ? trav : 0.5)));
  };
  MR.SHELTERS = [
    { id: "shelter-bradbury", name: "Bradbury Landing (Gale)", lon: 137.4416, lat: -4.5895, region: "gale" },
    { id: "shelter-mount-sharp", name: "Mount Sharp Base (Gale)", lon: 137.8599, lat: -5.3709, region: "gale" },
    { id: "shelter-butler", name: "Octavia Butler Landing (Jezero)", lon: 77.4508, lat: 18.4447, region: "jezero" },
    { id: "shelter-delta", name: "Delta Front Shelter (Jezero)", lon: 77.3820, lat: 18.4550, region: "jezero" },
  ];
  MR.routeResources = function (pts, mobility = "rover", maxShelterDistKm = 1.0) {
    if (!pts || pts.length < 2) return null;
    const len = pts[pts.length - 1][2];
    const hours = MR.estimateHours(pts, mobility);
    const isRover = mobility === "rover";
    // On foot, the suit is recharged every night (ASSUMPTION): consumption is measured per EVA workday, not over the whole traverse.
    const useH = isRover ? hours : (hours <= MR.eva.windowH() ? hours : MR.eva.cfg.durationH);
    const o2Capacity = isRover ? 5184 : 576; // 72h vs 8h endurance at 72 L/h (prototype assumptions)
    const o2Consumed = useH * 72;
    const o2Pct = Math.min(100, (o2Consumed / o2Capacity) * 100);

    const battCapacity = isRover ? 45.0 : 12.0; // kWh
    const battRate = isRover ? 3.2 : 1.5; // kWh/h
    const battConsumed = useH * battRate;
    const battPct = Math.min(100, (battConsumed / battCapacity) * 100);

    const radDose = MR.radiation.routeDose(pts, mobility); // mSv, simplified model (see MR.radiation)

    const goal = pts[pts.length - 1];
    let nearestShelter = null, minShelterDist = Infinity;
    MR.SHELTERS.forEach(sh => {
      const d = MR.distKm([sh.lon, sh.lat], [goal[0], goal[1]]);
      if (d < minShelterDist) { minShelterDist = d; nearestShelter = sh; }
    });
    const shelterOk = minShelterDist <= maxShelterDistKm;
    let valid = true, rejectionReason = "";
    if (!shelterOk) {
      valid = false;
      rejectionReason = `Destination without a verified pressurized shelter (minimum distance: ${minShelterDist.toFixed(1)} km > 1.0 km).`;
    } else if (o2Pct > 80.0) {
      valid = false;
      rejectionReason = isRover ? `Projected O₂ consumption (${o2Pct.toFixed(1)}%) exceeds the safety threshold (reserve < 20%).`
        : `A workday of ${useH.toFixed(1)} h uses ${o2Pct.toFixed(0)} % of the suit's O₂ (8 h endurance, assumption; reserve < 20 %). Shorten the workday in Route → EVA workday.`;
    } else if (battPct > 85.0) {
      valid = false;
      rejectionReason = `Projected battery consumption (${battPct.toFixed(1)}%) exceeds the safety threshold.`;
    }

    return {
      length: len,
      hours, useH,
      o2Pct,
      o2Consumed,
      o2RemainingPct: Math.max(0, 100 - o2Pct),
      battPct,
      battRemainingPct: Math.max(0, 100 - battPct),
      radDose,
      shelterOk,
      shelterName: nearestShelter ? nearestShelter.name : "Unknown",
      shelterDistKm: minShelterDist,
      valid,
      rejectionReason,
    };
  };

  /* ---------- radiation: SIMPLIFIED model (not a measurement) ----------
     Relative exposure index: 1.00 = crater floor under open sky.
       index = height_factor × relief_factor
       height_factor = 1 + s·(1 − column/ref_column)   (less atmosphere above → more dose)
       relief_factor = a + (1 − a)·SVF                 (SVF = visible sky fraction of the DEM)
     Dose rate = base_rate × index × (rover factor) × (solar event multiplier).
     Each parameter states whether it comes from a source or is an ASSUMPTION (see RAD.ASSUMPTIONS). */
  const RAD = (MR.radiation = {});
  RAD.P = {
    baseMsvDay: 0.65,              // SOURCE: MSL-RAD on the Gale floor ≈ 0.64–0.7 mSv/day (Simonsen 2024; Tasoula et al.)
    refElev: -4500, refColumn: 23, // SOURCE: ≈ 23 g/cm² of CO₂ above the Gale floor (Simonsen 2024)
    scaleH: 11100,                 // scale height of the pressure already used by the prototype's weather (approximation)
    elevSens: 0.5,                 // ASSUMPTION: how much the dose rises as atmosphere is lost. Only the direction is supported
    albedoFrac: 0.2,               // SOURCE: albedo neutrons ≈ 20 % of the surface dose (Simonsen 2024); not blocked by relief
    roverFactor: 0.012 / 0.027,    // ASSUMPTION: shielding of the pressurized rover relative to walking in a suit
    speMult: 40,                   // ASSUMPTION: dose-rate multiplier during a solar event (MSL-RAD in transit: ×10 to ×100)
    speHours: 36,                  // ASSUMPTION: duration of the demonstration event
  };
  RAD.baseRate = RAD.P.baseMsvDay / 24; // mSv/h
  RAD.ASSUMPTIONS = [
    { k: "Base rate", v: "0.65 mSv/day (≈ 27 µSv/h)", kind: "source", n: "MSL-RAD on the Gale floor, Simonsen (NASA, 2024)." },
    { k: "Atmosphere on the Gale floor", v: "≈ 23 g/cm²", kind: "source", n: "Simonsen (NASA, 2024)." },
    { k: "Ground albedo", v: "20 % of the dose", kind: "source", n: "Neutrons coming from the ground: relief does not stop them." },
    { k: "Sensitivity to elevation", v: "+50 % with no atmosphere", kind: "assumption", n: "It is only known that less atmosphere gives more dose; the size of the effect is not in the repo's sources." },
    { k: "Relief shielding", v: "visible sky of the DEM (177 m/cell)", kind: "assumption", n: "Geometric simplification; ignores crater walls outside the frame." },
    { k: "Pressurized rover", v: "× 0.44 vs. walking", kind: "assumption", n: "Value inherited from the prototype, unsourced." },
    { k: "Solar event (demo)", v: `× ${RAD.P.speMult} for ${RAD.P.speHours} h`, kind: "assumption", n: "Order of magnitude consistent with a reference event of 40 mSv unshielded (Simonsen) and with jumps of ×10 to ×100 measured in transit." },
    { k: "Inside the shelter", v: "no dose is added", kind: "assumption", n: "The model only counts hours outdoors." },
    { k: "Alert threshold", v: "5 mSv per workday (configurable)", kind: "assumption", n: "Operational threshold of the app, much lower than NASA limits (250 mSv per solar event; 600 mSv career)." },
  ];
  (function buildRadiationIndex() {
    const Z = MR.F.dem; if (!Z) return;
    const b = MR.REGIONS.gale.bbox, midLat = (b[1] + b[3]) / 2, midLon = (b[0] + b[2]) / 2;
    const cw = MR.distKm([b[0], midLat], [b[2], midLat]) * 1000 / G, ch = MR.distKm([midLon, b[1]], [midLon, b[3]]) * 1000 / G;
    const DIRS = [[-1, 0, ch], [1, 0, ch], [0, -1, cw], [0, 1, cw], [-1, -1, Math.hypot(cw, ch)], [-1, 1, Math.hypot(cw, ch)], [1, -1, Math.hypot(cw, ch)], [1, 1, Math.hypot(cw, ch)]];
    const K = 36, out = new Float32Array(G * G), P = RAD.P;
    let lo = Infinity, hi = -Infinity;
    for (let r = 0; r < G; r++) for (let c = 0; c < G; c++) {
      const i = r * G + c, z0 = Z[i]; let sinSum = 0;
      for (const [dr, dc, step] of DIRS) {
        let maxT = 0;
        for (let k = 1; k <= K; k++) {
          const rr = r + dr * k, cc = c + dc * k; if (rr < 0 || cc < 0 || rr >= G || cc >= G) break;
          const t = (Z[rr * G + cc] - z0) / (k * step); if (t > maxT) maxT = t;
        }
        sinSum += maxT / Math.sqrt(1 + maxT * maxT);
      }
      const svf = 1 - sinSum / DIRS.length;
      const elevF = 1 + P.elevSens * (1 - Math.exp(-(z0 - P.refElev) / P.scaleH));
      const v = elevF * (P.albedoFrac + (1 - P.albedoFrac) * svf);
      out[i] = v; if (v < lo) lo = v; if (v > hi) hi = v;
    }
    MR.F.radiation = out; RAD.range = [lo, hi];
  })();
  // index at a point; outside Gale there is no model (the reference atmosphere column is Gale's)
  RAD.index = (lon, lat) => (MR.currentRegion === "gale" && MR.F.radiation ? MR.sample("radiation", lon, lat) : 1);
  RAD.speActive = (spe, simMin) => !!spe && simMin >= spe.start && simMin < spe.end;
  RAD.startSpe = simMin => ({ start: simMin, end: simMin + RAD.P.speHours * 60 });
  // dose rate (mSv/h) of someone outdoors at point p = [lon, lat, …]
  RAD.rate = (p, mobility, spe, simMin) => RAD.baseRate * RAD.index(p[0], p[1])
    * (mobility === "rover" ? RAD.P.roverFactor : 1) * (RAD.speActive(spe, simMin) ? RAD.P.speMult : 1);
  // predicted dose of the traverse from GCR only (no solar events), integrated along the route
  RAD.routeDose = function (pts, mobility = "rover") {
    const zones = MR.hazardZones(pts); let dose = 0;
    for (let i = 1; i < pts.length; i++) dose += ((pts[i][2] - pts[i - 1][2]) / MR.speedAt(pts, i, mobility, zones)) * RAD.rate(pts[i], mobility, null, 0);
    return dose;
  };

  /* ---------- weather (Curiosity REMS) ----------
     Real daytime profile by local solar hour + elevation correction:
     temperature −2.5 °C/km and pressure with a scale height of 11.1 km.      */
  const REF_ELEV = -4500;
  function interp(arr, hour) {
    const n = arr.length; const x = ((hour % 24) + 24) % 24 / 24 * n;
    const i0 = Math.floor(x) % n, i1 = (i0 + 1) % n, t = x - Math.floor(x);
    return arr[i0] * (1 - t) + arr[i1] * t;
  }
  function noise(seed) { const x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x) - 0.5; }
  MR.weather = function (hour, elev, profile = "sol_100", seed = 0) {
    const P = D.rems[profile];
    const dz = (elev - REF_ELEV) / 1000;
    const n = noise(seed);
    return {
      air: interp(P.air_c, hour) - 2.5 * dz + n * 1.6,
      ground: interp(P.ground_c, hour) - 2.5 * dz + n * 2,
      uv: Math.max(0, interp(P.uv_w_m2, hour) * (1 + n * 0.06)),
      rh: Math.max(0, interp(P.rh_pct, hour)),
      p: interp(P.pressure_pa, hour) * Math.exp(-(elev - REF_ELEV) / 11100) + n * 3,
    };
  };

  /* ---------- A* on the 300 × 300 grid ----------
     cost = 1 + w_r·(1 − p)² + w_s·slope_penalty²
     Cells with slope > maximum or marked as blocked by the backend are blocked. */
  function buildCost(o) {
    const n = G * G, cost = new Float32Array(n), blocked = new Uint8Array(n);
    const T = MR.F.traversability, SL = MR.F.slope, BL = MR.F.blocked;
    for (let i = 0; i < n; i++) {
      const risk = 1 - Math.min(1, Math.max(0, T[i]));
      const sp = Math.min(1, Math.max(0, (SL[i] - o.caution) / Math.max(o.maxSlope - o.caution, 1e-6)));
      cost[i] = 1 + o.riskW * risk * risk + o.slopeW * sp * sp;
      blocked[i] = (SL[i] > o.maxSlope || (BL[i] > 0.5 && o.maxSlope <= 20)) ? 1 : 0;
    }
    return { cost, blocked };
  }
  class Heap {
    constructor() { this.k = []; this.v = []; }
    push(key, val) {
      const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
      while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
      k[i] = key; v[i] = val;
    }
    pop() {
      const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
      if (n) {
        let i = 0;
        while (true) {
          let c = 2 * i + 1; if (c >= n) break;
          if (c + 1 < n && k[c + 1] < k[c]) c++;
          if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c;
        }
        k[i] = lk; v[i] = lv;
      }
      return top;
    }
    get size() { return this.k.length; }
  }
  function nearestFree(blocked, r, c) {
    if (!blocked[r * G + c]) return [r, c];
    for (let rad = 1; rad < 40; rad++)
      for (let dr = -rad; dr <= rad; dr++)
        for (let dc = -rad; dc <= rad; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= G || cc >= G) continue;
          if (!blocked[rr * G + cc]) return [rr, cc];
        }
    return [r, c];
  }
  const NB = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [1, 1, Math.SQRT2]];
  let cache = null, cacheKey = "";
  MR.astar = function (fromLL, toLL, opts) {
    const o = Object.assign({}, MR.cfg, opts || {});
    const key = [o.riskW, o.slopeW, o.maxSlope, o.caution].join("|");
    if (key !== cacheKey) { cache = buildCost(o); cacheKey = key; }
    const { cost, blocked } = cache;
    const [sr, sc] = nearestFree(blocked, ...MR.cellOf(fromLL[0], fromLL[1]));
    const [gr, gc] = nearestFree(blocked, ...MR.cellOf(toLL[0], toLL[1]));
    const n = G * G, best = new Float64Array(n).fill(Infinity), parent = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
    const s = sr * G + sc, g = gr * G + gc, h = (r, c) => Math.hypot(r - gr, c - gc);
    best[s] = 0; const heap = new Heap(); heap.push(h(sr, sc), s);
    let expanded = 0;
    while (heap.size) {
      const i = heap.pop(); if (closed[i]) continue; closed[i] = 1; expanded++;
      if (i === g) break;
      const r = (i / G) | 0, c = i - r * G;
      for (const [dr, dc, st] of NB) {
        const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= G || cc >= G) continue;
        const j = rr * G + cc; if (closed[j] || blocked[j]) continue;
        const cand = best[i] + st * 0.5 * (cost[i] + cost[j]);
        if (cand < best[j]) { best[j] = cand; parent[j] = i; heap.push(cand + h(rr, cc), j); }
      }
    }
    if (!isFinite(best[g])) return null;
    const cells = []; for (let i = g; i !== -1; i = parent[i]) cells.push(i); cells.reverse();
    const pts = cells.map(i => {
      const r = (i / G) | 0, c = i - r * G; const [lon, lat] = MR.cellCenter(r, c);
      return [lon, lat, 0, MR.F.dem[i], MR.F.slope[i], MR.F.roughness[i], MR.F.traversability[i]];
    });
    pts[0][0] = fromLL[0]; pts[0][1] = fromLL[1];
    const out = MR.withKm(smooth(pts));
    out.expanded = expanded; out.cost = best[g];
    return out;
  };
  // light smoothing of the polyline (moving average of 3) so it does not look stepped
  function smooth(pts) {
    if (pts.length < 4) return pts;
    return pts.map((p, i) => {
      if (i === 0 || i === pts.length - 1) return p;
      const a = pts[i - 1], b = pts[i + 1];
      return [(a[0] + p[0] * 2 + b[0]) / 4, (a[1] + p[1] * 2 + b[1]) / 4, 0, p[3], p[4], p[5], p[6]];
    });
  }
  // joins several consecutive A* segments
  MR.chain = function (stops, opts) {
    let all = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const seg = MR.astar(stops[i], stops[i + 1], opts); if (!seg) return null;
      all = all.concat(i ? seg.slice(1) : seg);
    }
    return MR.withKm(all);
  };
  // densifies a lon/lat polyline (every ~150 m) and adds the terrain attributes to it
  MR.densify = function (lls, stepKm = 0.15) {
    const out = [];
    for (let i = 0; i < lls.length - 1; i++) {
      const a = lls[i], b = lls[i + 1], n = Math.max(1, Math.ceil(MR.distKm(a, b) / stepKm));
      for (let k = 0; k < n; k++) {
        const lon = a[0] + (b[0] - a[0]) * (k / n), lat = a[1] + (b[1] - a[1]) * (k / n);
        out.push([lon, lat, 0, MR.sample("dem", lon, lat), MR.sample("slope", lon, lat), MR.sample("roughness", lon, lat), MR.sample("traversability", lon, lat)]);
      }
    }
    const l = lls[lls.length - 1];
    out.push([l[0], l[1], 0, MR.sample("dem", l[0], l[1]), MR.sample("slope", l[0], l[1]), MR.sample("roughness", l[0], l[1]), MR.sample("traversability", l[0], l[1])]);
    return MR.withKm(out);
  };
  // index of the route point closest to a lon/lat (from a minimum index)
  MR.nearestIdx = function (pts, ll, from = 0) {
    let bi = from, bd = Infinity;
    for (let i = from; i < pts.length; i++) { const d = MR.distKm(pts[i], ll); if (d < bd) { bd = d; bi = i; } }
    return { i: bi, d: bd };
  };
  MR.distToRoute = function (pts, ll) {
    let bd = Infinity; for (let i = 0; i < pts.length; i += 3) bd = Math.min(bd, MR.distKm(pts[i], ll)); return bd;
  };

  /* ---------- color palettes for layers ---------- */
  function ramp(stops) {
    return t => {
      t = Math.min(1, Math.max(0, t));
      for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
        const a = stops[i - 1], b = stops[i], u = (t - a[0]) / (b[0] - a[0] || 1);
        return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
      }
      const l = stops[stops.length - 1]; return [l[1], l[2], l[3]];
    };
  }
  MR.LAYERS = [
    { key: "traversability", name: "Traversability", sub: "Model prediction (0–1)", lo: "Hard", hi: "Easy", prov: "der", provLabel: "DERIVED",
      norm: v => v, ramp: ramp([[0, 196, 40, 40], [0.45, 240, 178, 60], [1, 18, 140, 80]]),
      src: "Random forest trained on Curiosity's actual traverse. Features: slope, roughness, optical texture, gradient and thermal." },
    { key: "hazard", name: "Not-recommended zones", sub: "High slope or hard passage", lo: "", hi: "Avoid", prov: "der", provLabel: "DERIVED",
      src: "Cells with slope above the critical threshold or traversability below the warning threshold. Adjustable in Route → Thresholds." },
    { key: "slope", name: "Slope", sub: "Degrees, from the MOLA/HRSC DEM", lo: "0°", hi: "30°+", prov: "der", provLabel: "DERIVED",
      norm: v => v / 30, ramp: ramp([[0, 255, 247, 220], [0.3, 250, 200, 90], [0.6, 220, 90, 40], [1, 120, 10, 30]]),
      src: "Derived from the MOLA/HRSC elevation model (200 m) resampled to 44 m." },
    { key: "roughness", name: "Roughness", sub: "Local std. deviation of height", lo: "Smooth", hi: "Rough", prov: "der", provLabel: "DERIVED",
      norm: v => v / 40, ramp: ramp([[0, 240, 240, 250], [0.5, 140, 120, 200], [1, 50, 20, 100]]),
      src: "Standard deviation of elevation in 7 × 7 cell windows." },
    { key: "thermal", name: "Daytime thermal", sub: "THEMIS IR (relative)", lo: "Cold", hi: "Warm", prov: "obs", provLabel: "OBSERVED",
      norm: v => v / 255, ramp: ramp([[0, 10, 10, 40], [0.35, 120, 30, 110], [0.7, 240, 110, 40], [1, 255, 240, 160]]),
      src: "Daytime infrared THEMIS mosaic at 100 m (ASU JMARS). Helps distinguish exposed rock from dust." },
    { key: "color_index", name: "Color index", sub: "Viking MDIM (red − blue)", lo: "Bluish", hi: "Reddish", prov: "obs", provLabel: "OBSERVED",
      norm: v => (v - D.layers.color_index.min) / (D.layers.color_index.max - D.layers.color_index.min),
      ramp: ramp([[0, 40, 90, 170], [0.5, 235, 235, 235], [1, 190, 50, 30]]),
      src: "Viking MDIM 2.1 color mosaic. Anomalies point to changes in soil composition." },
    { key: "confidence", name: "Model confidence", sub: "Agreement among the 300 trees", lo: "Low", hi: "High", prov: "der", provLabel: "DERIVED",
      norm: v => v, ramp: ramp([[0, 252, 236, 210], [0.5, 150, 172, 205], [1, 28, 66, 148]]),
      src: "How much the 300 trees of the random forest agree on a cell (1 = all agree). Note: agreement does not guarantee correctness; outside the corridor where it trained (Curiosity, 19 km) they can all be wrong together. See Conditions → Predictive model." },
    { key: "radiation", name: "Radiation", sub: "Relative exposure index", lo: "Lower", hi: "Higher", prov: "sim", provLabel: "SIMPLIFIED",
      norm: v => { const r = MR.radiation.range; return (v - r[0]) / Math.max(1e-6, r[1] - r[0]); },
      ramp: ramp([[0, 235, 247, 235], [0.45, 250, 222, 110], [1, 170, 30, 110]]),
      src: "Simplified model, not a measurement. 1.00 = crater floor under open sky (≈ 0.65 mSv/day measured by MSL-RAD; Simonsen, NASA 2024). It rises with elevation (less atmosphere above) and drops where relief blocks the sky. The size of those two effects is an ASSUMPTION." },
    { key: "none", name: "No layer", sub: "Base map only", src: "", prov: "", provLabel: "" },
  ];
  if (!MR.F.confidence) MR.LAYERS.splice(MR.LAYERS.findIndex(l => l.key === "confidence"), 1);
  MR.layerRGBA = function (key) {
    const img = new ImageData(G, G);
    const L = MR.LAYERS.find(l => l.key === key);
    if (!L) return img;
    const isJez = MR.currentRegion === "jezero" && MR.J;
    const dataGrid = (isJez && MR.J[key]) ? MR.J[key] : (MR.F[key] || null);
    const slopeGrid = (isJez && MR.J.slope) ? MR.J.slope : MR.F.slope;
    const travGrid = (isJez && MR.J.traversability) ? MR.J.traversability : MR.F.traversability;

    for (let i = 0; i < G * G; i++) {
      let rgb = [0, 0, 0], a = 255;
      if (key === "hazard") {
        const bad = slopeGrid ? slopeGrid[i] > MR.cfg.critSlope : false;
        const low = travGrid ? travGrid[i] < MR.cfg.travThr : false;
        const blk = (!isJez && MR.F.blocked) ? MR.F.blocked[i] > 0.5 : (slopeGrid && slopeGrid[i] > 20);
        if (blk) rgb = [120, 0, 20];
        else if (bad) rgb = [196, 40, 40];
        else if (low) { rgb = [240, 150, 40]; a = 200; }
        else { rgb = [0, 0, 0]; a = 0; }
      } else if (dataGrid) {
        rgb = L.ramp(L.norm(dataGrid[i]));
      } else {
        a = 0;
      }
      img.data[i * 4] = rgb[0];
      img.data[i * 4 + 1] = rgb[1];
      img.data[i * 4 + 2] = rgb[2];
      img.data[i * 4 + 3] = a;
    }
    return img;
  };
  MR.cssRamp = function (L) {
    if (!L.ramp) return "";
    const stops = [0, 0.25, 0.5, 0.75, 1].map(t => { const c = L.ramp(t); return `rgb(${c.map(Math.round).join(",")}) ${t * 100}%`; });
    return `linear-gradient(90deg, ${stops.join(",")})`;
  };

  /* ---------- contour lines (marching squares) ---------- */
  MR.contours = function (step = 500) {
    const Z = MR.F.dem, segs = [];
    const lo = Math.ceil(D.layers.dem.min / step) * step;
    const sc = 1200 / G;
    for (let lv = lo; lv < D.layers.dem.max; lv += step) {
      const list = [];
      for (let r = 0; r < G - 1; r++) for (let c = 0; c < G - 1; c++) {
        const a = Z[r * G + c], b = Z[r * G + c + 1], cc = Z[(r + 1) * G + c + 1], d = Z[(r + 1) * G + c];
        const idx = (a > lv) * 8 + (b > lv) * 4 + (cc > lv) * 2 + (d > lv);
        if (idx === 0 || idx === 15) continue;
        const e = [];
        const it = (v1, v2) => (lv - v1) / (v2 - v1);
        if ((a > lv) !== (b > lv)) e.push([c + it(a, b), r]);
        if ((b > lv) !== (cc > lv)) e.push([c + 1, r + it(b, cc)]);
        if ((d > lv) !== (cc > lv)) e.push([c + it(d, cc), r + 1]);
        if ((a > lv) !== (d > lv)) e.push([c, r + it(a, d)]);
        if (e.length >= 2) list.push([(e[0][0] + .5) * sc, (e[0][1] + .5) * sc, (e[1][0] + .5) * sc, (e[1][1] + .5) * sc]);
        if (e.length === 4) list.push([(e[2][0] + .5) * sc, (e[2][1] + .5) * sc, (e[3][0] + .5) * sc, (e[3][1] + .5) * sc]);
      }
      segs.push({ level: lv, list });
    }
    return segs;
  };

  /* ---------- utilities ---------- */
  MR.esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  MR.clean = (s, max = 140) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max);
  MR.solTime = function (min) {
    const sol = Math.floor(min / 1440) + 1, m = ((min % 1440) + 1440) % 1440;
    const hh = String(Math.floor(m / 60)).padStart(2, "0"), mm = String(Math.floor(m % 60)).padStart(2, "0");
    return { sol, hour: m / 60, label: `Sol ${sol} · ${hh}:${mm}`, hm: `${hh}:${mm}` };
  };
  MR.store = {
    get(k, d) { try { const v = localStorage.getItem("mr_" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("mr_" + k, JSON.stringify(v)); } catch (e) { /* no storage available */ } },
  };
})();
