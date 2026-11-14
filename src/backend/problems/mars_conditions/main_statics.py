"""Generate and serve a separate local dashboard for Mars weather and surface data."""

from __future__ import annotations

import json
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "src"))

from backend.problems.mars_conditions.analysis import analyze_datasets  # noqa: E402


PAGE_TEMPLATE = r'''<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Estadísticas marcianas — Gale Crater</title>
<style>
:root { color-scheme: dark; --bg:#0c1622; --panel:#142333; --line:#30485d; --text:#edf4f8; --muted:#adc0cf; --cyan:#54d4e9; --orange:#fb9a55; --green:#51d49b; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 system-ui,sans-serif; }
main { max-width:1450px; margin:0 auto; padding:26px; }
h1 { margin:0; font-size:1.8rem; } h2 { margin:0 0 10px; font-size:1.2rem; }
.subtitle { color:var(--muted); margin:4px 0 22px; }
.section { margin:26px 0 12px; }
.cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:12px; }
.card { padding:16px; background:var(--panel); border:1px solid var(--line); border-radius:12px; }
.label { display:block; color:var(--muted); font-size:.9rem; }
.value { display:block; font-size:1.55rem; font-weight:650; margin-top:3px; }
.context { display:block; color:var(--muted); font-size:.85rem; margin-top:3px; }
.chart-panel { padding:18px; border:1px solid var(--line); border-radius:12px; background:var(--panel); margin:12px 0; }
.controls { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:8px 0 12px; }
select { min-height:42px; padding:8px 12px; border:1px solid var(--line); border-radius:8px; background:#0e1b29; color:var(--text); font:inherit; }
svg { display:block; width:100%; height:auto; overflow:visible; }
.legend { display:flex; gap:18px; color:var(--muted); flex-wrap:wrap; }
.legend span::before { content:""; display:inline-block; width:16px; height:3px; vertical-align:middle; margin-right:7px; background:var(--swatch); }
.table-wrap { overflow:auto; }
table { width:100%; border-collapse:collapse; min-width:650px; }
th,td { padding:9px 11px; text-align:left; border-bottom:1px solid var(--line); }
th { color:var(--muted); font-weight:550; }
.finding { padding:9px 0; border-bottom:1px solid var(--line); }
.note { color:var(--muted); font-size:.9rem; }
.tag { display:inline-block; padding:3px 8px; border-radius:999px; background:#1b3e4f; color:#9eeafa; font-size:.82rem; }
@media(max-width:650px) { main { padding:16px; } h1 { font-size:1.45rem; } }
</style></head><body><main>
<h1>Condiciones meteorológicas y superficiales de Marte</h1>
<p class="subtitle">Gale Crater — análisis descriptivo de REMS (soles 100 y 4500) y capas de terreno de 44 m.</p>
<div id="overview" class="cards" aria-label="Resumen del conjunto de datos"></div>
<h2 class="section">Meteorología REMS</h2>
<section class="chart-panel">
  <div class="controls"><label for="weather-variable">Variable:</label><select id="weather-variable"></select></div>
  <div class="legend"><span style="--swatch:var(--cyan)">Sol 100</span><span style="--swatch:var(--orange)">Sol 4500</span></div>
  <svg id="weather-chart" viewBox="0 0 960 360" role="img" aria-label="Promedio horario REMS para los soles 100 y 4500"></svg>
  <div class="table-wrap"><table id="weather-table"></table></div>
</section>
<h2 class="section">Superficie de Gale Crater</h2>
<section class="chart-panel">
  <div class="controls"><label for="surface-variable">Capa:</label><select id="surface-variable"></select><span id="surface-unit" class="tag"></span></div>
  <svg id="surface-chart" viewBox="0 0 960 340" role="img" aria-label="Distribución de valores de la capa superficial seleccionada"></svg>
  <div class="table-wrap"><table id="surface-table"></table></div>
</section>
<h2 class="section">Hallazgos del conjunto</h2><div id="findings" class="chart-panel"></div>
<h2 class="section">Alcance y limitaciones</h2><div id="limits" class="chart-panel"></div>
<p class="note">Fuentes: NASA PDS REMS; capas de Gale descritas en <code>data/processed/layers_meta.json</code> (MOLA/HRSC, THEMIS, CRISM/OMEGA y recorrido Curiosity).</p>
</main><script>
const DATA = __DATA__;
const weatherSelect = document.getElementById('weather-variable');
const surfaceSelect = document.getElementById('surface-variable');
const fmt = (v, digits=1) => v == null || !Number.isFinite(Number(v)) ? 'Sin dato' : Number(v).toFixed(digits);
for (const [key, meta] of Object.entries(DATA.weather_variables)) weatherSelect.add(new Option(`${meta.label} (${meta.unit})`, key));
for (const [key, meta] of Object.entries(DATA.surface.metrics)) surfaceSelect.add(new Option(`${meta.label} (${meta.unit})`, key));
const sol100 = DATA.weather_sols['100'], sol4500 = DATA.weather_sols['4500'];
const surface = DATA.surface;
const overview = [
  ['Temperatura media · sol 100', `${fmt(sol100.BOOM1_AIR_TEMP.mean)} K`, `${sol100.records.toLocaleString()} registros REMS`],
  ['Temperatura media · sol 4500', `${fmt(sol4500.BOOM1_AIR_TEMP.mean)} K`, `${sol4500.records.toLocaleString()} registros REMS`],
  ['Pendiente p95', `${fmt(surface.metrics.slope.p95)}°`, `${fmt(surface.slope_over_20_pct)}% del área supera 20°`],
  ['Área con CRISM', `${fmt(surface.crism_covered_pct)}%`, `${surface.grid_size[0]} × ${surface.grid_size[1]} celdas; ${fmt(surface.valid_area_pct)}% válidas`],
];
document.getElementById('overview').innerHTML = overview.map(([label,value,context]) => `<div class="card"><span class="label">${label}</span><span class="value">${value}</span><span class="context">${context}</span></div>`).join('');
function drawWeather() {
  const key = weatherSelect.value, meta = DATA.weather_variables[key];
  const groups = [['100',sol100,'#54d4e9'],['4500',sol4500,'#fb9a55']];
  const values = groups.flatMap(([,s]) => s.hourly[key].mean.filter(v => v != null));
  if (!values.length) return;
  let min = Math.min(...values), max = Math.max(...values); if (min === max) { min -= 1; max += 1; }
  const pad = (max-min)*.1; min -= pad; max += pad;
  const W=960,H=360,L=72,R=24,T=22,B=54, iw=W-L-R, ih=H-T-B;
  const x=h => L + (h/23)*iw, y=v => T + (max-v)/(max-min)*ih;
  let svg = `<text x="${L}" y="16" fill="#adc0cf" font-size="12">${meta.label} (${meta.unit}) — promedio por hora solar local</text>`;
  for (let i=0;i<=4;i++) { const val=min+(max-min)*i/4, yy=y(val); svg += `<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="#30485d"/><text x="${L-10}" y="${yy+4}" text-anchor="end" fill="#adc0cf" font-size="12">${fmt(val,1)}</text>`; }
  for (let h=0;h<=24;h+=6) { const xx=x(Math.min(h,23)); svg += `<line x1="${xx}" y1="${T}" x2="${xx}" y2="${H-B}" stroke="#23394b"/><text x="${xx}" y="${H-22}" text-anchor="middle" fill="#adc0cf" font-size="12">${h}:00</text>`; }
  for (const [sol,s,color] of groups) {
    let segment=[];
    const flush=()=>{ if(segment.length>1) svg += `<polyline fill="none" stroke="${color}" stroke-width="2.5" points="${segment.join(' ')}"/>`; segment=[]; };
    s.hourly[key].mean.forEach((v,h)=> { if(v==null) {flush();return;} const px=x(h),py=y(v); segment.push(`${px},${py}`); svg += `<circle cx="${px}" cy="${py}" r="3.5" fill="${color}"/>`; }); flush();
  }
  svg += `<text x="${W/2}" y="${H-2}" text-anchor="middle" fill="#adc0cf" font-size="13">Hora solar local (LMST)</text>`;
  const chart=document.getElementById('weather-chart'); chart.innerHTML=svg;
  document.getElementById('weather-table').innerHTML = `<thead><tr><th>Sol</th><th>Válidos / registros</th><th>Media</th><th>Mediana</th><th>Mínimo</th><th>Máximo</th><th>Faltantes</th></tr></thead><tbody>` + groups.map(([sol,s])=> {const m=s[key], missing=100*(s.records-m.count)/s.records;return `<tr><td>${sol}</td><td>${m.count.toLocaleString()} / ${s.records.toLocaleString()}</td><td>${fmt(m.mean,2)} ${meta.unit}</td><td>${fmt(m.median,2)} ${meta.unit}</td><td>${fmt(m.min,2)}</td><td>${fmt(m.max,2)}</td><td>${fmt(missing,1)}%</td></tr>`;}).join('') + '</tbody>';
}
function drawSurface() {
  const key=surfaceSelect.value, m=surface.metrics[key], hist=m.histogram, edges=hist.edges, counts=hist.counts;
  document.getElementById('surface-unit').textContent=m.unit;
  const W=960,H=340,L=70,R=22,T=25,B=62,iw=W-L-R,ih=H-T-B,maxCount=Math.max(...counts,1);
  let svg=`<text x="${L}" y="16" fill="#adc0cf" font-size="12">${m.label} — distribución de celdas válidas</text>`;
  for(let i=0;i<=4;i++){const val=maxCount*i/4, yy=T+ih-(val/maxCount)*ih;svg+=`<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="#30485d"/><text x="${L-10}" y="${yy+4}" text-anchor="end" fill="#adc0cf" font-size="12">${Math.round(val)}</text>`;}
  const bw=iw/counts.length;
  counts.forEach((count,i)=>{const barH=count/maxCount*ih,xx=L+i*bw;svg+=`<rect x="${xx+1}" y="${T+ih-barH}" width="${Math.max(1,bw-2)}" height="${barH}" fill="#54d4e9" opacity=".8"><title>${fmt(edges[i],2)}–${fmt(edges[i+1],2)} ${m.unit}: ${count.toLocaleString()} celdas</title></rect>`;});
  const medX=L+(m.median-edges[0])/(edges[edges.length-1]-edges[0])*iw;
  svg+=`<line x1="${medX}" y1="${T}" x2="${medX}" y2="${T+ih}" stroke="#fb9a55" stroke-width="2" stroke-dasharray="6 4"/><text x="${Math.min(medX+6,W-120)}" y="${T+14}" fill="#fb9a55" font-size="12">Mediana ${fmt(m.median,2)}</text>`;
  svg+=`<text x="${L}" y="${H-18}" fill="#adc0cf" font-size="12">${fmt(edges[0],2)} ${m.unit}</text><text x="${W-R}" y="${H-18}" text-anchor="end" fill="#adc0cf" font-size="12">${fmt(edges[edges.length-1],2)} ${m.unit}</text>`;
  const chart=document.getElementById('surface-chart');chart.innerHTML=svg; chart.setAttribute('aria-label',`Histograma de ${m.label}`);
  document.getElementById('surface-table').innerHTML=`<thead><tr><th>Celdas</th><th>Media</th><th>Mediana</th><th>P05</th><th>P25</th><th>P75</th><th>P95</th><th>Mínimo</th><th>Máximo</th></tr></thead><tbody><tr><td>${m.count.toLocaleString()}</td><td>${fmt(m.mean,2)} ${m.unit}</td><td>${fmt(m.median,2)} ${m.unit}</td><td>${fmt(m.p05,2)}</td><td>${fmt(m.p25,2)}</td><td>${fmt(m.p75,2)}</td><td>${fmt(m.p95,2)}</td><td>${fmt(m.min,2)}</td><td>${fmt(m.max,2)}</td></tr></tbody>`;
}
document.getElementById('findings').innerHTML=DATA.findings.map(x=>`<div class="finding">${x}</div>`).join('');
document.getElementById('limits').innerHTML=DATA.limits.map(x=>`<div class="finding">${x}</div>`).join('');
weatherSelect.addEventListener('change',drawWeather); surfaceSelect.addEventListener('change',drawSurface);
drawWeather(); drawSurface();
</script></body></html>'''


