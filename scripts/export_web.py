"""Exports the layers, routes, targets and REMS data to JSON for the web frontend.

Generates:
  web/data/mars_data.js        -> window.MARS_DATA (loaded by index.html, works without a server)
  web/data/*.json              -> the same data as JSON (used by the backend / NoSQL)
  web/assets/basemap_*.jpg     -> base maps (Mars relief, MOLA/HRSC color, THEMIS thermal)
"""
from __future__ import annotations

import base64
import io
import json
import sys
from pathlib import Path

import numpy as np
import yaml
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from marsroute.layers import load_layers  # noqa: E402
from marsroute.model import load_model, predict_traversability  # noqa: E402
from marsroute.planner import astar, build_cost_surface, simplify  # noqa: E402

WEB = ROOT / "web"
GRID = 300  # resolution exported for the browser (≈177 m per cell)


def block_mean(a: np.ndarray, n: int) -> np.ndarray:
    f = a.shape[0] // n
    return a[: n * f, : n * f].reshape(n, f, n, f).mean(axis=(1, 3))


def b64(arr: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode("ascii")


def q8(a, lo, hi):
    return np.clip(np.round((a - lo) / (hi - lo) * 255), 0, 255).astype("uint8")


def jpeg(img: Image.Image, path: Path, q=86):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "JPEG", quality=q, optimize=True, progressive=True)


def mars_basemap(dem: np.ndarray, dx: float, dy: float) -> Image.Image:
    """Shaded relief with a Martian color ramp (reddish → ochre → cream)."""
    z = np.nan_to_num(dem, nan=float(np.nanmedian(dem)))
    gy, gx = np.gradient(z, dy, dx)
    slope = np.arctan(np.hypot(gx, gy) * 2.2)
    aspect = np.arctan2(-gx, gy)
    az, alt = np.deg2rad(315), np.deg2rad(40)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    shade = np.clip(shade, 0, 1)
    t = (z - z.min()) / (z.max() - z.min())
    stops = np.array([
        [0.00, 112, 52, 32], [0.25, 150, 74, 42], [0.50, 186, 108, 64],
        [0.75, 208, 150, 104], [1.00, 238, 214, 182]])
    rgb = np.stack([np.interp(t, stops[:, 0], stops[:, i]) for i in (1, 2, 3)], axis=-1)
    light = 0.35 + 0.85 * shade[..., None]
    out = np.clip(rgb * light, 0, 255).astype("uint8")
    return Image.fromarray(out)


def rems_profile(csv_path: Path) -> dict:
    import csv
    bins = 96
    acc = {k: [[] for _ in range(bins)] for k in ("air", "ground", "uv", "rh", "p")}
    with open(csv_path, newline="") as fh:
        for row in csv.DictReader(fh):
            try:
                hh, mm, ss = row["LTST"].split(" ")[1].split(":")
                h = int(hh) + int(mm) / 60 + float(ss) / 3600
            except Exception:
                continue
            b = min(int(h / 24 * bins), bins - 1)
            for key, col in (("air", "BOOM1_AIR_TEMP"), ("ground", "BRIGHTNESS_TEMP_A"),
                             ("uv", "UV_ABC"), ("rh", "HUMIDITY_CHANNEL_A"),
                             ("p", "BAROCAP_PRESSURE_1")):
                try:
                    v = float(row[col])
                except (TypeError, ValueError):
                    continue
                if np.isfinite(v):
                    acc[key][b].append(v)

    def series(key, conv=lambda v: v, nd=2):
        out = []
        for values in acc[key]:
            out.append(round(conv(float(np.median(values))), nd) if values else None)
        # fill gaps by circular linear interpolation
        arr = np.array([np.nan if v is None else v for v in out], dtype=float)
        if np.isnan(arr).any() and (~np.isnan(arr)).sum() > 2:
            idx = np.arange(bins)
            good = ~np.isnan(arr)
            arr = np.interp(idx, idx[good], arr[good], period=bins)
        return [round(float(v), nd) for v in arr]

    return {
        "hours": [round(i * 24 / bins, 3) for i in range(bins)],
        "air_c": series("air", lambda k: k - 273.15, 1),
        "ground_c": series("ground", lambda k: k - 273.15, 1),
        "uv_w_m2": series("uv", nd=2),
        "rh_pct": series("rh", nd=1),
        "pressure_pa": series("p", nd=1),
    }


