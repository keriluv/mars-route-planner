import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from marsroute.planner import astar, build_cost_surface
from marsroute.multicriteria import MultiCriteriaPlanner


def test_nonfinite_cells_are_blocked():
    slope = np.zeros((3, 3))
    slope[1, 1] = np.nan
    _, blocked = build_cost_surface(np.ones((3, 3)), slope, 1, 1, 20, 8, 0, margin_cells=0)
    assert blocked[1, 1]


def test_diagonal_cannot_cross_blocked_corners():
    blocked = np.array([[False, True], [True, False]])
    with pytest.raises(ValueError, match="No route"):
        astar(np.ones((2, 2)), blocked, (0, 0), (1, 1))


def test_heuristic_respects_costs_below_one():
    cost = np.full((5, 9), 0.1)
    cost[2, 1:8] = 1.0
    route = astar(cost, np.zeros_like(cost, dtype=bool), (2, 0), (2, 8))
    assert route.cost < 2.0
    assert any(row != 2 for row, _ in route.cells)


def test_short_eva_reaches_shelter_with_reserves():
    layers = {"dem": np.zeros((5, 5)), "slope": np.zeros((5, 5)),
              "traversability": np.ones((5, 5)), "valid": np.ones((5, 5))}
    planner = MultiCriteriaPlanner(layers, (137.4, -4.61, 137.41, -4.6), 5)
    goal = (137.409, -4.609)
    result = planner.plan_alternative("segura", (137.401, -4.601), [], goal,
                                      [{"lon": goal[0], "lat": goal[1], "name": "Refugio simulado"}])
    assert result.is_valid
    assert result.resources.oxygen_pct >= 25
    assert result.resources.battery_pct >= 25
    assert len(result.points) == 5
