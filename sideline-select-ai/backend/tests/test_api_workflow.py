"""End-to-end through the HTTP API using the synthetic demo set (real image processing, no model weights)."""
import csv
import hashlib
import os
import time
from pathlib import Path

import pytest

from conftest import wait_job
from sideline import db
from sideline.services import exporter as ex
from sideline.services import jobs
from sideline.services.demo import generate_demo_set


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


@pytest.fixture()
def demo(client, env):
    r = client.post("/api/projects/demo").json()
    pid = r["project"]["id"]
    job = wait_job(client, pid)
    assert job["status"] == "completed", job
    return pid


def test_import_flow_counts_skips_and_corrupt_files(client, demo):
    st = client.get(f"/api/projects/{demo}/stats").json()
    assert st["total"] == 32 and st["analyzed"] == 30
    assert st["skipped"] == 1 and st["errors"] == 1 and st["pending"] == 0 and st["progress"] == 100
    problems = {p["filename"]: p for p in client.get(f"/api/projects/{demo}/problems").json()}
    assert "Identical file already imported" in problems["DEMO_DUPLICATE_of_0001.jpg"]["status_detail"]
    assert "Could not read image" in problems["DEMO_CORRUPT.jpg"]["status_detail"]   # clear message, job did not stop


def test_demo_results_match_ground_truth(client, demo):
    items = client.get(f"/api/projects/{demo}/photos?limit=100").json()["items"]
    manifest = None
    ground = {1: "7", 2: "12", 3: "23", 4: "88", 5: "5"}
    bursts = client.get(f"/api/projects/{demo}/bursts").json()
    assert len(bursts) == 5 and all(b["size"] == 6 for b in bursts)
    assert {b["seq_no"]: b["numbers"] for b in bursts} == {k: [v] for k, v in ground.items()}
    cls = {i["filename"]: i["classification"] for i in items}
    assert cls["DEMO_0003.jpg"] == "out_of_focus"           # 'soft' frame
    assert cls["DEMO_0006.jpg"] == "out_of_focus"           # motion-blurred frame
    assert cls["DEMO_0001.jpg"] == "in_focus"
    # best frame of every burst is a sharp one, flagged, and an auto keeper
    for b in bursts:
        d = client.get(f"/api/bursts/{b['id']}").json()
        best = d["photos"][0]
        assert best["is_best"] and best["classification"] == "in_focus" and best["keeper"]
        assert [p["burst_rank"] for p in d["photos"]] == [1, 2, 3, 4, 5, 6]
        assert d["photos"][-1]["classification"] == "out_of_focus"          # worst frame ranked last
    d = client.get(f"/api/photos/{items[0]['id']}").json()
    assert d["quality"]["reasons"] and d["quality"]["thresholds"]["detector"] == "demo-color"
    assert d["players_detail"][0]["status"] in ("auto", "confirmed")


def test_originals_are_never_modified(client, env):
    r = client.post("/api/projects/demo").json()
    pid = r["project"]["id"]
    src_dir = Path(env / "data" / "demo_samples" / f"project_{pid}")
    before = {p.name: (sha(p), p.stat().st_mtime_ns) for p in src_dir.iterdir()}
    wait_job(client, pid)
    after = {p.name: (sha(p), p.stat().st_mtime_ns) for p in src_dir.iterdir()}
    assert before == after


def test_reimport_is_idempotent(client, demo, env):
    d = Path(env / "data" / "demo_samples" / f"project_{demo}")
    r = client.post(f"/api/projects/{demo}/import", json={"paths": [str(d)]}).json()
    assert r["added"] == 0 and r["already_imported"] >= 31
    job = wait_job(client, demo)
    assert job["total"] == 0  # nothing was processed twice


def test_corrections_undo_and_survive_reanalysis(client, demo):
    unknown = client.get(f"/api/projects/{demo}/photos?number=unknown&limit=100").json()["items"]
    assert unknown, "blurred frames should have unresolved numbers"
    target = unknown[0]
    detail = client.get(f"/api/photos/{target['id']}").json()
    r = client.post(f"/api/photos/{target['id']}/assign", json={"number": "99"})
    assert r.status_code == 200
    after = client.get(f"/api/photos/{target['id']}").json()
    assert any(p["number"] == "99" and p["status"] == "confirmed" for p in after["players_detail"]) and after["reviewed"]
    # rerun analysis: the correction must still be there
    client.post(f"/api/projects/{demo}/process", json={"reanalyze": True})
    wait_job(client, demo)
    again = client.get(f"/api/photos/{target['id']}").json()
    assert any(p["number"] == "99" and p["source"] == "user" for p in again["players_detail"])
    # undo restores the earlier state
    assert client.post(f"/api/corrections/{r.json()['correction_id']}/undo").status_code == 200
    undone = client.get(f"/api/photos/{target['id']}").json()
    assert not any(p["number"] == "99" for p in undone["players_detail"])
    assert client.post(f"/api/corrections/{r.json()['correction_id']}/undo").status_code == 400  # already undone


