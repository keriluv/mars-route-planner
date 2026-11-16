"""Tests of the shared-notices backend (Phase 4): SQLite for the records, JSONL for the events.

Uses a temporary data folder (MARS_DATA_DIR); it does not touch backend/data.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture()
def server(tmp_path, monkeypatch):
    monkeypatch.setenv("MARS_DATA_DIR", str(tmp_path))
    sys.path.insert(0, str(ROOT / "backend"))
    sys.path.insert(0, str(ROOT / "src"))
    sys.modules.pop("server", None)
    mod = importlib.import_module("server")
    yield mod
    mod.db.close()
    sys.modules.pop("server", None)


def aviso(**kw):
    base = {"id": "av_1", "author": "ev1", "kind": "hallazgo", "text": "olivine", "lon": 137.5, "lat": -4.8, "simMin": 600}
    base.update(kw)
    return base


def test_publish_saves_record_and_event(server):
    server.save_aviso(aviso())
    rows = server.list_avisos()
    assert [(r["id"], r["author"], r["kind"], r["estado"]) for r in rows] == [("av_1", "ev1", "hallazgo", "activo")]
    eventos = server.docs.find("eventos", {"tipo": "aviso_publicado"})
    assert len(eventos) == 1 and eventos[0]["aviso_id"] == "av_1"


def test_resend_is_idempotent(server):
    server.save_aviso(aviso())
    server.save_aviso(aviso())
    assert len(server.list_avisos()) == 1
    assert len(server.docs.find("eventos", {"tipo": "aviso_publicado"})) == 1


def test_only_the_author_withdraws(server):
    server.save_aviso(aviso())
    server.retire_aviso({"id": "av_1", "crew": "ev2"})
    assert server.list_avisos()[0]["estado"] == "activo"
    server.retire_aviso({"id": "av_1", "crew": "ev1"})
    assert server.list_avisos()[0]["estado"] == "retirado"
    assert len(server.docs.find("eventos", {"tipo": "aviso_retirado"})) == 1


@pytest.mark.parametrize("cambio", [{"kind": "otro"}, {"author": "ev9"}, {"text": ""}, {"lat": 200}, {"id": ""}])
def test_rejects_invalid_data(server, cambio):
    with pytest.raises(ValueError):
        server.save_aviso(aviso(**cambio))
    assert server.list_avisos() == []


def test_receipt_only_leaves_event(server):
    server.save_aviso(aviso())
    server.ack_aviso({"id": "av_1", "crew": "ev2"})
    ev = server.docs.find("eventos", {"tipo": "aviso_recibido"})
    assert len(ev) == 1 and ev[0]["crew"] == "ev2"
    with pytest.raises(ValueError):
        server.ack_aviso({"id": "av_1", "crew": "ev9"})


def test_filters_by_region(server):
    server.save_aviso(aviso())
    server.save_aviso(aviso(id="av_2", region="jezero", lon=77.4, lat=18.4))
    assert [r["id"] for r in server.list_avisos("jezero")] == ["av_2"]
    assert len(server.list_avisos()) == 2
