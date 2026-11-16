from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from marsroute.evaluate import evaluate_route  # noqa: E402
from marsroute.layers import load_layers  # noqa: E402
from marsroute.model import load_model, predict_traversability  # noqa: E402
from marsroute.planner import astar, build_cost_surface, route_lonlat, simplify  # noqa: E402


def lonlat_to_cell(lon: float, lat: float, bbox, size: int) -> tuple[int, int]:
    west, south, east, north = bbox
    column = int((lon - west) / (east - west) * size)
    row = int((north - lat) / (north - south) * size)
    return min(max(row, 0), size - 1), min(max(column, 0), size - 1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="config/mission.yaml")
    args = parser.parse_args()

    config = yaml.safe_load((ROOT / args.config).read_text(encoding="utf-8"))
    meta = json.loads((ROOT / "data" / "processed" / "layers_meta.json").read_text(encoding="utf-8"))
    layers = load_layers(ROOT / "data" / "processed" / "layers.npz")
    model = load_model(ROOT / "models")
    traversability = predict_traversability(model, layers)

    planner_config = dict(config["planner"])
    cost, blocked = build_cost_surface(traversability, layers["slope"], **planner_config)

    size = int(config["grid_size"])
    start = lonlat_to_cell(*config["start"], config["bbox"], size)
    goal = lonlat_to_cell(*config["goal"], config["bbox"], size)
    for name, cell in (("start", start), ("goal", goal)):
        if blocked[cell]:
            raise SystemExit(f"The {name} point falls in a blocked area: {cell}")

    route = astar(cost, blocked, start, goal)
    cells = simplify(route.cells)
    lonlat = route_lonlat(cells, config["bbox"], size)

    result = {
        "site": config["site"],
        "crs": config["crs"],
        "bbox": config["bbox"],
        "grid_size": size,
        "start": {"lon": config["start"][0], "lat": config["start"][1], "cell": list(start)},
        "goal": {"lon": config["goal"][0], "lat": config["goal"][1], "cell": list(goal)},
        "route": lonlat.tolist(),
        "cells": cells.tolist(),
        "dense_cells": route.cells.tolist(),
        "metrics": {
            "path_cost": route.cost,
            "cells_expanded": route.expanded,
            "dense_cells": int(route.cells.shape[0]),
            "waypoints": int(cells.shape[0]),
        },
    }
    metrics = evaluate_route(
        result,
        layers,
        traversability,
        meta["dx_m"],
        meta["dy_m"],
        planner_config,
    )
    result["metrics"].update(metrics)

    outputs = ROOT / "outputs"
    outputs.mkdir(parents=True, exist_ok=True)
    baseline_cells = np.asarray(result["metrics"]["ablation"].pop("slope_only_cells"), dtype="int32")
    baseline_lonlat = route_lonlat(simplify(baseline_cells), config["bbox"], size)
    (outputs / "route_baseline.json").write_text(
        json.dumps(
            {
                "route": baseline_lonlat.tolist(),
                "cells": baseline_cells.tolist(),
                "metrics": result["metrics"]["ablation"]["slope_only"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (outputs / "route.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    np.save(outputs / "traversability.npy", traversability)
    np.save(outputs / "cost.npy", cost)
    np.save(outputs / "blocked.npy", blocked)

    print(json.dumps(result["metrics"], indent=2))


if __name__ == "__main__":
    main()
