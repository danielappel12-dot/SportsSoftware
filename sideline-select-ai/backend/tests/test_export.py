import csv
import os
from pathlib import Path

import pytest

from sideline import config
from sideline.security import PathNotAllowed, resolve_allowed, safe_component, validate_export_destination
from sideline.services import exporter as ex
from sideline.services.exporter import PhotoInfo


def info(i, name="IMG_1.jpg", cls="in_focus", numbers=(), burst=None, best=False, keeper=False, src="/nonexistent", names=None):
    return PhotoInfo(i, name, src, cls, list(numbers), names or {}, burst, best, keeper)


# ---- folder organisation ---------------------------------------------------------------------------------------

def test_preset_a_by_player():
    assert ex.folders_for(info(1, numbers=["15"]), "player", {}) == ["Players/15"]
    assert ex.folders_for(info(1), "player", {}) == ["Players/Unknown_Player"]
    assert ex.folders_for(info(1, numbers=["15", "22"]), "player", {}) == ["Players/15", "Players/22"]  # both players visible


def test_preset_b_by_focus():
    assert ex.folders_for(info(1, cls="in_focus"), "focus", {}) == ["In_Focus"]
    assert ex.folders_for(info(1, cls="review"), "focus", {}) == ["Review"]
    assert ex.folders_for(info(1, cls="out_of_focus"), "focus", {}) == ["Out_Of_Focus"]


def test_preset_c_player_and_focus():
    assert ex.folders_for(info(1, cls="review", numbers=["15"]), "player_focus", {}) == ["Players/15/Review"]
    assert ex.folders_for(info(1, cls="out_of_focus"), "player_focus", {}) == ["Players/Unknown_Player/Out_Of_Focus"]


def test_preset_d_best_frames():
    assert ex.folders_for(info(1, keeper=True), "best", {}) == ["Best_Frames"]
    assert ex.folders_for(info(1, best=True), "best", {}) == ["Best_Frames"]
    assert ex.folders_for(info(1), "best", {}) == ["Other_Frames"]
    assert ex.folders_for(info(1, best=True, cls="out_of_focus"), "best", {}) == ["Other_Frames"]


def test_preset_e_bursts():
    assert ex.folders_for(info(1, burst=1), "bursts", {}) == ["Bursts/Burst_0001"]
    assert ex.folders_for(info(1, burst=123), "bursts", {}) == ["Bursts/Burst_0123"]
    assert ex.folders_for(info(1), "bursts", {}) == ["Bursts/Singles"]


def test_custom_naming_and_roster_names():
    n = {"players_dir": "Roster", "player_format": "{number}_{name}", "in_focus": "Sharp"}
    assert ex.folders_for(info(1, numbers=["7"], names={"7": "Sam Lee"}), "player_focus", n) == ["Roster/7_Sam Lee/Sharp"]
    assert ex.folders_for(info(1, numbers=["8"]), "player", n) == ["Roster/8"]          # no roster entry -> number only
    assert ex.folders_for(info(1, burst=3), "bursts", {"burst_prefix": "Seq", "burst_pad": 2}) == ["Bursts/Seq03"]


def test_hostile_names_cannot_escape_the_destination():
    bad = {"players_dir": "../../etc", "unknown_player": "..\\..\\x"}
    out = ex.folders_for(info(1), "player", bad)[0]
    assert ".." not in out.split("/") and not out.startswith("/")
    assert safe_component("../../evil") == "__evil" or ".." not in safe_component("../../evil")
    assert safe_component("a/b\\c:d") == "a_b_c_d"
    assert safe_component("CON").startswith("_")
    assert safe_component("") == "_"
    h = ex.folders_for(info(1, numbers=["7"], names={"7": "../../x"}), "player", {"player_format": "{number}_{name}"})[0]
    assert ".." not in h.split("/")


# ---- filename collisions ---------------------------------------------------------------------------------------

def test_collisions_get_predictable_suffixes(tmp_path):
    taken: set[str] = set()
    a = ex.unique_name(tmp_path, "IMG_1.jpg", taken)
    b = ex.unique_name(tmp_path, "IMG_1.jpg", taken)
    c = ex.unique_name(tmp_path, "IMG_1.jpg", taken)
    assert a == ("IMG_1.jpg", False) and b == ("IMG_1_2.jpg", True) and c == ("IMG_1_3.jpg", True)
    assert ex.unique_name(tmp_path, "img_1.JPG", taken)[1] is True  # case-insensitive file systems


def test_existing_files_on_disk_are_never_targeted(tmp_path):
    (tmp_path / "IMG_1.jpg").write_bytes(b"precious")
    name, renamed = ex.unique_name(tmp_path, "IMG_1.jpg", set())
    assert name == "IMG_1_2.jpg" and renamed


