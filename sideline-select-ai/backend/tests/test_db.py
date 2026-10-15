import sqlite3

import pytest

from sideline import db
from sideline.settings import Settings, load_settings, reset_settings, save_settings

TABLES = {"projects", "photos", "quality", "detected_players", "roster_entries", "burst_groups", "burst_members", "keepers",
          "user_corrections", "processing_jobs", "app_settings", "export_history", "export_items"}


def test_schema_has_every_required_table_and_migrations_are_idempotent(env):
    c = db.get_conn()
    names = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert TABLES <= names
    assert db.migrate(c) == 0  # second run applies nothing
    assert c.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0] == db.MIGRATIONS[-1][0]


def _project(c, name="G"):
    return c.execute("INSERT INTO projects(name,created_at,updated_at) VALUES(?,?,?)", (name, db.now(), db.now())).lastrowid


def _photo(c, pid, path="/x/a.jpg"):
    return c.execute("INSERT INTO photos(uid,project_id,original_path,filename,ext,imported_at) VALUES(?,?,?,?,?,?)",
                     (db.new_uid(), pid, path, "a.jpg", ".jpg", db.now())).lastrowid


def test_photo_identity_and_paths_are_unique_per_project(env):
    c = db.get_conn()
    p1, p2 = _project(c), _project(c, "H")
    a = _photo(c, p1)
    with pytest.raises(sqlite3.IntegrityError):
        _photo(c, p1)               # same file in the same project is not imported twice
    b = _photo(c, p2)               # but may exist in another project
    uids = [r[0] for r in c.execute("SELECT uid FROM photos")]
    assert len(set(uids)) == 2 and a != b


def test_original_and_exported_paths_are_stored_separately(env):
    c = db.get_conn()
    pid = _project(c)
    ph = _photo(c, pid)
    c.execute("INSERT INTO export_history(project_id,created_at,destination,mode,status) VALUES(?,?,?,?,?)", (pid, db.now(), "/out", "copy", "completed"))
    c.execute("INSERT INTO export_items(export_id,photo_id,src_path,dest_path,status) VALUES(1,?,?,?,?)", (ph, "/x/a.jpg", "/out/G/a.jpg", "copied"))
    assert c.execute("SELECT original_path FROM photos").fetchone()[0] == "/x/a.jpg"
    assert c.execute("SELECT dest_path FROM export_items").fetchone()[0] == "/out/G/a.jpg"


def test_deleting_a_project_cascades_but_nothing_else(env):
    c = db.get_conn()
    p1, p2 = _project(c), _project(c, "keep")
    a = _photo(c, p1)
    _photo(c, p2, "/y/b.jpg")
    c.execute("INSERT INTO keepers VALUES(?,1,'user',?)", (a, db.now()))
    c.execute("INSERT INTO roster_entries(project_id,number,name) VALUES(?,?,?)", (p1, "7", "Sam"))
    c.execute("DELETE FROM projects WHERE id=?", (p1,))
    assert c.execute("SELECT COUNT(*) FROM photos").fetchone()[0] == 1
    assert c.execute("SELECT COUNT(*) FROM keepers").fetchone()[0] == 0
    assert c.execute("SELECT COUNT(*) FROM roster_entries").fetchone()[0] == 0


def test_data_survives_reconnect(env):
    c = db.get_conn()
    pid = _project(c, "persist")
    db.reset_thread_connection()
    assert db.get_conn().execute("SELECT name FROM projects WHERE id=?", (pid,)).fetchone()[0] == "persist"


def test_transaction_rolls_back_on_error(env):
    c = db.get_conn()
    with pytest.raises(RuntimeError):
        with db.tx() as t:
            t.execute("INSERT INTO projects(name,created_at,updated_at) VALUES('x','a','b')")
            raise RuntimeError("boom")
    assert c.execute("SELECT COUNT(*) FROM projects").fetchone()[0] == 0


def test_settings_persist_validate_and_reset(env):
    assert load_settings() == Settings()
    s = Settings(focus_in_threshold=70, focus_out_threshold=40, burst_similarity=0.9, max_workers=4)
    save_settings(s)
    db.reset_thread_connection()
    got = load_settings()
    assert got.focus_in_threshold == 70 and got.burst_similarity == 0.9 and got.max_workers == 4
    with pytest.raises(ValueError):
        Settings(focus_in_threshold=30, focus_out_threshold=50)       # inverted thresholds
    with pytest.raises(ValueError):
        Settings(number_confidence=0.5, number_review_floor=0.6)
    assert reset_settings() == Settings() and load_settings() == Settings()


def test_corrupt_settings_row_falls_back_to_defaults(env):
    db.get_conn().execute("INSERT INTO app_settings VALUES('focus_in_threshold','\"not a number\"')")
    assert load_settings() == Settings()
