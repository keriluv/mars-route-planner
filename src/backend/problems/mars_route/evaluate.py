from __future__ import annotations

import numpy as np

from .planner import astar, build_cost_surface


def route_length_km(cells: np.ndarray, dx_m: float, dy_m: float) -> float:
    delta = np.diff(cells.astype("float64"), axis=0)
    steps = np.hypot(delta[:, 0] * dy_m, delta[:, 1] * dx_m)
    return float(steps.sum() / 1000.0)


def sample_layers(cells: np.ndarray, layers: dict) -> dict[str, np.ndarray]:
    rows = cells[:, 0]
    columns = cells[:, 1]
    return {
        name: layers[name][rows, columns]
        for name in ("slope", "roughness", "thermal", "dem", "traverse_distance")
    }


def summarize_route(
    cells: np.ndarray,
    layers: dict,
    traversability: np.ndarray,
    dx_m: float,
    dy_m: float,
    cost: float | None = None,
    expanded: int | None = None,
) -> dict:
    values = sample_layers(cells, layers)
    slope = values["slope"]
    route_risk = 1.0 - traversability[cells[:, 0], cells[:, 1]]
    elevation = values["dem"]
    summary = {
        "length_km": route_length_km(cells, dx_m, dy_m),
        "mean_slope_deg": float(np.mean(slope)),
        "max_slope_deg": float(np.max(slope)),
        "p95_slope_deg": float(np.percentile(slope, 95)),
        "mean_roughness_m": float(np.mean(values["roughness"])),
        "mean_traversability": float(np.mean(1.0 - route_risk)),
        "min_traversability": float(np.min(1.0 - route_risk)),
        "traverse_likeness": float(np.mean(route_risk <= 0.5)),
        "mean_risk": float(np.mean(route_risk)),
        "max_risk": float(np.max(route_risk)),
        "start_elevation_m": float(elevation[0]),
        "max_elevation_m": float(np.max(elevation)),
        "elevation_gain_m": float(elevation[-1] - elevation[0]),
        "mean_thermal_dn": float(np.mean(values["thermal"])),
        "mean_traverse_distance_km": float(np.mean(values["traverse_distance"])),
    }
    if cost is not None:
        summary["path_cost"] = float(cost)
    if expanded is not None:
        summary["cells_expanded"] = int(expanded)
    return summary


def traverse_agreement(
    cells: np.ndarray, layers: dict, radius_m: float = 150.0
) -> dict:
    distance = layers["traverse_distance"][cells[:, 0], cells[:, 1]] * 1000.0
    return {
        "radius_m": radius_m,
        "route_fraction_within_radius": float(np.mean(distance <= radius_m)),
        "median_offset_m": float(np.median(distance)),
    }


def ablation(
    layers: dict,
    traversability: np.ndarray,
    planner_config: dict,
    start: tuple[int, int],
    goal: tuple[int, int],
    dx_m: float,
    dy_m: float,
) -> dict:
    learned_cost, blocked = build_cost_surface(
        traversability, layers["slope"], **planner_config
    )
    learned = astar(learned_cost, blocked, start, goal)
    learned_cells = learned.cells

    slope_cost, slope_blocked = build_cost_surface(
        np.ones_like(traversability), layers["slope"], **planner_config
    )
    slope_only = astar(slope_cost, slope_blocked, start, goal)
    slope_cells = slope_only.cells

    return {
        "learned": summarize_route(
            learned_cells,
            layers,
            traversability,
            dx_m,
            dy_m,
            learned.cost,
            learned.expanded,
        ),
        "slope_only": summarize_route(
            slope_cells,
            layers,
            traversability,
            dx_m,
            dy_m,
            slope_only.cost,
            slope_only.expanded,
        ),
        "slope_only_cells": slope_cells.tolist(),
    }


def evaluate_route(
    route: dict,
    layers: dict,
    traversability: np.ndarray,
    dx_m: float,
    dy_m: float,
    planner_config: dict,
) -> dict:
    cells = np.asarray(route.get("dense_cells", route["cells"]), dtype="int32")
    start = tuple(int(value) for value in cells[0])
    goal = tuple(int(value) for value in cells[-1])
    metrics = summarize_route(
        cells,
        layers,
        traversability,
        dx_m,
        dy_m,
        route["metrics"].get("path_cost"),
        route["metrics"].get("cells_expanded"),
    )
    metrics["traverse_agreement"] = traverse_agreement(cells, layers)
    metrics["ablation"] = ablation(
        layers, traversability, planner_config, start, goal, dx_m, dy_m
    )
    return metrics
