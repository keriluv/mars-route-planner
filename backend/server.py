"""Servidor del prototipo — Ruta segura a Mount Sharp.

Sirve la página web (carpeta web/) y una API JSON pequeña:

  GET  /api/health                 estado del servidor
  GET  /api/objetivos              objetivos fijos (almacén de documentos)
  GET  /api/hallazgos?crew=ev1     hallazgos de un explorador (SQLite)
  GET  /api/bitacora?crew=ev1      mensajes de la bitácora (SQLite)
  GET  /api/telemetria?crew=ev1    lecturas de telemetría (almacén de documentos)
  POST /api/hallazgos              guarda un hallazgo
  POST /api/bitacora               guarda un mensaje
  POST /api/misiones               guarda/actualiza una misión
  POST /api/telemetria             guarda una lectura de telemetría
  POST /api/route                  calcula una ruta A* en la grilla completa (44 m)

Uso:
  python backend/server.py            -> http://127.0.0.1:8000
  python backend/server.py --port 9000 --host 0.0.0.0

Solo usa la biblioteca estándar de Python (+ numpy/scipy para /api/route).
"""
from __future__ import annotations

import argparse
import json
import mimetypes
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
DATA = ROOT / "backend" / "data"
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "src"))

import yaml
from docstore import DocStore  # noqa: E402
from marsroute.storage import Storage  # noqa: E402
from marsroute.domain import Report, ResourceState  # noqa: E402

MAX_BODY = 64 * 1024
CREW = {"ev1", "ev2", "ev3"}
DB_LOCK = threading.Lock()

# ---------------------------------------------------------------- bases de datos
DATA.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA / "mars_route.sqlite"
db = sqlite3.connect(DB_PATH, check_same_thread=False)
db.row_factory = sqlite3.Row
db.executescript((ROOT / "backend" / "schema.sql").read_text(encoding="utf-8"))
docs = DocStore(DATA / "docstore")
storage = Storage(DB_PATH)

# carga inicial del almacén de documentos con los datos exportados
_obj = WEB / "data" / "objetivos.json"
if _obj.exists() and not docs.find("objetivos", limit=1):
    docs.replace_all("objetivos", json.loads(_obj.read_text(encoding="utf-8")))


# ---------------------------------------------------------------- validación
def _num(v, lo=-1e9, hi=1e9):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise ValueError("número inválido")
    if not (lo <= f <= hi):
        raise ValueError("número fuera de rango")
    return f


def _txt(v, n=200, required=False):
    if v is None or v == "":
        if required:
            raise ValueError("campo obligatorio vacío")
        return None
    s = re.sub(r"[\x00-\x1f<>]", "", str(v)).strip()[:n]
    if required and not s:
        raise ValueError("campo obligatorio vacío")
    return s


def _crew(v):
    if v not in CREW:
        raise ValueError("explorador desconocido")
    return v


def parse_report(body):
    """Valida el reporte antes de intentar guardarlo en SQLite."""
    lon = _num(body.get("lon"), -180, 180)
    lat = _num(body.get("lat"), -90, 90)
    if lon is None or lat is None:
        raise ValueError("coordenadas obligatorias")
    attachments = body.get("attachments", body.get("adjuntos", {}))
    if not isinstance(attachments, dict):
        raise ValueError("adjuntos debe ser un objeto")
    return Report(
        id=_txt(body.get("id"), 50, True),
        author=_crew(body.get("author") or body.get("autor")),
        type=_txt(body.get("type") or body.get("tipo"), 30, True),
        lon=lon, lat=lat,
        elev_m=_num(body.get("elev_m") or body.get("elev"), -20000, 30000) or 0.0,
        sol_min=_num(body.get("sol_min") or body.get("simMin"), 0, 1e7) or 0.0,
        km=_num(body.get("km"), 0, 10000) or 0.0,
        text=_txt(body.get("text") or body.get("texto"), 1000, True),
        attachments=attachments,
        sync_status=_txt(body.get("sync_status"), 20) or "local",
    )


def save_hallazgo(b):
    tipo = b.get("type")
    if tipo not in ("mineral", "roca", "otro"):
        raise ValueError("tipo de hallazgo inválido")
    row = (_txt(b.get("id"), 40, True), _crew(b.get("crew")), tipo, _txt(b.get("note"), 140),
           _num(b.get("lon"), 130, 145), _num(b.get("lat"), -10, 0), _num(b.get("elev")),
           _num(b.get("simMin"), 0, 1e7), _num(b.get("km"), 0, 1000), 1 if b.get("photo") else 0)
    with DB_LOCK:
        db.execute("INSERT OR REPLACE INTO hallazgo (id, explorador, tipo, nota, lon, lat, altura_m, sol_min, km, tiene_foto)"
                   " VALUES (?,?,?,?,?,?,?,?,?,?)", row)
        db.commit()


