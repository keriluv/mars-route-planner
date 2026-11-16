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

CREATE TABLE IF NOT EXISTS explorer (
    id          TEXT PRIMARY KEY,
    role         TEXT NOT NULL,
    color       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mission (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    explorer  TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('primary', 'secondary')),
    origin      TEXT CHECK (origin IN ('assigned', 'own')),
    name      TEXT NOT NULL,
    lon         REAL, lat REAL,
    status      TEXT NOT NULL,
    km          REAL,
    created      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS finding (
    id          TEXT PRIMARY KEY,
    explorer  TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('mineral', 'rock', 'other')),
    note        TEXT,
    lon         REAL NOT NULL, lat REAL NOT NULL, elevation_m REAL,
    sol_min     REAL,
    km          REAL,
    has_photo  INTEGER NOT NULL DEFAULT 0,
    created      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS message (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    explorer  TEXT NOT NULL,
    sender   TEXT NOT NULL CHECK (sender IN ('explorer', 'earth', 'system')),
    text       TEXT NOT NULL,
    type        TEXT,
    lon         REAL, lat REAL,
    sol_min     REAL,
    created      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS report (
    id          TEXT PRIMARY KEY,
    author       TEXT NOT NULL,
    type        TEXT NOT NULL,
    lon         REAL NOT NULL,
    lat         REAL NOT NULL,
    elev_m      REAL DEFAULT 0.0,
    sol_min     REAL DEFAULT 0.0,
    km          REAL DEFAULT 0.0,
    text       TEXT NOT NULL,
    attachments_json TEXT DEFAULT '{}',
    sync_status TEXT NOT NULL DEFAULT 'local',
    created      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_finding_explorer ON finding(explorer);
CREATE INDEX IF NOT EXISTS ix_message_explorer ON message(explorer);
CREATE INDEX IF NOT EXISTS ix_mission_explorer ON mission(explorer);
CREATE INDEX IF NOT EXISTS ix_report_author ON report(author);

INSERT OR IGNORE INTO explorer (id, role, color) VALUES
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
        INSERT OR REPLACE INTO report (
            id, author, type, lon, lat, elev_m, sol_min, km, text, attachments_json, sync_status, created
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
        sql = "SELECT * FROM report WHERE id = ?"
        with self._lock:
            with self._get_connection() as conn:
                row = conn.execute(sql, (report_id,)).fetchone()
                if not row:
                    return None
                return Report(
                    id=row["id"],
                    author=row["author"],
                    type=row["type"],
                    lon=row["lon"],
                    lat=row["lat"],
                    elev_m=row["elev_m"],
                    sol_min=row["sol_min"],
                    km=row["km"],
                    text=row["text"],
                    attachments=json.loads(row["attachments_json"] or "{}"),
                    sync_status=row["sync_status"],
                    created_at=row["created"],
                )

    def list_reports(self, author: Optional[str] = None, limit: int = 100) -> List[Report]:
        """Lists reports in chronological order."""
        sql = "SELECT * FROM report"
        params: list[Any] = []
        if author:
            sql += " WHERE author = ?"
            params.append(author)
        sql += " ORDER BY created DESC LIMIT ?"
        params.append(limit)

        with self._lock:
            with self._get_connection() as conn:
                rows = conn.execute(sql, params).fetchall()
                return [
                    Report(
                        id=r["id"],
                        author=r["author"],
                        type=r["type"],
                        lon=r["lon"],
                        lat=r["lat"],
                        elev_m=r["elev_m"],
                        sol_min=r["sol_min"],
                        km=r["km"],
                        text=r["text"],
                        attachments=json.loads(r["attachments_json"] or "{}"),
                        sync_status=r["sync_status"],
                        created_at=r["created"],
                    )
                    for r in rows
                ]

    # ------------------------------------------------------------- Findings
    def save_finding(self, finding: Dict[str, Any]) -> None:
        """Records a geological finding."""
        sql = """
        INSERT OR REPLACE INTO finding (
            id, explorer, type, note, lon, lat, elevation_m, sol_min, km, has_photo
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        params = (
            finding["id"],
            finding.get("crew", finding.get("explorer", "ev1")),
            finding.get("type", "other"),
            finding.get("note", ""),
            finding["lon"],
            finding["lat"],
            finding.get("elev", finding.get("elevation_m", 0.0)),
            finding.get("simMin", finding.get("sol_min", 0.0)),
            finding.get("km", 0.0),
            1 if finding.get("photo", finding.get("has_photo")) else 0,
        )
        with self._lock:
            with self._get_connection() as conn:
                conn.execute(sql, params)
                conn.commit()

    def list_findings(self, crew: Optional[str] = None) -> List[Dict[str, Any]]:
        sql = "SELECT * FROM finding"
        params: list[Any] = []
        if crew:
            sql += " WHERE explorer = ?"
            params.append(crew)
        sql += " ORDER BY created DESC"
        with self._lock:
            with self._get_connection() as conn:
                return [dict(r) for r in conn.execute(sql, params).fetchall()]

    # ------------------------------------------------------------- Messages
    def save_message(self, msg: Dict[str, Any]) -> int:
        sql = """
        INSERT INTO message (explorer, sender, text, type, lon, lat, sol_min)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """
        params = (
            msg.get("crew", msg.get("explorer", "ev1")),
            msg.get("from", msg.get("sender", "explorer")),
            msg.get("text", msg.get("text", "")),
            msg.get("kind", msg.get("type", "text")),
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
        sql = "SELECT * FROM message"
        params: list[Any] = []
        if crew:
            sql += " WHERE explorer = ?"
            params.append(crew)
        sql += " ORDER BY id ASC"
        with self._lock:
            with self._get_connection() as conn:
                return [dict(r) for r in conn.execute(sql, params).fetchall()]
