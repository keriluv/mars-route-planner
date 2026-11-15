from __future__ import annotations

import heapq
import math
from dataclasses import dataclass

import numpy as np
from scipy import ndimage

NEIGHBORS = (
    (-1, 0, 1.0),
    (1, 0, 1.0),
    (0, -1, 1.0),
    (0, 1, 1.0),
    (-1, -1, math.sqrt(2.0)),
    (-1, 1, math.sqrt(2.0)),
    (1, -1, math.sqrt(2.0)),
    (1, 1, math.sqrt(2.0)),
)


@dataclass
class Route:
    cells: np.ndarray
    cost: float
    expanded: int


def build_cost_surface(
    traversability: np.ndarray,
    slope: np.ndarray,
    risk_weight: float,
    slope_weight: float,
    max_slope_deg: float,
    caution_slope_deg: float,
    min_traversability: float,
    margin_cells: int = 1,
) -> tuple[np.ndarray, np.ndarray]:
    risk = 1.0 - np.clip(traversability, 0.0, 1.0)
    slope_penalty = np.clip((slope - caution_slope_deg) / max(max_slope_deg - caution_slope_deg, 1e-6), 0.0, 1.0)
    cost = 1.0 + risk_weight * risk**2 + slope_weight * slope_penalty**2
    blocked = (~np.isfinite(slope)) | (~np.isfinite(traversability)) | (slope > max_slope_deg) | (traversability < min_traversability)
    if margin_cells > 0:
        blocked = ndimage.binary_dilation(blocked, iterations=margin_cells)
    return cost.astype("float32"), blocked


def astar(cost: np.ndarray, blocked: np.ndarray, start, goal) -> Route:
    if cost.ndim != 2 or cost.shape != blocked.shape or cost.size == 0:
        raise ValueError("Cost and blocked grids must have the same nonempty 2D shape")
    blocked = np.asarray(blocked, dtype=bool)
    rows, columns = cost.shape
    for point in (start, goal):
        if len(point) != 2 or any(not isinstance(v, (int, np.integer)) for v in point):
            raise ValueError("Start and goal must be integer cells")
        if not (0 <= point[0] < rows and 0 <= point[1] < columns):
            raise ValueError("Start or goal is outside the grid")
    usable_costs = cost[~blocked]
    if np.any(~np.isfinite(usable_costs)) or np.any(usable_costs < 0):
        raise ValueError("Invalid traversal cost")
    start_row, start_column = start
    goal_row, goal_column = goal
    if blocked[start_row, start_column] or blocked[goal_row, goal_column]:
        raise ValueError("Start or goal is blocked")

    size = rows * columns
    best = np.full(size, np.inf, dtype="float64")
    parent = np.full(size, -1, dtype="int64")
    start_index = start_row * columns + start_column
    goal_index = goal_row * columns + goal_column
    best[start_index] = 0.0

    minimum_cost = float(np.min(usable_costs))
    if not np.isfinite(minimum_cost) or minimum_cost < 0:
        raise ValueError("Invalid traversal cost")

    def heuristic(row: int, column: int) -> float:
        return minimum_cost * math.hypot(row - goal_row, column - goal_column)

    heap = [(heuristic(start_row, start_column), start_index)]
    closed = np.zeros(size, dtype=bool)
    expanded = 0

    while heap:
        _, index = heapq.heappop(heap)
        if closed[index]:
            continue
        closed[index] = True
        expanded += 1
        if index == goal_index:
            break
        row, column = divmod(index, columns)
        base = best[index]
        for delta_row, delta_column, step in NEIGHBORS:
            next_row = row + delta_row
            next_column = column + delta_column
            if next_row < 0 or next_row >= rows or next_column < 0 or next_column >= columns:
                continue
            if delta_row and delta_column and (blocked[row + delta_row, column] or blocked[row, column + delta_column]):
                continue
            next_index = next_row * columns + next_column
            if closed[next_index] or blocked[next_row, next_column]:
                continue
            step_cost = step * 0.5 * (cost[row, column] + cost[next_row, next_column])
            candidate = base + step_cost
            if candidate < best[next_index]:
                best[next_index] = candidate
                parent[next_index] = index
                heapq.heappush(
                    heap, (candidate + heuristic(next_row, next_column), next_index)
                )

    if not np.isfinite(best[goal_index]):
        raise ValueError("No route found")

    path = []
    index = goal_index
    while index != -1:
        path.append(divmod(index, columns))
        index = parent[index]
    path.reverse()
    cells = np.asarray(path, dtype="int32")
    return Route(cells=cells, cost=float(best[goal_index]), expanded=expanded)


def simplify(cells: np.ndarray, tolerance: float = 1.5) -> np.ndarray:
    if cells.shape[0] <= 2:
        return cells
    points = cells.astype("float64")
    keep = np.zeros(points.shape[0], dtype=bool)
    keep[0] = True
    keep[-1] = True
    stack = [(0, points.shape[0] - 1)]
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        start = points[first]
        end = points[last]
        segment = end - start
        length = np.hypot(segment[0], segment[1])
        if length == 0:
            continue
        relative = points[first + 1 : last] - start
        distance = np.abs(segment[0] * relative[:, 1] - segment[1] * relative[:, 0]) / length
        index = int(np.argmax(distance))
        if distance[index] > tolerance:
            position = first + 1 + index
            keep[position] = True
            stack.append((first, position))
            stack.append((position, last))
    return cells[keep]


def route_lonlat(cells: np.ndarray, bbox, size: int) -> np.ndarray:
    west, south, east, north = bbox
    columns = cells[:, 1]
    rows = cells[:, 0]
    lon = west + (columns + 0.5) / size * (east - west)
    lat = north - (rows + 0.5) / size * (north - south)
    return np.column_stack([lon, lat])
