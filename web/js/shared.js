/* =========================================================
   shared.js — notices shared between explorers
   A finding or alert recorded by one explorer reaches the others as a notice
   (zone on the map + message in their logbook). Each one continues their own separate trip:
   the notice does not change their route or their clock.

   Where the notices live:
     · localStorage ("mr_shared"): always. Without a server, two tabs of the same browser
       notify each other through the "storage" event.
     · Backend (SQLite aviso table + events in JSONL): if the page is served by backend/server.py,
       it syncs every few seconds, so other browsers receive them too.
   ========================================================= */
(function () {
  "use strict";
  const MR = window.MR, KEY = "shared", MAX = 300, POLL_MS = 4000;
  const S = (MR.Shared = { list: [], subs: [] });

  // radiusKm only sizes the zone drawn on the map (visual aid); it is not a measured safety distance
  S.kinds = {
    hallazgo: { label: "Finding", radiusKm: 0.5, icon: "hallazgo" },
    alerta_pendiente: { label: "Slope alert", radiusKm: 0.8, icon: "warn" },
    alerta_radiacion: { label: "Radiation alert", radiusKm: 1.5, icon: "warn" },
  };
  let seq = 1;
  const newId = () => "av_" + Date.now().toString(36) + (seq++) + Math.random().toString(36).slice(2, 6);
  const valid = n => n && typeof n.id === "string" && S.kinds[n.kind] && typeof n.author === "string" && isFinite(n.lon) && isFinite(n.lat);

  // adds notices to the list (without duplicating by id); returns what is new and what changed
  function absorb(items) {
    const added = [], changed = [];
    (items || []).forEach(n => {
      if (!valid(n)) return;
      const cur = S.list.find(x => x.id === n.id);
      if (!cur) { const c = Object.assign({ estado: "activo" }, n); S.list.push(c); added.push(c); }
      else if (cur.estado !== "retirado" && n.estado === "retirado") { cur.estado = "retirado"; changed.push(cur); }
    });
    if (S.list.length > MAX) S.list = S.list.slice(-MAX);
    return { added, changed };
  }
  function notify(res, silent) {
    if (!res.added.length && !res.changed.length) return;
    S.subs.forEach(fn => { try { fn(res, !!silent); } catch (e) { /* a broken subscriber does not stop the others */ } });
  }
  // reads what other tabs saved before writing, so as not to overwrite it
  function persist() {
    const res = absorb(MR.store.get(KEY, []));
    MR.store.set(KEY, S.list);
    return res;
  }
  S.onChange = fn => { S.subs.push(fn); };

  // initial load (silent: does not repeat banners of old notices)
  S.load = function () { const res = absorb(MR.store.get(KEY, [])); notify(res, true); };

  S.publish = function ({ kind, author, lon, lat, text, simMin, region }) {
    const n = { id: newId(), author, kind, text: MR.clean(text, 280), lon, lat, radiusKm: S.kinds[kind].radiusKm, region: region || "gale",
      simMin, estado: "activo", creado: new Date().toISOString() };
    const mine = absorb([n]); const other = persist();
    notify({ added: mine.added.concat(other.added), changed: other.changed });
    MR.API.sendAviso(n);
    return n;
  };
  S.retract = function (id, crew) {
    const n = S.list.find(x => x.id === id); if (!n || n.author !== crew || n.estado === "retirado") return;
    n.estado = "retirado"; persist(); notify({ added: [], changed: [n] });
    MR.API.retractAviso(id, crew);
  };
  S.ack = (id, crew) => MR.API.ackAviso(id, crew);

  // notices from other explorers visible to `crewId` in the given region
  S.visibleFor = (crewId, region) => S.list.filter(n => n.estado === "activo" && n.author !== crewId && (n.region || "gale") === region);

  // syncs with the backend: fetches what others sent and uploads what was left unsent (the server ignores duplicates)
  S.sync = async function () {
    const remote = await MR.API.getAvisos(); if (!remote) return;
    const ids = new Set(remote.map(r => r.id));
    const res = absorb(remote.map(r => Object.assign({}, r, { estado: r.estado })));
    const other = persist(); notify({ added: res.added.concat(other.added), changed: res.changed.concat(other.changed) });
    S.list.filter(n => !ids.has(n.id) && n.estado === "activo").forEach(n => MR.API.sendAviso(n));
  };
  S.startPolling = function () { if (S.timer) return; S.sync(); S.timer = setInterval(S.sync, POLL_MS); };

  // another tab of the same browser wrote notices (also works over file://)
  window.addEventListener("storage", e => {
    if (e.key !== "mr_" + KEY || !e.newValue) return;
    try { const res = absorb(JSON.parse(e.newValue)); notify(res); } catch (err) { /* corrupted value: ignored */ }
  });
})();
