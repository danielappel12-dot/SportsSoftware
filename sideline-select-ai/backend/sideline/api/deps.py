from __future__ import annotations

from fastapi import HTTPException

from ..db import get_conn


def project_or_404(project_id: int):
    r = get_conn().execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if r is None:
        raise HTTPException(404, "Project not found")
    return r


def photo_or_404(photo_id: int):
    r = get_conn().execute("SELECT * FROM photos WHERE id=?", (photo_id,)).fetchone()
    if r is None:
        raise HTTPException(404, "Photo not found")
    return r


# A photo needs the photographer's eyes when: focus is borderline, or no jersey number was confidently read
# (unless the frame is already clearly out of focus – nobody needs to ID a blurry frame) – and they have not
# already reviewed it.
NEEDS_REVIEW_SQL = ("(p.reviewed=0 AND p.status='analyzed' AND (q.classification='review' OR (q.classification<>'out_of_focus' "
                    "AND NOT EXISTS (SELECT 1 FROM detected_players d WHERE d.photo_id=p.id AND d.status IN ('auto','confirmed')))))")
KEEPER_SQL = "(CASE WHEN k.keeper IS NOT NULL THEN k.keeper WHEN g.keep_all=1 THEN 1 ELSE 0 END)"
