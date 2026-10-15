"""Manual corrections: every change is logged with enough state to undo it. Corrections survive re-analysis."""
from __future__ import annotations

import json

import numpy as np

from ..cv import hashing
from ..cv.jersey import normalise_number
from ..db import get_conn, now, tx
from ..settings import Settings
from . import bursts

_PLAYER_COLS = ("number", "number_conf", "status", "source", "note")


class CorrectionError(ValueError):
    pass


def _clean_number(number: str, settings: Settings) -> str:
    num, _ = normalise_number(str(number), max(settings.max_jersey_digits, 3), settings.allow_leading_zero)
    if num is None:
        raise CorrectionError(f"'{number}' is not a valid jersey number (digits only, up to {settings.max_jersey_digits}).")
    return num


def _log(t, project_id: int, kind: str, summary: str, payload: dict) -> int:
    return t.execute("INSERT INTO user_corrections(project_id,kind,summary,payload,created_at) VALUES(?,?,?,?,?)",
                     (project_id, kind, summary, json.dumps(payload), now())).lastrowid


def _player_state(c, player_id: int) -> dict:
    r = c.execute(f"SELECT {','.join(_PLAYER_COLS)} FROM detected_players WHERE id=?", (player_id,)).fetchone()
    return dict(r)


def _apply_player(t, player_id: int, number: str | None, note: str) -> None:
    t.execute("UPDATE detected_players SET number=?, number_conf=?, status=?, source='user', note=? WHERE id=?",
              (number, 1.0 if number else 0.0, "confirmed" if number else "unknown", note, player_id))


def set_player_number(player_id: int, number: str | None, settings: Settings) -> dict:
    """Confirm/correct a detected player's number. ``number=None`` marks it Unknown (e.g. false detection)."""
    c = get_conn()
    row = c.execute("SELECT d.id, d.photo_id, p.project_id FROM detected_players d JOIN photos p ON p.id=d.photo_id WHERE d.id=?",
                    (player_id,)).fetchone()
    if row is None:
        raise CorrectionError("Player not found.")
    num = _clean_number(number, settings) if number not in (None, "") else None
    before = _player_state(c, player_id)
    with tx() as t:
        _apply_player(t, player_id, num, "Set by photographer")
        t.execute("UPDATE photos SET reviewed=1 WHERE id=?", (row["photo_id"],))
        cid = _log(t, row["project_id"], "number", f"Set #{num} on photo {row['photo_id']}" if num else f"Cleared number on photo {row['photo_id']}",
                   {"ops": [{"player_id": player_id, "before": before}], "photos": [row["photo_id"]]})
    return {"correction_id": cid, "number": num}


def assign_photo(photo_id: int, number: str, settings: Settings) -> dict:
    """Manually assign a photo to a player number (adds a manual entry, or fills an unresolved detected player)."""
    c = get_conn()
    photo = c.execute("SELECT id, project_id FROM photos WHERE id=?", (photo_id,)).fetchone()
    if photo is None:
        raise CorrectionError("Photo not found.")
    num = _clean_number(number, settings)
    free = c.execute("SELECT id FROM detected_players WHERE photo_id=? AND status IN ('unknown','needs_review') "
                     "ORDER BY bw*bh DESC LIMIT 1", (photo_id,)).fetchone()
    with tx() as t:
        if free:
            before = _player_state(c, free["id"])
            _apply_player(t, free["id"], num, "Assigned by photographer")
            payload = {"ops": [{"player_id": free["id"], "before": before}], "photos": [photo_id]}
        else:
            pid = t.execute(
                """INSERT INTO detected_players(photo_id,bx,by,bw,bh,det_conf,number,number_conf,status,source,note,created_at)
                   VALUES(?,0,0,0,0,1,?,1,'confirmed','user','Manually assigned (no bounding box)',?)""",
                (photo_id, num, now())).lastrowid
            payload = {"ops": [{"player_id": pid, "created": True}], "photos": [photo_id]}
        t.execute("UPDATE photos SET reviewed=1 WHERE id=?", (photo_id,))
        cid = _log(t, photo["project_id"], "assign", f"Assigned photo {photo_id} to #{num}", payload)
    return {"correction_id": cid, "number": num}


