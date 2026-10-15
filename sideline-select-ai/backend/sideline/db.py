"""SQLite access + versioned migrations.

One connection per thread (WAL mode) – the job runner uses worker threads.
"""
from __future__ import annotations

import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from . import config

_local = threading.local()
_init_lock = threading.Lock()
_initialised: set[str] = set()


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_uid() -> str:
    return uuid.uuid4().hex[:16]


MIGRATIONS: list[tuple[int, str]] = [
    (
        1,
        """
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT 'football',
  game_date TEXT,
  notes TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  burst_counter INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE photos (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,                 -- stable public identifier
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  original_path TEXT NOT NULL,              -- where the photographer's file lives (never modified)
  moved_to TEXT,                            -- set only if the user explicitly chose "move" on export
  filename TEXT NOT NULL,
  ext TEXT NOT NULL,
  is_raw INTEGER NOT NULL DEFAULT 0,
  file_size INTEGER,
  file_mtime REAL,
  sha256 TEXT,
  width INTEGER, height INTEGER,
  capture_time TEXT, capture_ts REAL,
  camera_make TEXT, camera_model TEXT,
  exif_json TEXT,
  status TEXT NOT NULL DEFAULT 'new',       -- new | ingested | analyzed | skipped | error
  status_detail TEXT,
  reviewed INTEGER NOT NULL DEFAULT 0,      -- photographer has looked at it / corrected it
  phash TEXT, dhash TEXT, signature BLOB, hist BLOB, embedding BLOB,
  imported_at TEXT NOT NULL,
  analyzed_at TEXT,
  UNIQUE (project_id, original_path)
);
CREATE INDEX idx_photos_project_status ON photos(project_id, status);
CREATE INDEX idx_photos_sha ON photos(project_id, sha256);
CREATE INDEX idx_photos_time ON photos(project_id, capture_ts);

CREATE TABLE quality (
  photo_id INTEGER PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  global_sharpness REAL, subject_sharpness REAL, sharpness_score REAL,
  motion_blur REAL, subject_visibility REAL,
  clip_high REAL, clip_low REAL, mean_luma REAL, exposure_score REAL,
  face_count INTEGER, face_visible INTEGER,
  composition REAL, resolution_mp REAL, width INTEGER, height INTEGER,
  overall REAL, classification TEXT NOT NULL,   -- in_focus | review | out_of_focus
  basis TEXT NOT NULL,                          -- subject | global
  reasons TEXT, subject_bbox TEXT, thresholds TEXT
);
CREATE INDEX idx_quality_class ON quality(classification);

CREATE TABLE detected_players (
  id INTEGER PRIMARY KEY,
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  bx REAL, by REAL, bw REAL, bh REAL,           -- normalised bbox (0..1) in the oriented image
  det_conf REAL,
  number TEXT, number_conf REAL, raw_text TEXT, number_box TEXT,
  crop_path TEXT,
  status TEXT NOT NULL,                         -- auto | needs_review | unknown | confirmed
  source TEXT NOT NULL DEFAULT 'ocr',           -- ocr | burst | user
  note TEXT,
  appearance BLOB,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_players_photo ON detected_players(photo_id);
CREATE INDEX idx_players_number ON detected_players(number);

CREATE TABLE roster_entries (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  name TEXT NOT NULL,
  team TEXT,
  UNIQUE (project_id, number)
);

CREATE TABLE burst_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,   -- ids are never reused, so old correction snapshots cannot hit another group
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq_no INTEGER NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,            -- manually split/merged: auto grouping leaves it alone
  keep_all INTEGER NOT NULL DEFAULT 0,          -- "retain entire sequence"
  created_at TEXT NOT NULL,
  UNIQUE (project_id, seq_no)
);

CREATE TABLE burst_members (
  photo_id INTEGER PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  burst_id INTEGER NOT NULL REFERENCES burst_groups(id) ON DELETE CASCADE,
  rank INTEGER, rank_score REAL, is_best INTEGER NOT NULL DEFAULT 0,
  similarity REAL, rank_detail TEXT
);
CREATE INDEX idx_members_burst ON burst_members(burst_id);

CREATE TABLE keepers (
  photo_id INTEGER PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  keeper INTEGER NOT NULL,
  source TEXT NOT NULL,                         -- auto | user
  updated_at TEXT NOT NULL
);

CREATE TABLE user_corrections (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                           -- number | assign | keeper | burst
  summary TEXT,
  payload TEXT NOT NULL,                        -- JSON: enough to undo
  created_at TEXT NOT NULL,
  undone_at TEXT
);

CREATE TABLE processing_jobs (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,   -- queued | running | paused | cancelling | cancelled | completed | failed | interrupted
  phase TEXT,
  total INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
  message TEXT, error TEXT, params TEXT,
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
);

CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE export_history (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  destination TEXT NOT NULL,
  mode TEXT NOT NULL,                           -- copy | move
  presets TEXT, options TEXT,
  item_count INTEGER DEFAULT 0, failed_count INTEGER DEFAULT 0, total_count INTEGER DEFAULT 0, message TEXT,
  status TEXT NOT NULL, report_path TEXT, contact_sheet_path TEXT
);
CREATE TABLE export_items (
  id INTEGER PRIMARY KEY,
  export_id INTEGER NOT NULL REFERENCES export_history(id) ON DELETE CASCADE,
  photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
  src_path TEXT NOT NULL,
  dest_path TEXT NOT NULL,                      -- exported path, kept apart from photos.original_path
  status TEXT NOT NULL, error TEXT
);
""",
    ),
]


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path), timeout=30, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def migrate(conn: sqlite3.Connection) -> int:
    conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)")
    have = {r[0] for r in conn.execute("SELECT version FROM schema_migrations")}
    applied = 0
    for version, sql in MIGRATIONS:
        if version in have:
            continue
        conn.execute("BEGIN")
        try:
            for stmt in _split(sql):
                conn.execute(stmt)
            conn.execute("INSERT INTO schema_migrations VALUES (?,?)", (version, now()))
            conn.execute("COMMIT")
            applied += 1
        except Exception:
            conn.execute("ROLLBACK")
            raise
    return applied


def _split(script: str) -> list[str]:
    return [s.strip() for s in script.split(";") if s.strip()]


def get_conn() -> sqlite3.Connection:
    """Per-thread connection to the configured database (created + migrated on first use)."""
    path = config.db_path()
    key = str(path)
    conn = getattr(_local, "conn", None)
    if conn is not None and getattr(_local, "key", None) == key:
        return conn
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = _connect(path)
    with _init_lock:
        if key not in _initialised:
            migrate(conn)
            _initialised.add(key)
    _local.conn, _local.key = conn, key
    return conn


def reset_thread_connection() -> None:
    conn = getattr(_local, "conn", None)
    if conn is not None:
        conn.close()
    _local.conn = None


@contextmanager
def tx() -> Iterator[sqlite3.Connection]:
    """Explicit write transaction (BEGIN IMMEDIATE avoids upgrade deadlocks between workers)."""
    conn = get_conn()
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
