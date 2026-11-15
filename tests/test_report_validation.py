import pytest

from test_route_request import ROOT  # prepara las rutas del backend
from server import parse_report


def report(**changes):
    return {**{"id": "r1", "author": "ev1", "type": "hallazgo", "lon": 0,
               "lat": 0, "text": "Muestra"}, **changes}


def test_report_accepts_zero_coordinates():
    parsed = parse_report(report())
    assert parsed.lon == 0 and parsed.lat == 0


@pytest.mark.parametrize("changes", [
    {"author": "desconocido"}, {"lon": None}, {"lat": None},
    {"lon": float("nan")}, {"attachments": []},
])
def test_invalid_report_is_rejected_before_storage(changes):
    with pytest.raises(ValueError):
        parse_report(report(**changes))