def apply_to_burst(player_id: int, settings: Settings) -> dict:
    """Propagate a *confirmed* number to look-alike players in the other frames of the same burst."""
    c = get_conn()
    src = c.execute("""SELECT d.*, p.project_id FROM detected_players d JOIN photos p ON p.id=d.photo_id WHERE d.id=?""",
                    (player_id,)).fetchone()
    if src is None:
        raise CorrectionError("Player not found.")
    if src["status"] != "confirmed" or not src["number"]:
        raise CorrectionError("Confirm the number on this photo first, then apply it to the burst.")
    member = c.execute("SELECT burst_id FROM burst_members WHERE photo_id=?", (src["photo_id"],)).fetchone()
    if member is None:
        raise CorrectionError("This photo is not part of a burst group.")
    others = c.execute("SELECT photo_id FROM burst_members WHERE burst_id=? AND photo_id<>?", (member["burst_id"], src["photo_id"])).fetchall()
    src_app = np.frombuffer(src["appearance"], np.float32) if src["appearance"] else None
    ops, changed, skipped = [], [], 0
    with tx() as t:
        for o in others:
            rows = c.execute("SELECT * FROM detected_players WHERE photo_id=?", (o["photo_id"],)).fetchall()
            if any(r["status"] == "confirmed" and r["source"] == "user" and r["number"] == src["number"] for r in rows):
                continue
            target = None
            if rows:
                scored = []
                for r in rows:
                    if r["status"] == "confirmed" and r["source"] == "user":
                        continue  # never overwrite another confirmed decision
                    sim = hashing.hist_similarity(src_app, np.frombuffer(r["appearance"], np.float32)) \
                        if (src_app is not None and r["appearance"]) else 0.0
                    d = float(np.hypot(r["bx"] + r["bw"] / 2 - (src["bx"] + src["bw"] / 2), r["by"] + r["bh"] / 2 - (src["by"] + src["bh"] / 2)))
                    scored.append((sim * (1 - min(d, 1.0)), sim, r))
                scored.sort(key=lambda s: -s[0])
                if scored and (scored[0][1] >= 0.8 or (len(rows) == 1 and scored[0][1] >= 0.5)):
                    target = scored[0][2]
            if target is not None:
                ops.append({"player_id": target["id"], "before": {k: target[k] for k in _PLAYER_COLS}})
                _apply_player(t, target["id"], src["number"], f"Applied from burst correction on photo {src['photo_id']}")
                changed.append(o["photo_id"])
            elif not rows:
                pid = t.execute(
                    """INSERT INTO detected_players(photo_id,bx,by,bw,bh,det_conf,number,number_conf,status,source,note,created_at)
                       VALUES(?,0,0,0,0,1,?,1,'confirmed','user','Applied from burst (no detection in this frame)',?)""",
                    (o["photo_id"], src["number"], now())).lastrowid
                ops.append({"player_id": pid, "created": True})
                changed.append(o["photo_id"])
            else:
                skipped += 1
        for pid in changed:
            t.execute("UPDATE photos SET reviewed=1 WHERE id=?", (pid,))
        cid = _log(t, src["project_id"], "number", f"Applied #{src['number']} to {len(changed)} burst frame(s)",
                   {"ops": ops, "photos": changed}) if ops else None
    return {"correction_id": cid, "updated_photos": changed, "skipped": skipped}