def lonlat_to_cell(lon, lat, bbox, size):
    w, s, e, n = bbox
    c = int((lon - w) / (e - w) * size)
    r = int((n - lat) / (n - s) * size)
    return min(max(r, 0), size - 1), min(max(c, 0), size - 1)


def nearest_free(cell, blocked):
    if not blocked[cell]:
        return cell
    _, idx = ndimage.distance_transform_edt(blocked, return_indices=True)
    return int(idx[0][cell]), int(idx[1][cell])


def route_profile(cells, layers, trav, bbox, size, dx, dy):
    w, s, e, n = bbox
    cells = np.asarray(cells)
    r, c = cells[:, 0], cells[:, 1]
    lon = w + (c + 0.5) / size * (e - w)
    lat = n - (r + 0.5) / size * (n - s)
    step = np.hypot(np.diff(r) * dy, np.diff(c) * dx)
    km = np.concatenate([[0], np.cumsum(step)]) / 1000
    pts = []
    for i in range(len(cells)):
        pts.append([round(float(lon[i]), 5), round(float(lat[i]), 5), round(float(km[i]), 3),
                    round(float(layers["dem"][r[i], c[i]]), 1),
                    round(float(layers["slope"][r[i], c[i]]), 2),
                    round(float(layers["roughness"][r[i], c[i]]), 2),
                    round(float(trav[r[i], c[i]]), 3)])
    return pts


