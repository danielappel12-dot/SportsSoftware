"""Image-quality analysis: sharpness (subject first), motion blur, exposure, visibility, composition.

All sharpness numbers are mapped to a 0-100 *score* so thresholds are comparable between photos.
These are estimates – see README "How focus classification works".
"""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from ..settings import Settings


@dataclass
class QualityResult:
    global_sharpness: float = 0.0
    subject_sharpness: float | None = None
    sharpness_score: float = 0.0
    motion_blur: float = 0.0
    subject_visibility: float = 0.0
    clip_high: float = 0.0
    clip_low: float = 0.0
    mean_luma: float = 0.0
    exposure_score: float = 0.0
    face_count: int = 0
    face_visible: bool = False
    composition: float = 0.0
    resolution_mp: float = 0.0
    width: int = 0
    height: int = 0
    overall: float = 0.0
    classification: str = "review"
    basis: str = "global"
    reasons: list[str] = field(default_factory=list)
    subject_bbox: list[float] | None = None


def to_gray(rgb: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)


_MIN_EDGES = 60


def edge_widths(gray: np.ndarray):
    """Per-edge-pixel width estimates (px) and their gradient orientation bin (0..3).

    Width = local contrast / gradient magnitude at gradient-magnitude maxima. An ideal step edge is ~1px
    wide; defocus and motion blur widen it. Unlike Laplacian variance this is contrast-invariant and
    ignores noise/texture, because we only count *strong, isolated* edges whose contrast clears a floor
    derived from the measured noise level. Returns (widths, orientation_bins) or (None, None).
    """
    if gray.size < 1024 or min(gray.shape) < 24:
        return None, None
    g = cv2.GaussianBlur(gray.astype(np.float32), (0, 0), 0.8)
    lap = cv2.Laplacian(gray.astype(np.float32), cv2.CV_32F, ksize=3)
    noise = float(np.median(np.abs(lap)) / 0.6745 / np.sqrt(20.0))
    c_min = min(90.0, max(22.0, 4.0 * noise))
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3, scale=1 / 8.0)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3, scale=1 / 8.0)
    mag = cv2.magnitude(gx, gy)
    k = np.ones((9, 9), np.uint8)
    contrast = cv2.dilate(g, k) - cv2.erode(g, k)
    is_max = mag >= cv2.dilate(mag, np.ones((3, 3), np.uint8)) - 1e-6
    m = is_max & (contrast >= c_min) & (mag > 0.5 * c_min / 6.0)
    if int(m.sum()) < _MIN_EDGES:
        return None, None
    widths = contrast[m] / mag[m]
    ang = (np.degrees(np.arctan2(gy[m], gx[m])) % 180.0)
    bins = (((ang + 22.5) // 45).astype(np.int32)) % 4
    return np.clip(widths, 0.8, 40.0), bins


def width_to_score(w: float) -> float:
    """Map median edge width (px, measured on the analysis image) to 0-100.

    ~2.0px is a crisp edge here (0.8px pre-smoothing + optics) -> 100; ~3.9px ~ 55; ~5.9px ~ 30; >= 9px -> 0.
    """
    return float(np.clip(100.0 * (1.0 - (np.log2(max(w, 1e-3)) - np.log2(2.0)) / (np.log2(9.0) - np.log2(2.0))), 0, 100))


def sharpness_score_of(gray: np.ndarray) -> float | None:
    w, _ = edge_widths(gray)
    if w is None:
        return None
    return width_to_score(float(np.median(w)))


def tile_sharpness(gray: np.ndarray, grid: int = 6) -> float:
    """Whole-frame fallback: 85th percentile over tiles that contain measurable edges.

    A frame with a sharp subject and blurred background has some high tiles; a uniformly soft frame
    has none. A percentile (not max) damps single hot spots like stadium lights.
    """
    h, w = gray.shape
    vals = []
    for i in range(grid):
        for j in range(grid):
            t = gray[i * h // grid:(i + 1) * h // grid, j * w // grid:(j + 1) * w // grid]
            sc = sharpness_score_of(t)
            if sc is not None:
                vals.append(sc)
    if not vals:
        sc = sharpness_score_of(gray)
        return 0.0 if sc is None else sc
    return float(np.percentile(vals, 85))


def background_sharpness(gray: np.ndarray, box: tuple[float, float, float, float], grid: int = 6) -> float | None:
    """Median sharpness score of tiles whose centre lies outside the subject box (None if nothing measurable)."""
    h, w = gray.shape
    x, y, bw, bh = box
    vals, outside = [], 0
    for i in range(grid):
        for j in range(grid):
            cx, cy = (j + 0.5) / grid, (i + 0.5) / grid
            if x - 0.02 <= cx <= x + bw + 0.02 and y - 0.02 <= cy <= y + bh + 0.02:
                continue
            outside += 1
            sc = sharpness_score_of(gray[i * h // grid:(i + 1) * h // grid, j * w // grid:(j + 1) * w // grid])
            if sc is not None:
                vals.append(sc)
    if len(vals) >= 3:
        return float(np.median(vals))
    return 0.0 if outside >= 6 else None  # (almost) no edges anywhere outside the subject = completely soft/featureless


def motion_blur_score(gray: np.ndarray) -> tuple[float, float | None]:
    """Directional-blur estimate 0-100 plus the gradient angle (deg) of the blurriest edges.

    Motion blur widens edges whose normal points along the motion direction while edges parallel to it stay
    crisp. We compare median edge width per orientation bin; a large ratio with visibly soft worst bin => blur.
    """
    w, b = edge_widths(gray)
    if w is None:
        return 0.0, None
    meds, cnts = [], []
    for k in range(4):
        sel = w[b == k]
        meds.append(float(np.median(sel)) if sel.size else np.nan)
        cnts.append(sel.size)
    ok = [k for k in range(4) if cnts[k] >= max(40, 0.06 * len(w))]
    if len(ok) < 2:
        return 0.0, None
    worst = max(ok, key=lambda k: meds[k])
    best = min(ok, key=lambda k: meds[k])
    ratio = meds[worst] / max(meds[best], 1e-6)
    if meds[worst] < 3.2:
        return 0.0, None
    score = 100.0 * float(np.clip((ratio - 1.4) / 1.6, 0, 1))
    return score, [0.0, 45.0, 90.0, 135.0][worst]


def exposure_metrics(gray: np.ndarray) -> tuple[float, float, float, float]:
    n = gray.size
    clip_hi = float((gray >= 250).sum()) / n
    clip_lo = float((gray <= 5).sum()) / n
    mean = float(gray.mean())
    # penalties: clipping and being far from mid-grey (sports under arena lights: tolerate darker)
    pen = min(1.0, clip_hi * 6) * 40 + min(1.0, clip_lo * 4) * 30
    pen += min(1.0, abs(mean - 115) / 115) * 30
    return clip_hi, clip_lo, mean, float(np.clip(100 - pen, 0, 100))


_face_cascade = None


def _faces(gray: np.ndarray) -> int:
    global _face_cascade
    if _face_cascade is None:
        _face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    if _face_cascade.empty() or gray.size < 900:
        return 0
    s = 160.0 / max(gray.shape[:2]) if max(gray.shape[:2]) < 160 else 1.0
    g = cv2.resize(gray, None, fx=s, fy=s) if s != 1.0 else gray
    f = _face_cascade.detectMultiScale(g, 1.1, 5, minSize=(max(20, g.shape[1] // 12),) * 2)
    return int(len(f))


def composition_score(box: tuple[float, float, float, float] | None) -> float:
    """Subject placement 0-100: reward subjects near thirds/center, penalise cropped or tiny subjects."""
    if box is None:
        return 50.0
    x, y, w, h = box
    cx, cy = x + w / 2, y + h / 2
    dx = min(abs(cx - 0.5), abs(cx - 1 / 3), abs(cx - 2 / 3))
    dy = min(abs(cy - 0.5), abs(cy - 1 / 3), abs(cy - 2 / 3))
    place = 1 - min(1.0, (dx * 1.6 + dy * 1.0))
    margin = min(x, y, 1 - (x + w), 1 - (y + h))
    cut = 0.0 if margin >= 0.01 else 0.35
    size = np.clip(h / 0.35, 0, 1)  # a subject at >=35% frame height is comfortably large
    return float(np.clip(100 * (0.55 * place + 0.45 * size) - cut * 100, 0, 100))


def visibility_score(box: tuple[float, float, float, float] | None, others: list[tuple[float, float, float, float]]) -> float:
    if box is None:
        return 0.0
    x, y, w, h = box
    inside = max(0.0, min(x + w, 1) - max(x, 0)) * max(0.0, min(y + h, 1) - max(y, 0)) / max(w * h, 1e-9)
    occl = 0.0
    for ox, oy, ow, oh in others:
        iw = max(0.0, min(x + w, ox + ow) - max(x, ox))
        ih = max(0.0, min(y + h, oy + oh) - max(y, oy))
        occl = max(occl, iw * ih / max(w * h, 1e-9))
    size = np.clip(h / 0.25, 0, 1)
    return float(np.clip(100 * (0.4 * inside + 0.35 * (1 - occl) + 0.25 * size), 0, 100))


def pick_subject(boxes: list[tuple[float, float, float, float]]) -> int | None:
    """Primary subject = big + near the centre (score), not simply the biggest box."""
    if not boxes:
        return None
    best, best_s = 0, -1.0
    for i, (x, y, w, h) in enumerate(boxes):
        d = np.hypot(x + w / 2 - 0.5, y + h / 2 - 0.5)
        s = (w * h) ** 0.5 * (1.2 - d)
        if s > best_s:
            best, best_s = i, s
    return best


def classify(score: float, basis: str, s: Settings) -> str:
    margin = s.global_basis_margin if basis == "global" else 0.0
    if score >= s.focus_in_threshold + margin:
        return "in_focus"
    if score <= s.focus_out_threshold:
        return "out_of_focus"
    return "review"


def analyse_quality(rgb: np.ndarray, boxes: list[tuple[float, float, float, float]], settings: Settings,
                    orig_size: tuple[int, int] | None = None, detector_note: str | None = None) -> QualityResult:
    """`boxes` are normalised (x, y, w, h) player boxes; may be empty (detector missing or none found)."""
    gray = to_gray(rgb)
    H, W = gray.shape
    r = QualityResult()
    r.width, r.height = orig_size or (W, H)
    r.resolution_mp = round(r.width * r.height / 1e6, 2)
    r.global_sharpness = tile_sharpness(gray)
    r.clip_high, r.clip_low, r.mean_luma, r.exposure_score = exposure_metrics(gray)

    idx = pick_subject(boxes)
    subject_note = None
    if idx is not None:
        x, y, w, h = boxes[idx]
        x0, y0 = max(0, int(x * W)), max(0, int(y * H))
        x1, y1 = min(W, int((x + w) * W)), min(H, int((y + h) * H))
        crop = gray[y0:y1, x0:x1]
        sc = sharpness_score_of(crop) if crop.size >= 32 * 32 else None
        if sc is None:
            subject_note = "Player found but too small/flat to measure – sharpness measured on the whole frame."
        else:
            r.subject_sharpness = sc
            r.sharpness_score = sc
            r.basis = "subject"
            r.subject_bbox = [x, y, w, h]
            r.motion_blur, _ang = motion_blur_score(crop)
            head = gray[y0:y0 + max(1, (y1 - y0) // 3), x0:x1]  # head/face: upper third of the subject box
            r.face_count = _faces(head)
            r.face_visible = r.face_count > 0
            others = [b for i, b in enumerate(boxes) if i != idx]
            r.subject_visibility = visibility_score(boxes[idx], others)
            r.composition = composition_score(boxes[idx])
    if r.basis != "subject":
        r.sharpness_score = r.global_sharpness
        r.motion_blur, _ = motion_blur_score(gray)
        r.subject_visibility = 0.0
        r.composition = 50.0
        r.reasons.append(subject_note or detector_note or
                         "No player detected – sharpness measured on the whole frame (lower confidence).")

    r.classification = classify(r.sharpness_score, r.basis, settings)
    if r.basis == "subject" and r.subject_bbox:
        bg = background_sharpness(gray, tuple(r.subject_bbox))
        if bg is not None and bg - r.sharpness_score > 20 and r.classification != "in_focus":
            r.reasons.append("Background is sharper than the subject – likely front/back-focus or missed focus.")
        if bg is not None and r.sharpness_score - bg > 20:
            r.reasons.append("Subject is sharp against a softer background (typical of a good panning/shallow-DoF shot).")
    if r.motion_blur >= settings.motion_blur_flag:
        r.reasons.append(f"Directional (motion) blur likely – score {r.motion_blur:.0f}.")
        if r.classification == "in_focus" and r.motion_blur >= 80:
            r.classification = "review"
    if r.clip_high > 0.08:
        r.reasons.append(f"{r.clip_high * 100:.0f}% of pixels are blown highlights.")
    if r.clip_low > 0.25:
        r.reasons.append(f"{r.clip_low * 100:.0f}% of pixels are crushed shadows.")
    if r.basis == "global" and r.classification == "review" and r.sharpness_score >= settings.focus_in_threshold:
        r.reasons.append("Whole-frame sharpness is high but could come from grass/crowd detail, so it is held for review.")
    cls_txt = {"in_focus": "In Focus", "review": "Review", "out_of_focus": "Out of Focus"}[r.classification]
    r.reasons.insert(0, f"{cls_txt}: sharpness score {r.sharpness_score:.0f} on {r.basis} "
                        f"(in-focus ≥ {settings.focus_in_threshold:.0f}, out-of-focus ≤ {settings.focus_out_threshold:.0f}).")

    face_part = 100.0 if r.face_visible else 45.0
    r.overall = float(np.clip(
        0.40 * r.sharpness_score + 0.12 * (100 - r.motion_blur) + 0.15 * r.subject_visibility +
        0.10 * face_part + 0.10 * r.composition + 0.13 * r.exposure_score, 0, 100))
    return r
