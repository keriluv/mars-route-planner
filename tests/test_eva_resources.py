import pytest

from test_route_request import ROOT  # prepara las rutas del proyecto
from marsroute.multicriteria import compute_path_resources, load_profiles, tobler_eva_speed_kmh


def test_resources_keep_precision_at_reserve_boundary():
    profile = load_profiles()["segura"]
    speed = tobler_eva_speed_kmh(0, 1, profile.speed_factor)
    # 6.0032 h deja 24.96 % de oxígeno; redondear a una cifra ocultaría el déficit.
    points = [[0, 0, 0, 0, 0, 0, 1], [0, 0, speed * 6.0032, 0, 0, 0, 1]]
    _, _, resources = compute_path_resources(points, profile)
    assert resources.oxygen_pct == pytest.approx(24.96)
    assert resources.oxygen_pct < 25


def test_eva_resources_reject_rover_model():
    with pytest.raises(ValueError):
        compute_path_resources([], load_profiles()["segura"], mobility="rover")
