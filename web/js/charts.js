/* =========================================================
   charts.js — lightweight SVG charts (no libraries)
   ========================================================= */
(function () {
  "use strict";
  const MR = window.MR;
  const NS = "http://www.w3.org/2000/svg";
  const tip = () => document.getElementById("tooltip");
  function showTip(html, x, y) {
    const t = tip(); t.innerHTML = html; t.hidden = false;
    const w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = Math.min(window.innerWidth - w - 8, x + 14) + "px";
    t.style.top = Math.max(8, y - h - 12) + "px";
  }
  function hideTip() { tip().hidden = true; }
  MR.showTip = showTip; MR.hideTip = hideTip;
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function niceTicks(lo, hi, n = 5) {
    const span = hi - lo || 1, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n) || mag * 10;
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
  }

  /* ---------- Route elevation profile (with the explorer's position) ---------- */
  MR.profileChart = function (host, pts, o = {}) {
    host.innerHTML = "";
    if (!pts || pts.length < 2) return;
    const Wd = host.clientWidth - 20, Ht = host.clientHeight - 12;
    if (Wd < 50) return;
    const m = { l: 58, r: 8, t: 8, b: 18 };
    const svg = el("svg", { viewBox: `0 0 ${Wd} ${Ht}`, role: "img", "aria-label": "Elevation profile", class: "ch" }, host);
    const L = pts[pts.length - 1][2];
    const zs = pts.map(p => p[3]); const zmin = Math.min(...zs), zmax = Math.max(...zs);
    const X = km => m.l + (km / L) * (Wd - m.l - m.r);
    const Y = z => Ht - m.b - ((z - zmin) / (zmax - zmin || 1)) * (Ht - m.t - m.b);
    const g = el("g", { class: "grid" }, svg);
    niceTicks(zmin, zmax, 3).forEach(v => {
      el("line", { x1: m.l, x2: Wd - m.r, y1: Y(v), y2: Y(v), stroke: css("--border") }, g);
      const t = el("text", { x: m.l - 6, y: Y(v) + 4, "text-anchor": "end", fill: css("--text-2"), "font-size": 11, "font-family": "Barlow Semi Condensed" }, svg);
      t.textContent = MR.fmt(v, 0) + " m";
    });
    niceTicks(0, L, 6).forEach(v => {
      const t = el("text", { x: X(v), y: Ht - 3, "text-anchor": "middle", fill: css("--text-2"), "font-size": 11, "font-family": "Barlow Semi Condensed" }, svg);
      t.textContent = v + " km";
    });
    // area by segments colored by slope (green / amber / red)
    const col = s => (s > MR.cfg.critSlope ? css("--danger") : s > MR.cfg.caution ? css("--caution") : css("--nominal"));
    const step = Math.max(1, Math.floor(pts.length / 400));
    for (let i = step; i < pts.length; i += step) {
      const a = pts[i - step], b = pts[i];
      el("path", { d: `M${X(a[2])},${Y(a[3])}L${X(b[2])},${Y(b[3])}L${X(b[2])},${Ht - m.b}L${X(a[2])},${Ht - m.b}Z`,
        fill: col(b[4]), "fill-opacity": .22, stroke: "none" }, svg);
    }
    let d = ""; pts.forEach((p, i) => { if (i % step === 0 || i === pts.length - 1) d += (d ? "L" : "M") + X(p[2]).toFixed(1) + "," + Y(p[3]).toFixed(1); });
    el("path", { d, stroke: css("--text"), "stroke-width": 2, fill: "none" }, svg);
    // stage boundaries
    (o.stages || []).forEach((km, i) => {
      if (km <= 0 || km >= L) return;
      el("line", { x1: X(km), x2: X(km), y1: m.t, y2: Ht - m.b, stroke: css("--text-2"), "stroke-dasharray": "3 3" }, svg);
      const t = el("text", { x: X(km) + 3, y: m.t + 10, fill: css("--text-2"), "font-size": 10, "font-family": "Barlow Semi Condensed" }, svg);
      t.textContent = "E" + (i + 1);
    });
    // danger zones
    (o.hazards || []).forEach(z => {
      el("rect", { x: X(z.startKm) - 2, width: Math.max(4, X(z.endKm) - X(z.startKm) + 4), y: m.t, height: 5, rx: 2, fill: css("--danger") }, svg);
    });
    // position
    if (o.posKm != null) {
      const pi = MR.nearestKm(pts, o.posKm);
      el("rect", { x: m.l, y: m.t, width: Math.max(0, X(o.posKm) - m.l), height: Ht - m.t - m.b, fill: css("--accent"), "fill-opacity": .06 }, svg);
      el("line", { x1: X(o.posKm), x2: X(o.posKm), y1: m.t, y2: Ht - m.b, stroke: css("--accent"), "stroke-width": 2 }, svg);
      el("circle", { cx: X(o.posKm), cy: Y(pts[pi][3]), r: 6, fill: css("--accent"), stroke: css("--panel"), "stroke-width": 2 }, svg);
    }
    // interaction layer (cursor + tooltip + click)
    const hl = el("line", { y1: m.t, y2: Ht - m.b, stroke: css("--text-2"), "stroke-width": 1, visibility: "hidden" }, svg);
    const hit = el("rect", { x: m.l, y: 0, width: Wd - m.l - m.r, height: Ht, fill: "transparent", style: "cursor:pointer" }, svg);
    const at = ev => {
      const r = svg.getBoundingClientRect(); const x = (ev.clientX - r.left) * (Wd / r.width);
      const km = Math.max(0, Math.min(L, ((x - m.l) / (Wd - m.l - m.r)) * L));
      return pts[MR.nearestKm(pts, km)];
    };
    hit.addEventListener("mousemove", ev => {
      const p = at(ev); hl.setAttribute("x1", X(p[2])); hl.setAttribute("x2", X(p[2])); hl.setAttribute("visibility", "visible");
      showTip(`<b>${MR.fmt(p[2])} km</b><br>Elevation ${MR.fmt(p[3], 0)} m · Slope ${MR.fmt(p[4])}°<br>Traversability ${MR.fmt(p[6], 2)}`, ev.clientX, ev.clientY);
    });
    hit.addEventListener("mouseleave", () => { hl.setAttribute("visibility", "hidden"); hideTip(); });
    hit.addEventListener("click", ev => o.onPick && o.onPick(at(ev)));
  };
  MR.nearestKm = function (pts, km) {
    let lo = 0, hi = pts.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid][2] < km) lo = mid + 1; else hi = mid; }
    return lo;
  };

  /* ---------- Line by hour of the sol (REMS) ---------- */
  MR.lineChart = function (host, cfg) {
    host.innerHTML = "";
    const Wd = Math.max(320, host.clientWidth), Ht = cfg.height || 300;
    const m = { l: 52, r: 16, t: 14, b: 32 };
    const svg = el("svg", { viewBox: `0 0 ${Wd} ${Ht}`, role: "img", "aria-label": cfg.label, class: "ch" }, host);
    const all = cfg.series.flatMap(s => s.values);
    let lo = Math.min(...all), hi = Math.max(...all);
    if (cfg.zeroBase) lo = Math.min(0, lo);
    const pad = (hi - lo) * 0.08; lo -= cfg.zeroBase ? 0 : pad; hi += pad;
    const X = h => m.l + (h / 24) * (Wd - m.l - m.r);
    const Y = v => Ht - m.b - ((v - lo) / (hi - lo || 1)) * (Ht - m.t - m.b);
    const g = el("g", { class: "grid" }, svg);
    niceTicks(lo, hi, 5).forEach(v => {
      el("line", { x1: m.l, x2: Wd - m.r, y1: Y(v), y2: Y(v) }, g);
      el("text", { x: m.l - 8, y: Y(v) + 4, "text-anchor": "end" }, svg).textContent = MR.fmt(v, Number.isInteger(v) ? 0 : 1) + (cfg.unit ? " " + cfg.unit : "");
    });
    if (lo < 0 && hi > 0 && cfg.showZero) el("line", { x1: m.l, x2: Wd - m.r, y1: Y(0), y2: Y(0), class: "zero" }, svg);
    for (let h = 0; h <= 24; h += 3) el("text", { x: X(h), y: Ht - 10, "text-anchor": "middle" }, svg).textContent = String(h).padStart(2, "0") + ":00";
    // EVA window
    if (cfg.eva) el("rect", { x: X(MR.eva ? MR.eva.cfg.startHour : 8), width: X(MR.eva ? MR.eva.endHour() : 17) - X(MR.eva ? MR.eva.cfg.startHour : 8), y: m.t, height: Ht - m.t - m.b, fill: css("--accent"), "fill-opacity": .06 }, svg);
    cfg.series.forEach(s => {
      const hrs = s.hours; let d = "";
      s.values.forEach((v, i) => { d += (i ? "L" : "M") + X(hrs[i]).toFixed(1) + "," + Y(v).toFixed(1); });
      el("path", { d, stroke: s.color, "stroke-width": 2, fill: "none", "stroke-dasharray": s.dash || "" }, svg);
    });
    if (cfg.marker != null) {
      el("line", { x1: X(cfg.marker), x2: X(cfg.marker), y1: m.t, y2: Ht - m.b, stroke: css("--text"), "stroke-width": 1.5, "stroke-dasharray": "4 3" }, svg);
      el("text", { x: X(cfg.marker) + 4, y: m.t + 10, fill: css("--text") }, svg).textContent = "Now";
    }
    // crosshair + tooltip
    const hl = el("line", { y1: m.t, y2: Ht - m.b, stroke: css("--text-2"), visibility: "hidden" }, svg);
    const dots = cfg.series.map(s => el("circle", { r: 4, fill: s.color, stroke: css("--panel"), "stroke-width": 2, visibility: "hidden" }, svg));
    const hit = el("rect", { x: m.l, y: m.t, width: Wd - m.l - m.r, height: Ht - m.t - m.b, fill: "transparent" }, svg);
    hit.addEventListener("mousemove", ev => {
      const r = svg.getBoundingClientRect(); const x = (ev.clientX - r.left) * (Wd / r.width);
      const h = Math.max(0, Math.min(24, ((x - m.l) / (Wd - m.l - m.r)) * 24));
      hl.setAttribute("x1", X(h)); hl.setAttribute("x2", X(h)); hl.setAttribute("visibility", "visible");
      let html = `<b>${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}</b>`;
      cfg.series.forEach((s, k) => {
        const i = Math.min(s.values.length - 1, Math.round((h / 24) * s.values.length)) % s.values.length;
        dots[k].setAttribute("cx", X(s.hours[i])); dots[k].setAttribute("cy", Y(s.values[i])); dots[k].setAttribute("visibility", "visible");
        html += `<br>${s.name}: ${MR.fmt(s.values[i], cfg.decimals ?? 1)} ${cfg.unit || ""}`;
      });
      showTip(html, ev.clientX, ev.clientY);
    });
    hit.addEventListener("mouseleave", () => { hl.setAttribute("visibility", "hidden"); dots.forEach(d => d.setAttribute("visibility", "hidden")); hideTip(); });
  };

  /* ---------- Horizontal bars ---------- */
  MR.barH = function (host, items, o = {}) {
    host.innerHTML = "";
    const Wd = Math.max(280, host.clientWidth), bh = 26, gap = 10, m = { l: o.labelW || 150, r: 56, t: 4 };
    const Ht = m.t + items.length * (bh + gap);
    const svg = el("svg", { viewBox: `0 0 ${Wd} ${Ht}`, role: "img", "aria-label": o.label || "", class: "ch" }, host);
    const max = o.max || Math.max(...items.map(i => i.value));
    items.forEach((it, k) => {
      const y = m.t + k * (bh + gap), w = Math.max(3, (it.value / max) * (Wd - m.l - m.r));
      el("text", { x: m.l - 10, y: y + bh / 2 + 4, "text-anchor": "end", fill: css("--text"), "font-size": 13, "font-family": "Public Sans" }, svg).textContent = it.label;
      const r = el("rect", { x: m.l, y, width: w, height: bh, rx: 4, fill: it.color || css("--accent") }, svg);
      el("text", { x: m.l + w + 8, y: y + bh / 2 + 5, fill: css("--text"), "font-size": 14, "font-weight": 600 }, svg).textContent = it.text ?? MR.fmt(it.value, 2);
      r.addEventListener("mousemove", ev => showTip(`<b>${it.label}</b><br>${it.tip || it.text || MR.fmt(it.value, 2)}`, ev.clientX, ev.clientY));
      r.addEventListener("mouseleave", hideTip);
    });
  };

  /* ---------- Slope histogram of a route (by class) ---------- */
  MR.slopeClasses = function (pts) {
    const c = [0, 0, 0, 0];
    for (let i = 1; i < pts.length; i++) {
      const dk = pts[i][2] - pts[i - 1][2], s = pts[i][4];
      c[s <= 5 ? 0 : s <= MR.cfg.caution ? 1 : s <= MR.cfg.critSlope ? 2 : 3] += dk;
    }
    return c;
  };
})();
