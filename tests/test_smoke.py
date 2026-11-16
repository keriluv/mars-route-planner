"""test_smoke.py — Phase 1 smoke tests for GaleX.

Validates:
1. Full loading of the regional configurations (Gale and Jezero).
2. Loading and consistency of the route profiles (safe, fast, scientific).
3. Domain contracts and JSON serialization.
4. Relational SQLite persistence (reading/writing reports and findings).
5. Integrity of the reproducible simulated scenario.
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
    """Checks that the Gale and Jezero configurations are valid and meet the contract."""
    gale_path = ROOT / "config" / "regions" / "gale.yaml"
    jezero_path = ROOT / "config" / "regions" / "jezero.yaml"

    assert gale_path.exists(), "Missing config/regions/gale.yaml"
    assert jezero_path.exists(), "Missing config/regions/jezero.yaml"

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

    # Both regions must have at least one shelter
    assert len(gale_data.get("shelters", [])) >= 1
    assert len(jezero_data.get("shelters", [])) >= 1


def test_route_profiles_config():
    """Checks that the three required profiles (safe, fast, scientific) are defined."""
    prof_path = ROOT / "config" / "route_profiles.yaml"
    assert prof_path.exists(), "Missing config/route_profiles.yaml"

    data = yaml.safe_load(prof_path.read_text(encoding="utf-8"))
    profiles = data.get("profiles", {})

    for p in ("safe", "fast", "scientific"):
        assert p in profiles, f"Profile '{p}' not found in route_profiles.yaml"
        cfg = profiles[p]
        assert cfg["risk_weight"] >= 0.0
        assert cfg["slope_weight"] >= 0.0
        assert cfg["max_slope_deg"] >= 10.0

    # Check the system's hard constraints
    hard = data.get("hard_constraints", {})
    assert hard.get("require_final_shelter") is True
    assert hard.get("max_eva_hours", 0) > 0


def test_domain_serialization():
    """Validates serialization and validations of the resource and alert model."""
    res = ResourceState(oxygen_pct=85.0, battery_pct=90.0, eva_time_min=120.0, radiation_dose_msv=0.45)
    is_safe, reason = res.is_safe()
    assert is_safe is True
    assert reason is None

    # Critical failure case: oxygen depleted
    dead_res = ResourceState(oxygen_pct=0.0)
    safe, err = dead_res.is_safe()
    assert safe is False
    assert "Oxygen depleted" in (err or "")

    # Alert serialization
    alert = Alert(
        id="ALT-01",
        level=AlertLevel.CRITICAL,
        variable="slope",
        threshold=20.0,
        observed_value=23.5,
        message="Dangerous slope",
        action_suggested="Divert to the north",
    )
    d = alert.to_dict()
    assert d["level"] == "CRITICAL"
    assert d["threshold"] == 20.0


def test_storage_sqlite_crud():
    """Checks SQLite persistence of reports, findings and messages."""
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as tmp:
        temp_db = Path(tmp.name)

    try:
        store = Storage(temp_db)

        # 1. Save and read a report
        rep = Report(
            id="rep-001",
            author="ev1",
            type="hallazgo",
            lon=137.5,
            lat=-4.8,
            elev_m=-3200.0,
            sol_min=150.0,
            km=5.4,
            text="Sedimentary sample with possible smectite clays.",
            attachments={"photo": "sample_001.jpg"},
        )
        store.save_report(rep)

        read_rep = store.get_report("rep-001")
        assert read_rep is not None
        assert read_rep.id == "rep-001"
        assert read_rep.author == "ev1"
        assert read_rep.text == rep.text
        assert read_rep.attachments.get("photo") == "sample_001.jpg"

        # 2. Save and list findings
        store.save_finding({
            "id": "h-100",
            "crew": "ev2",
            "type": "mineral",
            "note": "Calcium sulfate detected",
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

        # 3. Save and list messages
        store.save_message({
            "crew": "ev1",
            "from": "tierra",
            "text": "Authorization to proceed to station MDA-14 granted.",
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
    """Checks that the reproducible scenario file contains stations and events."""
    scen_path = ROOT / "data" / "simulated" / "demo_scenario.json"
    assert scen_path.exists(), "Missing data/simulated/demo_scenario.json"

    data = json.loads(scen_path.read_text(encoding="utf-8"))
    assert "scenario_id" in data
    assert "stations" in data
    assert len(data["stations"]) >= 2

    # Check that the critical weather event exists
    events = data.get("timeline_events", [])
    has_critical = any(e.get("severity") == "CRITICAL" or e.get("type") == "CRITICAL_WEATHER_EVENT" for e in events)
    assert has_critical, "The scenario must include at least one critical event to trigger an alert"


def test_server_modules_importable(tmp_path, monkeypatch):
    """Checks that the backend server loads without errors with the new routes and modules.

    Uses a temporary data folder: importing the server opens and migrates the SQLite database, and it must not touch the versioned one.
    """
    monkeypatch.setenv("MARS_DATA_DIR", str(tmp_path))
    sys.path.insert(0, str(ROOT / "backend"))
    sys.modules.pop("server", None)
    import server  # noqa: F401

    try:
        assert hasattr(server, "Handler")
        assert hasattr(server, "save_aviso")
    finally:
        server.db.close()
        sys.modules.pop("server", None)
    assert hasattr(server, "storage")


def test_multicriteria_planner_and_rejection():
    """Checks the alternatives computation and the reproducible rejection of a destination without a shelter."""
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
    goal_shelter = (137.8599, -5.3709)  # Mount Sharp Base
    arbitrary_point = (137.55, -4.75)  # Point without a shelter

    # 1. Valid route to a shelter
    alt_safe = planner.plan_alternative(
        profile_id="safe",
        start_lonlat=start,
        target_lonlats=[],
        final_shelter_lonlat=goal_shelter,
        shelters_catalog=shelters,
        require_final_shelter=True,
    )
    assert alt_safe.is_valid is True
    assert alt_safe.total_km > 0
    assert alt_safe.resources.oxygen_pct > 0
    assert alt_safe.rejection_reason is None

    # 2. Rejection due to a destination without a shelter
    alt_rejected = planner.plan_alternative(
        profile_id="safe",
        start_lonlat=start,
        target_lonlats=[],
        final_shelter_lonlat=arbitrary_point,
        shelters_catalog=shelters,
        require_final_shelter=True,
    )
    assert alt_rejected.is_valid is False
    assert "is not a registered safe shelter" in (alt_rejected.rejection_reason or "")

    # 3. Computation of the 3 alternatives
    alts = planner.plan_all_alternatives(
        start_lonlat=start,
        target_lonlats=[],
        final_shelter_lonlat=goal_shelter,
        shelters_catalog=shelters,
        require_final_shelter=True,
    )
    assert "safe" in alts and "fast" in alts and "scientific" in alts


