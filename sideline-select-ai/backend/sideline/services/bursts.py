"""DB-level burst grouping, ranking, auto-keepers, burst-level number suggestions and manual split/merge."""
from __future__ import annotations

import json
import sqlite3

import numpy as np

from ..cv import burst as B
from ..cv import hashing
from ..db import get_conn, now, tx
from ..settings import Settings


def _sig_from_row(r: sqlite3.Row, numbers: frozenset[str]) -> B.PhotoSig:
    emb = np.frombuffer(r["embedding"], np.float32) if r["embedding"] else None
    return B.PhotoSig(
        id=r["id"], name=r["filename"], ts=r["capture_ts"], phash=hashing.from_hex(r["phash"]),
        dhash=hashing.from_hex(r["dhash"]), sig=np.frombuffer(r["signature"], np.uint8).reshape(16, 16),
        hist=np.frombuffer(r["hist"], np.float32), numbers=numbers, embedding=emb)


def _confident_numbers(c: sqlite3.Connection, project_id: int) -> dict[int, set[str]]:
    out: dict[int, set[str]] = {}
    for r in c.execute(
            """SELECT d.photo_id, d.number FROM detected_players d JOIN photos p ON p.id=d.photo_id
               WHERE p.project_id=? AND d.number IS NOT NULL AND d.status IN ('auto','confirmed')""", (project_id,)):
        out.setdefault(r["photo_id"], set()).add(r["number"])
    return out


def rebuild_bursts(project_id: int, settings: Settings) -> dict:
    """Re-run automatic grouping. Manually split/merged (locked) groups and their photos are left untouched."""
    c = get_conn()
    locked_photos = {r[0] for r in c.execute(
        "SELECT m.photo_id FROM burst_members m JOIN burst_groups g ON g.id=m.burst_id WHERE g.project_id=? AND g.locked=1",
        (project_id,))}
    nums = _confident_numbers(c, project_id)
    rows = c.execute(
        "SELECT * FROM photos WHERE project_id=? AND status='analyzed' AND phash IS NOT NULL", (project_id,)).fetchall()
    sigs = [_sig_from_row(r, frozenset(nums.get(r["id"], ()))) for r in rows if r["id"] not in locked_photos]
    groups, _sims = B.group_bursts(sigs, settings.burst_similarity, settings.burst_max_gap_seconds, settings.burst_max_size)

    old = {}
    for g in c.execute("SELECT id, seq_no FROM burst_groups WHERE project_id=? AND locked=0", (project_id,)):
        old[g["id"]] = {"seq": g["seq_no"], "members": set()}
    for m in c.execute("SELECT m.photo_id, m.burst_id FROM burst_members m JOIN burst_groups g ON g.id=m.burst_id "
                       "WHERE g.project_id=? AND g.locked=0", (project_id,)):
        old[m["burst_id"]]["members"].add(m["photo_id"])
    with tx() as t:
        counter = t.execute("SELECT burst_counter FROM projects WHERE id=?", (project_id,)).fetchone()[0]
        used_old: set[int] = set()
        plan: list[tuple[list[int], int | None]] = []   # (members, matched old group id)
        for members in groups:
            ms = set(members)
            best_id, best_ov = None, 0
            for oid, og in old.items():
                ov = len(ms & og["members"])
                if ov > best_ov and oid not in used_old:
                    best_id, best_ov = oid, ov
            if best_id is not None and best_ov * 2 >= len(ms):
                used_old.add(best_id)
                plan.append((members, best_id))
            else:
                plan.append((members, None))
        for oid in old:  # old automatic groups that no longer exist
            if oid not in used_old:
                t.execute("DELETE FROM burst_groups WHERE id=?", (oid,))
        for members, oid in plan:
            if oid is not None:  # keep the row (id, Burst_NNNN number, keep_all flag), replace its members
                gid = oid
                t.execute("DELETE FROM burst_members WHERE burst_id=?", (gid,))
            else:
                counter += 1
                gid = t.execute("INSERT INTO burst_groups(project_id,seq_no,locked,keep_all,created_at) VALUES(?,?,0,0,?)",
                                (project_id, counter, now())).lastrowid
            for pid in members:
                t.execute("INSERT OR REPLACE INTO burst_members(photo_id,burst_id) VALUES(?,?)", (pid, gid))
        t.execute("UPDATE projects SET burst_counter=?, updated_at=? WHERE id=?", (counter, now(), project_id))
    n_sug = propagate_numbers(project_id, settings)
    rank_project(project_id, settings)
    return {"groups": len(groups), "grouped_photos": sum(len(g) for g in groups), "suggestions": n_sug}


