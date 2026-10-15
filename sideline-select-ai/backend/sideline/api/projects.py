from __future__ import annotations

import os
import shutil
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .. import config, imageio
from ..db import get_conn, now, tx
from ..security import PathNotAllowed, resolve_allowed, safe_component
from ..services import jobs
from ..services.demo import generate_demo_set
from ..services.pipeline import engine_status
from ..settings import Settings, load_settings, reset_settings, save_settings
from .deps import KEEPER_SQL, NEEDS_REVIEW_SQL, project_or_404

router = APIRouter(prefix="/api")


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    sport: str = "football"
    game_date: str | None = None
    notes: str | None = None


@router.get("/projects")
def list_projects():
    c = get_conn()
    rows = c.execute("""SELECT pr.*, (SELECT COUNT(*) FROM photos p WHERE p.project_id=pr.id) AS photo_count
                        FROM projects pr ORDER BY pr.updated_at DESC""").fetchall()
    return [dict(r) for r in rows]


@router.post("/projects")
def create_project(body: ProjectIn):
    with tx() as t:
        pid = t.execute("INSERT INTO projects(name,sport,game_date,notes,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                        (body.name.strip(), body.sport, body.game_date, body.notes, now(), now())).lastrowid
    return dict(project_or_404(pid))


@router.patch("/projects/{project_id}")
def update_project(project_id: int, body: ProjectIn):
    project_or_404(project_id)
    with tx() as t:
        t.execute("UPDATE projects SET name=?, sport=?, game_date=?, notes=?, updated_at=? WHERE id=?",
                  (body.name.strip(), body.sport, body.game_date, body.notes, now(), project_id))
    return dict(project_or_404(project_id))


@router.delete("/projects/{project_id}")
def delete_project(project_id: int):
    """Removes the project's database rows and caches only. Photo files on disk are never touched."""
    project_or_404(project_id)
    active = get_conn().execute("SELECT 1 FROM processing_jobs WHERE project_id=? AND status IN ('queued','running','cancelling')", (project_id,)).fetchone()
    if active:
        raise HTTPException(409, "Cancel the running job before deleting this project.")
    with tx() as t:
        t.execute("DELETE FROM projects WHERE id=?", (project_id,))
    shutil.rmtree(config.data_dir() / "projects" / str(project_id), ignore_errors=True)
    return {"deleted": project_id}


@router.post("/projects/demo")
def create_demo_project():
    """Generate clearly-labelled SYNTHETIC sample photos and import them into a demo project."""
    with tx() as t:
        n = t.execute("SELECT COUNT(*) FROM projects WHERE is_demo=1").fetchone()[0]
        pid = t.execute("INSERT INTO projects(name,sport,game_date,notes,is_demo,created_at,updated_at) VALUES(?,?,?,?,1,?,?)",
                        (f"DEMO – synthetic sample game{f' {n + 1}' if n else ''}", "football", "2025-09-06",
                         "Generated cartoon images used to demonstrate the pipeline. Not real photographs.", now(), now())).lastrowid
    dest = config.data_dir() / "demo_samples" / f"project_{pid}"
    generate_demo_set(dest)
    files, _ = jobs.scan_paths([str(dest)])
    reg = jobs.register_files(pid, files)
    jid = jobs.runner.start(pid)
    return {"project": dict(project_or_404(pid)), "job_id": jid, **reg}


# ---- import ----------------------------------------------------------------------------------------------------

class ImportIn(BaseModel):
    paths: list[str] = Field(min_length=1)
    recursive: bool = True
    start: bool = True


@router.post("/projects/{project_id}/import")
def import_paths(project_id: int, body: ImportIn):
    project_or_404(project_id)
    files, msgs = jobs.scan_paths(body.paths, body.recursive)
    reg = jobs.register_files(project_id, files)
    job_id = None
    if body.start:
        try:
            job_id = jobs.runner.start(project_id)
        except jobs.JobError as e:
            msgs.append(f"Files were registered, but: {e} They will be picked up when you press Process.")
    return {"found": len(files), **reg, "messages": msgs[:50], "job_id": job_id}


@router.post("/projects/{project_id}/upload")
async def upload(project_id: int, files: list[UploadFile] = File(...), start: bool = True):
    """Drag-and-drop path: browsers do not expose file paths, so bytes are copied into the project's upload cache.
    (The photographer's own files are untouched; use folder import to analyse files in place.)"""
    project_or_404(project_id)
    dest = config.cache_dir(project_id) / "uploads"
    dest.mkdir(parents=True, exist_ok=True)
    saved: list[Path] = []
    rejected: list[str] = []
    for uf in files:
        name = safe_component(os.path.basename((uf.filename or "").replace("\\", "/")), "upload")
        if not imageio.is_supported(name):
            rejected.append(f"{name}: unsupported file type")
            continue
        target = dest / name
        n = 1
        while target.exists():
            n += 1
            target = dest / f"{Path(name).stem}_{n}{Path(name).suffix}"
        with open(target, "xb") as f:
            while chunk := await uf.read(1 << 20):
                f.write(chunk)
        saved.append(target)
    reg = jobs.register_files(project_id, saved)
    job_id = None
    if start and saved:
        try:
            job_id = jobs.runner.start(project_id)
        except jobs.JobError as e:
            rejected.append(str(e))
    return {"saved": len(saved), "rejected": rejected, **reg, "job_id": job_id}


@router.get("/fs/browse")
def browse(path: str | None = None):
    roots = config.allowed_roots()
    if not path:
        return {"path": None, "parent": None, "dirs": [{"name": str(r), "path": str(r)} for r in roots], "image_count": 0}
    try:
        p = resolve_allowed(path)
    except PathNotAllowed as e:
        raise HTTPException(400, str(e))
    if not p.is_dir():
        raise HTTPException(400, "Not a folder.")
    dirs, images = [], 0
    try:
        for e in sorted(p.iterdir(), key=lambda x: x.name.lower()):
            if e.name.startswith("."):
                continue
            if e.is_dir():
                dirs.append({"name": e.name, "path": str(e)})
            elif imageio.is_supported(e):
                images += 1
    except PermissionError:
        raise HTTPException(403, "Permission denied.")
    parent = None
    if p not in roots:
        try:
            parent = resolve_allowed(p.parent)
        except PathNotAllowed:
            parent = None
    return {"path": str(p), "parent": str(parent) if parent else None, "dirs": dirs[:500], "image_count": images}


# ---- jobs ------------------------------------------------------------------------------------------------------

class ProcessIn(BaseModel):
    reanalyze: bool = False
    regroup_only: bool = False


@router.post("/projects/{project_id}/process")
def process(project_id: int, body: ProcessIn = ProcessIn()):
    project_or_404(project_id)
    try:
        return {"job_id": jobs.runner.start(project_id, body.reanalyze, body.regroup_only)}
    except jobs.JobError as e:
        raise HTTPException(409, str(e))


@router.get("/projects/{project_id}/jobs")
def project_jobs(project_id: int, limit: int = 10):
    rows = get_conn().execute("SELECT * FROM processing_jobs WHERE project_id=? ORDER BY id DESC LIMIT ?", (project_id, limit)).fetchall()
    return [jobs.job_dict(r) for r in rows]


def _job_action(job_id: int, fn):
    if get_conn().execute("SELECT 1 FROM processing_jobs WHERE id=?", (job_id,)).fetchone() is None:
        raise HTTPException(404, "Job not found")
    try:
        fn(job_id)
    except jobs.JobError as e:
        raise HTTPException(409, str(e))
    return jobs.job_dict(get_conn().execute("SELECT * FROM processing_jobs WHERE id=?", (job_id,)).fetchone())


@router.post("/jobs/{job_id}/pause")
def pause_job(job_id: int):
    return _job_action(job_id, jobs.runner.pause)


@router.post("/jobs/{job_id}/resume")
def resume_job(job_id: int):
    return _job_action(job_id, jobs.runner.resume)


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: int):
    return _job_action(job_id, jobs.runner.cancel)


