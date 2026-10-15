from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from .. import imageio
from ..db import get_conn, tx
from ..services import corrections as corr
from ..services import pipeline
from .deps import KEEPER_SQL, NEEDS_REVIEW_SQL, photo_or_404, project_or_404

router = APIRouter(prefix="/api")

LIST_SQL = f"""
SELECT p.id, p.uid, p.filename, p.status, p.status_detail, p.capture_time, p.capture_ts, p.width, p.height, p.reviewed, p.is_raw,
       q.classification, q.overall, q.sharpness_score, q.motion_blur, q.basis,
       g.seq_no AS burst_seq, g.id AS burst_id, m.rank AS burst_rank, m.is_best,
       {KEEPER_SQL} AS keeper, k.source AS keeper_source, {NEEDS_REVIEW_SQL} AS needs_review,
       (SELECT GROUP_CONCAT(d.number || ':' || d.status, ',') FROM detected_players d
         WHERE d.photo_id=p.id AND d.number IS NOT NULL) AS players
FROM photos p LEFT JOIN quality q ON q.photo_id=p.id LEFT JOIN burst_members m ON m.photo_id=p.id
LEFT JOIN burst_groups g ON g.id=m.burst_id LEFT JOIN keepers k ON k.photo_id=p.id
"""

VIEWS = {
    "all": "1=1",
    "in_focus": "q.classification='in_focus'",
    "out_of_focus": "q.classification='out_of_focus'",
    "needs_review": NEEDS_REVIEW_SQL,
    "best": f"{KEEPER_SQL}=1",
    "bursts": "g.id IS NOT NULL",
}
SORTS = {"time": "p.capture_ts, p.filename, p.id", "name": "p.filename, p.id", "quality": "q.overall DESC, p.id",
         "sharpness": "q.sharpness_score DESC, p.id", "burst": "g.seq_no, m.rank, p.id"}


def _item(r) -> dict:
    d = dict(r)
    players = []
    for tok in (d.pop("players") or "").split(","):
        if ":" in tok:
            n, s = tok.rsplit(":", 1)
            players.append({"number": n, "status": s})
    d["players"] = players
    d["keeper"] = bool(d["keeper"]) if d["keeper"] is not None else False
    d["needs_review"] = bool(d["needs_review"])
    d["is_best"] = bool(d["is_best"])
    d["reviewed"] = bool(d["reviewed"])
    return d