def propagate_numbers(project_id: int, settings: Settings) -> int:
    """Suggest (never auto-confirm) a number for unread players that look like a confidently-read player elsewhere
    in the same burst: similar jersey colours and nearby position. Returns number of suggestions written."""
    c = get_conn()
    with tx() as t:  # drop stale suggestions that the user has not acted on
        t.execute("""UPDATE detected_players SET number=NULL, number_conf=0, status='unknown', source='ocr', note=NULL
                     WHERE source='burst' AND photo_id IN (SELECT id FROM photos WHERE project_id=?)""", (project_id,))
    n = 0
    for g in c.execute("SELECT id FROM burst_groups WHERE project_id=?", (project_id,)).fetchall():
        rows = c.execute(
            """SELECT d.*, p.filename FROM detected_players d JOIN burst_members m ON m.photo_id=d.photo_id
               JOIN photos p ON p.id=d.photo_id WHERE m.burst_id=? AND d.appearance IS NOT NULL AND d.bw>0""", (g["id"],)).fetchall()
        known = [r for r in rows if r["number"] and r["status"] in ("auto", "confirmed")]
        if not known:
            continue
        for r in rows:
            if r["status"] in ("auto", "confirmed") or r["source"] == "user" or r["number"]:
                continue
            app = np.frombuffer(r["appearance"], np.float32)
            cx, cy = r["bx"] + r["bw"] / 2, r["by"] + r["bh"] / 2
            hits: dict[str, tuple[float, sqlite3.Row]] = {}
            for k in known:
                if k["photo_id"] == r["photo_id"]:
                    continue
                sim = hashing.hist_similarity(app, np.frombuffer(k["appearance"], np.float32))
                dist = float(np.hypot(cx - (k["bx"] + k["bw"] / 2), cy - (k["by"] + k["bh"] / 2)))
                if sim >= 0.85 and dist <= 0.35:
                    score = sim * (1 - dist)
                    if k["number"] not in hits or score > hits[k["number"]][0]:
                        hits[k["number"]] = (score, k)
            if len(hits) == 1:  # ambiguous matches are not suggested
                num, (score, k) = next(iter(hits.items()))
                conf = round(min(k["number_conf"] or 0.0, score) * 0.8, 3)
                with tx() as t:
                    t.execute("UPDATE detected_players SET number=?, number_conf=?, status='needs_review', source='burst', note=? WHERE id=?",
                              (num, conf, f"Suggested from {k['filename']} in the same burst (appearance {score:.2f}). Not confirmed.", r["id"]))
                n += 1
    return n


def rank_project(project_id: int, settings: Settings) -> None:
    c = get_conn()
    for g in c.execute("SELECT id FROM burst_groups WHERE project_id=?", (project_id,)).fetchall():
        rank_burst(g["id"], settings)
    sync_auto_keepers(project_id, settings)


