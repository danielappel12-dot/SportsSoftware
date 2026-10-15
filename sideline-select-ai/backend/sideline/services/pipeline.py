"""Per-photo ingest + analysis. Everything here reads originals read-only and writes only to the cache/DB."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import numpy as np
from PIL import Image

from .. import config, imageio
from ..cv import embedding, hashing, jersey
from ..cv.detection import DetectorUnavailable, get_detector
from ..cv.ocr import OcrUnavailable, get_ocr
from ..cv.quality import analyse_quality
from ..db import get_conn, now, tx
from ..settings import Settings

MAX_PLAYERS_PER_PHOTO = 12


def sha256_file(path: str, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def analysis_path(project_id: int, photo_id: int) -> Path:
    return config.cache_dir(project_id) / "analysis" / f"{photo_id}.jpg"


def thumb_path(project_id: int, photo_id: int) -> Path:
    return config.cache_dir(project_id) / "thumbs" / f"{photo_id}.jpg"


def crop_path(project_id: int, photo_id: int, i: int) -> Path:
    return config.cache_dir(project_id) / "crops" / f"{photo_id}_{i}.jpg"


def effective_path(row) -> str:
    return row["moved_to"] or row["original_path"]


def _set_status(photo_id: int, status: str, detail: str | None = None) -> None:
    with tx() as c:
        c.execute("UPDATE photos SET status=?, status_detail=? WHERE id=?", (status, detail, photo_id))


def ingest_photo(photo_id: int, settings: Settings) -> str:
    """hash + EXIF + thumbnail + analysis cache + perceptual descriptors. Returns final status."""
    c = get_conn()
    row = c.execute("SELECT * FROM photos WHERE id=?", (photo_id,)).fetchone()
    if row is None:
        return "error"
    path = effective_path(row)
    pid = row["project_id"]
    try:
        if not os.path.isfile(path):
            raise imageio.CorruptImage("File no longer exists at its original location.")
        st = os.stat(path)
        digest = sha256_file(path)
        dup = c.execute(
            "SELECT id, filename FROM photos WHERE project_id=? AND sha256=? AND id<>? AND status NOT IN ('skipped','error') "
            "ORDER BY id LIMIT 1", (pid, digest, photo_id)).fetchone()
        if dup is not None:
            with tx() as t:
                t.execute("UPDATE photos SET sha256=?, file_size=?, file_mtime=?, status='skipped', status_detail=? WHERE id=?",
                          (digest, st.st_size, st.st_mtime, f"Identical file already imported as {dup['filename']} (#{dup['id']}).",
                           photo_id))
            return "skipped"
        meta = imageio.read_exif(path)
        im = imageio.open_image(path, max_edge=settings.analysis_size)
        try:
            w, h = imageio.image_size(path) if not imageio.is_raw(path) else im.size
        except imageio.CorruptImage:
            w, h = im.size
        arr = imageio.to_array(im)
        imageio.save_jpeg(im, analysis_path(pid, photo_id), quality=92)
        th = im.copy()
        th.thumbnail((settings.thumb_size, settings.thumb_size), Image.LANCZOS)
        imageio.save_jpeg(th, thumb_path(pid, photo_id), quality=82)
        sig = hashing.signature(arr)
        hist = hashing.colour_hist(arr)
        emb = embedding.embed(arr) if settings.use_embeddings else None
        with tx() as t:
            t.execute(
                """UPDATE photos SET sha256=?, file_size=?, file_mtime=?, width=?, height=?, capture_time=?, capture_ts=?,
                   camera_make=?, camera_model=?, exif_json=?, phash=?, dhash=?, signature=?, hist=?, embedding=?,
                   status='ingested', status_detail=NULL WHERE id=?""",
                (digest, st.st_size, st.st_mtime, w, h, meta.get("capture_time"), meta.get("capture_ts"),
                 meta.get("camera_make"), meta.get("camera_model"), imageio.exif_json(meta),
                 hashing.hex64(hashing.phash(arr)), hashing.hex64(hashing.dhash(arr)), sig.tobytes(), hist.tobytes(),
                 emb.tobytes() if emb is not None else None, photo_id))
        return "ingested"
    except imageio.UnsupportedImage as e:
        _set_status(photo_id, "error", f"Unsupported on this system: {e}")
        return "error"
    except (imageio.CorruptImage, OSError, ValueError) as e:
        _set_status(photo_id, "error", f"Could not read image: {e}")
        return "error"
    except Exception as e:  # never let one file stop the batch
        _set_status(photo_id, "error", f"Unexpected error: {type(e).__name__}: {e}")
        return "error"


def _iou(a, b) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    iw = max(0.0, min(ax + aw, bx + bw) - max(ax, bx))
    ih = max(0.0, min(ay + ah, by + bh) - max(ay, by))
    inter = iw * ih
    return inter / (aw * ah + bw * bh - inter + 1e-9)


def engine_status(settings: Settings, demo: bool) -> dict:
    det = get_detector(settings.detector_engine, settings.use_gpu, demo)
    ocr = get_ocr(settings.ocr_engine, settings.use_gpu, demo)
    d_ok, d_msg = det.status()
    o_ok, o_msg = ocr.status()
    return {"detector": {"name": det.name, "ok": d_ok, "message": d_msg, "description": det.description},
            "ocr": {"name": ocr.name, "ok": o_ok, "message": o_msg, "description": ocr.description}}


def analyze_photo(photo_id: int, settings: Settings) -> str:
    """Detect players, read numbers, score quality; persist. Preserves rows the user has corrected."""
    c = get_conn()
    row = c.execute("SELECT p.*, pr.is_demo FROM photos p JOIN projects pr ON pr.id=p.project_id WHERE p.id=?",
                    (photo_id,)).fetchone()
    if row is None:
        return "error"
    pid = row["project_id"]
    try:
        ap = analysis_path(pid, photo_id)
        if ap.exists():
            arr = imageio.to_array(Image.open(ap))
        else:
            arr = imageio.to_array(imageio.open_image(effective_path(row), max_edge=settings.analysis_size))
        H, W = arr.shape[:2]
        demo = bool(row["is_demo"])
        det = get_detector(settings.detector_engine, settings.use_gpu, demo)
        ocr = get_ocr(settings.ocr_engine, settings.use_gpu, demo)
        d_ok, d_msg = det.status()
        o_ok, o_msg = ocr.status()
        detections = []
        note = None
        if d_ok:
            try:
                detections = det.detect(arr, settings.detector_confidence)
            except DetectorUnavailable as e:
                d_ok, note = False, str(e)
        if not d_ok:
            note = note or f"Player detection unavailable ({d_msg}) – whole-frame sharpness used."
        detections = sorted(detections, key=lambda d: d.w * d.h, reverse=True)[:MAX_PLAYERS_PER_PHOTO]
        boxes = [d.box() for d in detections]
        q = analyse_quality(arr, boxes, settings, orig_size=(row["width"] or W, row["height"] or H), detector_note=note)

        players = []
        for i, d in enumerate(detections):
            x0, y0 = max(0, int(d.x * W)), max(0, int(d.y * H))
            x1, y1 = min(W, int((d.x + d.w) * W)), min(H, int((d.y + d.h) * H))
            crop = arr[y0:y1, x0:x1]
            if crop.size == 0:
                continue
            cp = crop_path(pid, photo_id, i)
            ci = Image.fromarray(crop)
            ci.thumbnail((256, 256))
            imageio.save_jpeg(ci, cp, quality=82)
            best, text = None, None
            if o_ok:
                try:
                    best, _all = jersey.read_player_number(crop, ocr, settings.max_jersey_digits, settings.allow_leading_zero)
                except OcrUnavailable:
                    o_ok = False
            number = best.number if best else None
            conf = best.conf if best else 0.0
            status = jersey.assign_status(number, conf, settings.number_confidence, settings.number_review_floor)
            pnote = None
            if not o_ok:
                pnote = f"Jersey OCR unavailable: {o_msg}"
            elif best is not None and best.notes:
                pnote = "; ".join(best.notes)
            players.append({
                "bbox": d.box(), "det_conf": d.conf, "number": number if status != "unknown" else None,
                "conf": conf, "raw": best.raw_text if best else None,
                "nbox": json.dumps([float(v) for v in best.box]) if best else None, "crop": str(cp), "status": status,
                "note": pnote, "appearance": jersey.torso_appearance(crop).tobytes()})

        with tx() as t:
            user_rows = t.execute("SELECT bx,by,bw,bh FROM detected_players WHERE photo_id=? AND source='user' AND bw>0",
                                  (photo_id,)).fetchall()
            user_boxes = [(r["bx"], r["by"], r["bw"], r["bh"]) for r in user_rows]
            t.execute("DELETE FROM detected_players WHERE photo_id=? AND source<>'user'", (photo_id,))
            for p in players:
                if any(_iou(p["bbox"], ub) > 0.5 for ub in user_boxes):
                    continue  # the photographer already handled this player; keep their version
                t.execute(
                    """INSERT INTO detected_players(photo_id,bx,by,bw,bh,det_conf,number,number_conf,raw_text,number_box,crop_path,
                       status,source,note,appearance,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'ocr',?,?,?)""",
                    (photo_id, *p["bbox"], p["det_conf"], p["number"], p["conf"], p["raw"], p["nbox"], p["crop"], p["status"],
                     p["note"], p["appearance"], now()))
            t.execute(
                """INSERT INTO quality(photo_id,global_sharpness,subject_sharpness,sharpness_score,motion_blur,subject_visibility,
                   clip_high,clip_low,mean_luma,exposure_score,face_count,face_visible,composition,resolution_mp,width,height,
                   overall,classification,basis,reasons,subject_bbox,thresholds)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(photo_id) DO UPDATE SET global_sharpness=excluded.global_sharpness,
                   subject_sharpness=excluded.subject_sharpness, sharpness_score=excluded.sharpness_score,
                   motion_blur=excluded.motion_blur, subject_visibility=excluded.subject_visibility,
                   clip_high=excluded.clip_high, clip_low=excluded.clip_low, mean_luma=excluded.mean_luma,
                   exposure_score=excluded.exposure_score, face_count=excluded.face_count, face_visible=excluded.face_visible,
                   composition=excluded.composition, resolution_mp=excluded.resolution_mp, width=excluded.width,
                   height=excluded.height, overall=excluded.overall, classification=excluded.classification,
                   basis=excluded.basis, reasons=excluded.reasons, subject_bbox=excluded.subject_bbox,
                   thresholds=excluded.thresholds""",
                (photo_id, q.global_sharpness, q.subject_sharpness, q.sharpness_score, q.motion_blur, q.subject_visibility,
                 q.clip_high, q.clip_low, q.mean_luma, q.exposure_score, q.face_count, int(q.face_visible), q.composition,
                 q.resolution_mp, q.width, q.height, q.overall, q.classification, q.basis, json.dumps(q.reasons),
                 json.dumps(q.subject_bbox), json.dumps({"in": settings.focus_in_threshold, "out": settings.focus_out_threshold,
                                                        "detector": det.name, "ocr": ocr.name})))
            t.execute("UPDATE photos SET status='analyzed', status_detail=NULL, analyzed_at=? WHERE id=?", (now(), photo_id))
        return "analyzed"
    except imageio.UnsupportedImage as e:
        _set_status(photo_id, "error", f"Unsupported on this system: {e}")
        return "error"
    except Exception as e:
        _set_status(photo_id, "error", f"Analysis failed: {type(e).__name__}: {e}")
        return "error"