def test_apply_confirmed_number_to_burst(client, demo):
    d = client.get(f"/api/bursts/{client.get(f'/api/projects/{demo}/bursts').json()[0]['id']}").json()
    ids = [p["id"] for p in d["photos"]]
    first = client.get(f"/api/photos/{ids[0]}").json()["players_detail"][0]
    assert client.post(f"/api/players/{first['id']}/apply-burst").status_code == 400      # must confirm first
    assert client.post(f"/api/players/{first['id']}/number", json={"number": "07"}).status_code == 200
    res = client.post(f"/api/players/{first['id']}/apply-burst").json()
    assert len(res["updated_photos"]) == 5
    for pid in ids:
        assert any(p["number"] == "07" and p["status"] == "confirmed" for p in client.get(f"/api/photos/{pid}").json()["players_detail"])
    client.post(f"/api/corrections/{res['correction_id']}/undo")
    assert not any(p["number"] == "07" for p in client.get(f"/api/photos/{ids[1]}").json()["players_detail"])
    assert client.post(f"/api/players/{first['id']}/number", json={"number": "ABC"}).status_code == 400   # validated


def test_roster_maps_numbers_to_names(client, demo):
    client.post(f"/api/projects/{demo}/roster", json={"number": "7", "name": "Sam Rivera"})
    r = client.post(f"/api/projects/{demo}/roster/import", json={"csv_text": "number,name,team\n12,Alex Kim,Home\n#23,Jo Park\nxx,bad"}).json()
    assert r["imported"] == 2
    players = {p["number"]: p for p in client.get(f"/api/projects/{demo}/players").json()["players"]}
    assert players["7"]["name"] == "Sam Rivera" and players["23"]["name"] == "Jo Park"
    assert client.get(f"/api/projects/{demo}/photos?number=7").json()["total"] >= 5


def test_burst_split_merge_and_undo(client, demo):
    bursts = client.get(f"/api/projects/{demo}/bursts").json()
    b1, b2 = bursts[0], bursts[1]
    d1 = client.get(f"/api/bursts/{b1['id']}").json()
    split_ids = [p["id"] for p in d1["photos"][:2]]
    r = client.post(f"/api/projects/{demo}/bursts/split", json={"photo_ids": split_ids}).json()
    after = client.get(f"/api/projects/{demo}/bursts").json()
    assert len(after) == 6 and sorted(b["size"] for b in after).count(2) == 1
    assert client.post(f"/api/corrections/{r['correction_id']}/undo").status_code == 200
    restored = client.get(f"/api/projects/{demo}/bursts").json()
    assert sorted(b["size"] for b in restored) == [6] * 5
    assert [b["seq_no"] for b in restored] == [1, 2, 3, 4, 5]          # stable Burst_NNNN numbers come back
    b1, b2 = restored[0], restored[1]                                    # (group ids are fresh after an undo)
    m = client.post(f"/api/projects/{demo}/bursts/merge", json={"burst_ids": [b1["id"], b2["id"]]}).json()
    merged = client.get(f"/api/projects/{demo}/bursts").json()
    assert len(merged) == 4 and max(b["size"] for b in merged) == 12 and any(b["locked"] for b in merged)
    # a re-group must leave the manual (locked) group alone
    client.post(f"/api/projects/{demo}/process", json={"regroup_only": True})
    wait_job(client, demo)
    assert max(b["size"] for b in client.get(f"/api/projects/{demo}/bursts").json()) == 12
    client.post(f"/api/corrections/{m['correction_id']}/undo")
    assert sorted(b["size"] for b in client.get(f"/api/projects/{demo}/bursts").json()) == [6] * 5
    assert client.post(f"/api/projects/{demo}/bursts/merge", json={"burst_ids": [b1["id"]]}).status_code == 400


