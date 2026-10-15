"""Background processing: a persistent job table + a thread-based runner with pause / resume / cancel.

Progress is stored per photo (photos.status), so a crash or restart resumes exactly where it stopped.
"""
from __future__ import annotations

import json
import os
import threading
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from pathlib import Path

from .. import imageio
from ..db import get_conn, now, tx
from ..security import PathNotAllowed, resolve_allowed
from ..settings import load_settings
from . import bursts, pipeline

ACTIVE = ("queued", "running", "paused", "cancelling")


class JobError(Exception):
    pass


def scan_paths(paths: list[str], recursive: bool = True) -> tuple[list[Path], list[str]]:
    """Expand files/folders into supported image files. Returns (files, messages about ignored items)."""
    files: list[Path] = []
    msgs: list[str] = []
    for raw in paths:
        try:
            p = resolve_allowed(raw)
        except PathNotAllowed as e:
            msgs.append(str(e))
            continue
        if p.is_file():
            if imageio.is_supported(p):
                files.append(p)
            else:
                msgs.append(f"Skipped unsupported file type: {p.name}")
        elif p.is_dir():
            it = p.rglob("*") if recursive else p.glob("*")
            for f in it:
                if f.is_file() and not f.name.startswith(".") and imageio.is_supported(f):
                    files.append(f)
    return sorted(set(files)), msgs


def register_files(project_id: int, files: list[Path]) -> dict:
    """Insert photo rows (cheap). Files already known by path are not re-registered (previously imported)."""
    c = get_conn()
    added = known = 0
    with tx() as t:
        for f in files:
            ex = t.execute("SELECT id FROM photos WHERE project_id=? AND original_path=?", (project_id, str(f))).fetchone()
            if ex:
                known += 1
                continue
            t.execute(
                "INSERT INTO photos(uid,project_id,original_path,filename,ext,is_raw,status,imported_at) VALUES(?,?,?,?,?,?,'new',?)",
                (os.urandom(8).hex(), project_id, str(f), f.name, f.suffix.lower(), int(imageio.is_raw(f)), now()))
            added += 1
    return {"added": added, "already_imported": known}