def main():
    cfg = yaml.safe_load((ROOT / "config/mission.yaml").read_text(encoding="utf-8"))
    meta = json.loads((ROOT / "data/processed/layers_meta.json").read_text(encoding="utf-8"))
    bbox = cfg["bbox"]
    size = cfg["grid_size"]
    L = load_layers(ROOT / "data/processed/layers.npz")
    tpath = ROOT / "outputs/traversability.npy"
    trav = np.load(tpath) if tpath.exists() else predict_traversability(load_model(ROOT / "models"), L)
    dx, dy = meta["dx_m"], meta["dy_m"]

    (WEB / "data").mkdir(parents=True, exist_ok=True)

    # ---------- base maps ----------
    jpeg(mars_basemap(L["dem"], dx, dy), WEB / "assets/basemap_relief.jpg")
    jpeg(Image.open(ROOT / "data/raw/gale_optical.jpg").convert("RGB"), WEB / "assets/basemap_color.jpg")
    th = Image.open(ROOT / "data/raw/gale_themis_ir.png").convert("L").resize((1200, 1200), Image.BICUBIC)
    jpeg(th.convert("RGB"), WEB / "assets/basemap_thermal.jpg")

    # ---------- layers on a reduced grid ----------
    pc = predict_cost = None  # noqa
    planner = dict(cfg["planner"])
    cost, blocked = build_cost_surface(trav, L["slope"], **planner)
    dem_s = block_mean(L["dem"], GRID)
    dem_lo, dem_hi = float(dem_s.min()), float(dem_s.max())
    dem_q = np.round((dem_s - dem_lo) / (dem_hi - dem_lo) * 65535).astype("<u2")
    slope_s = block_mean(L["slope"], GRID)
    rough_s = block_mean(L["roughness"], GRID)
    trav_s = block_mean(trav, GRID)
    therm_s = block_mean(L["thermal"], GRID)
    ci_s = block_mean(L["color_index"], GRID)
    spec_s = block_mean(L["spectral_coverage"], GRID)
    trd_s = block_mean(L["traverse_distance"], GRID)
    blocked_s = block_mean(blocked.astype("float32"), GRID)
    ci_lo, ci_hi = float(np.percentile(ci_s, 1)), float(np.percentile(ci_s, 99))
    layers = {
        "grid": GRID,
        "dem": {"b64": b64(dem_q), "dtype": "u16", "min": dem_lo, "max": dem_hi, "unit": "m"},
        "slope": {"b64": b64(q8(slope_s, 0, 40)), "dtype": "u8", "min": 0, "max": 40, "unit": "°"},
        "roughness": {"b64": b64(q8(rough_s, 0, 60)), "dtype": "u8", "min": 0, "max": 60, "unit": "m"},
        "traversability": {"b64": b64(q8(trav_s, 0, 1)), "dtype": "u8", "min": 0, "max": 1, "unit": "p"},
        "thermal": {"b64": b64(q8(therm_s, 0, 255)), "dtype": "u8", "min": 0, "max": 255, "unit": "DN"},
        "color_index": {"b64": b64(q8(ci_s, ci_lo, ci_hi)), "dtype": "u8", "min": ci_lo, "max": ci_hi, "unit": "index"},
        "spectral": {"b64": b64(q8(spec_s, 0, 1)), "dtype": "u8", "min": 0, "max": 1, "unit": "coverage"},
        "traverse_km": {"b64": b64(q8(trd_s, 0, 40)), "dtype": "u8", "min": 0, "max": 40, "unit": "km"},
        "blocked": {"b64": b64(q8(blocked_s, 0, 1)), "dtype": "u8", "min": 0, "max": 1, "unit": "fraction"},
    }

    # ---------- routes ----------
    learned = json.loads((ROOT / "outputs/route.json").read_text(encoding="utf-8"))
    baseline = json.loads((ROOT / "outputs/route_baseline.json").read_text(encoding="utf-8"))
    start = tuple(learned["start"]["cell"])

    def plan(goal_lonlat, name):
        goal = nearest_free(lonlat_to_cell(*goal_lonlat, bbox, size), blocked)
        print("A*", name, start, "->", goal)
        rt = astar(cost, blocked, start, goal)
        return rt.cells.tolist()

    routes = {
        "summit": {"name": "Mount Sharp summit", "model": "learned (random forest + A*)",
                   "points": route_profile(learned["dense_cells"], L, trav, bbox, size, dx, dy),
                   "waypoints": learned["route"], "metrics": {k: v for k, v in learned["metrics"].items() if k != "ablation"}},
        "summit_short": {"name": "Short route (slope only)", "model": "slope-only baseline",
                         "points": route_profile(baseline["cells"], L, trav, bbox, size, dx, dy),
                         "waypoints": baseline["route"], "metrics": baseline["metrics"]},
    }
    extra_goals = {
        "crism": ([137.4545, -5.187], "CRISM spectral footprint (west flank)"),
        "traverse_end": ([137.3799, -4.7247], "Last point of the Curiosity traverse"),
    }
    cache = ROOT / "outputs/extra_routes.json"
    cached = json.loads(cache.read_text()) if cache.exists() else {}
    for key, (ll, name) in extra_goals.items():
        cells = cached.get(key) or plan(ll, name)
        cached[key] = cells
        routes[key] = {"name": name, "model": "learned (random forest + A*)",
                       "points": route_profile(cells, L, trav, bbox, size, dx, dy),
                       "waypoints": [], "metrics": {}}
    cache.write_text(json.dumps(cached))

    # ---------- targets (fixed, derived from the data) ----------
    minerals = json.loads((ROOT / "data/raw/hydrous_minerals.json").read_text())
    crism = json.loads((ROOT / "data/raw/crism_sites.json").read_text())
    targets = [
        {"id": "bradbury", "name": "Bradbury Landing", "type": "base", "lon": cfg["start"][0], "lat": cfg["start"][1],
         "source": "config/mission.yaml", "note": "Curiosity landing site (2012). Starting base."},
        {"id": "summit", "name": "Mount Sharp summit", "type": "goal", "lon": cfg["goal"][0], "lat": cfg["goal"][1],
         "source": "DEM MOLA/HRSC 200 m", "note": "Highest point of the area (+830 m)."},
        {"id": "traverse_end", "name": "End of the Curiosity traverse", "type": "reference",
         "lon": 137.3799, "lat": -4.7247, "source": "Curiosity traverse · Mars Trek",
         "note": "Last point of the rover's actual traverse included in the data."},
    ]
    for f in crism["features"]:
        lon, lat = (f["west"] + f["east"]) / 2, (f["south"] + f["north"]) / 2
        if bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]:
            targets.append({"id": f["product_id"][:11].lower(), "name": "CRISM footprint " + f["product_id"][:11],
                              "type": "spectral", "lon": round(lon, 4), "lat": round(lat, 4),
                              "box": [f["west"], f["south"], f["east"], f["north"]],
                              "source": "CRISM MTRDR · Mars Trek",
                              "note": "Area with a high-resolution spectrum: candidate for mineral sampling."})
    seen = set()
    for f in minerals["features"]:
        key = (round(f["lon"], 2), round(f["lat"], 2))
        if key in seen or not (bbox[0] <= f["lon"] <= bbox[2] and bbox[1] <= f["lat"] <= bbox[3]):
            continue
        seen.add(key)
        targets.append({"id": "hydrous_" + str(len(seen)), "name": "Hydrated minerals", "type": "mineral",
                          "lon": round(f["lon"], 4), "lat": round(f["lat"], 4),
                          "source": "OMEGA/CRISM detection · Mars Trek",
                          "note": "Orbital detection of water-bearing minerals: high scientific value."})
    # color-index anomalies (scientific candidates) within < 3 km of the main route
    rp = np.array([[p[0], p[1]] for p in routes["summit"]["points"]])
    ci_full = L["color_index"]
    zs = (ci_full - np.nanmean(ci_full)) / np.nanstd(ci_full)
    zs_s = block_mean(zs, 60)
    w, s, e, n = bbox
    cands = []
    for r in range(60):
        for c in range(60):
            lon = w + (c + 0.5) / 60 * (e - w)
            lat = n - (r + 0.5) / 60 * (n - s)
            d = np.min(np.hypot(rp[:, 0] - lon, rp[:, 1] - lat)) * 59.27  # km/°
            if d < 3.0:
                cands.append((abs(zs_s[r, c]), lon, lat, zs_s[r, c]))
    cands.sort(reverse=True)
    picked = []
    for score, lon, lat, z in cands:
        if all(np.hypot(lon - a, lat - b) > 0.08 for _, a, b in picked):
            picked.append((score, lon, lat))
        if len(picked) == 3:
            break
    for i, (score, lon, lat) in enumerate(picked, 1):
        targets.append({"id": f"color_{i}", "name": f"Color anomaly #{i}", "type": "science",
                          "lon": round(lon, 4), "lat": round(lat, 4), "source": "Viking MDIM 2.1 (red-blue index)",
                          "note": f"Color contrast {score:.1f} σ above the mean, within 3 km of the route."})

    rems = {"sol_100": rems_profile(ROOT / "data/processed/rems_sol00100.csv"),
            "sol_4500": rems_profile(ROOT / "data/processed/rems_sol04500.csv")}
    model_metrics = json.loads((ROOT / "models/metrics.json").read_text())

    trav_path = json.loads((ROOT / "data/raw/curiosity_traverse.json").read_text())["paths"][0]
    traverse = [[round(p[0], 5), round(p[1], 5)] for p in trav_path[::30]] + [[round(trav_path[-1][0], 5), round(trav_path[-1][1], 5)]]

    data = {
        "traverse": traverse,
        "site": cfg["site"], "bbox": bbox, "cell_m": [dx * size / GRID, dy * size / GRID],
        "start": cfg["start"], "goal": cfg["goal"], "planner": planner,
        "layers": layers, "routes": routes, "targets": targets, "rems": rems,
        "model": model_metrics, "sources": meta["sources"],
    }
    for name, obj in (("layers", layers), ("routes", routes), ("targets", targets), ("rems", rems)):
        (WEB / "data" / f"{name}.json").write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
    (WEB / "data/mars_data.js").write_text("window.MARS_DATA=" + json.dumps(data, ensure_ascii=False) + ";",
                                           encoding="utf-8")
    print("OK", {k: len(v["points"]) for k, v in routes.items()}, len(targets), "targets")


if __name__ == "__main__":
    main()