def test_keepers_manual_override_and_keep_sequence(client, demo):
    b = client.get(f"/api/projects/{demo}/bursts").json()[0]
    d = client.get(f"/api/bursts/{b['id']}").json()
    best, other = d["photos"][0]["id"], d["photos"][1]["id"]
    r = client.post("/api/photos/keepers", json={"photo_ids": [best], "keeper": False}).json()      # reject the auto pick
    client.post("/api/photos/keepers", json={"photo_ids": [other], "keeper": True})
    got = {p["id"]: p["keeper"] for p in client.get(f"/api/bursts/{b['id']}").json()["photos"]}
    assert got[best] is False and got[other] is True
    client.post(f"/api/projects/{demo}/process", json={"regroup_only": True}); wait_job(client, demo)
    got = {p["id"]: p["keeper"] for p in client.get(f"/api/bursts/{b['id']}").json()["photos"]}
    assert got[best] is False and got[other] is True                    # user decisions survive regrouping
    client.post(f"/api/corrections/{r['correction_id']}/undo")
    assert {p["id"]: p["keeper"] for p in client.get(f"/api/bursts/{b['id']}").json()["photos"]}[best] is True
    client.post(f"/api/bursts/{b['id']}/keep-all", json={"keep_all": True})
    assert all(p["keeper"] or p["id"] == best for p in client.get(f"/api/bursts/{b['id']}").json()["photos"])


def test_export_preview_copy_csv_contact_sheet_and_no_overwrite(client, demo, env):
    out = env / "exports"
    body = {"destination": str(out), "presets": ["player_focus", "bursts"], "scope": "all", "csv": True, "contact_sheet": True}
    pv = client.post(f"/api/projects/{demo}/export/preview", json=body).json()
    assert pv["photos"] == 30 and pv["files"] == 60 and "Bursts/Burst_0001" in pv["folders"]
    assert not out.exists()                                  # preview touches nothing
    eid = client.post(f"/api/projects/{demo}/export", json=body).json()["export_id"]
    ex.exporter.wait(eid, 60)
    st = client.get(f"/api/exports/{eid}").json()
    assert st["status"] == "completed" and st["item_count"] == 60 and st["failed_count"] == 0
    root = Path(st["destination"])
    assert len(list((root / "Bursts").rglob("*.jpg"))) == 30
    rows = list(csv.DictReader(open(st["report_path"], encoding="utf-8-sig")))
    assert len(rows) == 32 and {"filename", "player_numbers", "burst_id", "focus_class", "capture_time"} <= set(rows[0])
    assert Path(st["contact_sheet_path"].split("; ")[0]).exists()
    # export again to the same place: nothing is overwritten, new files get suffixes
    sizes = {p: p.stat().st_mtime_ns for p in root.rglob("*.jpg") if "Contact" not in p.name}
    eid2 = client.post(f"/api/projects/{demo}/export", json=body).json()["export_id"]
    ex.exporter.wait(eid2, 60)
    for p, m in sizes.items():
        assert p.stat().st_mtime_ns == m
    assert (root / "Bursts" / "Burst_0001" / "DEMO_0001_2.jpg").exists()
    assert len(client.get(f"/api/projects/{demo}/exports").json()) == 2


def test_export_keepers_only_and_move_needs_confirmation(client, demo, env):
    keepers = client.get(f"/api/projects/{demo}/photos?keeper=yes").json()["total"]
    assert keepers >= 5
    body = {"destination": str(env / "k"), "presets": ["best"], "scope": "keepers", "csv": False}
    pv = client.post(f"/api/projects/{demo}/export/preview", json=body).json()
    assert pv["files"] == keepers and list(pv["folders"]) == ["DEMO – synthetic sample game/Best_Frames".split("/", 1)[1]]
    mv = {**body, "mode": "move"}
    assert client.post(f"/api/projects/{demo}/export", json=mv).status_code == 400          # not confirmed -> refused
    src_dir = env / "data" / "demo_samples" / f"project_{demo}"
    n_before = len(list(src_dir.glob("*.jpg")))
    eid = client.post(f"/api/projects/{demo}/export", json={**mv, "confirm_move": True}).json()["export_id"]
    ex.exporter.wait(eid, 60)
    assert client.get(f"/api/exports/{eid}").json()["status"] == "completed"
    assert len(list(src_dir.glob("*.jpg"))) == n_before - keepers
    moved = client.get(f"/api/projects/{demo}/photos?keeper=yes").json()["items"][0]
    assert client.get(f"/api/photos/{moved['id']}").json()["moved_to"]        # original path preserved, new location recorded
    assert client.get(f"/api/photos/{moved['id']}/full").status_code == 200   # still viewable from the moved file


def test_export_rejects_bad_destinations(client, demo):
    for dest in ["/etc", "relative", "/"]:
        r = client.post(f"/api/projects/{demo}/export/preview", json={"destination": dest, "presets": ["focus"]})
        assert r.status_code == 400


