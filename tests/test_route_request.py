"""Validación de entradas antes de cargar datos o calcular rutas."""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "src"))

from server import plan_route


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