def rank_burst(burst_id: int, settings: Settings) -> list[dict]:
    c = get_conn()
    rows = c.execute(
        """SELECT p.id, p.capture_ts, p.phash, p.dhash, p.signature, p.hist, p.embedding, p.filename,
                  q.sharpness_score, q.motion_blur, q.subject_visibility, q.face_visible, q.composition, q.exposure_score,
                  q.classification
           FROM burst_members m JOIN photos p ON p.id=m.photo_id LEFT JOIN quality q ON q.photo_id=p.id
           WHERE m.burst_id=?""", (burst_id,)).fetchall()
    if not rows:
        return []
    sigs = {r["id"]: _sig_from_row(r, frozenset()) for r in rows}
    conf = {r[0]: r[1] for r in c.execute(
        f"SELECT photo_id, MAX(number_conf) FROM detected_players WHERE photo_id IN ({','.join('?' * len(rows))}) "
        f"AND status IN ('auto','confirmed') GROUP BY photo_id", [r['id'] for r in rows])}
    inputs, sim_to_others = [], {}
    for r in rows:
        others = [B.pair_similarity(sigs[r["id"]], sigs[o["id"]]) for o in rows if o["id"] != r["id"]]
        rep = float(np.mean(others)) if others else 1.0
        sim_to_others[r["id"]] = rep
        inputs.append(B.RankInput(
            id=r["id"], sharpness=r["sharpness_score"] or 0.0, motion_blur=r["motion_blur"] or 0.0,
            visibility=r["subject_visibility"] or 0.0, face_visible=bool(r["face_visible"]), composition=r["composition"] or 0.0,
            exposure=r["exposure_score"] or 0.0, number_conf=float(conf.get(r["id"], 0.0)), representative=rep,
            classification=r["classification"] or "review", ts=r["capture_ts"]))
    res = B.rank_group(inputs, settings.rank_weights.model_dump())
    with tx() as t:
        for rr in res:
            t.execute("UPDATE burst_members SET rank=?, rank_score=?, is_best=?, similarity=?, rank_detail=? WHERE photo_id=?",
                      (rr.rank, rr.score, 1 if rr.rank == 1 else 0, round(sim_to_others[rr.id], 3), json.dumps(rr.parts), rr.id))
    return [{"id": r.id, "rank": r.rank, "score": r.score} for r in res]


def sync_auto_keepers(project_id: int, settings: Settings) -> None:
    """Auto keepers are *suggestions* (source='auto'); anything the user touched (source='user') is never changed.
    Best frame of each burst + in-focus single frames. Out-of-focus frames are never auto-kept."""
    c = get_conn()
    with tx() as t:
        t.execute("DELETE FROM keepers WHERE source='auto' AND photo_id IN (SELECT id FROM photos WHERE project_id=?)", (project_id,))
        if not settings.auto_keepers:
            return
        t.execute(
            """INSERT OR IGNORE INTO keepers(photo_id, keeper, source, updated_at)
               SELECT p.id, 1, 'auto', ? FROM photos p JOIN quality q ON q.photo_id=p.id
               LEFT JOIN burst_members m ON m.photo_id=p.id
               WHERE p.project_id=? AND p.status='analyzed' AND q.classification<>'out_of_focus'
                 AND ((m.photo_id IS NOT NULL AND m.is_best=1) OR (m.photo_id IS NULL AND q.classification='in_focus'))""",
            (now(), project_id))


# ---- manual operations ------------------------------------------------------------------------------------------

def _snapshot(c: sqlite3.Connection, burst_ids: list[int]) -> list[dict]:
    snap = []
    for bid in burst_ids:
        g = c.execute("SELECT * FROM burst_groups WHERE id=?", (bid,)).fetchone()
        if g:
            ms = [r[0] for r in c.execute("SELECT photo_id FROM burst_members WHERE burst_id=? ORDER BY photo_id", (bid,))]
            snap.append({"id": g["id"], "seq_no": g["seq_no"], "locked": g["locked"], "keep_all": g["keep_all"], "members": ms})
    return snap


def _log(t: sqlite3.Connection, project_id: int, kind: str, summary: str, payload: dict) -> int:
    return t.execute("INSERT INTO user_corrections(project_id,kind,summary,payload,created_at) VALUES(?,?,?,?,?)",
                     (project_id, kind, summary, json.dumps(payload), now())).lastrowid