def save_mensaje(b):
    remitente = {"explorador": "explorador", "tierra": "tierra", "sistema": "sistema"}.get(b.get("from"), "explorador")
    row = (_crew(b.get("crew")), remitente, _txt(b.get("text"), 300, True), _txt(b.get("kind"), 20),
           _num(b.get("lon"), 130, 145), _num(b.get("lat"), -10, 0), _num(b.get("t"), 0, 1e7))
    with DB_LOCK:
        db.execute("INSERT INTO mensaje (explorador, remitente, texto, tipo, lon, lat, sol_min) VALUES (?,?,?,?,?,?,?)", row)
        db.commit()


def save_mision(b):
    tipo = b.get("kind") if b.get("kind") in ("principal", "secundaria") else "secundaria"
    origen = b.get("origin") if b.get("origin") in ("asignada", "propia") else None
    row = (_crew(b.get("crew")), tipo, origen, _txt(b.get("name"), 80, True), _num(b.get("lon"), 130, 145),
           _num(b.get("lat"), -10, 0), _txt(b.get("status"), 20, True), _num(b.get("km"), 0, 1000))
    with DB_LOCK:
        db.execute("INSERT INTO mision (explorador, tipo, origen, nombre, lon, lat, estado, km) VALUES (?,?,?,?,?,?,?,?)", row)
        db.commit()


def save_telemetria(b):
    wx = b.get("wx") or {}
    doc = {"crew": _crew(b.get("crew")), "t": _num(b.get("t"), 0, 1e7), "km": _num(b.get("km"), 0, 1000),
           "lon": _num(b.get("lon"), 130, 145), "lat": _num(b.get("lat"), -10, 0), "elev": _num(b.get("elev")),
           "clima": {k: _num(wx.get(k)) for k in ("air", "ground", "uv", "rh", "p") if k in wx}}
    docs.insert("telemetria", doc)


# ---------------------------------------------------------------- rutas multicriterio
_planner = {}


def parse_initial_resources(value):
    if not isinstance(value, dict):
        raise ValueError("initial_resources debe ser un objeto completo")
    required = {"oxygen_pct": (0, 100), "battery_pct": (0, 100),
                "eva_time_min": (0, 1e9), "radiation_dose_msv": (0, 1e9)}
    optional = {"calories_kcal": (0, 1e9), "metabolic_power_w": (0, 1e9),
                "heart_rate_bpm": (0, 300), "water_liters": (0, 100), "o2_used_g": (0, 1e9)}
    if not set(required).issubset(set(value)):
        raise ValueError("initial_resources requiere oxígeno, batería, tiempo y dosis")
    all_fields = {**required, **optional}
    if not set(value).issubset(set(all_fields)):
        raise ValueError("initial_resources contiene campos desconocidos")
    parsed = {}
    for name, (low, high) in all_fields.items():
        if name in value:
            v = value[name]
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                raise ValueError(f"{name} debe ser un número")
            parsed[name] = _num(v, low, high)
    return ResourceState(**parsed)


