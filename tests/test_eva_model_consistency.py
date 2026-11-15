"""Compara el consumo por tiempo del cliente con el cálculo EVA del servidor."""
import json
import subprocess

import pytest
import yaml

from test_route_request import ROOT  # prepara las rutas del proyecto
from marsroute.multicriteria import compute_path_resources, load_profiles, tobler_eva_speed_kmh


@pytest.mark.parametrize("grade", [0.0, 0.2])
def test_client_and_server_consumption_match_for_same_time(grade):
    profile = load_profiles()["segura"]
    distance = tobler_eva_speed_kmh(grade, 1, profile.speed_factor)
    points = [[0, 0, 0, 0, 0, 0, 1], [0, 0, distance, grade * distance * 1000, 0, 0, 1]]
    _, hours, server = compute_path_resources(points, profile)
    script = """
global.window = { MARS_DATA: { layers: { grid: 1, dem: { min: 0, max: 1, b64: 'AA==' } } } };
require('./web/js/core.js');
const s = { oxygen_pct: 100, battery_pct: 100, eva_time_min: 0, radiation_dose_msv: 0 };
process.stdout.write(JSON.stringify(window.MR.consumeEvaResources(s, 60, Number(process.argv[1]))));
"""
    client = json.loads(subprocess.check_output(["node", "-e", script, str(grade)], cwd=ROOT, text=True))
    assert hours == pytest.approx(1)
    for field in ("oxygen_pct", "battery_pct", "eva_time_min", "radiation_dose_msv"):
        assert client[field] == pytest.approx(getattr(server, field))


def test_client_time_limit_matches_server_configuration():
    config = yaml.safe_load((ROOT / "config" / "route_profiles.yaml").read_text())
    minutes = config["hard_constraints"]["max_eva_hours"] * 60
    script = """
global.window = { MARS_DATA: { layers: { grid: 1, dem: { min: 0, max: 1, b64: 'AA==' } } } };
require('./web/js/core.js');
const s = { oxygen_pct: 1, battery_pct: 1, eva_time_min: Number(process.argv[1]), radiation_dose_msv: 0 };
process.stdout.write(JSON.stringify([window.MR.evaResourcesExhausted({...s, eva_time_min: s.eva_time_min - 0.01}), window.MR.evaResourcesExhausted(s)]));
"""
    assert json.loads(subprocess.check_output(["node", "-e", script, str(minutes)], cwd=ROOT, text=True)) == [False, True]
