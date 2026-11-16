/* =========================================================
   api.js — optional synchronization with the Python backend
   If the page is served by backend/server.py, findings,
   messages and telemetry are stored in SQLite (relational) and in the
   JSON document store (non-relational). Without a backend, everything
   works in local mode.
   ========================================================= */
(function () {
  "use strict";
  const MR = window.MR;
  const API = (MR.API = { online: false, queue: [] });

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
    try { const h = await req("health"); API.online = h && h.status === "ok"; } catch (e) { API.online = false; }
    const b = document.getElementById("connBadge");
    if (b) { b.textContent = API.online ? "Backend connected" : "Local mode"; b.dataset.on = API.online ? "1" : "0"; }
    if (API.online) API.flush();
    return API.online;
  };
  // sends; if it fails, queues it ("No signal: will be sent on reconnect")
  API.send = async function (kind, payload) {
    if (!API.online) return { ok: false, local: true };
    try { await req(kind, { method: "POST", body: JSON.stringify(payload) }); return { ok: true }; }
    catch (e) { API.queue.push([kind, payload]); return { ok: false, queued: true }; }
  };
  API.flush = async function () {
    const q = API.queue.splice(0);
    for (const [k, p] of q) await API.send(k, p);
  };
  API.route = async function (stops, cfg, profile = "all") {
    if (!API.online) return null;
    try { return await req("route", { method: "POST", body: JSON.stringify({ stops, cfg, profile }) }, 60000); } catch (e) { return null; }
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
    return await API.send("reportes", rep);
  };
  // notices shared between explorers (see shared.js)
  API.sendAviso = n => API.send("avisos", n);
  API.retractAviso = (id, crew) => API.send("avisos/retirar", { id, crew });
  API.ackAviso = (id, crew) => API.send("avisos/recibido", { id, crew });
  API.getAvisos = async function () {
    if (!API.online) return null;
    try { return await req("avisos"); } catch (e) { return null; }
  };
})();
