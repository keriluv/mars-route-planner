"""test_rover_validation.py — Pruebas unitarias para la validación geométrica contra rovers reales."""
import json
import sys
from pathlib import Path
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from marsroute.evaluate_rovers import (
    compare_trajectories,
    lonlat_to_local_meters,
    polyline_length_m,
    resample_polyline,
    run_rover_validations,
)


def test_resample_polyline_preserves_endpoints_and_step():
    # Línea recta de 100 m
    pts = np.array([[0.0, 0.0], [100.0, 0.0]])
    resampled = resample_polyline(pts, step_m=20.0)
    # Debe tener 6 puntos: 0, 20, 40, 60, 80, 100
    assert len(resampled) == 6
    assert np.allclose(resampled[0], [0.0, 0.0])
    assert np.allclose(resampled[-1], [100.0, 0.0])
    diffs = np.diff(resampled, axis=0)
    steps = np.sqrt((diffs ** 2).sum(axis=1))
    assert np.allclose(steps, 20.0)


def test_polyline_length():
    pts = np.array([[0.0, 0.0], [3.0, 4.0], [3.0, 14.0]])
    assert polyline_length_m(pts) == pytest.approx(15.0)


def test_compare_identical_trajectories_yields_zero_deviation():
    pts = np.array([[0.0, 0.0], [50.0, 50.0], [100.0, 100.0]])
    metrics = compare_trajectories(pts, pts, step_m=10.0)
    assert metrics["desviacion_media_m"] == pytest.approx(0.0)
    assert metrics["desviacion_max_m"] == pytest.approx(0.0)
    assert metrics["pct_dentro_corredor_50m"] == 100.0
    assert metrics["razon_longitud"] == pytest.approx(1.0)


def test_compare_shifted_parallel_trajectory_matches_offset():
    # Ruta base horizontal y ruta paralela desplazada 30 metros al norte
    line1 = np.array([[0.0, 0.0], [200.0, 0.0]])
    line2 = np.array([[0.0, 30.0], [200.0, 30.0]])
    metrics = compare_trajectories(line1, line2, step_m=20.0, corridors_m=(20.0, 50.0))
    assert metrics["desviacion_media_m"] == pytest.approx(30.0, abs=0.1)
    assert metrics["pct_dentro_corredor_20m"] == 0.0
    assert metrics["pct_dentro_corredor_50m"] == 100.0


def test_run_rover_validations_creates_json_file(tmp_path):
    out_file = tmp_path / "test_validacion.json"
    rep = run_rover_validations(output_path=out_file)
    assert out_file.exists()
    assert "curiosity_gale" in rep
    assert "perseverance_jezero" in rep
    assert rep["curiosity_gale"]["metricas"]["desviacion_media_m"] > 0
    assert rep["perseverance_jezero"]["metricas"]["pct_dentro_corredor_100m"] > 0
