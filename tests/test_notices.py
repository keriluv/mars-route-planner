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


def notice(**kw):
    base = {"id": "av_1", "author": "ev1", "kind": "finding", "text": "olivine", "lon": 137.5, "lat": -4.8, "simMin": 600}
    base.update(kw)
    return base


def test_publish_saves_record_and_event(server):
    server.save_notice(notice())
    rows = server.list_notices()
    assert [(r["id"], r["author"], r["kind"], r["status"]) for r in rows] == [("av_1", "ev1", "finding", "active")]
    events = server.docs.find("events", {"type": "notice_published"})
    assert len(events) == 1 and events[0]["notice_id"] == "av_1"


def test_resend_is_idempotent(server):
    server.save_notice(notice())
    server.save_notice(notice())
    assert len(server.list_notices()) == 1
    assert len(server.docs.find("events", {"type": "notice_published"})) == 1


def test_only_the_author_withdraws(server):
    server.save_notice(notice())
    server.withdraw_notice({"id": "av_1", "crew": "ev2"})
    assert server.list_notices()[0]["status"] == "active"
    server.withdraw_notice({"id": "av_1", "crew": "ev1"})
    assert server.list_notices()[0]["status"] == "withdrawn"
    assert len(server.docs.find("events", {"type": "notice_withdrawn"})) == 1


@pytest.mark.parametrize("cambio", [{"kind": "other"}, {"author": "ev9"}, {"text": ""}, {"lat": 200}, {"id": ""}])
def test_rejects_invalid_data(server, cambio):
    with pytest.raises(ValueError):
        server.save_notice(notice(**cambio))
    assert server.list_notices() == []


def test_receipt_only_leaves_event(server):
    server.save_notice(notice())
    server.ack_notice({"id": "av_1", "crew": "ev2"})
    ev = server.docs.find("events", {"type": "notice_received"})
    assert len(ev) == 1 and ev[0]["crew"] == "ev2"
    with pytest.raises(ValueError):
        server.ack_notice({"id": "av_1", "crew": "ev9"})


def test_filters_by_region(server):
    server.save_notice(notice())
    server.save_notice(notice(id="av_2", region="jezero", lon=77.4, lat=18.4))
    assert [r["id"] for r in server.list_notices("jezero")] == ["av_2"]
    assert len(server.list_notices()) == 2
