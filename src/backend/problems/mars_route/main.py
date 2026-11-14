from __future__ import annotations

import json
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
from urllib.parse import urlparse

import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "src"))

from backend.problems.mars_route.evaluate import summarize_route  # noqa: E402
from backend.problems.mars_route.planner import astar, route_lonlat, simplify  # noqa: E402


def lonlat_to_cell(lon: float, lat: float, bbox, size: int) -> tuple[int, int]:
    west, south, east, north = bbox
    column = int((lon - west) / (east - west) * size)
    row = int((north - lat) / (north - south) * size)
    return min(max(row, 0), size - 1), min(max(column, 0), size - 1)


def build_viewer(config, region_bbox, learned, baseline) -> str:
    west, south, east, north = region_bbox
    xstudy, ystudy = config["bbox"][0], -config["bbox"][3]
    study_width = config["bbox"][2] - config["bbox"][0]
    study_height = config["bbox"][3] - config["bbox"][1]
    return f'''<!doctype html>
<html lang="es"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Simulador de rutas - Gale Crater</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; background: #101923; color: #eef4f8; font: 16px/1.45 system-ui, sans-serif; }}
    main {{ max-width: 1100px; margin: 0 auto; padding: 22px; }}
    h1 {{ margin: 0 0 6px; font-size: 1.5rem; }} p {{ color: #c0ced9; }}
    .tools {{ display: flex; align-items: center; gap: 9px; flex-wrap: wrap; margin: 16px 0 12px; }}
    button, select {{ padding: 9px 12px; border-radius: 8px; background: #1c2b39; color: white; border: 1px solid #536a7d; font: inherit; cursor: pointer; }}
    button.active {{ background: #256078; border-color: #67d4ee; }}
    button.primary {{ background: #087e9f; border-color: #51d4f1; }}
    .map {{ overflow: hidden; border: 1px solid #526779; border-radius: 12px; background: #15212a; }}
    svg {{ display: block; width: 100%; height: min(72vh, 760px); cursor: crosshair; touch-action: manipulation; }}
    .route {{ fill: none; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; stroke-width: 4; pointer-events: none; }}
    #study-area {{ fill: none; stroke: #fde047; stroke-width: 2; stroke-dasharray: 8 6; vector-effect: non-scaling-stroke; pointer-events: none; }}
    .marker {{ stroke: #101923; stroke-width: 1.5; vector-effect: non-scaling-stroke; pointer-events: none; }}
    #start-marker {{ fill: #34d399; }} #goal-marker {{ fill: #f0abfc; }}
    .metrics {{ margin-top: 14px; padding: 14px 16px; border-radius: 10px; background: #1a2936; color: #dbe6ee; min-height: 54px; }}
    .credit {{ font-size: .88rem; color: #aebdca; }} #status {{ color: #a5f3fc; }}
  </style>
</head><body><main>
  <h1>Simulador de rutas — Gale Crater</h1>
  <p>Selecciona <b>Inicio</b> o <b>Destino</b> y haz clic dentro del rectángulo amarillo. Después pulsa “Calcular ruta”.</p>
  <div class="tools">
    <button id="pick-start" class="active" type="button">Elegir inicio</button>
    <button id="pick-goal" type="button">Elegir destino</button>
    <button id="calculate" class="primary" type="button">Calcular ruta</button>
    <label for="route-choice">Ver:</label>
    <select id="route-choice">
      <option value="learned">Ruta original del modelo</option>
      <option value="baseline">Referencia: solo pendiente</option>
      <option value="simulation" disabled>Mi simulación</option>
    </select>
  </div>
  <div class="tools"><span id="coordinates"></span><span id="status">Seleccionando inicio.</span></div>
  <div class="map"><svg id="map" viewBox="{west} {-north} {east-west} {north-south}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mapa de Gale Crater; haz clic para colocar inicio o destino">
    <image href="/gale_context.jpg" x="{west}" y="{-north}" width="{east-west}" height="{north-south}" preserveAspectRatio="none" pointer-events="none"></image>
    <rect id="study-area" x="{xstudy}" y="{ystudy}" width="{study_width}" height="{study_height}"></rect>
    <polyline id="route" class="route"></polyline>
    <circle id="start-marker" class="marker" r="0.014"></circle>
    <circle id="goal-marker" class="marker" r="0.017"></circle>
  </svg></div>
  <div class="metrics" id="metrics">Elige los puntos y calcula una ruta para ver sus métricas.</div>
  <p class="credit">Mapa regional de Marte del proyecto. Las capas cartográficas usan datos de <a href="https://trek.nasa.gov/mars/" style="color:#9bd3ff">NASA Mars Trek</a>.</p>
</main>
<script>
const routes = {json.dumps({"learned": learned, "baseline": baseline}, separators=(',', ':'))};
const bounds = {{west:{config['bbox'][0]}, south:{config['bbox'][1]}, east:{config['bbox'][2]}, north:{config['bbox'][3]}}};
const map = document.getElementById('map'), startMarker = document.getElementById('start-marker'), goalMarker = document.getElementById('goal-marker');
const line = document.getElementById('route'), statusText = document.getElementById('status');
const metrics = document.getElementById('metrics'), select = document.getElementById('route-choice');
let activePoint = 'start';
let points = {{start:[{config['start'][0]}, {config['start'][1]}], goal:[{config['goal'][0]}, {config['goal'][1]}]}};
let customRoute = null;
function markPoint(which, lon, lat) {{
  const marker = which === 'start' ? startMarker : goalMarker;
  marker.setAttribute('cx', lon); marker.setAttribute('cy', -lat);
  points[which] = [lon, lat];
  document.getElementById('coordinates').textContent = `Inicio: ${{points.start[0].toFixed(4)}}, ${{points.start[1].toFixed(4)}} · Destino: ${{points.goal[0].toFixed(4)}}, ${{points.goal[1].toFixed(4)}}`;
}}
function setActive(which) {{
  activePoint = which;
  document.getElementById('pick-start').classList.toggle('active', which === 'start');
  document.getElementById('pick-goal').classList.toggle('active', which === 'goal');
  statusText.textContent = `Haz clic en el mapa para colocar el ${{which === 'start' ? 'inicio' : 'destino'}}.`;
}}
function showRoute() {{
  const route = select.value === 'simulation' ? customRoute : routes[select.value];
  if (!route) return;
  line.setAttribute('points', route.route.map(([lon, lat]) => `${{lon}},${{-lat}}`).join(' '));
  line.style.stroke = select.value === 'learned' ? '#ff7b30' : select.value === 'baseline' ? '#d946ef' : '#38bdf8';
  const m = route.metrics;
  metrics.innerHTML = `<strong>${{select.options[select.selectedIndex].text}}</strong><br>Longitud: ${{Number(m.length_km).toFixed(1)}} km · ` +
    `Pendiente media: ${{Number(m.mean_slope_deg).toFixed(1)}}° · Pendiente máxima: ${{Number(m.max_slope_deg).toFixed(1)}}° · ` +
    `Transitabilidad media estimada: ${{Number(m.mean_traversability).toFixed(2)}}`;
}}
document.getElementById('pick-start').addEventListener('click', () => setActive('start'));
document.getElementById('pick-goal').addEventListener('click', () => setActive('goal'));
map.addEventListener('click', event => {{
  const cursor = map.createSVGPoint(); cursor.x = event.clientX; cursor.y = event.clientY;
  const position = cursor.matrixTransform(map.getScreenCTM().inverse());
  const lon = position.x, lat = -position.y;
  if (lon < bounds.west || lon > bounds.east || lat < bounds.south || lat > bounds.north) {{
    statusText.textContent = 'El punto debe quedar dentro del rectángulo amarillo.'; return;
  }}
  markPoint(activePoint, lon, lat);
  customRoute = null;
  select.querySelector('[value="simulation"]').disabled = true;
  if (select.value === 'simulation') select.value = 'learned';
  showRoute();
  statusText.textContent = `${{activePoint === 'start' ? 'Inicio' : 'Destino'}} colocado. Elige el otro punto o calcula la ruta.`;
}});
document.getElementById('calculate').addEventListener('click', async () => {{
  statusText.textContent = 'Calculando ruta...';
  try {{
    const response = await fetch('/api/route', {{method:'POST', headers:{{'Content-Type':'application/json'}}, body:JSON.stringify({{start:points.start, goal:points.goal}})}});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo calcular la ruta.');
    customRoute = data;
    select.querySelector('[value="simulation"]').disabled = false;
    select.value = 'simulation'; showRoute();
    statusText.textContent = 'Ruta calculada y guardada en outputs/simulated_route.json.';
  }} catch (error) {{ statusText.textContent = error.message; }}
}});
select.addEventListener('change', showRoute);
markPoint('start', ...points.start); markPoint('goal', ...points.goal); showRoute();
</script></body></html>'''