def test_filters_search_and_views(client, demo):
    g = lambda q: client.get(f"/api/projects/{demo}/photos?{q}").json()  # noqa: E731
    assert g("")["total"] == 30
    assert g("view=out_of_focus")["total"] == sum(1 for i in g("")["items"] if i["classification"] == "out_of_focus")
    assert g("q=0007")["total"] == 1
    assert g("q=%25")["total"] == 0                               # wildcard characters are escaped
    assert g("focus=in_focus,review&min_quality=70")["total"] <= g("focus=in_focus,review")["total"]
    assert g("burst=2")["total"] == 6
    assert g("number=12")["total"] >= 5
    assert g("date_from=2025-09-06T19:30:00&date_to=2025-09-06T19:30:30")["total"] == 6
    assert g("sort=quality")["items"][0]["overall"] >= g("sort=quality")["items"][-1]["overall"]
    assert client.get(f"/api/projects/{demo}/photos?view=nope").status_code == 400
    assert g("include_problems=true")["total"] == 32


def test_files_are_served(client, demo):
    pid = client.get(f"/api/projects/{demo}/photos?limit=1").json()["items"][0]["id"]
    for kind in ("thumb", "preview", "full"):
        r = client.get(f"/api/photos/{pid}/{kind}")
        assert r.status_code == 200 and r.headers["content-type"].startswith("image/")
    player = client.get(f"/api/photos/{pid}").json()["players_detail"][0]["id"]
    assert client.get(f"/api/players/{player}/crop").status_code == 200


def test_upload_path_drag_and_drop(client, env):
    pid = client.post("/api/projects", json={"name": "Upload test"}).json()["id"]
    src = env / "src"
    generate_demo_set(src, plays=1, frames_per_play=3, extras=False)
    files = [("files", (p.name, p.read_bytes(), "image/jpeg")) for p in sorted(src.glob("*.jpg"))]
    files.append(("files", ("evil.exe", b"MZ", "application/octet-stream")))
    files.append(("files", ("../../escape.jpg", (src / "DEMO_0001.jpg").read_bytes(), "image/jpeg")))
    r = client.post(f"/api/projects/{pid}/upload", files=files).json()
    assert r["saved"] == 4 and any("evil.exe" in x for x in r["rejected"])
    assert not (env / "escape.jpg").exists() and not (env / "data" / "escape.jpg").exists()   # path traversal neutralised
    assert wait_job(client, pid)["status"] == "completed"
    st = client.get(f"/api/projects/{pid}/stats").json()
    assert st["analyzed"] == 3 and st["skipped"] == 1       # the re-uploaded copy is a content duplicate


def test_path_security_on_import_and_browse(client, env):
    pid = client.post("/api/projects", json={"name": "Sec"}).json()["id"]
    r = client.post(f"/api/projects/{pid}/import", json={"paths": ["/etc"]}).json()
    assert r["found"] == 0 and r["messages"]
    assert client.get("/api/fs/browse", params={"path": "/etc"}).status_code == 400
    assert client.get("/api/fs/browse", params={"path": str(env)}).status_code == 200
    assert client.get("/api/fs/browse").json()["dirs"]


