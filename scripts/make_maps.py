from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import yaml
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from marsroute.layers import load_layers  # noqa: E402
from marsroute.visualize import (  # noqa: E402
    plot_context,
    plot_integrated,
    plot_layer_grid,
    plot_perspective,
    plot_profile,
    plot_route,
    plot_route_comparison,
    plot_traversability,
)

SOLS = (100, 4500)
COLORS = {100: "#f97316", 4500: "#2563eb"}


def read_rems(path: Path) -> dict[str, np.ndarray]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        names = reader.fieldnames or []
    data = {}
    for name in names:
        try:
            data[name] = np.array([float(row[name]) for row in rows])
        except ValueError:
            data[name] = np.array([row[name] for row in rows])
    return data


def lmst_hours(values) -> np.ndarray:
    hours = []
    for value in values:
        clock = str(value).split("M")[-1]
        hour, minute, second = clock.split(":")
        hours.append(int(hour) + int(minute) / 60.0 + float(second) / 3600.0)
    return np.array(hours)


def plot_rems(path: Path) -> None:
    figure, axes = plt.subplots(2, 2, figsize=(12, 7.5), constrained_layout=True)
    for sol in SOLS:
        data = read_rems(ROOT / "data" / "processed" / f"rems_sol{sol:05d}.csv")
        hours = lmst_hours(data["LMST"])
        order = np.argsort(hours)
        color = COLORS[sol]
        axes[0, 0].plot(hours[order], data["BOOM1_AIR_TEMP"][order], ".", color=color, markersize=1.5, alpha=0.6, label=f"Sol {sol}")
        axes[0, 1].plot(hours[order], data["BAROCAP_PRESSURE_1"][order], ".", color=color, markersize=1.5, alpha=0.6, label=f"Sol {sol}")
        axes[1, 0].plot(hours[order], data["UV_ABC"][order], ".", color=color, markersize=1.5, alpha=0.6, label=f"Sol {sol}")
        axes[1, 1].plot(hours[order], data["HUMIDITY_CHANNEL_A"][order], ".", color=color, markersize=1.5, alpha=0.6, label=f"Sol {sol}")
    titles = [
        "Air temperature (K)",
        "Pressure (Pa)",
        "UV ABC radiation (W/m²)",
        "Relative humidity (%)",
    ]
    for axis, title in zip(axes.ravel(), titles):
        axis.set_title(title)
        axis.set_xlabel("Local mean solar time")
        axis.grid(alpha=0.25)
        axis.legend(fontsize=8)
        axis.set_xlim(0, 24)
    figure.suptitle("REMS - atmospheric conditions in Gale Crater")
    figure.savefig(path, dpi=150, bbox_inches="tight")
    plt.close(figure)


def rems_summary() -> dict:
    summary = {}
    for sol in SOLS:
        data = read_rems(ROOT / "data" / "processed" / f"rems_sol{sol:05d}.csv")
        summary[f"sol_{sol}"] = {
            "records": int(data["TIMESTAMP"].size),
            "air_temp_min_k": float(np.nanmin(data["BOOM1_AIR_TEMP"])),
            "air_temp_max_k": float(np.nanmax(data["BOOM1_AIR_TEMP"])),
            "pressure_mean_pa": float(np.nanmean(data["BAROCAP_PRESSURE_1"])),
            "pressure_min_pa": float(np.nanmin(data["BAROCAP_PRESSURE_1"])),
            "pressure_max_pa": float(np.nanmax(data["BAROCAP_PRESSURE_1"])),
            "uv_max_w_m2": float(np.nanmax(data["UV_ABC"])),
            "humidity_max_pct": float(np.nanmax(data["HUMIDITY_CHANNEL_A"])),
        }
    return summary


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="config/mission.yaml")
    args = parser.parse_args()

    config = yaml.safe_load((ROOT / args.config).read_text(encoding="utf-8"))
    meta = json.loads((ROOT / "data" / "processed" / "layers_meta.json").read_text(encoding="utf-8"))
    layers = load_layers(ROOT / "data" / "processed" / "layers.npz")
    route = json.loads((ROOT / "outputs" / "route.json").read_text(encoding="utf-8"))
    traversability = np.load(ROOT / "outputs" / "traversability.npy")
    cost = np.load(ROOT / "outputs" / "cost.npy")
    blocked = np.load(ROOT / "outputs" / "blocked.npy")

    maps = ROOT / "maps"
    maps.mkdir(parents=True, exist_ok=True)

    traverse = json.loads((ROOT / "data" / "raw" / "curiosity_traverse.json").read_text(encoding="utf-8"))

    plot_layer_grid(layers, meta, maps / "layers_overview.png")
    plot_traversability(traversability, blocked, cost, meta, maps / "traversability.png")
    plot_route(
        layers,
        meta,
        np.asarray(route["route"]),
        traverse["paths"],
        config["start"],
        config["goal"],
        route["metrics"],
        maps / "route_map.png",
    )
    plot_profile(layers, meta, np.asarray(route["dense_cells"], dtype="int32"), maps / "route_profile.png")
    baseline = json.loads((ROOT / "outputs" / "route_baseline.json").read_text(encoding="utf-8"))
    plot_route_comparison(
        layers,
        traversability,
        meta,
        np.asarray(route["route"]),
        np.asarray(baseline["route"]),
        traverse["paths"],
        config["start"],
        config["goal"],
        route["metrics"],
        baseline["metrics"],
        maps / "route_comparison.png",
    )
    plot_perspective(layers, meta, np.asarray(route["route"]), maps / "route_3d.png")
    plot_integrated(layers, traversability, meta, maps / "integrated_view.png")
    plot_rems(maps / "rems_environment.png")

    region = ROOT / "data" / "raw" / "gale_context.jpg"
    if region.exists():
        region_bbox = json.loads(
            (ROOT / "data" / "raw" / "meta.json").read_text(encoding="utf-8")
        )["region_bbox"]
        plot_context(
            np.asarray(Image.open(region).convert("RGB")),
            tuple(region_bbox),
            tuple(config["bbox"]),
            maps / "context.png",
        )

    summary = {"rems": rems_summary()}
    (ROOT / "outputs" / "environment_summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