def set_keeper(photo_ids: list[int], keeper: bool | None) -> dict:
    """keeper True/False = explicit user decision; None = clear back to automatic."""
    c = get_conn()
    if not photo_ids:
        return {"updated": 0}
    qs = ",".join("?" * len(photo_ids))
    rows = c.execute(f"SELECT id, project_id FROM photos WHERE id IN ({qs})", photo_ids).fetchall()
    if not rows:
        raise CorrectionError("No such photos.")
    project_id = rows[0]["project_id"]
    prev = {r["photo_id"]: {"keeper": r["keeper"], "source": r["source"]}
            for r in c.execute(f"SELECT * FROM keepers WHERE photo_id IN ({qs})", photo_ids)}
    ops = [{"photo_id": r["id"], "before": prev.get(r["id"])} for r in rows]
    with tx() as t:
        for r in rows:
            if keeper is None:
                t.execute("DELETE FROM keepers WHERE photo_id=?", (r["id"],))
            else:
                t.execute("INSERT INTO keepers(photo_id,keeper,source,updated_at) VALUES(?,?,'user',?) "
                          "ON CONFLICT(photo_id) DO UPDATE SET keeper=excluded.keeper, source='user', updated_at=excluded.updated_at",
                          (r["id"], int(keeper), now()))
        label = "Cleared" if keeper is None else ("Marked keeper" if keeper else "Rejected")
        cid = _log(t, project_id, "keeper", f"{label}: {len(rows)} photo(s)", {"ops": ops})
    return {"updated": len(rows), "correction_id": cid}


def set_keep_sequence(burst_id: int, keep_all: bool) -> None:
    with tx() as t:
        g = t.execute("SELECT project_id FROM burst_groups WHERE id=?", (burst_id,)).fetchone()
        if g is None:
            raise CorrectionError("Burst not found.")
        t.execute("UPDATE burst_groups SET keep_all=? WHERE id=?", (int(keep_all), burst_id))


def undo(correction_id: int, settings: Settings) -> dict:
    c = get_conn()
    row = c.execute("SELECT * FROM user_corrections WHERE id=?", (correction_id,)).fetchone()
    if row is None:
        raise CorrectionError("Correction not found.")
    if row["undone_at"]:
        raise CorrectionError("That correction was already undone.")
    payload = json.loads(row["payload"])
    kind = row["kind"]
    if kind == "burst":
        bursts.undo_burst_op(row["project_id"], payload, settings)
        with tx() as t:
            t.execute("UPDATE user_corrections SET undone_at=? WHERE id=?", (now(), correction_id))
        return {"undone": correction_id}
    with tx() as t:
        if kind in ("number", "assign"):
            for op in payload["ops"]:
                if op.get("created"):
                    t.execute("DELETE FROM detected_players WHERE id=?", (op["player_id"],))
                else:
                    b = op["before"]
                    t.execute("UPDATE detected_players SET number=?, number_conf=?, status=?, source=?, note=? WHERE id=?",
                              (b["number"], b["number_conf"], b["status"], b["source"], b["note"], op["player_id"]))
        elif kind == "keeper":
            for op in payload["ops"]:
                b = op["before"]
                if b is None:
                    t.execute("DELETE FROM keepers WHERE photo_id=?", (op["photo_id"],))
                else:
                    t.execute("INSERT INTO keepers(photo_id,keeper,source,updated_at) VALUES(?,?,?,?) "
                              "ON CONFLICT(photo_id) DO UPDATE SET keeper=excluded.keeper, source=excluded.source, updated_at=excluded.updated_at",
                              (op["photo_id"], b["keeper"], b["source"], now()))
        t.execute("UPDATE user_corrections SET undone_at=? WHERE id=?", (now(), correction_id))
    return {"undone": correction_id}


def reset_corrections(project_id: int) -> int:
    """Explicit reset: forget all manual player decisions + keeper picks (the only way analysis drops them)."""
    with tx() as t:
        n = t.execute("DELETE FROM detected_players WHERE source='user' AND photo_id IN (SELECT id FROM photos WHERE project_id=?)",
                      (project_id,)).rowcount
        t.execute("DELETE FROM keepers WHERE source='user' AND photo_id IN (SELECT id FROM photos WHERE project_id=?)", (project_id,))
        t.execute("UPDATE photos SET reviewed=0 WHERE project_id=?", (project_id,))
        t.execute("UPDATE user_corrections SET undone_at=? WHERE project_id=? AND undone_at IS NULL", (now(), project_id))
    return n
