from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..db import get_conn
from ..security import PathNotAllowed
from ..services import exporter as ex
from .deps import project_or_404

router = APIRouter(prefix="/api")


class ExportIn(BaseModel):
    destination: str
    presets: list[str] = Field(min_length=1)
    scope: str = "keepers"            # keepers | all
    mode: str = "copy"                # copy | move
    confirm_move: bool = False
    naming: dict = {}
    folder_name: str | None = None
    csv: bool = True
    csv_scope: str = "all"            # all | exported
    contact_sheet: bool = False
    photo_ids: list[int] | None = None


def _plan(project_id: int, body: ExportIn):
    project_or_404(project_id)
    try:
        return ex.plan_for(project_id, body.destination, body.presets, body.scope, body.naming, body.folder_name, body.photo_ids)
    except (ex.ExportError, PathNotAllowed) as e:
        raise HTTPException(400, str(e))


@router.get("/export/presets")
def presets():
    return {"presets": [{"id": p, "label": ex.PRESET_LABELS[p]} for p in ex.PRESETS], "naming_defaults": ex.DEFAULT_NAMING}


@router.post("/projects/{project_id}/export/preview")
def preview(project_id: int, body: ExportIn):
    plan = _plan(project_id, body)
    s = plan.summary()
    if body.mode == "move":
        s["warnings"].append("MOVE mode: originals are deleted after every copy is verified. Files already on disk are never overwritten.")
    s["sample"] = [{"photo_id": i.photo_id, "from": i.src, "to": i.dest_rel, "renamed": i.renamed} for i in plan.items[:300]]
    s["truncated"] = len(plan.items) > 300
    return s


@router.post("/projects/{project_id}/export")
def run(project_id: int, body: ExportIn):
    plan = _plan(project_id, body)
    opts = {"confirm_move": body.confirm_move, "csv": body.csv, "csv_scope": body.csv_scope, "contact_sheet": body.contact_sheet, "scope": body.scope}
    try:
        eid = ex.exporter.start(project_id, plan, body.mode, body.presets, opts)
    except ex.ExportError as e:
        raise HTTPException(400, str(e))
    return {"export_id": eid, "files": len(plan.items)}


@router.get("/projects/{project_id}/exports")
def history(project_id: int):
    return [dict(r) for r in get_conn().execute("SELECT * FROM export_history WHERE project_id=? ORDER BY id DESC LIMIT 50", (project_id,))]


@router.get("/exports/{export_id}")
def status(export_id: int):
    c = get_conn()
    r = c.execute("SELECT * FROM export_history WHERE id=?", (export_id,)).fetchone()
    if r is None:
        raise HTTPException(404, "Export not found")
    failed = [dict(x) for x in c.execute("SELECT src_path,dest_path,status,error FROM export_items WHERE export_id=? AND status<>'copied' LIMIT 100", (export_id,))]
    d = dict(r)
    d["presets"] = json.loads(d["presets"] or "[]")
    d["failures"] = failed
    return d