def plan_route(b):
    import numpy as np
    import yaml
    from marsroute.layers import load_layers
    from marsroute.multicriteria import MultiCriteriaPlanner

    region = b.get("region", "gale")
    if region != "gale":
        raise ValueError("planificación en esta región no disponible; solo Gale tiene capas verificadas")
    stops = b.get("stops")
    if not isinstance(stops, list) or not 2 <= len(stops) <= 8:
        raise ValueError("se necesitan entre 2 y 8 puntos")
    cfg = yaml.safe_load((ROOT / "config" / "mission.yaml").read_text(encoding="utf-8"))
    west, south, east, north = cfg["bbox"]
    for point in stops:
        if not isinstance(point, (list, tuple)) or len(point) != 2:
            raise ValueError("cada punto debe contener longitud y latitud")
        lon, lat = _num(point[0], west, east), _num(point[1], south, north)
        if lon is None or lat is None:
            raise ValueError("coordenadas obligatorias")
    requested_profile = b.get("profile", "segura")
    if requested_profile not in ("all", "segura", "rapida", "cientifica"):
        raise ValueError("perfil de ruta desconocido")
    initial_resources = parse_initial_resources(b["initial_resources"]) if "initial_resources" in b else None

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
        raise ValueError("se necesitan entre 2 y 8 puntos")

    start = (float(stops[0][0]), float(stops[0][1]))
    targets = [(float(p[0]), float(p[1])) for p in stops[1:-1]]
    final_dest = (float(stops[-1][0]), float(stops[-1][1]))
    adjustments = planner.stop_adjustments([start, *targets, final_dest])

    require_shelter = b.get("require_shelter", True)

    if requested_profile == "all":
        alts = planner.plan_all_alternatives(
            start_lonlat=start,
            target_lonlats=targets,
            final_shelter_lonlat=final_dest,
            shelters_catalog=shelters,
            require_final_shelter=require_shelter,
            initial_resources=initial_resources,
        )
        first = alts.get("segura") or list(alts.values())[0]
        return {
            "alternatives": {k: v.to_dict() for k, v in alts.items()},
            "route": [[p[0], p[1]] for p in first.points],
            "cells": len(first.points),
            "is_valid": first.is_valid,
            "rejection_reason": first.rejection_reason,
            "stop_adjustments": adjustments,
        }

    alt = planner.plan_alternative(
        profile_id=requested_profile,
        start_lonlat=start,
        target_lonlats=targets,
        final_shelter_lonlat=final_dest,
        shelters_catalog=shelters,
        require_final_shelter=require_shelter,
        initial_resources=initial_resources,
    )
    return {
        "route": [[p[0], p[1]] for p in alt.points],
        "cells": len(alt.points),
        "alternative": alt.to_dict(),
        "is_valid": alt.is_valid,
        "rejection_reason": alt.rejection_reason,
        "stop_adjustments": adjustments,
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

    def log_message(self, fmt, *args):  # registro compacto
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
                if name == "objetivos":
                    return self._json(200, [{k: v for k, v in d.items() if not k.startswith("_")} for d in docs.find("objetivos")])
                crew = _crew(q.get("crew", "ev1"))
                if name == "hallazgos":
                    rows = db.execute("SELECT * FROM hallazgo WHERE explorador = ? ORDER BY creado", (crew,)).fetchall()
                    return self._json(200, [dict(r) for r in rows])
                if name == "bitacora":
                    rows = db.execute("SELECT * FROM mensaje WHERE explorador = ? ORDER BY id", (crew,)).fetchall()
                    return self._json(200, [dict(r) for r in rows])
                if name == "telemetria":
                    return self._json(200, docs.find("telemetria", {"crew": crew}, limit=1000))
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
                if name == "reportes":
                    reports = storage.list_reports(q.get("author") or q.get("autor"))
                    return self._json(200, [r.to_dict() for r in reports])
                if name == "proxy/trek":
                    layer = q.get("layer", "")
                    z = q.get("z", "0")
                    r = q.get("r", "0")
                    c = q.get("c", "0")
                    ext = q.get("ext", "jpg")
                    if not re.match(r"^[A-Za-z0-9_-]+$", layer) or not (z.isdigit() and r.isdigit() and c.isdigit()) or ext not in ("jpg", "png"):
                        return self._json(400, {"error": "parámetros de tesela inválidos"})
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
                        return self._json(502, {"error": f"Fallo al obtener tesela de NASA Trek: {exc}"})
            except ValueError as exc:
                return self._json(400, {"error": str(exc)})
            return self._json(404, {"error": "ruta de API desconocida"})
        # archivos estáticos (web/ o 3dView/ o mars-terreno-3d.html)
        rel = url.path.lstrip("/") or "index.html"
        target = (WEB / rel).resolve()
        if not (WEB.resolve() in target.parents and target.is_file()):
            alt_target = (ROOT / rel).resolve()
            if (rel.startswith("3dView/") or rel == "mars-terreno-3d.html") and ROOT.resolve() in alt_target.parents and alt_target.is_file():
                target = alt_target
            else:
                return self._send(404, b"No encontrado", "text/plain; charset=utf-8")
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self._send(200, target.read_bytes(), ctype)

    def do_POST(self):
        url = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self._json(413, {"error": "cuerpo vacío o demasiado grande"})
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            return self._json(415, {"error": "se espera JSON"})
        try:
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("se espera un objeto JSON")
            name = url.path[5:] if url.path.startswith("/api/") else ""
            if name == "reportes":
                rep = parse_report(body)
                storage.save_report(rep)
                return self._json(201, {"ok": True, "id": rep.id})
            handlers = {"hallazgos": save_hallazgo, "bitacora": save_mensaje, "misiones": save_mision, "telemetria": save_telemetria}
            if name in handlers:
                handlers[name](body)
                return self._json(201, {"ok": True})
            if name == "route":
                return self._json(200, plan_route(body))
            return self._json(404, {"error": "ruta de API desconocida"})
        except (ValueError, json.JSONDecodeError) as exc:
            return self._json(400, {"error": str(exc)})
        except FileNotFoundError:
            return self._json(503, {"error": "faltan capas procesadas: ejecuta scripts/build_layers.py"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    a = ap.parse_args()
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    print(f"Ruta segura a Mount Sharp → http://{a.host}:{a.port}  (Ctrl+C para salir)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