def split_burst(project_id: int, photo_ids: list[int], settings: Settings) -> int:
    """Move the given photos out of their group(s) into a new manual group (or into singles if only one)."""
    c = get_conn()
    if not photo_ids:
        raise ValueError("Select at least one photo to split off.")
    qs = ",".join("?" * len(photo_ids))
    affected = [r[0] for r in c.execute(f"SELECT DISTINCT burst_id FROM burst_members WHERE photo_id IN ({qs})", photo_ids)]
    if not affected:
        raise ValueError("Those photos are not in a burst group.")
    before = _snapshot(c, affected)
    with tx() as t:
        counter = t.execute("SELECT burst_counter FROM projects WHERE id=?", (project_id,)).fetchone()[0]
        t.execute(f"DELETE FROM burst_members WHERE photo_id IN ({qs})", photo_ids)
        new_id = None
        if len(photo_ids) >= 2:
            counter += 1
            new_id = t.execute("INSERT INTO burst_groups(project_id,seq_no,locked,created_at) VALUES(?,?,1,?)",
                               (project_id, counter, now())).lastrowid
            for pid in photo_ids:
                t.execute("INSERT INTO burst_members(photo_id,burst_id) VALUES(?,?)", (pid, new_id))
            t.execute("UPDATE projects SET burst_counter=? WHERE id=?", (counter, project_id))
        for bid in affected:  # remaining groups become manual too; groups with < 2 members dissolve
            n = t.execute("SELECT COUNT(*) FROM burst_members WHERE burst_id=?", (bid,)).fetchone()[0]
            if n < 2:
                t.execute("DELETE FROM burst_groups WHERE id=?", (bid,))
            else:
                t.execute("UPDATE burst_groups SET locked=1 WHERE id=?", (bid,))
        after_ids = [b for b in affected if t.execute("SELECT 1 FROM burst_groups WHERE id=?", (b,)).fetchone()] + ([new_id] if new_id else [])
        cid = _log(t, project_id, "burst", f"Split {len(photo_ids)} photo(s) from burst", {"op": "split", "before": before, "after_ids": after_ids})
    for b in after_ids:
        rank_burst(b, settings)
    sync_auto_keepers(project_id, settings)
    return cid


def merge_bursts(project_id: int, burst_ids: list[int], settings: Settings) -> int:
    c = get_conn()
    if len(set(burst_ids)) < 2:
        raise ValueError("Pick at least two bursts to merge.")
    burst_ids = sorted(set(burst_ids))
    before = _snapshot(c, burst_ids)
    if len(before) != len(burst_ids):
        raise ValueError("One of the bursts no longer exists.")
    target = before[0]["id"]
    with tx() as t:
        for b in before[1:]:
            t.execute("UPDATE burst_members SET burst_id=? WHERE burst_id=?", (target, b["id"]))
            t.execute("DELETE FROM burst_groups WHERE id=?", (b["id"],))
        t.execute("UPDATE burst_groups SET locked=1 WHERE id=?", (target,))
        cid = _log(t, project_id, "burst", f"Merged {len(burst_ids)} bursts", {"op": "merge", "before": before, "after_ids": [target]})
    rank_burst(target, settings)
    sync_auto_keepers(project_id, settings)
    return cid


def undo_burst_op(project_id: int, payload: dict, settings: Settings) -> None:
    """Rebuild the groups as they were. Groups get fresh ids (ids may have been reused by later regrouping); their
    stable Burst_NNNN numbers are restored unless a later group has since taken the number."""
    before = payload["before"]
    new_ids: list[int] = []
    with tx() as t:
        for bid in payload["after_ids"]:
            t.execute("DELETE FROM burst_groups WHERE id=?", (bid,))
        counter = t.execute("SELECT burst_counter FROM projects WHERE id=?", (project_id,)).fetchone()[0]
        for g in before:
            seq = g["seq_no"]
            if t.execute("SELECT 1 FROM burst_groups WHERE project_id=? AND seq_no=?", (project_id, seq)).fetchone():
                counter += 1
                seq = counter
            gid = t.execute("INSERT INTO burst_groups(project_id,seq_no,locked,keep_all,created_at) VALUES(?,?,?,?,?)",
                            (project_id, seq, g["locked"], g["keep_all"], now())).lastrowid
            new_ids.append(gid)
            for pid in g["members"]:
                t.execute("INSERT OR REPLACE INTO burst_members(photo_id,burst_id) VALUES(?,?)", (pid, gid))
        t.execute("UPDATE projects SET burst_counter=? WHERE id=?", (counter, project_id))
        # an emptied group (all members moved elsewhere) must not linger
        t.execute("DELETE FROM burst_groups WHERE project_id=? AND id NOT IN (SELECT DISTINCT burst_id FROM burst_members)", (project_id,))
    for gid in new_ids:
        rank_burst(gid, settings)
    sync_auto_keepers(project_id, settings)