def test_plan_resolves_same_filename_from_different_cards(tmp_path):
    srcs = []
    for i in range(3):
        p = tmp_path / f"card{i}" / "IMG_0001.JPG"
        p.parent.mkdir()
        p.write_bytes(b"x" * (i + 1))
        srcs.append(p)
    photos = [info(i + 1, "IMG_0001.JPG", src=str(p)) for i, p in enumerate(srcs)]
    plan = ex.build_plan(photos, tmp_path / "out", ["focus"])
    names = sorted(Path(i.dest_rel).name for i in plan.items)
    assert names == ["IMG_0001.JPG", "IMG_0001_2.JPG", "IMG_0001_3.JPG"]
    assert plan.summary()["renamed"] == 2
    assert [i.dest_rel for i in plan.items] == sorted(set(i.dest_rel for i in plan.items), key=[i.dest_rel for i in plan.items].index)  # unique


def test_plan_is_deterministic_and_handles_missing_sources(tmp_path):
    p = tmp_path / "a.jpg"
    p.write_bytes(b"1")
    photos = [info(1, "a.jpg", src=str(p)), info(2, "gone.jpg", src=str(tmp_path / "gone.jpg"))]
    p1 = ex.build_plan(photos, tmp_path / "o", ["focus", "bursts"])
    p2 = ex.build_plan(list(reversed(photos)), tmp_path / "o", ["focus", "bursts"])
    assert [(i.photo_id, i.dest_rel) for i in p1.items] == [(i.photo_id, i.dest_rel) for i in p2.items]
    assert any("missing" in w for w in p1.warnings) and p1.photo_count == 1


def test_combining_presets_and_deduping_same_folder(tmp_path):
    p = tmp_path / "a.jpg"
    p.write_bytes(b"1")
    plan = ex.build_plan([info(1, "a.jpg", numbers=["7"], burst=2, src=str(p))], tmp_path / "o", ["player", "focus", "bursts"])
    assert sorted(i.dest_rel for i in plan.items) == ["Bursts/Burst_0002/a.jpg", "In_Focus/a.jpg", "Players/7/a.jpg"]
    with pytest.raises(ex.ExportError):
        ex.build_plan([], tmp_path, [])
    with pytest.raises(ex.ExportError):
        ex.build_plan([], tmp_path, ["nope"])


# ---- export safety ---------------------------------------------------------------------------------------------

def test_copy_never_overwrites_existing_file(tmp_path):
    src = tmp_path / "src.jpg"
    src.write_bytes(b"NEW")
    dest = tmp_path / "out" / "src.jpg"
    dest.parent.mkdir()
    dest.write_bytes(b"PRECIOUS")
    final = ex.copy_exclusive(str(src), dest)
    assert dest.read_bytes() == b"PRECIOUS"
    assert final.name == "src_2.jpg" and final.read_bytes() == b"NEW"
    assert src.read_bytes() == b"NEW"  # original untouched


def test_move_requires_explicit_confirmation(env):
    plan = ex.Plan(root=env / "o", items=[ex.PlanItem(1, "x", "a/x.jpg", "focus")])
    with pytest.raises(ex.ExportError, match="confirmation"):
        ex.exporter.start(1, plan, "move", ["focus"], {"confirm_move": False})
    with pytest.raises(ex.ExportError, match="confirmation"):
        ex.exporter.start(1, plan, "move", ["focus"], {})
    with pytest.raises(ex.ExportError):
        ex.exporter.start(1, plan, "teleport", ["focus"], {})


def test_destination_validation(env):
    ok = validate_export_destination(str(env / "exports"))
    assert ok == (env / "exports").resolve()
    for bad in ["relative/path", "", "/etc/passwd-dir", "/", "/usr/local/x"]:
        with pytest.raises(PathNotAllowed):
            validate_export_destination(bad)
    f = env / "afile"
    f.write_text("x")
    with pytest.raises(PathNotAllowed):
        validate_export_destination(str(f))


def test_symlink_escape_is_rejected(env):
    outside = Path(os.path.realpath("/etc"))
    link = env / "sneaky"
    try:
        link.symlink_to(outside)
    except OSError:
        pytest.skip("symlinks unavailable")
    with pytest.raises(PathNotAllowed):
        resolve_allowed(str(link / "hostname"))


def test_csv_formula_injection_is_neutralised():
    text = ex._csv_text([{"filename": "=HYPERLINK(\"http://x\")", "player_names": "+cmd", "original_path": "ok"}])
    rows = list(csv.DictReader(text.splitlines()))
    assert rows[0]["filename"].startswith("'=") and rows[0]["player_names"].startswith("'+") and rows[0]["original_path"] == "ok"
