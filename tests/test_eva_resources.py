import pytest

from test_route_request import ROOT  # prepara las rutas del proyecto
from marsroute.multicriteria import compute_path_resources, load_profiles, tobler_eva_speed_kmh
from marsroute.domain import ResourceState


def test_resources_keep_precision_at_reserve_boundary():
    profile = load_profiles()["segura"]
    speed = tobler_eva_speed_kmh(0, 1, profile.speed_factor)
    # 7.632341 h bajo Pandolf deja 24.96 % de oxígeno; redondear a una cifra ocultaría el déficit.
    points = [[0, 0, 0, 0, 0, 0, 1], [0, 0, speed * 7.632341, 0, 0, 0, 1]]
    _, _, resources = compute_path_resources(points, profile)
    assert resources.oxygen_pct == pytest.approx(24.96)
    assert resources.oxygen_pct < 25


def test_eva_resources_reject_rover_model():
    with pytest.raises(ValueError):
        compute_path_resources([], load_profiles()["segura"], mobility="rover")


def test_split_route_preserves_accumulated_resources():
    profile = load_profiles()["segura"]
    points = [[0, 0, 0, 0, 0, 0, 1], [0, 0, 0.4, 2, 0, 0, 1],
              [0, 0, 0.8, 4, 0, 0, 1]]
    initial = ResourceState(oxygen_pct=70, battery_pct=65, eva_time_min=30, radiation_dose_msv=0.02)
    _, _, whole = compute_path_resources(points, profile, initial_resources=initial)
    _, _, first = compute_path_resources(points[:2], profile, initial_resources=initial)
    distance, _, second = compute_path_resources(points[1:], profile, initial_resources=first)
    assert distance == pytest.approx(0.4)
    for name in ("oxygen_pct", "battery_pct", "eva_time_min", "radiation_dose_msv"):
        assert getattr(second, name) == pytest.approx(getattr(whole, name))
    assert initial.oxygen_pct == 70


@pytest.mark.parametrize("state", [ResourceState(oxygen_pct=float('nan')),
                                    ResourceState(battery_pct=101),
                                    ResourceState(eva_time_min=-1),
                                    ResourceState(radiation_dose_msv=float('inf'))])
def test_invalid_initial_resources_are_rejected(state):
    with pytest.raises(ValueError):
        compute_path_resources([], load_profiles()["segura"], initial_resources=state)
