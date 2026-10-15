"""Export planning + execution.

Safety rules (all unit tested):
  * originals are copied by default; ``move`` needs explicit confirmation and only deletes a source after every
    destination copy was written and size-verified;
  * existing files are never overwritten – collisions get a predictable ``_2``, ``_3`` … suffix, and files are
    created with exclusive-create so even a race cannot clobber something;
  * every folder name is sanitised, so a filename / player name cannot escape the destination.
"""
from __future__ import annotations

import csv
import io
import json
import os
import shutil
import threading
from dataclasses import dataclass, field
from pathlib import Path

from ..db import get_conn, now, tx
from ..security import safe_component, validate_export_destination
from . import contact_sheet, pipeline

PRESETS = ("player", "focus", "player_focus", "best", "bursts")
PRESET_LABELS = {"player": "A – By Player", "focus": "B – By Focus", "player_focus": "C – By Player and Focus",
                 "best": "D – Best Frames", "bursts": "E – Burst Groups"}

DEFAULT_NAMING = {
    "players_dir": "Players", "unknown_player": "Unknown_Player", "player_format": "{number}",
    "in_focus": "In_Focus", "review": "Review", "out_of_focus": "Out_Of_Focus",
    "best": "Best_Frames", "other": "Other_Frames",
    "bursts_dir": "Bursts", "burst_prefix": "Burst_", "burst_pad": 4, "singles": "Singles",
}


class ExportError(ValueError):
    pass


@dataclass
class PhotoInfo:
    id: int
    filename: str
    src: str
    cls: str | None
    numbers: list[str]
    names: dict[str, str]
    burst_seq: int | None
    is_best: bool
    keeper: bool
    score: float | None = None


@dataclass
class PlanItem:
    photo_id: int
    src: str
    dest_rel: str      # relative to the export root (includes sub-folders + final filename)
    preset: str
    renamed: bool = False
    size: int = 0


@dataclass
class Plan:
    root: Path
    items: list[PlanItem] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    photo_count: int = 0

    def summary(self) -> dict:
        folders: dict[str, int] = {}
        for it in self.items:
            d = str(Path(it.dest_rel).parent).replace("\\", "/")
            folders[d] = folders.get(d, 0) + 1
        return {"root": str(self.root), "photos": self.photo_count, "files": len(self.items),
                "bytes": sum(i.size for i in self.items), "renamed": sum(1 for i in self.items if i.renamed),
                "folders": dict(sorted(folders.items())), "warnings": self.warnings}


# ---- pure planning ---------------------------------------------------------------------------------------------

def unique_name(directory: Path, filename: str, taken: set[str]) -> tuple[str, bool]:
    """Return a filename not in ``taken`` (case-insensitive, covers Windows/macOS) and not already on disk."""
    stem, ext = os.path.splitext(filename)
    n = 1
    cand = filename
    while True:
        key = str(directory / cand).lower()
        if key not in taken and not (directory / cand).exists():
            taken.add(key)
            return cand, n > 1
        n += 1
        cand = f"{stem}_{n}{ext}"


def folders_for(info: PhotoInfo, preset: str, naming: dict) -> list[str]:
    """Relative folder(s) (posix style) a photo belongs in for one preset."""
    n = {**DEFAULT_NAMING, **{k: v for k, v in (naming or {}).items() if v not in (None, "")}}
    sc = safe_component
    cls_dir = {"in_focus": sc(n["in_focus"]), "review": sc(n["review"]), "out_of_focus": sc(n["out_of_focus"])}
    focus = cls_dir.get(info.cls or "review", cls_dir["review"])

    def player_dirs() -> list[str]:
        if not info.numbers:
            return [f"{sc(n['players_dir'])}/{sc(n['unknown_player'])}"]
        out = []
        for num in dict.fromkeys(info.numbers):
            label = str(n["player_format"]).replace("{number}", num).replace("{name}", info.names.get(num, "")).strip("_ -")
            if "{name}" in str(n["player_format"]) and not info.names.get(num):
                label = num
            out.append(f"{sc(n['players_dir'])}/{sc(label, num)}")
        return out

    if preset == "player":
        return player_dirs()
    if preset == "focus":
        return [focus]
    if preset == "player_focus":
        return [f"{d}/{focus}" for d in player_dirs()]
    if preset == "best":
        return [sc(n["best"]) if (info.keeper or info.is_best) and info.cls != "out_of_focus" else sc(n["other"])]
    if preset == "bursts":
        if info.burst_seq is None:
            return [f"{sc(n['bursts_dir'])}/{sc(n['singles'])}"]
        return [f"{sc(n['bursts_dir'])}/{sc(n['burst_prefix'])}{info.burst_seq:0{int(n['burst_pad'])}d}"]
    raise ExportError(f"Unknown preset: {preset}")