@router.get("/projects/{project_id}/photos")
def list_photos(project_id: int, view: str = "all", q: str | None = None, number: str | None = None,
                focus: str | None = None, burst: int | None = None, min_quality: float | None = None,
                review: str | None = None, keeper: str | None = None, date_from: str | None = None,
                date_to: str | None = None, include_problems: bool = False, sort: str = "time",
                limit: int = Query(20000, le=50000), offset: int = 0):
    project_or_404(project_id)
    if view not in VIEWS:
        raise HTTPException(400, "Unknown view")
    where, args = ["p.project_id=?", VIEWS[view]], [project_id]
    if not include_problems:
        where.append("p.status='analyzed'")
    if q:
        where.append("p.filename LIKE ? ESCAPE '\\'")
        args.append("%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
    if number:
        if number.lower() == "unknown":
            where.append("NOT EXISTS (SELECT 1 FROM detected_players d WHERE d.photo_id=p.id AND d.status IN ('auto','confirmed'))")
        else:
            where.append("EXISTS (SELECT 1 FROM detected_players d WHERE d.photo_id=p.id AND d.number=? AND d.status IN ('auto','confirmed'))")
            args.append(number)
    if focus:
        cl = [f for f in focus.split(",") if f in ("in_focus", "review", "out_of_focus")]
        if cl:
            where.append(f"q.classification IN ({','.join('?' * len(cl))})")
            args += cl
    if burst is not None:
        where.append("g.seq_no=?")
        args.append(burst)
    if min_quality is not None:
        where.append("q.overall>=?")
        args.append(min_quality)
    if review == "needs_review":
        where.append(NEEDS_REVIEW_SQL)
    elif review == "reviewed":
        where.append("p.reviewed=1")
    elif review == "ok":
        where.append(f"NOT {NEEDS_REVIEW_SQL}")
    if keeper == "yes":
        where.append(f"{KEEPER_SQL}=1")
    elif keeper == "no":
        where.append(f"{KEEPER_SQL}=0")
    if date_from:
        where.append("p.capture_time>=?")
        args.append(date_from)
    if date_to:
        where.append("p.capture_time<=?")
        args.append(date_to + ("T23:59:59" if len(date_to) == 10 else ""))
    order = SORTS.get(sort, SORTS["time"])
    c = get_conn()
    total = c.execute(f"SELECT COUNT(*) FROM photos p LEFT JOIN quality q ON q.photo_id=p.id LEFT JOIN burst_members m ON m.photo_id=p.id "
                      f"LEFT JOIN burst_groups g ON g.id=m.burst_id LEFT JOIN keepers k ON k.photo_id=p.id WHERE {' AND '.join(where)}", args).fetchone()[0]
    rows = c.execute(f"{LIST_SQL} WHERE {' AND '.join(where)} ORDER BY {order} LIMIT ? OFFSET ?", [*args, limit, offset]).fetchall()
    return {"total": total, "items": [_item(r) for r in rows]}


@router.get("/photos/{photo_id}")
def photo_detail(photo_id: int):
    r = photo_or_404(photo_id)
    c = get_conn()
    item = _item(c.execute(f"{LIST_SQL} WHERE p.id=?", (photo_id,)).fetchone())
    q = c.execute("SELECT * FROM quality WHERE photo_id=?", (photo_id,)).fetchone()
    quality = None
    if q:
        quality = dict(q)
        for k in ("reasons", "subject_bbox", "thresholds"):
            quality[k] = json.loads(quality[k]) if quality[k] else None
        quality["face_visible"] = bool(quality["face_visible"])
    players = [{**{k: p[k] for k in p.keys() if k != "crop_path"}, "has_crop": bool(p["crop_path"])} for p in c.execute(
        "SELECT id,bx,by,bw,bh,det_conf,number,number_conf,raw_text,status,source,note,crop_path FROM detected_players WHERE photo_id=? ORDER BY bw*bh DESC", (photo_id,))]
    roster = {x["number"]: x["name"] for x in c.execute("SELECT number,name FROM roster_entries WHERE project_id=?", (r["project_id"],))}
    for p in players:
        p["roster_name"] = roster.get(p["number"])
    burst = None
    if item["burst_id"]:
        burst = {"id": item["burst_id"], "seq_no": item["burst_seq"], "members": [
            dict(m) for m in c.execute(
                """SELECT p.id, p.filename, m.rank, m.is_best, q.overall, q.classification FROM burst_members m
                   JOIN photos p ON p.id=m.photo_id LEFT JOIN quality q ON q.photo_id=p.id WHERE m.burst_id=? ORDER BY m.rank""", (item["burst_id"],))]}
        det = c.execute("SELECT rank_detail, similarity, rank_score FROM burst_members WHERE photo_id=?", (photo_id,)).fetchone()
        burst["rank_detail"] = json.loads(det["rank_detail"]) if det and det["rank_detail"] else None
        burst["rank_score"] = det["rank_score"] if det else None
        burst["similarity"] = det["similarity"] if det else None
    exif = json.loads(r["exif_json"]) if r["exif_json"] else {}
    return {**item, "original_path": r["original_path"], "moved_to": r["moved_to"], "file_size": r["file_size"],
            "camera_make": r["camera_make"], "camera_model": r["camera_model"], "exif": exif.get("extra", {}),
            "quality": quality, "players_detail": players, "burst": burst, "sha256": r["sha256"], "ext": r["ext"]}


@router.get("/photos/{photo_id}/thumb")
def thumb(photo_id: int):
    r = photo_or_404(photo_id)
    p = pipeline.thumb_path(r["project_id"], photo_id)
    if not p.exists():
        raise HTTPException(404, "Thumbnail not generated yet")
    return FileResponse(p, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


@router.get("/photos/{photo_id}/preview")
def preview(photo_id: int):
    r = photo_or_404(photo_id)
    p = pipeline.analysis_path(r["project_id"], photo_id)
    if not p.exists():
        raise HTTPException(404, "Preview not generated yet")
    return FileResponse(p, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


@router.get("/photos/{photo_id}/full")
def full(photo_id: int):
    """Full-resolution view for zooming. Originals are read, never written. RAW/TIFF are decoded to JPEG on the fly."""
    r = photo_or_404(photo_id)
    path = pipeline.effective_path(r)
    if not os.path.isfile(path):
        raise HTTPException(404, "Original file is no longer at its recorded location.")
    if r["ext"] in (".jpg", ".jpeg", ".png", ".webp") and r["file_size"] and r["file_size"] < 60_000_000:
        return FileResponse(path, headers={"Cache-Control": "private, max-age=3600"})
    try:
        import io
        im = imageio.open_image(path, max_edge=4096)
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=90)
        return Response(buf.getvalue(), media_type="image/jpeg")
    except (imageio.UnsupportedImage, imageio.CorruptImage) as e:
        raise HTTPException(422, str(e))


@router.get("/players/{player_id}/crop")
def player_crop(player_id: int):
    r = get_conn().execute("SELECT crop_path FROM detected_players WHERE id=?", (player_id,)).fetchone()
    if not r or not r["crop_path"] or not Path(r["crop_path"]).exists():
        raise HTTPException(404, "No crop")
    return FileResponse(r["crop_path"], media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


class KeeperIn(BaseModel):
    photo_ids: list[int]
    keeper: bool | None  # null = back to automatic


@router.post("/photos/keepers")
def set_keepers(body: KeeperIn):
    try:
        return corr.set_keeper(body.photo_ids, body.keeper)
    except corr.CorrectionError as e:
        raise HTTPException(400, str(e))


class ReviewedIn(BaseModel):
    photo_ids: list[int]
    reviewed: bool = True


@router.post("/photos/reviewed")
def mark_reviewed(body: ReviewedIn):
    if not body.photo_ids:
        return {"updated": 0}
    with tx() as t:
        n = t.execute(f"UPDATE photos SET reviewed=? WHERE id IN ({','.join('?' * len(body.photo_ids))})", [int(body.reviewed), *body.photo_ids]).rowcount
    return {"updated": n}
