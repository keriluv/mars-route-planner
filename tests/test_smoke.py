"""test_smoke.py — Pruebas de humo de la Fase 1 para GaleX.

Valida:
1. Carga íntegra de configuraciones regionales (Gale y Jezero).
2. Carga y consistencia de los perfiles de ruta (segura, rápida, científica).
3. Contratos de dominio y serialización JSON.
4. Persistencia relacional SQLite (lectura/escritura de reportes y hallazgos).
5. Integridad del escenario simulado reproducible.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import yaml
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from marsroute.domain import (
    Alert,
    AlertLevel,
    Provenance,
    Region,
    Report,
    ResourceState,
    RouteAlternative,
    RouteProfile,
)
from marsroute.storage import Storage

ROOT = Path(__file__).resolve().parents[1]


def test_region_configs_exist_and_load():
    """Verifica que las configuraciones de Gale y Jezero sean válidas y cumplan el contrato."""
    gale_path = ROOT / "config" / "regions" / "gale.yaml"
    jezero_path = ROOT / "config" / "regions" / "jezero.yaml"

    assert gale_path.exists(), "Falta config/regions/gale.yaml"
    assert jezero_path.exists(), "Falta config/regions/jezero.yaml"

    gale_data = yaml.safe_load(gale_path.read_text(encoding="utf-8"))
    jezero_data = yaml.safe_load(jezero_path.read_text(encoding="utf-8"))

    gale = Region.from_dict(gale_data)
    jezero = Region.from_dict(jezero_data)

    assert gale.id == "gale"
    assert len(gale.bbox) == 4
    assert gale.bbox[0] < gale.bbox[2]  # west < east
    assert gale.bbox[1] < gale.bbox[3]  # south < north

    assert jezero.id == "jezero"
    assert len(jezero.bbox) == 4
    assert jezero.bbox[0] < jezero.bbox[2]
    assert jezero.bbox[1] < jezero.bbox[3]

    # Ambas regiones deben tener al menos un refugio
    assert len(gale_data.get("shelters", [])) >= 1
    assert len(jezero_data.get("shelters", [])) >= 1


def test_route_profiles_config():
    """Verifica que los tres perfiles requeridos (segura, rápida, científica) estén definidos."""
    prof_path = ROOT / "config" / "route_profiles.yaml"
    assert prof_path.exists(), "Falta config/route_profiles.yaml"

    data = yaml.safe_load(prof_path.read_text(encoding="utf-8"))
    profiles = data.get("profiles", {})

    for p in ("segura", "rapida", "cientifica"):
        assert p in profiles, f"Perfil '{p}' no encontrado en route_profiles.yaml"
        cfg = profiles[p]
        assert cfg["risk_weight"] >= 0.0
        assert cfg["slope_weight"] >= 0.0
        assert cfg["max_slope_deg"] >= 10.0

    # Comprobar restricciones duras del sistema
    hard = data.get("hard_constraints", {})
    assert hard.get("require_final_shelter") is True
    assert hard.get("max_eva_hours", 0) > 0


def test_domain_serialization():
    """Valida serialización y validaciones del modelo de recursos y alertas."""
    res = ResourceState(oxygen_pct=85.0, battery_pct=90.0, eva_time_min=120.0, radiation_dose_msv=0.45)
    is_safe, reason = res.is_safe()
    assert is_safe is True
    assert reason is None

    # Caso de fallo crítico: oxígeno agotado
    dead_res = ResourceState(oxygen_pct=0.0)
    safe, err = dead_res.is_safe()
    assert safe is False
    assert "Oxígeno agotado" in (err or "")

    # Serialización de alerta
    alert = Alert(
        id="ALT-01",
        level=AlertLevel.CRITICA,
        variable="pendiente",
        threshold=20.0,
        observed_value=23.5,
        message="Pendiente peligrosa",
        action_suggested="Desviar al norte",
    )
    d = alert.to_dict()
    assert d["level"] == "CRÍTICA"
    assert d["threshold"] == 20.0


def test_storage_sqlite_crud():
    """Verifica la persistencia en SQLite de reportes, hallazgos y mensajes."""
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as tmp:
        temp_db = Path(tmp.name)

    try:
        store = Storage(temp_db)

        # 1. Guardar y leer un reporte
        rep = Report(
            id="rep-001",
            author="ev1",
            type="hallazgo",
            lon=137.5,
            lat=-4.8,
            elev_m=-3200.0,
            sol_min=150.0,
            km=5.4,
            text="Muestra sedimentaria con posibles arcillas esmectitas.",
            attachments={"photo": "sample_001.jpg"},
        )
        store.save_report(rep)

        read_rep = store.get_report("rep-001")
        assert read_rep is not None
        assert read_rep.id == "rep-001"
        assert read_rep.author == "ev1"
        assert read_rep.text == rep.text
        assert read_rep.attachments.get("photo") == "sample_001.jpg"

        # 2. Guardar y listar hallazgos
        store.save_finding({
            "id": "h-100",
            "crew": "ev2",
            "type": "mineral",
            "note": "Sulfato de calcio detectado",
            "lon": 137.6,
            "lat": -4.9,
            "elev": -3100.0,
            "simMin": 180.0,
            "km": 6.8,
            "photo": True,
        })
        findings = store.list_findings(crew="ev2")
        assert len(findings) == 1
        assert findings[0]["id"] == "h-100"

        # 3. Guardar y listar mensajes
        store.save_message({
            "crew": "ev1",
            "from": "tierra",
            "text": "Autorización para proseguir hacia estación MDA-14 concedida.",
            "kind": "texto",
            "sol_min": 200.0,
        })
        messages = store.list_messages(crew="ev1")
        assert len(messages) >= 1
        assert "MDA-14" in messages[-1]["texto"]

    finally:
        if temp_db.exists():
            temp_db.unlink()


def test_demo_scenario_structure():
    """Verifica que el archivo de escenario reproducible contenga estaciones y eventos."""
    scen_path = ROOT / "data" / "simulated" / "demo_scenario.json"
    assert scen_path.exists(), "Falta data/simulated/demo_scenario.json"

    data = json.loads(scen_path.read_text(encoding="utf-8"))
    assert "scenario_id" in data
    assert "stations" in data
    assert len(data["stations"]) >= 2

    # Verificar que existe el evento meteorológico crítico
    events = data.get("timeline_events", [])
    has_critical = any(e.get("severity") == "CRÍTICA" or e.get("type") == "CRITICAL_WEATHER_EVENT" for e in events)
    assert has_critical, "El escenario debe incluir al menos un evento crítico para disparar alerta"


def test_server_modules_importable():
    """Verifica que el servidor backend cargue sin errores con las nuevas rutas y módulos."""
    sys.path.insert(0, str(ROOT / "backend"))
    import server  # noqa: F401

    assert hasattr(server, "Handler")
    assert hasattr(server, "storage")


def test_multicriteria_planner_and_rejection():
    """Verifica el cálculo de alternativas y el rechazo reproducible por destino sin refugio."""
    import numpy as np
    from marsroute.layers import load_layers
    from marsroute.multicriteria import MultiCriteriaPlanner

    layers = load_layers(ROOT / "data" / "processed" / "layers.npz")
    layers["traversability"] = np.load(ROOT / "outputs" / "traversability.npy")

    gale_cfg = yaml.safe_load((ROOT / "config" / "regions" / "gale.yaml").read_text(encoding="utf-8"))
    shelters = gale_cfg["shelters"]
    bbox = tuple(gale_cfg["bbox"])
    planner = MultiCriteriaPlanner(layers, bbox, gale_cfg["grid_size"])

    start = (137.4416, -4.5895)  # Bradbury
    goal_shelter = (137.8599, -5.3709)  # Base Mount Sharp
    arbitrary_point = (137.55, -4.75)  # Punto sin refugio

    # La ruta histórica a Mount Sharp excede una EVA: no cambiar a rover automáticamente.
    alt_segura = planner.plan_alternative(
        profile_id="segura",
        start_lonlat=start,
        target_lonlats=[],
        final_shelter_lonlat=goal_shelter,
        shelters_catalog=shelters,
        require_final_shelter=True,
    )
    assert alt_segura.is_valid is False
    assert alt_segura.total_km > 0
    assert alt_segura.resources.eva_time_min > 480
    assert alt_segura.rejection_reason is not None

    # 2. Rechazo por destino sin refugio
    alt_rechazada = planner.plan_alternative(
        profile_id="segura",
        start_lonlat=start,
        target_lonlats=[],
        final_shelter_lonlat=arbitrary_point,
        shelters_catalog=shelters,
        require_final_shelter=True,
    )
    assert alt_rechazada.is_valid is False
    assert "no es un refugio seguro" in (alt_rechazada.rejection_reason or "")

    # 3. Cálculo de las 3 alternativas
    alts = planner.plan_all_alternatives(
        start_lonlat=start,
        target_lonlats=[],
        final_shelter_lonlat=goal_shelter,
        shelters_catalog=shelters,
        require_final_shelter=True,
    )
    assert "segura" in alts and "rapida" in alts and "cientifica" in alts


