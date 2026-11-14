"""Descriptive analysis of REMS weather observations and Gale Crater surface rasters."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np


WEATHER_VARIABLES = {
    "BOOM1_AIR_TEMP": {"label": "Temperatura del aire", "unit": "K"},
    "BAROCAP_PRESSURE_1": {"label": "Presión atmosférica", "unit": "Pa"},
    "UV_ABC": {"label": "Radiación UV", "unit": "W/m²"},
    "HUMIDITY_CHANNEL_A": {"label": "Humedad relativa", "unit": "%"},
}

SURFACE_VARIABLES = {
    "dem": {"label": "Elevación", "unit": "m"},
    "slope": {"label": "Pendiente", "unit": "°"},
    "roughness": {"label": "Rugosidad local", "unit": "m"},
    "thermal": {"label": "THEMIS térmico", "unit": "DN"},
    "texture": {"label": "Textura óptica", "unit": "índice"},
    "traverse_distance": {"label": "Distancia a recorrido Curiosity", "unit": "km"},
    "spectral_coverage": {"label": "Cobertura espectral CRISM", "unit": "fracción"},
    "mineral_distance": {"label": "Distancia a detección mineral", "unit": "km"},
}


def _statistics(values: np.ndarray) -> dict:
    finite = np.asarray(values, dtype="float64")
    finite = finite[np.isfinite(finite)]
    if finite.size == 0:
        return {"count": 0, "mean": None, "median": None, "min": None, "p05": None, "p95": None, "max": None}
    q05, q25, q50, q75, q95 = np.percentile(finite, [5, 25, 50, 75, 95])
    return {
        "count": int(finite.size),
        "mean": float(np.mean(finite)),
        "median": float(q50),
        "min": float(np.min(finite)),
        "p05": float(q05),
        "p25": float(q25),
        "p75": float(q75),
        "p95": float(q95),
        "max": float(np.max(finite)),
    }


def _solar_hour(value: str) -> float | None:
    try:
        clock = value.split("M")[-1].split(":")
        return int(clock[0]) + int(clock[1]) / 60.0 + float(clock[2]) / 3600.0
    except (ValueError, IndexError):
        return None


def _read_weather(path: Path) -> tuple[dict, dict[str, np.ndarray]]:
    fields = {name: [] for name in WEATHER_VARIABLES}
    hours = []
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            hour = _solar_hour(row.get("LMST", ""))
            hours.append(np.nan if hour is None else hour)
            for name in fields:
                try:
                    value = float(row[name])
                except (ValueError, TypeError, KeyError):
                    value = np.nan
                fields[name].append(value)

    hour_array = np.asarray(hours, dtype="float64")
    values = {name: np.asarray(column, dtype="float64") for name, column in fields.items()}
    summary = {name: _statistics(column) for name, column in values.items()}
    summary["records"] = int(hour_array.size)
    summary["hourly"] = {}
    for name, column in values.items():
        means = []
        counts = []
        for hour_bin in range(24):
            mask = (hour_array >= hour_bin) & (hour_array < hour_bin + 1) & np.isfinite(column)
            counts.append(int(mask.sum()))
            means.append(float(np.mean(column[mask])) if mask.any() else None)
        summary["hourly"][name] = {"mean": means, "count": counts}
    return summary, values


def _surface_summary(layers_path: Path, layers_meta_path: Path) -> dict:
    archive = np.load(layers_path)
    valid = archive["valid"].astype(bool)
    total_cells = int(valid.size)
    valid_cells = int(valid.sum())
    metrics = {}
    for name, info in SURFACE_VARIABLES.items():
        values = np.asarray(archive[name])[valid]
        stats = _statistics(values)
        counts, edges = np.histogram(values[np.isfinite(values)], bins=20)
        stats["histogram"] = {"counts": counts.astype(int).tolist(), "edges": edges.astype(float).tolist()}
        stats["label"] = info["label"]
        stats["unit"] = info["unit"]
        metrics[name] = stats

    slope = np.asarray(archive["slope"])[valid]
    roughness = np.asarray(archive["roughness"])[valid]
    coverage = np.asarray(archive["spectral_coverage"])[valid]
    meta = json.loads(layers_meta_path.read_text(encoding="utf-8"))
    return {
        "grid_size": list(archive["dem"].shape),
        "valid_cells": valid_cells,
        "total_cells": total_cells,
        "valid_area_pct": 100.0 * valid_cells / total_cells if total_cells else 0.0,
        "cell_size_m": {"x": meta["dx_m"], "y": meta["dy_m"]},
        "variables": SURFACE_VARIABLES,
        "metrics": metrics,
        "slope_over_10_pct": 100.0 * float(np.mean(slope > 10.0)),
        "slope_over_20_pct": 100.0 * float(np.mean(slope > 20.0)),
        "roughness_over_10_pct": 100.0 * float(np.mean(roughness > 10.0)),
        "crism_covered_pct": 100.0 * float(np.mean(coverage > 0.0)),
    }


def analyze_datasets(data_dir: Path) -> dict:
    processed_dir = data_dir / "processed"
    layers_path = processed_dir / "layers.npz"
    meta_path = processed_dir / "layers_meta.json"
    weather = {}
    for sol in (100, 4500):
        summary, _ = _read_weather(processed_dir / f"rems_sol{sol:05d}.csv")
        weather[str(sol)] = summary
    surface = _surface_summary(layers_path, meta_path)

    temp_key = "BOOM1_AIR_TEMP"
    pressure_key = "BAROCAP_PRESSURE_1"
    humidity_key = "HUMIDITY_CHANNEL_A"
    uv_key = "UV_ABC"
    temp_delta = weather["4500"][temp_key]["mean"] - weather["100"][temp_key]["mean"]
    pressure_delta = weather["4500"][pressure_key]["mean"] - weather["100"][pressure_key]["mean"]
    humidity_change = weather["4500"][humidity_key]["max"] - weather["100"][humidity_key]["max"]
    uv_change = weather["4500"][uv_key]["max"] - weather["100"][uv_key]["max"]
    findings = [
        f"La temperatura media del aire cambia {temp_delta:+.1f} K entre los soles 100 y 4500; se comparan solo estos dos soles.",
        f"La presión media cambia {pressure_delta:+.1f} Pa entre ambos registros.",
        f"La humedad máxima cambia {humidity_change:+.1f} puntos porcentuales y el máximo UV cambia {uv_change:+.1f} W/m².",
        f"El {surface['slope_over_20_pct']:.1f}% de las celdas válidas supera 20° de pendiente; {surface['roughness_over_10_pct']:.1f}% supera 10 m de rugosidad.",
        f"La cobertura espectral CRISM está presente en {surface['crism_covered_pct']:.1f}% del área rasterizada.",
    ]
    return {
        "site": "Gale Crater — Mount Sharp",
        "weather_variables": WEATHER_VARIABLES,
        "weather_sols": weather,
        "surface": surface,
        "findings": findings,
        "limits": [
            "REMS contiene observaciones de dos soles concretos; no representa todas las estaciones ni el clima marciano anual.",
            "Las capas superficiales tienen una celda de aproximadamente 44 m; no describen rocas ni obstáculos de escala pequeña.",
            "Los DN térmicos THEMIS son valores de imagen y no se presentan como temperatura calibrada.",
            "Los promedios meteorológicos de REMS y las capas espaciales tienen escalas distintas; el panel no infiere correlación causal entre ellos.",
        ],
    }