def build_plan(photos: list[PhotoInfo], root: Path, presets: list[str], naming: dict | None = None,
               sizes: dict[int, int] | None = None) -> Plan:
    plan = Plan(root=root)
    if not presets:
        raise ExportError("Choose at least one organisation preset.")
    for p in presets:
        if p not in PRESETS:
            raise ExportError(f"Unknown preset: {p}")
    taken: set[str] = set()
    plan.photo_count = len(photos)
    for info in sorted(photos, key=lambda i: (i.filename.lower(), i.id)):
        if not os.path.isfile(info.src):
            plan.warnings.append(f"Source file missing, skipped: {info.filename}")
            plan.photo_count -= 1
            continue
        seen: set[str] = set()
        for preset in presets:
            for rel in folders_for(info, preset, naming or {}):
                if rel in seen:  # two presets can land in the same folder – one copy is enough
                    continue
                seen.add(rel)
                name, renamed = unique_name(root / rel, safe_component(info.filename, f"photo_{info.id}"), taken)
                size = (sizes or {}).get(info.id)
                if size is None:
                    try:
                        size = os.path.getsize(info.src)
                    except OSError:
                        size = 0
                plan.items.append(PlanItem(info.id, info.src, f"{rel}/{name}", preset, renamed, size))
    return plan


# ---- data access -----------------------------------------------------------------------------------------------

def load_photo_infos(project_id: int, scope: str, photo_ids: list[int] | None = None) -> list[PhotoInfo]:
    c = get_conn()
    roster = {r["number"]: r["name"] for r in c.execute("SELECT number,name FROM roster_entries WHERE project_id=?", (project_id,))}
    nums: dict[int, list[str]] = {}
    for r in c.execute("""SELECT d.photo_id, d.number FROM detected_players d JOIN photos p ON p.id=d.photo_id
                          WHERE p.project_id=? AND d.number IS NOT NULL AND d.status IN ('auto','confirmed') ORDER BY d.id""", (project_id,)):
        nums.setdefault(r["photo_id"], []).append(r["number"])
    rows = c.execute(
        """SELECT p.id, p.filename, p.original_path, p.moved_to, q.classification, q.overall, g.seq_no, g.keep_all, m.is_best,
                  k.keeper AS k_keeper
           FROM photos p LEFT JOIN quality q ON q.photo_id=p.id LEFT JOIN burst_members m ON m.photo_id=p.id
           LEFT JOIN burst_groups g ON g.id=m.burst_id LEFT JOIN keepers k ON k.photo_id=p.id
           WHERE p.project_id=? AND p.status='analyzed'""", (project_id,)).fetchall()
    out = []
    for r in rows:
        if photo_ids is not None and r["id"] not in photo_ids:
            continue
        explicit = r["k_keeper"]
        keeper = bool(explicit) if explicit is not None else False
        if explicit is None and r["keep_all"]:
            keeper = True  # "retain entire sequence"
        if scope == "keepers" and not keeper:
            continue
        out.append(PhotoInfo(r["id"], r["filename"], pipeline.effective_path(r), r["classification"], nums.get(r["id"], []),
                             {n: roster[n] for n in nums.get(r["id"], []) if n in roster}, r["seq_no"], bool(r["is_best"]),
                             keeper, r["overall"]))
    return out


def plan_for(project_id: int, destination: str, presets: list[str], scope: str, naming: dict | None,
             folder_name: str | None, photo_ids: list[int] | None = None) -> Plan:
    if scope not in ("keepers", "all"):
        raise ExportError("scope must be 'keepers' or 'all'.")
    dest = validate_export_destination(destination)
    proj = get_conn().execute("SELECT name FROM projects WHERE id=?", (project_id,)).fetchone()
    root = dest / safe_component(folder_name or proj["name"], "Export")
    photos = load_photo_infos(project_id, scope, photo_ids)
    plan = build_plan(photos, root, presets, naming)
    if not photos:
        plan.warnings.append("Nothing to export with the current scope" + (" – mark some keepers first." if scope == "keepers" else "."))
    return plan


# ---- execution -------------------------------------------------------------------------------------------------