class Runner:
    def __init__(self) -> None:
        self._threads: dict[int, threading.Thread] = {}
        self._flags: dict[int, dict[str, threading.Event]] = {}
        self._lock = threading.Lock()

    # -- lifecycle ---------------------------------------------------------------------------------------------
    def recover(self) -> None:
        """On startup: jobs that were running when the app died become 'interrupted' (resumable)."""
        with tx() as t:
            t.execute("UPDATE processing_jobs SET status='interrupted', message='Interrupted by restart – press Resume.' "
                      "WHERE status IN ('queued','running','cancelling')")

    def start(self, project_id: int, reanalyze: bool = False, regroup_only: bool = False) -> int:
        c = get_conn()
        if c.execute("SELECT 1 FROM processing_jobs WHERE project_id=? AND status IN ('queued','running','paused','cancelling')",
                     (project_id,)).fetchone():
            raise JobError("A processing job is already active for this project.")
        with tx() as t:
            jid = t.execute("INSERT INTO processing_jobs(project_id,kind,status,params,created_at) VALUES(?,?,?,?,?)",
                            (project_id, "regroup" if regroup_only else "process", "queued",
                             json.dumps({"reanalyze": reanalyze}), now())).lastrowid
        self._spawn(jid)
        return jid

    def resume(self, job_id: int) -> None:
        c = get_conn()
        row = c.execute("SELECT * FROM processing_jobs WHERE id=?", (job_id,)).fetchone()
        if row is None:
            raise JobError("Job not found.")
        with self._lock:
            flags = self._flags.get(job_id)
            if row["status"] == "paused" and flags:
                flags["pause"].clear()
                with tx() as t:
                    t.execute("UPDATE processing_jobs SET status='running', message=NULL WHERE id=?", (job_id,))
                return
        if row["status"] in ("interrupted", "failed", "cancelled", "paused"):
            if c.execute("SELECT 1 FROM processing_jobs WHERE project_id=? AND status IN ('queued','running') AND id<>?",
                         (row["project_id"], job_id)).fetchone():
                raise JobError("Another job is already running for this project.")
            with tx() as t:
                t.execute("UPDATE processing_jobs SET status='queued', error=NULL, message='Resuming…', finished_at=NULL WHERE id=?", (job_id,))
            self._spawn(job_id)
        else:
            raise JobError(f"Job is {row['status']}; nothing to resume.")

    def pause(self, job_id: int) -> None:
        flags = self._flags.get(job_id)
        if not flags:
            raise JobError("Job is not running.")
        flags["pause"].set()
        with tx() as t:
            t.execute("UPDATE processing_jobs SET status='paused', message='Paused' WHERE id=? AND status IN ('running','queued')", (job_id,))

    def cancel(self, job_id: int) -> None:
        flags = self._flags.get(job_id)
        if flags:
            flags["cancel"].set()
            flags["pause"].clear()
            with tx() as t:
                t.execute("UPDATE processing_jobs SET status='cancelling', message='Cancelling…' WHERE id=? AND status IN ('running','paused','queued')", (job_id,))
        else:
            with tx() as t:
                t.execute("UPDATE processing_jobs SET status='cancelled', finished_at=? WHERE id=? AND status IN ('interrupted','queued','paused')", (now(), job_id))

    def wait(self, job_id: int, timeout: float | None = None) -> None:
        th = self._threads.get(job_id)
        if th:
            th.join(timeout)

    # -- execution ---------------------------------------------------------------------------------------------
    def _spawn(self, job_id: int) -> None:
        flags = {"pause": threading.Event(), "cancel": threading.Event()}
        with self._lock:
            self._flags[job_id] = flags
            th = threading.Thread(target=self._run, args=(job_id, flags), name=f"job-{job_id}", daemon=True)
            self._threads[job_id] = th
        th.start()

    def _run(self, job_id: int, flags: dict[str, threading.Event]) -> None:
        c = get_conn()
        try:
            job = c.execute("SELECT * FROM processing_jobs WHERE id=?", (job_id,)).fetchone()
            pid = job["project_id"]
            params = json.loads(job["params"] or "{}")
            settings = load_settings()
            with tx() as t:
                # a pause/cancel that arrived before the worker thread got going must not be overwritten
                state = "cancelling" if flags["cancel"].is_set() else "paused" if flags["pause"].is_set() else "running"
                t.execute("UPDATE processing_jobs SET status=?, started_at=COALESCE(started_at,?), phase=?, error=NULL, message=NULL WHERE id=?",
                          (state, now(), "analysis", job_id))
            if job["kind"] != "regroup":
                if params.get("reanalyze"):
                    with tx() as t:
                        t.execute("UPDATE photos SET status='ingested' WHERE project_id=? AND status='analyzed'", (pid,))
                        params["reanalyze"] = False
                        t.execute("UPDATE processing_jobs SET params=? WHERE id=?", (json.dumps(params), job_id))
                # photos left in a transient state by a crash are simply picked up again by status
                todo = [r["id"] for r in c.execute(
                    "SELECT id FROM photos WHERE project_id=? AND status IN ('new','ingested') ORDER BY capture_ts, filename, id", (pid,))]
                already = c.execute("SELECT COUNT(*) FROM photos WHERE project_id=? AND status IN ('analyzed','skipped','error')", (pid,)).fetchone()[0]
                with tx() as t:
                    t.execute("UPDATE processing_jobs SET total=?, done=0, skipped=0, failed=0 WHERE id=?", (len(todo), job_id))
                self._process(job_id, todo, settings, flags)
            if flags["cancel"].is_set():
                self._finish(job_id, "cancelled", "Cancelled – progress saved; start again to continue.")
                return
            with tx() as t:
                t.execute("UPDATE processing_jobs SET phase='grouping', message='Grouping bursts and ranking frames…' WHERE id=?", (job_id,))
            res = bursts.rebuild_bursts(pid, settings)
            fin = c.execute("SELECT done, skipped, failed FROM processing_jobs WHERE id=?", (job_id,)).fetchone()
            msg = f"Done – {fin['done']} analysed, {fin['skipped']} skipped, {fin['failed']} failed; {res['groups']} burst group(s)."
            self._finish(job_id, "completed", msg)
        except Exception as e:  # noqa: BLE001 - the job table is the error channel
            self._finish(job_id, "failed", f"{type(e).__name__}: {e}", error=repr(e))
        finally:
            with self._lock:
                self._flags.pop(job_id, None)

    def _process(self, job_id: int, ids: list[int], settings, flags) -> None:
        done = skipped = failed = 0
        workers = max(1, settings.max_workers)

        def work(pid: int) -> str:
            st = pipeline.ingest_photo(pid, settings)
            if st == "ingested":
                st = pipeline.analyze_photo(pid, settings)
            return st

        def flush() -> None:
            with tx() as t:
                t.execute("UPDATE processing_jobs SET done=?, skipped=?, failed=? WHERE id=?", (done, skipped, failed, job_id))

        it = iter(ids)
        pending: set[Future] = set()
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="analyze") as ex:
            exhausted = False
            while True:
                while not exhausted and len(pending) < workers * 2 and not flags["cancel"].is_set() and not flags["pause"].is_set():
                    try:
                        pending.add(ex.submit(work, next(it)))
                    except StopIteration:
                        exhausted = True
                if not pending:
                    if exhausted or flags["cancel"].is_set():
                        break
                    flags["cancel"].wait(0.2)  # paused with nothing in flight
                    continue
                fin, pending = wait(pending, timeout=0.5, return_when=FIRST_COMPLETED)
                for f in fin:
                    try:
                        st = f.result()
                    except Exception:  # noqa: BLE001
                        st = "error"
                    if st == "analyzed":
                        done += 1
                    elif st == "skipped":
                        skipped += 1
                    else:
                        failed += 1
                if fin:
                    flush()
        flush()

    def _finish(self, job_id: int, status: str, message: str, error: str | None = None) -> None:
        with tx() as t:
            t.execute("UPDATE processing_jobs SET status=?, message=?, error=?, finished_at=?, phase=NULL WHERE id=?",
                      (status, message, error, now(), job_id))


runner = Runner()


def job_dict(row) -> dict:
    d = dict(row)
    d.pop("params", None)
    total = d["total"] or 0
    d["progress"] = round(100.0 * (d["done"] + d["skipped"] + d["failed"]) / total, 1) if total else (100.0 if d["status"] == "completed" else 0.0)
    return d
