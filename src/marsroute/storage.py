"""storage.py — Local SQLite persistence management for GaleX.

Provides structured relational storage for reports, logbook, findings,
missions and explorer telemetry, guaranteeing 100% offline operation.
"""
from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from marsroute.domain import Report

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "backend" / "data" / "mars_route.sqlite"

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS explorador (
    id          TEXT PRIMARY KEY,
    rol         TEXT NOT NULL,
    color       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mision (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    explorador  TEXT NOT NULL,
    tipo        TEXT NOT NULL CHECK (tipo IN ('principal', 'secundaria')),
    origen      TEXT CHECK (origen IN ('asignada', 'propia')),
    nombre      TEXT NOT NULL,
    lon         REAL, lat REAL,
    estado      TEXT NOT NULL,
    km          REAL,
    creado      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hallazgo (
    id          TEXT PRIMARY KEY,
    explorador  TEXT NOT NULL,
    tipo        TEXT NOT NULL CHECK (tipo IN ('mineral', 'roca', 'otro')),
    nota        TEXT,
    lon         REAL NOT NULL, lat REAL NOT NULL, altura_m REAL,
    sol_min     REAL,
    km          REAL,
    tiene_foto  INTEGER NOT NULL DEFAULT 0,
    creado      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mensaje (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    explorador  TEXT NOT NULL,
    remitente   TEXT NOT NULL CHECK (remitente IN ('explorador', 'tierra', 'sistema')),
    texto       TEXT NOT NULL,
    tipo        TEXT,
    lon         REAL, lat REAL,
    sol_min     REAL,
    creado      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reporte (
    id          TEXT PRIMARY KEY,
    autor       TEXT NOT NULL,
    tipo        TEXT NOT NULL,
    lon         REAL NOT NULL,
    lat         REAL NOT NULL,
    elev_m      REAL DEFAULT 0.0,
    sol_min     REAL DEFAULT 0.0,
    km          REAL DEFAULT 0.0,
    texto       TEXT NOT NULL,
    adjuntos_json TEXT DEFAULT '{}',
    sync_status TEXT NOT NULL DEFAULT 'local',
    creado      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_hallazgo_exp ON hallazgo(explorador);
CREATE INDEX IF NOT EXISTS ix_mensaje_exp ON mensaje(explorador);
CREATE INDEX IF NOT EXISTS ix_mision_exp ON mision(explorador);
CREATE INDEX IF NOT EXISTS ix_reporte_autor ON reporte(autor);

INSERT OR IGNORE INTO explorador (id, rol, color) VALUES
    ('ev1', 'Commander', '#1E64DC'),
    ('ev2', 'Geologist', '#B5651D'),
    ('ev3', 'Engineer',  '#127846');
"""


class _ClosingConnection(sqlite3.Connection):
    """`with sqlite3.connect(...)` commits or rolls back but does NOT close the connection: every call left one open
    (on Windows that prevents deleting the file). This variant also closes it on leaving the `with` block."""

    def __exit__(self, exc_type, exc, tb):
        try:
            return super().__exit__(exc_type, exc, tb)
        finally:
            self.close()


class Storage:
    """Thread-safe SQLite persistence manager for the prototype."""

    def __init__(self, db_path: Optional[Path | str] = None):
        self.db_path = Path(db_path) if db_path else DEFAULT_DB_PATH
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False, factory=_ClosingConnection)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._lock:
            with self._get_connection() as conn:
                conn.executescript(SCHEMA)
                conn.commit()

    # ------------------------------------------------------------- Reports
    def save_report(self, report: Report) -> None:
        """Saves or updates a report in SQLite."""
        sql = """
        INSERT OR REPLACE INTO reporte (
            id, autor, tipo, lon, lat, elev_m, sol_min, km, texto, adjuntos_json, sync_status, creado
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        params = (
            report.id,
            report.author,
            report.type,
            report.lon,
            report.lat,
            report.elev_m,
            report.sol_min,
            report.km,
            report.text,
            json.dumps(report.attachments, ensure_ascii=False),
            report.sync_status,
            report.created_at,
        )
        with self._lock:
            with self._get_connection() as conn:
                conn.execute(sql, params)
                conn.commit()

    def get_report(self, report_id: str) -> Optional[Report]:
        """Gets a report by its ID."""
        sql = "SELECT * FROM reporte WHERE id = ?"
        with self._lock:
            with self._get_connection() as conn:
                row = conn.execute(sql, (report_id,)).fetchone()
                if not row:
                    return None
                return Report(
                    id=row["id"],
                    author=row["autor"],
                    type=row["tipo"],
                    lon=row["lon"],
                    lat=row["lat"],
                    elev_m=row["elev_m"],
                    sol_min=row["sol_min"],
                    km=row["km"],
                    text=row["texto"],
                    attachments=json.loads(row["adjuntos_json"] or "{}"),
                    sync_status=row["sync_status"],
                    created_at=row["creado"],
                )

    def list_reports(self, author: Optional[str] = None, limit: int = 100) -> List[Report]:
        """Lists reports in chronological order."""
        sql = "SELECT * FROM reporte"
        params: list[Any] = []
        if author:
            sql += " WHERE autor = ?"
            params.append(author)
        sql += " ORDER BY creado DESC LIMIT ?"
        params.append(limit)

        with self._lock:
            with self._get_connection() as conn:
                rows = conn.execute(sql, params).fetchall()
                return [
                    Report(
                        id=r["id"],
                        author=r["autor"],
                        type=r["tipo"],
                        lon=r["lon"],
                        lat=r["lat"],
                        elev_m=r["elev_m"],
                        sol_min=r["sol_min"],
                        km=r["km"],
                        text=r["texto"],
                        attachments=json.loads(r["adjuntos_json"] or "{}"),
                        sync_status=r["sync_status"],
                        created_at=r["creado"],
                    )
                    for r in rows
                ]

    # ------------------------------------------------------------- Findings
    def save_finding(self, finding: Dict[str, Any]) -> None:
        """Records a geological finding."""
        sql = """
        INSERT OR REPLACE INTO hallazgo (
            id, explorador, tipo, nota, lon, lat, altura_m, sol_min, km, tiene_foto
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        params = (
            finding["id"],
            finding.get("crew", finding.get("explorador", "ev1")),
            finding.get("type", finding.get("tipo", "otro")),
            finding.get("note", finding.get("nota", "")),
            finding["lon"],
            finding["lat"],
            finding.get("elev", finding.get("altura_m", 0.0)),
            finding.get("simMin", finding.get("sol_min", 0.0)),
            finding.get("km", 0.0),
            1 if finding.get("photo", finding.get("tiene_foto")) else 0,
        )
        with self._lock:
            with self._get_connection() as conn:
                conn.execute(sql, params)
                conn.commit()

    def list_findings(self, crew: Optional[str] = None) -> List[Dict[str, Any]]:
        sql = "SELECT * FROM hallazgo"
        params: list[Any] = []
        if crew:
            sql += " WHERE explorador = ?"
            params.append(crew)
        sql += " ORDER BY creado DESC"
        with self._lock:
            with self._get_connection() as conn:
                return [dict(r) for r in conn.execute(sql, params).fetchall()]

    # ------------------------------------------------------------- Messages
    def save_message(self, msg: Dict[str, Any]) -> int:
        sql = """
        INSERT INTO mensaje (explorador, remitente, texto, tipo, lon, lat, sol_min)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """
        params = (
            msg.get("crew", msg.get("explorador", "ev1")),
            msg.get("from", msg.get("remitente", "explorador")),
            msg.get("text", msg.get("texto", "")),
            msg.get("kind", msg.get("tipo", "texto")),
            msg.get("lon"),
            msg.get("lat"),
            msg.get("sol_min", msg.get("t", 0.0)),
        )
        with self._lock:
            with self._get_connection() as conn:
                cur = conn.execute(sql, params)
                conn.commit()
                return cur.lastrowid or 0

    def list_messages(self, crew: Optional[str] = None) -> List[Dict[str, Any]]:
        sql = "SELECT * FROM mensaje"
        params: list[Any] = []
        if crew:
            sql += " WHERE explorador = ?"
            params.append(crew)
        sql += " ORDER BY id ASC"
        with self._lock:
            with self._get_connection() as conn:
                return [dict(r) for r in conn.execute(sql, params).fetchall()]
