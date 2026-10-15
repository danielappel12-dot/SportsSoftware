from __future__ import annotations

import csv
import io

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..db import get_conn, tx
from ..services import corrections as corr
from ..settings import load_settings
from .deps import project_or_404

router = APIRouter(prefix="/api")


@router.get("/projects/{project_id}/players")
def players(project_id: int):
    """One row per jersey number (confident reads only) + an Unknown bucket + roster-only entries."""
    project_or_404(project_id)
    c = get_conn()
    roster = {r["number"]: r for r in c.execute("SELECT * FROM roster_entries WHERE project_id=?", (project_id,))}
    rows = c.execute(
        """SELECT d.number, COUNT(DISTINCT d.photo_id) AS photos, MAX(q.overall) AS best_quality,
                  SUM(d.status='confirmed') AS confirmed,
                  (SELECT d2.photo_id FROM detected_players d2 JOIN photos p2 ON p2.id=d2.photo_id LEFT JOIN quality q2 ON q2.photo_id=p2.id
                    WHERE d2.number=d.number AND d2.status IN ('auto','confirmed') AND p2.project_id=p.project_id
                    ORDER BY q2.overall DESC LIMIT 1) AS cover_photo
           FROM detected_players d JOIN photos p ON p.id=d.photo_id LEFT JOIN quality q ON q.photo_id=p.id
           WHERE p.project_id=? AND d.number IS NOT NULL AND d.status IN ('auto','confirmed') GROUP BY d.number""", (project_id,)).fetchall()
    out = []
    seen = set()
    for r in rows:
        seen.add(r["number"])
        rr = roster.get(r["number"])
        out.append({"number": r["number"], "name": rr["name"] if rr else None, "team": rr["team"] if rr else None,
                    "photos": r["photos"], "confirmed": r["confirmed"] or 0, "best_quality": r["best_quality"], "cover_photo": r["cover_photo"]})
    for n, rr in roster.items():
        if n not in seen:
            out.append({"number": n, "name": rr["name"], "team": rr["team"], "photos": 0, "confirmed": 0, "best_quality": None, "cover_photo": None})
    out.sort(key=lambda x: (not x["number"].isdigit(), int(x["number"]) if x["number"].isdigit() else 0, x["number"]))
    unknown = c.execute(
        """SELECT COUNT(*) FROM photos p LEFT JOIN quality q ON q.photo_id=p.id WHERE p.project_id=? AND p.status='analyzed'
           AND NOT EXISTS (SELECT 1 FROM detected_players d WHERE d.photo_id=p.id AND d.status IN ('auto','confirmed'))""", (project_id,)).fetchone()[0]
    return {"players": out, "unknown_photos": unknown}


class RosterIn(BaseModel):
    number: str = Field(min_length=1, max_length=3)
    name: str = Field(min_length=1, max_length=80)
    team: str | None = None


@router.get("/projects/{project_id}/roster")
def get_roster(project_id: int):
    project_or_404(project_id)
    return [dict(r) for r in get_conn().execute("SELECT * FROM roster_entries WHERE project_id=? ORDER BY CAST(number AS INTEGER), number", (project_id,))]


@router.post("/projects/{project_id}/roster")
def upsert_roster(project_id: int, body: RosterIn):
    project_or_404(project_id)
    if not body.number.isdigit():
        raise HTTPException(400, "Jersey numbers must be digits (e.g. 7 or 07).")
    with tx() as t:
        t.execute("INSERT INTO roster_entries(project_id,number,name,team) VALUES(?,?,?,?) "
                  "ON CONFLICT(project_id,number) DO UPDATE SET name=excluded.name, team=excluded.team",
                  (project_id, body.number, body.name.strip(), body.team))
    return get_roster(project_id)


@router.delete("/projects/{project_id}/roster/{number}")
def delete_roster(project_id: int, number: str):
    with tx() as t:
        t.execute("DELETE FROM roster_entries WHERE project_id=? AND number=?", (project_id, number))
    return get_roster(project_id)


class RosterCsv(BaseModel):
    csv_text: str = Field(max_length=200_000)


@router.post("/projects/{project_id}/roster/import")
def import_roster(project_id: int, body: RosterCsv):
    """CSV lines: number,name[,team]  (header row optional)."""
    project_or_404(project_id)
    n, bad = 0, []
    with tx() as t:
        for i, row in enumerate(csv.reader(io.StringIO(body.csv_text))):
            if len(row) < 2 or not row[0].strip():
                continue
            num, name = row[0].strip().lstrip("#"), row[1].strip()
            if not num.isdigit() or len(num) > 3 or not name:
                if i > 0:
                    bad.append(f"line {i + 1}: '{','.join(row)[:40]}'")
                continue
            t.execute("INSERT INTO roster_entries(project_id,number,name,team) VALUES(?,?,?,?) "
                      "ON CONFLICT(project_id,number) DO UPDATE SET name=excluded.name, team=excluded.team",
                      (project_id, num, name, row[2].strip() if len(row) > 2 else None))
            n += 1
    return {"imported": n, "ignored": bad}


class NumberIn(BaseModel):
    number: str | None = None


def _run(fn, *a):
    try:
        return fn(*a)
    except corr.CorrectionError as e:
        raise HTTPException(400, str(e))


@router.post("/players/{player_id}/number")
def set_number(player_id: int, body: NumberIn):
    return _run(corr.set_player_number, player_id, body.number, load_settings())


@router.post("/players/{player_id}/apply-burst")
def apply_burst(player_id: int):
    return _run(corr.apply_to_burst, player_id, load_settings())


@router.post("/photos/{photo_id}/assign")
def assign(photo_id: int, body: NumberIn):
    if not body.number:
        raise HTTPException(400, "Enter a jersey number.")
    return _run(corr.assign_photo, photo_id, body.number, load_settings())


@router.get("/projects/{project_id}/corrections")
def list_corrections(project_id: int, limit: int = 50):
    rows = get_conn().execute("SELECT id,kind,summary,created_at,undone_at FROM user_corrections WHERE project_id=? ORDER BY id DESC LIMIT ?",
                              (project_id, limit)).fetchall()
    return [dict(r) for r in rows]


@router.post("/corrections/{correction_id}/undo")
def undo(correction_id: int):
    return _run(corr.undo, correction_id, load_settings())


@router.post("/projects/{project_id}/corrections/reset")
def reset(project_id: int, confirm: bool = False):
    project_or_404(project_id)
    if not confirm:
        raise HTTPException(400, "Pass confirm=true: this discards all manual number assignments and keeper picks.")
    return {"removed": corr.reset_corrections(project_id)}
