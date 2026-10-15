from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import get_conn
from ..services import bursts as svc
from ..services import corrections as corr
from ..settings import load_settings
from .deps import KEEPER_SQL, project_or_404

router = APIRouter(prefix="/api")


@router.get("/projects/{project_id}/bursts")
def list_bursts(project_id: int, min_size: int = 2):
    project_or_404(project_id)
    c = get_conn()
    rows = c.execute(
        f"""SELECT g.id, g.seq_no, g.locked, g.keep_all, COUNT(*) AS size, MIN(p.capture_time) AS t0, MAX(p.capture_time) AS t1,
                   MAX(CASE WHEN m.is_best=1 THEN p.id END) AS best_photo, MAX(q.overall) AS best_quality,
                   SUM(q.classification='out_of_focus') AS blurry, SUM({KEEPER_SQL}) AS keepers,
                   GROUP_CONCAT(DISTINCT CASE WHEN d.status IN ('auto','confirmed') THEN d.number END) AS numbers
            FROM burst_groups g JOIN burst_members m ON m.burst_id=g.id JOIN photos p ON p.id=m.photo_id
            LEFT JOIN quality q ON q.photo_id=p.id LEFT JOIN keepers k ON k.photo_id=p.id
            LEFT JOIN detected_players d ON d.photo_id=p.id
            WHERE g.project_id=? GROUP BY g.id HAVING COUNT(DISTINCT p.id)>=? ORDER BY g.seq_no""", (project_id, min_size)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["numbers"] = sorted(set((d["numbers"] or "").split(",")) - {""}, key=lambda x: (len(x), x))
        d["size"] = c.execute("SELECT COUNT(*) FROM burst_members WHERE burst_id=?", (r["id"],)).fetchone()[0]
        out.append(d)
    return out


@router.get("/bursts/{burst_id}")
def burst_detail(burst_id: int):
    c = get_conn()
    g = c.execute("SELECT * FROM burst_groups WHERE id=?", (burst_id,)).fetchone()
    if g is None:
        raise HTTPException(404, "Burst not found")
    from .photos import LIST_SQL, _item
    rows = c.execute(f"{LIST_SQL} WHERE g.id=? ORDER BY m.rank", (burst_id,)).fetchall()
    items = [_item(r) for r in rows]
    import json
    for it, r in zip(items, rows):
        det = c.execute("SELECT rank_score, rank_detail, similarity FROM burst_members WHERE photo_id=?", (it["id"],)).fetchone()
        it["rank_score"] = det["rank_score"]
        it["rank_detail"] = json.loads(det["rank_detail"]) if det["rank_detail"] else None
        it["similarity"] = det["similarity"]
    return {"id": g["id"], "seq_no": g["seq_no"], "locked": bool(g["locked"]), "keep_all": bool(g["keep_all"]), "photos": items}


class SplitIn(BaseModel):
    photo_ids: list[int]


class MergeIn(BaseModel):
    burst_ids: list[int]


class KeepAllIn(BaseModel):
    keep_all: bool


def _wrap(fn, *a):
    try:
        return fn(*a)
    except (ValueError, corr.CorrectionError) as e:
        raise HTTPException(400, str(e))


@router.post("/projects/{project_id}/bursts/split")
def split(project_id: int, body: SplitIn):
    project_or_404(project_id)
    return {"correction_id": _wrap(svc.split_burst, project_id, body.photo_ids, load_settings())}


@router.post("/projects/{project_id}/bursts/merge")
def merge(project_id: int, body: MergeIn):
    project_or_404(project_id)
    return {"correction_id": _wrap(svc.merge_bursts, project_id, body.burst_ids, load_settings())}


@router.post("/bursts/{burst_id}/keep-all")
def keep_all(burst_id: int, body: KeepAllIn):
    _wrap(corr.set_keep_sequence, burst_id, body.keep_all)
    return {"ok": True}
