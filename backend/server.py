"""Prototype server — Safe route to Mount Sharp.

Serves the web page (web/ folder) and a small JSON API:

  GET  /api/health                 server status
  GET  /api/targets                fixed targets (document store)
  GET  /api/findings?crew=ev1     findings of an explorer (SQLite)
  GET  /api/logbook?crew=ev1      logbook messages (SQLite)
  GET  /api/telemetry?crew=ev1    telemetry readings (document store)
  POST /api/findings              saves a finding
  POST /api/logbook               saves a message
  POST /api/missions               saves/updates a mission
  POST /api/telemetry             saves a telemetry reading
  POST /api/route                  computes an A* route on the full grid (44 m)
  GET  /api/notices                 notices shared between explorers (SQLite)
  POST /api/notices                 publishes a notice (finding or alert) for the other explorers
  POST /api/notices/withdraw         the author withdraws a notice
  POST /api/notices/received        an explorer confirms receipt of a notice (event only)
  GET  /api/events?type=...       events from the JSONL store (notice_published, notice_received, notice_withdrawn)

MARS_DATA_DIR environment variable: alternative data folder (SQLite + JSONL); useful for tests.

Usage:
  python backend/server.py            -> http://127.0.0.1:8000
  python backend/server.py --port 9000 --host 0.0.0.0

Uses only the Python standard library (+ numpy/scipy for /api/route).
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import sqlite3
import sys
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
DATA = Path(os.environ["MARS_DATA_DIR"]) if os.environ.get("MARS_DATA_DIR") else ROOT / "backend" / "data"
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "src"))

import yaml
from docstore import DocStore  # noqa: E402
from marsroute.storage import Storage  # noqa: E402
from marsroute.domain import Report  # noqa: E402

MAX_BODY = 64 * 1024
CREW = {"ev1", "ev2", "ev3"}
DB_LOCK = threading.Lock()

# ---------------------------------------------------------------- databases
DATA.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA / "mars_route.sqlite"
db = sqlite3.connect(DB_PATH, check_same_thread=False)
db.row_factory = sqlite3.Row
db.executescript((ROOT / "backend" / "schema.sql").read_text(encoding="utf-8"))
docs = DocStore(DATA / "docstore")
storage = Storage(DB_PATH)

# initial load of the document store with the exported data
_obj = WEB / "data" / "targets.json"
if _obj.exists() and not docs.find("targets", limit=1):
    docs.replace_all("targets", json.loads(_obj.read_text(encoding="utf-8")))


# ---------------------------------------------------------------- validation
def _num(v, lo=-1e9, hi=1e9):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise ValueError("invalid number")
    if not (lo <= f <= hi):
        raise ValueError("number out of range")
    return f


def _txt(v, n=200, required=False):
    if v is None or v == "":
        if required:
            raise ValueError("required field is empty")
        return None
    s = re.sub(r"[\x00-\x1f<>]", "", str(v)).strip()[:n]
    if required and not s:
        raise ValueError("required field is empty")
    return s


def _crew(v):
    if v not in CREW:
        raise ValueError("unknown explorer")
    return v


def save_finding(b):
    type = b.get("type")
    if type not in ("mineral", "rock", "other"):
        raise ValueError("invalid finding type")
    row = (_txt(b.get("id"), 40, True), _crew(b.get("crew")), type, _txt(b.get("note"), 140),
           _num(b.get("lon"), 130, 145), _num(b.get("lat"), -10, 0), _num(b.get("elev")),
           _num(b.get("simMin"), 0, 1e7), _num(b.get("km"), 0, 1000), 1 if b.get("photo") else 0)
    with DB_LOCK:
        db.execute("INSERT OR REPLACE INTO finding (id, explorer, type, note, lon, lat, elevation_m, sol_min, km, has_photo)"
                   " VALUES (?,?,?,?,?,?,?,?,?,?)", row)
        db.commit()


def save_message(b):
    sender = {"explorer": "explorer", "earth": "earth", "system": "system"}.get(b.get("from"), "explorer")
    row = (_crew(b.get("crew")), sender, _txt(b.get("text"), 300, True), _txt(b.get("kind"), 20),
           _num(b.get("lon"), 130, 145), _num(b.get("lat"), -10, 0), _num(b.get("t"), 0, 1e7))
    with DB_LOCK:
        db.execute("INSERT INTO message (explorer, sender, text, type, lon, lat, sol_min) VALUES (?,?,?,?,?,?,?)", row)
        db.commit()


def save_mission(b):
    type = b.get("kind") if b.get("kind") in ("primary", "secondary") else "secondary"
    origin = b.get("origin") if b.get("origin") in ("assigned", "own") else None
    row = (_crew(b.get("crew")), type, origin, _txt(b.get("name"), 80, True), _num(b.get("lon"), 130, 145),
           _num(b.get("lat"), -10, 0), _txt(b.get("status"), 20, True), _num(b.get("km"), 0, 1000))
    with DB_LOCK:
        db.execute("INSERT INTO mission (explorer, type, origin, name, lon, lat, status, km) VALUES (?,?,?,?,?,?,?,?)", row)
        db.commit()


def save_telemetry(b):
    wx = b.get("wx") or {}
    doc = {"crew": _crew(b.get("crew")), "t": _num(b.get("t"), 0, 1e7), "km": _num(b.get("km"), 0, 1000),
           "lon": _num(b.get("lon"), 130, 145), "lat": _num(b.get("lat"), -10, 0), "elev": _num(b.get("elev")),
           "weather": {k: _num(wx.get(k)) for k in ("air", "ground", "uv", "rh", "p") if k in wx}}
    if b.get("dose_msv") is not None:  # accumulated EVA dose of the trip (simplified model, mSv)
        doc["dose_msv"] = _num(b.get("dose_msv"), 0, 1e6)
    docs.insert("telemetry", doc)


NOTICE_TYPES = ("finding", "slope_alert", "radiation_alert")


def save_notice(b):
    """Publishes a shared notice. It is idempotent: resending the same id neither duplicates it nor repeats the event."""
    type = b.get("kind")
    if type not in NOTICE_TYPES:
        raise ValueError("invalid notice type")
    row = (_txt(b.get("id"), 60, True), _crew(b.get("author")), type, _txt(b.get("text"), 300, True),
           _num(b.get("lon"), -180, 180), _num(b.get("lat"), -90, 90), _num(b.get("radiusKm"), 0.05, 20) or 0.3,
           _txt(b.get("region"), 20) or "gale", _num(b.get("simMin"), 0, 1e7))
    with DB_LOCK:
        cur = db.execute("INSERT OR IGNORE INTO notice (id, author, type, text, lon, lat, radius_km, region, sol_min)"
                         " VALUES (?,?,?,?,?,?,?,?,?)", row)
        db.commit()
        nuevo = cur.rowcount > 0
    if nuevo:
        docs.insert("events", {"type": "notice_published", "notice_id": row[0], "author": row[1], "kind": type, "lon": row[4], "lat": row[5]})


def withdraw_notice(b):
    aid, author = _txt(b.get("id"), 60, True), _crew(b.get("crew"))
    with DB_LOCK:
        cur = db.execute("UPDATE notice SET status = 'withdrawn' WHERE id = ? AND author = ? AND status = 'active'", (aid, author))
        db.commit()
    if cur.rowcount:
        docs.insert("events", {"type": "notice_withdrawn", "notice_id": aid, "author": author})


def ack_notice(b):
    docs.insert("events", {"type": "notice_received", "notice_id": _txt(b.get("id"), 60, True), "crew": _crew(b.get("crew"))})


def list_notices(region=None):
    sql, args = "SELECT * FROM notice", ()
    if region:
        sql, args = sql + " WHERE region = ?", (region,)
    with DB_LOCK:
        rows = db.execute(sql + " ORDER BY created, rowid LIMIT 500", args).fetchall()
    return [{"id": r["id"], "author": r["author"], "kind": r["type"], "text": r["text"], "lon": r["lon"], "lat": r["lat"],
             "radiusKm": r["radius_km"], "region": r["region"], "simMin": r["sol_min"], "status": r["status"], "created": r["created"]} for r in rows]


# ---------------------------------------------------------------- multi-criteria routes
_planner = {}


def plan_route(b):
    import numpy as np
    import yaml
    from marsroute.layers import load_layers
    from marsroute.multicriteria import MultiCriteriaPlanner

    if "planner_instance" not in _planner:
        cfg = yaml.safe_load((ROOT / "config" / "mission.yaml").read_text(encoding="utf-8"))
        gale_cfg = yaml.safe_load((ROOT / "config" / "regions" / "gale.yaml").read_text(encoding="utf-8"))
        layers = load_layers(ROOT / "data" / "processed" / "layers.npz")
        layers["traversability"] = np.load(ROOT / "outputs" / "traversability.npy")
        planner = MultiCriteriaPlanner(layers, tuple(cfg["bbox"]), cfg["grid_size"])
        _planner.update(cfg=cfg, gale_cfg=gale_cfg, layers=layers, planner_instance=planner)

    planner = _planner["planner_instance"]
    shelters = _planner["gale_cfg"].get("shelters", [])

    stops = b.get("stops") or []
    if not (2 <= len(stops) <= 8):
        raise ValueError("between 2 and 8 points are required")

    start = (float(stops[0][0]), float(stops[0][1]))
    targets = [(float(p[0]), float(p[1])) for p in stops[1:-1]]
    final_dest = (float(stops[-1][0]), float(stops[-1][1]))

    requested_profile = b.get("profile", "safe")
    require_shelter = b.get("require_shelter", True)

    if requested_profile == "all":
        alts = planner.plan_all_alternatives(
            start_lonlat=start,
            target_lonlats=targets,
            final_shelter_lonlat=final_dest,
            shelters_catalog=shelters,
            require_final_shelter=require_shelter,
        )
        first = alts.get("safe") or list(alts.values())[0]
        return {
            "alternatives": {k: v.to_dict() for k, v in alts.items()},
            "route": [[p[0], p[1]] for p in first.points],
            "cells": len(first.points),
        }

    alt = planner.plan_alternative(
        profile_id=requested_profile,
        start_lonlat=start,
        target_lonlats=targets,
        final_shelter_lonlat=final_dest,
        shelters_catalog=shelters,
        require_final_shelter=require_shelter,
    )
    return {
        "route": [[p[0], p[1]] for p in alt.points],
        "cells": len(alt.points),
        "alternative": alt.to_dict(),
        "is_valid": alt.is_valid,
        "rejection_reason": alt.rejection_reason,
    }


# ---------------------------------------------------------------- HTTP
SEC_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "MarsRoute/1.0"

    def log_message(self, fmt, *args):  # compact log
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def _send(self, code, body: bytes, ctype="application/json; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store" if ctype.startswith("application/json") else "max-age=300")
        for k, v in SEC_HEADERS.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8"))

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        url = urlparse(self.path)
        if url.path.startswith("/api/"):
            q = {k: v[0] for k, v in parse_qs(url.query).items()}
            name = url.path[5:]
            try:
                if name == "health":
                    return self._json(200, {"status": "ok", "sqlite": DB_PATH.name, "docstore": "mongodb" if docs.mongo else "jsonl"})
                if name == "targets":
                    return self._json(200, [{k: v for k, v in d.items() if not k.startswith("_")} for d in docs.find("targets")])
                crew = _crew(q.get("crew", "ev1"))
                if name == "findings":
                    rows = db.execute("SELECT * FROM finding WHERE explorer = ? ORDER BY created", (crew,)).fetchall()
                    return self._json(200, [dict(r) for r in rows])
                if name == "logbook":
                    rows = db.execute("SELECT * FROM message WHERE explorer = ? ORDER BY id", (crew,)).fetchall()
                    return self._json(200, [dict(r) for r in rows])
                if name == "telemetry":
                    return self._json(200, docs.find("telemetry", {"crew": crew}, limit=1000))
                if name == "regions":
                    regions = []
                    reg_dir = ROOT / "config" / "regions"
                    if reg_dir.exists():
                        for f in sorted(reg_dir.glob("*.yaml")):
                            regions.append(yaml.safe_load(f.read_text(encoding="utf-8")))
                    return self._json(200, regions)
                if name == "profiles":
                    prof_file = ROOT / "config" / "route_profiles.yaml"
                    return self._json(200, yaml.safe_load(prof_file.read_text(encoding="utf-8")) if prof_file.exists() else {})
                if name == "scenario":
                    scen_file = ROOT / "data" / "simulated" / "demo_scenario.json"
                    return self._json(200, json.loads(scen_file.read_text(encoding="utf-8")) if scen_file.exists() else {})
                if name == "notices":
                    return self._json(200, list_notices(q.get("region")))
                if name == "events":
                    flt = {"type": q["type"]} if q.get("type") else {}
                    return self._json(200, [{k: v for k, v in e.items() if not k.startswith("_")} for e in docs.find("events", flt, limit=500)])
                if name == "reports":
                    reports = storage.list_reports(q.get("author"))
                    return self._json(200, [r.to_dict() for r in reports])
                if name == "proxy/trek":
                    layer = q.get("layer", "")
                    z = q.get("z", "0")
                    r = q.get("r", "0")
                    c = q.get("c", "0")
                    ext = q.get("ext", "jpg")
                    if not re.match(r"^[A-Za-z0-9_-]+$", layer) or not (z.isdigit() and r.isdigit() and c.isdigit()) or ext not in ("jpg", "png"):
                        return self._json(400, {"error": "invalid tile parameters"})
                    cache_dir = DATA / "cache_trek" / layer / z / r
                    cache_dir.mkdir(parents=True, exist_ok=True)
                    cache_file = cache_dir / f"{c}.{ext}"
                    if cache_file.exists():
                        ctype = "image/png" if ext == "png" else "image/jpeg"
                        return self._send(200, cache_file.read_bytes(), ctype)
                    target_url = f"https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/{z}/{r}/{c}.{ext}"
                    try:
                        import urllib.request
                        req = urllib.request.Request(target_url, headers={"User-Agent": "Mozilla/5.0 MarsRoute/1.0"})
                        with urllib.request.urlopen(req, timeout=8) as resp:
                            data = resp.read()
                            cache_file.write_bytes(data)
                            ctype = resp.headers.get("Content-Type") or ("image/png" if ext == "png" else "image/jpeg")
                            return self._send(200, data, ctype)
                    except Exception as exc:
                        return self._json(502, {"error": f"Failed to fetch tile from NASA Trek: {exc}"})
            except ValueError as exc:
                return self._json(400, {"error": str(exc)})
            return self._json(404, {"error": "unknown API route"})
        # static files (web/ or 3dView/ or mars-3d-terrain.html)
        rel = url.path.lstrip("/") or "index.html"
        target = (WEB / rel).resolve()
        if not (WEB.resolve() in target.parents and target.is_file()):
            alt_target = (ROOT / rel).resolve()
            if (rel.startswith("3dView/") or rel == "mars-3d-terrain.html") and ROOT.resolve() in alt_target.parents and alt_target.is_file():
                target = alt_target
            else:
                return self._send(404, b"Not found", "text/plain; charset=utf-8")
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self._send(200, target.read_bytes(), ctype)

    def do_POST(self):
        url = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self._json(413, {"error": "empty or oversized body"})
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            return self._json(415, {"error": "JSON expected"})
        try:
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("a JSON object is expected")
            name = url.path[5:] if url.path.startswith("/api/") else ""
            if name == "reports":
                rep = Report(
                    id=_txt(body.get("id"), 50, True),
                    author=_txt(body.get("author"), 20, True),
                    type=_txt(body.get("type"), 30, True),
                    lon=_num(body.get("lon"), -180, 180),
                    lat=_num(body.get("lat"), -90, 90),
                    elev_m=_num(body.get("elev_m") or body.get("elev"), -20000, 30000) or 0.0,
                    sol_min=_num(body.get("sol_min") or body.get("simMin"), 0, 1e7) or 0.0,
                    km=_num(body.get("km"), 0, 10000) or 0.0,
                    text=_txt(body.get("text"), 1000, True),
                    attachments=body.get("attachments") or {},
                    sync_status=_txt(body.get("sync_status"), 20) or "local",
                )
                storage.save_report(rep)
                return self._json(201, {"ok": True, "id": rep.id})
            if name == "notices/withdraw":
                withdraw_notice(body)
                return self._json(200, {"ok": True})
            if name == "notices/received":
                ack_notice(body)
                return self._json(201, {"ok": True})
            handlers = {"notices": save_notice, "findings": save_finding, "logbook": save_message, "missions": save_mission, "telemetry": save_telemetry}
            if name in handlers:
                handlers[name](body)
                return self._json(201, {"ok": True})
            if name == "route":
                return self._json(200, plan_route(body))
            return self._json(404, {"error": "unknown API route"})
        except (ValueError, json.JSONDecodeError) as exc:
            return self._json(400, {"error": str(exc)})
        except FileNotFoundError:
            return self._json(503, {"error": "processed layers are missing: run scripts/build_layers.py"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    a = ap.parse_args()
    try:  # the Windows console uses cp1252 when output is redirected and the message contains "→"
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    print(f"Safe route to Mount Sharp → http://{a.host}:{a.port}  (Ctrl+C to exit)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
