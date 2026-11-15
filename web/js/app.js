/* =========================================================
   app.js — flujo de la expedición, simulación e interfaz
   Flujo: Mapa base → Briefing → Planear → Recorrer → Cima → Resumen
   ========================================================= */
(function () {
  "use strict";
  const MR = window.MR, D = MR.D, $ = id => document.getElementById(id);
  const esc = MR.esc, fmt = MR.fmt;
  MR.reduceMotion = () => document.documentElement.classList.contains("reduce") || matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* =====================================================
     TRIPULACIÓN — cada explorador hace su propio viaje
     ===================================================== */
  const CREW = [
    { id: "ev1", short: "EV1", role: "Comandante", color: "#1E64DC", main: "summit",
      title: "Llegar a la cima de Mount Sharp", goalId: "summit", profile: "sol_100" },
    { id: "ev2", short: "EV2", role: "Geóloga", color: "#B5651D", main: "crism",
      title: "Llegar a la huella espectral CRISM", goalId: "frt0000a091", profile: "sol_100" },
    { id: "ev3", short: "EV3", role: "Ingeniero", color: "#127846", main: "traverse_end",
      title: "Seguir la huella de Curiosity", goalId: "traverse_end", profile: "sol_4500" },
  ];
  const ONE_WAY_MIN = 12;           // retraso de comunicación Marte → Tierra (simulado)
  const MIN_PER_SEC = 2;            // x1 = 2 minutos marcianos por segundo real
  const EVA_START = 8, EVA_END = 17;

  function newTrip(c) {
    const base = MR.withKm(D.routes[c.main].points);
    return {
      crew: c, mode: "base", choice: "model", baseRoute: base, adjusted: null, shortRoute: null, route: null,
      profileMode: "segura", mobility: "astronaut", approval: null, alertTriggered: false,
      km: 0, simMin: EVA_START * 60, playing: false, speed: 1, stages: [], stageIdx: 0,
      findings: [], missions: [], log: [], ai: [], handled: {}, events: [], proposed: {},
      unread: { misiones: 1, bitacora: 0, hallazgos: 0 }, briefed: false, wx: null, lastWx: -1e9,
      lastTele: -1e9, flags: {}, alerts: 0, detours: 0, hazards: [], lows: [], stops: [], measure: null,
    };
  }
  const trips = {}; CREW.forEach(c => (trips[c.id] = newTrip(c)));
  let T = trips.ev1;
  const S = { view: "2d", layer: "hazard", opacity: 0.55, base: "relief", panel: null,
    types: { meta: 1, base: 1, mineral: 1, espectral: 1, ciencia: 1, referencia: 1 }, distMax: 60, logTab: "tierra", fTab: "todos" };
  const UI = (MR.UI = {});
  MR.state = () => T; // inspección (consola / pruebas)

  /* =====================================================
     UTILIDADES DE ESTADO
     ===================================================== */
  const activeRoute = () => T.route || (T.mode === "plan" ? planRoute() : null);
  function planRoute() { return T.choice === "short" ? T.shortRoute : (T.adjusted || T.baseRoute); }
  function posAt(route, km) {
    if (!route) return null;
    const i = MR.nearestKm(route, km); if (i === 0) return route[0];
    const a = route[i - 1], b = route[i], u = (km - a[2]) / ((b[2] - a[2]) || 1);
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, km, a[3] + (b[3] - a[3]) * u, b[4], b[5], b[6]];
  }
  const curPos = () => (T.route ? posAt(T.route, T.km) : null);
  const time = () => MR.solTime(T.simMin);
  function regionObjectives() {
    if (currentRegion === "jezero" && window.JEZERO_DATA && window.JEZERO_DATA.objetivos) {
      return window.JEZERO_DATA.objetivos;
    }
    return D.objetivos;
  }
  function goalObj(c = T.crew) {
    const list = regionObjectives();
    return list.find(o => o.id === c.goalId) || list[list.length - 1];
  }
  function makeStages(route) {
    const L = route[route.length - 1][2], n = Math.max(2, Math.min(5, Math.round(L / 14)));
    return Array.from({ length: n }, (_, i) => (L * (i + 1)) / n);
  }
  function recomputeHazards() {
    const r = activeRoute();
    T.hazards = r ? MR.hazardZones(r) : []; T.lows = r ? MR.lowTravZones(r) : [];
  }
  function bump(kind, n = 1) {
    T.unread[kind] = Math.max(0, (T.unread[kind] || 0) + n);
    renderRail(true, kind);
  }
  let idSeq = 1; const uid = p => p + Date.now().toString(36) + (idSeq++);

  /* =====================================================
     ARRANQUE
     ===================================================== */
  function init() {
    // tema y movimiento recordados
    const th = MR.store.get("theme", matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = th;
    if (MR.store.get("reduce", false)) { document.documentElement.classList.add("reduce"); $("btnMotion").setAttribute("aria-pressed", "true"); }

    MR.Map.init();
    MR.Map.setBase(S.base);
    MR.Map.setLayer(S.layer, S.opacity);
    MR.Map.drawTraverse(true); MR.Map.drawCrism(true);
    MR.Map.onClick(onMapClick);
    buildCrew(); buildLeftPanel(); bindTop(); bindKeys();
    if (window.innerWidth < 820) setLeft(false);
    renderAll();
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("reduce") === "1") document.documentElement.classList.add("reduce");
    const initReg = urlParams.get("region");
    if (initReg === "jezero") {
      const regSel = $("regionSelect");
      if (regSel) regSel.value = "jezero";
      switchRegion("jezero");
    }
    const initView = urlParams.get("view");
    if (initView === "globe" || initView === "3d" || initView === "2d") {
      setView(initView);
    }
    const initModal = urlParams.get("modal");
    const initTab = urlParams.get("tab");
    if (initTab === "atm" || initTab === "ter" || initTab === "mod") dashTab = initTab;
    MR.API.init();
    requestAnimationFrame(loop);
    if (initModal === "conditions") {
      openDashboard();
    } else if (initModal === "help") {
      openHelp();
    } else if (initModal === "none") {
      // Omite abrir briefing automáticamente en pruebas
    } else {
      setTimeout(() => {
        if (!MR.store.get("tourDone", false)) startTour(() => openMainBriefing());
        else openMainBriefing();
      }, 450);
    }
  }

  /* =====================================================
     BARRA DE ESTADO
     ===================================================== */
  function buildCrew() {
    const box = document.querySelector(".crew"); box.setAttribute("role", "radiogroup");
    CREW.forEach(c => {
      const b = document.createElement("button"); b.setAttribute("role", "radio"); b.dataset.id = c.id;
      b.innerHTML = `<span class="av" style="--c:${c.color}">${c.short.slice(2)}</span><span class="nm">${c.short}<span class="role"> · ${c.role}</span></span>`;
      b.title = `${c.short} · ${c.role}: ${c.title}. Cada explorador hace su viaje por separado.`;
      b.addEventListener("click", () => switchCrew(c.id));
      box.appendChild(b);
    });
  }
  function switchCrew(id) {
    if (T.crew.id === id) return;
    T.playing = false; closeAllTransient();
    T = trips[id];
    renderAll(true);
    MR.Map.fit();
    banner({ kind: "info", title: `${T.crew.short} · ${T.crew.role}`, sub: "Viaje independiente: su ruta, reloj y bitácora son propios.", ttl: 3500 });
    if (!T.briefed) setTimeout(openMainBriefing, 300);
  }
  let currentRegion = "gale";
  let currentLang = "es";

  function switchRegion(regionId) {
    if (regionId === currentRegion) return;
    currentRegion = regionId;
    T.playing = false;
    T.mode = "base";
    T.approval = null;
    MR.setRegion(regionId);
    const regSel = $("regionSelect");
    if (regSel && regSel.value !== regionId) regSel.value = regionId;
    document.querySelectorAll(".rqs-btn").forEach(b => b.classList.toggle("active", b.dataset.region === regionId));

    if (regionId === "jezero") {
      $("brandTitle").textContent = currentLang === "en" ? "Jezero Crater Mission" : "Misión Cráter Jezero";
      $("brandSub").textContent = currentLang === "en" ? "Jezero Crater · Mars (Perseverance)" : "Cráter Jezero · Marte (Perseverance)";
      banner({ kind: "info", title: "Región: Cráter Jezero", sub: "Misión Perseverance · Terreno y mosaico de Jezero activos.", ttl: 4000 });

      const jezRoute = (window.JEZERO_DATA && window.JEZERO_DATA.route) ? window.JEZERO_DATA.route.slice() : [];
      T.baseRoute = jezRoute;
      T.route = jezRoute.slice();
      T.adjusted = null;
      T.km = 0;
      S.layer = "none";
      MR.Map.setRegion("jezero");
      MR.Map.setLayer("none", 0);
      renderLayerList("jezero");
      renderLegend();
    } else {
      $("brandTitle").textContent = currentLang === "en" ? "Safe Route to Mount Sharp" : "Ruta a Mount Sharp";
      $("brandSub").textContent = currentLang === "en" ? "Gale Crater · Mars (Curiosity)" : "Cráter Gale · Marte (Curiosity)";
      banner({ kind: "info", title: "Región: Cráter Gale", sub: "Misión Curiosity · Terreno local y predicción activos.", ttl: 4000 });

      T.baseRoute = MR.withKm(D.routes[T.crew.main].points);
      T.route = T.baseRoute.slice();
      T.adjusted = null;
      T.km = 0;
      S.layer = "hazard";
      MR.Map.setRegion("gale");
      MR.Map.setLayer("hazard", S.opacity);
      renderLayerList("gale");
      renderLegend();
    }

    if (S.view === "3d" && MR.Scene3D && MR.Scene3D.ready) {
      MR.Scene3D.rebuild();
      sync3dTexture();
      const p = curPos();
      if (p) MR.Scene3D.focus(p[0], p[1]);
    } else if (S.view === "globe" && MR.Globe3D && MR.Globe3D.ready) {
      MR.Globe3D.goToRegion(regionId);
    }

    renderMineralsUI();
    renderRoutes(true);
    refreshMarkers();
    renderDock(true);
    renderStatus();
    renderObjList();
    renderStops();
    renderProfileMetrics();
    update3d();
  }

  function toggleLanguage() {
    currentLang = currentLang === "es" ? "en" : "es";
    const lbl = $("langLabel");
    if (lbl) lbl.textContent = currentLang.toUpperCase();
    if (currentLang === "en") {
      $("brandTitle").textContent = currentRegion === "jezero" ? "Jezero Crater Mission" : "Safe Route to Mount Sharp";
      $("brandSub").textContent = currentRegion === "jezero" ? "Jezero Crater · Mars" : "Gale Crater · Mars";
      $("btnReport").innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4h10l-1.5 3.5L16 11H6"/></svg>Report here`;
      toast("Language switched to English");
    } else {
      $("brandTitle").textContent = currentRegion === "jezero" ? "Misión Cráter Jezero" : "Ruta a Mount Sharp";
      $("brandSub").textContent = currentRegion === "jezero" ? "Cráter Jezero · Marte" : "Cráter Gale · Marte";
      $("btnReport").innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4h10l-1.5 3.5L16 11H6"/></svg>Reportar aquí`;
      toast("Idioma cambiado a Español");
    }
    renderStatus();
    renderProfileMetrics();
  }

  function triggerWeatherAlert() {
    T.playing = false; renderStatus(); T.alerts++;
    if (S.panel) togglePanel(null);
    $("stageCard").hidden = true;
    T.events.push({ t: T.simMin, c: "var(--danger)", txt: "Alerta crítica: tormenta de polvo MDA-GALE-14" });
    logSys("ALERTA CRÍTICA MDA-GALE-14: Viento 28.4 m/s (umbral: 20 m/s), Opacidad tau 2.15 (umbral: 1.50).");

    showModal(`<div class="mhead"><div class="tag-line"><span class="tg alert">Alerta meteorológica crítica · Simulación pausada</span></div>
      <h2>${MR.ICONS.warn}Tormenta de polvo y viento en MDA-GALE-14</h2>
      <div class="coords" style="color:var(--text-2);font-size:12px;margin-top:2px">Sol 1 · 11:30 LTST · Estación Gale (137.48°E, -4.68°S)</div></div>
      <div class="mbody">
        ${factsHtml([
          ["28,4 m/s", "Viento (Crítico > 20 m/s)"],
          ["2,15", "Opacidad \u03c4 (Crítico > 1.50)"],
          ["−64 °C", "Temp. ambiente"],
          ["Dunas Bagnold", "Corredor impactado"]
        ])}
        <div class="alt" style="margin-top:10px;padding:10px;border-left:3px solid var(--danger);background:var(--panel-2);border-radius:4px">
          <strong>Explicación del sistema predictivo:</strong><br>
          La estación MDA-GALE-14 reporta ráfagas severas y caída de visibilidad directa sobre el corredor de Bagnold Dunes.
          El cruce directo presenta alto riesgo de abrasión y atascamiento del vehículo.
          <br><strong>Recomendación:</strong> Replanificar de inmediato activando el <em>Perfil Seguro</em> para rodear la tormenta hacia Mount Sharp Base.
        </div>
        <div class="actions" style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">
          <button class="btn ghost" data-ignore>Mantener rumbo actual</button>
          <button class="btn primary" data-replan>Replanificar ruta segura</button>
        </div>
      </div>`, {
      cls: "critical", dismiss: false,
      bind: el => {
        el.querySelector("[data-ignore]").addEventListener("click", () => {
          closeModal();
          banner({ kind: "warn", title: "Alerta ignorada por el operador", sub: "Riesgo de daño en sensores y atasco en Bagnold Dunes.", ttl: 5000 });
          T.playing = true; renderStatus();
        });
        el.querySelector("[data-replan]").addEventListener("click", () => {
          closeModal();
          setRouteProfile("segura");
          const curP = curPos() || T.baseRoute[0];
          MR.API.sendReporte({
            id: uid("rep_storm_"),
            author: T.crew.id,
            type: "alerta_clima",
            lon: curP[0],
            lat: curP[1],
            elev: curP[3] || -4400,
            km: T.km,
            text: "Replanificación de emergencia por tormenta de polvo MDA-GALE-14 (viento 28.4 m/s, tau 2.15)",
            attachments: { wind: 28.4, tau: 2.15, simMin: T.simMin, station: "MDA-GALE-14" },
            sync_status: "local"
          });
          toast("Ruta replanificada: corredor este seguro hacia Mount Sharp Base");
          banner({ kind: "nominal", title: "Ruta replanificada con éxito", sub: "Evitando corredor de tormenta en MDA-GALE-14 · Refugio seguro verificado.", ttl: 6000 });
        });
      }
    });
  }

  function setRouteProfile(p) {
    T.profileMode = p;
    document.querySelectorAll("#profileSeg button").forEach(b => {
      b.setAttribute("aria-checked", b.dataset.profile === p);
    });
    if (p === "segura") {
      Object.assign(MR.cfg, { riskW: 5.0, slopeW: 4.0, maxSlope: 15 });
    } else if (p === "rapida") {
      Object.assign(MR.cfg, { riskW: 1.5, slopeW: 1.0, maxSlope: 20 });
    } else if (p === "cientifica") {
      Object.assign(MR.cfg, { riskW: 3.5, slopeW: 2.5, maxSlope: 18 });
    }
    $("riskW").value = MR.cfg.riskW; $("rwOut").textContent = fmt(MR.cfg.riskW, 1);
    $("slopeW").value = MR.cfg.slopeW; $("swOut").textContent = fmt(MR.cfg.slopeW, 1);
    $("maxSlope").value = MR.cfg.maxSlope; $("msOut").textContent = MR.cfg.maxSlope + "°";

    if (T.mode !== "walk") {
      recalcRoute();
    } else {
      renderProfileMetrics();
    }
    toast(`Perfil activo: ${p.toUpperCase()}`);
  }

  function setMobility(m) {
    if (m !== "astronaut") return;
    T.mobility = "astronaut";
    document.querySelectorAll("#mobilitySeg button").forEach(b => {
      b.setAttribute("aria-checked", b.dataset.mobility === m);
    });
    renderProfileMetrics();
    toast("Movilidad: EVA a pie (traje)");
  }

  function renderProfileMetrics() {
    const box = $("profileMetrics");
    if (!box) return;
    const r = activeRoute() || T.baseRoute;
    if (MR.routeApproval.matches(T.approval, planRoute(), currentRegion, T.profileMode)) {
      const resources = T.approval.resources;
      box.innerHTML = `<p>Estimación EVA del servidor · parámetros demostrativos</p>
        <p>Duración: ${fmt(resources.eva_time_min, 1)} min</p>
        <p>Oxígeno restante: ${fmt(resources.oxygen_pct, 1)}%</p>
        <p>Batería restante: ${fmt(resources.battery_pct, 1)}%</p>
        <p>Dosis estimada: ${fmt(resources.radiation_dose_msv, 3)} mSv</p>`;
      return;
    }
    const res = MR.routeResources(r, "astronaut");
    if (!res) { box.innerHTML = "<p>Sin ruta activa</p>"; return; }

    const modeLabel = "Traje EVA (a pie)";
    const shelterBadgeCls = res.shelterOk ? "ok" : "err";
    const shelterBadgeText = res.shelterOk ? "REFUGIO SIMULADO" : "SIN REFUGIO EN EL ESCENARIO";

    box.innerHTML = `
      <p>Estimación local provisional · no habilita el inicio de una EVA</p>
      <div class="metric-item">
        <span class="metric-lbl">Tiempo estimado</span>
        <span class="metric-val">${fmt(res.hours, 1)} h Sol</span>
      </div>
      <div class="metric-item">
        <span class="metric-lbl">Consumo O₂ (${fmt(res.o2Consumed, 0)} L)</span>
        <span class="metric-val" style="color:${res.o2Pct > 80 ? 'var(--danger)' : 'var(--nominal)'}">${fmt(res.o2Pct, 0)}% (reserva ${fmt(res.o2RemainingPct, 0)}%)</span>
      </div>
      <div class="metric-item">
        <span class="metric-lbl">Batería (${modeLabel})</span>
        <span class="metric-val" style="color:${res.battPct > 85 ? 'var(--danger)' : 'var(--nominal)'}">${fmt(res.battPct, 0)}%</span>
      </div>
      <div class="metric-item">
        <span class="metric-lbl">Dosis radiación</span>
        <span class="metric-val">${fmt(res.radDose, 3)} mSv</span>
      </div>
      <div class="metric-shelter">
        <span class="metric-lbl">${res.shelterName} (${fmt(res.shelterDistKm, 1)} km)</span>
        <span class="shelter-badge ${shelterBadgeCls}">${shelterBadgeText}</span>
      </div>
      ${!res.valid ? `<div class="warn" style="grid-column:1/-1;color:var(--danger);font-size:10px;margin-top:2px;">⚠️ ${esc(res.rejectionReason)}</div>` : ''}
    `;
  }

  function renderLayerList(region = currentRegion) {
    const list = $("layerList");
    if (!list) return;
    list.innerHTML = "";
    MR.LAYERS.forEach(L => {
      const isJezero = region === "jezero";
      const na = isJezero && !["none", "slope", "hazard", "roughness", "traversability"].includes(L.key);
      const b = document.createElement("button");
      b.className = "layer-opt";
      b.setAttribute("role", "radio");
      b.dataset.key = L.key;
      b.setAttribute("aria-checked", b.dataset.key === S.layer);
      if (na) b.classList.add("layer-na");
      const sw = L.key === "hazard" ? "repeating-linear-gradient(45deg,#C42828 0 4px,#F0963C 4px 8px)" : L.key === "none" ? "var(--panel-2)" : MR.cssRamp(L);
      const provBadge = na ? '<span class="badge-prov na">SOLO GALE</span>' : (L.provLabel ? `<span class="badge-prov ${L.prov}">${L.provLabel}</span>` : "");
      const subTxt = isJezero
        ? (L.key === "none" ? "Mosaico fotográfico CTX Jezero" : L.key === "slope" ? "Pendiente MOLA / HiRISE" : L.key === "hazard" ? "Obstáculos y escarpes de Jezero" : L.key === "roughness" ? "Rugosidad local MOLA" : "Facilidad de paso Perseverance")
        : L.sub;
      b.innerHTML = `<span class="sw" style="background:${sw}"></span>` +
        `<span><b>${L.name}</b><small>${na ? "Solo disponible en Gale (THEMIS/Viking local)" : subTxt}</small></span>` +
        `<span class="right-wrap" style="display:flex;align-items:center;gap:4px">${provBadge}${L.src ? '<span class="info" tabindex="0" aria-label="Fuente">?</span>' : ''}</span>`;
      b.addEventListener("click", () => {
        if (na) { toast(`La capa «${L.name}» es específica del Cráter Gale (THEMIS IR).`); return; }
        S.layer = L.key;
        MR.Map.setLayer(S.layer, S.opacity);
        renderLegend();
        sync3dTexture();
      });
      const inf = b.querySelector(".info");
      if (inf) {
        const show = e => { const r = inf.getBoundingClientRect(); MR.showTip(esc(L.src), r.right, r.top + 4); e.stopPropagation(); };
        inf.addEventListener("mouseenter", show); inf.addEventListener("focus", show);
        inf.addEventListener("mouseleave", MR.hideTip); inf.addEventListener("blur", MR.hideTip);
        inf.addEventListener("click", e => { e.stopPropagation(); show(e); });
      }
      list.appendChild(b);
    });
  }

  /* =====================================================
     BÚSQUEDA CIENTÍFICA Y VISOR DE MINERALES
     ===================================================== */
  let activeMineralCategory = "Todos";
  let mineralSearchQuery = "";
  let scientificSearchMode = false;

  const MINERAL_CATEGORIES = [
    "Todos",
    "Minerales hidratados",
    "Arcillas / Filosilicatos",
    "Sulfatos hidratados",
    "Óxidos de hierro",
    "Carbonatos / Olivino",
    "Silicatos basálticos"
  ];

  function getRegionMinerals() {
    const all = window.MARS_MINERALS || [];
    const reg = currentRegion || "gale";
    return all.filter(m => m.region === reg);
  }

  function matchesCategory(m, cat) {
    if (cat === "Todos") return true;
    if (cat === "Minerales hidratados") {
      return (
        m.category.includes("hidratados") ||
        m.category.includes("Arcillas") ||
        m.category.includes("Sulfatos") ||
        m.category.includes("Sílice") ||
        m.category.includes("Filosilicatos")
      );
    }
    return m.category === cat || m.category.includes(cat);
  }

  function renderMineralsUI() {
    const regBadge = $("minRegionBadge");
    if (regBadge) {
      const reg = currentRegion || "gale";
      regBadge.textContent = reg === "jezero" ? "Cráter Jezero · Perseverance" : "Cráter Gale · Curiosity";
    }

    renderMineralChips();
    renderMineralsList();
  }

  function renderMineralChips() {
    const container = $("minCategoryChips");
    if (!container) return;
    container.innerHTML = "";

    MINERAL_CATEGORIES.forEach(cat => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "min-chip" + (cat === activeMineralCategory ? " active" : "");
      btn.dataset.cat = cat;
      // MARKUP EXACTO REQUERIDO POR ESPECIFICACIÓN:
      btn.innerHTML = `<span class="dot"><svg viewBox="0 0 24 24"><path d="M12 3l2.5 6 6.5.5-5 4 1.5 6.5L12 17l-5.5 3 1.5-6.5-5-4 6.5-.5z"></path></svg></span><span class="tag">${esc(cat)}</span>`;
      btn.addEventListener("click", () => {
        activeMineralCategory = cat;
        renderMineralChips();
        renderMineralsList();
      });
      container.appendChild(btn);
    });
  }

  function renderMineralsList() {
    const listEl = $("minList");
    const countEl = $("minCount");
    if (!listEl) return;
    listEl.innerHTML = "";

    const minerals = getRegionMinerals();
    const query = (mineralSearchQuery || "").toLowerCase().trim();
    const filtered = minerals.filter(m => {
      if (!matchesCategory(m, activeMineralCategory)) return false;
      if (!query) return true;
      return (
        m.name.toLowerCase().includes(query) ||
        m.formula.toLowerCase().includes(query) ||
        m.instrument.toLowerCase().includes(query) ||
        m.category.toLowerCase().includes(query) ||
        m.summary.toLowerCase().includes(query)
      );
    });

    if (countEl) {
      countEl.textContent = `${filtered.length} objetivo${filtered.length === 1 ? "" : "s"}`;
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty" style="padding:16px;text-align:center;color:var(--text-2);font-size:12px;">No se encontraron minerales con ese criterio en esta región.</div>`;
      return;
    }

    const r = activeRoute() || T.baseRoute;

    filtered.forEach(m => {
      const card = document.createElement("article");
      card.className = "min-card";
      card.dataset.minid = m.id;

      const d = r ? MR.distToRoute(r, [m.lon, m.lat]) : null;
      const distStr = d != null ? `${fmt(d)} km` : "";

      card.innerHTML = `
        <div class="min-card-top">
          <span class="min-badge" data-cat="${esc(m.category)}">
            <span class="dot"><svg viewBox="0 0 24 24"><path d="M12 3l2.5 6 6.5.5-5 4 1.5 6.5L12 17l-5.5 3 1.5-6.5-5-4 6.5-.5z"></path></svg></span>
            <span class="tag">${esc(m.category)}</span>
          </span>
          <span class="min-card-sol">${esc(m.rover.split(" ")[0])} · Sol ${m.sol}</span>
        </div>
        <div class="min-card-main">
          <div class="min-thumb">
            <img src="${m.image_url}" alt="${esc(m.name)}" loading="lazy" onerror="this.onerror=null;this.src='${m.fallback_url || 'assets/basemap_relief.jpg'}'">
          </div>
          <div class="min-card-details">
            <h4 class="min-card-title">${esc(m.name)}</h4>
            <div class="min-card-formula">${esc(m.formula)}</div>
            <div class="min-card-meta">
              <span>${esc(m.instrument.split("/")[0])}</span>
              ${distStr ? `<span>· a <strong>${distStr}</strong></span>` : ""}
            </div>
          </div>
        </div>
        <div class="min-card-actions">
          <button type="button" class="min-btn-sm" data-act="details">Examinar</button>
          <button type="button" class="min-btn-sm primary" data-act="stop" title="Añadir a las paradas de la ruta">${T.stops.includes(m.id) ? "Quitar parada" : "Fijar parada"}</button>
          <button type="button" class="min-btn-sm" data-act="fly3d" title="Ver en relieve 3D">Volar 3D</button>
        </div>
      `;

      card.querySelector('[data-act="details"]').addEventListener("click", ev => {
        ev.stopPropagation();
        openMineralModal(m);
      });
      card.querySelector('[data-act="stop"]').addEventListener("click", ev => {
        ev.stopPropagation();
        toggleMineralStop(m);
      });
      card.querySelector('[data-act="fly3d"]').addEventListener("click", ev => {
        ev.stopPropagation();
        flyToMineral(m);
      });
      card.addEventListener("click", () => {
        if (S.view === "3d" && MR.Scene3D && MR.Scene3D.ready) {
          MR.Scene3D.focus(m.lon, m.lat);
        } else if (S.view === "globe" && MR.Globe3D && MR.Globe3D.ready) {
          MR.Globe3D.flyTo(m.lon, m.lat, 2.5);
        } else {
          MR.Map.centerOn(m.lon, m.lat, 2.5);
        }
      });

      listEl.appendChild(card);
    });
  }

  function toggleMineralStop(m) {
    if (T.stops.includes(m.id)) {
      T.stops = T.stops.filter(x => x !== m.id);
      toast(`Parada removida: ${m.name}`);
    } else {
      T.stops.push(m.id);
      toast(`Parada añadida: ${m.name}`);
    }
    recalcRoute();
    renderStops();
    renderMineralsList();
  }

  function flyToMineral(m) {
    if (S.view === "globe") {
      if (MR.Globe3D && MR.Globe3D.ready) {
        MR.Globe3D.flyTo(m.lon, m.lat, 2.5);
      }
    } else {
      if (S.view !== "3d") {
        setView("3d");
      }
      if (MR.Scene3D && MR.Scene3D.ready) {
        MR.Scene3D.focus(m.lon, m.lat);
      }
    }
  }

  function openMineralModal(m) {
    closePointUI();
    const d = activeRoute() ? MR.distToRoute(activeRoute(), [m.lon, m.lat]) : null;
    const distStr = d != null ? `${fmt(d)} km` : "—";

    showModal(`
      <div class="mhead">
        <button type="button" class="modal-close-corner" data-close title="Cerrar modal" aria-label="Cerrar">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
        <div class="tag-line">
          <span class="min-badge" data-cat="${esc(m.category)}">
            <span class="dot"><svg viewBox="0 0 24 24"><path d="M12 3l2.5 6 6.5.5-5 4 1.5 6.5L12 17l-5.5 3 1.5-6.5-5-4 6.5-.5z"></path></svg></span>
            <span class="tag">${esc(m.category)}</span>
          </span>
          <span style="color:var(--text-2)">${esc(m.rover)} · Sol ${m.sol} · Sensor: ${esc(m.camera)}</span>
        </div>
        <h2 class="min-modal-title">${esc(m.name)}</h2>
        <div class="min-modal-formula-box">Fórmula química: <strong>${esc(m.formula)}</strong></div>
      </div>
      <div class="mbody min-modal-layout">
        <div class="min-modal-media">
          <div class="min-modal-photo-wrap">
            <img src="${m.image_url}" alt="${esc(m.image_title)}" onerror="this.onerror=null;this.src='${m.fallback_url || 'assets/basemap_relief.jpg'}'">
          </div>
          <div class="min-modal-caption">${esc(m.image_title)}</div>
          <a href="${m.nasa_raw_url}" target="_blank" rel="noopener noreferrer" class="min-nasa-link">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
            Ver fotos crudas en archivo NASA (${m.rover.includes("Curiosity") ? "MSL" : "Mars 2020"})
          </a>
          <div class="min-quick-facts">
            <div class="min-qfact"><span>Misión / Rover:</span><strong>${esc(m.rover)}</strong></div>
            <div class="min-qfact"><span>Sol marciano:</span><strong>Sol ${m.sol}</strong></div>
            <div class="min-qfact"><span>Instrumentos:</span><strong>${esc(m.instrument.split("/")[0])}</strong></div>
            <div class="min-qfact"><span>Cámara:</span><strong>${esc(m.camera.split("(")[0])}</strong></div>
            <div class="min-qfact"><span>Coordenadas:</span><strong>${m.lon.toFixed(4)}°E, ${m.lat.toFixed(4)}°N</strong></div>
            <div class="min-qfact"><span>Elevación MOLA:</span><strong>${m.elev_m} m</strong></div>
            <div class="min-qfact"><span>Distancia a ruta:</span><strong>${distStr}</strong></div>
          </div>
        </div>
        <div class="min-modal-content">
          <div class="min-field">
            <span class="min-field-lbl">Resumen geológico</span>
            <div class="min-field-val">${esc(m.summary)}</div>
          </div>
          <div class="min-field">
            <span class="min-field-lbl">Estratigrafía y condiciones de formación</span>
            <div class="min-field-val">${esc(m.geology)}</div>
          </div>
          <div class="min-field">
            <span class="min-field-lbl">Verificación instrumental y firma espectral</span>
            <div class="min-spec-box">
              <div style="margin-bottom:6px"><strong>Instrumentos analíticos:</strong> ${esc(m.instrument)}</div>
              <div><strong>Firma espectral orbital / in situ:</strong> ${esc(m.spectral_signature)}</div>
            </div>
          </div>
          <div class="min-modal-actions">
            <button type="button" class="btn ghost spacer" data-close>Cerrar</button>
            <button type="button" class="btn" data-fly>Volar en 3D</button>
            <button type="button" class="btn primary" data-stop>${T.stops.includes(m.id) ? "Quitar de paradas" : "Fijar como parada"}</button>
          </div>
        </div>
      </div>
    `, {
      cls: "mineral-modal",
      bind: el => {
        el.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeModal));
        el.querySelector("[data-fly]").addEventListener("click", () => {
          closeModal();
          flyToMineral(m);
        });
        el.querySelector("[data-stop]").addEventListener("click", () => {
          closeModal();
          toggleMineralStop(m);
        });
      }
    });
  }

  // Exponer para interacción Three.js 3D
  MR.openMineralModal = openMineralModal;

  function openRoverMaps() {
    const maps = {
      curiosity: { name: "Curiosity", region: "Gale", map: "https://mars.nasa.gov/maps/location/?mission=MSL&site=NOW", source: "https://science.nasa.gov/mission/msl-curiosity/location-map/" },
      perseverance: { name: "Perseverance", region: "Jezero", map: "https://mars.nasa.gov/maps/location/?mission=M20&site=NOW", source: "https://science.nasa.gov/mission/mars-2020-perseverance/location-map/" }
    };
    showModal(`<div class="mhead rover-map-head"><h2>Ubicación de los rovers</h2>
      <p class="who">Mapas oficiales de NASA: última posición publicada y recorrido. Los datos pueden tener retraso; no son telemetría en directo. Requieren conexión a internet.</p></div>
      <div class="mbody rover-map-body">
        <div class="rover-map-controls" role="group" aria-label="Seleccionar rover">
          <button class="btn" type="button" data-rover="curiosity">Curiosity · Gale</button>
          <button class="btn" type="button" data-rover="perseverance">Perseverance · Jezero</button>
          <a class="btn" data-source target="_blank" rel="noopener noreferrer">Abrir página de NASA ↗</a>
        </div>
        <p class="who rover-map-note">Si el mapa no carga, comprueba tu conexión o abre la página oficial de NASA.</p>
        <iframe class="rover-map-frame" title="Mapa oficial de ubicación del rover" loading="lazy" referrerpolicy="no-referrer"></iframe>
        <div class="actions"><button class="btn" type="button" data-close>Cerrar</button></div>
      </div>`, {
      cls: "rover-map-modal",
      onClose: () => { const frame = $("modal").querySelector("iframe"); if (frame) frame.removeAttribute("src"); },
      bind: el => {
        const frame = el.querySelector("iframe"), source = el.querySelector("[data-source]");
        function select(id) {
          const rover = maps[id];
          frame.src = rover.map;
          frame.title = `Mapa oficial de ${rover.name} en ${rover.region}`;
          source.href = rover.source;
          el.querySelectorAll("[data-rover]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.rover === id)));
        }
        el.querySelectorAll("[data-rover]").forEach(b => b.addEventListener("click", () => select(b.dataset.rover)));
        el.querySelector("[data-close]").addEventListener("click", closeModal);
        select(currentRegion === "jezero" ? "perseverance" : "curiosity");
      }
    });
  }

  function bindTop() {
    $("btnPlay").addEventListener("click", togglePlay);
    document.querySelectorAll(".speed button").forEach(b => b.addEventListener("click", () => setSpeed(+b.dataset.speed)));
    $("btnConditions").addEventListener("click", () => openDashboard());
    $("btnRovers").addEventListener("click", openRoverMaps);
    $("btnTheme").addEventListener("click", () => {
      const n = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = n; MR.store.set("theme", n); renderDock(true);
      if (!$("dashboard").hidden || (modalState && modalState.isDashboard)) renderDashboard();
    });
    $("btnMotion").addEventListener("click", e => {
      const on = !document.documentElement.classList.contains("reduce");
      document.documentElement.classList.toggle("reduce", on); e.currentTarget.setAttribute("aria-pressed", on); MR.store.set("reduce", on);
      toast(on ? "Movimiento reducido activado" : "Animaciones activadas");
    });
    $("btnHelp").addEventListener("click", openHelp);
    document.querySelectorAll(".viewswitch button").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
    document.querySelectorAll("#zoomCtl button").forEach(b => b.addEventListener("click", () => {
      const z = b.dataset.zoom; if (z === "in") MR.Map.zoom(1.4); else if (z === "out") MR.Map.zoom(1 / 1.4); else MR.Map.fit();
    }));
    document.querySelectorAll(".rail-btn").forEach(b => b.addEventListener("click", () => togglePanel(b.dataset.panel)));
    $("spClose").addEventListener("click", () => togglePanel(null));
    $("btnReport").addEventListener("click", reportHere);
    const regSel = $("regionSelect");
    if (regSel) regSel.addEventListener("change", e => switchRegion(e.target.value));
    document.querySelectorAll(".rqs-btn").forEach(b => {
      b.addEventListener("click", () => switchRegion(b.dataset.region));
    });
    const btnL = $("btnLang");
    if (btnL) btnL.addEventListener("click", toggleLanguage);
    $("exag").addEventListener("input", e => { const v = +e.target.value; $("exagOut").textContent = fmt(v, 1) + "×"; MR.Scene3D.setExag(v); });
    $("follow3d").addEventListener("change", e => MR.Scene3D.setFollow(e.target.checked));
    const l3d = $("layer3d"); if (l3d) l3d.addEventListener("change", e => MR.Scene3D.setLayerVisible(e.target.checked));
    const p3d = $("pins3d"); if (p3d) p3d.addEventListener("change", e => MR.Scene3D.setMineralsVisible(e.target.checked));
    document.querySelectorAll("[data-trekbase]").forEach(b => {
      b.addEventListener("click", () => MR.Scene3D && MR.Scene3D.setBasemap(b.dataset.trekbase));
    });
    document.querySelectorAll("[data-3dmode]").forEach(b => {
      b.addEventListener("click", () => MR.Scene3D && MR.Scene3D.setViewMode(b.dataset["3dmode"]));
    });

    // Controles del Planeta 3D Global
    const gExag = $("globeExag");
    if (gExag) {
      gExag.addEventListener("input", e => {
        const val = +e.target.value;
        const out = $("globeExagVal"); if (out) out.textContent = val + "×";
        if (MR.Globe3D && MR.Globe3D.ready) MR.Globe3D.setExag(val);
      });
    }

    const btnGlobeToggle = $("btnGlobeToggleMenu");
    if (btnGlobeToggle) {
      btnGlobeToggle.addEventListener("click", () => {
        const isExp = btnGlobeToggle.getAttribute("aria-expanded") === "true";
        btnGlobeToggle.setAttribute("aria-expanded", !isExp);
        const body = $("ctlGlobeBody");
        if (body) body.classList.toggle("open", !isExp);
      });
    }

    document.querySelectorAll("[data-base-layer]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-base-layer]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        if (MR.Globe3D && MR.Globe3D.ready) MR.Globe3D.setBaseLayer(btn.dataset.baseLayer);
      });
    });

    document.querySelectorAll("[data-ov-layer]").forEach(btn => {
      btn.addEventListener("click", () => {
        btn.classList.toggle("active");
        if (MR.Globe3D && MR.Globe3D.ready) MR.Globe3D.toggleOverlay(btn.dataset.ovLayer);
      });
    });

    document.querySelectorAll("[data-globe-go]").forEach(btn => {
      btn.addEventListener("click", () => {
        const [lon, lat, h] = btn.dataset.globeGo.split(",").map(Number);
        if (MR.Globe3D && MR.Globe3D.ready) MR.Globe3D.flyTo(lon, lat, h);
      });
    });
    const jumpG = $("btnJumpGlobe");
    if (jumpG) jumpG.addEventListener("click", () => setView("globe"));

    $("lpToggle").addEventListener("click", () => setLeft(!$("leftPanel").classList.contains("collapsed") ? false : true));
  }
  function setLeft(open) {
    $("leftPanel").classList.toggle("collapsed", !open); $("lpToggle").setAttribute("aria-expanded", open);
  }
  function setSpeed(v) {
    T.speed = v;
    document.querySelectorAll(".speed button").forEach(b => b.setAttribute("aria-checked", +b.dataset.speed === v));
  }
  function togglePlay() {
    if (T.mode !== "walk") return;
    if (!$("modal").hidden && $("modal").classList.contains("critical")) return;
    T.playing = !T.playing;
    if (T.playing) { $("stageCard").hidden = true; }
    renderStatus();
  }
  function renderStatus() {
    const modeTxt = { base: "Mapa base", plan: "Planear", walk: "Recorrer", done: "Misión completada" }[T.mode];
    $("modePill").textContent = modeTxt; $("modePill").dataset.mode = T.mode; document.body.dataset.mode = T.mode;
    $("clock").textContent = time().label;
    const L = activeRoute() ? activeRoute()[activeRoute().length - 1][2] : 0;
    $("kmReadout").textContent = `${fmt(T.km)} / ${fmt(L)} km`;
    const p = $("btnPlay"); p.disabled = T.mode !== "walk"; p.setAttribute("aria-pressed", T.playing);
    p.setAttribute("aria-label", T.playing ? "Pausar simulación" : "Iniciar simulación");
    document.querySelectorAll(".crew button").forEach(b => b.setAttribute("aria-checked", b.dataset.id === T.crew.id));
    document.querySelectorAll(".speed button").forEach(b => b.setAttribute("aria-checked", +b.dataset.speed === T.speed));
  }

  /* =====================================================
     PANEL IZQUIERDO — capas y filtros
     ===================================================== */
  const TYPE_INFO = {
    meta: ["Meta", "#FC3D21"], base: ["Base", "#1E64DC"], mineral: ["Minerales", "#2F7FB8"], espectral: ["Espectral", "#2F7FB8"],
    ciencia: ["Ciencia", "#B5651D"], referencia: ["Referencia", "#5B6878"],
  };
  function buildLeftPanel() {
    document.querySelectorAll("[data-lptab]").forEach(b => b.addEventListener("click", () => {
      document.querySelectorAll("[data-lptab]").forEach(x => x.setAttribute("aria-selected", x === b));
      document.querySelectorAll("[data-lpsec]").forEach(s => (s.hidden = s.dataset.lpsec !== b.dataset.lptab));
    }));
    document.querySelectorAll("#baseSeg button").forEach(b => b.addEventListener("click", () => {
      S.base = b.dataset.base; MR.Map.setBase(S.base);
      document.querySelectorAll("#baseSeg button").forEach(x => x.setAttribute("aria-checked", x === b));
      $("basemap").onload = () => sync3dTexture();
    }));
    renderLayerList("gale");
    $("opacity").addEventListener("input", e => { S.opacity = +e.target.value; $("overlay").style.opacity = S.opacity; sync3dTexture(); });
    $("chkContours").addEventListener("change", e => { MR.Map.setContours(e.target.checked); sync3dTexture(); });
    $("chkTraverse").addEventListener("change", e => MR.Map.drawTraverse(e.target.checked));
    $("chkCrism").addEventListener("change", e => MR.Map.drawCrism(e.target.checked));
    // objetivos
    const chips = $("typeChips");
    Object.entries(TYPE_INFO).forEach(([k, [name, c]]) => {
      const b = document.createElement("button"); b.className = "chip-t"; b.setAttribute("aria-pressed", "true");
      b.innerHTML = `<i style="--c:${c}"></i>${name}`;
      b.addEventListener("click", () => { S.types[k] = !S.types[k]; b.setAttribute("aria-pressed", !!S.types[k]); refreshMarkers(); renderObjList(); });
      chips.appendChild(b);
    });
    $("distFilter").addEventListener("input", e => { S.distMax = +e.target.value; $("distOut").textContent = S.distMax + " km"; refreshMarkers(); renderObjList(); });
    // minerales y búsqueda científica
    const minSearch = $("minSearch");
    if (minSearch) {
      minSearch.addEventListener("input", e => {
        mineralSearchQuery = e.target.value;
        renderMineralsList();
      });
    }
    const btnMinSci = $("btnMinSciMode");
    if (btnMinSci) {
      btnMinSci.addEventListener("click", () => {
        scientificSearchMode = !scientificSearchMode;
        btnMinSci.classList.toggle("active", scientificSearchMode);
        toast(scientificSearchMode ? "Modo científico activado: objetivos resaltados" : "Modo científico desactivado");
        refreshMarkers();
        update3d();
      });
    }
    renderMineralsUI();
    // perfiles de ruta
    document.querySelectorAll("#profileSeg button").forEach(b => {
      b.addEventListener("click", () => setRouteProfile(b.dataset.profile));
    });
    document.querySelectorAll("#mobilitySeg button").forEach(b => {
      b.addEventListener("click", () => setMobility(b.dataset.mobility));
    });
    const demoAlertBtn = $("btnDemoAlert");
    if (demoAlertBtn) demoAlertBtn.addEventListener("click", triggerWeatherAlert);
    // ruta
    const sl = (id, out, key, f) => $(id).addEventListener("input", e => { MR.cfg[key] = +e.target.value; $(out).textContent = f(+e.target.value); });
    sl("riskW", "rwOut", "riskW", v => fmt(v, 1)); sl("slopeW", "swOut", "slopeW", v => fmt(v, 1)); sl("maxSlope", "msOut", "maxSlope", v => v + "°");
    sl("critSlope", "critOut", "critSlope", v => v + "°"); sl("travThr", "travOut", "travThr", v => fmt(v, 2));
    ["critSlope", "travThr"].forEach(id => $(id).addEventListener("change", () => {
      recomputeHazards(); if (S.layer === "hazard") MR.Map.setLayer("hazard", S.opacity); renderRoutes(); renderDock(true);
      toast("Umbrales actualizados: alertas recalculadas");
    }));
    $("btnRecalc").addEventListener("click", recalcRoute);
    $("btnResetRoute").addEventListener("click", () => {
      Object.assign(MR.cfg, { riskW: 4, slopeW: 3, maxSlope: 20 });
      [["riskW", 4, "rwOut", "4"], ["slopeW", 3, "swOut", "3"], ["maxSlope", 20, "msOut", "20°"]].forEach(([i, v, o, t]) => { $(i).value = v; $(o).textContent = t; });
      T.adjusted = null; T.stops = [];
      if (T.mode === "walk") toast("En recorrido: usa Recalcular para cambiar la ruta desde tu posición");
      afterRouteChange(); renderStops(); renderMineralsList();
    });
    renderLegend(); renderObjList(); renderStops(); renderProfileMetrics();
  }
  function renderLegend() {
    const L = MR.LAYERS.find(l => l.key === S.layer);
    document.querySelectorAll(".layer-opt").forEach(b => b.setAttribute("aria-checked", b.dataset.key === S.layer));
    if (!L || L.key === "none") { $("legend").innerHTML = ""; return; }
    if (L.key === "hazard") {
      $("legend").innerHTML = `<div class="legend-row" style="display:grid;gap:4px">
        <span><i class="sq" style="--c:#780014"></i>Bloqueado (pendiente &gt; 20°)</span>
        <span><i class="sq" style="--c:#C42828"></i>Pendiente &gt; ${MR.cfg.critSlope}° (alerta crítica)</span>
        <span><i class="sq" style="--c:#F0963C"></i>Facilidad &lt; ${fmt(MR.cfg.travThr, 2)} (aviso)</span></div>`;
      return;
    }
    $("legend").innerHTML = `<div class="bar" style="background:${MR.cssRamp(L)}"></div><div class="ends"><span>${L.lo}</span><span>${L.hi}</span></div>`;
  }
  function filteredObjectives() {
    const r = activeRoute() || T.baseRoute;
    return regionObjectives().filter(o => S.types[o.type] && (S.distMax >= 60 || MR.distToRoute(r, [o.lon, o.lat]) <= S.distMax));
  }
  function renderObjList() {
    const ul = $("objList"); ul.innerHTML = "";
    const r = activeRoute() || T.baseRoute;
    filteredObjectives().forEach(o => {
      const li = document.createElement("li"); const b = document.createElement("button");
      const d = MR.distToRoute(r, [o.lon, o.lat]);
      b.innerHTML = `<b></b><small></small>`;
      b.querySelector("b").textContent = o.name;
      b.querySelector("small").textContent = `${TYPE_INFO[o.type][0]} · a ${fmt(d)} km de la ruta`;
      b.addEventListener("click", () => { MR.Map.centerOn(o.lon, o.lat, 2.2); setTimeout(() => openObjective(o), 350); });
      li.appendChild(b); ul.appendChild(li);
    });
    if (!ul.children.length) ul.innerHTML = `<li class="empty">Ningún objetivo cumple los filtros. Amplía la distancia o activa más tipos.</li>`;
  }
  function renderStops() {
    const box = $("stopList"); box.innerHTML = "";
    const minStops = (window.MARS_MINERALS || []).filter(m => T.stops.includes(m.id)).map(m => ({ id: m.id, name: m.name, lon: m.lon, lat: m.lat }));
    const cands = regionObjectives().filter(o => !["base", "meta"].includes(o.type) && o.id !== T.crew.goalId)
      .concat(T.missions.filter(m => m.origin === "propia" && m.status !== "completada").map(m => ({ id: m.id, name: m.name, lon: m.lon, lat: m.lat })))
      .concat(minStops);
    cands.forEach(o => {
      const d = MR.distToRoute(T.baseRoute, [o.lon, o.lat]);
      const l = document.createElement("label");
      l.innerHTML = `<input type="checkbox"><span></span><small>${fmt(d)} km</small>`;
      l.querySelector("span").textContent = o.name;
      const cb = l.querySelector("input"); cb.checked = T.stops.includes(o.id);
      cb.addEventListener("change", () => {
        T.stops = cb.checked ? (T.stops.includes(o.id) ? T.stops : T.stops.concat(o.id)) : T.stops.filter(x => x !== o.id);
        renderMineralsList();
      });
      box.appendChild(l);
    });
  }
  function stopLL(id) {
    const o = regionObjectives().find(x => x.id === id) ||
              T.missions.find(x => x.id === id) ||
              (window.MARS_MINERALS && window.MARS_MINERALS.find(x => x.id === id));
    return o ? [o.lon, o.lat] : null;
  }
  let routeRequestId = 0;
  function recalcRoute() {
    const requestId = ++routeRequestId;
    T.approval = null;
    const g = goalObj(); const goal = [g.lon, g.lat];
    const stops = T.stops.map(stopLL).filter(Boolean)
      .sort((a, b) => MR.nearestIdx(T.baseRoute, a).i - MR.nearestIdx(T.baseRoute, b).i);
    if (T.mode === "walk") {
      const p = curPos(); const i = MR.nearestKm(T.route, T.km);
      const rest = MR.chain([[p[0], p[1]], ...stops, goal]);
      if (!rest) return toast("No hay ruta posible con esos límites. Sube la pendiente máxima.");
      T.route = MR.withKm(T.route.slice(0, i).concat([p], rest.slice(1)));
      T.stages = makeStages(T.route).map(k => Math.max(k, T.km));
      afterRouteChange(); toast("Ruta recalculada desde tu posición");
      logSys("Ruta recalculada desde la posición actual con nuevos pesos.");
      return;
    }
    const t0 = performance.now();
    const r = MR.chain([[T.baseRoute[0][0], T.baseRoute[0][1]], ...stops, goal]);
    if (!r) return toast("No hay ruta posible con esos límites. Sube la pendiente máxima.");
    T.adjusted = r; T.choice = "model";
    if (T.mode === "base") T.mode = "plan";
    afterRouteChange(true);
    toast(`Ruta ajustada en ${Math.round(performance.now() - t0)} ms · ${fmt(r[r.length - 1][2])} km`);
    // con backend: se refina la misma ruta en la grilla completa de 44 m
    if (MR.API.online) {
      const trip = T, region = currentRegion, profile = T.profileMode || "segura", pts = [[T.baseRoute[0][0], T.baseRoute[0][1]], ...stops, goal];
      MR.API.route(pts, MR.cfg, profile, region).then(res => {
        if (requestId !== routeRequestId || region !== currentRegion || profile !== T.profileMode || trip !== T || T.mode !== "plan") return;
        if (!res) return toast("No se pudo validar la ruta con el servidor; se muestra la ruta local.");
        if (!res.is_valid || !Array.isArray(res.route) || res.route.length < 2) return toast(res.rejection_reason || "La ruta no fue validada por el servidor.");
        const approval = MR.routeApproval.create(res, region, profile);
        if (!approval) return toast("Respuesta de ruta incompleta; no se puede iniciar la EVA.");
        T.adjusted = approval.points;
        T.approval = approval;
        afterRouteChange(false);
        toast(`Ruta refinada por el backend (${T.profileMode || "segura"}) · ${fmt(T.adjusted[T.adjusted.length - 1][2])} km`);
      });
    }
  }
  function afterRouteChange(anim) { recomputeHazards(); renderRoutes(anim); renderDock(true); renderStatus(); refreshMarkers(); renderObjList(); renderProfileMetrics(); update3d(); }

  /* =====================================================
     MAPA — rutas y marcadores
     ===================================================== */
  function renderRoutes(animate) {
    const r = activeRoute();
    MR.Map.drawMain(r, T.hazards, animate);
    if (T.mode === "plan") {
      const other = T.choice === "short" ? (T.adjusted || T.baseRoute) : T.shortRoute;
      MR.Map.drawShort(other, MR.hazardZones(other || []));
    } else MR.Map.drawShort(null);
    MR.Map.drawDone(T.route, T.km, curPos());
    MR.Map.drawSecondary(T.missions.filter(m => m.path && m.status === "aceptada").map(m => m.path));
    MR.Map.drawMeasure(T.measure && T.measure.a, T.measure && T.measure.b);
    const p = curPos(); MR.Map.setAstronaut(p, T.crew.color, T.crew.short);
  }
  function refreshMarkers() {
    const list = [];
    filteredObjectives().forEach(o => {
      if (o.id === T.crew.goalId) return;
      list.push({ id: o.id, type: o.type, lon: o.lon, lat: o.lat, label: o.name, onClick: () => openObjective(o) });
    });
    // Objetivos científicos y minerales marcianos
    const minerals = getRegionMinerals();
    minerals.forEach(m => {
      list.push({
        id: m.id,
        type: "mineral",
        lon: m.lon,
        lat: m.lat,
        label: m.name,
        icon: "mineral",
        isMineral: true,
        mineral: m,
        onClick: () => openMineralModal(m)
      });
    });
    const g = goalObj();
    if (g) list.push({ id: "goal", type: "meta", lon: g.lon, lat: g.lat, label: "Meta · " + g.name, cls: "labeled", onClick: () => openObjective(g) });
    if (currentRegion === "gale" && T.crew.goalId !== "bradbury") {
      const b = D.objetivos[0]; if (S.types.base) list.push({ id: "start", type: "base", lon: b.lon, lat: b.lat, label: b.name, onClick: () => openObjective(b) });
    }
    T.missions.forEach(m => {
      if (m.status === "propuesta") list.push({ id: m.id, type: "propuesta", lon: m.lon, lat: m.lat, label: m.name, onClick: () => openSecondaryBriefing(m) });
      else list.push({ id: m.id, type: "secundaria", lon: m.lon, lat: m.lat, label: m.name + (m.status === "completada" ? " ✓" : ""), onClick: () => openMissionCard(m) });
    });
    T.findings.forEach(f => list.push({ id: f.id, type: "hallazgo", lon: f.lon, lat: f.lat, label: f.typeName, cls: f.fresh ? "new" : "", onClick: () => openFindingCard(f) }));
    if (T.measure) {
      if (T.measure.a) list.push({ id: "ma", type: "medida", lon: T.measure.a[0], lat: T.measure.a[1], label: "Punto A" });
      if (T.measure.b) list.push({ id: "mb", type: "medida", lon: T.measure.b[0], lat: T.measure.b[1], label: "Punto B" });
    }
    MR.Map.setMarkers(list);
    T.findings.forEach(f => (f.fresh = false));
    if (S.view === "3d" && MR.Scene3D && MR.Scene3D.ready) {
      MR.Scene3D.updatePins(list.filter(m => m.type !== "medida"));
    } else if (S.view === "globe" && MR.Globe3D && MR.Globe3D.ready) {
      const globeList = [...list.filter(m => m.type !== "medida")];
      const otherMinerals = (window.MARS_MINERALS || []).filter(m => m.region !== (currentRegion || "gale"));
      otherMinerals.forEach(m => {
        if (!globeList.some(x => x.id === m.id)) {
          globeList.push({ id: m.id, type: "mineral", lon: m.lon, lat: m.lat, label: m.name, isMineral: true, mineral: m, onClick: () => openMineralModal(m) });
        }
      });
      MR.Globe3D.updatePins(globeList);
    }
  }

  /* =====================================================
     JUNTO AL PUNTO — menú (3 opciones) y mini ficha
     ===================================================== */
  let anchor = null, picking = null;
  function onMapClick(ll, sx, sy) {
    if (picking) { const f = picking; picking = null; MR.Map.setPicking(false); f(ll); return; }
    if (S.panel && window.innerWidth < 820) togglePanel(null);
    openCtx(ll);
  }
  function terrainVerdict(ll) {
    const s = MR.sample("slope", ll[0], ll[1]), t = MR.sample("traversability", ll[0], ll[1]), bl = MR.sample("blocked", ll[0], ll[1]);
    if (bl > 0.5 || s > 20) return { cls: "bad", txt: `No transitable: pendiente ${fmt(s, 0)}° (bloqueo > 20°)` };
    if (s > MR.cfg.critSlope) return { cls: "bad", txt: `No recomendado: pendiente ${fmt(s, 0)}°` };
    if (t < MR.cfg.travThr) return { cls: "bad", txt: `No recomendado: paso difícil (${fmt(t, 2)})` };
    if (s > MR.cfg.caution || t < 0.5) return { cls: "warn", txt: "Transitable con precaución" };
    return { cls: "ok", txt: "Recomendado para caminar" };
  }
  function openCtx(ll) {
    closePointUI();
    anchor = { ll, el: $("ctxMenu") };
    const v = terrainVerdict(ll);
    const col = { ok: "var(--nominal)", warn: "var(--caution)", bad: "var(--danger)" }[v.cls];
    const ic = { ok: MR.ICONS.ok, warn: MR.ICONS.warn, bad: MR.ICONS.warn }[v.cls];
    $("ctxMenu").innerHTML = `
      <div class="readout"><b>${MR.fmtLL(ll[0], ll[1])}</b><br>
        Altura ${fmt(MR.sample("dem", ll[0], ll[1]), 0)} m · Pendiente ${fmt(MR.sample("slope", ll[0], ll[1]), 1)}° · Facilidad ${fmt(MR.sample("traversability", ll[0], ll[1]), 2)}
        <div class="verdict" style="color:${col}">${ic}<span>${v.txt}</span></div></div>
      <button role="menuitem" data-a="f">${MR.ICONS.meta}Registrar hallazgo aquí</button>
      <button role="menuitem" data-a="m">${MR.ICONS.secundaria}Crear misión aquí</button>
      <button role="menuitem" data-a="d"><svg viewBox="0 0 24 24"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg>Medir distancia</button>`;
    $("ctxMenu").hidden = false;
    $("ctxMenu").querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      closePointUI();
      if (b.dataset.a === "f") openFindingForm(ll);
      if (b.dataset.a === "m") openOwnBriefing({ lon: ll[0], lat: ll[1] });
      if (b.dataset.a === "d") startMeasure(ll);
    }));
    repositionPointUI();
    $("ctxMenu").querySelector("button").focus({ preventScroll: true });
  }
  function repositionPointUI() {
    if (!anchor) return;
    let x = 0, y = 0;
    if (S.view === "globe" && MR.Globe3D && MR.Globe3D.project) {
      [x, y] = MR.Globe3D.project(anchor.ll[0], anchor.ll[1]);
    } else if (S.view === "3d" && MR.Scene3D && MR.Scene3D.project) {
      [x, y] = MR.Scene3D.project(anchor.ll[0], anchor.ll[1]);
    } else if (MR.Map && MR.Map.project) {
      [x, y] = MR.Map.project(anchor.ll[0], anchor.ll[1]);
    }
    const el = anchor.el, st = $("stage"), w = el.offsetWidth, h = el.offsetHeight;
    let lx = x + 14, ly = y - 10;
    if (lx + w > st.clientWidth - 90) lx = x - w - 14;
    if (ly + h > st.clientHeight - 12) ly = st.clientHeight - h - 12;
    el.style.left = Math.max(8, lx) + "px"; el.style.top = Math.max(8, ly) + "px";
  }
  function closePointUI() { $("ctxMenu").hidden = true; $("miniCard").hidden = true; anchor = null; }
  UI.closePointUI = closePointUI; UI.repositionPointUI = repositionPointUI;
  function mini(ll, html, bind) {
    closePointUI(); const el = $("miniCard"); el.innerHTML = html; el.hidden = false;
    anchor = { ll, el }; repositionPointUI(); bind && bind(el);
    const f = el.querySelector("button, input, textarea"); f && f.focus({ preventScroll: true });
  }

  /* ---------- hallazgos ---------- */
  const FTYPES = [["mineral", "Mineral"], ["roca", "Roca"], ["otro", "Otro"]];
  function openFindingForm(ll) {
    let type = null, photo = null;
    mini(ll, `<h4>Hallazgo</h4><div class="coords">${MR.fmtLL(ll[0], ll[1])} · ${fmt(MR.sample("dem", ll[0], ll[1]), 0)} m</div>
      <div class="typepick" role="group" aria-label="Tipo (obligatorio)">${FTYPES.map(([k, n]) => `<button type="button" data-k="${k}" aria-pressed="false">${n}</button>`).join("")}</div>
      <label class="photo"><input type="file" accept="image/*"><span class="ph">+ Foto</span></label>
      <textarea rows="2" maxlength="140" placeholder="Nota (opcional): color, textura, tamaño…" aria-label="Nota"></textarea>
      <div class="actions"><button class="btn ghost" data-x>Cancelar</button><button class="btn primary" data-s disabled>Guardar en hallazgos</button></div>`, el => {
      el.querySelectorAll(".typepick button").forEach(b => b.addEventListener("click", () => {
        type = b.dataset.k; el.querySelectorAll(".typepick button").forEach(x => x.setAttribute("aria-pressed", x === b));
        el.querySelector("[data-s]").disabled = false;
      }));
      el.querySelector("input[type=file]").addEventListener("change", e => {
        const f = e.target.files[0]; if (!f || !/^image\//.test(f.type) || f.size > 8e6) return toast("Elige una imagen de menos de 8 MB");
        const img = new Image(), url = URL.createObjectURL(f);
        img.onload = () => {
          const c = document.createElement("canvas"), k = 160 / Math.max(img.width, img.height); c.width = img.width * k; c.height = img.height * k;
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); photo = c.toDataURL("image/jpeg", 0.75); URL.revokeObjectURL(url);
          el.querySelector(".ph").innerHTML = `<img alt="Foto del hallazgo" src="${photo}"> Foto lista`;
        };
        img.src = url;
      });
      el.querySelector("[data-x]").addEventListener("click", closePointUI);
      el.querySelector("[data-s]").addEventListener("click", () => saveFinding(ll, type, MR.clean(el.querySelector("textarea").value), photo));
    });
  }
  function saveFinding(ll, type, note, photo) {
    const tn = FTYPES.find(x => x[0] === type)[1];
    const f = { id: uid("f"), type, typeName: tn + (note ? " · " + note.slice(0, 24) : ""), note, photo, lon: ll[0], lat: ll[1],
      elev: MR.sample("dem", ll[0], ll[1]), simMin: T.simMin, km: T.km, fresh: true, isNew: true, crew: T.crew.id };
    T.findings.push(f); closePointUI(); refreshMarkers(); bump("hallazgos");
    const msg = sendToEarth(`Hallazgo · ${tn}${note ? ": " + note : ""}`, ll, "hallazgo");
    MR.API.send("hallazgos", { ...f, photo: photo ? "[img]" : null });
    MR.API.sendReporte({
      id: "rep_" + f.id,
      author: T.crew.id,
      type: "hallazgo",
      lon: ll[0],
      lat: ll[1],
      elev: f.elev,
      km: T.km,
      text: `Hallazgo geológico [${tn}]: ${note || "Sin nota"}`,
      attachments: { type, solTime: MR.solTime(T.simMin).label },
      sync_status: "local"
    }).then(result => {
      toast(result.ok ? "Reporte guardado en el servidor local" : result.persisted
        ? "Reporte conservado en este navegador · pendiente de envío al servidor local"
        : "No se pudo guardar el reporte de forma persistente; conserva una copia antes de cerrar.");
    });
    T.events.push({ t: T.simMin, c: "var(--nominal)", txt: `Hallazgo registrado: ${tn}` });
    renderPanel();
  }
  function openFindingCard(f) {
    mini([f.lon, f.lat], `<h4></h4><div class="coords">${MR.fmtLL(f.lon, f.lat)} · ${fmt(f.elev, 0)} m · ${MR.solTime(f.simMin).label}</div>
      ${f.photo ? `<img alt="Foto del hallazgo" src="${f.photo}" style="width:100%;border-radius:8px;margin-top:8px">` : ""}
      <p class="note" style="margin:8px 0 0;font-size:13px"></p>
      <div class="actions"><button class="btn ghost" data-x>Cerrar</button><button class="btn primary" data-p>Proponer como misión</button></div>`, el => {
      el.querySelector("h4").textContent = FTYPES.find(x => x[0] === f.type)[1];
      el.querySelector(".note").textContent = f.note || "Sin nota.";
      el.querySelector("[data-x]").addEventListener("click", closePointUI);
      el.querySelector("[data-p]").addEventListener("click", () => { closePointUI(); openOwnBriefing({ lon: f.lon, lat: f.lat, name: "Muestra: " + f.typeName.slice(0, 40), type: "Muestreo" }); });
    });
  }
  function openObjective(o) {
    const r = activeRoute() || T.baseRoute, d = MR.distToRoute(r, [o.lon, o.lat]);
    const p = curPos(); const dp = p ? MR.distKm(p, [o.lon, o.lat]) : null;
    const v = terrainVerdict([o.lon, o.lat]);
    mini([o.lon, o.lat], `<h4></h4><div class="coords">${MR.fmtLL(o.lon, o.lat)} · ${fmt(MR.sample("dem", o.lon, o.lat), 0)} m</div>
      <p style="margin:8px 0 4px;font-size:13px" class="n"></p>
      <p style="margin:0;font-size:12px;color:var(--text-2)">A ${fmt(d)} km de la ruta${dp != null ? ` · a ${fmt(dp)} km de ti` : ""}<br>${esc(v.txt)}<br>Fuente: <span class="s"></span></p>
      <div class="actions"><button class="btn ghost" data-x>Cerrar</button>${["meta", "base"].includes(o.type) ? "" : '<button class="btn primary" data-m>Crear misión aquí</button>'}</div>`, el => {
      el.querySelector("h4").textContent = o.name; el.querySelector(".n").textContent = o.note; el.querySelector(".s").textContent = o.source;
      el.querySelector("[data-x]").addEventListener("click", closePointUI);
      const m = el.querySelector("[data-m]");
      m && m.addEventListener("click", () => { closePointUI(); openOwnBriefing({ lon: o.lon, lat: o.lat, name: o.name, type: "Ciencia", objId: o.id }); });
    });
  }
  function openMissionCard(m) {
    mini([m.lon, m.lat], `<h4></h4><div class="coords">${MR.fmtLL(m.lon, m.lat)}</div>
      <p style="margin:8px 0;font-size:13px"><span class="badge sec">${m.origin === "propia" ? "Propia" : "Asignada"}</span> <span class="badge ${m.status === "completada" ? "ok" : ""}">${m.status}</span></p>
      <div class="actions"><button class="btn ghost" data-x>Cerrar</button><button class="btn" data-o>Ver en Misiones</button></div>`, el => {
      el.querySelector("h4").textContent = m.name;
      el.querySelector("[data-x]").addEventListener("click", closePointUI);
      el.querySelector("[data-o]").addEventListener("click", () => { closePointUI(); togglePanel("misiones"); });
    });
  }
  function reportHere() {
    const p = curPos();
    const ll = p ? [p[0], p[1]] : MR.Map.centerLL();
    if (!p) toast("Sin recorrido activo: el reporte se ubica en el centro del mapa");
    if (S.view === "3d") setView("2d");
    MR.Map.centerOn(ll[0], ll[1]);
    setTimeout(() => openFindingForm(ll), 300);
  }

  /* ---------- medir distancia ---------- */
  function startMeasure(a) {
    T.measure = { a, b: null }; refreshMarkers();
    picking = b => {
      T.measure.b = b; renderRoutes(); refreshMarkers();
      const d = MR.distKm(a, b), za = MR.sample("dem", a[0], a[1]), zb = MR.sample("dem", b[0], b[1]);
      const grade = (zb - za) / (d * 1000 || 1);
      const h = d / MR.walkSpeed(grade, (MR.sample("traversability", a[0], a[1]) + MR.sample("traversability", b[0], b[1])) / 2);
      mini(b, `<h4>Distancia en línea recta</h4>
        <div class="rcard" style="border:0;padding:6px 0"><div class="stats" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat"><span class="v num">${fmt(d, 2)}</span><span class="k">km</span></div>
        <div class="stat"><span class="v num">${zb - za >= 0 ? "+" : ""}${fmt(zb - za, 0)}</span><span class="k">m de desnivel</span></div>
        <div class="stat"><span class="v num">${fmt(h, 1)}</span><span class="k">h caminando*</span></div></div></div>
        <p style="font-size:11px;color:var(--text-2);margin:4px 0 0">*Función de Tobler con traje EVA. No considera obstáculos: para eso usa “Crear misión aquí”.</p>
        <div class="actions"><button class="btn primary" data-x>Listo</button></div>`, el => {
        el.querySelector("[data-x]").addEventListener("click", () => { closePointUI(); T.measure = null; renderRoutes(); refreshMarkers(); });
      });
    };
    MR.Map.setPicking(true);
    banner({ kind: "info", title: "Toca el segundo punto", sub: "Para medir la distancia desde el punto A", ttl: 4000 });
  }

  /* =====================================================
     VENTANAS CENTRALES — briefing, alerta crítica, confirmaciones
     ===================================================== */
  let modalState = null;
  function showModal(html, o = {}) {
    closePointUI();
    const m = $("modal"); m.className = "modal" + (o.cls ? " " + o.cls : ""); m.innerHTML = html; m.hidden = false; $("scrim").hidden = false;
    modalState = o; o.bind && o.bind(m);
    const f = m.querySelector("[data-focus]") || m.querySelector(".actions .primary, .actions .btn"); f && f.focus({ preventScroll: true });
    $("scrim").onclick = () => { if (o.dismiss !== false) closeModal(); };
  }
  function closeModal() { $("modal").hidden = true; $("scrim").hidden = true; const o = modalState; modalState = null; o && o.onClose && o.onClose(); }
  const factsHtml = arr => `<div class="facts">${arr.map(([v, k]) => `<div class="stat"><span class="v num">${v}</span><span class="k">${k}</span></div>`).join("")}</div>`;

  function openMainBriefing() {
    if (T.mode !== "base") return;
    T.briefed = true;
    const r = T.baseRoute, st = MR.routeStats(r), n = makeStages(r).length;
    const minT = Math.min(MR.weather(EVA_START, st.maxElev, T.crew.profile).air, MR.weather(EVA_END, st.maxElev, T.crew.profile).air);
    showModal(`<div class="mhead"><div class="tag-line"><span class="tg assigned">Misión asignada · Principal</span><span style="color:var(--text-2)">${T.crew.short} · ${T.crew.role}</span></div>
      <h2>${esc(T.crew.title)}</h2>
      <div class="who">${esc(goalObj().note)}</div></div>
      <div class="mbody">${factsHtml([[fmt(st.length, 0) + " km", "distancia"], [(st.maxElev - r[0][3] >= 0 ? "+" : "") + fmt(st.maxElev - r[0][3], 0) + " m", "desnivel"], [n, "etapas"],
        [fmt(minT, 0) + " °C", "mínima en EVA"], [st.hazards, st.hazards === 1 ? "tramo empinado" : "tramos empinados"], ["≈ " + fmt(st.hours, 0) + " h", "de caminata"]])}
      <div class="who">Asignada por: Control de misión · Ruta calculada por el modelo predictivo</div>
      <div class="actions"><button class="btn ghost spacer" data-c>Ver condiciones</button><button class="btn" data-n>Ahora no</button><button class="btn primary" data-a data-focus>Aceptar misión</button></div></div>`, {
      bind: m => {
        m.querySelector("[data-c]").addEventListener("click", () => { closeModal(); openDashboard(openMainBriefing); });
        m.querySelector("[data-n]").addEventListener("click", () => { closeModal(); toast("La misión queda pendiente en Misiones"); });
        m.querySelector("[data-a]").addEventListener("click", () => { closeModal(); acceptMain(); });
      },
    });
  }
  function acceptMain() {
    T.mode = "plan"; T.unread.misiones = Math.max(0, T.unread.misiones - 1);
    if (T.crew.main === "summit") T.shortRoute = MR.withKm(D.routes.summit_short.points);
    else { const g = goalObj(); T.shortRoute = MR.astar([T.baseRoute[0][0], T.baseRoute[0][1]], [g.lon, g.lat], { riskW: 0, slopeW: 3 }); }
    recomputeHazards(); setLeft(window.innerWidth >= 820);
    renderAll(); renderRoutes(true);
    const r = T.baseRoute; const lon = (r[0][0] + r[r.length - 1][0]) / 2, lat = (r[0][1] + r[r.length - 1][1]) / 2;
    MR.Map.fit();
    logSys(`Misión principal aceptada: ${T.crew.title}.`);
    T.events.push({ t: T.simMin, c: "var(--brand-red)", txt: "Misión principal aceptada" });
  }
  function acceptRoute() {
    if (!MR.routeApproval.matches(T.approval, planRoute(), currentRegion, T.profileMode)) {
      return toast("Esta ruta no está validada para EVA. Recalcula una ruta que cumpla las reservas y termine en un refugio.");
    }
    T.route = MR.withKm(planRoute().map(p => p.slice()));
    T.mode = "walk"; T.km = 0; T.stages = makeStages(T.route); T.stageIdx = 0; T.playing = false;
    recomputeHazards(); setLeft(false);
    renderAll(); renderRoutes();
    const p = curPos(); MR.Map.centerOn(p[0], p[1], 1.5);
    banner({ kind: "ok", title: "Ruta aceptada · simulación en pausa", sub: "Pulsa ▶ (Espacio) para empezar a caminar.", ttl: 6000 });
    logSys(`Ruta aceptada (${T.choice === "short" ? "ruta corta" : T.adjusted ? "ruta ajustada" : "ruta del modelo"}): ${fmt(T.route[T.route.length - 1][2])} km.`);
    T.events.push({ t: T.simMin, c: "var(--accent)", txt: "Inicio del recorrido" });
    MR.API.send("misiones", { crew: T.crew.id, kind: "principal", name: T.crew.title, status: "en curso", km: T.route[T.route.length - 1][2] });
  }

  // Misión propia (editable)
  const MTYPES = ["Ciencia", "Muestreo", "Reconocimiento", "Otro"];
  function openOwnBriefing(pre = {}) {
    const st = { name: pre.name || "", type: pre.type || "Ciencia", lon: pre.lon, lat: pre.lat, note: pre.note || "", objId: pre.objId };
    if (st.lon == null) { const p = curPos(); const ll = p ? [p[0], p[1]] : MR.fromWorld(600, 600); st.lon = ll[0]; st.lat = ll[1]; }
    const render = () => showModal(`<div class="mhead"><div class="tag-line"><span class="tg own">Misión propia · Secundaria</span></div>
      <h2>Nueva misión</h2></div>
      <div class="mbody">
        <label class="field">Nombre<input id="omName" maxlength="60" placeholder="Ej.: Muestra de roca clara" data-focus></label>
        <label class="field">Tipo<select id="omType">${MTYPES.map(t => `<option ${t === st.type ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <div class="field">Punto<div class="pick"><span>${MR.fmtLL(st.lon, st.lat)}</span><button type="button" id="omPick">cambiar en el mapa</button></div>
          <span style="font-weight:400;font-size:12px" id="omVerdict"></span></div>
        <label class="field">Nota (opcional)<textarea id="omNote" rows="2" maxlength="140"></textarea></label>
        <div class="actions"><button class="btn ghost" data-x>Cancelar</button><button class="btn primary" data-p>Proponer misión</button></div></div>`, {
      bind: m => {
        m.querySelector("#omName").value = st.name; m.querySelector("#omNote").value = st.note;
        const v = terrainVerdict([st.lon, st.lat]); const vv = m.querySelector("#omVerdict");
        vv.textContent = v.txt; vv.style.color = { ok: "var(--nominal)", warn: "var(--caution)", bad: "var(--danger)" }[v.cls];
        const keep = () => { st.name = m.querySelector("#omName").value; st.type = m.querySelector("#omType").value; st.note = m.querySelector("#omNote").value; };
        m.querySelector("#omPick").addEventListener("click", () => {
          keep(); closeModal(); if (S.view === "3d") setView("2d");
          MR.Map.setPicking(true);
          banner({ kind: "info", title: "Toca el mapa para elegir el punto de la misión", ttl: 5000 });
          picking = ll => { st.lon = ll[0]; st.lat = ll[1]; render(); };
        });
        m.querySelector("[data-x]").addEventListener("click", closeModal);
        m.querySelector("[data-p]").addEventListener("click", () => {
          keep(); const name = MR.clean(st.name, 60);
          if (!name) { m.querySelector("#omName").focus({ preventScroll: true }); m.querySelector("#omName").style.borderColor = "var(--danger)"; return; }
          closeModal(); proposeOwn({ ...st, name, note: MR.clean(st.note) });
        });
      },
    });
    render();
  }
  function proposeOwn(st) {
    const m = { id: uid("m"), name: st.name, type: st.type, origin: "propia", lon: st.lon, lat: st.lat, note: st.note, status: "propuesta", by: T.crew.short };
    T.missions.push(m);
    activateMission(m);
    sendToEarth(`Nueva misión propia: ${m.name} (${m.type})`, [m.lon, m.lat], "mision");
  }
  // Secundaria asignada (propuesta por el sistema o la Tierra)
  function openSecondaryBriefing(m) {
    const p = curPos(); const d = p ? MR.distKm(p, [m.lon, m.lat]) : MR.distToRoute(activeRoute() || T.baseRoute, [m.lon, m.lat]);
    showModal(`<div class="mhead"><div class="tag-line"><span class="tg own">Misión asignada · Secundaria</span><span style="color:var(--text-2)">${esc(m.by)}</span></div>
      <h2></h2><div class="who n"></div></div>
      <div class="mbody">${factsHtml([[fmt(d, 1) + " km", p ? "desde tu posición" : "desde la ruta"], [fmt(MR.sample("slope", m.lon, m.lat), 0) + "°", "pendiente en el punto"], [fmt(MR.sample("traversability", m.lon, m.lat), 2), "facilidad de paso"]])}
      <div class="who">Si aceptas, el mapa calcula un desvío y regresa a la ruta principal.</div>
      <div class="actions"><button class="btn ghost spacer" data-r>Rechazar</button><button class="btn" data-n>Ahora no</button><button class="btn primary" data-a>Aceptar misión</button></div></div>`, {
      bind: el => {
        el.querySelector("h2").textContent = m.name; el.querySelector(".n").textContent = m.note || "";
        el.querySelector("[data-n]").addEventListener("click", closeModal);
        el.querySelector("[data-r]").addEventListener("click", () => { closeModal(); T.missions = T.missions.filter(x => x !== m); bump("misiones", -1); refreshMarkers(); renderPanel(); logSys(`Misión secundaria rechazada: ${m.name}.`); });
        el.querySelector("[data-a]").addEventListener("click", () => { closeModal(); bump("misiones", -1); activateMission(m); });
      },
    });
  }
  function activateMission(m) {
    if (T.mode === "walk") {
      const p = curPos(); const i = MR.nearestKm(T.route, T.km);
      const re = MR.nearestIdx(T.route, [m.lon, m.lat], Math.min(T.route.length - 1, i + 1));
      const rejoin = Math.min(T.route.length - 1, Math.max(re.i, i + 1));
      const a = MR.astar([p[0], p[1]], [m.lon, m.lat]), b = a && MR.astar([m.lon, m.lat], [T.route[rejoin][0], T.route[rejoin][1]]);
      if (!a || !b) { m.status = "propuesta"; toast("No se encontró un desvío seguro hasta ese punto"); return; }
      const det = MR.withKm(a.concat(b.slice(1)));
      const extra = Math.max(0, det[det.length - 1][2] - (T.route[rejoin][2] - T.km));
      T.route = MR.withKm(T.route.slice(0, i).concat([p], det.slice(1), T.route.slice(rejoin + 1)));
      const L = T.route[T.route.length - 1][2];
      T.stages = makeStages(T.route).map(k => Math.max(k, T.km)); T.stageIdx = T.stages.findIndex(k => k > T.km + 0.01); if (T.stageIdx < 0) T.stageIdx = T.stages.length - 1;
      m.path = MR.withKm(det); m.status = "aceptada";
      recomputeHazards();
      banner({ kind: "sec", title: `Desvío calculado: ${m.name}`, sub: `+${fmt(extra, 1)} km de desvío · ruta total ${fmt(L)} km`, ttl: 6000 });
    } else {
      // en Planear o Mapa base: se convierte en parada de la ruta
      m.status = "aceptada";
      if (!T.stops.includes(m.id)) T.stops.push(m.id);
      if (T.mode !== "base") recalcRoute();
      banner({ kind: "sec", title: `Misión añadida como parada: ${m.name}`, sub: "La ruta se recalculó para pasar por el punto.", ttl: 5000 });
    }
    logSys(`Misión secundaria aceptada: ${m.name}.`);
    T.events.push({ t: T.simMin, c: "var(--secondary)", txt: `Secundaria aceptada: ${m.name}` });
    MR.API.send("misiones", { crew: T.crew.id, kind: "secundaria", name: m.name, origin: m.origin, lon: m.lon, lat: m.lat, status: m.status });
    renderStops(); renderRoutes(); refreshMarkers(); renderPanel(); renderDock(true); renderStatus(); update3d();
  }

  /* ---------- alerta crítica ---------- */
  function criticalAlert(z) {
    T.playing = false; renderStatus(); T.alerts++;
    if (S.panel) togglePanel(null);
    $("stageCard").hidden = true;
    const p = curPos(); const dist = Math.max(0, (z.startKm - T.km) * 1000);
    const targetKm = Math.min(T.route[T.route.length - 1][2], z.endKm + 0.9);
    const tp = posAt(T.route, targetKm);
    const alt = MR.astar([p[0], p[1]], [tp[0], tp[1]], { maxSlope: Math.max(10, MR.cfg.critSlope - 2), slopeW: 7 });
    const altMax = alt ? Math.max(...alt.map(q => q[4])) : null;
    const altLen = alt ? alt[alt.length - 1][2] : null, direct = targetKm - T.km;
    const extraM = alt ? Math.max(0, (altLen - direct) * 1000) : 0;
    const okAlt = alt && altMax <= MR.cfg.critSlope && extraM < 2500;
    T.events.push({ t: T.simMin, c: "var(--danger)", txt: `Alerta: pendiente ${fmt(z.max, 0)}°` });
    showModal(`<div class="mhead"><div class="tag-line"><span class="tg alert">Alerta crítica · simulación en pausa</span></div>
      <h2>${MR.ICONS.warn}Pendiente fuerte en ${fmt(dist, 0)} m</h2></div>
      <div class="mbody">${factsHtml([[fmt(z.max, 0) + "°", "pendiente máxima"], [fmt(z.rough, 0) + " m", "rugosidad"], [fmt((z.endKm - z.startKm) * 1000 + 50, 0) + " m", "largo del tramo"]])}
      <div class="alt">${okAlt ? `<b>Alternativa:</b> desvío de ${fmt(extraM, 0)} m extra con pendiente máxima ${fmt(altMax, 0)}°.`
        : alt && altMax <= MR.cfg.critSlope ? `<b>Sin desvío corto:</b> la alternativa segura más cercana suma ${fmt(extraM / 1000, 1)} km. Avanza despacio o aborta.` : "<b>Sin desvío seguro</b> en los alrededores: avanza despacio o aborta."}</div>
      <div class="who" style="margin-top:8px">Umbral de alerta: ${MR.cfg.critSlope}° (configurable en Ruta → Umbrales).</div>
      <div class="actions"><button class="btn danger spacer" data-ab>Abortar</button><button class="btn" data-s>Seguir con precaución</button><button class="btn primary" data-d ${okAlt ? "" : "disabled"}>Desviar</button></div></div>`, {
      cls: "critical", dismiss: false,
      bind: m => {
        m.querySelector("[data-s]").addEventListener("click", () => { T.handled[z.id] = "seguir"; closeModal(); logSys(`Alerta en km ${fmt(z.startKm)}: se sigue con precaución.`); T.playing = true; renderStatus(); });
        m.querySelector("[data-d]").addEventListener("click", () => {
          T.handled[z.id] = "desvio"; closeModal(); T.detours++;
          const i = MR.nearestKm(T.route, T.km), j = MR.nearestKm(T.route, targetKm);
          T.route = MR.withKm(T.route.slice(0, i).concat([p], alt.slice(1), T.route.slice(j + 1)));
          T.stages = makeStages(T.route).map(k => Math.max(k, T.km));
          T.stageIdx = Math.max(0, T.stages.findIndex(k => k > T.km + 0.01));
          recomputeHazards(); T.hazards.forEach(h => { if (h.startKm < T.km + 0.05) T.handled[h.id] = 1; });
          renderRoutes(); renderDock(true); logSys(`Desvío aplicado en km ${fmt(T.km)} para evitar ${fmt(z.max, 0)}°.`);
          banner({ kind: "ok", title: "Desvío aplicado", sub: "Nueva ruta dibujada. Pulsa ▶ para continuar.", ttl: 4000 });
        });
        m.querySelector("[data-ab]").addEventListener("click", () => confirmAbort(() => criticalAlert(z)));
      },
    });
  }
  function confirmAbort(back) {
    showModal(`<div class="mhead"><h2>¿Abortar la misión?</h2></div><div class="mbody">
      <p class="who">Volverás a la base. Se conservan la bitácora y los hallazgos registrados.</p>
      <div class="actions"><button class="btn" data-c data-focus>Cancelar</button><button class="btn danger" data-y>Sí, abortar</button></div></div>`, {
      dismiss: false,
      bind: m => {
        m.querySelector("[data-c]").addEventListener("click", () => { closeModal(); back && back(); });
        m.querySelector("[data-y]").addEventListener("click", () => {
          closeModal(); logSys(`Misión abortada en km ${fmt(T.km)}. Regreso a la base.`);
          T.events.push({ t: T.simMin, c: "var(--danger)", txt: "Misión abortada" });
          Object.assign(T, { mode: "base", route: null, km: 0, playing: false, adjusted: null, choice: "model", briefed: false, handled: {}, flags: {} });
          T.unread.misiones = 1; renderAll(true); MR.Map.fit();
          banner({ kind: "warn", title: "Misión abortada", sub: "De vuelta en el mapa base. Abre Misiones para retomar.", ttl: 6000 });
        });
      },
    });
  }

  /* =====================================================
     AVISOS: banner (arriba), tarjeta de etapa (abajo), toast
     ===================================================== */
  function banner({ kind = "warn", title, sub, onClick, ttl = 6000, icon }) {
    const box = $("banners");
    while (box.children.length >= 3) box.firstChild.remove();
    const b = document.createElement("button"); b.className = "banner " + kind; b.type = "button";
    b.innerHTML = `${MR.ICONS[icon || { warn: "warn", info: "info", msg: "msg", ok: "ok", sec: "secundaria" }[kind]]}<span class="txt"><span class="t"></span><small></small></span><span class="x" aria-label="Cerrar">✕</span>`;
    b.querySelector(".t").textContent = title; b.querySelector("small").textContent = sub || "";
    if (!sub) b.querySelector("small").remove();
    const kill = () => { b.classList.add("out"); setTimeout(() => b.remove(), 250); };
    b.addEventListener("click", e => { kill(); if (!e.target.classList.contains("x") && onClick) onClick(); });
    box.appendChild(b); setTimeout(kill, ttl);
  }
  let toastT = null;
  function toast(msg, action, fn) {
    const t = $("toast"); t.innerHTML = `<span></span>${action ? `<button>${esc(action)}</button>` : ""}`;
    t.querySelector("span").textContent = msg; t.hidden = false;
    if (action) t.querySelector("button").addEventListener("click", () => { t.hidden = true; fn(); });
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), action ? 5000 : 2600);
  }
  function stageCard(kind) {
    T.playing = false; renderStatus();
    const L = T.route[T.route.length - 1][2], n = T.stages.length;
    const card = $("stageCard");
    if (kind === "night") {
      const nxt = MR.solTime((Math.floor(T.simMin / 1440) + 1) * 1440 + EVA_START * 60);
      const night = MR.weather(4, curPos()[3], T.crew.profile).air;
      card.innerHTML = `<h3>${MR.ICONS.info} Fin de la jornada EVA (${EVA_END}:00)</h3>
        <p>${fmt(T.km)} km recorridos · quedan ${fmt(L - T.km)} km. Caminar de noche no está permitido.</p>
        <div class="next"><div class="stat"><span class="v num">${fmt(night, 0)} °C</span><span class="k">mínima esta noche</span></div>
        <div class="stat"><span class="v num">${nxt.label}</span><span class="k">reanudación</span></div></div>
        <div class="actions"><button class="btn primary" data-r>Descansar hasta las 08:00</button></div>`;
      card.querySelector("[data-r]").addEventListener("click", () => { restUntilMorning(); });
    } else {
      const done = T.stageIdx; const a = T.stages[done - 1] || 0, b = T.stages[done] || L;
      const seg = T.route.filter(p => p[2] >= a && p[2] <= b);
      const gain = seg.length ? seg[seg.length - 1][3] - seg[0][3] : 0;
      const hz = T.hazards.filter(z => z.startKm >= a && z.startKm <= b).length;
      const h = seg.length > 1 ? MR.estimateHours(MR.withKm(seg)) : 0;
      const minT = MR.weather(Math.min(EVA_END, time().hour + h), seg.length ? Math.max(...seg.map(p => p[3])) : 0, T.crew.profile).air;
      card.innerHTML = `<h3>${MR.ICONS.ok} Etapa ${done} de ${n} completada</h3>
        <p>${fmt(T.km)} km · quedan ${fmt(L - T.km)} km</p>
        <div class="next"><div class="stat"><span class="v num">${gain >= 0 ? "+" : ""}${fmt(gain, 0)} m</span><span class="k">desnivel próximo tramo</span></div>
          <div class="stat"><span class="v num">${fmt(h, 1)} h</span><span class="k">tiempo estimado</span></div>
          <div class="stat"><span class="v num">${fmt(minT, 0)} °C</span><span class="k">al final del tramo</span></div>
          <div class="stat"><span class="v num">${hz}</span><span class="k">tramos empinados</span></div></div>
        <div class="actions"><button class="btn" data-r>Descansar 1 h</button><button class="btn primary" data-c>Continuar</button></div>`;
      card.querySelector("[data-r]").addEventListener("click", () => { T.simMin += 60; card.hidden = true; logSys("Descanso de 1 h."); renderStatus(); updateWeather(true); });
      card.querySelector("[data-c]").addEventListener("click", () => { card.hidden = true; T.playing = true; renderStatus(); });
    }
    card.hidden = false;
    card.querySelector(".btn.primary").focus({ preventScroll: true });
  }
  function restUntilMorning() {
    $("stageCard").hidden = true;
    T.simMin = (Math.floor(T.simMin / 1440) + 1) * 1440 + EVA_START * 60;
    T.flags["eva1h_" + time().sol] = false;
    logSys(`Descanso nocturno. Reanudación ${time().label}.`);
    T.events.push({ t: T.simMin, c: "var(--text-2)", txt: `Inicio del ${time().label.split(" · ")[0]}` });
    renderStatus(); updateWeather(true);
    banner({ kind: "info", title: `Buenos días · ${time().label}`, sub: "Pulsa ▶ para continuar.", ttl: 4000 });
  }

  /* =====================================================
     SIMULACIÓN EN TIEMPO REAL
     ===================================================== */
  let lastFrame = performance.now(), lastDraw = 0, lastProfile = 0;
  function loop(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
    if (T.playing && T.mode === "walk") {
      let budget = dt * T.speed * MIN_PER_SEC;
      while (budget > 0 && T.playing) {
        const step = Math.min(0.5, budget); budget -= step;
        advance(step);
      }
      if (now - lastDraw > 60) {
        lastDraw = now; const p = curPos();
        MR.Map.drawDone(T.route, T.km, p); MR.Map.setAstronaut(p, T.crew.color, T.crew.short);
        if (S.view === "2d") {
          MR.Map.keepInView(p[0], p[1]);
        } else if (S.view === "3d") {
          if (MR.Scene3D && MR.Scene3D.ready) MR.Scene3D.updatePos({ route: T.route, km: T.km, pos: p, color: T.crew.color });
        } else if (S.view === "globe") {
          if (MR.Globe3D && MR.Globe3D.ready) MR.Globe3D.updatePos({ route: T.route, km: T.km, pos: p, color: T.crew.color });
        }
        renderStatus(); renderLive();
      }
      if (now - lastProfile > 700) { lastProfile = now; renderProfile(); if (S.panel === "misiones") renderPanel(); }
    }
    requestAnimationFrame(loop);
  }
  function advance(dMin) {
    const R = T.route, L = R[R.length - 1][2];
    const i = MR.nearestKm(R, T.km);
    let v = (T.mobility === "rover" ? MR.roverSpeed(R[i][4], R[i][6]) : MR.walkSpeed(MR.gradeAt(R, i), R[i][6]));
    const inZone = T.hazards.find(z => T.km >= z.startKm - 0.05 && T.km <= z.endKm + 0.05);
    if (inZone) v *= 0.6;
    T.km = Math.min(L, T.km + (v * dMin) / 60); T.simMin += dMin;
    // datos de condiciones cada 10 min marcianos
    if (T.simMin - T.lastWx >= 10) updateWeather();
    if (T.simMin - T.lastTele >= 30) { T.lastTele = T.simMin; const p = curPos(); MR.API.send("telemetria", { crew: T.crew.id, t: T.simMin, km: T.km, lon: p[0], lat: p[1], elev: p[3], wx: T.wx }); }
    checkEvents(L);
  }
  function checkEvents(L) {
    const h = time().hour;
    // llegada
    if (T.km >= L - 0.005) return arrive();
    // evento meteorológico crítico reproducible a las 11:30 LTST
    if (!T.handled["mda_storm_1130"] && time().hour === 11 && time().minute >= 30) {
      T.handled["mda_storm_1130"] = 1;
      triggerWeatherAlert();
      return;
    }
    // peligro crítico por delante (200 m)
    const z = T.hazards.find(z => !T.handled[z.id] && z.startKm - T.km <= 0.2 && z.endKm >= T.km);
    if (z) return criticalAlert(z);
    // terreno difícil (aviso, no pausa)
    const lz = T.lows.find(z => !T.handled[z.id] && z.startKm - T.km <= 0.4 && z.endKm >= T.km);
    if (lz) { T.handled[lz.id] = 1; banner({ kind: "warn", title: `Terreno difícil en ${fmt(Math.max(0, (lz.startKm - T.km) * 1000), 0)} m`, sub: `Facilidad de paso ${fmt(lz.min, 2)} · se reduce el ritmo`, onClick: () => { const p = posAt(T.route, lz.startKm); MR.Map.centerOn(p[0], p[1], 3); } }); }
    // fin de etapa
    if (T.stageIdx < T.stages.length - 1 && T.km >= T.stages[T.stageIdx]) {
      T.stageIdx++; T.events.push({ t: T.simMin, c: "var(--nominal)", txt: `Etapa ${T.stageIdx} completada` });
      logSys(`Etapa ${T.stageIdx} de ${T.stages.length} completada en km ${fmt(T.km)}.`);
      return stageCard("stage");
    }
    // ventana EVA
    if (h >= EVA_END - 1 && !T.flags["eva1h_" + time().sol]) { T.flags["eva1h_" + time().sol] = true; banner({ kind: "warn", title: "Queda 1 h de jornada EVA", sub: `A las ${EVA_END}:00 se detiene el recorrido`, ttl: 6000 }); }
    if (h >= EVA_END || h < EVA_START) return stageCard("night");
    // misiones secundarias: completadas / propuestas por el sistema
    const p = curPos();
    T.missions.forEach(m => {
      if (m.status === "aceptada" && MR.distKm(p, [m.lon, m.lat]) < 0.3) {
        m.status = "completada"; refreshMarkers(); renderRoutes(); renderPanel();
        banner({ kind: "ok", title: `Misión secundaria completada: ${m.name}`, ttl: 5000 });
        logSys(`Misión secundaria completada: ${m.name}.`); T.events.push({ t: T.simMin, c: "var(--secondary)", txt: `Secundaria completada: ${m.name}` });
        sendToEarth(`Misión secundaria completada: ${m.name}`, [m.lon, m.lat], "mision");
      }
    });
    const cand = D.objetivos.find(o => ["ciencia", "mineral", "espectral"].includes(o.type) && o.id !== T.crew.goalId && !T.proposed[o.id] && MR.distKm(p, [o.lon, o.lat]) < 3.5);
    if (cand && !T.missions.some(m => m.status === "propuesta")) proposeSecondary(cand, "Sistema (modelo de objetivos)");
    // guion de la Tierra según progreso
    earthScript(T.km / L);
  }
  function proposeSecondary(o, by) {
    T.proposed[o.id] = 1;
    const m = { id: uid("m"), name: o.name, type: "Ciencia", origin: "asignada", by, lon: o.lon, lat: o.lat, note: o.note, status: "propuesta", objId: o.id };
    T.missions.push(m); bump("misiones"); refreshMarkers();
    banner({ kind: "sec", title: `Misión secundaria propuesta: ${o.name}`, sub: "Toca para ver el briefing · no interrumpe la marcha", onClick: () => openSecondaryBriefing(m) });
  }
  function earthScript(f) {
    const fire = (k, fn) => { if (!T.flags[k]) { T.flags[k] = true; fn(); } };
    if (f > 0.06) fire("e1", () => earthMessage("Control de misión: buen inicio. Telemetría nominal; recuerden hidratarse en cada parada."));
    if (f > 0.3) fire("e2", () => {
      const p = curPos();
      const o = D.objetivos.filter(o => ["ciencia", "mineral", "espectral"].includes(o.type) && o.id !== T.crew.goalId && !T.proposed[o.id])
        .sort((a, b) => MR.distKm(p, [a.lon, a.lat]) - MR.distKm(p, [b.lon, b.lat]))[0];
      if (o) { earthMessage(`Control de misión: proponemos la secundaria «${o.name}». Evalúen el desvío.`, [o.lon, o.lat]); proposeSecondary(o, "Control de misión (Tierra)"); }
    });
    if (f > 0.55) fire("e3", () => earthMessage("Control de misión: el pronóstico indica más polvo en suspensión mañana; la radiación UV bajará."));
    if (f > 0.85) fire("e4", () => earthMessage("Control de misión: último tramo. Confirmen coordenadas al llegar a la meta."));
  }
  function updateWeather(force) {
    const p = curPos() || T.baseRoute[0];
    const prev = T.wx; T.lastWx = Math.floor(T.simMin / 10) * 10;
    T.wx = MR.weather(time().hour, p[3], T.crew.profile, Math.floor(T.simMin / 10));
    // pronóstico 1 h
    const fut = MR.weather(time().hour + 1, p[3], T.crew.profile);
    if (fut.air < -55 && T.wx.air >= -55 && !T.flags["cold_" + time().sol]) {
      T.flags["cold_" + time().sol] = true;
      banner({ kind: "warn", title: "Baja la temperatura en 1 h", sub: `Se esperan ${fmt(fut.air, 0)} °C. Revisa la calefacción del traje.` });
    }
    if (T.wx.uv > 12 && !T.flags["uv_" + time().sol]) { T.flags["uv_" + time().sol] = true; banner({ kind: "warn", title: "Radiación UV alta", sub: `${fmt(T.wx.uv, 1)} W/m² · limita la exposición del visor` }); }
    if (prev || force) renderLive(true);
  }
  function arrive() {
    T.playing = false; T.mode = "done"; T.km = T.route[T.route.length - 1][2];
    T.events.push({ t: T.simMin, c: "var(--nominal)", txt: "Meta alcanzada" });
    logSys(`Meta alcanzada: ${goalObj().name}.`);
    sendToEarth(`Llegamos a la meta: ${goalObj().name}. Coordenadas confirmadas.`, [goalObj().lon, goalObj().lat], "estado");
    MR.API.send("misiones", { crew: T.crew.id, kind: "principal", name: T.crew.title, status: "completada" });
    renderAll();
    setTimeout(openSummary, MR.reduceMotion() ? 0 : 700);
  }

  /* =====================================================
     COMUNICACIÓN: bitácora (Tierra, con retraso) y asistente
     ===================================================== */
  function sendToEarth(text, ll, kind = "texto") {
    const m = { id: uid("l"), from: "me", text, t: T.simMin, arrive: T.simMin + ONE_WAY_MIN, ll, kind };
    T.log.push(m);
    MR.API.send("bitacora", { crew: T.crew.id, from: "explorador", text, t: T.simMin, lon: ll && ll[0], lat: ll && ll[1], kind });
    // respuesta de la Tierra: llega tras ida + vuelta + 6 min de análisis
    const reply = kind === "hallazgo" ? `Recibido: «${text.replace("Hallazgo · ", "")}». Excelente; guarden la muestra y registren contexto.`
      : kind === "mision" ? `Recibido: ${text}. De acuerdo, prioridad media.` : kind === "estado" ? "¡Felicitaciones a toda la tripulación! Recibido en la Tierra." :
      kind === "pos" ? "Posición recibida y registrada en el mapa de control." : `Recibido: «${text.slice(0, 60)}». Continúen según el plan.`;
    T.events.push({ t: T.simMin + 2 * ONE_WAY_MIN + 6, pending: true, reply, ll });
    renderPanel();
    return m;
  }
  function earthMessage(text, ll) {
    T.log.push({ id: uid("l"), from: "earth", text, t: T.simMin, ll });
    bump("bitacora"); renderPanel();
    banner({ kind: "msg", title: "Mensaje de la Tierra", sub: text.replace("Control de misión: ", ""), onClick: () => togglePanel("bitacora", "tierra"), ttl: 6000 });
  }
  function deliverEarthReplies() {
    T.events.forEach(e => { if (e.pending && T.simMin >= e.t) { e.pending = false; e.done = true; earthMessage("Control de misión: " + e.reply, e.ll); } });
    T.events = T.events.filter(e => !e.done);
  }
  setInterval(deliverEarthReplies, 500);
  function logSys(text) { T.log.push({ id: uid("l"), from: "sys", text, t: T.simMin }); if (S.panel === "bitacora") renderPanel(); }

  // Asistente de ruta (respuestas inmediatas, sin retraso)
  function askAssistant(q) {
    q = MR.clean(q, 200); if (!q) return;
    T.ai.push({ from: "me", text: q, t: T.simMin });
    const s = q.toLowerCase(), p = curPos(), R = activeRoute() || T.baseRoute, L = R[R.length - 1][2];
    let a;
    if (/falta|distancia|cu[aá]nto|llegar|eta/.test(s)) {
      const rest = R.filter(x => x[2] >= T.km); const h = rest.length > 1 ? MR.estimateHours(MR.withKm(rest)) : 0;
      a = `Faltan ${fmt(L - T.km)} km (≈ ${fmt(h, 1)} h de caminata). Ritmo actual ${fmt(MR.walkSpeed(MR.gradeAt(R, MR.nearestKm(R, T.km)), (p || R[0])[6]), 1)} km/h.`;
    } else if (/peligro|riesgo|pendiente|alerta/.test(s)) {
      const z = T.hazards.find(z => z.endKm >= T.km);
      a = z ? `Próximo tramo empinado en ${fmt(Math.max(0, z.startKm - T.km))} km: hasta ${fmt(z.max, 0)}°. Te avisaré 200 m antes.` : "No hay tramos sobre el umbral crítico en lo que queda de ruta.";
    } else if (/clima|temperatura|condici|uv|presi/.test(s)) {
      const w = T.wx || MR.weather(time().hour, (p || R[0])[3], T.crew.profile), f = MR.weather(time().hour + 1, (p || R[0])[3], T.crew.profile);
      a = `Ahora: ${fmt(w.air, 0)} °C aire, UV ${fmt(w.uv, 1)} W/m², ${fmt(w.p, 0)} Pa. En 1 h: ${fmt(f.air, 0)} °C. Fuente: REMS (Curiosity) corregido por altura.`;
    } else if (/posici|coorden|d[oó]nde|ubicaci/.test(s)) {
      const q2 = p || R[0];
      a = `Estás en ${MR.fmtLL(q2[0], q2[1])}, a ${fmt(q2[3], 0)} m de altura, km ${fmt(T.km)} de ${fmt(L)}.`;
    } else if (/objetivo|cerca|interes|muestra/.test(s)) {
      const q2 = p || R[0]; const o = D.objetivos.filter(o => !["base"].includes(o.type)).map(o => [o, MR.distKm(q2, [o.lon, o.lat])]).sort((a, b) => a[1] - b[1])[0];
      a = `El objetivo más cercano es «${o[0].name}» a ${fmt(o[1])} km. ${o[0].note}`;
    } else if (/ruta|[oó]ptim|por qu[eé]/.test(s)) {
      const st = MR.routeStats(R);
      a = `La ruta actual mide ${fmt(st.length)} km con pendiente media ${fmt(st.meanSlope)}° y facilidad media ${fmt(st.meanTrav, 2)}. El modelo prefiere rodear por terreno parecido al que Curiosity ya cruzó, aunque sea más larga.`;
    } else a = "Puedo responder sobre: distancia restante, próximo peligro, condiciones, tu posición, objetivos cercanos o por qué esta ruta.";
    T.ai.push({ from: "them", text: a, t: T.simMin });
    renderPanel();
  }

  /* =====================================================
     PANELES LATERALES (uno a la vez)
     ===================================================== */
  function togglePanel(name, sub) {
    S.panel = S.panel === name && !sub ? null : name;
    if (sub) S.logTab = sub;
    document.querySelectorAll(".rail-btn").forEach(b => b.setAttribute("aria-expanded", b.dataset.panel === S.panel));
    $("sidePanel").hidden = !S.panel;
    if (S.panel) { if (S.panel !== "hallazgos") T.unread[S.panel] = 0; renderRail(); renderPanel(); }
    else if (T.unread.hallazgos) { T.findings.forEach(f => (f.isNew = false)); T.unread.hallazgos = 0; renderRail(); }
  }
  function renderRail(animate, kind) {
    ["misiones", "bitacora", "hallazgos"].forEach(k => {
      const c = document.querySelector(`[data-count="${k}"]`), n = T.unread[k] || 0;
      c.hidden = !n; c.textContent = n;
      if (animate && k === kind && n) { c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump"); }
    });
  }
  function renderPanel() {
    if (!S.panel) return;
    const body = $("spBody");
    const titles = { misiones: "Misiones", bitacora: "Bitácora", hallazgos: `Hallazgos (${T.findings.length})` };
    $("spTitle").textContent = titles[S.panel];
    if (S.panel === "misiones") return panelMissions(body);
    if (S.panel === "bitacora") return panelLog(body);
    if (S.panel === "hallazgos") return panelFindings(body);
  }
  function panelMissions(body) {
    const R = activeRoute(); const L = R ? R[R.length - 1][2] : T.baseRoute[T.baseRoute.length - 1][2];
    const pct = R ? Math.round((T.km / L) * 100) : 0;
    const status = { base: "Pendiente de aceptar", plan: "Planeando ruta", walk: T.playing ? "En recorrido" : "En pausa", done: "Completada" }[T.mode];
    const n = T.stages.length || makeStages(T.baseRoute).length;
    body.innerHTML = `<p class="sp-sub">${T.crew.short} · ${T.crew.role} — viaje independiente</p>
      <div class="m-main"><span class="kicker">Misión principal · ${status}</span><h4></h4>
        <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
        <div class="kicker num" style="display:flex;justify-content:space-between"><span>${pct} %</span><span>${fmt(T.km)} / ${fmt(L)} km</span></div>
        <div class="stages">${Array.from({ length: n }, (_, i) => `<span class="${i < T.stageIdx ? "done" : i === T.stageIdx && T.mode === "walk" ? "cur" : ""}" title="Etapa ${i + 1}"></span>`).join("")}</div>
        ${T.mode === "base" ? '<div class="row-actions"><button class="btn primary" data-b>Abrir briefing</button></div>' : ""}
        ${T.mode === "walk" ? '<div class="row-actions"><button class="btn ghost" data-ab>Abortar misión</button></div>' : ""}</div>
      <h3 style="font-size:14px;margin:18px 0 4px;display:flex;justify-content:space-between;align-items:center">Secundarias <button class="btn" data-new style="min-height:32px;font-size:13px">+ Nueva misión</button></h3>
      <div id="secList"></div>`;
    body.querySelector("h4").textContent = T.crew.title;
    const b = body.querySelector("[data-b]"); b && b.addEventListener("click", openMainBriefing);
    const ab = body.querySelector("[data-ab]"); ab && ab.addEventListener("click", () => confirmAbort());
    body.querySelector("[data-new]").addEventListener("click", () => openOwnBriefing());
    const list = body.querySelector("#secList");
    if (!T.missions.length) list.innerHTML = `<p class="empty">Sin misiones secundarias todavía. El sistema y la Tierra propondrán objetivos cercanos durante el recorrido, o crea la tuya tocando el mapa.</p>`;
    T.missions.slice().reverse().forEach(m => {
      const d = document.createElement("div"); d.className = "m-sec" + (m.status === "completada" ? " done" : "");
      const st = { propuesta: ["Propuesta", "warn"], aceptada: ["Aceptada", "sec"], completada: ["Completada ✓", "ok"] }[m.status];
      d.innerHTML = `<header><b></b><span class="badge ${st[1]}">${st[0]}</span></header>
        <span class="kicker">${m.origin === "propia" ? "Propia · " + esc(m.type) : "Asignada · " + esc(m.by)}</span>
        <div class="row-actions">${m.status === "propuesta" ? '<button class="btn primary" data-o>Ver briefing</button>' : ""}<button class="btn ghost" data-c>Ver en el mapa</button></div>`;
      d.querySelector("b").textContent = m.name;
      const o = d.querySelector("[data-o]"); o && o.addEventListener("click", () => openSecondaryBriefing(m));
      d.querySelector("[data-c]").addEventListener("click", () => {
        if (S.view === "3d") MR.Scene3D.focus(m.lon, m.lat);
        else if (S.view === "globe" && MR.Globe3D) MR.Globe3D.flyTo(m.lon, m.lat, 3.0);
        else MR.Map.centerOn(m.lon, m.lat, 2.5);
      });
      list.appendChild(d);
    });
  }
  function panelLog(body) {
    const tab = S.logTab;
    body.innerHTML = `<div class="tabs log-tabs" role="tablist"><button role="tab" data-t="tierra" aria-selected="${tab === "tierra"}">Tierra · retraso ${ONE_WAY_MIN} min</button><button role="tab" data-t="asistente" aria-selected="${tab === "asistente"}">Asistente de ruta</button></div>
      <div class="log" id="logBox" aria-live="polite"></div>
      ${tab === "asistente" ? `<div class="quick">${["¿Cuánto falta?", "Próximo peligro", "Condiciones ahora", "Mi posición", "Objetivo cercano", "¿Por qué esta ruta?"].map(q => `<button>${q}</button>`).join("")}</div>` :
        `<div class="quick"><button data-pos>Enviar mi posición</button><button data-st>Todo en orden</button></div>`}
      <form class="composer"><input maxlength="200" placeholder="${tab === "asistente" ? "Pregunta al asistente…" : "Mensaje a la Tierra…"}" aria-label="Mensaje"><button class="btn primary" type="submit">Enviar</button></form>`;
    body.querySelectorAll("[data-t]").forEach(b => b.addEventListener("click", () => { S.logTab = b.dataset.t; renderPanel(); }));
    const box = body.querySelector("#logBox");
    const items = tab === "asistente" ? T.ai : T.log;
    if (!items.length) box.innerHTML = `<p class="empty">${tab === "asistente" ? "Pregunta por distancia, peligros, clima o tu posición. Responde al instante." : "Aquí llegan los mensajes de la Tierra y se guardan tus reportes. Cada mensaje tarda 12 min en llegar."}</p>`;
    items.forEach(m => {
      const d = document.createElement("div"); d.className = "msg " + (m.from === "me" ? "me" : m.from === "sys" ? "sys" : "them");
      d.appendChild(document.createTextNode(m.text));
      const meta = document.createElement("span"); meta.className = "meta";
      const who = m.from === "me" ? T.crew.short : m.from === "earth" ? "Tierra" : m.from === "sys" ? "" : "Asistente";
      let st = "";
      if (m.from === "me" && tab === "tierra") st = T.simMin >= m.arrive ? " · ✓ recibido en la Tierra" : ` · enviado → llega ${MR.solTime(m.arrive).hm}`;
      meta.textContent = `${who ? who + " " : ""}${MR.solTime(m.t).hm}${st}`;
      d.appendChild(meta);
      if (m.ll) {
        const l = document.createElement("button"); l.className = "loc"; l.textContent = "Ver en el mapa"; l.type = "button";
        l.addEventListener("click", () => {
          if (S.view === "3d") MR.Scene3D.focus(m.ll[0], m.ll[1]);
          else if (S.view === "globe" && MR.Globe3D) MR.Globe3D.flyTo(m.ll[0], m.ll[1], 3.0);
          else MR.Map.centerOn(m.ll[0], m.ll[1], 2.8);
        });
        d.appendChild(document.createTextNode(" ")); d.appendChild(l);
      }
      box.appendChild(d);
    });
    box.scrollTop = box.scrollHeight;
    const input = body.querySelector(".composer input");
    body.querySelector(".composer").addEventListener("submit", e => {
      e.preventDefault(); const v = MR.clean(input.value, 200); if (!v) return;
      if (tab === "asistente") askAssistant(v); else { const p = curPos(); sendToEarth(v, p ? [p[0], p[1]] : null); }
      setTimeout(() => { const i = $("spBody").querySelector(".composer input"); i && i.focus({ preventScroll: true }); }, 0);
    });
    body.querySelectorAll(".quick button").forEach(b => b.addEventListener("click", () => {
      if (tab === "asistente") return askAssistant(b.textContent);
      const p = curPos() || T.baseRoute[0];
      if (b.dataset.pos !== undefined) sendToEarth(`Coordenadas vitales: ${MR.fmtLL(p[0], p[1])} · ${fmt(p[3], 0)} m · km ${fmt(T.km)}`, [p[0], p[1]], "pos");
      else sendToEarth("Estado: todo en orden, continuamos.", [p[0], p[1]]);
    }));
  }
  function panelFindings(body) {
    const ft = S.fTab;
    const list = T.findings.filter(f => ft === "todos" || f.type === ft);
    body.innerHTML = `<div class="chips" style="margin-bottom:12px">${[["todos", "Todos"], ...FTYPES].map(([k, n]) => `<button class="chip-t" aria-pressed="${ft === k}" data-k="${k}">${n}</button>`).join("")}</div><div id="fList"></div>`;
    body.querySelectorAll("[data-k]").forEach(b => b.addEventListener("click", () => { S.fTab = b.dataset.k; renderPanel(); }));
    const box = body.querySelector("#fList");
    if (!list.length) box.innerHTML = `<p class="empty">${T.findings.length ? "Ningún hallazgo de este tipo." : "Aún no hay hallazgos. Toca un punto del mapa → “Registrar hallazgo aquí”, o usa el botón Reportar aquí."}</p>`;
    list.slice().reverse().forEach(f => {
      const d = document.createElement("div"); d.className = "f-item";
      d.innerHTML = `<div class="thumb">${f.photo ? `<img alt="" src="${f.photo}">` : MR.ICONS.mineral}</div><div><b></b>${f.isNew ? '<span class="dotnew" title="Nuevo"></span>' : ""}
        <small>${MR.fmtLL(f.lon, f.lat)} · ${MR.solTime(f.simMin).label}</small><div class="row-actions"><button class="btn ghost" data-c>Ver</button><button class="btn" data-p>Proponer como misión</button></div></div>`;
      d.querySelector("b").textContent = f.typeName;
      d.querySelector("[data-c]").addEventListener("click", () => { MR.Map.centerOn(f.lon, f.lat, 3); setTimeout(() => openFindingCard(f), 300); });
      d.querySelector("[data-p]").addEventListener("click", () => openOwnBriefing({ lon: f.lon, lat: f.lat, name: "Muestra: " + f.typeName.slice(0, 40), type: "Muestreo" }));
      box.appendChild(d);
    });
  }

  /* =====================================================
     DOCK INFERIOR — planear (comparar rutas) / recorrer (perfil + datos)
     ===================================================== */
  function renderDock(force) {
    const dock = $("dock"), plan = $("dockPlan"), walk = $("dockWalk");
    dock.hidden = !(T.mode === "plan" || T.mode === "walk");
    plan.hidden = T.mode !== "plan"; walk.hidden = T.mode !== "walk";
    if (T.mode === "plan") renderPlanCards();
    if (T.mode === "walk") { renderProfile(); renderLive(true); }
  }
  function renderPlanCards() {
    const A = T.adjusted || T.baseRoute, B = T.shortRoute;
    const sa = MR.routeStats(A), sb = B ? MR.routeStats(B) : null;
    const card = (key, title, st, why, bad) => `<button class="rcard" role="radio" aria-checked="${T.choice === key}" data-k="${key}">
      <header><b>${title}</b>${key === "model" ? '<span class="badge ok">Recomendada</span>' : '<span class="badge warn">Más riesgo</span>'}</header>
      <div class="stats"><div class="stat"><span class="v">${fmt(st.length, 1)}</span><span class="k">km</span></div>
        <div class="stat"><span class="v">≈${fmt(st.hours, 0)}</span><span class="k">h caminando</span></div>
        <div class="stat"><span class="v">${fmt(st.meanTrav, 2)}</span><span class="k">facilidad media</span></div>
        <div class="stat"><span class="v">${st.hazards}</span><span class="k">tramos &gt; ${MR.cfg.critSlope}°</span></div></div>
      <p class="why ${bad ? "bad" : ""}">${why}</p></button>`;
    const whyB = sb ? `Corta en línea más directa, pero ${fmt(sb.lowFrac * 100, 0)} % del trayecto es de paso difícil y la rugosidad media sube a ${fmt(sb.meanRough, 1)} m.` : "";
    $("dockPlan").innerHTML =
      card("model", T.adjusted ? "Ruta ajustada" : "Ruta del modelo", sa, `Rodea por terreno parecido al que Curiosity ya cruzó. Pendiente media ${fmt(sa.meanSlope, 1)}°.`, false) +
      (sb ? card("short", "Ruta corta", sb, whyB, true) : "<div></div>") +
      `<div class="plan-actions"><button class="btn primary" data-acc>Aceptar ruta</button><button class="btn" data-adj>Ajustar</button><button class="btn ghost" data-back>Volver al briefing</button></div>`;
    $("dockPlan").querySelectorAll(".rcard").forEach(b => b.addEventListener("click", () => {
      T.choice = b.dataset.k; recomputeHazards(); renderRoutes(true); renderPlanCards(); renderStatus();
    }));
    $("dockPlan").querySelector("[data-acc]").addEventListener("click", () => {
      if (T.choice === "short") {
        showModal(`<div class="mhead"><div class="tag-line"><span class="tg alert">Confirmar</span></div><h2>¿Usar la ruta corta?</h2></div><div class="mbody">
          <p class="who">${whyB} El modelo la considera menos segura.</p>
          <div class="actions"><button class="btn" data-c data-focus>Elegir la recomendada</button><button class="btn danger" data-y>Sí, usar la corta</button></div></div>`, {
          bind: m => {
            m.querySelector("[data-c]").addEventListener("click", () => { closeModal(); T.choice = "model"; recomputeHazards(); renderRoutes(); renderPlanCards(); });
            m.querySelector("[data-y]").addEventListener("click", () => { closeModal(); acceptRoute(); });
          },
        });
      } else acceptRoute();
    });
    $("dockPlan").querySelector("[data-adj]").addEventListener("click", () => {
      setLeft(true); document.querySelector('[data-lptab="ruta"]').click();
      toast("Ajusta pesos o paradas y pulsa Recalcular ruta");
    });
    $("dockPlan").querySelector("[data-back]").addEventListener("click", () => {
      T.mode = "base"; T.adjusted = null; renderAll(); openMainBriefing();
    });
  }
  function renderProfile() {
    if (T.mode !== "walk") return;
    MR.profileChart($("profile"), T.route, { posKm: T.km, stages: T.stages, hazards: T.hazards,
      onPick: p => {
        if (S.view === "3d") MR.Scene3D.focus(p[0], p[1]);
        else if (S.view === "globe" && MR.Globe3D) MR.Globe3D.flyTo(p[0], p[1], 3);
        else MR.Map.centerOn(p[0], p[1], 3);
      }
    });
  }
  function renderLive(flash) {
    if (T.mode !== "walk") return;
    if (!T.wx) updateWeather();
    const p = curPos(), w = T.wx;
    const tiles = [
      { k: "Temperatura", v: fmt(w.air, 0), u: "°C", st: w.air < -65 ? "bad" : w.air < -50 ? "warn" : "ok", s: w.air < -65 ? "Extrema" : w.air < -50 ? "Fría" : "Nominal",
        src: "Sensor de aire REMS del rover Curiosity (perfil del sol elegido), corregido −2,5 °C por km de altura." },
      { k: "Pendiente", v: fmt(p[4], 0), u: "°", st: p[4] > MR.cfg.critSlope ? "bad" : p[4] > MR.cfg.caution ? "warn" : "ok", s: p[4] > MR.cfg.critSlope ? "Peligrosa" : p[4] > MR.cfg.caution ? "Precaución" : "Suave",
        src: "Calculada del modelo de elevación MOLA/HRSC (NASA Mars Trek)." },
      { k: "Facilidad de paso", v: fmt(p[6], 2), u: "", st: p[6] < MR.cfg.travThr ? "bad" : p[6] < 0.5 ? "warn" : "ok", s: p[6] < MR.cfg.travThr ? "Difícil" : p[6] < 0.5 ? "Media" : "Buena",
        src: "Probabilidad (0–1) del modelo de bosque aleatorio de que el terreno se parezca al que Curiosity atravesó." },
      { k: "Radiación UV", v: fmt(w.uv, 1), u: "W/m²", st: w.uv > 12 ? "warn" : "ok", s: w.uv > 12 ? "Alta" : "Normal",
        src: "Sensor UV de REMS (Curiosity)." },
      { k: "Presión", v: fmt(w.p, 0), u: "Pa", st: "ok", s: `${fmt(p[3], 0)} m altura`,
        src: "Barómetro de REMS, ajustado a la altura con una escala de 11,1 km. 1 % de la presión de la Tierra." },
    ];
    const box = $("live");
    if (box.children.length !== 5) {
      box.innerHTML = tiles.map((t, i) => `<div class="tile" data-i="${i}"><span class="k"><span>${t.k}</span><button class="info" aria-label="Fuente del dato">?</button></span><span class="v num"></span><span class="s"></span></div>`).join("");
      box.querySelectorAll(".info").forEach((b, i) => {
        const show = () => { const r = b.getBoundingClientRect(); MR.showTip(esc(box._tiles[i].src), r.left - 200, r.top); };
        b.addEventListener("mouseenter", show); b.addEventListener("focus", show); b.addEventListener("mouseleave", MR.hideTip); b.addEventListener("blur", MR.hideTip);
      });
    }
    box._tiles = tiles;
    tiles.forEach((t, i) => {
      const el = box.children[i]; el.dataset.state = t.st;
      const v = el.querySelector(".v"); const html = `${t.v}<small>${t.u}</small>`;
      if (v.innerHTML !== html) { v.innerHTML = html; if (flash && !MR.reduceMotion()) { v.classList.remove("flash"); void v.offsetWidth; v.classList.add("flash"); } }
      el.querySelector(".s").innerHTML = (t.st === "ok" ? MR.ICONS.ok : MR.ICONS.warn) + esc(t.s);
    });
  }

  /* =====================================================
     VISTAS: 2D / 3D / PLANETA 3D
     ===================================================== */
  function setView(v) {
    if ((v === "3d" || v === "globe") && !window.THREE) {
      toast("Three.js no se pudo cargar: la vista 3D no está disponible");
      return;
    }
    S.view = v;
    document.body.dataset.view = v;
    document.querySelectorAll(".viewswitch button").forEach(b => b.setAttribute("aria-checked", b.dataset.view === v));
    $("map").hidden = v !== "2d";
    $("map3d").hidden = v !== "3d";
    const mg = $("mapGlobe"); if (mg) mg.hidden = v !== "globe";
    $("ctl3d").hidden = v !== "3d";
    const cg = $("ctlGlobe"); if (cg) cg.hidden = v !== "globe";
    $("zoomCtl").hidden = v !== "2d";
    closePointUI();

    const glSec = $("globeLayersSection"), crSec = $("craterLayersSection");
    if (glSec && crSec) {
      glSec.hidden = v !== "globe";
      crSec.hidden = v === "globe";
    }

    const dockEl = $("dock");
    if (dockEl) {
      if (v === "globe") dockEl.hidden = true;
      else if (T.mode === "walk" || T.mode === "plan") dockEl.hidden = false;
    }
    const repBtn = $("btnReport");
    if (repBtn) repBtn.hidden = v === "globe";

    if (v === "3d") {
      if (MR.Globe3D && MR.Globe3D.ready) MR.Globe3D.stop();
      MR.Scene3D.init(); sync3dTexture(); update3d(); MR.Scene3D.start();
      const p = curPos(); if (p) MR.Scene3D.focus(p[0], p[1]);
    } else if (v === "globe") {
      if (MR.Scene3D && MR.Scene3D.ready) MR.Scene3D.stop();
      if (MR.Globe3D) {
        MR.Globe3D.init();
        MR.Globe3D.start();
        MR.Globe3D.goToRegion(currentRegion);
        update3d();
      }
    } else {
      if (MR.Scene3D && MR.Scene3D.ready) MR.Scene3D.stop();
      if (MR.Globe3D && MR.Globe3D.ready) MR.Globe3D.stop();
    }
  }
  function sync3dTexture() { if (MR.Scene3D.ready) MR.Scene3D.setTexture($("basemap"), S.layer !== "none" ? $("overlay") : null, S.opacity); }
  function update3d() {
    const pins = [];
    filteredObjectives().forEach(o => pins.push({ type: o.type, lon: o.lon, lat: o.lat, label: o.name, onClick: () => openObjective(o) }));
    const minerals = getRegionMinerals();
    minerals.forEach(m => pins.push({ type: "mineral", lon: m.lon, lat: m.lat, isMineral: true, mineral: m, label: m.name, onClick: () => openMineralModal(m) }));
    T.findings.forEach(f => pins.push({ type: "hallazgo", lon: f.lon, lat: f.lat, label: f.typeName, onClick: () => openFindingCard(f) }));
    T.missions.forEach(m => pins.push({ type: "secundaria", lon: m.lon, lat: m.lat, label: m.name, onClick: () => openMissionCard(m) }));
    const st = {
      route: activeRoute(),
      km: T.km,
      pos: curPos(),
      color: T.crew.color,
      pins,
      secondary: T.missions.filter(m => m.path && m.status === "aceptada").map(m => m.path)
    };
    if (MR.Scene3D && MR.Scene3D.ready) MR.Scene3D.update(st);
    if (MR.Globe3D && MR.Globe3D.ready) {
      const globePins = [...pins];
      const otherMinerals = (window.MARS_MINERALS || []).filter(m => m.region !== (currentRegion || "gale"));
      otherMinerals.forEach(m => {
        if (!globePins.some(x => x.id === m.id)) {
          globePins.push({
            type: "mineral",
            lon: m.lon,
            lat: m.lat,
            isMineral: true,
            mineral: m,
            label: m.name,
            onClick: () => openMineralModal(m)
          });
        }
      });
      MR.Globe3D.update({ ...st, pins: globePins });
    }
  }

  /* =====================================================
     VENTANA CENTRAL — Condiciones ambientales y terreno (Dashboard)
     ===================================================== */
  let dashBack = null, dashTab = "atm", dashVar = "temp", dashSol = null;
  function openDashboard(back) {
    dashBack = back || null;
    dashSol = dashSol || T.crew.profile || "sol_100";
    if (!D.rems || !D.rems[dashSol]) dashSol = "sol_100";
    T.playing = false; renderStatus();
    renderDashboardModal();
  }
  function closeDashboard() {
    closeModal();
    MR.hideTip();
    const b = dashBack; dashBack = null; b && b();
  }
  function renderDashboardModal() {
    dashSol = dashSol || T.crew.profile || "sol_100";
    if (!D.rems || !D.rems[dashSol]) dashSol = "sol_100";

    const html = `<div class="mhead dash-modal-head">
      <div class="dash-modal-title-group">
        <h2>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="color:var(--accent);vertical-align:text-bottom;margin-right:6px"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7z"/></svg>
          Condiciones de Misión
        </h2>
        <div class="who">Telemetría ambiental y parámetros del terreno · Datos reales NASA PDS / REMS · ${esc(D.site)}</div>
      </div>
      <button class="modal-close-corner" id="btnDashClose" aria-label="Cerrar ventana">✕</button>
    </div>
    <div class="dash-modal-tabs" role="tablist" aria-label="Secciones de condiciones">
      <button role="tab" class="dash-tab-btn" data-tab="atm" aria-selected="${dashTab === "atm"}">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/></svg>
        Atmósfera y Clima
      </button>
      <button role="tab" class="dash-tab-btn" data-tab="ter" aria-selected="${dashTab === "ter"}">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="m14 6-3.75 5 2.85 3.8-1.6 1.2-4.5-6L1 18h22L14 6z"/></svg>
        Terreno y Rutas
      </button>
      <button role="tab" class="dash-tab-btn" data-tab="mod" aria-selected="${dashTab === "mod"}">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>
        Modelo Predictivo
      </button>
    </div>
    <div class="mbody dash-modal-body" id="dashBody"></div>
    <div class="dash-modal-foot">
      <span class="dash-foot-hint">Presiona <span class="kbd">Esc</span> o haz clic fuera para volver al mapa</span>
      <button class="btn primary" id="btnDashDone">Cerrar</button>
    </div>`;

    showModal(html, {
      cls: "modal-condiciones",
      isDashboard: true,
      onClose: () => {
        MR.hideTip();
        const b = dashBack; dashBack = null; b && b();
      },
      bind: m => {
        const btnClose = m.querySelector("#btnDashClose");
        if (btnClose) btnClose.addEventListener("click", closeDashboard);
        const btnDone = m.querySelector("#btnDashDone");
        if (btnDone) btnDone.addEventListener("click", closeDashboard);
        m.querySelectorAll(".dash-tab-btn").forEach(b => {
          b.addEventListener("click", () => {
            dashTab = b.dataset.tab;
            m.querySelectorAll(".dash-tab-btn").forEach(t => t.setAttribute("aria-selected", t.dataset.tab === dashTab));
            renderDashboardTabContent();
          });
        });
        renderDashboardTabContent();
      }
    });
  }

  function renderDashboardTabContent() {
    const body = $("dashBody");
    if (!body) return;
    if (dashTab === "atm") dashAtm(body);
    else if (dashTab === "ter") dashTerrain(body);
    else dashModel(body);
  }

  function renderDashboard() {
    if (modalState && modalState.isDashboard && $("dashBody")) {
      renderDashboardTabContent();
    } else {
      renderDashboardModal();
    }
  }
  function dashAtm(body) {
    const P = D.rems[dashSol], hrs = P.hours;
    const VARS = { temp: ["Temperatura", "°C"], uv: ["Radiación UV", "W/m²"], p: ["Presión", "Pa"], rh: ["Humedad relativa", "%"] };
    const c1 = css("--accent"), c2 = css("--caution");
    const series = dashVar === "temp" ? [{ name: "Aire", values: P.air_c, hours: hrs, color: c1 }, { name: "Suelo", values: P.ground_c, hours: hrs, color: c2, dash: "6 4" }]
      : [{ name: VARS[dashVar][0], values: dashVar === "uv" ? P.uv_w_m2 : dashVar === "p" ? P.pressure_pa : P.rh_pct, hours: hrs, color: c1 }];
    const vals = series[0].values; const mn = Math.min(...vals), mx = Math.max(...vals);
    const now = T.mode === "walk" || T.mode === "done" ? time().hour : null;
    const desc = { temp: "Ciclo de un sol completo medido por Curiosity. La franja azul es la ventana de caminata (08:00–17:00).",
      uv: "La radiación ultravioleta llega casi sin filtro: el polvo en el aire la reduce (sol 4500 tiene más polvo).",
      p: "La presión es ~0,6 % de la terrestre y sube y baja cada día por el calentamiento de la atmósfera.",
      rh: "Humedad relativa: sube de noche cuando el aire se enfría." }[dashVar];
    body.innerHTML = `<div class="grid-2"><div class="card">
      <div class="filters"><div class="seg" role="radiogroup" aria-label="Variable">${Object.entries(VARS).map(([k, [n]]) => `<button role="radio" aria-checked="${k === dashVar}" data-v="${k}">${n}</button>`).join("")}</div>
      <div class="seg" role="radiogroup" aria-label="Sol medido"><button role="radio" data-s="sol_100" aria-checked="${dashSol === "sol_100"}">Sol 100 (2012)</button><button role="radio" data-s="sol_4500" aria-checked="${dashSol === "sol_4500"}">Sol 4500 (2025)</button></div></div>
      <h3>${VARS[dashVar][0]} a lo largo del sol</h3><p class="desc">${desc}</p>
      ${series.length > 1 ? `<div class="legend-row" style="margin-bottom:6px">${series.map(s => `<span><i style="--c:${s.color}"></i>${s.name}</span>`).join("")}</div>` : ""}
      <div class="chart" id="atmChart"></div></div>
      <div class="card"><h3>Resumen del sol</h3><p class="desc">Medido en la base del cráter (−4 500 m). En la ruta se corrige por altura.</p>
        <div class="kpi"><span class="v num">${fmt(mn, 1)}<small> ${VARS[dashVar][1]}</small></span><span class="k">Mínimo</span></div>
        <div class="kpi"><span class="v num">${fmt(mx, 1)}<small> ${VARS[dashVar][1]}</small></span><span class="k">Máximo</span></div>
        ${T.wx ? `<div class="kpi"><span class="v num">${fmt(dashVar === "temp" ? T.wx.air : dashVar === "uv" ? T.wx.uv : dashVar === "p" ? T.wx.p : T.wx.rh, 1)}<small> ${VARS[dashVar][1]}</small></span><span class="k">Ahora en tu posición (${time().label})</span></div>` : ""}
        <p class="desc" style="margin-top:12px">Fuente: REMS ENVRDR, NASA PDS Atmospheres Node. ${D.rems[dashSol].hours.length} intervalos de 15 min.</p></div></div>`;
    body.querySelectorAll("[data-v]").forEach(b => b.addEventListener("click", () => { dashVar = b.dataset.v; renderDashboard(); }));
    body.querySelectorAll("[data-s]").forEach(b => b.addEventListener("click", () => { dashSol = b.dataset.s; renderDashboard(); }));
    MR.lineChart($("atmChart"), { series, unit: VARS[dashVar][1], eva: true, marker: now, showZero: dashVar === "temp", zeroBase: dashVar === "uv", decimals: dashVar === "uv" ? 2 : 1, label: VARS[dashVar][0] });
  }
  function dashTerrain(body) {
    const A = T.mode === "walk" || T.mode === "done" ? T.route : T.adjusted || T.baseRoute;
    const B = T.crew.main === "summit" ? MR.withKm(D.routes.summit_short.points) : T.shortRoute;
    const sa = MR.routeStats(A), sb = B ? MR.routeStats(B) : null;
    const rows = [["Longitud", "length", " km", 1, "min"], ["Horas de caminata (est.)", "hours", " h", 1, "min"], ["Pendiente media", "meanSlope", "°", 1, "min"], ["Pendiente máxima", "maxSlope", "°", 1, "min"],
      ["Rugosidad media", "meanRough", " m", 1, "min"], ["Facilidad de paso media", "meanTrav", "", 2, "max"], ["Tramos sobre el umbral", "hazards", "", 0, "min"], ["Trayecto con paso difícil", "lowFrac", " %", 0, "min", 100]];
    const cell = (st, other, r) => { const v = st[r[1]] * (r[5] || 1); const o = other ? other[r[1]] * (r[5] || 1) : null;
      const best = o != null && (r[4] === "min" ? v < o : v > o); return `<td class="${best ? "best" : ""}">${fmt(v, r[3])}${r[2]}</td>`; };
    const ca = MR.slopeClasses(A), cb = B ? MR.slopeClasses(B) : null;
    body.innerHTML = `<div class="grid-2"><div class="card"><h3>Comparación de rutas</h3><p class="desc">El modelo acepta caminar más a cambio de pisar terreno más fácil. En verde, el mejor valor de cada fila.</p>
      <table class="cmp"><thead><tr><th>Indicador</th><th>${T.mode === "walk" || T.mode === "done" ? "Ruta en uso" : "Ruta del modelo"}</th>${sb ? "<th>Ruta corta</th>" : ""}</tr></thead>
      <tbody>${rows.map(r => `<tr><th scope="row" style="font-weight:500">${r[0]}</th>${cell(sa, sb, r)}${sb ? cell(sb, sa, r) : ""}</tr>`).join("")}</tbody></table></div>
      <div class="card"><h3>¿Por qué la ruta corta no es óptima?</h3><ul class="explain">
        ${sb ? `<li>Pasa ${fmt(sb.lowFrac * 100, 0)} % del tiempo por terreno que el modelo califica como difícil (vs. ${fmt(sa.lowFrac * 100, 0)} %).</li>
        <li>Su rugosidad media es ${fmt(sb.meanRough, 1)} m: más rocas y escalones pequeños.</li>
        <li>Es como cruzar una ciudad por calles empinadas y rotas para ahorrar unas cuadras: llegas igual de cansado y con más riesgo de caer.</li>` : "<li>Sin ruta de comparación para esta misión.</li>"}
        <li>Las zonas no recomendadas (capa roja) se pueden ver en Capas → Zonas no recomendadas.</li></ul></div></div>
      <div class="card" style="margin-top:16px"><h3>Distancia por tipo de pendiente</h3><p class="desc">Kilómetros de cada ruta según qué tan inclinado es el terreno.</p>
      <div class="legend-row" style="margin-bottom:8px"><span><i class="sq" style="--c:${css("--accent")}"></i>${T.mode === "walk" || T.mode === "done" ? "Ruta en uso" : "Ruta del modelo"}</span>${cb ? `<span><i class="sq" style="--c:${css("--text-2")}"></i>Ruta corta</span>` : ""}</div>
      <div class="chart" id="slopeBars"></div></div>`;
    const labels = ["Plano (≤ 5°)", `Suave (5–${MR.cfg.caution}°)`, `Precaución (${MR.cfg.caution}–${MR.cfg.critSlope}°)`, `Peligro (> ${MR.cfg.critSlope}°)`];
    const items = [];
    labels.forEach((l, i) => {
      items.push({ label: l, value: ca[i], text: fmt(ca[i], 1) + " km", color: css("--accent") });
      if (cb) items.push({ label: "", value: cb[i], text: fmt(cb[i], 1) + " km", color: css("--text-2"), tip: "Ruta corta" });
    });
    MR.barH($("slopeBars"), items, { label: "Distancia por pendiente", labelW: 170 });
  }
  function dashModel(body) {
    const M = D.model.metrics.test, FI = D.model.feature_importance;
    const names = { slope: "Pendiente", roughness: "Rugosidad", texture: "Textura óptica", gradient: "Gradiente óptico", thermal: "Térmico" };
    const cm = M.confusion_matrix; const max = Math.max(...cm.flat());
    const shade = v => `color-mix(in srgb, ${css("--accent")} ${Math.round(25 + (v / max) * 75)}%, ${css("--panel-2")})`;
    body.innerHTML = `<div class="grid-3">
      <div class="card"><div class="kpi"><span class="v num">${fmt(M.roc_auc, 2)}</span><span class="k">ROC AUC en prueba: de cada 100 pares (terreno bueno, terreno malo), el modelo ordena bien ~${Math.round(M.roc_auc * 100)}.</span></div></div>
      <div class="card"><div class="kpi"><span class="v num">${fmt(M.accuracy * 100, 0)} %</span><span class="k">Exactitud: celdas clasificadas correctamente (${M.samples} celdas de prueba).</span></div></div>
      <div class="card"><div class="kpi"><span class="v num">${fmt(M.average_precision, 2)}</span><span class="k">Precisión promedio: qué tan confiable es cuando dice “se puede caminar”.</span></div></div></div>
      <div class="grid-2" style="margin-top:16px"><div class="card"><h3>¿En qué se fija el modelo?</h3><p class="desc">Importancia de cada variable en el bosque aleatorio de 300 árboles. Rugosidad y pendiente deciden casi todo, como cuando eliges por dónde subir un cerro: miras qué tan inclinado y qué tan pedregoso está.</p>
        <div class="chart" id="fiBars"></div></div>
      <div class="card"><h3>Matriz de confusión (prueba)</h3><p class="desc">El modelo es prudente: casi nunca llama “fácil” a un terreno peligroso (${cm[0][1]} casos), aunque a veces descarta terreno bueno.</p>
        <div class="cm"><span></span><span class="h">Predice difícil</span><span class="h">Predice fácil</span>
          <span class="h">Real difícil</span><div class="cell" style="background:${shade(cm[0][0])}">${cm[0][0]}</div><div class="cell" style="background:${shade(cm[0][1])}">${cm[0][1]}</div>
          <span class="h">Real fácil</span><div class="cell" style="background:${shade(cm[1][0])}">${cm[1][0]}</div><div class="cell" style="background:${shade(cm[1][1])}">${cm[1][1]}</div></div></div></div>
      <div class="card" style="margin-top:16px"><h3>Cómo se entrenó</h3><ul class="explain">
        <li>Ejemplos positivos: celdas a menos de 60 m del camino real de Curiosity (${D.model.metrics.positives}). Negativos: celdas lejanas con pendiente &gt; 15° o textura muy rugosa (${D.model.metrics.negatives}).</li>
        <li>División espacial 70/15/15 a lo largo del recorrido para que el modelo no “haga trampa” viendo zonas vecinas.</li>
        <li>La probabilidad se usa como costo en A*: <span class="num">costo = 1 + ${MR.cfg.riskW}·(1 − p)² + ${MR.cfg.slopeW}·pendiente²</span>; las celdas con pendiente &gt; ${MR.cfg.maxSlope}° se bloquean.</li></ul></div>`;
    MR.barH($("fiBars"), Object.entries(FI).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: names[k], value: v, text: fmt(v * 100, 0) + " %", color: css("--accent") })), { max: 0.5, labelW: 140 });
  }
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  /* =====================================================
     VISTA COMPLETA — Resumen automático
     ===================================================== */
  function openSummary() {
    const el = $("summary"), R = T.route, st = MR.routeStats(R);
    const sols = Math.floor(T.simMin / 1440) + 1, sec = T.missions.filter(m => m.status === "completada").length;
    const hrs = (T.simMin - EVA_START * 60) / 60;
    el.innerHTML = `<header class="fv-head"><button class="btn" data-back>↩ Volver al mapa</button><div><h2>Resumen de la misión</h2><div class="sub">${T.crew.short} · ${T.crew.role}</div></div></header>
      <div class="fv-body"><div class="sum-hero"><div>
        <h1><span class="ok">${MR.ICONS.ok}</span>Misión completada</h1>
        <p style="color:var(--text-2);font-size:16px;margin:0">${esc(T.crew.title)} · llegada ${time().label}</p>
        <div class="sum-stats">
          <div class="stat"><span class="v num">${fmt(st.length, 1)}</span><span class="k">km recorridos</span></div>
          <div class="stat"><span class="v num">${sols}</span><span class="k">${sols === 1 ? "sol" : "soles"} (${fmt(hrs, 0)} h)</span></div>
          <div class="stat"><span class="v num">+${fmt(st.maxElev - R[0][3], 0)}</span><span class="k">m de desnivel</span></div>
          <div class="stat"><span class="v num">${T.findings.length}</span><span class="k">hallazgos</span></div>
          <div class="stat"><span class="v num">${sec}</span><span class="k">secundarias completadas</span></div>
          <div class="stat"><span class="v num">${T.alerts}</span><span class="k">alertas atendidas · ${T.detours} desvíos</span></div></div>
        <div class="actions" style="display:flex;gap:8px"><button class="btn primary" data-new>Nueva misión</button><button class="btn" data-log>Ver bitácora</button></div>
        <h3 style="margin:24px 0 10px;font-size:15px">Línea de tiempo</h3><ol class="timeline"></ol></div>
        <div><div class="sum-map"><img alt="Mapa del recorrido" src="assets/basemap_${S.base === "thermal" ? "relief" : S.base}.jpg"><svg viewBox="0 0 1200 1200" aria-hidden="true"></svg></div>
        <div class="profile" style="margin-top:12px;height:150px" id="sumProfile"></div></div></div></div>`;
    const svg = el.querySelector(".sum-map svg"); const NS = "http://www.w3.org/2000/svg";
    const xs = R.map(p => MR.toWorld(p[0], p[1]));
    const minx = Math.min(...xs.map(a => a[0])) - 80, maxx = Math.max(...xs.map(a => a[0])) + 80, miny = Math.min(...xs.map(a => a[1])) - 80, maxy = Math.max(...xs.map(a => a[1])) + 80;
    const span = Math.max(maxx - minx, maxy - miny), cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
    const vb = [cx - span / 2, cy - span / 2, span, span];
    svg.setAttribute("viewBox", vb.join(" ")); svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    const img = el.querySelector(".sum-map img");
    img.style.cssText = `width:${(1200 / span) * 100}%;height:${(1200 / span) * 100}%;left:${(-vb[0] / span) * 100}%;top:${(-vb[1] / span) * 100}%;inset:auto;object-fit:fill`;
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", xs.map((a, i) => (i ? "L" : "M") + a[0].toFixed(1) + "," + a[1].toFixed(1)).join(""));
    path.setAttribute("fill", "none"); path.setAttribute("stroke", "#46C882"); path.setAttribute("stroke-width", span / 150); path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round");
    const len = 1; svg.appendChild(path);
    if (!MR.reduceMotion()) { const L = path.getTotalLength(); path.style.strokeDasharray = L; path.style.strokeDashoffset = L; path.style.transition = "stroke-dashoffset 2.2s cubic-bezier(.2,.7,.2,1)"; requestAnimationFrame(() => requestAnimationFrame(() => (path.style.strokeDashoffset = 0))); }
    [...T.findings.map(f => [f.lon, f.lat, "#46C882"]), [R[0][0], R[0][1], "#1E64DC"], [R[R.length - 1][0], R[R.length - 1][1], "#FC3D21"], ...T.missions.map(m => [m.lon, m.lat, "#A68BFF"])].forEach(([lo, la, c]) => {
      const [x, y] = MR.toWorld(lo, la); const cc = document.createElementNS(NS, "circle");
      cc.setAttribute("cx", x); cc.setAttribute("cy", y); cc.setAttribute("r", span / 80); cc.setAttribute("fill", c); cc.setAttribute("stroke", "#fff"); cc.setAttribute("stroke-width", span / 400);
      svg.appendChild(cc);
    });
    const ol = el.querySelector(".timeline");
    T.events.filter(e => !e.pending && e.txt).sort((a, b) => a.t - b.t).forEach(e => {
      const li = document.createElement("li"); li.style.setProperty("--c", e.c);
      li.innerHTML = `<time>${MR.solTime(e.t).label}</time><span></span>`; li.querySelector("span").textContent = e.txt; ol.appendChild(li);
    });
    el.hidden = false;
    MR.profileChart($("sumProfile"), R, { stages: T.stages, hazards: T.hazards });
    el.querySelector("[data-back]").addEventListener("click", () => (el.hidden = true));
    el.querySelector("[data-log]").addEventListener("click", () => { el.hidden = true; togglePanel("bitacora", "tierra"); });
    el.querySelector("[data-new]").addEventListener("click", () => {
      el.hidden = true;
      const keep = { findings: T.findings, log: T.log, ai: T.ai };
      trips[T.crew.id] = T = Object.assign(newTrip(T.crew), keep);
      renderAll(true); MR.Map.fit(); setTimeout(openMainBriefing, 300);
    });
    el.querySelector("[data-new]").focus({ preventScroll: true });
  }

  /* =====================================================
     AYUDA, RECORRIDO GUIADO Y ATAJOS
     ===================================================== */
  function openHelp() {
    showModal(`<div class="mhead"><h2>Ayuda</h2><p class="who">El robot ya mapeó el terreno; tú decides por dónde caminar. Toca cualquier punto del mapa para ver si es transitable.</p></div>
      <div class="mbody"><div class="help-grid">
      <span class="kbd">Espacio</span><span>Iniciar o pausar la simulación</span>
      <span class="kbd">1 2 3</span><span>Velocidad x1 · x10 · x50</span>
      <span class="kbd">M B H</span><span>Paneles de Misiones, Bitácora y Hallazgos</span>
      <span class="kbd">R</span><span>Reportar hallazgo en tu posición</span>
      <span class="kbd">D</span><span>Condiciones (dashboard)</span>
      <span class="kbd">V</span><span>Cambiar entre mapa 2D y relieve 3D</span>
      <span class="kbd">Esc</span><span>Cerrar la ventana o panel abierto</span></div>
      <p class="who" style="margin-top:14px">Colores: <b style="color:var(--route)">azul</b> ruta, <b style="color:var(--nominal)">verde</b> recorrido y hallazgos, <b style="color:var(--secondary)">morado punteado</b> misiones secundarias, <b style="color:var(--caution)">ámbar</b> precaución, <b style="color:var(--danger)">rojo</b> peligro.</p>
      <div class="actions"><button class="btn" data-t>Repetir recorrido guiado</button><button class="btn primary" data-x>Entendido</button></div></div>`, {
      bind: m => { m.querySelector("[data-x]").addEventListener("click", closeModal); m.querySelector("[data-t]").addEventListener("click", () => { closeModal(); startTour(); }); },
    });
  }
  function startTour(done) {
    const steps = [
      { el: ".statusbar", t: "Barra de estado", p: "Aquí ves quién camina (cada explorador hace su propio viaje), el sol y la hora marciana, ▶ para iniciar y los kilómetros recorridos." },
      { el: "#map", t: "El mapa nunca se cierra", p: "Toca cualquier punto: verás si es transitable y podrás registrar un hallazgo, crear una misión o medir una distancia. A la izquierda, capas y filtros." },
      { el: ".rail", t: "Paneles y reportes", p: "Misiones, Bitácora (Tierra y asistente) y Hallazgos se abren aquí, uno a la vez. El botón verde Reportar aquí registra un hallazgo donde estás." },
    ];
    let i = 0; const tour = $("tour"); tour.hidden = false;
    const show = () => {
      const s = steps[i], r = document.querySelector(s.el).getBoundingClientRect();
      const pad = 6, small = s.el === "#map";
      const box = small ? { left: r.left + r.width * 0.3, top: r.top + r.height * 0.25, width: r.width * 0.4, height: r.height * 0.45 } : { left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
      tour.innerHTML = `<div class="hole" style="left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px"></div>
        <div class="tip" role="dialog" aria-label="Recorrido guiado"><h3>${s.t}</h3><p>${s.p}</p><footer><div class="dots">${steps.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div>
        <div style="display:flex;gap:6px"><button class="btn ghost" data-s>Saltar</button><button class="btn primary" data-n>${i < steps.length - 1 ? "Siguiente" : "Empezar"}</button></div></footer></div>`;
      const tip = tour.querySelector(".tip");
      let tx = Math.min(window.innerWidth - 340, Math.max(16, box.left + (s.el === ".rail" ? -340 : 0)));
      let ty = box.top + box.height + 12; if (ty + 180 > window.innerHeight) ty = Math.max(16, box.top - 190);
      if (s.el === ".rail") { tx = box.left - 340; ty = box.top; }
      tip.style.left = tx + "px"; tip.style.top = ty + "px";
      const end = () => { tour.hidden = true; MR.store.set("tourDone", true); done && done(); };
      tour.querySelector("[data-s]").addEventListener("click", end);
      tour.querySelector("[data-n]").addEventListener("click", () => { i++; if (i >= steps.length) end(); else show(); });
      tour.querySelector("[data-n]").focus({ preventScroll: true });
    };
    show();
  }
  function bindKeys() {
    document.addEventListener("keydown", e => {
      if (e.target.matches("input, textarea, select")) { if (e.key === "Escape") e.target.blur(); return; }
      if (!$("tour").hidden) return;
      const k = e.key.toLowerCase();
      if (k === "escape") {
        if (!$("modal").hidden && modalState && modalState.dismiss !== false) return closeModal();
        if (!$("dashboard").hidden) return closeDashboard();
        if (!$("summary").hidden) return ($("summary").hidden = true);
        if (anchor) return closePointUI();
        if (picking) { picking = null; MR.Map.setPicking(false); return; }
        if (S.panel) return togglePanel(null);
        return;
      }
      if (!$("modal").hidden || !$("dashboard").hidden || !$("summary").hidden) return;
      if (k === " ") { e.preventDefault(); togglePlay(); }
      else if (k === "1" || k === "2" || k === "3") setSpeed([1, 10, 50][+k - 1]);
      else if (k === "m") togglePanel("misiones");
      else if (k === "b") togglePanel("bitacora");
      else if (k === "h") togglePanel("hallazgos");
      else if (k === "r") reportHere();
      else if (k === "d") openDashboard();
      else if (k === "v") setView(S.view === "2d" ? "3d" : "2d");
      else if (k === "?") openHelp();
    });
  }
  function closeAllTransient() {
    closePointUI(); if (!$("modal").hidden) { modalState = null; $("modal").hidden = true; $("scrim").hidden = true; }
    $("stageCard").hidden = true; if (S.panel) togglePanel(null);
  }

  /* =====================================================
     RENDER GLOBAL
     ===================================================== */
  function renderAll(full) {
    recomputeHazards(); renderStatus(); renderRail(); renderRoutes(); refreshMarkers(); renderDock(true); renderObjList(); renderStops();
    if (S.panel) renderPanel();
    if (T.mode === "walk" && !T.wx) updateWeather(true);
    update3d();
  }
  window.addEventListener("resize", () => {
    if (T.mode === "walk") renderProfile();
    if (window.innerWidth < 820 && !$("leftPanel").classList.contains("collapsed") && T.mode !== "base") setLeft(false);
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