def main() -> None:
    data_dir = ROOT / "data"
    required = [
        data_dir / "processed" / "layers.npz",
        data_dir / "processed" / "layers_meta.json",
        data_dir / "processed" / "rems_sol00100.csv",
        data_dir / "processed" / "rems_sol04500.csv",
    ]
    missing = [path for path in required if not path.exists()]
    if missing:
        expected = "\n".join(f"  - {path.relative_to(ROOT)}" for path in missing)
        raise SystemExit(f"Faltan datos para el análisis:\n{expected}\nEjecuta primero la preparación de capas/REMS.")

    summary = analyze_datasets(data_dir)
    summary_path = ROOT / "outputs" / "conditions_summary.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    page = PAGE_TEMPLATE.replace("__DATA__", json.dumps(summary, separators=(",", ":"), ensure_ascii=False))
    page_bytes = page.encode("utf-8")
    page_path = ROOT / "outputs" / "mars_conditions_dashboard.html"
    page_path.write_text(page, encoding="utf-8")

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.split("?", 1)[0] != "/":
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(page_bytes)))
            self.end_headers()
            self.wfile.write(page_bytes)

        def log_message(self, format, *args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 8766), Handler)
    url = "http://127.0.0.1:8766/"
    print(f"Análisis guardado en {summary_path.relative_to(ROOT)}")
    print(f"Página local: {url}")
    print("Mantén esta terminal abierta mientras consultas el panel. Ctrl+C lo detiene.")
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
