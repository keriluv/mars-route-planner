/* =========================================================
   api.js — sincronización opcional con el backend Python
   Si la página se sirve con backend/server.py, los hallazgos,
   mensajes y telemetría se guardan en SQLite (relacional) y en el
   almacén de documentos JSON (no relacional). Sin backend, todo
   funciona en modo local.
   ========================================================= */
(function () {
  "use strict";
  const MR = window.MR;
  const API = (MR.API = { online: false, queue: [] });
  const REPORT_KEY = "galex_pending_reports_v1";
  let reports = {};
  let flushingReports = false;
  let checkingConnection = null;
  try {
    const saved = JSON.parse(localStorage.getItem(REPORT_KEY) || "{}");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) reports = saved;
  } catch (_) { /* El estado de persistencia se comprobará al guardar. */ }
  function persistReports() {
    try { localStorage.setItem(REPORT_KEY, JSON.stringify(reports)); return true; }
    catch (_) { return false; }
  }
  API.flushReports = async function () {
    if (!API.online || flushingReports) return;
    flushingReports = true;
    try {
      for (const [id, report] of Object.entries(reports)) {
        try {
          await req("reportes", { method: "POST", body: JSON.stringify(report) });
          if (reports[id] === report) delete reports[id];
          persistReports();
        } catch (_) { /* Conservar hasta una reconexión; el ID hace el reenvío idempotente. */ }
      }
    } finally { flushingReports = false; }
  };

  async function req(path, opts = {}, timeout = 2500) {
    const ctl = new AbortController(); const id = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch("api/" + path, Object.assign({ signal: ctl.signal, headers: { "Content-Type": "application/json" } }, opts));
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally { clearTimeout(id); }
  }
  API.init = async function () {
    if (!/^https?:$/.test(location.protocol)) return false;
    if (checkingConnection) return checkingConnection;
    checkingConnection = (async () => {
      try { const h = await req("health"); API.online = !!(h && h.status === "ok"); } catch (e) { API.online = false; }
      const b = document.getElementById("connBadge");
      if (b) { b.textContent = API.online ? "Backend conectado" : "Modo local"; b.dataset.on = API.online ? "1" : "0"; }
      if (API.online) { await API.flush(); await API.flushReports(); }
      return API.online;
    })();
    try { return await checkingConnection; } finally { checkingConnection = null; }
  };
  // envía; si falla, guarda en cola ("Sin señal: se enviará al reconectar")
  API.send = async function (kind, payload) {
    if (!API.online) return { ok: false, local: true };
    try { await req(kind, { method: "POST", body: JSON.stringify(payload) }); return { ok: true }; }
    catch (e) { API.queue.push([kind, payload]); return { ok: false, queued: true }; }
  };
  API.flush = async function () {
    const q = API.queue.splice(0);
    for (const [k, p] of q) await API.send(k, p);
  };
  API.route = async function (stops, cfg, profile = "all", region = "gale", initial_resources = null) {
    if (!API.online) return null;
    const body = { stops, cfg, profile, region };
    if (initial_resources) body.initial_resources = initial_resources;
    try { return await req("route", { method: "POST", body: JSON.stringify(body) }, 60000); } catch (e) { return null; }
  };
  API.getRegions = async function () {
    if (!API.online) return null;
    try { return await req("regions"); } catch (e) { return null; }
  };
  API.getProfiles = async function () {
    if (!API.online) return null;
    try { return await req("profiles"); } catch (e) { return null; }
  };
  API.getScenario = async function () {
    if (!API.online) return null;
    try { return await req("scenario"); } catch (e) { return null; }
  };
  API.getReportes = async function () {
    if (!API.online) return [];
    try { return await req("reportes"); } catch (e) { return []; }
  };
  API.sendReporte = async function (rep) {
    if (!rep || typeof rep.id !== "string" || !rep.id) return { ok: false, error: "Reporte sin identificador" };
    reports[rep.id] = JSON.parse(JSON.stringify(rep));
    const persisted = persistReports();
    await API.flushReports();
    const pending = Object.prototype.hasOwnProperty.call(reports, rep.id);
    return { ok: !pending, queued: pending, persisted: pending && persisted };
  };
  window.addEventListener("online", () => API.init());
  window.setInterval(() => API.init(), 30000);
})();
