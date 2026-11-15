/* =========================================================
   globe3d.js — Visor planetario 3D global de Marte con Three.js
   Integración multi-capa NASA Mars Trek (MOLA, HRSC, TES, Viking),
   compositing en tiempo real sobre mallas DEM locales (Terrarium PNG),
   control de opacidad por capa, navegación cinemática y diseño responsive.
   ========================================================= */
(function () {
  "use strict";

  const MR = window.MR || (window.MR = {});
  const G3 = (MR.Globe3D = { ready: false });

  const BASE_URL = "https://trek.nasa.gov/tiles/Mars/EQ";
  const LOCAL_DEM_PATH = "3dView/dem_tiles";
  const SEGS = 48;                 // Resolución de malla por tesela (equilibrio velocidad/detalle)
  const RADIUS = 3;                // Radio de teselas visibles alrededor del centro (7x7)
  const M_PER_DEG = 59200;         // Metros por grado aproximado en Marte
  const $ = id => document.getElementById(id);

  let host, renderer, scene, camera, controls;
  let running = false, alive = true;
  let lastKey = "";
  let currentZ = 0;
  let currentNeeded = new Set();
  const tiles = new Map();         // clave -> { mesh, z, canvas, ctx, demImg, terr }
  const pending = new Set();
  const imageCache = new Map();    // url -> HTMLImageElement
  let fly = null;
  let raycaster, mouse;
  const beacons = [];

  // Grupos 3D para puntos de control, minerales y rutas
  let pinsGroup = null, routeGroup = null, roverGroup = null;
  let activeRouteMesh = null, doneRouteMesh = null, secRouteMeshes = [];
  let roverMesh = null, roverBeam = null;
  let lastState = null;
  const pins = [];

  const PIN_COLORS = {
    meta: 0xfc3d21,
    base: 0x1e64dc,
    refugio: 0x10b981,
    mineral: 0x2f7fb8,
    espectral: 0x2f7fb8,
    ciencia: 0xb5651d,
    referencia: 0xc0c8d4,
    hallazgo: 0x46c882,
    secundaria: 0xa68bff,
    propuesta: 0xa68bff
  };

  const MINERAL_COLORS = {
    "Carbonatos / Olivino": 0x00d26a,
    "Arcillas / Filosilicatos": 0x00c8e0,
    "Sulfatos hidratados": 0x4da6ff,
    "Óxidos de hierro": 0xff7043,
    "Silicatos basálticos": 0x90a4ae
  };

  // Catálogo oficial de capas NASA Mars Trek
  const TREK_LAYERS = [
    {
      id: "Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw",
      name: "MGS MOLA and Mars Express HRSC, Color Hillshade Blend",
      shortName: "MOLA/HRSC Color",
      category: "base",
      instrument: "MGS MOLA (NASA) + Mars Express HRSC (ESA)",
      resolution: "200 m/px",
      ext: "jpg",
      desc: "Modelo de elevación digital coloreado hipsométricamente con sombreado de relieve combinado de altimetría láser MOLA y la cámara estéreo de alta resolución HRSC.",
      legendText: "Rango hipsométrico: -8,200 m (azul/violeta) a +21,200 m (blanco/rojo)",
      thumb: "https://trek.nasa.gov/tiles/Mars/EQ/Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw/1.0.0/default/default028mm/0/0/0.jpg",
      visible: true,
      opacity: 1.0,
      isBase: true
    },
    {
      id: "Mars_MOLA_blend200ppx_HRSC_Shade_clon0dd_200mpp_lzw",
      name: "MGS MOLA and Mars Express HRSC, Hillshade Blend",
      shortName: "MOLA/HRSC Relieve",
      category: "base",
      instrument: "MGS MOLA (NASA) + Mars Express HRSC (ESA)",
      resolution: "200 m/px",
      ext: "jpg",
      desc: "Relieve sombreado pancromático (escala de grises) de alta definición morfológica, ideal para análisis estructural y visualización tectónica de fallas y cráteres.",
      legendText: "Sombreado morfológico unidireccional con acentuación de pendientes",
      thumb: "https://trek.nasa.gov/tiles/Mars/EQ/Mars_MOLA_blend200ppx_HRSC_Shade_clon0dd_200mpp_lzw/1.0.0/default/default028mm/0/0/0.jpg",
      visible: false,
      opacity: 1.0,
      isBase: true
    },
    {
      id: "Mars_Viking_MDIM21_ClrMosaic_global_232m",
      name: "Viking Orbiter, Color Mosaic MDIM 2.1",
      shortName: "Viking Color Real",
      category: "base",
      instrument: "Viking 1 & 2 Orbiter Visual Imaging System (VIS)",
      resolution: "232 m/px",
      ext: "jpg",
      desc: "Mosaico óptico fotográfico global en color real calibrado y balanceado espectralmente por el USGS a partir de miles de imágenes de los orbitadores Viking.",
      legendText: "Reflectancia óptica espectral del albedo superficial",
      thumb: "https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/0/0/0.jpg",
      visible: false,
      opacity: 1.0,
      isBase: true
    },
    {
      id: "TES_Thermal_Inertia",
      name: "MGS TES, Global Thermal Inertia",
      shortName: "Inercia Térmica (TES)",
      category: "overlay",
      instrument: "Mars Global Surveyor — Thermal Emission Spectrometer (TES)",
      resolution: "Global (3 km/px)",
      ext: "png",
      desc: "Mide la resistencia del suelo al cambio térmico diario. Valores bajos (azul/verde) revelan manto de polvo fino y dunas eólicas; valores altos (rojo/magenta) corresponden a roca madre consolidada o duricrust.",
      legendText: "Baja (polvo fino < 100 J m⁻² K⁻¹ s⁻½) → Alta (lecho rocoso > 600 J m⁻² K⁻¹ s⁻½)",
      thumb: "https://trek.nasa.gov/tiles/Mars/EQ/TES_Thermal_Inertia/1.0.0/default/default028mm/0/0/0.png",
      visible: false,
      opacity: 0.75,
      isBase: false
    },
    {
      id: "TES_Plagioclase",
      name: "MGS TES, Global Plagioclase Abundance",
      shortName: "Plagioclasa Mineral (TES)",
      category: "overlay",
      instrument: "Mars Global Surveyor — Thermal Emission Spectrometer (TES)",
      resolution: "Global (3 km/px)",
      ext: "png",
      desc: "Abundancia espectral volumétrica del mineral plagioclasa (feldespato alumínico-silicatado). Mineral primordial de la corteza ígnea primitiva de Marte y de sus basaltos volcánicos.",
      legendText: "0% Abundancia (azul oscuro) → 35%+ Abundancia (amarillo/rojo)",
      thumb: "https://trek.nasa.gov/tiles/Mars/EQ/TES_Plagioclase/1.0.0/default/default028mm/0/0/0.png",
      visible: false,
      opacity: 0.75,
      isBase: false
    }
  ];

  const cfg = {
    dem: "mola128_mola64_merge_90Nto90S_SimpleC_clon0",
    activeBase: "Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw",
    maxZ: 6,
    exag: 6.0,
    hmin: -8200,
    hmax: 21200,
    local: LOCAL_DEM_PATH
  };

  const LOCATIONS = [
    { id: "gale", name: "Cráter Gale", sub: "Curiosity Rover (Bradbury Landing)", lon: 137.4, lat: -4.6, elev: -4500, hCam: 4.5, color: 0x00e5ff },
    { id: "jezero", name: "Cráter Jezero", sub: "Perseverance Rover (Octavia E. Butler)", lon: 77.45, lat: 18.38, elev: -2500, hCam: 4.5, color: 0xff3b30 },
    { id: "olympus", name: "Olympus Mons", sub: "Volcán más alto del Sistema Solar (+21.2 km)", lon: -133.8, lat: 18.65, elev: 21200, hCam: 14, color: 0xffa000 },
    { id: "valles", name: "Valles Marineris", sub: "Gran Cañón Marciano (4,000 km)", lon: -59.0, lat: -14.0, elev: -3000, hCam: 22, color: 0x4caf50 },
    { id: "hellas", name: "Hellas Planitia", sub: "Mayor cuenca de impacto de Marte (-8.2 km)", lon: 70.0, lat: -42.0, elev: -8200, hCam: 16, color: 0xab47bc },
    { id: "global", name: "Vista Global", sub: "Órbita Planetaria Completa", lon: 0.0, lat: 0.0, elev: 0, hCam: 120, color: 0xffffff }
  ];

  /* ---------- Inicialización ---------- */
  G3.init = function () {
    if (G3.ready || !window.THREE) return !!window.THREE;
    host = $("mapGlobe");
    if (!host) return false;

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth || window.innerWidth, host.clientHeight || window.innerHeight);
    host.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    const sky = new THREE.Color(0x150906);
    scene.background = sky;
    scene.fog = new THREE.Fog(sky, 15, 85);

    camera = new THREE.PerspectiveCamera(45, (host.clientWidth || window.innerWidth) / (host.clientHeight || window.innerHeight), 0.001, 2500);
    camera.position.set(137.4, 4.5, 7.75);

    // Iluminación solar marciana
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xfff2e6, 1.2);
    sun.position.set(-1.2, 1.8, 0.7);
    scene.add(sun);

    // Controles tipo mapa optimizados para interacción táctil y ratón
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = false;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE
    };
    controls.touches = {
      ONE: THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_ROTATE
    };
    controls.minDistance = 0.03;
    controls.maxDistance = 260;
    controls.maxPolarAngle = Math.PI * 0.44;
    controls.target.set(137.4, 0, 4.6);
    camera.lookAt(controls.target);
    controls.update();

    pinsGroup = new THREE.Group();
    routeGroup = new THREE.Group();
    roverGroup = new THREE.Group();
    scene.add(pinsGroup);
    scene.add(routeGroup);
    scene.add(roverGroup);

    createBeacons();
    setupInteraction();
    renderLayersUI();

    window.addEventListener("resize", G3.resize);
    G3.ready = true;
    return true;
  };

  /* ---------- Gestión de Teselas y Capas ---------- */
  const tilesX = z => 2 ** (z + 1);
  const tilesY = z => 2 ** z;
  const tileDeg = z => 180 / 2 ** z;

  function getTileUrl(layerId, z, r, c, ext) {
    // Intenta primero mediante el proxy local con almacenamiento en caché permanente
    return `/api/proxy/trek?layer=${encodeURIComponent(layerId)}&z=${z}&r=${r}&c=${c}&ext=${ext}`;
  }

  function loadImageCached(url) {
    if (imageCache.has(url)) return Promise.resolve(imageCache.get(url));
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        imageCache.set(url, img);
        resolve(img);
      };
      img.onerror = () => {
        // Fallback directo a NASA Trek si el proxy falla
        if (url.startsWith("/api/proxy/trek")) {
          const u = new URL(url, window.location.origin);
          const layer = u.searchParams.get("layer");
          const z = u.searchParams.get("z");
          const r = u.searchParams.get("r");
          const c = u.searchParams.get("c");
          const ext = u.searchParams.get("ext");
          const remoteUrl = `${BASE_URL}/${layer}/1.0.0/default/default028mm/${z}/${r}/${c}.${ext}`;
          const fallbackImg = new Image();
          fallbackImg.crossOrigin = "anonymous";
          fallbackImg.onload = () => {
            imageCache.set(url, fallbackImg);
            resolve(fallbackImg);
          };
          fallbackImg.onerror = () => reject(new Error("Error cargando tesela: " + url));
          fallbackImg.src = remoteUrl;
          return;
        }
        reject(new Error("Error cargando: " + url));
      };
      img.src = url;
    });
  }

  // FBM procedimental para contingencia
  function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return (hash(xi, yi) * (1 - u) + hash(xi + 1, yi) * u) * (1 - v) +
           (hash(xi, yi + 1) * (1 - u) + hash(xi + 1, yi + 1) * u) * v;
  }
  function fbm(lon, lat) {
    let a = 0.55, f = 0.08, s = 0;
    for (let i = 0; i < 3; i++) { s += a * vnoise(lon * f, lat * f); f *= 2.2; a *= 0.5; }
    return s;
  }
  function ramp(t) {
    if (t <= 0.25) {
      const k = t / 0.25;
      return [(40 + 80 * k) / 255, (20 + 30 * k) / 255, (40 - 10 * k) / 255];
    } else if (t <= 0.5) {
      const k = (t - 0.25) / 0.25;
      return [(120 + 70 * k) / 255, (50 + 60 * k) / 255, (30 + 30 * k) / 255];
    } else if (t <= 0.75) {
      const k = (t - 0.5) / 0.25;
      return [(190 + 35 * k) / 255, (110 + 60 * k) / 255, (60 + 60 * k) / 255];
    } else {
      const k = Math.min(1, (t - 0.75) / 0.25);
      return [(225 + 25 * k) / 255, (170 + 70 * k) / 255, (120 + 115 * k) / 255];
    }
  }

  async function buildTile(z, r, c) {
    const key = `${z}/${r}/${c}`;
    const td = tileDeg(z);
    const lon0 = -180 + c * td, lat1 = 90 - r * td;

    // 1. Cargar DEM (primero local en 3dView/dem_tiles, luego remoto si no está)
    const loadDem = async () => {
      if (cfg.local) {
        try { return { img: await loadImageCached(`${cfg.local}/${z}/${r}/${c}.png`), terr: true }; } catch (e) {}
        try { return { img: await loadImageCached(`3dView/${cfg.local}/${z}/${r}/${c}.png`), terr: true }; } catch (e) {}
      }
      try { return { img: await loadImageCached(getTileUrl(cfg.dem, z, r, c, "png")), terr: false }; } catch (e) {}
      try { return { img: await loadImageCached(getTileUrl(cfg.dem, z, r, c, "jpg")), terr: false }; } catch (e) {}
      return null;
    };

    // 2. Determinar capa base activa y capas de superposición activas
    const baseLayerDef = TREK_LAYERS.find(l => l.id === cfg.activeBase) || TREK_LAYERS[0];
    const activeOverlays = TREK_LAYERS.filter(l => !l.isBase && l.visible && l.opacity > 0);

    const [demRes, baseImg, ...overlayImgs] = await Promise.all([
      loadDem(),
      loadImageCached(getTileUrl(baseLayerDef.id, z, r, c, baseLayerDef.ext)).catch(() => null),
      ...activeOverlays.map(ov => loadImageCached(getTileUrl(ov.id, z, r, c, ov.ext)).catch(() => null))
    ]);

    const demImg = demRes && demRes.img;
    const terr = !!(demRes && demRes.terr);

    let pix = null;
    if (demImg) {
      try {
        const cv = document.createElement("canvas");
        cv.width = demImg.width; cv.height = demImg.height;
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(demImg, 0, 0);
        pix = ctx.getImageData(0, 0, cv.width, cv.height);
      } catch (e) { pix = null; }
    }

    // 3. Crear geometría 3D a partir de la altimetría
    const n = SEGS + 1;
    const pos = new Float32Array(n * n * 3);
    const uvs = new Float32Array(n * n * 2);
    const colors = new Float32Array(n * n * 3);
    const idx = [];
    const k = cfg.exag / M_PER_DEG;

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const u = j / SEGS, v = i / SEGS;
        const lon = lon0 + u * td, lat = lat1 - v * td;
        let t, meters;
        if (pix) {
          const px = Math.min(pix.width - 1, Math.round(u * (pix.width - 1)));
          const py = Math.min(pix.height - 1, Math.round(v * (pix.height - 1)));
          const o = (py * pix.width + px) * 4;
          if (terr) {
            meters = pix.data[o] * 256 + pix.data[o + 1] + pix.data[o + 2] / 256 - 32768;
            t = Math.min(1, Math.max(0, (meters - cfg.hmin) / (cfg.hmax - cfg.hmin)));
          } else {
            t = pix.data[o] / 255;
            meters = cfg.hmin + t * (cfg.hmax - cfg.hmin);
          }
        } else {
          t = Math.min(1, Math.max(0, fbm(lon, lat) * 1.3 - 0.1));
          meters = cfg.hmin + t * (cfg.hmax - cfg.hmin);
        }
        const p = (i * n + j) * 3;
        pos[p] = lon;
        pos[p + 1] = meters * k - (cfg.maxZ - z) * 0.08 * cfg.exag;
        pos[p + 2] = -lat;
        uvs[(i * n + j) * 2] = u;
        uvs[(i * n + j) * 2 + 1] = 1 - v;
        const col = ramp(t);
        colors[p] = col[0]; colors[p + 1] = col[1]; colors[p + 2] = col[2];
      }
    }

    for (let i = 0; i < SEGS; i++) {
      for (let j = 0; j < SEGS; j++) {
        const a = i * n + j, b = a + 1, c2 = a + n, d = c2 + 1;
        idx.push(a, c2, b, b, c2, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setIndex(idx);

    // 4. Compositing en Canvas 2D (Capas apiladas con opacidad)
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 256;
    const ctx = cv.getContext("2d");

    function renderCanvasTexture() {
      ctx.clearRect(0, 0, 256, 256);
      if (baseImg) {
        ctx.globalAlpha = 1.0;
        ctx.drawImage(baseImg, 0, 0, 256, 256);
      }
      activeOverlays.forEach((ov, idxOv) => {
        const oImg = overlayImgs[idxOv];
        if (oImg && ov.visible && ov.opacity > 0) {
          ctx.globalAlpha = ov.opacity;
          ctx.drawImage(oImg, 0, 0, 256, 256);
        }
      });
      ctx.globalAlpha = 1.0;
    }

    renderCanvasTexture();

    const po = { polygonOffset: true, polygonOffsetFactor: -z, polygonOffsetUnits: -z };
    let mat;

    if (baseImg) {
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      mat = new THREE.MeshBasicMaterial({ map: tex, ...po });
    } else {
      geo.computeVertexNormals();
      mat = new THREE.MeshLambertMaterial({ vertexColors: true, ...po });
    }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = true;

    return {
      key,
      mesh,
      z,
      r,
      c,
      canvas: cv,
      ctx,
      baseImg,
      renderCanvasTexture
    };
  }

  function disposeTile(t) {
    scene.remove(t.mesh);
    t.mesh.geometry.dispose();
    if (t.mesh.material.map) t.mesh.material.map.dispose();
    t.mesh.material.dispose();
  }

  function ensure(z, r, c) {
    const key = `${z}/${r}/${c}`;
    if (tiles.has(key) || pending.has(key)) return;
    pending.add(key);
    buildTile(z, r, c).then(t => {
      pending.delete(key);
      if (!alive) { disposeTile(t); return; }
      tiles.set(key, t);
      scene.add(t.mesh);
      cleanup();
    });
  }

  function chooseZoom() {
    if (!controls) return 0;
    const h = Math.max(0.01, camera.position.distanceTo(controls.target));
    const span = 0.93 * h * (host.clientWidth / host.clientHeight > 1 ? 1 : host.clientHeight / host.clientWidth);
    const z = Math.round(Math.log2((180 * 3) / span));
    return Math.max(0, Math.min(cfg.maxZ, z));
  }

  function updateTiles() {
    if (!controls) return;
    const z = chooseZoom();
    currentZ = z;
    const td = tileDeg(z);
    const lon = controls.target.x, lat = -controls.target.z;
    const cc = Math.floor((lon + 180) / td), cr = Math.floor((90 - lat) / td);
    currentNeeded = new Set();

    // Nivel base z=0 para horizonte planetario
    for (let c = 0; c < tilesX(0); c++) {
      currentNeeded.add(`0/0/${c}`);
      ensure(0, 0, c);
    }
    // Teselas en la región focal actual
    for (let dr = -RADIUS; dr <= RADIUS; dr++) {
      for (let dc = -RADIUS; dc <= RADIUS; dc++) {
        const r = cr + dr, c = cc + dc;
        if (r < 0 || r >= tilesY(z) || c < 0 || c >= tilesX(z)) continue;
        currentNeeded.add(`${z}/${r}/${c}`);
        ensure(z, r, c);
      }
    }
    cleanup();
  }

  function cleanup() {
    for (const key of currentNeeded) if (!tiles.has(key)) return;
    for (const [key, t] of tiles) {
      if (!currentNeeded.has(key)) {
        disposeTile(t);
        tiles.delete(key);
      }
    }
  }

  /* ---------- Coordenadas y Elevación en el Planeta ---------- */
  function getElev(lon, lat, fallback = 0) {
    if (window.MR && typeof window.MR.sample === "function") {
      try {
        const s = window.MR.sample("dem", lon, lat);
        if (typeof s === "number" && !isNaN(s) && s !== 0) return s;
      } catch (e) {}
    }
    const allM = window.MARS_MINERALS || [];
    const m = allM.find(x => Math.abs(x.lon - lon) < 0.002 && Math.abs(x.lat - lat) < 0.002);
    if (m && typeof m.elev_m === "number") return m.elev_m;
    if (Math.abs(lon - 137.4) < 1.0 && Math.abs(lat - (-4.6)) < 1.0) return -4500;
    if (Math.abs(lon - 77.45) < 1.0 && Math.abs(lat - 18.38) < 1.0) return -2500;
    return fallback;
  }

  function toGlobeXYZ(lon, lat, lift = 0) {
    const k = cfg.exag / M_PER_DEG;
    const elev = getElev(lon, lat);
    return new THREE.Vector3(lon, elev * k + lift, -lat);
  }

  G3.project = function (lon, lat) {
    if (!camera || !renderer) return [0, 0];
    const v = toGlobeXYZ(lon, lat, 0.02);
    v.project(camera);
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    return [(v.x * 0.5 + 0.5) * w, (-(v.y * 0.5) + 0.5) * h];
  };

  G3.focus = function (lon, lat) {
    G3.flyTo(lon, lat, 2.5);
  };

  /* ---------- Balizas y Marcadores Planetarios ---------- */
  function createBeacons() {
    LOCATIONS.forEach(loc => {
      const group = new THREE.Group();
      const k = cfg.exag / M_PER_DEG;
      const yBase = loc.elev * k;

      // Anillo de pulso en la base (dimensiones refinadas para escala planetaria)
      const ringGeo = new THREE.RingGeometry(0.04, 0.10, 24);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({ color: loc.color, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      group.add(ring);

      // Haz cilíndrico luminoso
      const beamGeo = new THREE.CylinderGeometry(0.008, 0.016, 0.45, 12);
      beamGeo.translate(0, 0.225, 0);
      const beamMat = new THREE.MeshBasicMaterial({ color: loc.color, transparent: true, opacity: 0.75 });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      group.add(beam);

      // Prisma octaédrico flotante
      const octaGeo = new THREE.OctahedronGeometry(0.07, 0);
      octaGeo.translate(0, 0.52, 0);
      const octaMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
      const diamond = new THREE.Mesh(octaGeo, octaMat);
      group.add(diamond);

      group.position.set(loc.lon, yBase, -loc.lat);
      group.userData = { loc, diamond, ring, beam, initialY: yBase };
      scene.add(group);
      beacons.push(group);
    });
  }

  /* ---------- Puntos de Control y Minerales 3D ---------- */
  G3.updatePins = function (list) {
    if (!pinsGroup) return;
    while (pinsGroup.children.length > 0) {
      const g = pinsGroup.children[0];
      pinsGroup.remove(g);
      g.traverse(child => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
          }
        }
      });
    }
    pins.length = 0;

    (list || []).forEach(m => {
      const g = new THREE.Group();
      const pos = toGlobeXYZ(m.lon, m.lat, 0.002);
      g.position.copy(pos);

      const isMin = m.type === "mineral" || m.isMineral;
      let c = PIN_COLORS[m.type] || 0xffffff;
      if (isMin) {
        const cat = m.mineral && m.mineral.category;
        c = MINERAL_COLORS[cat] || 0x00d26a;
      }

      // Anillo de brillo en la base sobre el terreno
      const ringGeo = new THREE.RingGeometry(0.12, 0.32, 16);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, transparent: true, opacity: 0.65 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.01;
      g.add(ring);

      // Mástil vertical luminoso
      const stemGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.9, 8);
      stemGeo.translate(0, 0.45, 0);
      const stemMat = new THREE.MeshBasicMaterial({ color: c });
      const stem = new THREE.Mesh(stemGeo, stemMat);
      g.add(stem);

      let head;
      if (isMin) {
        const octaGeo = new THREE.OctahedronGeometry(0.24, 0);
        octaGeo.translate(0, 1.05, 0);
        const octaMat = new THREE.MeshLambertMaterial({
          color: c,
          emissive: c,
          emissiveIntensity: 0.55
        });
        head = new THREE.Mesh(octaGeo, octaMat);
        g.userData = {
          isMineral: true,
          mineral: m.mineral || m,
          diamond: head,
          onClick: m.onClick,
          label: m.label || (m.mineral && m.mineral.name)
        };
      } else {
        let headGeo;
        if (m.type === "meta") {
          headGeo = new THREE.ConeGeometry(0.22, 0.45, 6);
          headGeo.translate(0, 1.05, 0);
        } else if (m.type === "refugio") {
          headGeo = new THREE.CylinderGeometry(0.2, 0.22, 0.35, 6);
          headGeo.translate(0, 1.0, 0);
        } else if (m.type === "base") {
          headGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.35, 12);
          headGeo.translate(0, 1.0, 0);
        } else if (m.type === "hallazgo") {
          headGeo = new THREE.OctahedronGeometry(0.22, 0);
          headGeo.translate(0, 1.05, 0);
        } else {
          headGeo = new THREE.OctahedronGeometry(0.18, 0);
          headGeo.translate(0, 1.0, 0);
        }
        const headMat = new THREE.MeshBasicMaterial({ color: c });
        head = new THREE.Mesh(headGeo, headMat);
        g.userData = {
          isMineral: false,
          target: m,
          onClick: m.onClick,
          label: m.label || m.name
        };
      }
      g.add(head);

      pinsGroup.add(g);
      pins.push(g);
    });
  };

  /* ---------- Rutas en Tubo 3D y Rover ---------- */
  function buildGlobeTube(pts, color, radius, opacity = 1) {
    if (!pts || pts.length < 2) return null;
    const maxPts = 350;
    const step = Math.max(1, Math.floor(pts.length / maxPts));
    const v = [];
    const lift = 0.004 * (cfg.exag / 6) + 0.002;
    for (let i = 0; i < pts.length; i += step) {
      v.push(toGlobeXYZ(pts[i][0], pts[i][1], lift));
    }
    const lastPt = pts[pts.length - 1];
    v.push(toGlobeXYZ(lastPt[0], lastPt[1], lift));

    const clean = [];
    for (let i = 0; i < v.length; i++) {
      if (i === 0 || clean[clean.length - 1].distanceTo(v[i]) > 0.0001) {
        clean.push(v[i]);
      }
    }
    if (clean.length < 2) return null;

    const curve = new THREE.CatmullRomCurve3(clean);
    const segs = Math.min(1000, clean.length * 3);
    const geo = new THREE.TubeGeometry(curve, segs, radius, 6, false);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
    const mesh = new THREE.Mesh(geo, mat);
    if (routeGroup) routeGroup.add(mesh);
    return mesh;
  }

  G3.update = function (st) {
    if (!G3.ready) return;
    lastState = st || {};
    if (routeGroup) {
      while (routeGroup.children.length > 0) {
        const m = routeGroup.children[0];
        routeGroup.remove(m);
        if (m.geometry) m.geometry.dispose();
        if (m.material) m.material.dispose();
      }
    }
    activeRouteMesh = null;
    doneRouteMesh = null;
    secRouteMeshes = [];

    if (lastState.route && lastState.route.length >= 2) {
      activeRouteMesh = buildGlobeTube(lastState.route, 0x4d8dff, 0.0045, 0.95);
    }
    if (lastState.secondary && lastState.secondary.length) {
      secRouteMeshes = lastState.secondary.map(p => buildGlobeTube(p, 0xa68bff, 0.0035, 0.85)).filter(Boolean);
    }
    G3.updatePins(lastState.pins || []);
    G3.updatePos(lastState);
  };

  G3.updatePos = function (st) {
    if (!G3.ready) return;
    if (!st) st = lastState || {};
    else if (lastState) Object.assign(lastState, st);

    if (doneRouteMesh) {
      if (routeGroup) routeGroup.remove(doneRouteMesh);
      if (doneRouteMesh.geometry) doneRouteMesh.geometry.dispose();
      if (doneRouteMesh.material) doneRouteMesh.material.dispose();
      doneRouteMesh = null;
    }
    if (st.route && st.km > 0.05 && window.MR && window.MR.nearestKm) {
      const i = window.MR.nearestKm(st.route, st.km);
      const donePts = st.route.slice(0, Math.max(2, i + 1));
      doneRouteMesh = buildGlobeTube(donePts, 0x46c882, 0.0055, 1.0);
    }

    if (!roverMesh && roverGroup) {
      roverMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0x1e64dc })
      );
      roverBeam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.002, 0.002, 0.35, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 })
      );
      roverBeam.geometry.translate(0, 0.175, 0);
      roverGroup.add(roverMesh);
      roverGroup.add(roverBeam);
    }

    if (st.pos && roverMesh) {
      const p = toGlobeXYZ(st.pos[0], st.pos[1], 0.015);
      roverMesh.position.copy(p);
      roverBeam.position.copy(p);
      if (st.color) roverMesh.material.color.set(st.color);
      roverMesh.visible = roverBeam.visible = true;
    } else if (roverMesh) {
      roverMesh.visible = roverBeam.visible = false;
    }
  };

  function getInteractiveObjects() {
    const list = [];
    beacons.forEach(b => {
      if (!b.visible) return;
      b.traverse(c => {
        if (c.isMesh) {
          c._parentGroup = b;
          list.push(c);
        }
      });
    });
    if (pinsGroup) {
      pinsGroup.children.forEach(g => {
        if (!g.visible) return;
        g.traverse(c => {
          if (c.isMesh) {
            c._parentGroup = g;
            list.push(c);
          }
        });
      });
    }
    return list;
  }

  function setupInteraction() {
    if (!renderer) return;
    renderer.domElement.addEventListener("click", onGlobeClick);
    renderer.domElement.addEventListener("mousemove", onGlobeMouseMove);
    renderer.domElement.addEventListener("mouseleave", () => {
      if (window.MR && window.MR.hideTip) window.MR.hideTip();
    });
  }

  function onGlobeClick(e) {
    if (!G3.ready || !running) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const hitList = getInteractiveObjects();
    const hit = raycaster.intersectObjects(hitList, false);
    if (hit.length > 0) {
      const root = hit[0].object._parentGroup || hit[0].object;
      const u = root.userData;
      if (!u) return;
      if (u.loc) {
        const loc = u.loc;
        G3.flyTo(loc.lon, loc.lat, loc.hCam);
        showLocationCard(loc, e.clientX, e.clientY);
      } else if (u.isMineral) {
        if (u.onClick) u.onClick();
        else if (window.MR && window.MR.openMineralModal) window.MR.openMineralModal(u.mineral);
      } else if (u.target) {
        if (u.onClick) u.onClick();
      }
    }
  }

  function onGlobeMouseMove(e) {
    if (!G3.ready || !running) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const hitList = getInteractiveObjects();
    const hit = raycaster.intersectObjects(hitList, false);
    if (hit.length > 0) {
      renderer.domElement.style.cursor = "pointer";
      const root = hit[0].object._parentGroup || hit[0].object;
      const u = root.userData;
      if (u && window.MR && window.MR.showTip) {
        if (u.loc) {
          const hexCol = '#' + u.loc.color.toString(16).padStart(6, '0');
          window.MR.showTip(`<b>${u.loc.name}</b><br><span style="color:${hexCol};font-size:11px;">${u.loc.sub}</span>`, e.clientX, e.clientY);
        } else if (u.isMineral) {
          const min = u.mineral || {};
          const cat = min.category || "Depósito Mineral";
          const catCol = MINERAL_COLORS[cat] ? ('#' + MINERAL_COLORS[cat].toString(16).padStart(6, '0')) : "#00d26a";
          window.MR.showTip(`<b>${min.name || u.label}</b><br><span style="color:${catCol};font-size:11px;font-weight:600;">${cat}</span>${min.formula ? `<br><i style="font-size:11px;opacity:0.85;">${min.formula}</i>` : ''}`, e.clientX, e.clientY);
        } else if (u.target) {
          const t = u.target;
          const typeName = t.type ? (t.type.charAt(0).toUpperCase() + t.type.slice(1)) : 'Punto de Control';
          const pCol = PIN_COLORS[t.type] ? ('#' + PIN_COLORS[t.type].toString(16).padStart(6, '0')) : "var(--accent)";
          window.MR.showTip(`<b>${t.label || t.name || 'Punto de Control'}</b><br><span style="color:${pCol};font-size:11px;font-weight:600;">${typeName}</span>`, e.clientX, e.clientY);
        }
      }
    } else {
      renderer.domElement.style.cursor = "default";
      if (window.MR && window.MR.hideTip) window.MR.hideTip();
    }
  }

  function showLocationCard(loc, x, y) {
    const card = $("stageCard");
    if (!card) return;
    let extraActions = "";
    if (loc.id === "gale" || loc.id === "jezero") {
      extraActions = `
        <div class="card-btn-grp">
          <button class="btn btn-primary" id="btnExplore2D" style="flex:1;">Ver en Mapa 2D</button>
          <button class="btn" id="btnExplore3D" style="flex:1;">Ver Relieve Cráter 3D</button>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="card-head">
        <span class="badge" style="background:${loc.color}22;color:${loc.color};border:1px solid ${loc.color}55;">HITO PLANETARIO</span>
        <h3>${loc.name}</h3>
        <div class="sub">${loc.sub}</div>
      </div>
      <div class="card-facts">
        <div><b>Longitud:</b> ${loc.lon.toFixed(2)}°</div>
        <div><b>Latitud:</b> ${loc.lat.toFixed(2)}°</div>
        <div><b>Elevación de referencia:</b> ${(loc.elev).toLocaleString()} m</div>
      </div>
      ${extraActions}
      <button class="btn btn-close" id="btnCloseLocCard" style="margin-top:10px;width:100%;">Cerrar</button>
    `;

    card.hidden = false;
    card.style.top = Math.min(window.innerHeight - 240, Math.max(80, y - 50)) + "px";
    card.style.left = Math.min(window.innerWidth - 320, Math.max(20, x + 20)) + "px";

    $("btnCloseLocCard").addEventListener("click", () => { card.hidden = true; });
    const b2d = $("btnExplore2D");
    if (b2d) {
      b2d.addEventListener("click", () => {
        card.hidden = true;
        if (window.MR && window.MR.setRegion) {
          window.MR.setRegion(loc.id);
          const sel = $("regionSelect"); if (sel) sel.value = loc.id;
        }
        const b = document.querySelector('.viewswitch button[data-view="2d"]');
        if (b) b.click();
      });
    }
    const b3d = $("btnExplore3D");
    if (b3d) {
      b3d.addEventListener("click", () => {
        card.hidden = true;
        if (window.MR && window.MR.setRegion) {
          window.MR.setRegion(loc.id);
          const sel = $("regionSelect"); if (sel) sel.value = loc.id;
        }
        const b = document.querySelector('.viewswitch button[data-view="3d"]');
        if (b) b.click();
      });
    }
  }

  /* ---------- Interfaz de Capas NASA Mars Trek ---------- */
  function renderLayersUI() {
    const listEl = $("globeLayersList");
    if (!listEl) return;

    listEl.innerHTML = "";

    TREK_LAYERS.forEach(layer => {
      const card = document.createElement("div");
      card.className = "trek-layer-card" + (layer.visible ? " active" : "");
      card.dataset.layerId = layer.id;

      card.innerHTML = `
        <div class="tl-row">
          <img class="tl-thumb" src="${layer.thumb}" alt="${layer.shortName}" loading="lazy" />
          <div class="tl-info">
            <div class="tl-title">${layer.name}</div>
            <div class="tl-badge">${layer.instrument} · ${layer.resolution}</div>
          </div>
          <div class="tl-actions">
            <button class="tl-btn ${layer.visible ? 'on' : 'off'}" data-action="toggle" title="${layer.visible ? 'Ocultar capa' : 'Mostrar capa'}" aria-label="Visibilidad">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                ${layer.visible 
                  ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
                  : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'}
              </svg>
            </button>
            <button class="tl-btn" data-action="info" title="Información científica" aria-label="Información">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            </button>
          </div>
        </div>
        <div class="tl-slider-row" style="${layer.visible ? '' : 'display:none;'}">
          <span class="tl-pct">${Math.round(layer.opacity * 100)}%</span>
          <input type="range" class="tl-range" min="0" max="1" step="0.05" value="${layer.opacity}" data-action="opacity" />
        </div>
        <div class="tl-legend" style="${layer.visible ? '' : 'display:none;'}">${layer.legendText}</div>
      `;

      // Eventos de la tarjeta
      const btnToggle = card.querySelector('[data-action="toggle"]');
      btnToggle.addEventListener("click", () => {
        if (layer.isBase) {
          // Si es capa base, selecciona como activa exclusiva
          TREK_LAYERS.filter(l => l.isBase).forEach(l => { l.visible = false; });
          layer.visible = true;
          cfg.activeBase = layer.id;
        } else {
          layer.visible = !layer.visible;
        }
        renderLayersUI();
        G3.applyLayerChanges();
      });

      const btnInfo = card.querySelector('[data-action="info"]');
      btnInfo.addEventListener("click", () => showLayerInfoModal(layer));

      const rangeOpacity = card.querySelector('[data-action="opacity"]');
      if (rangeOpacity) {
        rangeOpacity.addEventListener("input", e => {
          layer.opacity = parseFloat(e.target.value);
          const pctEl = card.querySelector(".tl-pct");
          if (pctEl) pctEl.textContent = `${Math.round(layer.opacity * 100)}%`;
          G3.applyLayerChanges();
        });
      }

      listEl.appendChild(card);
    });
  }

  function showLayerInfoModal(layer) {
    const modal = $("modal");
    const scrim = $("scrim");
    if (!modal || !scrim) return;

    modal.innerHTML = `
      <header class="modal-head">
        <span class="badge">NASA MARS TREK · CAPA CIENTÍFICA</span>
        <h2>${layer.name}</h2>
        <div class="sub">${layer.instrument}</div>
      </header>
      <div class="modal-body" style="font-size:14px;line-height:1.5;">
        <div style="text-align:center;margin:12px 0;">
          <img src="${layer.thumb}" alt="${layer.name}" style="max-width:100%;height:140px;object-fit:cover;border-radius:8px;border:1px solid var(--border);" />
        </div>
        <p><b>Descripción:</b> ${layer.desc}</p>
        <p><b>Resolución espacial:</b> ${layer.resolution}</p>
        <p><b>Interpretación de colores:</b> ${layer.legendText}</p>
        <p><b>Fuente de datos:</b> Planetary Data System (PDS) / USGS Astrogeology / NASA Mars Trek API.</p>
      </div>
      <footer class="modal-actions">
        <button class="btn btn-primary" id="btnModalClose">Entendido</button>
      </footer>
    `;

    scrim.hidden = false;
    modal.hidden = false;

    $("btnModalClose").addEventListener("click", () => {
      scrim.hidden = true;
      modal.hidden = true;
    });
    scrim.onclick = () => {
      scrim.hidden = true;
      modal.hidden = true;
    };
  }

  /* Aplica cambios de capas en vivo sin recargar mallas si las texturas están disponibles */
  G3.applyLayerChanges = function () {
    // Si la capa base cambió, o se habilitó una capa no cargada, reconstruimos las teselas suavemente
    G3.resetTerrain();
  };

  /* ---------- Navegación y Vuelo (flyTo) ---------- */
  G3.flyTo = function (lon, lat, h, dur = 1600) {
    if (!controls) return;
    const actualDur = (window.MR && window.MR.reduceMotion && window.MR.reduceMotion()) ? 0 : dur;
    const t1 = new THREE.Vector3(lon, 0, -lat);
    const p1 = new THREE.Vector3(lon, h, -lat + h * 0.7);
    if (actualDur === 0) {
      controls.target.copy(t1);
      camera.position.copy(p1);
      camera.lookAt(t1);
      controls.update();
      fly = null;
      return;
    }
    fly = {
      t0: controls.target.clone(),
      p0: camera.position.clone(),
      t1, p1,
      s: performance.now(),
      d: actualDur
    };
  };

  G3.goToRegion = function (regionId) {
    if (regionId === "jezero") G3.flyTo(77.45, 18.38, 4.5);
    else if (regionId === "gale") G3.flyTo(137.4, -4.6, 4.5);
  };

  G3.setExag = function (val) {
    cfg.exag = Math.max(1, Math.min(30, val));
    beacons.forEach(b => {
      if (b.userData && b.userData.loc) {
        b.position.y = b.userData.loc.elev * (cfg.exag / M_PER_DEG);
      }
    });
    G3.resetTerrain();
    if (lastState) {
      G3.update(lastState);
    }
  };

  G3.setBaseLayer = function (layerId) {
    const l = TREK_LAYERS.find(x => x.id === layerId);
    if (l && l.isBase) {
      TREK_LAYERS.filter(x => x.isBase).forEach(x => { x.visible = false; });
      l.visible = true;
      cfg.activeBase = l.id;
      renderLayersUI();
      G3.resetTerrain();
    }
  };

  G3.toggleOverlay = function (overlayId) {
    const l = TREK_LAYERS.find(x => x.id === overlayId);
    if (l && !l.isBase) {
      l.visible = !l.visible;
      renderLayersUI();
      G3.resetTerrain();
    }
  };

  G3.resetTerrain = function () {
    for (const t of tiles.values()) disposeTile(t);
    tiles.clear();
    pending.clear();
    currentNeeded.clear();
    updateTiles();
  };

  /* ---------- Control del Bucle de Renderizado ---------- */
  G3.start = function () {
    if (!G3.ready) G3.init();
    running = true;
    G3.resize();
    renderLayersUI();
    updateTiles();
    if (lastState) {
      G3.update(lastState);
    }

    const loop = (now) => {
      if (!running) return;
      if (fly) {
        const k = Math.min(1, (now - fly.s) / fly.d);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        controls.target.lerpVectors(fly.t0, fly.t1, e);
        camera.position.lerpVectors(fly.p0, fly.p1, e);
        if (k >= 1) {
          fly = null;
          controls.update();
        }
      } else {
        controls.update();
      }

      // Limitar a los límites equirectangulares
      controls.target.x = Math.max(-180, Math.min(180, controls.target.x));
      controls.target.z = Math.max(-90, Math.min(90, controls.target.z));

      const dist = camera.position.distanceTo(controls.target);
      scene.fog.near = dist * 1.3;
      scene.fog.far = dist * 2.8 + 6;

      // Animación orbital y escala adaptativa de balizas planetarias (Gale, Jezero, etc.)
      const tSec = now * 0.0025;
      const baseBeaconScale = Math.max(0.12, Math.min(2.8, dist * 0.035));
      beacons.forEach((b, idx) => {
        const u = b.userData;
        if (!u || !u.loc) return;

        // Distancia euclidiana entre la cámara y la posición de la baliza
        const bDist = camera.position.distanceTo(b.position);

        // Si la cámara se aproxima a nivel regional/local (< 7.0 grados),
        // atenuar y reducir progresivamente los marcadores de Gale y Jezero
        // para que no tapen el cráter, la ruta ni los puntos de la misión
        if (u.loc.id === "gale" || u.loc.id === "jezero") {
          if (bDist < 7.0) {
            const fade = Math.max(0, (bDist - 2.8) / 4.2); // 0 a bDist <= 2.8, 1 a bDist >= 7.0
            if (fade <= 0.01) {
              b.visible = false;
            } else {
              b.visible = true;
              const s = baseBeaconScale * Math.max(0.15, fade);
              b.scale.set(s, s, s);
              if (u.ring && u.ring.material) u.ring.material.opacity = 0.8 * fade;
              if (u.beam && u.beam.material) u.beam.material.opacity = 0.75 * fade;
              if (u.diamond && u.diamond.material) u.diamond.material.opacity = fade;
            }
          } else {
            b.visible = true;
            b.scale.set(baseBeaconScale, baseBeaconScale, baseBeaconScale);
            if (u.ring && u.ring.material) u.ring.material.opacity = 0.8;
            if (u.beam && u.beam.material) u.beam.material.opacity = 0.75;
            if (u.diamond && u.diamond.material) u.diamond.material.opacity = 1.0;
          }
        } else {
          // Otros hitos planetarios globales (Olympus, Valles Marineris, Hellas)
          b.visible = true;
          b.scale.set(baseBeaconScale, baseBeaconScale, baseBeaconScale);
        }

        if (u.diamond) {
          u.diamond.rotation.y = tSec + idx;
          u.diamond.position.y = 0.52 + Math.sin(tSec * 2 + idx) * 0.03;
        }
      });

      // Animación de cristales minerales y escala adaptativa de pines
      const pinScale = Math.max(0.035, Math.min(1.2, dist * 0.045));
      if (pinsGroup) {
        pinsGroup.children.forEach((p, idx) => {
          p.scale.set(pinScale, pinScale, pinScale);
          if (p.userData && p.userData.diamond) {
            p.userData.diamond.rotation.y = tSec + idx * 0.7;
          }
        });
      }

      // Pulso del haz del rover
      if (roverBeam && roverBeam.visible) {
        roverBeam.material.opacity = 0.55 + Math.sin(now * 0.006) * 0.25;
      }

      // Reposicionar tarjeta emergente interactiva si está abierta
      if (window.MR && window.MR.UI && window.MR.UI.repositionPointUI) {
        window.MR.UI.repositionPointUI();
      }

      // Streaming de teselas dinámico al cambiar posición/zoom
      const zoom = chooseZoom();
      const td = tileDeg(zoom);
      const cellX = Math.floor((controls.target.x + 180) * 4 / td);
      const cellY = Math.floor((controls.target.z + 90) * 4 / td);
      const key = `${zoom}|${cellX}|${cellY}`;
      if (key !== lastKey) {
        lastKey = key;
        updateTiles();
      }

      // Lectura de coordenadas
      const readout = $("globeCoords");
      if (readout) {
        const altKm = (dist * M_PER_DEG / 1000).toFixed(0);
        readout.textContent = `Lon ${controls.target.x.toFixed(2)}°  Lat ${(-controls.target.z).toFixed(2)}°  ·  Altitud: ${altKm} km`;
      }

      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  };

  G3.stop = function () {
    running = false;
  };

  G3.resize = function () {
    if (!renderer || !host || !host.clientWidth) return;
    renderer.setSize(host.clientWidth, host.clientHeight);
    camera.aspect = host.clientWidth / host.clientHeight;
    camera.updateProjectionMatrix();
  };

  G3.getLayers = () => TREK_LAYERS;
})();
