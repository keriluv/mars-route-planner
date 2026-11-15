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


@pytest.mark.parametrize("bad", [float("inf"), float("nan"), -1.0])
def test_invalid_cost_anywhere_in_free_grid_is_rejected(bad):
    cost = np.ones((3, 3))
    cost[0, 2] = bad
    with pytest.raises(ValueError, match="Invalid traversal cost"):
        astar(cost, np.zeros((3, 3), dtype=bool), (0, 0), (2, 2))


@pytest.mark.parametrize("start", [(-1, 0), (3, 0), (0.5, 0)])
def test_invalid_start_cannot_wrap_around_grid(start):
    with pytest.raises(ValueError):
        astar(np.ones((3, 3)), np.zeros((3, 3), dtype=bool), start, (2, 2))


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


def test_route_keeps_measurement_precision_for_resource_calculation():
    layers = {"dem": np.full((5, 5), 0.046), "slope": np.zeros((5, 5)),
              "traversability": np.full((5, 5), 0.9876)}
    planner = MultiCriteriaPlanner(layers, (137.4, -4.61, 137.41, -4.6), 5)
    goal = (137.409, -4.609)
    result = planner.plan_alternative("segura", (137.401, -4.601), [], goal,
                                      [{"lon": goal[0], "lat": goal[1], "name": "Refugio"}])
    assert result.is_valid
    assert result.points[-1][2] == result.total_km
    assert result.points[-1][2] != round(result.points[-1][2], 3)
    assert result.points[-1][3] == pytest.approx(0.046)
    assert result.points[-1][6] == pytest.approx(0.9876)
    assert result.estimated_hours * 60 == pytest.approx(result.resources.eva_time_min)


def test_shelter_check_uses_actual_grid_endpoint():
    layers = {"dem": np.zeros((5, 5)), "slope": np.zeros((5, 5)),
              "traversability": np.ones((5, 5))}
    planner = MultiCriteriaPlanner(layers, (137.4, -4.8, 137.6, -4.6), 5)
    requested = (137.441, -4.641)
    result = planner.plan_alternative("segura", (137.44, -4.64), [], requested,
                                      [{"lon": requested[0], "lat": requested[1], "name": "Refugio"}])
    assert not result.is_valid
    assert "no es un refugio" in result.rejection_reason
    assert result.explanation["refugio_alcanzado"] == "Ninguno"
