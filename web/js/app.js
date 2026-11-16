/* =========================================================
   app.js — expedition flow, simulation and interface
   Flow: Base map → Briefing → Plan → Traverse → Summit → Summary
   ========================================================= */
(function () {
  "use strict";
  const MR = window.MR, D = MR.D, $ = id => document.getElementById(id);
  const esc = MR.esc, fmt = MR.fmt;
  MR.reduceMotion = () => document.documentElement.classList.contains("reduce") || matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* =====================================================
     CREW — each explorer makes their own trip
     ===================================================== */
  const CREW = [
    { id: "ev1", short: "EV1", role: "Commander", color: "#1E64DC", main: "summit",
      title: "Reach the summit of Mount Sharp", goalId: "summit", profile: "sol_100" },
    { id: "ev2", short: "EV2", role: "Geologist", color: "#B5651D", main: "crism",
      title: "Reach the CRISM spectral footprint", goalId: "frt0000a091", profile: "sol_100" },
    { id: "ev3", short: "EV3", role: "Engineer", color: "#127846", main: "traverse_end",
      title: "Follow Curiosity's traverse", goalId: "traverse_end", profile: "sol_4500" },
  ];
  const ONE_WAY_MIN = 12;           // Mars → Earth communication delay (simulated)
  const MIN_PER_SEC = 2;            // x1 = 2 Martian minutes per real second
  // display labels for the stored mission-status tokens
  const STATUS_LABEL = { proposed: "proposed", accepted: "accepted", "in_progress": "in progress", completed: "completed", aborted: "aborted" };
  // Configurable EVA workday (see MR.eva in core.js): start and end of the walk (the end subtracts the safety reserve)
  const evaStart = () => MR.eva.cfg.startHour, evaEnd = () => MR.eva.walkEndHour(), hm = h => MR.fmtHM(h);

  function newTrip(c) {
    const base = MR.withKm(D.routes[c.main].points);
    return {
      crew: c, mode: "base", choice: "model", baseRoute: base, adjusted: null, shortRoute: null, route: null,
      profileMode: "safe", mobility: "astronaut", alertTriggered: false,
      km: 0, simMin: MR.eva.cfg.startHour * 60, playing: false, speed: 1, stages: [], stageIdx: 0,
      findings: [], missions: [], log: [], ai: [], handled: {}, events: [], proposed: {},
      unread: { missions: 1, logbook: 0, findings: 0 }, briefed: false, wx: null, lastWx: -1e9,
      lastTele: -1e9, flags: {}, alerts: 0, detours: 0, hazards: [], lows: [], stops: [], measure: null,
      // radiation (simplified model): accumulated EVA dose, per sol, and active solar event if any
      rad: { total: 0, bySol: {}, spe: null, crit: {}, flags: {} }, returning: null, sharedSeen: {},
    };
  }
  const trips = {}; CREW.forEach(c => (trips[c.id] = newTrip(c)));
  let T = trips.ev1;
  const S = { view: "2d", layer: "hazard", opacity: 0.55, base: "relief", panel: null,
    types: { goal: 1, base: 1, mineral: 1, spectral: 1, science: 1, reference: 1 }, distMax: 60, logTab: "earth", fTab: "all" };
  const UI = (MR.UI = {});
  MR.state = () => T; // inspection (console / tests)

  /* =====================================================
     STATE UTILITIES
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
    if (currentRegion === "jezero" && window.JEZERO_DATA && window.JEZERO_DATA.targets) {
      return window.JEZERO_DATA.targets;
    }
    return D.targets;
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
     STARTUP
     ===================================================== */
  function init() {
    // images with fallback (CSP does not allow inline onerror); 'error' does not bubble, hence the capture
    document.addEventListener("error", e => {
      const im = e.target;
      if (im && im.tagName === "IMG" && im.dataset.fallback && !im.dataset.fbDone) { im.dataset.fbDone = "1"; im.src = im.dataset.fallback; }
    }, true);
    MR.cfg.radThr = +MR.store.get("radThr", MR.cfg.radThr) || MR.cfg.radThr;
    MR.eva.load(MR.store.get("eva", {})); syncTripClocks();
    // theme and motion preferences remembered
    const th = MR.store.get("theme", matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = th;
    if (MR.store.get("reduce", false)) { document.documentElement.classList.add("reduce"); $("btnMotion").setAttribute("aria-pressed", "true"); }

    MR.Map.init();
    MR.Map.setBase(S.base);
    MR.Map.setLayer(S.layer, S.opacity);
    MR.Map.drawTraverse(true); MR.Map.drawCrism(true);
    MR.Map.onClick(onMapClick);
    buildCrew(); buildLeftPanel(); bindEva(); bindTop(); bindKeys();
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
    if (initTab === "atm" || initTab === "ter" || initTab === "mod" || initTab === "rad") dashTab = initTab;
    MR.Shared.onChange(deliverShared); MR.Shared.load();
    MR.API.init().then(online => { if (online) MR.Shared.startPolling(); });
    requestAnimationFrame(loop);
    if (initModal === "conditions") {
      openDashboard();
    } else if (initModal === "help") {
      openHelp();
    } else if (initModal === "none") {
      // Skips opening the briefing automatically in tests
    } else {
      setTimeout(() => {
        if (!MR.store.get("tourDone", false)) startTour(() => openMainBriefing());
        else openMainBriefing();
      }, 450);
    }
  }

  /* =====================================================
     STATUS BAR
     ===================================================== */
  function buildCrew() {
    const box = document.querySelector(".crew"); box.setAttribute("role", "radiogroup");
    CREW.forEach(c => {
      const b = document.createElement("button"); b.setAttribute("role", "radio"); b.dataset.id = c.id;
      b.innerHTML = `<span class="av" style="--c:${c.color}">${c.short.slice(2)}</span><span class="nm">${c.short}<span class="role"> · ${c.role}</span></span>`;
      b.title = `${c.short} · ${c.role}: ${c.title}. Each explorer makes their own trip separately.`;
      b.addEventListener("click", () => switchCrew(c.id));
      box.appendChild(b);
    });
  }
  function switchCrew(id) {
    if (T.crew.id === id) return;
    T.playing = false; closeAllTransient();
    T = trips[id]; syncMobilityUI();
    renderAll(true);
    MR.Map.fit();
    banner({ kind: "info", title: `${T.crew.short} · ${T.crew.role}`, sub: "Independent trip: its route, clock and logbook are its own.", ttl: 3500 });
    if (!T.briefed) setTimeout(openMainBriefing, 300);
  }
  let currentRegion = "gale";

  function switchRegion(regionId) {
    if (regionId === currentRegion) return;
    currentRegion = regionId;
    MR.setRegion(regionId);
    const regSel = $("regionSelect");
    if (regSel && regSel.value !== regionId) regSel.value = regionId;
    document.querySelectorAll(".rqs-btn").forEach(b => b.classList.toggle("active", b.dataset.region === regionId));

    if (regionId === "jezero") {
      $("brandTitle").textContent = "Jezero Crater Mission";
      $("brandSub").textContent = "Jezero Crater · Mars (Perseverance)";
      banner({ kind: "info", title: "Region: Jezero Crater", sub: "Perseverance mission · Jezero terrain and mosaic active.", ttl: 4000 });

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
      $("brandTitle").textContent = "Safe Route to Mount Sharp";
      $("brandSub").textContent = "Gale Crater · Mars (Curiosity)";
      banner({ kind: "info", title: "Region: Gale Crater", sub: "Curiosity mission · Local terrain and prediction active.", ttl: 4000 });

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

  function triggerWeatherAlert() {
    T.playing = false; renderStatus(); T.alerts++;
    if (S.panel) togglePanel(null);
    $("stageCard").hidden = true;
    T.events.push({ t: T.simMin, c: "var(--danger)", txt: "Critical alert: dust storm at MDA-GALE-14" });
    logSys("CRITICAL ALERT MDA-GALE-14: Wind 28.4 m/s (threshold: 20 m/s), Opacity tau 2.15 (threshold: 1.50).");

    showModal(`<div class="mhead"><div class="tag-line"><span class="tg alert">Critical weather alert · Simulation paused</span></div>
      <h2>${MR.ICONS.warn}Dust storm and wind at MDA-GALE-14</h2>
      <div class="coords" style="color:var(--text-2);font-size:12px;margin-top:2px">Sol 1 · 11:30 LTST · Gale Station (137.48°E, -4.68°S)</div></div>
      <div class="mbody">
        ${factsHtml([
          ["28.4 m/s", "Wind (Critical > 20 m/s)"],
          ["2.15", "Opacity τ (Critical > 1.50)"],
          ["−64 °C", "Ambient temp."],
          ["Bagnold Dunes", "Affected corridor"]
        ])}
        <div class="alt" style="margin-top:10px;padding:10px;border-left:3px solid var(--danger);background:var(--panel-2);border-radius:4px">
          <strong>Predictive system explanation:</strong><br>
          Station MDA-GALE-14 reports severe gusts and a drop in direct visibility over the Bagnold Dunes corridor.
          A direct crossing carries a high risk of abrasion and of the vehicle getting stuck.
          <br><strong>Recommendation:</strong> Replan immediately by activating the <em>Safe Profile</em> to go around the storm toward Mount Sharp Base.
        </div>
        <div class="actions" style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">
          <button class="btn ghost" data-ignore>Keep current course</button>
          <button class="btn primary" data-replan>Replan safe route</button>
        </div>
      </div>`, {
      cls: "critical", dismiss: false,
      bind: el => {
        el.querySelector("[data-ignore]").addEventListener("click", () => {
          closeModal();
          banner({ kind: "warn", title: "Alert ignored by the operator", sub: "Risk of sensor damage and of getting stuck in Bagnold Dunes.", ttl: 5000 });
          T.playing = true; renderStatus();
        });
        el.querySelector("[data-replan]").addEventListener("click", () => {
          closeModal();
          setRouteProfile("safe");
          const curP = curPos() || T.baseRoute[0];
          MR.API.sendReport({
            id: uid("rep_storm_"),
            author: T.crew.id,
            type: "weather_alert",
            lon: curP[0],
            lat: curP[1],
            elev: curP[3] || -4400,
            km: T.km,
            text: "Emergency replanning due to dust storm MDA-GALE-14 (wind 28.4 m/s, tau 2.15)",
            attachments: { wind: 28.4, tau: 2.15, simMin: T.simMin, station: "MDA-GALE-14" },
            sync_status: "local"
          });
          toast("Route replanned: safe eastern corridor toward Mount Sharp Base");
          banner({ kind: "nominal", title: "Route replanned successfully", sub: "Avoiding the storm corridor at MDA-GALE-14 · Safe shelter verified.", ttl: 6000 });
        });
      }
    });
  }

  function setRouteProfile(p) {
    T.profileMode = p;
    document.querySelectorAll("#profileSeg button").forEach(b => {
      b.setAttribute("aria-checked", b.dataset.profile === p);
    });
    if (p === "safe") {
      Object.assign(MR.cfg, { riskW: 5.0, slopeW: 4.0, maxSlope: 15 });
    } else if (p === "fast") {
      Object.assign(MR.cfg, { riskW: 1.5, slopeW: 1.0, maxSlope: 20 });
    } else if (p === "scientific") {
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
    toast(`Active profile: ${p.toUpperCase()}`);
  }

  function setMobility(m) {
    T.mobility = m; syncMobilityUI(); evaSummary();
    renderProfileMetrics();
    if (T.mode === "plan") renderPlanCards();
    toast(`Mobility mode: ${m === "rover" ? "Pressurized rover" : "EVA on foot (suit)"}`);
  }

  function renderProfileMetrics() {
    const box = $("profileMetrics");
    if (!box) return;
    const r = activeRoute() || T.baseRoute;
    const res = MR.routeResources(r, T.mobility || "rover");
    if (!res) { box.innerHTML = "<p>No active route</p>"; return; }

    const isRover = (T.mobility || "rover") === "rover";
    const modeLabel = isRover ? "Pressurized rover" : "EVA suit (on foot)";
    const shelterBadgeCls = res.shelterOk ? "ok" : "err";
    const shelterBadgeText = res.shelterOk ? "SHELTER VERIFIED" : "NO PRESSURIZED SHELTER";

    box.innerHTML = `
      <div class="metric-item">
        <span class="metric-lbl">Estimated time</span>
        <span class="metric-val">${fmt(res.hours, 1)} h · ${MR.eva.plan(r, T.mobility || "rover").solsCeil} ${MR.eva.plan(r, T.mobility || "rover").solsCeil === 1 ? "sol" : "sols"}</span>
      </div>
      <div class="metric-item">
        <span class="metric-lbl">O₂ consumption ${isRover ? "" : "per workday "}(${fmt(res.o2Consumed, 0)} L)</span>
        <span class="metric-val" style="color:${res.o2Pct > 80 ? 'var(--danger)' : 'var(--nominal)'}">${fmt(res.o2Pct, 0)}% (reserve ${fmt(res.o2RemainingPct, 0)}%)</span>
      </div>
      <div class="metric-item">
        <span class="metric-lbl">Battery (${modeLabel})</span>
        <span class="metric-val" style="color:${res.battPct > 85 ? 'var(--danger)' : 'var(--nominal)'}">${fmt(res.battPct, 0)}%</span>
      </div>
      <div class="metric-item">
        <span class="metric-lbl">Radiation dose</span>
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
      const provBadge = na ? '<span class="badge-prov na">GALE ONLY</span>' : (L.provLabel ? `<span class="badge-prov ${L.prov}">${L.provLabel}</span>` : "");
      const subTxt = isJezero
        ? (L.key === "none" ? "Jezero CTX photographic mosaic" : L.key === "slope" ? "MOLA / HiRISE slope" : L.key === "hazard" ? "Jezero obstacles and scarps" : L.key === "roughness" ? "MOLA local roughness" : "Perseverance traversability")
        : L.sub;
      b.innerHTML = `<span class="sw" style="background:${sw}"></span>` +
        `<span><b>${L.name}</b><small>${na ? "Only available in Gale (local THEMIS/Viking)" : subTxt}</small></span>` +
        `<span class="right-wrap" style="display:flex;align-items:center;gap:4px">${provBadge}${L.src ? '<span class="info" tabindex="0" aria-label="Source">?</span>' : ''}</span>`;
      b.addEventListener("click", () => {
        if (na) { toast(`The layer «${L.name}» is specific to Gale Crater (THEMIS IR).`); return; }
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
     SCIENTIFIC SEARCH AND MINERAL VIEWER
     ===================================================== */
  let activeMineralCategory = "All";
  let mineralSearchQuery = "";
  let scientificSearchMode = false;

  const MINERAL_CATEGORIES = [
    "All",
    "Hydrated minerals",
    "Clays / Phyllosilicates",
    "Hydrated sulfates",
    "Iron oxides",
    "Carbonates / Olivine",
    "Basaltic silicates"
  ];

  function getRegionMinerals() {
    const all = window.MARS_MINERALS || [];
    const reg = currentRegion || "gale";
    return all.filter(m => m.region === reg);
  }

  function matchesCategory(m, cat) {
    if (cat === "All") return true;
    if (cat === "Hydrated minerals") {
      return (
        m.category.includes("Hydrated") ||
        m.category.includes("Clays") ||
        m.category.includes("sulfates") ||
        m.category.includes("Silica") ||
        m.category.includes("Phyllosilicates")
      );
    }
    return m.category === cat || m.category.includes(cat);
  }

  function renderMineralsUI() {
    const regBadge = $("minRegionBadge");
    if (regBadge) {
      const reg = currentRegion || "gale";
      regBadge.textContent = reg === "jezero" ? "Jezero Crater · Perseverance" : "Gale Crater · Curiosity";
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
      // EXACT MARKUP REQUIRED BY THE SPECIFICATION:
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
      countEl.textContent = `${filtered.length} target${filtered.length === 1 ? "" : "s"}`;
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty" style="padding:16px;text-align:center;color:var(--text-2);font-size:12px;">No minerals found matching that criterion in this region.</div>`;
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
            <img src="${m.image_url}" alt="${esc(m.name)}" loading="lazy" data-fallback="${esc(m.fallback_url || 'assets/basemap_relief.jpg')}">
          </div>
          <div class="min-card-details">
            <h4 class="min-card-title">${esc(m.name)}</h4>
            <div class="min-card-formula">${esc(m.formula)}</div>
            <div class="min-card-meta">
              <span>${esc(m.instrument.split("/")[0])}</span>
              ${distStr ? `<span>· <strong>${distStr}</strong> away</span>` : ""}
            </div>
          </div>
        </div>
        <div class="min-card-actions">
          <button type="button" class="min-btn-sm" data-act="details">Inspect</button>
          <button type="button" class="min-btn-sm primary" data-act="stop" title="Add to the route stops">${T.stops.includes(m.id) ? "Remove stop" : "Pin stop"}</button>
          <button type="button" class="min-btn-sm" data-act="fly3d" title="View in 3D relief">Fly 3D</button>
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
      toast(`Stop removed: ${m.name}`);
    } else {
      T.stops.push(m.id);
      toast(`Stop added: ${m.name}`);
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
        <button type="button" class="modal-close-corner" data-close title="Close modal" aria-label="Close">
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
        <div class="min-modal-formula-box">Chemical formula: <strong>${esc(m.formula)}</strong></div>
      </div>
      <div class="mbody min-modal-layout">
        <div class="min-modal-media">
          <div class="min-modal-photo-wrap">
            <img src="${m.image_url}" alt="${esc(m.image_title)}" data-fallback="${esc(m.fallback_url || 'assets/basemap_relief.jpg')}">
          </div>
          <div class="min-modal-caption">${esc(m.image_title)}</div>
          <a href="${m.nasa_raw_url}" target="_blank" rel="noopener noreferrer" class="min-nasa-link">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
            Ver fotos crudas en archivo NASA (${m.rover.includes("Curiosity") ? "MSL" : "Mars 2020"})
          </a>
          <div class="min-quick-facts">
            <div class="min-qfact"><span>Mission / Rover:</span><strong>${esc(m.rover)}</strong></div>
            <div class="min-qfact"><span>Martian sol:</span><strong>Sol ${m.sol}</strong></div>
            <div class="min-qfact"><span>Instruments:</span><strong>${esc(m.instrument.split("/")[0])}</strong></div>
            <div class="min-qfact"><span>Camera:</span><strong>${esc(m.camera.split("(")[0])}</strong></div>
            <div class="min-qfact"><span>Coordinates:</span><strong>${m.lon.toFixed(4)}°E, ${m.lat.toFixed(4)}°N</strong></div>
            <div class="min-qfact"><span>MOLA elevation:</span><strong>${m.elev_m} m</strong></div>
            <div class="min-qfact"><span>Distance to route:</span><strong>${distStr}</strong></div>
          </div>
        </div>
        <div class="min-modal-content">
          <div class="min-field">
            <span class="min-field-lbl">Geological summary</span>
            <div class="min-field-val">${esc(m.summary)}</div>
          </div>
          <div class="min-field">
            <span class="min-field-lbl">Stratigraphy and formation conditions</span>
            <div class="min-field-val">${esc(m.geology)}</div>
          </div>
          <div class="min-field">
            <span class="min-field-lbl">Instrumental verification and spectral signature</span>
            <div class="min-spec-box">
              <div style="margin-bottom:6px"><strong>Analytical instruments:</strong> ${esc(m.instrument)}</div>
              <div><strong>Orbital / in situ spectral signature:</strong> ${esc(m.spectral_signature)}</div>
            </div>
          </div>
          <div class="min-modal-actions">
            <button type="button" class="btn ghost spacer" data-close>Close</button>
            <button type="button" class="btn" data-fly>Fly in 3D</button>
            <button type="button" class="btn primary" data-stop>${T.stops.includes(m.id) ? "Remove from stops" : "Pin as stop"}</button>
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

  // Expose for Three.js 3D interaction
  MR.openMineralModal = openMineralModal;

  function bindTop() {
    $("btnPlay").addEventListener("click", togglePlay);
    document.querySelectorAll(".speed button").forEach(b => b.addEventListener("click", () => setSpeed(+b.dataset.speed)));
    $("btnConditions").addEventListener("click", () => openDashboard());
    $("btnTheme").addEventListener("click", () => {
      const n = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = n; MR.store.set("theme", n); renderDock(true);
      if (!$("dashboard").hidden || (modalState && modalState.isDashboard)) renderDashboard();
    });
    $("btnMotion").addEventListener("click", e => {
      const on = !document.documentElement.classList.contains("reduce");
      document.documentElement.classList.toggle("reduce", on); e.currentTarget.setAttribute("aria-pressed", on); MR.store.set("reduce", on);
      toast(on ? "Reduced motion enabled" : "Animations enabled");
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

    // Global 3D Planet controls
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
    const modeTxt = { base: "Base map", plan: "Plan", walk: "Traverse", done: "Mission completed" }[T.mode];
    $("modePill").textContent = modeTxt; $("modePill").dataset.mode = T.mode; document.body.dataset.mode = T.mode;
    $("clock").textContent = time().label;
    const L = activeRoute() ? activeRoute()[activeRoute().length - 1][2] : 0;
    $("kmReadout").textContent = `${fmt(T.km)} / ${fmt(L)} km`;
    const p = $("btnPlay"); p.disabled = T.mode !== "walk"; p.setAttribute("aria-pressed", T.playing);
    p.setAttribute("aria-label", T.playing ? "Pause simulation" : "Start simulation");
    document.querySelectorAll(".crew button").forEach(b => b.setAttribute("aria-checked", b.dataset.id === T.crew.id));
    document.querySelectorAll(".speed button").forEach(b => b.setAttribute("aria-checked", +b.dataset.speed === T.speed));
  }

  /* =====================================================
     LEFT PANEL — layers and filters
     ===================================================== */
  const TYPE_INFO = {
    goal: ["Goal", "#FC3D21"], base: ["Base", "#1E64DC"], mineral: ["Minerals", "#2F7FB8"], spectral: ["Spectral", "#2F7FB8"],
    science: ["Science", "#B5651D"], reference: ["Reference", "#5B6878"],
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
    // targets
    const chips = $("typeChips");
    Object.entries(TYPE_INFO).forEach(([k, [name, c]]) => {
      const b = document.createElement("button"); b.className = "chip-t"; b.setAttribute("aria-pressed", "true");
      b.innerHTML = `<i style="--c:${c}"></i>${name}`;
      b.addEventListener("click", () => { S.types[k] = !S.types[k]; b.setAttribute("aria-pressed", !!S.types[k]); refreshMarkers(); renderObjList(); });
      chips.appendChild(b);
    });
    $("distFilter").addEventListener("input", e => { S.distMax = +e.target.value; $("distOut").textContent = S.distMax + " km"; refreshMarkers(); renderObjList(); });
    // minerals and scientific search
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
        toast(scientificSearchMode ? "Scientific mode enabled: targets highlighted" : "Scientific mode disabled");
        refreshMarkers();
        update3d();
      });
    }
    renderMineralsUI();
    // route profiles
    document.querySelectorAll("#profileSeg button").forEach(b => {
      b.addEventListener("click", () => setRouteProfile(b.dataset.profile));
    });
    document.querySelectorAll("#mobilitySeg button").forEach(b => {
      b.addEventListener("click", () => setMobility(b.dataset.mobility));
    });
    const demoAlertBtn = $("btnDemoAlert");
    if (demoAlertBtn) demoAlertBtn.addEventListener("click", triggerWeatherAlert);
    // route
    const sl = (id, out, key, f) => $(id).addEventListener("input", e => { MR.cfg[key] = +e.target.value; $(out).textContent = f(+e.target.value); });
    sl("riskW", "rwOut", "riskW", v => fmt(v, 1)); sl("slopeW", "swOut", "slopeW", v => fmt(v, 1)); sl("maxSlope", "msOut", "maxSlope", v => v + "°");
    sl("critSlope", "critOut", "critSlope", v => v + "°"); sl("travThr", "travOut", "travThr", v => fmt(v, 2));
    ["critSlope", "travThr"].forEach(id => $(id).addEventListener("change", () => {
      recomputeHazards(); if (S.layer === "hazard") MR.Map.setLayer("hazard", S.opacity); renderRoutes(); renderDock(true);
      toast("Thresholds updated: alerts recalculated");
    }));
    $("btnRecalc").addEventListener("click", recalcRoute);
    $("btnResetRoute").addEventListener("click", () => {
      Object.assign(MR.cfg, { riskW: 4, slopeW: 3, maxSlope: 20 });
      [["riskW", 4, "rwOut", "4"], ["slopeW", 3, "swOut", "3"], ["maxSlope", 20, "msOut", "20°"]].forEach(([i, v, o, t]) => { $(i).value = v; $(o).textContent = t; });
      T.adjusted = null; T.stops = [];
      if (T.mode === "walk") toast("During the traverse: use Recalculate to change the route from your position");
      afterRouteChange(); renderStops(); renderMineralsList();
    });
    renderLegend(); renderObjList(); renderStops(); renderProfileMetrics();
  }
  function selectLayer(key) {
    S.layer = key; MR.Map.setLayer(S.layer, S.opacity); renderLegend(); sync3dTexture();
  }
  // How many sols the traverse takes, stated honestly and with the model's numbers
  function solInfoHtml(route) {
    const E = MR.eva, c = E.cfg, foot = T.mobility !== "rover", ev = E.plan(route, T.mobility), other = E.plan(route, foot ? "rover" : "astronaut");
    const need = ev.needKmhFor(3), hm = MR.fmtHM, sol = n => (n === 1 ? "sol" : "sols");
    return `<div class="sol-box"><div class="sol-head"><b>≈ ${ev.solsCeil} ${sol(ev.solsCeil)}</b><span>${fmt(ev.hours, 0)} h of walking in workdays of ${fmt(ev.windowH, 1)} h (${hm(c.startHour)}–${hm(E.walkEndHour())})</span><span class="tag-sup">ASSUMPTION</span></div>
      <details><summary>Why not 3 sols?</summary><ul class="explain">
        <li>The base flow assumed 3 sols. With this model, ${foot ? "on foot" : "by rover"}, the ${fmt(ev.len, 0)} km take ${fmt(ev.hours, 0)} h at an average pace of ${fmt(ev.avgKmh, 1)} km/h${foot ? " (on flat ground, 2.8 km/h: Tobler function × 0.55 for the suit)" : ""}.</li>
        <li>To do it in 3 sols you would need workdays of ${fmt(ev.needWindowFor(3), 1)} h or an average pace of ${fmt(need, 1)} km/h (${fmt((need / ev.avgKmh - 1) * 100, 0)} % faster).</li>
        <li>${foot ? "In a pressurized rover" : "On foot"} it would be ≈ ${fmt(other.hours, 0)} h (${other.solsCeil} ${sol(other.solsCeil)}).</li>
        <li>The workday, breaks and reserve are changed in Route → EVA workday. They are assumptions: NASA (Nelson, 2021) lists these parameters as open knowledge gaps, with no official figure.</li></ul></details></div>`;
  }
  function syncMobilityUI() {
    MR.eva.mobility = T.mobility;
    document.querySelectorAll("#mobilitySeg button").forEach(b => b.setAttribute("aria-checked", b.dataset.mobility === T.mobility));
  }
  function evaSummary() {
    const el = $("evaSummary"); if (!el) return;
    const ev = MR.eva.plan(activeRoute() || T.baseRoute, T.mobility), c = MR.eva.cfg;
    el.textContent = `Workday ${MR.fmtHM(c.startHour)}–${MR.fmtHM(MR.eva.walkEndHour())}: ${fmt(ev.windowH, 1)} h of walking per sol. Current route: ≈ ${fmt(ev.hours, 0)} h → ≈ ${ev.solsCeil} ${ev.solsCeil === 1 ? "sol" : "sols"}.`;
  }
  // trips that have not started yet start at the configured start time
  function syncTripClocks() {
    Object.values(trips).forEach(t => { if ((t.mode === "base" || t.mode === "plan") && t.km === 0) t.simMin = Math.floor(t.simMin / 1440) * 1440 + MR.eva.cfg.startHour * 60; });
  }
  function bindEva() {
    const EV = MR.eva, F = [["evaStart", "evaStartOut", "startHour", v => MR.fmtHM(v)], ["evaDur", "evaDurOut", "durationH", v => fmt(v, 1) + " h"],
      ["evaPause", "evaPauseOut", "pauseMinPerH", v => v + " min"], ["evaReserve", "evaResOut", "reserveMin", v => v + " min"]];
    const paint = () => F.forEach(([id, out, key, f]) => { $(id).value = EV.cfg[key]; $(out).textContent = f(EV.cfg[key]); });
    const changed = () => {
      MR.store.set("eva", EV.cfg); syncTripClocks(); evaSummary(); renderStatus(); renderProfileMetrics();
      if (T.mode === "plan") renderPlanCards();
      toast("EVA workday updated");
    };
    F.forEach(([id, out, key, f]) => {
      $(id).addEventListener("input", e => { EV.cfg[key] = +e.target.value; $(out).textContent = f(+e.target.value); evaSummary(); });
      $(id).addEventListener("change", changed);
    });
    $("btnEvaReset").addEventListener("click", () => { Object.assign(EV.cfg, EV.DEFAULTS); paint(); changed(); });
    paint(); evaSummary();
  }
  function renderLegend() {
    const L = MR.LAYERS.find(l => l.key === S.layer);
    document.querySelectorAll(".layer-opt").forEach(b => b.setAttribute("aria-checked", b.dataset.key === S.layer));
    if (!L || L.key === "none") { $("legend").innerHTML = ""; return; }
    if (L.key === "hazard") {
      $("legend").innerHTML = `<div class="legend-row" style="display:grid;gap:4px">
        <span><i class="sq" style="--c:#780014"></i>Blocked (slope &gt; 20°)</span>
        <span><i class="sq" style="--c:#C42828"></i>Slope &gt; ${MR.cfg.critSlope}° (critical alert)</span>
        <span><i class="sq" style="--c:#F0963C"></i>Traversability &lt; ${fmt(MR.cfg.travThr, 2)} (warning)</span></div>`;
      return;
    }
    $("legend").innerHTML = `<div class="bar" style="background:${MR.cssRamp(L)}"></div><div class="ends"><span>${L.lo}</span><span>${L.hi}</span></div>` +
      (L.key === "radiation" ? `<div class="legend-note"><span class="tag-sup">SIMPLIFIED</span> × ${fmt(MR.radiation.range[0], 2)} to × ${fmt(MR.radiation.range[1], 2)} · 1.00 = open sky on the crater floor</div>` : "");
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
      b.querySelector("small").textContent = `${TYPE_INFO[o.type][0]} · ${fmt(d)} km from the route`;
      b.addEventListener("click", () => { MR.Map.centerOn(o.lon, o.lat, 2.2); setTimeout(() => openObjective(o), 350); });
      li.appendChild(b); ul.appendChild(li);
    });
    if (!ul.children.length) ul.innerHTML = `<li class="empty">No target meets the filters. Increase the distance or enable more types.</li>`;
  }
  function renderStops() {
    const box = $("stopList"); box.innerHTML = "";
    const minStops = (window.MARS_MINERALS || []).filter(m => T.stops.includes(m.id)).map(m => ({ id: m.id, name: m.name, lon: m.lon, lat: m.lat }));
    const cands = regionObjectives().filter(o => !["base", "goal"].includes(o.type) && o.id !== T.crew.goalId)
      .concat(T.missions.filter(m => m.origin === "own" && m.status !== "completed").map(m => ({ id: m.id, name: m.name, lon: m.lon, lat: m.lat })))
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
  function recalcRoute() {
    const g = goalObj(); const goal = [g.lon, g.lat];
    const stops = T.stops.map(stopLL).filter(Boolean)
      .sort((a, b) => MR.nearestIdx(T.baseRoute, a).i - MR.nearestIdx(T.baseRoute, b).i);
    if (T.mode === "walk") {
      const p = curPos(); const i = MR.nearestKm(T.route, T.km);
      const rest = MR.chain([[p[0], p[1]], ...stops, goal]);
      if (!rest) return toast("No route possible with those limits. Raise the maximum slope.");
      T.route = MR.withKm(T.route.slice(0, i).concat([p], rest.slice(1)));
      T.stages = makeStages(T.route).map(k => Math.max(k, T.km));
      afterRouteChange(); toast("Route recalculated from your position");
      logSys("Route recalculated from the current position with new weights.");
      return;
    }
    const t0 = performance.now();
    const r = MR.chain([[T.baseRoute[0][0], T.baseRoute[0][1]], ...stops, goal]);
    if (!r) return toast("No route possible with those limits. Raise the maximum slope.");
    T.adjusted = r; T.choice = "model";
    if (T.mode === "base") T.mode = "plan";
    afterRouteChange(true);
    toast(`Route adjusted in ${Math.round(performance.now() - t0)} ms · ${fmt(r[r.length - 1][2])} km`);
    // with backend: the same route is refined on the full 44 m grid
    if (MR.API.online) {
      const trip = T, pts = [[T.baseRoute[0][0], T.baseRoute[0][1]], ...stops, goal];
      MR.API.route(pts, MR.cfg, T.profileMode || "safe").then(res => {
        if (!res || !res.route || trip !== T || T.mode !== "plan") return;
        T.adjusted = MR.densify(res.route); afterRouteChange(false);
        toast(`Route refined by the backend (${T.profileMode || "safe"}) · ${fmt(T.adjusted[T.adjusted.length - 1][2])} km`);
      });
    }
  }
  function afterRouteChange(anim) { recomputeHazards(); renderRoutes(anim); renderDock(true); renderStatus(); refreshMarkers(); renderObjList(); renderProfileMetrics(); update3d(); }

  /* =====================================================
     MAP — routes and markers
     ===================================================== */
  function renderRoutes(animate) {
    const r = activeRoute();
    MR.Map.drawMain(r, T.hazards, animate);
    if (T.mode === "plan") {
      const other = T.choice === "short" ? (T.adjusted || T.baseRoute) : T.shortRoute;
      MR.Map.drawShort(other, MR.hazardZones(other || []));
    } else MR.Map.drawShort(null);
    MR.Map.drawDone(T.route, T.km, curPos());
    MR.Map.drawSecondary(T.missions.filter(m => m.path && m.status === "accepted").map(m => m.path));
    MR.Map.drawMeasure(T.measure && T.measure.a, T.measure && T.measure.b);
    const p = curPos(); MR.Map.setAstronaut(p, T.crew.color, T.crew.short);
  }
  function refreshMarkers() {
    const list = [];
    filteredObjectives().forEach(o => {
      if (o.id === T.crew.goalId) return;
      list.push({ id: o.id, type: o.type, lon: o.lon, lat: o.lat, label: o.name, onClick: () => openObjective(o) });
    });
    // Scientific targets and Martian minerals
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
    if (g) list.push({ id: "goal", type: "goal", lon: g.lon, lat: g.lat, label: "Meta · " + g.name, cls: "labeled", onClick: () => openObjective(g) });
    if (currentRegion === "gale" && T.crew.goalId !== "bradbury") {
      const b = D.targets[0]; if (S.types.base) list.push({ id: "start", type: "base", lon: b.lon, lat: b.lat, label: b.name, onClick: () => openObjective(b) });
    }
    T.missions.forEach(m => {
      if (m.status === "proposed") list.push({ id: m.id, type: "proposed", lon: m.lon, lat: m.lat, label: m.name, onClick: () => openSecondaryBriefing(m) });
      else list.push({ id: m.id, type: "secondary", lon: m.lon, lat: m.lat, label: m.name + (m.status === "completed" ? " ✓" : ""), onClick: () => openMissionCard(m) });
    });
    T.findings.forEach(f => list.push({ id: f.id, type: "finding", lon: f.lon, lat: f.lat, label: f.typeName, cls: f.fresh ? "new" : "", onClick: () => openFindingCard(f) }));
    if (T.measure) {
      if (T.measure.a) list.push({ id: "ma", type: "measure", lon: T.measure.a[0], lat: T.measure.a[1], label: "Point A" });
      if (T.measure.b) list.push({ id: "mb", type: "measure", lon: T.measure.b[0], lat: T.measure.b[1], label: "Point B" });
    }
    const zones = [];
    MR.Shared.visibleFor(T.crew.id, currentRegion).forEach(n => {
      const a = crewOf(n.author), K = MR.Shared.kinds[n.kind];
      list.push({ id: n.id, type: "notice", icon: K.icon, lon: n.lon, lat: n.lat, label: `${a.short} · ${K.label}`, color: a.color, onClick: () => openSharedCard(n) });
      zones.push({ lon: n.lon, lat: n.lat, radiusKm: n.radiusKm, color: a.color });
    });
    MR.Map.drawZones(zones);
    MR.Map.setMarkers(list);
    T.findings.forEach(f => (f.fresh = false));
    if (S.view === "3d" && MR.Scene3D && MR.Scene3D.ready) {
      MR.Scene3D.updatePins(list.filter(m => m.type !== "measure"));
    } else if (S.view === "globe" && MR.Globe3D && MR.Globe3D.ready) {
      const globeList = [...list.filter(m => m.type !== "measure")];
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
     NEXT TO THE POINT — menu (3 options) and mini card
     ===================================================== */
  let anchor = null, picking = null;
  function onMapClick(ll, sx, sy) {
    if (picking) { const f = picking; picking = null; MR.Map.setPicking(false); f(ll); return; }
    if (S.panel && window.innerWidth < 820) togglePanel(null);
    openCtx(ll);
  }
  function terrainVerdict(ll) {
    const s = MR.sample("slope", ll[0], ll[1]), t = MR.sample("traversability", ll[0], ll[1]), bl = MR.sample("blocked", ll[0], ll[1]);
    if (bl > 0.5 || s > 20) return { cls: "bad", txt: `Not traversable: slope ${fmt(s, 0)}° (block > 20°)` };
    if (s > MR.cfg.critSlope) return { cls: "bad", txt: `Not recommended: slope ${fmt(s, 0)}°` };
    if (t < MR.cfg.travThr) return { cls: "bad", txt: `Not recommended: hard passage (${fmt(t, 2)})` };
    if (s > MR.cfg.caution || t < 0.5) return { cls: "warn", txt: "Traversable with caution" };
    return { cls: "ok", txt: "Recommended for walking" };
  }
  function openCtx(ll) {
    closePointUI();
    anchor = { ll, el: $("ctxMenu") };
    const v = terrainVerdict(ll);
    const col = { ok: "var(--nominal)", warn: "var(--caution)", bad: "var(--danger)" }[v.cls];
    const ic = { ok: MR.ICONS.ok, warn: MR.ICONS.warn, bad: MR.ICONS.warn }[v.cls];
    $("ctxMenu").innerHTML = `
      <div class="readout"><b>${MR.fmtLL(ll[0], ll[1])}</b><br>
        Elevation ${fmt(MR.sample("dem", ll[0], ll[1]), 0)} m · Slope ${fmt(MR.sample("slope", ll[0], ll[1]), 1)}° · Traversability ${fmt(MR.sample("traversability", ll[0], ll[1]), 2)}
        <div class="verdict" style="color:${col}">${ic}<span>${v.txt}</span></div></div>
      <button role="menuitem" data-a="f">${MR.ICONS.goal}Log a finding here</button>
      <button role="menuitem" data-a="m">${MR.ICONS.secondary}Create mission here</button>
      <button role="menuitem" data-a="d"><svg viewBox="0 0 24 24"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg>Measure distance</button>`;
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

  /* ---------- findings ---------- */
  const FTYPES = [["mineral", "Mineral"], ["rock", "Rock"], ["other", "Other"]];
  function openFindingForm(ll) {
    let type = null, photo = null;
    mini(ll, `<h4>Finding</h4><div class="coords">${MR.fmtLL(ll[0], ll[1])} · ${fmt(MR.sample("dem", ll[0], ll[1]), 0)} m</div>
      <div class="typepick" role="group" aria-label="Type (required)">${FTYPES.map(([k, n]) => `<button type="button" data-k="${k}" aria-pressed="false">${n}</button>`).join("")}</div>
      <label class="photo"><input type="file" accept="image/*"><span class="ph">+ Photo</span></label>
      <textarea rows="2" maxlength="140" placeholder="Note (optional): color, texture, size…" aria-label="Note"></textarea>
      <div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-s disabled>Save to findings</button></div>`, el => {
      el.querySelectorAll(".typepick button").forEach(b => b.addEventListener("click", () => {
        type = b.dataset.k; el.querySelectorAll(".typepick button").forEach(x => x.setAttribute("aria-pressed", x === b));
        el.querySelector("[data-s]").disabled = false;
      }));
      el.querySelector("input[type=file]").addEventListener("change", e => {
        const f = e.target.files[0]; if (!f || !/^image\//.test(f.type) || f.size > 8e6) return toast("Choose an image smaller than 8 MB");
        const img = new Image(), url = URL.createObjectURL(f);
        img.onload = () => {
          const c = document.createElement("canvas"), k = 160 / Math.max(img.width, img.height); c.width = img.width * k; c.height = img.height * k;
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); photo = c.toDataURL("image/jpeg", 0.75); URL.revokeObjectURL(url);
          el.querySelector(".ph").innerHTML = `<img alt="Finding photo" src="${photo}"> Photo ready`;
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
    T.findings.push(f); closePointUI(); refreshMarkers(); bump("findings");
    f.noticeId = MR.Shared.publish({ kind: "finding", author: T.crew.id, lon: ll[0], lat: ll[1], text: `${tn}${note ? ": " + note : ""}`, simMin: T.simMin, region: currentRegion }).id;
    const msg = sendToEarth(`Finding · ${tn}${note ? ": " + note : ""}`, ll, "finding");
    MR.API.send("findings", { ...f, photo: photo ? "[img]" : null });
    MR.API.sendReport({
      id: "rep_" + f.id,
      author: T.crew.id,
      type: "finding",
      lon: ll[0],
      lat: ll[1],
      elev: f.elev,
      km: T.km,
      text: `Geological finding [${tn}]: ${note || "No note"}`,
      attachments: { type, solTime: MR.solTime(T.simMin).label },
      sync_status: "local"
    });
    T.events.push({ t: T.simMin, c: "var(--nominal)", txt: `Finding logged: ${tn}` });
    toast("Saved · sent to Earth", "Undo", () => {
      T.findings = T.findings.filter(x => x !== f); T.log = T.log.filter(x => x !== msg); MR.Shared.retract(f.noticeId, T.crew.id);
      bump("findings", -1); refreshMarkers(); renderPanel(); toast("Finding removed");
    });
    renderPanel();
  }
  /* =====================================================
     SHARED NOTICES — what one explorer records, the others see
     Each explorer keeps their own trip, clock and route: the notice is only reflected as a
     zone on the map and a message in the logbook. See web/js/shared.js and docs/COLLABORATION.md.
     ===================================================== */
  const crewOf = id => CREW.find(c => c.id === id) || { id, short: id, role: "", color: "#F0963C" };
  // distance from a trip's route to the notice zone (null if the route belongs to another region)
  function sharedDistKm(t, n) {
    const r = t.route || t.adjusted || t.baseRoute;
    return r && r.length && currentRegion === (n.region || "gale") ? MR.distToRoute(r, [n.lon, n.lat]) : null;
  }
  function deliverShared(res, silent) {
    res.changed.forEach(n => { if (n.status === "withdrawn") Object.values(trips).forEach(t => { t.log = t.log.filter(m => m.notice !== n.id); }); });
    res.added.forEach(n => {
      if (n.status !== "active") return;
      const a = crewOf(n.author), K = MR.Shared.kinds[n.kind];
      Object.values(trips).forEach(t => {
        if (t.crew.id === n.author || t.sharedSeen[n.id]) return;
        t.sharedSeen[n.id] = 1;
        const d = sharedDistKm(t, n), near = d != null && d < n.radiusKm + 1;
        const text = `${a.short} · ${K.label}: ${n.text}` + (d != null ? ` · your route passes ${fmt(d, 1)} km away` : "");
        t.log.push({ id: uid("l"), from: "peer", text, t: t.simMin, ll: [n.lon, n.lat], notice: n.id, author: n.author });
        t.events.push({ t: t.simMin, c: "var(--secondary)", txt: `Notice from ${a.short}: ${K.label.toLowerCase()}` });
        if (t === T) {
          bump("logbook");
          if (!silent) banner({ kind: near ? "warn" : "msg", title: `${a.short} · ${K.label}`, sub: n.text + (d != null ? ` · your route passes ${fmt(d, 1)} km away` : ""),
            onClick: () => { MR.Map.centerOn(n.lon, n.lat, 2.8); togglePanel("logbook", "earth"); }, ttl: 8000 });
        } else t.unread.logbook++;
        if (!silent) MR.Shared.ack(n.id, t.crew.id);
      });
    });
    if (S.panel === "logbook" || S.panel === "findings") renderPanel();
    refreshMarkers();
  }
  function openSharedCard(n) {
    const a = crewOf(n.author), K = MR.Shared.kinds[n.kind], d = sharedDistKm(T, n);
    mini([n.lon, n.lat], `<h4></h4><div class="coords"></div><p class="note" style="margin:8px 0 0;font-size:13px"></p>
      <div class="actions"><button class="btn ghost" data-x>Close</button></div>`, el => {
      el.querySelector("h4").textContent = `${K.label} · ${a.short}`;
      el.querySelector(".coords").textContent = `${MR.fmtLL(n.lon, n.lat)} · ${a.role} · ${a.short}'s clock: ${MR.solTime(n.simMin || 0).label}`;
      el.querySelector(".note").textContent = n.text + (d != null ? ` Your route passes ${fmt(d, 1)} km from this zone.` : "");
      el.querySelector("[data-x]").addEventListener("click", closePointUI);
    });
  }

  function openFindingCard(f) {
    mini([f.lon, f.lat], `<h4></h4><div class="coords">${MR.fmtLL(f.lon, f.lat)} · ${fmt(f.elev, 0)} m · ${MR.solTime(f.simMin).label}</div>
      ${f.photo ? `<img alt="Finding photo" src="${f.photo}" style="width:100%;border-radius:8px;margin-top:8px">` : ""}
      <p class="note" style="margin:8px 0 0;font-size:13px"></p>
      <div class="actions"><button class="btn ghost" data-x>Close</button><button class="btn primary" data-p>Propose as mission</button></div>`, el => {
      el.querySelector("h4").textContent = FTYPES.find(x => x[0] === f.type)[1];
      el.querySelector(".note").textContent = f.note || "No note.";
      el.querySelector("[data-x]").addEventListener("click", closePointUI);
      el.querySelector("[data-p]").addEventListener("click", () => { closePointUI(); openOwnBriefing({ lon: f.lon, lat: f.lat, name: "Sample: " + f.typeName.slice(0, 40), type: "Sampling" }); });
    });
  }
  function openObjective(o) {
    const r = activeRoute() || T.baseRoute, d = MR.distToRoute(r, [o.lon, o.lat]);
    const p = curPos(); const dp = p ? MR.distKm(p, [o.lon, o.lat]) : null;
    const v = terrainVerdict([o.lon, o.lat]);
    mini([o.lon, o.lat], `<h4></h4><div class="coords">${MR.fmtLL(o.lon, o.lat)} · ${fmt(MR.sample("dem", o.lon, o.lat), 0)} m</div>
      <p style="margin:8px 0 4px;font-size:13px" class="n"></p>
      <p style="margin:0;font-size:12px;color:var(--text-2)">${fmt(d)} km from the route${dp != null ? ` · ${fmt(dp)} km from you` : ""}<br>${esc(v.txt)}<br>Source: <span class="s"></span></p>
      <div class="actions"><button class="btn ghost" data-x>Close</button>${["goal", "base"].includes(o.type) ? "" : '<button class="btn primary" data-m>Create mission here</button>'}</div>`, el => {
      el.querySelector("h4").textContent = o.name; el.querySelector(".n").textContent = o.note; el.querySelector(".s").textContent = o.source;
      el.querySelector("[data-x]").addEventListener("click", closePointUI);
      const m = el.querySelector("[data-m]");
      m && m.addEventListener("click", () => { closePointUI(); openOwnBriefing({ lon: o.lon, lat: o.lat, name: o.name, type: "Science", objId: o.id }); });
    });
  }
  function openMissionCard(m) {
    mini([m.lon, m.lat], `<h4></h4><div class="coords">${MR.fmtLL(m.lon, m.lat)}</div>
      <p style="margin:8px 0;font-size:13px"><span class="badge sec">${m.origin === "own" ? "Own" : "Assigned"}</span> <span class="badge ${m.status === "completed" ? "ok" : ""}">${STATUS_LABEL[m.status] || m.status}</span></p>
      <div class="actions"><button class="btn ghost" data-x>Close</button><button class="btn" data-o>View in Missions</button></div>`, el => {
      el.querySelector("h4").textContent = m.name;
      el.querySelector("[data-x]").addEventListener("click", closePointUI);
      el.querySelector("[data-o]").addEventListener("click", () => { closePointUI(); togglePanel("missions"); });
    });
  }
  function reportHere() {
    const p = curPos();
    const ll = p ? [p[0], p[1]] : MR.Map.centerLL();
    if (!p) toast("No active traverse: the report is placed at the center of the map");
    if (S.view === "3d") setView("2d");
    MR.Map.centerOn(ll[0], ll[1]);
    setTimeout(() => openFindingForm(ll), 300);
  }

  /* ---------- measure distance ---------- */
  function startMeasure(a) {
    T.measure = { a, b: null }; refreshMarkers();
    picking = b => {
      T.measure.b = b; renderRoutes(); refreshMarkers();
      const d = MR.distKm(a, b), za = MR.sample("dem", a[0], a[1]), zb = MR.sample("dem", b[0], b[1]);
      const grade = (zb - za) / (d * 1000 || 1);
      const h = d / MR.walkSpeed(grade, (MR.sample("traversability", a[0], a[1]) + MR.sample("traversability", b[0], b[1])) / 2);
      mini(b, `<h4>Straight-line distance</h4>
        <div class="rcard" style="border:0;padding:6px 0"><div class="stats" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat"><span class="v num">${fmt(d, 2)}</span><span class="k">km</span></div>
        <div class="stat"><span class="v num">${zb - za >= 0 ? "+" : ""}${fmt(zb - za, 0)}</span><span class="k">m elevation change</span></div>
        <div class="stat"><span class="v num">${fmt(h, 1)}</span><span class="k">h walking*</span></div></div></div>
        <p style="font-size:11px;color:var(--text-2);margin:4px 0 0">*Tobler function with EVA suit. It does not consider obstacles: for that use “Create mission here”.</p>
        <div class="actions"><button class="btn primary" data-x>Done</button></div>`, el => {
        el.querySelector("[data-x]").addEventListener("click", () => { closePointUI(); T.measure = null; renderRoutes(); refreshMarkers(); });
      });
    };
    MR.Map.setPicking(true);
    banner({ kind: "info", title: "Tap the second point", sub: "To measure the distance from point A", ttl: 4000 });
  }

  /* =====================================================
     CENTRAL WINDOWS — briefing, critical alert, confirmations
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
    const minT = Math.min(MR.weather(evaStart(), st.maxElev, T.crew.profile).air, MR.weather(evaEnd(), st.maxElev, T.crew.profile).air);
    showModal(`<div class="mhead"><div class="tag-line"><span class="tg assigned">Assigned mission · Primary</span><span style="color:var(--text-2)">${T.crew.short} · ${T.crew.role}</span></div>
      <h2>${esc(T.crew.title)}</h2>
      <div class="who">${esc(goalObj().note)}</div></div>
      <div class="mbody">${factsHtml([[fmt(st.length, 0) + " km", "distance"], [(st.maxElev - r[0][3] >= 0 ? "+" : "") + fmt(st.maxElev - r[0][3], 0) + " m", "elevation gain"], [n, "stages"],
        [fmt(minT, 0) + " °C", "EVA minimum"], [st.hazards, st.hazards === 1 ? "steep section" : "steep sections"], ["≈ " + fmt(st.hours, 0) + " h", T.mobility === "rover" ? "of travel" : "of walking"]])}
      ${solInfoHtml(r)}
      <div class="who">Assigned by: Mission control · Route computed by the predictive model</div>
      <div class="actions"><button class="btn ghost spacer" data-c>View conditions</button><button class="btn" data-n>Not now</button><button class="btn primary" data-a data-focus>Accept mission</button></div></div>`, {
      bind: m => {
        m.querySelector("[data-c]").addEventListener("click", () => { closeModal(); openDashboard(openMainBriefing); });
        m.querySelector("[data-n]").addEventListener("click", () => { closeModal(); toast("The mission stays pending in Missions"); });
        m.querySelector("[data-a]").addEventListener("click", () => { closeModal(); acceptMain(); });
      },
    });
  }
  function acceptMain() {
    T.mode = "plan"; T.unread.missions = Math.max(0, T.unread.missions - 1);
    if (T.crew.main === "summit") T.shortRoute = MR.withKm(D.routes.summit_short.points);
    else { const g = goalObj(); T.shortRoute = MR.astar([T.baseRoute[0][0], T.baseRoute[0][1]], [g.lon, g.lat], { riskW: 0, slopeW: 3 }); }
    recomputeHazards(); setLeft(window.innerWidth >= 820);
    renderAll(); renderRoutes(true);
    const r = T.baseRoute; const lon = (r[0][0] + r[r.length - 1][0]) / 2, lat = (r[0][1] + r[r.length - 1][1]) / 2;
    MR.Map.fit();
    logSys(`Primary mission accepted: ${T.crew.title}.`);
    T.events.push({ t: T.simMin, c: "var(--brand-red)", txt: "Primary mission accepted" });
  }
  function acceptRoute() {
    T.route = MR.withKm(planRoute().map(p => p.slice()));
    T.mode = "walk"; T.km = 0; T.stages = makeStages(T.route); T.stageIdx = 0; T.playing = false;
    recomputeHazards(); setLeft(false);
    renderAll(); renderRoutes();
    const p = curPos(); MR.Map.centerOn(p[0], p[1], 1.5);
    banner({ kind: "ok", title: "Route accepted · simulation paused", sub: "Press ▶ (Space) to start walking.", ttl: 6000 });
    logSys(`Route accepted (${T.choice === "short" ? "short route" : T.adjusted ? "adjusted route" : "model route"}): ${fmt(T.route[T.route.length - 1][2])} km.`);
    T.events.push({ t: T.simMin, c: "var(--accent)", txt: "Traverse start" });
    MR.API.send("missions", { crew: T.crew.id, kind: "primary", name: T.crew.title, status: "in_progress", km: T.route[T.route.length - 1][2] });
  }

  // Own mission (editable)
  const MTYPES = ["Science", "Sampling", "Reconnaissance", "Other"];
  function openOwnBriefing(pre = {}) {
    const st = { name: pre.name || "", type: pre.type || "Science", lon: pre.lon, lat: pre.lat, note: pre.note || "", objId: pre.objId };
    if (st.lon == null) { const p = curPos(); const ll = p ? [p[0], p[1]] : MR.fromWorld(600, 600); st.lon = ll[0]; st.lat = ll[1]; }
    const render = () => showModal(`<div class="mhead"><div class="tag-line"><span class="tg own">Own mission · Secondary</span></div>
      <h2>New mission</h2></div>
      <div class="mbody">
        <label class="field">Name<input id="omName" maxlength="60" placeholder="E.g.: Light rock sample" data-focus></label>
        <label class="field">Type<select id="omType">${MTYPES.map(t => `<option ${t === st.type ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <div class="field">Point<div class="pick"><span>${MR.fmtLL(st.lon, st.lat)}</span><button type="button" id="omPick">change on the map</button></div>
          <span style="font-weight:400;font-size:12px" id="omVerdict"></span></div>
        <label class="field">Note (optional)<textarea id="omNote" rows="2" maxlength="140"></textarea></label>
        <div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-p>Propose mission</button></div></div>`, {
      bind: m => {
        m.querySelector("#omName").value = st.name; m.querySelector("#omNote").value = st.note;
        const v = terrainVerdict([st.lon, st.lat]); const vv = m.querySelector("#omVerdict");
        vv.textContent = v.txt; vv.style.color = { ok: "var(--nominal)", warn: "var(--caution)", bad: "var(--danger)" }[v.cls];
        const keep = () => { st.name = m.querySelector("#omName").value; st.type = m.querySelector("#omType").value; st.note = m.querySelector("#omNote").value; };
        m.querySelector("#omPick").addEventListener("click", () => {
          keep(); closeModal(); if (S.view === "3d") setView("2d");
          MR.Map.setPicking(true);
          banner({ kind: "info", title: "Tap the map to choose the mission point", ttl: 5000 });
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
    const m = { id: uid("m"), name: st.name, type: st.type, origin: "own", lon: st.lon, lat: st.lat, note: st.note, status: "proposed", by: T.crew.short };
    T.missions.push(m);
    activateMission(m);
    sendToEarth(`New own mission: ${m.name} (${m.type})`, [m.lon, m.lat], "mission");
  }
  // Assigned secondary (proposed by the system or Earth)
  function openSecondaryBriefing(m) {
    const p = curPos(); const d = p ? MR.distKm(p, [m.lon, m.lat]) : MR.distToRoute(activeRoute() || T.baseRoute, [m.lon, m.lat]);
    showModal(`<div class="mhead"><div class="tag-line"><span class="tg own">Assigned mission · Secondary</span><span style="color:var(--text-2)">${esc(m.by)}</span></div>
      <h2></h2><div class="who n"></div></div>
      <div class="mbody">${factsHtml([[fmt(d, 1) + " km", p ? "from your position" : "from the route"], [fmt(MR.sample("slope", m.lon, m.lat), 0) + "°", "slope at the point"], [fmt(MR.sample("traversability", m.lon, m.lat), 2), "traversability"]])}
      <div class="who">If you accept, the map computes a detour and returns to the main route.</div>
      <div class="actions"><button class="btn ghost spacer" data-r>Reject</button><button class="btn" data-n>Not now</button><button class="btn primary" data-a>Accept mission</button></div></div>`, {
      bind: el => {
        el.querySelector("h2").textContent = m.name; el.querySelector(".n").textContent = m.note || "";
        el.querySelector("[data-n]").addEventListener("click", closeModal);
        el.querySelector("[data-r]").addEventListener("click", () => { closeModal(); T.missions = T.missions.filter(x => x !== m); bump("missions", -1); refreshMarkers(); renderPanel(); logSys(`Secondary mission rejected: ${m.name}.`); });
        el.querySelector("[data-a]").addEventListener("click", () => { closeModal(); bump("missions", -1); activateMission(m); });
      },
    });
  }
  function activateMission(m) {
    if (T.mode === "walk") {
      const p = curPos(); const i = MR.nearestKm(T.route, T.km);
      const re = MR.nearestIdx(T.route, [m.lon, m.lat], Math.min(T.route.length - 1, i + 1));
      const rejoin = Math.min(T.route.length - 1, Math.max(re.i, i + 1));
      const a = MR.astar([p[0], p[1]], [m.lon, m.lat]), b = a && MR.astar([m.lon, m.lat], [T.route[rejoin][0], T.route[rejoin][1]]);
      if (!a || !b) { m.status = "proposed"; toast("No safe detour to that point was found"); return; }
      const det = MR.withKm(a.concat(b.slice(1)));
      const extra = Math.max(0, det[det.length - 1][2] - (T.route[rejoin][2] - T.km));
      T.route = MR.withKm(T.route.slice(0, i).concat([p], det.slice(1), T.route.slice(rejoin + 1)));
      const L = T.route[T.route.length - 1][2];
      T.stages = makeStages(T.route).map(k => Math.max(k, T.km)); T.stageIdx = T.stages.findIndex(k => k > T.km + 0.01); if (T.stageIdx < 0) T.stageIdx = T.stages.length - 1;
      m.path = MR.withKm(det); m.status = "accepted";
      recomputeHazards();
      banner({ kind: "sec", title: `Detour computed: ${m.name}`, sub: `+${fmt(extra, 1)} km detour · total route ${fmt(L)} km`, ttl: 6000 });
    } else {
      // in Plan or Base map: it becomes a route stop
      m.status = "accepted";
      if (!T.stops.includes(m.id)) T.stops.push(m.id);
      if (T.mode !== "base") recalcRoute();
      banner({ kind: "sec", title: `Mission added as a stop: ${m.name}`, sub: "The route was recalculated to pass through the point.", ttl: 5000 });
    }
    logSys(`Secondary mission accepted: ${m.name}.`);
    T.events.push({ t: T.simMin, c: "var(--secondary)", txt: `Secondary accepted: ${m.name}` });
    MR.API.send("missions", { crew: T.crew.id, kind: "secondary", name: m.name, origin: m.origin, lon: m.lon, lat: m.lat, status: m.status });
    renderStops(); renderRoutes(); refreshMarkers(); renderPanel(); renderDock(true); renderStatus(); update3d();
  }

  /* ---------- critical alert ---------- */
  /* =====================================================
     RADIATION — accumulated EVA dose, notices and critical alert
     Modelo simplificado (ver MR.radiation en core.js): solo cuenta las horas al aire libre.
     ===================================================== */
  function accrueDose(dMin) {
    const p = curPos(); if (!p) return;
    const d = MR.radiation.rate(p, T.mobility, T.rad.spe, T.simMin) * dMin / 60;
    T.rad.total += d; const sol = time().sol; T.rad.bySol[sol] = (T.rad.bySol[sol] || 0) + d;
  }
  const radToday = () => T.rad.bySol[time().sol] || 0;
  function openRadiationPanel() { dashTab = "rad"; openDashboard(); }
  // Returns true if it opened the critical alert (the simulation stays paused).
  function checkRadiation() {
    const R = T.rad, sol = time().sol, day = radToday(), thr = MR.cfg.radThr, P = MR.radiation.P;
    const on = MR.radiation.speActive(R.spe, T.simMin);
    if (on && !R.flags["spe" + sol]) {
      const first = !R.flags.speSeen; R.flags["spe" + sol] = 1; R.flags.speSeen = 1;
      T.events.push({ t: T.simMin, c: "var(--caution)", txt: first ? "Solar event detected" : "Solar event still active" });
      logSys(`${first ? "Solar event detected" : "The solar event is still active"}: the outdoor dose is multiplied by ${P.speMult} (simplified model, assumption).`);
      banner({ kind: "warn", title: first ? "Solar event detected" : "Solar event still active", sub: `Dose ×${P.speMult} outdoors · workday threshold ${fmt(thr, 1)} mSv`, onClick: openRadiationPanel, ttl: 9000 });
    }
    if (!on && R.spe && R.flags.speSeen && !R.flags.speEnd) {
      R.flags.speEnd = 1; T.events.push({ t: T.simMin, c: "var(--nominal)", txt: "Solar event ended" });
      banner({ kind: "ok", title: "Solar event ended", sub: "The dose rate returns to its base level.", ttl: 6000 });
    }
    if (day >= thr * 0.5 && day < thr && !R.flags["warn" + sol]) {
      R.flags["warn" + sol] = 1;
      logSys(`Radiation notice: today's EVA dose ${fmt(day, 2)} mSv (50 % of the ${fmt(thr, 1)} mSv threshold).`);
      banner({ kind: "warn", title: "Radiation dose at 50 % of the threshold", sub: `${fmt(day, 2)} of ${fmt(thr, 1)} mSv today · tap for details`, onClick: openRadiationPanel, ttl: 8000 });
    }
    const lvl = Math.floor(day / thr);
    if (!T.returning && lvl >= 1 && lvl > (R.crit[sol] || 0)) {
      R.crit[sol] = lvl; const rp = curPos();
      MR.Shared.publish({ kind: "radiation_alert", author: T.crew.id, lon: rp[0], lat: rp[1], simMin: T.simMin, region: currentRegion,
        text: `EVA dose of ${fmt(day, 1)} mSv today (threshold ${fmt(thr, 1)} mSv)${on ? " with an active solar event" : ""}` });
      radiationAlert(day); return true;
    }
    return false;
  }
  function nearestShelter(p) {
    let best = null;
    MR.SHELTERS.filter(s => s.region === currentRegion).forEach(s => { const d = MR.distKm(p, [s.lon, s.lat]); if (!best || d < best.d) best = { s, d }; });
    return best;
  }
  function radiationAlert(day) {
    T.playing = false; renderStatus(); T.alerts++;
    if (S.panel) togglePanel(null);
    $("stageCard").hidden = true;
    const p = curPos(), thr = MR.cfg.radThr, on = MR.radiation.speActive(T.rad.spe, T.simMin);
    const rate = MR.radiation.rate(p, T.mobility, T.rad.spe, T.simMin);
    const near = nearestShelter(p);
    const back = near ? MR.astar([p[0], p[1]], [near.s.lon, near.s.lat], {}) : null;
    const backH = back ? MR.estimateHours(back, T.mobility) : null;
    const backDose = back ? MR.radiation.routeDose(back, T.mobility) * (on ? MR.radiation.P.speMult : 1) : null;
    T.events.push({ t: T.simMin, c: "var(--danger)", txt: `Radiation alert: ${fmt(day, 1)} mSv today` });
    logSys(`RADIATION ALERT: today's EVA dose ${fmt(day, 2)} mSv, threshold ${fmt(thr, 1)} mSv${on ? " (solar event active)" : ""}.`);
    MR.API.sendReport({ id: uid("rep_rad_"), author: T.crew.id, type: "radiation_alert", lon: p[0], lat: p[1], elev: p[3] || 0, km: T.km,
      text: `Radiation alert: ${fmt(day, 2)} mSv in the workday (threshold ${fmt(thr, 1)} mSv)`, attachments: { dose_msv: day, thr_msv: thr, spe: on, simMin: T.simMin }, sync_status: "local" });
    showModal(`<div class="mhead"><div class="tag-line"><span class="tg alert">Critical radiation alert · simulation paused</span></div>
      <h2>${MR.ICONS.warn}Workday dose over the threshold</h2></div>
      <div class="mbody">${factsHtml([[fmt(day, 1) + " mSv", "today's EVA dose"], [fmt(thr, 1) + " mSv", "workday threshold"], [fmt(rate * 1000, 0) + " µSv/h", "rate now"],
        [near ? fmt(near.d, 1) + " km" : "—", near ? esc(near.s.name) : "shelter"]])}
      <div class="alt">${on ? "<b>Solar event in progress.</b> Protons above 30 MeV can penetrate the suit; agencies recommend delaying or aborting the EVA and taking shelter." : "<b>No active solar event.</b> You exceeded the threshold you configured through accumulated hours outdoors."}
        ${back ? `<br>Return to the shelter: ≈ ${fmt(backH, 1)} h and ≈ ${fmt(backDose, 2)} mSv more.` : "<br>No path to the shelter was found from here."}</div>
      <div class="who" style="margin-top:8px"><span class="tag-sup">ASSUMPTION</span> Simplified model: not a measurement. Threshold configurable in Conditions → Radiation.</div>
      <div class="actions"><button class="btn danger spacer" data-ab>Abort</button><button class="btn" data-p>Pause</button><button class="btn primary" data-b ${back ? "" : "disabled"}>Return to shelter</button></div></div>`, {
      cls: "critical", dismiss: false,
      bind: m => {
        m.querySelector("[data-p]").addEventListener("click", () => { closeModal(); logSys("Radiation: the crew pauses the EVA."); banner({ kind: "warn", title: "Simulation paused", sub: "Still outdoors: the dose will accumulate if you resume. Press ▶ to continue.", ttl: 6000 }); });
        m.querySelector("[data-ab]").addEventListener("click", () => confirmAbort(() => radiationAlert(day)));
        m.querySelector("[data-b]").addEventListener("click", () => { closeModal(); returnToShelter(near.s, back); });
      },
    });
  }
  function returnToShelter(sh, back) {
    const p = curPos(), i = MR.nearestKm(T.route, T.km);
    T.route = MR.withKm(T.route.slice(0, i).concat([p], back.slice(1)));
    T.km = T.route[i][2]; T.returning = { id: sh.id, name: sh.name };
    T.stages = makeStages(T.route).map(k => Math.max(k, T.km));
    T.stageIdx = Math.max(0, T.stages.findIndex(k => k > T.km + 0.01));
    recomputeHazards();
    T.hazards.forEach(h => { if (h.startKm < T.km + 0.05) T.handled[h.id] = 1; });
    T.lows.forEach(h => { if (h.startKm < T.km + 0.05) T.handled[h.id] = 1; });
    renderRoutes(); renderDock(true);
    logSys(`Return to shelter «${sh.name}» due to radiation (${fmt(T.route[T.route.length - 1][2] - T.km, 1)} km).`);
    T.events.push({ t: T.simMin, c: "var(--accent)", txt: `Return to shelter: ${sh.name}` });
    sendToEarth(`We are returning to shelter ${sh.name} due to radiation (EVA dose ${fmt(T.rad.total, 2)} mSv).`, [p[0], p[1]], "status");
    MR.API.send("missions", { crew: T.crew.id, kind: "primary", name: T.crew.title, status: "returning to shelter", km: T.km });
    banner({ kind: "ok", title: "Return to shelter underway", sub: `Destination: ${sh.name}. Press ▶ to continue.`, ttl: 5000 });
    T.playing = true; renderStatus();
  }

  function criticalAlert(z) {
    T.playing = false; renderStatus(); T.alerts++;
    if (S.panel) togglePanel(null);
    $("stageCard").hidden = true;
    if (!T.flags["sh_" + z.id]) {
      T.flags["sh_" + z.id] = 1; const zp = posAt(T.route, z.startKm);
      MR.Shared.publish({ kind: "slope_alert", author: T.crew.id, lon: zp[0], lat: zp[1], simMin: T.simMin, region: currentRegion,
        text: `slope of ${fmt(z.max, 0)}° over a ${fmt((z.endKm - z.startKm) * 1000 + 50, 0)} m section (km ${fmt(z.startKm)})` });
    }
    const p = curPos(); const dist = Math.max(0, (z.startKm - T.km) * 1000);
    const targetKm = Math.min(T.route[T.route.length - 1][2], z.endKm + 0.9);
    const tp = posAt(T.route, targetKm);
    const alt = MR.astar([p[0], p[1]], [tp[0], tp[1]], { maxSlope: Math.max(10, MR.cfg.critSlope - 2), slopeW: 7 });
    const altMax = alt ? Math.max(...alt.map(q => q[4])) : null;
    const altLen = alt ? alt[alt.length - 1][2] : null, direct = targetKm - T.km;
    const extraM = alt ? Math.max(0, (altLen - direct) * 1000) : 0;
    const okAlt = alt && altMax <= MR.cfg.critSlope && extraM < 2500;
    T.events.push({ t: T.simMin, c: "var(--danger)", txt: `Alert: slope ${fmt(z.max, 0)}°` });
    showModal(`<div class="mhead"><div class="tag-line"><span class="tg alert">Critical alert · simulation paused</span></div>
      <h2>${MR.ICONS.warn}Steep slope in ${fmt(dist, 0)} m</h2></div>
      <div class="mbody">${factsHtml([[fmt(z.max, 0) + "°", "maximum slope"], [fmt(z.rough, 0) + " m", "roughness"], [fmt((z.endKm - z.startKm) * 1000 + 50, 0) + " m", "section length"]])}
      <div class="alt">${okAlt ? `<b>Alternative:</b> detour of ${fmt(extraM, 0)} m extra with maximum slope ${fmt(altMax, 0)}°.`
        : alt && altMax <= MR.cfg.critSlope ? `<b>No short detour:</b> the nearest safe alternative adds ${fmt(extraM / 1000, 1)} km. Advance slowly or abort.` : "<b>No safe detour</b> nearby: advance slowly or abort."}</div>
      <div class="who" style="margin-top:8px">Alert threshold: ${MR.cfg.critSlope}° (configurable in Route → Thresholds).</div>
      <div class="actions"><button class="btn danger spacer" data-ab>Abort</button><button class="btn" data-s>Proceed with caution</button><button class="btn primary" data-d ${okAlt ? "" : "disabled"}>Detour</button></div></div>`, {
      cls: "critical", dismiss: false,
      bind: m => {
        m.querySelector("[data-s]").addEventListener("click", () => { T.handled[z.id] = "seguir"; closeModal(); logSys(`Alert at km ${fmt(z.startKm)}: proceeding with caution.`); T.playing = true; renderStatus(); });
        m.querySelector("[data-d]").addEventListener("click", () => {
          T.handled[z.id] = "desvio"; closeModal(); T.detours++;
          const i = MR.nearestKm(T.route, T.km), j = MR.nearestKm(T.route, targetKm);
          T.route = MR.withKm(T.route.slice(0, i).concat([p], alt.slice(1), T.route.slice(j + 1)));
          T.stages = makeStages(T.route).map(k => Math.max(k, T.km));
          T.stageIdx = Math.max(0, T.stages.findIndex(k => k > T.km + 0.01));
          recomputeHazards(); T.hazards.forEach(h => { if (h.startKm < T.km + 0.05) T.handled[h.id] = 1; });
          renderRoutes(); renderDock(true); logSys(`Detour applied at km ${fmt(T.km)} to avoid ${fmt(z.max, 0)}°.`);
          banner({ kind: "ok", title: "Detour applied", sub: "New route drawn. Press ▶ to continue.", ttl: 4000 });
        });
        m.querySelector("[data-ab]").addEventListener("click", () => confirmAbort(() => criticalAlert(z)));
      },
    });
  }
  function confirmAbort(back) {
    showModal(`<div class="mhead"><h2>Abort the mission?</h2></div><div class="mbody">
      <p class="who">You will return to base. The logbook and the logged findings are kept.</p>
      <div class="actions"><button class="btn" data-c data-focus>Cancel</button><button class="btn danger" data-y>Yes, abort</button></div></div>`, {
      dismiss: false,
      bind: m => {
        m.querySelector("[data-c]").addEventListener("click", () => { closeModal(); back && back(); });
        m.querySelector("[data-y]").addEventListener("click", () => {
          closeModal(); logSys(`Mission aborted at km ${fmt(T.km)}. Returning to base.`);
          T.events.push({ t: T.simMin, c: "var(--danger)", txt: "Mission aborted" });
          Object.assign(T, { mode: "base", route: null, km: 0, playing: false, adjusted: null, choice: "model", briefed: false, handled: {}, flags: {}, returning: null });
          T.unread.missions = 1; renderAll(true); MR.Map.fit();
          banner({ kind: "warn", title: "Mission aborted", sub: "Back on the base map. Open Missions to resume.", ttl: 6000 });
        });
      },
    });
  }

  /* =====================================================
     NOTICES: banner (top), stage card (bottom), toast
     ===================================================== */
  function banner({ kind = "warn", title, sub, onClick, ttl = 6000, icon }) {
    const box = $("banners");
    while (box.children.length >= 3) box.firstChild.remove();
    const b = document.createElement("button"); b.className = "banner " + kind; b.type = "button";
    b.innerHTML = `${MR.ICONS[icon || { warn: "warn", info: "info", msg: "msg", ok: "ok", sec: "secondary" }[kind]]}<span class="txt"><span class="t"></span><small></small></span><span class="x" aria-label="Close">✕</span>`;
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
      const nxt = MR.solTime((Math.floor(T.simMin / 1440) + 1) * 1440 + evaStart() * 60);
      const night = MR.weather(4, curPos()[3], T.crew.profile).air;
      card.innerHTML = `<h3>${MR.ICONS.info} End of the EVA workday (${hm(evaEnd())})</h3>
        <p>${fmt(T.km)} km traveled · ${fmt(L - T.km)} km remaining. Walking at night is not allowed.</p>
        <div class="next"><div class="stat"><span class="v num">${fmt(night, 0)} °C</span><span class="k">minimum tonight</span></div>
        <div class="stat"><span class="v num">${nxt.label}</span><span class="k">resumption</span></div></div>
        <div class="actions"><button class="btn primary" data-r>Rest until ${hm(evaStart())}</button></div>`;
      card.querySelector("[data-r]").addEventListener("click", () => { restUntilMorning(); });
    } else {
      const done = T.stageIdx; const a = T.stages[done - 1] || 0, b = T.stages[done] || L;
      const seg = T.route.filter(p => p[2] >= a && p[2] <= b);
      const gain = seg.length ? seg[seg.length - 1][3] - seg[0][3] : 0;
      const hz = T.hazards.filter(z => z.startKm >= a && z.startKm <= b).length;
      const h = seg.length > 1 ? MR.estimateHours(MR.withKm(seg)) : 0;
      const minT = MR.weather(Math.min(evaEnd(), time().hour + h), seg.length ? Math.max(...seg.map(p => p[3])) : 0, T.crew.profile).air;
      card.innerHTML = `<h3>${MR.ICONS.ok} Stage ${done} of ${n} completed</h3>
        <p>${fmt(T.km)} km · ${fmt(L - T.km)} km remaining</p>
        <div class="next"><div class="stat"><span class="v num">${gain >= 0 ? "+" : ""}${fmt(gain, 0)} m</span><span class="k">elevation change next section</span></div>
          <div class="stat"><span class="v num">${fmt(h, 1)} h</span><span class="k">estimated time</span></div>
          <div class="stat"><span class="v num">${fmt(minT, 0)} °C</span><span class="k">at the end of the section</span></div>
          <div class="stat"><span class="v num">${hz}</span><span class="k">steep sections</span></div></div>
        <div class="actions"><button class="btn" data-r>Rest 1 h</button><button class="btn primary" data-c>Continue</button></div>`;
      card.querySelector("[data-r]").addEventListener("click", () => { accrueDose(60); T.simMin += 60; card.hidden = true; logSys("1 h rest."); renderStatus(); updateWeather(true); });
      card.querySelector("[data-c]").addEventListener("click", () => { card.hidden = true; T.playing = true; renderStatus(); });
    }
    card.hidden = false;
    card.querySelector(".btn.primary").focus({ preventScroll: true });
  }
  function restUntilMorning() {
    $("stageCard").hidden = true;
    T.simMin = (Math.floor(T.simMin / 1440) + 1) * 1440 + evaStart() * 60;
    T.flags["eva1h_" + time().sol] = false;
    logSys(`Night rest. Resumption ${time().label}.`);
    T.events.push({ t: T.simMin, c: "var(--text-2)", txt: `Start of ${time().label.split(" · ")[0]}` });
    renderStatus(); updateWeather(true);
    banner({ kind: "info", title: `Good morning · ${time().label}`, sub: "Press ▶ to continue.", ttl: 4000 });
  }

  /* =====================================================
     REAL-TIME SIMULATION
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
      if (now - lastProfile > 700) { lastProfile = now; renderProfile(); if (S.panel === "missions") renderPanel(); }
    }
    requestAnimationFrame(loop);
  }
  function advance(dMin) {
    const R = T.route, L = R[R.length - 1][2];
    const i = MR.nearestKm(R, T.km);
    const v = MR.speedAt(R, i, T.mobility, T.hazards);
    T.km = Math.min(L, T.km + (v * dMin) / 60); T.simMin += dMin;
    accrueDose(dMin);
    // conditions data every 10 Martian minutes
    if (T.simMin - T.lastWx >= 10) updateWeather();
    if (T.simMin - T.lastTele >= 30) { T.lastTele = T.simMin; const p = curPos(); MR.API.send("telemetry", { crew: T.crew.id, t: T.simMin, km: T.km, lon: p[0], lat: p[1], elev: p[3], wx: T.wx, dose_msv: T.rad.total }); }
    checkEvents(L);
  }
  function checkEvents(L) {
    const h = time().hour;
    // arrival
    if (T.km >= L - 0.005) return arrive();
    // reproducible critical weather event at 11:30 LTST
    if (!T.handled["mda_storm_1130"] && time().hour === 11 && time().minute >= 30) {
      T.handled["mda_storm_1130"] = 1;
      triggerWeatherAlert();
      return;
    }
    // radiation: notice for a solar event / dose and critical alert by threshold
    if (checkRadiation()) return;
    // critical hazard ahead (200 m)
    const z = T.hazards.find(z => !T.handled[z.id] && z.startKm - T.km <= 0.2 && z.endKm >= T.km);
    if (z) return criticalAlert(z);
    // difficult terrain (notice, no pause)
    const lz = T.lows.find(z => !T.handled[z.id] && z.startKm - T.km <= 0.4 && z.endKm >= T.km);
    if (lz) { T.handled[lz.id] = 1; banner({ kind: "warn", title: `Difficult terrain in ${fmt(Math.max(0, (lz.startKm - T.km) * 1000), 0)} m`, sub: `Traversability ${fmt(lz.min, 2)} · pace is reduced`, onClick: () => { const p = posAt(T.route, lz.startKm); MR.Map.centerOn(p[0], p[1], 3); } }); }
    // end of stage
    if (T.stageIdx < T.stages.length - 1 && T.km >= T.stages[T.stageIdx]) {
      T.stageIdx++; T.events.push({ t: T.simMin, c: "var(--nominal)", txt: `Stage ${T.stageIdx} completed` });
      logSys(`Stage ${T.stageIdx} of ${T.stages.length} completed at km ${fmt(T.km)}.`);
      return stageCard("stage");
    }
    // EVA window
    if (h >= evaEnd() - 1 && !T.flags["eva1h_" + time().sol]) { T.flags["eva1h_" + time().sol] = true; banner({ kind: "warn", title: "1 h left in the EVA workday", sub: `The traverse stops at ${hm(evaEnd())}`, ttl: 6000 }); }
    if (h >= evaEnd() || h < evaStart()) return stageCard("night");
    // secondary missions: completed / proposed by the system
    const p = curPos();
    T.missions.forEach(m => {
      if (m.status === "accepted" && MR.distKm(p, [m.lon, m.lat]) < 0.3) {
        m.status = "completed"; refreshMarkers(); renderRoutes(); renderPanel();
        banner({ kind: "ok", title: `Secondary mission completed: ${m.name}`, ttl: 5000 });
        logSys(`Secondary mission completed: ${m.name}.`); T.events.push({ t: T.simMin, c: "var(--secondary)", txt: `Secondary completed: ${m.name}` });
        sendToEarth(`Secondary mission completed: ${m.name}`, [m.lon, m.lat], "mission");
      }
    });
    const cand = D.targets.find(o => ["science", "mineral", "spectral"].includes(o.type) && o.id !== T.crew.goalId && !T.proposed[o.id] && MR.distKm(p, [o.lon, o.lat]) < 3.5);
    if (cand && !T.missions.some(m => m.status === "proposed")) proposeSecondary(cand, "System (target model)");
    // Earth script according to progress
    earthScript(T.km / L);
  }
  function proposeSecondary(o, by) {
    T.proposed[o.id] = 1;
    const m = { id: uid("m"), name: o.name, type: "Science", origin: "assigned", by, lon: o.lon, lat: o.lat, note: o.note, status: "proposed", objId: o.id };
    T.missions.push(m); bump("missions"); refreshMarkers();
    banner({ kind: "sec", title: `Secondary mission proposed: ${o.name}`, sub: "Tap to see the briefing · does not interrupt the walk", onClick: () => openSecondaryBriefing(m) });
  }
  function earthScript(f) {
    const fire = (k, fn) => { if (!T.flags[k]) { T.flags[k] = true; fn(); } };
    if (f > 0.06) fire("e1", () => earthMessage("Mission control: good start. Nominal telemetry; remember to hydrate at every stop."));
    if (f > 0.3) fire("e2", () => {
      const p = curPos();
      const o = D.targets.filter(o => ["science", "mineral", "spectral"].includes(o.type) && o.id !== T.crew.goalId && !T.proposed[o.id])
        .sort((a, b) => MR.distKm(p, [a.lon, a.lat]) - MR.distKm(p, [b.lon, b.lat]))[0];
      if (o) { earthMessage(`Mission control: we propose the secondary «${o.name}». Evaluate the detour.`, [o.lon, o.lat]); proposeSecondary(o, "Mission control (Earth)"); }
    });
    if (f > 0.55) fire("e3", () => earthMessage("Mission control: the forecast shows more suspended dust tomorrow; UV radiation will drop."));
    if (f > 0.85) fire("e4", () => earthMessage("Mission control: last stretch. Confirm coordinates on reaching the goal."));
  }
  function updateWeather(force) {
    const p = curPos() || T.baseRoute[0];
    const prev = T.wx; T.lastWx = Math.floor(T.simMin / 10) * 10;
    T.wx = MR.weather(time().hour, p[3], T.crew.profile, Math.floor(T.simMin / 10));
    // 1 h forecast
    const fut = MR.weather(time().hour + 1, p[3], T.crew.profile);
    if (fut.air < -55 && T.wx.air >= -55 && !T.flags["cold_" + time().sol]) {
      T.flags["cold_" + time().sol] = true;
      banner({ kind: "warn", title: "Temperature drops in 1 h", sub: `${fmt(fut.air, 0)} °C expected. Check the suit heating.` });
    }
    if (T.wx.uv > 12 && !T.flags["uv_" + time().sol]) { T.flags["uv_" + time().sol] = true; banner({ kind: "warn", title: "High UV radiation", sub: `${fmt(T.wx.uv, 1)} W/m² · limit visor exposure` }); }
    if (prev || force) renderLive(true);
  }
  function arrive() {
    if (T.returning) return arriveShelter();
    T.playing = false; T.mode = "done"; T.km = T.route[T.route.length - 1][2];
    T.events.push({ t: T.simMin, c: "var(--nominal)", txt: "Goal reached" });
    logSys(`Goal reached: ${goalObj().name}.`);
    sendToEarth(`We have reached the goal: ${goalObj().name}. Coordinates confirmed.`, [goalObj().lon, goalObj().lat], "status");
    MR.API.send("missions", { crew: T.crew.id, kind: "primary", name: T.crew.title, status: "completed" });
    renderAll();
    setTimeout(openSummary, MR.reduceMotion() ? 0 : 700);
  }

  function arriveShelter() {
    T.playing = false; T.mode = "done"; T.km = T.route[T.route.length - 1][2];
    const sh = MR.SHELTERS.find(x => x.id === T.returning.id) || { lon: 0, lat: 0 };
    T.events.push({ t: T.simMin, c: "var(--nominal)", txt: `Shelter reached: ${T.returning.name}` });
    logSys(`Shelter reached: ${T.returning.name}. Total EVA dose ${fmt(T.rad.total, 2)} mSv.`);
    sendToEarth(`We have reached shelter ${T.returning.name}. Accumulated EVA dose ${fmt(T.rad.total, 2)} mSv.`, [sh.lon, sh.lat], "status");
    MR.API.send("missions", { crew: T.crew.id, kind: "primary", name: T.crew.title, status: "aborted", km: T.km });
    renderAll();
    setTimeout(openSummary, MR.reduceMotion() ? 0 : 700);
  }

  /* =====================================================
     COMMUNICATION: logbook (Earth, with delay) and assistant
     ===================================================== */
  function sendToEarth(text, ll, kind = "text") {
    const m = { id: uid("l"), from: "me", text, t: T.simMin, arrive: T.simMin + ONE_WAY_MIN, ll, kind };
    T.log.push(m);
    MR.API.send("logbook", { crew: T.crew.id, from: "explorer", text, t: T.simMin, lon: ll && ll[0], lat: ll && ll[1], kind });
    // Earth's reply: arrives after round trip + 6 min of analysis
    const reply = kind === "finding" ? `Received: «${text.replace("Finding · ", "")}». Excellent; keep the sample and log the context.`
      : kind === "mission" ? `Received: ${text}. Agreed, medium priority.` : kind === "status" ? "Congratulations to the whole crew! Received on Earth." :
      kind === "pos" ? "Position received and logged on the control map." : `Received: «${text.slice(0, 60)}». Continue according to plan.`;
    T.events.push({ t: T.simMin + 2 * ONE_WAY_MIN + 6, pending: true, reply, ll });
    renderPanel();
    return m;
  }
  function earthMessage(text, ll) {
    T.log.push({ id: uid("l"), from: "earth", text, t: T.simMin, ll });
    bump("logbook"); renderPanel();
    banner({ kind: "msg", title: "Message from Earth", sub: text.replace("Mission control: ", ""), onClick: () => togglePanel("logbook", "earth"), ttl: 6000 });
  }
  function deliverEarthReplies() {
    T.events.forEach(e => { if (e.pending && T.simMin >= e.t) { e.pending = false; e.done = true; earthMessage("Mission control: " + e.reply, e.ll); } });
    T.events = T.events.filter(e => !e.done);
  }
  setInterval(deliverEarthReplies, 500);
  function logSys(text) { T.log.push({ id: uid("l"), from: "sys", text, t: T.simMin }); if (S.panel === "logbook") renderPanel(); }

  // Route assistant (immediate answers, no delay)
  function askAssistant(q) {
    q = MR.clean(q, 200); if (!q) return;
    T.ai.push({ from: "me", text: q, t: T.simMin });
    const s = q.toLowerCase(), p = curPos(), R = activeRoute() || T.baseRoute, L = R[R.length - 1][2];
    let a;
    if (/left|remaining|distance|how far|how much|arrive|\beta\b/.test(s)) {
      const rest = R.filter(x => x[2] >= T.km); const h = rest.length > 1 ? MR.estimateHours(MR.withKm(rest)) : 0;
      a = `${fmt(L - T.km)} km remaining (≈ ${fmt(h, 1)} h of walking). Current pace ${fmt(MR.walkSpeed(MR.gradeAt(R, MR.nearestKm(R, T.km)), (p || R[0])[6]), 1)} km/h.`;
    } else if (/hazard|danger|risk|slope|alert/.test(s)) {
      const z = T.hazards.find(z => z.endKm >= T.km);
      a = z ? `Next steep section in ${fmt(Math.max(0, z.startKm - T.km))} km: up to ${fmt(z.max, 0)}°. I will warn you 200 m before.` : "There are no sections above the critical threshold in the rest of the route.";
    } else if (/weather|temperature|condition|\buv\b|pressure/.test(s)) {
      const w = T.wx || MR.weather(time().hour, (p || R[0])[3], T.crew.profile), f = MR.weather(time().hour + 1, (p || R[0])[3], T.crew.profile);
      a = `Now: ${fmt(w.air, 0)} °C air, UV ${fmt(w.uv, 1)} W/m², ${fmt(w.p, 0)} Pa. In 1 h: ${fmt(f.air, 0)} °C. Source: REMS (Curiosity) corrected for elevation.`;
    } else if (/position|coordinates|where|location/.test(s)) {
      const q2 = p || R[0];
      a = `You are at ${MR.fmtLL(q2[0], q2[1])}, at ${fmt(q2[3], 0)} m elevation, km ${fmt(T.km)} of ${fmt(L)}.`;
    } else if (/target|nearby|interest|sample/.test(s)) {
      const q2 = p || R[0]; const o = D.targets.filter(o => !["base"].includes(o.type)).map(o => [o, MR.distKm(q2, [o.lon, o.lat])]).sort((a, b) => a[1] - b[1])[0];
      a = `The nearest target is «${o[0].name}» at ${fmt(o[1])} km. ${o[0].note}`;
    } else if (/route|optimal|why/.test(s)) {
      const st = MR.routeStats(R);
      a = `The current route is ${fmt(st.length)} km long with a mean slope of ${fmt(st.meanSlope)}° and mean traversability of ${fmt(st.meanTrav, 2)}. The model prefers to go around through terrain similar to what Curiosity has already crossed, even if it is longer.`;
    } else a = "I can answer about: remaining distance, next hazard, conditions, your position, nearby targets or why this route.";
    T.ai.push({ from: "them", text: a, t: T.simMin });
    renderPanel();
  }

  /* =====================================================
     SIDE PANELS (one at a time)
     ===================================================== */
  function togglePanel(name, sub) {
    S.panel = S.panel === name && !sub ? null : name;
    if (sub) S.logTab = sub;
    document.querySelectorAll(".rail-btn").forEach(b => b.setAttribute("aria-expanded", b.dataset.panel === S.panel));
    $("sidePanel").hidden = !S.panel;
    if (S.panel) { if (S.panel !== "findings") T.unread[S.panel] = 0; renderRail(); renderPanel(); }
    else if (T.unread.findings) { T.findings.forEach(f => (f.isNew = false)); T.unread.findings = 0; renderRail(); }
  }
  function renderRail(animate, kind) {
    ["missions", "logbook", "findings"].forEach(k => {
      const c = document.querySelector(`[data-count="${k}"]`), n = T.unread[k] || 0;
      c.hidden = !n; c.textContent = n;
      if (animate && k === kind && n) { c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump"); }
    });
  }
  function renderPanel() {
    if (!S.panel) return;
    const body = $("spBody");
    const titles = { missions: "Missions", logbook: "Logbook", findings: `Findings (${T.findings.length})` };
    $("spTitle").textContent = titles[S.panel];
    if (S.panel === "missions") return panelMissions(body);
    if (S.panel === "logbook") return panelLog(body);
    if (S.panel === "findings") return panelFindings(body);
  }
  function panelMissions(body) {
    const R = activeRoute(); const L = R ? R[R.length - 1][2] : T.baseRoute[T.baseRoute.length - 1][2];
    const pct = R ? Math.round((T.km / L) * 100) : 0;
    const status = { base: "Pending acceptance", plan: "Planning route", walk: T.playing ? "Traversing" : "Paused", done: "Completed" }[T.mode];
    const n = T.stages.length || makeStages(T.baseRoute).length;
    body.innerHTML = `<p class="sp-sub">${T.crew.short} · ${T.crew.role} — independent trip</p>
      <div class="m-main"><span class="kicker">Primary mission · ${status}</span><h4></h4>
        <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
        <div class="kicker num" style="display:flex;justify-content:space-between"><span>${pct} %</span><span>${fmt(T.km)} / ${fmt(L)} km</span></div>
        <div class="stages">${Array.from({ length: n }, (_, i) => `<span class="${i < T.stageIdx ? "done" : i === T.stageIdx && T.mode === "walk" ? "cur" : ""}" title="Stage ${i + 1}"></span>`).join("")}</div>
        ${T.mode === "base" ? '<div class="row-actions"><button class="btn primary" data-b>Open briefing</button></div>' : ""}
        ${T.mode === "walk" ? '<div class="row-actions"><button class="btn ghost" data-ab>Abort mission</button></div>' : ""}</div>
      <h3 style="font-size:14px;margin:18px 0 4px;display:flex;justify-content:space-between;align-items:center">Secondary <button class="btn" data-new style="min-height:32px;font-size:13px">+ New mission</button></h3>
      <div id="secList"></div>`;
    body.querySelector("h4").textContent = T.crew.title;
    const b = body.querySelector("[data-b]"); b && b.addEventListener("click", openMainBriefing);
    const ab = body.querySelector("[data-ab]"); ab && ab.addEventListener("click", () => confirmAbort());
    body.querySelector("[data-new]").addEventListener("click", () => openOwnBriefing());
    const list = body.querySelector("#secList");
    if (!T.missions.length) list.innerHTML = `<p class="empty">No secondary missions yet. The system and Earth will propose nearby targets during the traverse, or create your own by tapping the map.</p>`;
    T.missions.slice().reverse().forEach(m => {
      const d = document.createElement("div"); d.className = "m-sec" + (m.status === "completed" ? " done" : "");
      const st = { proposed: ["Proposed", "warn"], accepted: ["Accepted", "sec"], completed: ["Completed ✓", "ok"] }[m.status];
      d.innerHTML = `<header><b></b><span class="badge ${st[1]}">${st[0]}</span></header>
        <span class="kicker">${m.origin === "own" ? "Own · " + esc(m.type) : "Assigned · " + esc(m.by)}</span>
        <div class="row-actions">${m.status === "proposed" ? '<button class="btn primary" data-o>View briefing</button>' : ""}<button class="btn ghost" data-c>View on the map</button></div>`;
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
    body.innerHTML = `<div class="tabs log-tabs" role="tablist"><button role="tab" data-t="earth" aria-selected="${tab === "earth"}">Earth · ${ONE_WAY_MIN} min delay</button><button role="tab" data-t="assistant" aria-selected="${tab === "assistant"}">Route assistant</button></div>
      <div class="log" id="logBox" aria-live="polite"></div>
      ${tab === "assistant" ? `<div class="quick">${["How much is left?", "Next hazard", "Current conditions", "My position", "Nearby target", "Why this route?"].map(q => `<button>${q}</button>`).join("")}</div>` :
        `<div class="quick"><button data-pos>Send my position</button><button data-st>All in order</button></div>`}
      <form class="composer"><input maxlength="200" placeholder="${tab === "assistant" ? "Ask the assistant…" : "Message to Earth…"}" aria-label="Message"><button class="btn primary" type="submit">Send</button></form>`;
    body.querySelectorAll("[data-t]").forEach(b => b.addEventListener("click", () => { S.logTab = b.dataset.t; renderPanel(); }));
    const box = body.querySelector("#logBox");
    const items = tab === "assistant" ? T.ai : T.log;
    if (!items.length) box.innerHTML = `<p class="empty">${tab === "assistant" ? "Ask about distance, hazards, weather or your position. It answers instantly." : "Messages from Earth arrive here and your reports are saved. Each message takes 12 min to arrive."}</p>`;
    items.forEach(m => {
      const d = document.createElement("div"); d.className = "msg " + (m.from === "me" ? "me" : m.from === "sys" ? "sys" : m.from === "peer" ? "peer" : "them");
      d.appendChild(document.createTextNode(m.text));
      const meta = document.createElement("span"); meta.className = "meta";
      const who = m.from === "me" ? T.crew.short : m.from === "earth" ? "Earth" : m.from === "sys" ? "" : m.from === "peer" ? "Notice" : "Assistant";
      let st = "";
      if (m.from === "me" && tab === "earth") st = T.simMin >= m.arrive ? " · ✓ received on Earth" : ` · sent → arrives ${MR.solTime(m.arrive).hm}`;
      meta.textContent = `${who ? who + " " : ""}${MR.solTime(m.t).hm}${st}`;
      d.appendChild(meta);
      if (m.ll) {
        const l = document.createElement("button"); l.className = "loc"; l.textContent = "View on the map"; l.type = "button";
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
      if (tab === "assistant") askAssistant(v); else { const p = curPos(); sendToEarth(v, p ? [p[0], p[1]] : null); }
      setTimeout(() => { const i = $("spBody").querySelector(".composer input"); i && i.focus({ preventScroll: true }); }, 0);
    });
    body.querySelectorAll(".quick button").forEach(b => b.addEventListener("click", () => {
      if (tab === "assistant") return askAssistant(b.textContent);
      const p = curPos() || T.baseRoute[0];
      if (b.dataset.pos !== undefined) sendToEarth(`Vital coordinates: ${MR.fmtLL(p[0], p[1])} · ${fmt(p[3], 0)} m · km ${fmt(T.km)}`, [p[0], p[1]], "pos");
      else sendToEarth("Status: all in order, we continue.", [p[0], p[1]]);
    }));
  }
  function panelFindings(body) {
    const ft = S.fTab;
    const list = T.findings.filter(f => ft === "all" || f.type === ft);
    body.innerHTML = `<div class="chips" style="margin-bottom:12px">${[["all", "All"], ...FTYPES].map(([k, n]) => `<button class="chip-t" aria-pressed="${ft === k}" data-k="${k}">${n}</button>`).join("")}</div><div id="fList"></div>`;
    body.querySelectorAll("[data-k]").forEach(b => b.addEventListener("click", () => { S.fTab = b.dataset.k; renderPanel(); }));
    const box = body.querySelector("#fList");
    if (!list.length) box.innerHTML = `<p class="empty">${T.findings.length ? "No findings of this type." : "No findings yet. Tap a point on the map → “Log a finding here”, or use the Report here button."}</p>`;
    list.slice().reverse().forEach(f => {
      const d = document.createElement("div"); d.className = "f-item";
      d.innerHTML = `<div class="thumb">${f.photo ? `<img alt="" src="${f.photo}">` : MR.ICONS.mineral}</div><div><b></b>${f.isNew ? '<span class="dotnew" title="New"></span>' : ""}
        <small>${MR.fmtLL(f.lon, f.lat)} · ${MR.solTime(f.simMin).label}</small><div class="row-actions"><button class="btn ghost" data-c>View</button><button class="btn" data-p>Propose as mission</button></div></div>`;
      d.querySelector("b").textContent = f.typeName;
      d.querySelector("[data-c]").addEventListener("click", () => { MR.Map.centerOn(f.lon, f.lat, 3); setTimeout(() => openFindingCard(f), 300); });
      d.querySelector("[data-p]").addEventListener("click", () => openOwnBriefing({ lon: f.lon, lat: f.lat, name: "Sample: " + f.typeName.slice(0, 40), type: "Sampling" }));
      box.appendChild(d);
    });
    const peers = ft === "all" ? MR.Shared.visibleFor(T.crew.id, currentRegion).filter(n => n.kind === "finding") : [];
    if (peers.length) {
      const h = document.createElement("div"); h.className = "peer-head"; h.textContent = `Findings from other explorers (${peers.length})`; box.appendChild(h);
      peers.slice().reverse().forEach(n => {
        const a = crewOf(n.author), d = document.createElement("div"); d.className = "f-item peer";
        d.innerHTML = `<div class="thumb">${MR.ICONS.finding}</div><div><b></b><small></small><div class="row-actions"><button class="btn ghost" data-c>View</button></div></div>`;
        d.querySelector("b").textContent = n.text; d.querySelector("small").textContent = `${a.short} · ${a.role} · ${MR.fmtLL(n.lon, n.lat)}`;
        d.querySelector("[data-c]").addEventListener("click", () => { MR.Map.centerOn(n.lon, n.lat, 3); setTimeout(() => openSharedCard(n), 300); });
        box.appendChild(d);
      });
    }
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
      <header><b>${title}</b>${key === "model" ? '<span class="badge ok">Recommended</span>' : '<span class="badge warn">Higher risk</span>'}</header>
      <div class="stats"><div class="stat"><span class="v">${fmt(st.length, 1)}</span><span class="k">km</span></div>
        <div class="stat"><span class="v">≈${fmt(st.hours, 0)}</span><span class="k">h · ${st.solsC} ${st.solsC === 1 ? "sol" : "sols"}</span></div>
        <div class="stat"><span class="v">${fmt(st.meanTrav, 2)}</span><span class="k">mean traversability</span></div>
        <div class="stat"><span class="v">${st.hazards}</span><span class="k">sections &gt; ${MR.cfg.critSlope}°</span></div></div>
      <p class="why ${bad ? "bad" : ""}">${why}</p></button>`;
    const whyB = sb ? `Cuts a more direct line, but ${fmt(sb.lowFrac * 100, 0)} % of the path is hard to cross and mean roughness rises to ${fmt(sb.meanRough, 1)} m.` : "";
    $("dockPlan").innerHTML =
      card("model", T.adjusted ? "Adjusted route" : "Model route", sa, `Goes around through terrain similar to what Curiosity has already crossed. Mean slope ${fmt(sa.meanSlope, 1)}°.`, false) +
      (sb ? card("short", "Short route", sb, whyB, true) : "<div></div>") +
      `<div class="plan-actions"><button class="btn primary" data-acc>Accept route</button><button class="btn" data-adj>Adjust</button><button class="btn ghost" data-back>Back to briefing</button></div>`;
    $("dockPlan").querySelectorAll(".rcard").forEach(b => b.addEventListener("click", () => {
      T.choice = b.dataset.k; recomputeHazards(); renderRoutes(true); renderPlanCards(); renderStatus();
    }));
    $("dockPlan").querySelector("[data-acc]").addEventListener("click", () => {
      if (T.choice === "short") {
        showModal(`<div class="mhead"><div class="tag-line"><span class="tg alert">Confirm</span></div><h2>Use the short route?</h2></div><div class="mbody">
          <p class="who">${whyB} The model considers it less safe.</p>
          <div class="actions"><button class="btn" data-c data-focus>Choose the recommended one</button><button class="btn danger" data-y>Yes, use the short one</button></div></div>`, {
          bind: m => {
            m.querySelector("[data-c]").addEventListener("click", () => { closeModal(); T.choice = "model"; recomputeHazards(); renderRoutes(); renderPlanCards(); });
            m.querySelector("[data-y]").addEventListener("click", () => { closeModal(); acceptRoute(); });
          },
        });
      } else acceptRoute();
    });
    $("dockPlan").querySelector("[data-adj]").addEventListener("click", () => {
      setLeft(true); document.querySelector('[data-lptab="route"]').click();
      toast("Adjust weights or stops and press Recalculate route");
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
    const rr = MR.radiation.rate(p, T.mobility, T.rad.spe, T.simMin), dayD = radToday(), thr = MR.cfg.radThr, speOn = MR.radiation.speActive(T.rad.spe, T.simMin);
    const radSt = dayD >= thr ? "bad" : (speOn || dayD >= thr * 0.5) ? "warn" : "ok";
    const radTxt = dayD >= thr ? "Threshold exceeded" : speOn ? "Solar event" : dayD >= thr * 0.5 ? "High dose" : `Today ${fmt(dayD, 2)} mSv`;
    const tiles = [
      { k: "Temperature", v: fmt(w.air, 0), u: "°C", st: w.air < -65 ? "bad" : w.air < -50 ? "warn" : "ok", s: w.air < -65 ? "Extreme" : w.air < -50 ? "Cold" : "Nominal",
        src: "REMS air sensor of the Curiosity rover (profile of the chosen sol), corrected −2.5 °C per km of elevation." },
      { k: "Slope", v: fmt(p[4], 0), u: "°", st: p[4] > MR.cfg.critSlope ? "bad" : p[4] > MR.cfg.caution ? "warn" : "ok", s: p[4] > MR.cfg.critSlope ? "Dangerous" : p[4] > MR.cfg.caution ? "Caution" : "Gentle",
        src: "Computed from the MOLA/HRSC elevation model (NASA Mars Trek)." },
      { k: "Traversability", v: fmt(p[6], 2), u: "", st: p[6] < MR.cfg.travThr ? "bad" : p[6] < 0.5 ? "warn" : "ok", s: p[6] < MR.cfg.travThr ? "Hard" : p[6] < 0.5 ? "Medium" : "Good",
        src: "Probability (0–1), from the random forest model, that the terrain resembles what Curiosity crossed." },
      { k: "UV radiation", v: fmt(w.uv, 1), u: "W/m²", st: w.uv > 12 ? "warn" : "ok", s: w.uv > 12 ? "High" : "Normal",
        src: "REMS UV sensor (Curiosity)." },
      { k: "Radiation", v: fmt(rr * 1000, 0), u: "µSv/h", st: radSt, s: radTxt,
        src: `Simplified model, not a measurement. Base rate ≈ 27 µSv/h (0.65 mSv/day measured by MSL-RAD on the Gale floor; Simonsen, NASA 2024), adjusted for elevation and relief (assumptions). ${MR.radiation.speActive(T.rad.spe, T.simMin) ? "Solar event active: ×" + MR.radiation.P.speMult + " (assumption). " : ""}${currentRegion === "gale" ? "" : "Outside Gale there is only the base reference. "}Today's dose ${fmt(radToday(), 2)} mSv of ${fmt(MR.cfg.radThr, 1)} mSv (threshold configurable in Conditions → Radiation).` },
    ];
    const box = $("live");
    if (box.children.length !== 5) {
      box.innerHTML = tiles.map((t, i) => `<div class="tile" data-i="${i}"><span class="k"><span>${t.k}</span><button class="info" aria-label="Data source">?</button></span><span class="v num"></span><span class="s"></span></div>`).join("");
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
     VIEWS: 2D / 3D / 3D PLANET
     ===================================================== */
  function setView(v) {
    if ((v === "3d" || v === "globe") && !window.THREE) {
      toast("Three.js could not be loaded: the 3D view is not available");
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
  // Base map for the 3D relief: copy as a data: URI (data/basemaps_data.js, loaded on demand). Over file:// the <img> of the
  // 2D map cannot be used as a WebGL texture because the browser marks it as tainted and the terrain would come out black.
  const bm3d = {};
  MR.basemap3d = function () {
    const m = /basemap_[a-z_]+/.exec($("basemap").getAttribute("src") || ""), uri = m && window.MARS_BASEMAPS && window.MARS_BASEMAPS[m[0]];
    if (!uri) return null;
    if (!bm3d[m[0]]) { const im = new Image(); im.onload = () => sync3dTexture(); im.src = uri; bm3d[m[0]] = im; }
    return bm3d[m[0]].complete ? bm3d[m[0]] : null;
  };
  let bmLoading = false;
  function sync3dTexture() {
    if (!MR.Scene3D.ready) return;
    if (!window.MARS_BASEMAPS) {
      if (!bmLoading) { bmLoading = true; const sc = document.createElement("script"); sc.src = "data/basemaps_data.js"; sc.onload = () => sync3dTexture(); document.head.appendChild(sc); }
      return;
    }
    const im = MR.basemap3d(); if (!im) return; // still decoding: its onload calls again
    MR.Scene3D.setTexture(im, S.layer !== "none" ? $("overlay") : null, S.opacity);
  }
  function update3d() {
    const pins = [];
    filteredObjectives().forEach(o => pins.push({ type: o.type, lon: o.lon, lat: o.lat, label: o.name, onClick: () => openObjective(o) }));
    const minerals = getRegionMinerals();
    minerals.forEach(m => pins.push({ type: "mineral", lon: m.lon, lat: m.lat, isMineral: true, mineral: m, label: m.name, onClick: () => openMineralModal(m) }));
    T.findings.forEach(f => pins.push({ type: "finding", lon: f.lon, lat: f.lat, label: f.typeName, onClick: () => openFindingCard(f) }));
    T.missions.forEach(m => pins.push({ type: "secondary", lon: m.lon, lat: m.lat, label: m.name, onClick: () => openMissionCard(m) }));
    const st = {
      route: activeRoute(),
      km: T.km,
      pos: curPos(),
      color: T.crew.color,
      pins,
      secondary: T.missions.filter(m => m.path && m.status === "accepted").map(m => m.path)
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
          Mission Conditions
        </h2>
        <div class="who">Environmental telemetry and terrain parameters · Real NASA PDS / REMS data · ${esc(D.site)}</div>
      </div>
      <button class="modal-close-corner" id="btnDashClose" aria-label="Close window">✕</button>
    </div>
    <div class="dash-modal-tabs" role="tablist" aria-label="Conditions sections">
      <button role="tab" class="dash-tab-btn" data-tab="atm" aria-selected="${dashTab === "atm"}">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/></svg>
        Atmosphere and Weather
      </button>
      <button role="tab" class="dash-tab-btn" data-tab="ter" aria-selected="${dashTab === "ter"}">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="m14 6-3.75 5 2.85 3.8-1.6 1.2-4.5-6L1 18h22L14 6z"/></svg>
        Terrain and Routes
      </button>
      <button role="tab" class="dash-tab-btn" data-tab="rad" aria-selected="${dashTab === "rad"}">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none"><circle cx="12" cy="12" r="4" fill="currentColor"/><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>
        Radiation
      </button>
      <button role="tab" class="dash-tab-btn" data-tab="mod" aria-selected="${dashTab === "mod"}">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>
        Predictive Model
      </button>
    </div>
    <div class="mbody dash-modal-body" id="dashBody"></div>
    <div class="dash-modal-foot">
      <span class="dash-foot-hint">Press <span class="kbd">Esc</span> or click outside to return to the map</span>
      <button class="btn primary" id="btnDashDone">Close</button>
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
    else if (dashTab === "rad") dashRad(body);
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
    const VARS = { temp: ["Temperature", "°C"], uv: ["UV radiation", "W/m²"], p: ["Pressure", "Pa"], rh: ["Relative humidity", "%"] };
    const c1 = css("--accent"), c2 = css("--caution");
    const series = dashVar === "temp" ? [{ name: "Air", values: P.air_c, hours: hrs, color: c1 }, { name: "Ground", values: P.ground_c, hours: hrs, color: c2, dash: "6 4" }]
      : [{ name: VARS[dashVar][0], values: dashVar === "uv" ? P.uv_w_m2 : dashVar === "p" ? P.pressure_pa : P.rh_pct, hours: hrs, color: c1 }];
    const vals = series[0].values; const mn = Math.min(...vals), mx = Math.max(...vals);
    const now = T.mode === "walk" || T.mode === "done" ? time().hour : null;
    const desc = { temp: "Full-sol cycle measured by Curiosity. The blue band is the walking window (" + hm(evaStart()) + "–" + hm(MR.eva.endHour()) + ", configurable).",
      uv: "Ultraviolet radiation arrives almost unfiltered: dust in the air reduces it (sol 4500 has more dust).",
      p: "Pressure is ~0.6 % of Earth's and rises and falls every day as the atmosphere heats up.",
      rh: "Relative humidity: rises at night as the air cools." }[dashVar];
    body.innerHTML = `<div class="grid-2"><div class="card">
      <div class="filters"><div class="seg" role="radiogroup" aria-label="Variable">${Object.entries(VARS).map(([k, [n]]) => `<button role="radio" aria-checked="${k === dashVar}" data-v="${k}">${n}</button>`).join("")}</div>
      <div class="seg" role="radiogroup" aria-label="Measured sol"><button role="radio" data-s="sol_100" aria-checked="${dashSol === "sol_100"}">Sol 100 (2012)</button><button role="radio" data-s="sol_4500" aria-checked="${dashSol === "sol_4500"}">Sol 4500 (2025)</button></div></div>
      <h3>${VARS[dashVar][0]} over the sol</h3><p class="desc">${desc}</p>
      ${series.length > 1 ? `<div class="legend-row" style="margin-bottom:6px">${series.map(s => `<span><i style="--c:${s.color}"></i>${s.name}</span>`).join("")}</div>` : ""}
      <div class="chart" id="atmChart"></div></div>
      <div class="card"><h3>Sol summary</h3><p class="desc">Measured at the crater floor (−4,500 m). Along the route it is corrected for elevation.</p>
        <div class="kpi"><span class="v num">${fmt(mn, 1)}<small> ${VARS[dashVar][1]}</small></span><span class="k">Minimum</span></div>
        <div class="kpi"><span class="v num">${fmt(mx, 1)}<small> ${VARS[dashVar][1]}</small></span><span class="k">Maximum</span></div>
        ${T.wx ? `<div class="kpi"><span class="v num">${fmt(dashVar === "temp" ? T.wx.air : dashVar === "uv" ? T.wx.uv : dashVar === "p" ? T.wx.p : T.wx.rh, 1)}<small> ${VARS[dashVar][1]}</small></span><span class="k">Now at your position (${time().label})</span></div>` : ""}
        <p class="desc" style="margin-top:12px">Source: REMS ENVRDR, NASA PDS Atmospheres Node. ${D.rems[dashSol].hours.length} intervals of 15 min.</p></div></div>`;
    body.querySelectorAll("[data-v]").forEach(b => b.addEventListener("click", () => { dashVar = b.dataset.v; renderDashboard(); }));
    body.querySelectorAll("[data-s]").forEach(b => b.addEventListener("click", () => { dashSol = b.dataset.s; renderDashboard(); }));
    MR.lineChart($("atmChart"), { series, unit: VARS[dashVar][1], eva: true, marker: now, showZero: dashVar === "temp", zeroBase: dashVar === "uv", decimals: dashVar === "uv" ? 2 : 1, label: VARS[dashVar][0] });
  }
  function dashTerrain(body) {
    const A = T.mode === "walk" || T.mode === "done" ? T.route : T.adjusted || T.baseRoute;
    const B = T.crew.main === "summit" ? MR.withKm(D.routes.summit_short.points) : T.shortRoute;
    const sa = MR.routeStats(A), sb = B ? MR.routeStats(B) : null;
    const withConf = sa.meanConf != null;
    const rows = [["Length", "length", " km", 1, "min"], ["Walking hours (est.)", "hours", " h", 1, "min"], ["EVA sols (est.)", "solsC", "", 0, "min"], ["Mean slope", "meanSlope", "°", 1, "min"], ["Max slope", "maxSlope", "°", 1, "min"],
      ["Mean roughness", "meanRough", " m", 1, "min"], ["Mean traversability", "meanTrav", "", 2, "max"], ...(withConf ? [["Model confidence (mean)", "meanConf", "", 2, "max"]] : []), ["Sections above the threshold", "hazards", "", 0, "min"], ["Path with hard passage", "lowFrac", " %", 0, "min", 100]];
    const cell = (st, other, r) => { const v = st[r[1]] * (r[5] || 1); const o = other ? other[r[1]] * (r[5] || 1) : null;
      const best = o != null && (r[4] === "min" ? v < o : v > o); return `<td class="${best ? "best" : ""}">${fmt(v, r[3])}${r[2]}</td>`; };
    const ca = MR.slopeClasses(A), cb = B ? MR.slopeClasses(B) : null;
    body.innerHTML = `<div class="grid-2"><div class="card"><h3>Route comparison</h3><p class="desc">The model accepts walking farther in exchange for stepping on easier terrain. The best value of each row is in green.</p>
      <table class="cmp"><thead><tr><th>Indicator</th><th>${T.mode === "walk" || T.mode === "done" ? "Route in use" : "Model route"}</th>${sb ? "<th>Short route</th>" : ""}</tr></thead>
      <tbody>${rows.map(r => `<tr><th scope="row" style="font-weight:500">${r[0]}</th>${cell(sa, sb, r)}${sb ? cell(sb, sa, r) : ""}</tr>`).join("")}</tbody></table></div>
      <div class="card"><h3>Why is the short route not optimal?</h3><ul class="explain">
        ${sb ? `<li>It spends ${fmt(sb.lowFrac * 100, 0)} % of the time on terrain the model rates as hard (vs. ${fmt(sa.lowFrac * 100, 0)} %).</li>
        <li>Its mean roughness is ${fmt(sb.meanRough, 1)} m: more rocks and small steps.</li>
        <li>It is like crossing a city on steep, broken streets to save a few blocks: you arrive just as tired and with more risk of falling.</li>` : "<li>No comparison route for this mission.</li>"}
        <li>The not-recommended zones (red layer) can be seen in Layers → Not-recommended zones.</li></ul></div></div>
      <div class="card" style="margin-top:16px"><h3>Distance by slope type</h3><p class="desc">Kilometers of each route according to how steep the terrain is.</p>
      <div class="legend-row" style="margin-bottom:8px"><span><i class="sq" style="--c:${css("--accent")}"></i>${T.mode === "walk" || T.mode === "done" ? "Route in use" : "Model route"}</span>${cb ? `<span><i class="sq" style="--c:${css("--text-2")}"></i>Short route</span>` : ""}</div>
      <div class="chart" id="slopeBars"></div></div>`;
    const labels = ["Flat (≤ 5°)", `Gentle (5–${MR.cfg.caution}°)`, `Caution (${MR.cfg.caution}–${MR.cfg.critSlope}°)`, `Danger (> ${MR.cfg.critSlope}°)`];
    const items = [];
    labels.forEach((l, i) => {
      items.push({ label: l, value: ca[i], text: fmt(ca[i], 1) + " km", color: css("--accent") });
      if (cb) items.push({ label: "", value: cb[i], text: fmt(cb[i], 1) + " km", color: css("--text-2"), tip: "Short route" });
    });
    MR.barH($("slopeBars"), items, { label: "Distance by slope", labelW: 170 });
  }
  function dashRad(body) {
    const R = T.rad, P = MR.radiation.P, thr = MR.cfg.radThr, walking = T.mode === "walk";
    const p = curPos() || T.baseRoute[0];
    const rate = MR.radiation.rate(p, T.mobility, R.spe, T.simMin), on = MR.radiation.speActive(R.spe, T.simMin);
    const day = T.mode === "walk" || T.mode === "done" ? radToday() : 0;
    const planned = MR.routeResources(activeRoute() || T.baseRoute, T.mobility || "rover");
    const mob = T.mobility === "rover" ? "pressurized rover" : "on foot in a suit";
    body.innerHTML = `<p class="rad-note"><span class="tag-sup">SIMPLIFIED MODEL</span> It is not a measurement or a forecast. It estimates the dose of someone outdoors at each point of the route and is useful for comparing routes and testing alerts.</p>
      <div class="grid-3">
        <div class="card"><div class="kpi"><span class="v num">${fmt(rate * 1000, 0)}<small> µSv/h</small></span><span class="k">Dose rate at your position (${mob}${on ? ", solar event active" : ""}). Gale floor baseline: 27 µSv/h.</span></div></div>
        <div class="card"><div class="kpi"><span class="v num">${fmt(day, 2)}<small> mSv</small></span><span class="k">Today's EVA dose, of a ${fmt(thr, 1)} mSv threshold. Accumulated on the trip: ${fmt(R.total, 2)} mSv.</span></div></div>
        <div class="card"><div class="kpi"><span class="v num">${fmt(planned.radDose, 2)}<small> mSv</small></span><span class="k">Predicted for the full route (${mob}, no solar event).</span></div></div></div>
      <div class="grid-2" style="margin-top:16px">
        <div class="card"><h3>Alert threshold</h3>
          <label class="slider">EVA dose per workday <output id="radOut">${fmt(thr, 1)} mSv</output>
            <input type="range" id="radThr" min="0.5" max="50" step="0.5" value="${thr}"></label>
          <p class="desc">Notice at 50 % and critical alert at 100 %. It is an operational threshold of this app <span class="tag-sup">ASSUMPTION</span>, not a NASA limit. For reference, the NASA limit for a solar event is 250 mSv of effective dose and 600 mSv for a whole career (Simonsen 2024; Tasoula et al.).</p>
          <h3 style="margin-top:14px">Solar event (demonstration)</h3>
          <p class="desc">${on ? `Event active: the outdoor dose is ×${P.speMult} (assumption) for ${P.speHours} h.` : "No event. Solar events cannot be forecast precisely: here they are simulated on demand."}</p>
          ${walking ? (on ? `<button class="btn" id="btnSpeOff">End event</button>` : `<button class="btn primary" id="btnSpeOn">Simulate solar event now</button>`) : `<p class="desc">Available during the traverse.</p>`}</div>
        <div class="card"><h3>What the model assumes</h3>
          <ul class="explain rad-list">${MR.radiation.ASSUMPTIONS.map(a => `<li><span class="tag-${a.kind === "source" ? "src" : "sup"}">${a.kind === "source" ? "SOURCE" : "ASSUMPTION"}</span> <b>${esc(a.k)}:</b> ${esc(a.v)}. ${esc(a.n)}</li>`).join("")}</ul>
          <p class="desc" style="margin-top:8px">Sources: Simonsen (NASA HQ, 2024); Tasoula et al., <i>Health Impacts of Radiation in Space</i>. Details in docs/SOURCES_NOTES.md.</p></div></div>`;
    const sl = $("radThr");
    sl.addEventListener("input", e => { MR.cfg.radThr = +e.target.value; $("radOut").textContent = fmt(MR.cfg.radThr, 1) + " mSv"; });
    sl.addEventListener("change", () => { MR.store.set("radThr", MR.cfg.radThr); toast("Radiation threshold updated"); renderLive(true); renderDashboardTabContent(); });
    const on1 = $("btnSpeOn"), off1 = $("btnSpeOff");
    if (on1) on1.addEventListener("click", () => {
      R.spe = MR.radiation.startSpe(T.simMin); delete R.flags["spe" + time().sol]; delete R.flags.speEnd;
      closeDashboard(); setTimeout(() => { if (!checkRadiation()) toast("Simulated solar event · press ▶ to continue"); }, 60);
    });
    if (off1) off1.addEventListener("click", () => { R.spe = null; R.flags.speSeen = 0; renderDashboardTabContent(); renderLive(true); });
  }
  function dashModel(body) {
    const M = D.model.metrics.test, FI = D.model.feature_importance;
    const names = { slope: "Slope", roughness: "Roughness", texture: "Optical texture", gradient: "Optical gradient", thermal: "Thermal" };
    const cm = M.confusion_matrix; const max = Math.max(...cm.flat());
    const shade = v => `color-mix(in srgb, ${css("--accent")} ${Math.round(25 + (v / max) * 75)}%, ${css("--panel-2")})`;
    body.innerHTML = `<div class="grid-3">
      <div class="card"><div class="kpi"><span class="v num">${fmt(M.roc_auc, 2)}</span><span class="k">ROC AUC on test: out of every 100 pairs (good terrain, bad terrain), the model ranks ~${Math.round(M.roc_auc * 100)} correctly.</span></div></div>
      <div class="card"><div class="kpi"><span class="v num">${fmt(M.accuracy * 100, 0)} %</span><span class="k">Accuracy: cells classified correctly (${M.samples} test cells).</span></div></div>
      <div class="card"><div class="kpi"><span class="v num">${fmt(M.average_precision, 2)}</span><span class="k">Average precision: how reliable it is when it says “can be walked”.</span></div></div></div>
      <div class="grid-2" style="margin-top:16px"><div class="card"><h3>What does the model look at?</h3><p class="desc">Importance of each feature in the 300-tree random forest. Roughness and slope decide almost everything, like when you choose how to climb a hill: you look at how steep and how rocky it is.</p>
        <div class="chart" id="fiBars"></div></div>
      <div class="card"><h3>Confusion matrix (test)</h3><p class="desc">The model is cautious: it almost never calls dangerous terrain “easy” (${cm[0][1]} cases), although it sometimes discards good terrain.</p>
        <div class="cm"><span></span><span class="h">Predicts hard</span><span class="h">Predicts easy</span>
          <span class="h">Actually hard</span><div class="cell" style="background:${shade(cm[0][0])}">${cm[0][0]}</div><div class="cell" style="background:${shade(cm[0][1])}">${cm[0][1]}</div>
          <span class="h">Actually easy</span><div class="cell" style="background:${shade(cm[1][0])}">${cm[1][0]}</div><div class="cell" style="background:${shade(cm[1][1])}">${cm[1][1]}</div></div></div></div>
      <div class="card" style="margin-top:16px"><h3>How it was trained</h3><ul class="explain">
        <li>Positive examples: cells within 60 m of Curiosity's actual path (${D.model.metrics.positives}). Negatives: distant cells with slope &gt; 15° or very rough texture (${D.model.metrics.negatives}).</li>
        <li>70/15/15 spatial split along the traverse so the model does not “cheat” by seeing neighboring areas.</li>
        <li>The probability is used as the cost in A*: <span class="num">cost = 1 + ${MR.cfg.riskW}·(1 − p)² + ${MR.cfg.slopeW}·slope²</span>; cells with slope &gt; ${MR.cfg.maxSlope}° are blocked.</li></ul></div>`;
    body.insertAdjacentHTML("beforeend", modelLimitsHtml(M));
    const bl = $("btnConfLayer");
    if (bl) bl.addEventListener("click", () => { closeDashboard(); selectLayer("confidence"); toast("«Model confidence» layer active"); });
    MR.barH($("fiBars"), Object.entries(FI).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: names[k], value: v, text: fmt(v * 100, 0) + " %", color: css("--accent") })), { max: 0.5, labelW: 140 });
  }
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  // Confidence and "Limitations and assumptions" of the traversability model, in plain language.
  // Each point says where it comes from: a cited source, a repo datum or an own assumption.
  function modelLimitsHtml(M) {
    const X = MR.EXTRA && MR.EXTRA.summary, tag = (k, t) => `<span class="tag-${k === "sup" ? "sup" : "src"}">${t}</span>`;
    const B = X && X.by_distance_to_traverse, near = B && B["within 1 km of the traverse"], far = B && B["beyond 10 km"];
    const rt = X && X.routes, rA = rt && (T.crew.main === "summit" ? rt.summit : rt[T.crew.main]), rB = rt && rt.summit_short;
    const f2 = v => fmt(v, 2);
    const conf = X ? `<div class="card" style="margin-top:16px"><h3>Model confidence</h3>
      <p class="desc">We ask the same question to each of the ${X.trees} trees of the forest. If they agree, confidence is high; if they contradict each other, it is low. It can be seen on the map (Layers → Model confidence).</p>
      <div class="grid-3">
        <div class="card"><div class="kpi"><span class="v num">${rA ? f2(rA.mean_confidence) : "—"}</span><span class="k">Mean confidence along the model route${rB && T.crew.main === "summit" ? ` (short route: ${f2(rB.mean_confidence)})` : ""}</span></div></div>
        <div class="card"><div class="kpi"><span class="v num">${fmt(X.low_confidence_cells_pct, 0)} %</span><span class="k">Of the area with low confidence (below 0.5)</span></div></div>
        <div class="card"><div class="kpi"><span class="v num">${fmt(X.out_of_training_range_pct, 0)} %</span><span class="k">Of the area with values the model did not see in training</span></div></div></div>
      <p class="desc" style="margin-top:10px"><b>Caution:</b> trees agreeing does not mean they are right. ${near && far ? `Near Curiosity's traverse the mean confidence is ${f2(near.mean_confidence)} and beyond 10 km it is ${f2(far.mean_confidence)}: it barely drops, even though the model is extrapolating there.` : ""} Use it to see where the model doubts, not as a guarantee.</p>
      <button class="btn" id="btnConfLayer">View on the map</button></div>` : "";
    const li = [
      [tag("sup", "ASSUMPTION"), "<b>The rover does not walk like an astronaut.</b> Curiosity has wheels; a person in a suit walks and gets tired. Slopes, loose rocks and sand that slow one do not slow the other in the same way. This is our own reasoning, not a result from the sources."],
      [tag("src", "SOURCE · Bennett 2023"), "<b>The rover followed the science, not the easiest path.</b> Scientists chose where to go according to their geological questions. That the rover passed through a place does not mean it is the easiest, nor the only traversable one."],
      [tag("src", "SOURCE · Bennett 2023"), "<b>The rover climbed 32° and went around the sand.</b> It reached a 32° incline on a scarp and skirted a field of sand ripples. Our 20° veto is a design decision (another scale: 44 m cells, not the rover's inclination). And the model has no “sand” class."],
      [tag("src", "REPO DATA"), `<b>The “bad” examples are chosen.</b> Since only the rover's path is known, negative cells are taken far from it and only if they are steep or rough. That is why the model ranks relative risk; it does not certify that terrain is safe.`],
      [tag("src", "REPO DATA"), `<b>It learned on a single 19 km corridor</b> near the landing site; the summit is about 47 km away.${X ? ` ${fmt(X.out_of_training_range_pct, 0)} % of the area has values outside what it saw.` : ""}`],
      [tag("src", "REPO DATA"), "<b>It does not see loose rocks or dunes</b> (44 m cells; the browser uses 177 m), nor dust, visibility, suit energy or fatigue."],
      [tag("src", "REPO DATA"), `<b>It ranks well, but does not decide alone.</b> ROC AUC ${f2(M.roc_auc)} (ranks easy/hard pairs well) but F1 ${f2(M.f1)}: as a “yes/no” detector it fails quite a lot.`],
    ];
    return `${conf}<div class="card" style="margin-top:16px"><h3>Limitations and assumptions</h3>
      <p class="desc">What you should not expect from the model. Details and sources in docs/MODEL_LIMITATIONS.md.</p>
      <ul class="explain rad-list">${li.map(([t, h]) => `<li>${t} ${h}</li>`).join("")}</ul></div>`;
  }

  /* =====================================================
     FULL VIEW — Automatic summary
     ===================================================== */
  function openSummary() {
    const el = $("summary"), R = T.route, st = MR.routeStats(R);
    const sols = Math.floor(T.simMin / 1440) + 1, sec = T.missions.filter(m => m.status === "completed").length;
    const hrs = (T.simMin - evaStart() * 60) / 60;
    el.innerHTML = `<header class="fv-head"><button class="btn" data-back>↩ Back to the map</button><div><h2>Mission summary</h2><div class="sub">${T.crew.short} · ${T.crew.role}</div></div></header>
      <div class="fv-body"><div class="sum-hero"><div>
        <h1><span class="ok">${MR.ICONS.ok}</span>${T.returning ? "Return to shelter completed" : "Mission completed"}</h1>
        <p style="color:var(--text-2);font-size:16px;margin:0">${T.returning ? `Mission interrupted by radiation · ${esc(T.returning.name)}` : esc(T.crew.title)} · arrival ${time().label}</p>
        <div class="sum-stats">
          <div class="stat"><span class="v num">${fmt(st.length, 1)}</span><span class="k">km traveled</span></div>
          <div class="stat"><span class="v num">${sols}</span><span class="k">${sols === 1 ? "sol" : "sols"} (${fmt(hrs, 0)} h)</span></div>
          <div class="stat"><span class="v num">+${fmt(st.maxElev - R[0][3], 0)}</span><span class="k">m elevation gain</span></div>
          <div class="stat"><span class="v num">${T.findings.length}</span><span class="k">findings</span></div>
          <div class="stat"><span class="v num">${sec}</span><span class="k">secondary missions completed</span></div>
          <div class="stat"><span class="v num">${T.alerts}</span><span class="k">alerts handled · ${T.detours} detours</span></div>
          <div class="stat" title="Simplified model: it only counts hours outdoors"><span class="v num">${fmt(T.rad.total, 2)}</span><span class="k">mSv of EVA dose · simplified model</span></div></div>
        <div class="actions" style="display:flex;gap:8px"><button class="btn primary" data-new>New mission</button><button class="btn" data-log>View logbook</button></div>
        <h3 style="margin:24px 0 10px;font-size:15px">Timeline</h3><ol class="timeline"></ol></div>
        <div><div class="sum-map"><img alt="Traverse map" src="assets/basemap_${S.base === "thermal" ? "relief" : S.base}.jpg"><svg viewBox="0 0 1200 1200" aria-hidden="true"></svg></div>
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
    el.querySelector("[data-log]").addEventListener("click", () => { el.hidden = true; togglePanel("logbook", "earth"); });
    el.querySelector("[data-new]").addEventListener("click", () => {
      el.hidden = true;
      const keep = { findings: T.findings, log: T.log, ai: T.ai, sharedSeen: T.sharedSeen };
      trips[T.crew.id] = T = Object.assign(newTrip(T.crew), keep);
      renderAll(true); MR.Map.fit(); setTimeout(openMainBriefing, 300);
    });
    el.querySelector("[data-new]").focus({ preventScroll: true });
  }

  /* =====================================================
     HELP, GUIDED TOUR AND SHORTCUTS
     ===================================================== */
  function openHelp() {
    showModal(`<div class="mhead"><h2>Help</h2><p class="who">The robot has already mapped the terrain; you decide where to walk. Tap any point on the map to see whether it is traversable.</p></div>
      <div class="mbody"><div class="help-grid">
      <span class="kbd">Space</span><span>Start or pause the simulation</span>
      <span class="kbd">1 2 3</span><span>Speed x1 · x10 · x50</span>
      <span class="kbd">M B H</span><span>Missions, Logbook and Findings panels</span>
      <span class="kbd">R</span><span>Report a finding at your position</span>
      <span class="kbd">D</span><span>Conditions (dashboard)</span>
      <span class="kbd">V</span><span>Switch between 2D map and 3D relief</span>
      <span class="kbd">Esc</span><span>Close the open window or panel</span></div>
      <p class="who" style="margin-top:14px">Colors: <b style="color:var(--route)">blue</b> route, <b style="color:var(--nominal)">green</b> traverse and findings, <b style="color:var(--secondary)">dotted purple</b> secondary missions, <b style="color:var(--caution)">amber</b> caution, <b style="color:var(--danger)">red</b> danger.</p>
      <div class="actions"><button class="btn" data-t>Repeat guided tour</button><button class="btn primary" data-x>Got it</button></div></div>`, {
      bind: m => { m.querySelector("[data-x]").addEventListener("click", closeModal); m.querySelector("[data-t]").addEventListener("click", () => { closeModal(); startTour(); }); },
    });
  }
  function startTour(done) {
    const steps = [
      { el: ".statusbar", t: "Status bar", p: "Here you see who is walking (each explorer makes their own trip), the sol and the Martian time, ▶ to start and the kilometers traveled." },
      { el: "#map", t: "The map never closes", p: "Tap any point: you will see whether it is traversable and can log a finding, create a mission or measure a distance. On the left, layers and filters." },
      { el: ".rail", t: "Panels and reports", p: "Missions, Logbook (Earth and assistant) and Findings open here, one at a time. The green Report here button logs a finding where you are." },
    ];
    let i = 0; const tour = $("tour"); tour.hidden = false;
    const show = () => {
      const s = steps[i], r = document.querySelector(s.el).getBoundingClientRect();
      const pad = 6, small = s.el === "#map";
      const box = small ? { left: r.left + r.width * 0.3, top: r.top + r.height * 0.25, width: r.width * 0.4, height: r.height * 0.45 } : { left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
      tour.innerHTML = `<div class="hole" style="left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px"></div>
        <div class="tip" role="dialog" aria-label="Guided tour"><h3>${s.t}</h3><p>${s.p}</p><footer><div class="dots">${steps.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div>
        <div style="display:flex;gap:6px"><button class="btn ghost" data-s>Skip</button><button class="btn primary" data-n>${i < steps.length - 1 ? "Next" : "Start"}</button></div></footer></div>`;
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
      else if (k === "m") togglePanel("missions");
      else if (k === "b") togglePanel("logbook");
      else if (k === "h") togglePanel("findings");
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