def copy_exclusive(src: str, dest: Path) -> Path:
    """Copy ``src`` to ``dest`` without ever overwriting: exclusive create, retry with suffix on a race."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    n = 1
    cand = dest
    while True:
        try:
            with open(src, "rb") as fi, open(cand, "xb") as fo:
                shutil.copyfileobj(fi, fo, 1 << 20)
            break
        except FileExistsError:
            n += 1
            cand = dest.with_name(f"{dest.stem}_{n}{dest.suffix}")
    try:
        shutil.copystat(src, cand)
    except OSError:
        pass
    if os.path.getsize(cand) != os.path.getsize(src):
        os.remove(cand)
        raise IOError("size mismatch after copy – destination removed")
    return cand


def _csv_text(rows: list[dict]) -> str:
    buf = io.StringIO()
    cols = ["filename", "original_path", "exported_paths", "player_numbers", "player_names", "review_status", "focus_class",
            "sharpness_score", "motion_blur", "overall_score", "capture_time", "burst_id", "burst_rank", "burst_best", "keeper"]
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow({k: _csv_safe(r.get(k)) for k in cols})
    return buf.getvalue()


def _csv_safe(v):
    """Neutralise spreadsheet formula injection from filenames/names."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v


def report_rows(project_id: int, exported: dict[int, list[str]] | None = None, only_ids: set[int] | None = None) -> list[dict]:
    c = get_conn()
    roster = {r["number"]: r["name"] for r in c.execute("SELECT number,name FROM roster_entries WHERE project_id=?", (project_id,))}
    pl: dict[int, list[tuple[str, str]]] = {}
    for r in c.execute("""SELECT d.photo_id, d.number, d.status FROM detected_players d JOIN photos p ON p.id=d.photo_id
                          WHERE p.project_id=? AND d.number IS NOT NULL ORDER BY d.id""", (project_id,)):
        pl.setdefault(r["photo_id"], []).append((r["number"], r["status"]))
    rows = c.execute(
        """SELECT p.*, q.classification, q.sharpness_score, q.motion_blur, q.overall, g.seq_no, m.rank, m.is_best, g.keep_all,
                  k.keeper AS k_keeper
           FROM photos p LEFT JOIN quality q ON q.photo_id=p.id LEFT JOIN burst_members m ON m.photo_id=p.id
           LEFT JOIN burst_groups g ON g.id=m.burst_id LEFT JOIN keepers k ON k.photo_id=p.id
           WHERE p.project_id=? ORDER BY p.capture_ts, p.filename""", (project_id,)).fetchall()
    out = []
    for r in rows:
        if only_ids is not None and r["id"] not in only_ids:
            continue
        ns = [n for n, s in pl.get(r["id"], []) if s in ("auto", "confirmed")]
        keeper = (r["k_keeper"] == 1) if r["k_keeper"] is not None else bool(r["keep_all"])
        out.append({
            "filename": r["filename"], "original_path": r["original_path"],
            "exported_paths": "; ".join((exported or {}).get(r["id"], [])), "player_numbers": ", ".join(ns) or "Unknown",
            "player_names": ", ".join(roster[n] for n in ns if n in roster),
            "review_status": r["status"] if r["status"] != "analyzed" else ("reviewed" if r["reviewed"] else "auto"),
            "focus_class": r["classification"] or "", "sharpness_score": _r(r["sharpness_score"]),
            "motion_blur": _r(r["motion_blur"]), "overall_score": _r(r["overall"]), "capture_time": r["capture_time"] or "",
            "burst_id": f"Burst_{r['seq_no']:04d}" if r["seq_no"] else "", "burst_rank": r["rank"] or "",
            "burst_best": "yes" if r["is_best"] else "", "keeper": "yes" if keeper else ""})
    return out


def _r(v):
    return "" if v is None else round(float(v), 1)


