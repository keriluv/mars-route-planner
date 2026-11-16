"""Validación de entradas antes de cargar datos o calcular rutas."""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "src"))

import numpy as np
import server
from server import plan_route
from marsroute.multicriteria import MultiCriteriaPlanner


@pytest.mark.parametrize("body", [
    {"region": "jezero", "stops": [[77.4, 18.4], [77.5, 18.5]]},
    {"stops": [[77.4, 18.4], [77.5, 18.5]]},
    {"stops": [[137.4, -4.6], [float('nan'), -5.0]]},
    {"stops": [[137.4, -4.6], [137.5]]},
    {"stops": [[137.4, -4.6], [137.5, -5.0]], "profile": "desconocido"},
])
def test_invalid_route_requests_are_rejected(body):
    with pytest.raises(ValueError):
        plan_route(body)


@pytest.mark.parametrize("state", [None, {}, {"oxygen_pct": 100},
    {"oxygen_pct": True, "battery_pct": 90, "eva_time_min": 0, "radiation_dose_msv": 0},
    {"oxygen_pct": 90, "battery_pct": 90, "eva_time_min": float("nan"), "radiation_dose_msv": 0}])
def test_incomplete_or_invalid_initial_resources_are_rejected(state):
    with pytest.raises(ValueError):
        plan_route({"stops": [[137.401, -4.601], [137.409, -4.609]], "initial_resources": state})


@pytest.mark.parametrize("profile", ["segura", "all"])
def test_route_request_applies_prior_resources_to_all_profiles(monkeypatch, profile):
    layers = {"dem": np.zeros((5, 5)), "slope": np.zeros((5, 5)),
              "traversability": np.ones((5, 5))}
    planner = MultiCriteriaPlanner(layers, (137.4, -4.61, 137.41, -4.6), 5)
    goal = [137.409, -4.609]
    monkeypatch.setattr(server, "_planner", {"planner_instance": planner,
        "gale_cfg": {"shelters": [{"lon": goal[0], "lat": goal[1], "name": "Refugio"}]}})
    request = {"stops": [[137.401, -4.601], goal], "profile": profile,
               "initial_resources": {"oxygen_pct": 10, "battery_pct": 90,
                                     "eva_time_min": 30, "radiation_dose_msv": 0.1}}
    result = plan_route(request)
    alternatives = result["alternatives"].values() if profile == "all" else [result["alternative"]]
    for alternative in alternatives:
        assert not alternative["is_valid"]
        assert alternative["resources"]["oxygen_pct"] < 10
        assert alternative["resources"]["eva_time_min"] > 30