@router.get("/projects/{project_id}/problems")
def problems(project_id: int):
    """Files that were skipped (duplicates) or could not be read, with plain-language reasons."""
    rows = get_conn().execute(
        "SELECT id, filename, status, status_detail, original_path FROM photos WHERE project_id=? AND status IN ('skipped','error') ORDER BY filename",
        (project_id,)).fetchall()
    return [dict(r) for r in rows]


@router.post("/projects/{project_id}/problems/retry")
def retry_errors(project_id: int):
    with tx() as t:
        n = t.execute("UPDATE photos SET status='new', status_detail=NULL WHERE project_id=? AND status='error'", (project_id,)).rowcount
    return {"requeued": n}


# ---- dashboard + system ----------------------------------------------------------------------------------------

@router.get("/projects/{project_id}/stats")
def stats(project_id: int):
    project_or_404(project_id)
    c = get_conn()
    base = f"""FROM photos p LEFT JOIN quality q ON q.photo_id=p.id LEFT JOIN burst_members m ON m.photo_id=p.id
               LEFT JOIN burst_groups g ON g.id=m.burst_id LEFT JOIN keepers k ON k.photo_id=p.id WHERE p.project_id=?"""
    one = lambda sql: c.execute(sql, (project_id,)).fetchone()[0]  # noqa: E731
    st = {r["status"]: r["n"] for r in c.execute("SELECT status, COUNT(*) n FROM photos WHERE project_id=? GROUP BY status", (project_id,))}
    total = sum(st.values())
    analyzed = st.get("analyzed", 0)
    done = analyzed + st.get("skipped", 0) + st.get("error", 0)
    job = c.execute("SELECT * FROM processing_jobs WHERE project_id=? ORDER BY id DESC LIMIT 1", (project_id,)).fetchone()
    return {
        "total": total, "analyzed": analyzed, "skipped": st.get("skipped", 0), "errors": st.get("error", 0),
        "pending": st.get("new", 0) + st.get("ingested", 0),
        "progress": round(100 * done / total, 1) if total else 0,
        "players": one("SELECT COUNT(DISTINCT d.number) FROM detected_players d JOIN photos p ON p.id=d.photo_id WHERE p.project_id=? AND d.number IS NOT NULL AND d.status IN ('auto','confirmed')"),
        "bursts": one("SELECT COUNT(*) FROM burst_groups WHERE project_id=?"),
        "keepers": one(f"SELECT COUNT(*) {base} AND {KEEPER_SQL}=1"),
        "in_focus": one(f"SELECT COUNT(*) {base} AND q.classification='in_focus'"),
        "review_focus": one(f"SELECT COUNT(*) {base} AND q.classification='review'"),
        "blurry": one(f"SELECT COUNT(*) {base} AND q.classification='out_of_focus'"),
        "needs_review": one(f"SELECT COUNT(*) {base} AND {NEEDS_REVIEW_SQL}"),
        "job": jobs.job_dict(job) if job else None,
    }


@router.get("/system/status")
def system_status(project_id: int | None = None):
    from ..cv import embedding
    demo = False
    if project_id:
        demo = bool(project_or_404(project_id)["is_demo"])
    s = load_settings()
    raw_ok, raw_msg = imageio.raw_support()
    emb_ok, emb_msg = embedding.status()
    return {"version": config.VERSION, "engines": engine_status(s, demo),
            "raw": {"ok": raw_ok, "message": raw_msg}, "embeddings": {"ok": emb_ok, "message": emb_msg, "enabled": s.use_embeddings},
            "allowed_roots": [str(r) for r in config.allowed_roots()], "data_dir": str(config.data_dir()),
            "models_dir": str(config.models_dir()), "supported_extensions": sorted(imageio.SUPPORTED_EXT)}


@router.get("/settings")
def get_settings():
    return load_settings().model_dump()


@router.put("/settings")
def put_settings(body: Settings):
    return save_settings(body).model_dump()


@router.post("/settings/reset")
def reset():
    return reset_settings().model_dump()