class ExportRunner:
    def __init__(self) -> None:
        self._threads: dict[int, threading.Thread] = {}

    def start(self, project_id: int, plan: Plan, mode: str, presets: list[str], options: dict) -> int:
        if mode not in ("copy", "move"):
            raise ExportError("mode must be 'copy' or 'move'.")
        if mode == "move" and options.get("confirm_move") is not True:
            raise ExportError("Moving files requires explicit confirmation (confirm_move=true). Originals are left untouched otherwise.")
        if not plan.items and not options.get("csv") and not options.get("contact_sheet"):
            raise ExportError("Nothing to export.")
        with tx() as t:
            eid = t.execute("INSERT INTO export_history(project_id,created_at,destination,mode,presets,options,total_count,status) "
                            "VALUES(?,?,?,?,?,?,?,'running')",
                            (project_id, now(), str(plan.root), mode, json.dumps(presets), json.dumps(options), len(plan.items))).lastrowid
        th = threading.Thread(target=self._run, args=(eid, project_id, plan, mode, options), daemon=True, name=f"export-{eid}")
        self._threads[eid] = th
        th.start()
        return eid

    def wait(self, eid: int, timeout: float | None = None) -> None:
        th = self._threads.get(eid)
        if th:
            th.join(timeout)

    def _run(self, eid: int, project_id: int, plan: Plan, mode: str, options: dict) -> None:
        done = failed = 0
        exported: dict[int, list[str]] = {}
        by_photo: dict[int, list[PlanItem]] = {}
        for it in plan.items:
            by_photo.setdefault(it.photo_id, []).append(it)
        report_path = sheet_path = None
        try:
            plan.root.mkdir(parents=True, exist_ok=True)
            for pid, items in by_photo.items():
                ok_all = True
                written: list[Path] = []
                for it in items:
                    try:
                        final = copy_exclusive(it.src, plan.root / it.dest_rel)
                        written.append(final)
                        exported.setdefault(pid, []).append(str(final))
                        self._item(eid, pid, it.src, str(final), "copied" if mode == "copy" else "copied", None)
                        done += 1
                    except Exception as e:  # noqa: BLE001
                        ok_all = False
                        failed += 1
                        self._item(eid, pid, it.src, str(plan.root / it.dest_rel), "failed", str(e))
                if mode == "move" and ok_all and written:
                    try:
                        os.remove(items[0].src)
                        with tx() as t:
                            t.execute("UPDATE photos SET moved_to=? WHERE id=?", (str(written[0]), pid))
                    except OSError as e:
                        self._item(eid, pid, items[0].src, str(written[0]), "move_failed", f"copied but could not remove original: {e}")
                with tx() as t:
                    t.execute("UPDATE export_history SET item_count=?, failed_count=? WHERE id=?", (done, failed, eid))
            if options.get("csv"):
                rows = report_rows(project_id, exported, set(by_photo) if options.get("csv_scope") == "exported" else None)
                p = plan.root / "Sideline_Report.csv"
                n = 1
                while True:
                    try:
                        with open(p, "x", newline="", encoding="utf-8-sig") as f:
                            f.write(_csv_text(rows))
                        break
                    except FileExistsError:
                        n += 1
                        p = plan.root / f"Sideline_Report_{n}.csv"
                report_path = str(p)
            if options.get("contact_sheet"):
                sheet_path = self._contact(project_id, plan.root, set(by_photo) if by_photo else None)
            status = "completed" if failed == 0 else "completed_with_errors"
            msg = f"{done} file(s) written, {failed} failed."
        except Exception as e:  # noqa: BLE001
            status, msg = "failed", f"{type(e).__name__}: {e}"
        with tx() as t:
            t.execute("UPDATE export_history SET status=?, message=?, item_count=?, failed_count=?, report_path=?, contact_sheet_path=? WHERE id=?",
                      (status, msg, done, failed, report_path, sheet_path, eid))

    @staticmethod
    def _item(eid: int, pid: int, src: str, dest: str, status: str, err: str | None) -> None:
        with tx() as t:
            t.execute("INSERT INTO export_items(export_id,photo_id,src_path,dest_path,status,error) VALUES(?,?,?,?,?,?)",
                      (eid, pid, src, dest, status, err))

    @staticmethod
    def _contact(project_id: int, root: Path, only: set[int] | None) -> str | None:
        c = get_conn()
        proj = c.execute("SELECT name FROM projects WHERE id=?", (project_id,)).fetchone()
        roster = {r["number"]: r["name"] for r in c.execute("SELECT number,name FROM roster_entries WHERE project_id=?", (project_id,))}
        rows = c.execute(
            """SELECT p.id, p.filename, q.classification, q.overall, k.keeper, g.seq_no, g.keep_all,
                      (SELECT GROUP_CONCAT(d.number, ',') FROM detected_players d WHERE d.photo_id=p.id AND d.number IS NOT NULL
                       AND d.status IN ('auto','confirmed')) AS nums
               FROM photos p LEFT JOIN quality q ON q.photo_id=p.id LEFT JOIN keepers k ON k.photo_id=p.id
               LEFT JOIN burst_members m ON m.photo_id=p.id LEFT JOIN burst_groups g ON g.id=m.burst_id
               WHERE p.project_id=? AND p.status='analyzed' ORDER BY p.capture_ts, p.filename""", (project_id,)).fetchall()
        items = []
        for r in rows:
            if only is not None and r["id"] not in only:
                continue
            nums = (r["nums"] or "").split(",") if r["nums"] else []
            who = ", ".join(f"#{n}" + (f" {roster[n]}" if n in roster else "") for n in nums) or "Unknown player"
            keep = (r["keeper"] == 1) if r["keeper"] is not None else bool(r["keep_all"])
            items.append({"thumb": str(pipeline.thumb_path(project_id, r["id"])), "label": r["filename"],
                          "sub": f"{who} · Q{(r['overall'] or 0):.0f}" + (f" · B{r['seq_no']:04d}" if r["seq_no"] else ""),
                          "cls": r["classification"], "star": keep})
        if not items:
            return None
        paths = contact_sheet.make_contact_sheets(items, root, "Contact_Sheet", f"{proj['name']} – review contact sheet")
        return "; ".join(str(p) for p in paths)


exporter = ExportRunner()
