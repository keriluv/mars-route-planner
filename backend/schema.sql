-- =========================================================
-- RELATIONAL database (SQLite) — Safe route to Mount Sharp
-- Stores what has a fixed structure and clear relations:
-- explorers, missions, findings and logbook messages.
-- =========================================================
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS explorer (
    id          TEXT PRIMARY KEY,              -- ev1, ev2, ev3
    role         TEXT NOT NULL,
    color       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mission (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    explorer  TEXT NOT NULL REFERENCES explorer(id),
    type        TEXT NOT NULL CHECK (type IN ('primary', 'secondary')),
    origin      TEXT CHECK (origin IN ('assigned', 'own')),
    name      TEXT NOT NULL,
    lon         REAL, lat REAL,
    status      TEXT NOT NULL,                 -- proposed, accepted, in progress, completed, aborted
    km          REAL,
    created      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS finding (
    id          TEXT PRIMARY KEY,
    explorer  TEXT NOT NULL REFERENCES explorer(id),
    type        TEXT NOT NULL CHECK (type IN ('mineral', 'rock', 'other')),
    note        TEXT,
    lon         REAL NOT NULL, lat REAL NOT NULL, elevation_m REAL,
    sol_min     REAL,                          -- Martian minutes since the start
    km          REAL,
    has_photo  INTEGER NOT NULL DEFAULT 0,
    created      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS message (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    explorer  TEXT NOT NULL REFERENCES explorer(id),
    sender   TEXT NOT NULL CHECK (sender IN ('explorer', 'earth', 'system')),
    text       TEXT NOT NULL,
    type        TEXT,                          -- text, finding, mission, pos, status
    lon         REAL, lat REAL,
    sol_min     REAL,
    created      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS report (
    id          TEXT PRIMARY KEY,
    author       TEXT NOT NULL REFERENCES explorer(id),
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

-- Shared notices: a finding or alert from one explorer that the others see on their map and logbook.
-- Each explorer continues their own separate trip; this only notifies. The events (published, received, withdrawn)
-- go to the JSONL store (collection "events"), not here.
CREATE TABLE IF NOT EXISTS notice (
    id          TEXT PRIMARY KEY,
    author       TEXT NOT NULL REFERENCES explorer(id),
    type        TEXT NOT NULL CHECK (type IN ('finding', 'slope_alert', 'radiation_alert')),
    text       TEXT NOT NULL,
    lon         REAL NOT NULL, lat REAL NOT NULL,
    radius_km    REAL NOT NULL DEFAULT 0.3,       -- size of the zone drawn on the map
    region      TEXT NOT NULL DEFAULT 'gale',
    sol_min     REAL,                            -- author's clock (each trip has its own)
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
    created      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_notice_author ON notice(author);

CREATE INDEX IF NOT EXISTS ix_finding_explorer ON finding(explorer);
CREATE INDEX IF NOT EXISTS ix_message_explorer ON message(explorer);
CREATE INDEX IF NOT EXISTS ix_mission_explorer ON mission(explorer);
CREATE INDEX IF NOT EXISTS ix_report_author ON report(author);

INSERT OR IGNORE INTO explorer (id, role, color) VALUES
    ('ev1', 'Commander', '#1E64DC'),
    ('ev2', 'Geologist', '#B5651D'),
    ('ev3', 'Engineer',  '#127846');