def test_cross_origin_writes_and_foreign_hosts_are_blocked(client):
    r = client.post("/api/projects", json={"name": "x"}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    assert client.get("/api/health", headers={"Host": "evil.example"}).status_code == 400
    assert client.post("/api/projects", json={"name": "x"}, headers={"Origin": "http://localhost:5173"}).status_code == 200


def test_unsupported_raw_gives_clear_message(client, env):
    pid = client.post("/api/projects", json={"name": "RAW"}).json()["id"]
    f = env / "pics"
    f.mkdir()
    (f / "IMG_0001.CR3").write_bytes(b"not really a raw file")
    client.post(f"/api/projects/{pid}/import", json={"paths": [str(f)]})
    wait_job(client, pid)
    p = client.get(f"/api/projects/{pid}/problems").json()[0]
    assert p["status"] == "error" and ("rawpy" in p["status_detail"] or "RAW" in p["status_detail"])


def test_pause_resume_cancel_and_restart_recovery(client, env):
    pid = client.post("/api/projects", json={"name": "Jobs"}).json()["id"]
    src = env / "many"
    generate_demo_set(src, plays=4, frames_per_play=6, extras=False)
    client.post(f"/api/projects/{pid}/import", json={"paths": [str(src)], "start": False})
    jid = client.post(f"/api/projects/{pid}/process").json()["job_id"]
    client.post(f"/api/jobs/{jid}/pause")
    time.sleep(0.6)
    paused = client.get(f"/api/projects/{pid}/jobs").json()[0]
    assert paused["status"] == "paused"
    done_at_pause = paused["done"]
    time.sleep(0.5)
    assert client.get(f"/api/projects/{pid}/jobs").json()[0]["done"] <= done_at_pause + 4   # in-flight work may finish, no more starts
    assert client.post(f"/api/projects/{pid}/process").status_code == 409                    # one active job per project
    client.post(f"/api/jobs/{jid}/resume")
    job = wait_job(client, pid)
    assert job["status"] == "completed" and client.get(f"/api/projects/{pid}/stats").json()["analyzed"] == 24
    # cancel keeps progress, and a later run only does the remaining work
    pid2 = client.post("/api/projects", json={"name": "Cancel"}).json()["id"]
    client.post(f"/api/projects/{pid2}/import", json={"paths": [str(src)], "start": False})
    jid2 = client.post(f"/api/projects/{pid2}/process").json()["job_id"]
    client.post(f"/api/jobs/{jid2}/cancel")
    j = wait_job(client, pid2)
    assert j["status"] == "cancelled"
    left = client.get(f"/api/projects/{pid2}/stats").json()
    client.post(f"/api/projects/{pid2}/process")
    j2 = wait_job(client, pid2)
    assert j2["status"] == "completed" and j2["total"] == left["pending"]
    assert client.get(f"/api/projects/{pid2}/stats").json()["analyzed"] == 24
    # a job that was running when the app died becomes resumable
    c = db.get_conn()
    c.execute("INSERT INTO processing_jobs(project_id,kind,status,created_at) VALUES(?,?,?,?)", (pid2, "process", "running", db.now()))
    jobs.runner.recover()
    assert c.execute("SELECT status FROM processing_jobs ORDER BY id DESC LIMIT 1").fetchone()[0] == "interrupted"


def test_unavailable_models_are_reported_not_faked(client, env):
    """A real (non-demo) project without YOLO weights / OCR must not invent players or numbers."""
    pid = client.post("/api/projects", json={"name": "Real"}).json()["id"]
    src = env / "real"
    generate_demo_set(src, plays=1, frames_per_play=3, extras=False)
    client.post(f"/api/projects/{pid}/import", json={"paths": [str(src)]})
    wait_job(client, pid)
    status = client.get("/api/system/status", params={"project_id": pid}).json()
    assert status["engines"]["detector"]["name"] == "none" and not status["engines"]["detector"]["ok"]
    assert "docs/MODELS.md" in status["engines"]["detector"]["message"] or "No detector" in status["engines"]["detector"]["message"]
    items = client.get(f"/api/projects/{pid}/photos").json()["items"]
    assert items and all(i["players"] == [] for i in items)
    d = client.get(f"/api/photos/{items[0]['id']}").json()
    assert d["quality"]["basis"] == "global" and d["needs_review"] in (True, False)
    assert any("whole" in r.lower() or "unavailable" in r.lower() for r in d["quality"]["reasons"])
    nr = client.get(f"/api/projects/{pid}/photos?view=needs_review").json()["total"]
    assert nr >= 1                                           # no confident player -> flagged, never silently accepted


def test_settings_api_validates_and_changes_results(client, demo):
    s = client.get("/api/settings").json()
    assert client.put("/api/settings", json={**s, "focus_in_threshold": 20, "focus_out_threshold": 30}).status_code == 422
    assert client.put("/api/settings", json={**s, "focus_in_threshold": 95, "focus_out_threshold": 60}).status_code == 200
    client.post(f"/api/projects/{demo}/process", json={"reanalyze": True})
    wait_job(client, demo)
    items = client.get(f"/api/projects/{demo}/photos").json()["items"]
    assert not any(i["classification"] == "in_focus" for i in items)      # strict thresholds -> nothing is 'in focus'
    assert client.post("/api/settings/reset").json()["focus_in_threshold"] == 55


def test_burst_number_suggestions_are_never_auto_confirmed(client, demo):
    c = db.get_conn()
    rows = c.execute("SELECT d.status, d.source, d.note, d.number, p.filename FROM detected_players d JOIN photos p ON p.id=d.photo_id "
                     "WHERE d.source='burst'").fetchall()
    assert rows, "blurred frames in a burst should receive a *suggestion* from the sharp frames of the same player"
    for r in rows:
        assert r["status"] == "needs_review" and "Not confirmed" in r["note"]
    # a suggestion is not a confident number: the photo is still routed to the review queue and exports as Unknown
    name = rows[0]["filename"]
    item = next(i for i in client.get(f"/api/projects/{demo}/photos?q={name}").json()["items"])
    assert item["players"][0]["status"] == "needs_review"
    assert item["needs_review"] or item["classification"] == "out_of_focus"