def main() -> None:
    config = yaml.safe_load((ROOT / "config" / "mission.yaml").read_text(encoding="utf-8"))
    output_dir = ROOT / "outputs"
    required = (
        output_dir / "route.json", output_dir / "route_baseline.json",
        ROOT / "data" / "processed" / "layers.npz", ROOT / "data" / "processed" / "layers_meta.json",
        output_dir / "traversability.npy", output_dir / "cost.npy", output_dir / "blocked.npy",
        ROOT / "data" / "raw" / "gale_context.jpg", ROOT / "data" / "raw" / "meta.json",
    )
    missing = [path for path in required if not path.exists()]
    if missing:
        files = "\n".join(f"  - {path.relative_to(ROOT)}" for path in missing)
        raise SystemExit(f"Faltan archivos necesarios:\n{files}\nPrimero ejecuta: python scripts\\plan_route.py")

    layers_archive = np.load(ROOT / "data" / "processed" / "layers.npz")
    state = {
        "config": config,
        "bbox": tuple(config["bbox"]),
        "layers": {name: layers_archive[name] for name in layers_archive.files},
        "traversability": np.load(output_dir / "traversability.npy"),
        "cost": np.load(output_dir / "cost.npy"),
        "blocked": np.load(output_dir / "blocked.npy"),
        "layer_meta": json.loads((ROOT / "data" / "processed" / "layers_meta.json").read_text(encoding="utf-8")),
    }
    learned = json.loads((output_dir / "route.json").read_text(encoding="utf-8"))
    baseline = json.loads((output_dir / "route_baseline.json").read_text(encoding="utf-8"))
    raw_meta = json.loads((ROOT / "data" / "raw" / "meta.json").read_text(encoding="utf-8"))
    page = build_viewer(config, raw_meta["region_bbox"], learned, baseline).encode("utf-8")

    class Handler(BaseHTTPRequestHandler):
        def send_bytes(self, content: bytes, content_type: str, status: int = 200):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(content)

        def do_GET(self):
            path = urlparse(self.path).path
            if path == "/":
                self.send_bytes(page, "text/html; charset=utf-8")
            elif path == "/gale_context.jpg":
                self.send_bytes((ROOT / "data" / "raw" / "gale_context.jpg").read_bytes(), "image/jpeg")
            else:
                self.send_error(404)

        def do_POST(self):
            if urlparse(self.path).path != "/api/route":
                self.send_error(404)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length))
                start_coords = tuple(float(v) for v in payload["start"])
                goal_coords = tuple(float(v) for v in payload["goal"])
                west, south, east, north = state["bbox"]
                for label, (lon, lat) in (("inicio", start_coords), ("destino", goal_coords)):
                    if not (west <= lon <= east and south <= lat <= north):
                        raise ValueError(f"El {label} debe estar dentro del rectángulo amarillo del área de estudio.")
                size = int(state["config"]["grid_size"])
                start_cell = lonlat_to_cell(*start_coords, state["bbox"], size)
                goal_cell = lonlat_to_cell(*goal_coords, state["bbox"], size)
                for label, cell in (("inicio", start_cell), ("destino", goal_cell)):
                    if state["blocked"][cell]:
                        raise ValueError(f"El {label} cae en una zona bloqueada. Elige otro punto cercano.")
                planned = astar(state["cost"], state["blocked"], start_cell, goal_cell)
                dense_cells = planned.cells
                route = route_lonlat(simplify(dense_cells), state["bbox"], size)
                metrics = summarize_route(
                    dense_cells, state["layers"], state["traversability"],
                    state["layer_meta"]["dx_m"], state["layer_meta"]["dy_m"],
                    planned.cost, planned.expanded,
                )
                result = {
                    "start": {"lon": start_coords[0], "lat": start_coords[1]},
                    "goal": {"lon": goal_coords[0], "lat": goal_coords[1]},
                    "route": route.tolist(),
                    "cells": simplify(dense_cells).tolist(),
                    "dense_cells": dense_cells.tolist(),
                    "metrics": metrics,
                }
                (output_dir / "simulated_route.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
                response = json.dumps(result).encode("utf-8")
                self.send_bytes(response, "application/json; charset=utf-8")
            except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
                self.send_bytes(json.dumps({"error": str(error)}).encode("utf-8"), "application/json; charset=utf-8", 400)

        def log_message(self, format, *args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 8765), Handler)
    url = "http://127.0.0.1:8765/"
    print(f"Visor interactivo: {url}")
    print("Haz clic en Elegir inicio o Elegir destino, marca ambos puntos y pulsa Calcular ruta.")
    print("Deja esta terminal abierta mientras usas el visor; Ctrl+C detiene el servidor.")
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

