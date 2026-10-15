"""Jersey-number reading on top of a detector + OCR engine.

Pure functions (normalisation, plausibility, review assignment) are unit tested; ``read_player_number`` glues them
to an OCR engine.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import cv2
import numpy as np

from .ocr import OcrEngine, OcrToken

# Characters OCR commonly confuses with digits. Only applied when *every* char is digit-like.
_CONFUSABLE = {"O": "0", "o": "0", "D": "0", "Q": "0", "I": "1", "l": "1", "|": "1", "i": "1", "!": "1",
               "Z": "2", "z": "2", "S": "5", "s": "5", "G": "6", "b": "6", "T": "7", "B": "8", "g": "9", "q": "9"}


@dataclass
class NumberCandidate:
    number: str
    ocr_conf: float
    geom: float            # 0..1 plausibility from box geometry/position
    conf: float            # combined
    raw_text: str
    box: tuple[float, float, float, float]  # normalised to the player box
    notes: list[str] = field(default_factory=list)


def normalise_number(text: str, max_digits: int = 2, allow_leading_zero: bool = True) -> tuple[str | None, float]:
    """Return (number, penalty 0..1) from raw OCR text, or (None, 1.0) if it cannot be a jersey number.

    * keeps leading zeroes ("07", "00") when allowed, otherwise strips them ("07" -> "7", "00" -> "0")
    * repairs look-alike letters only when the whole token is digit-like (so "NIKE" is never "1K3" etc.)
    * rejects long digit strings (phone numbers, sponsor text, scoreboard) beyond ``max_digits``
    """
    if not text:
        return None, 1.0
    t = re.sub(r"[\s\-_.,:;#'\"]", "", text.strip())
    if not t:
        return None, 1.0
    penalty = 0.0
    if not t.isdigit():
        if all(ch.isdigit() or ch in _CONFUSABLE for ch in t) and any(ch.isdigit() or ch in _CONFUSABLE for ch in t):
            fixed = "".join(_CONFUSABLE.get(ch, ch) for ch in t)
            if not fixed.isdigit():
                return None, 1.0
            t, penalty = fixed, 0.25  # a repaired read is less trustworthy
        else:
            return None, 1.0
    if len(t) > max_digits:
        return None, 1.0
    if not allow_leading_zero and len(t) > 1 and t.startswith("0"):
        t = t.lstrip("0") or "0"
    return t, penalty


def geometry_score(box: tuple[float, float, float, float], n_digits: int,
                   player_aspect: float = 0.4) -> tuple[float, list[str]]:
    """Plausibility of a text box (normalised to the player's box) being a back/chest number.

    ``player_aspect`` = player box width / height in pixels, needed to judge digit aspect ratio."""
    x, y, w, h = box
    notes: list[str] = []
    s = 1.0
    if not 0.07 <= h <= 0.50:
        s *= 0.35 if (h < 0.07 or h > 0.6) else 0.7
        notes.append(f"text height {h:.2f} of player is atypical")
    per_digit_ar = (w * player_aspect / max(n_digits, 1)) / max(h, 1e-6)
    if not 0.25 <= per_digit_ar <= 1.3:
        s *= 0.6
        notes.append("digit aspect ratio atypical")
    cx, cy = x + w / 2, y + h / 2
    if abs(cx - 0.5) > 0.32:
        s *= 0.55
        notes.append("number is far from torso centre line")
    if not 0.12 <= cy <= 0.68:
        s *= 0.5
        notes.append("number is outside the torso band")
    return float(s), notes


def jersey_regions(h: int, w: int) -> list[tuple[str, tuple[int, int, int, int]]]:
    """Candidate sub-boxes (x0, y0, x1, y1) inside a player crop where numbers usually sit."""
    return [
        ("torso", (int(0.08 * w), int(0.19 * h), int(0.92 * w), int(0.68 * h))),
        ("mid", (int(0.08 * w), int(0.24 * h), int(0.92 * w), int(0.58 * h))),
    ]


def _prep_variants(crop: np.ndarray) -> list[np.ndarray]:
    h, w = crop.shape[:2]
    s = max(1.0, 160.0 / max(h, 1))
    up = cv2.resize(crop, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC) if s > 1.0 else crop
    lab = cv2.cvtColor(up, cv2.COLOR_RGB2LAB)
    lab[..., 0] = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4)).apply(lab[..., 0])
    return [up, cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)]


def read_player_number(player_rgb: np.ndarray, ocr: OcrEngine, max_digits: int = 2,
                       allow_leading_zero: bool = True) -> tuple[NumberCandidate | None, list[NumberCandidate]]:
    """Run OCR over candidate regions and return (best, all candidates).

    The best candidate is *not* simply the biggest or highest-OCR-confidence read: each candidate is weighted by
    geometry plausibility, and conflicting strong reads reduce confidence instead of silently picking one.
    """
    H, W = player_rgb.shape[:2]
    if H < 24 or W < 12:
        return None, []
    cands: list[NumberCandidate] = []
    for _name, (x0, y0, x1, y1) in jersey_regions(H, W):
        region = player_rgb[y0:y1, x0:x1]
        if region.size == 0:
            continue
        for variant in _prep_variants(region):
            sx = variant.shape[1] / region.shape[1]
            sy = variant.shape[0] / region.shape[0]
            for tok in ocr.read(variant):
                num, pen = normalise_number(tok.text, max_digits, allow_leading_zero)
                if num is None:
                    continue
                bx, by, bw, bh = tok.box
                nb = ((x0 + bx / sx) / W, (y0 + by / sy) / H, (bw / sx) / W, (bh / sy) / H)
                geom, notes = geometry_score(nb, len(num), W / H)
                conf = float(np.clip(tok.conf, 0, 1)) * geom * (1 - pen)
                cands.append(NumberCandidate(num, float(tok.conf), geom, conf, tok.text, nb, notes))
    if not cands:
        return None, []
    # merge identical reads from different regions/variants: agreement raises confidence slightly
    merged: dict[str, NumberCandidate] = {}
    votes: dict[str, int] = {}
    for c in cands:
        votes[c.number] = votes.get(c.number, 0) + 1
        if c.number not in merged or c.conf > merged[c.number].conf:
            merged[c.number] = c
    for num, c in merged.items():
        if votes[num] > 1:
            c.conf = min(1.0, c.conf * (1 + 0.04 * (votes[num] - 1)))
            c.notes.append(f"{votes[num]} agreeing reads")
    ranked = sorted(merged.values(), key=lambda c: c.conf, reverse=True)
    best = ranked[0]
    if len(ranked) > 1 and ranked[1].conf >= 0.8 * best.conf and ranked[1].number != best.number:
        best.conf *= 0.6
        best.notes.append(f"conflicting read '{ranked[1].number}' – confidence reduced")
    return best, ranked


def assign_status(number: str | None, conf: float, accept: float, floor: float) -> str:
    """auto (>= accept) | needs_review (floor..accept) | unknown (no/very weak read)."""
    if number is None or conf < floor:
        return "unknown"
    if conf >= accept:
        return "auto"
    return "needs_review"


def torso_appearance(player_rgb: np.ndarray) -> np.ndarray:
    """Jersey colour histogram (8x8 hue/sat on the torso) used to link the same player across a burst."""
    h, w = player_rgb.shape[:2]
    torso = player_rgb[int(0.15 * h):int(0.65 * h), int(0.15 * w):int(0.85 * w)]
    if torso.size == 0:
        torso = player_rgb
    hsv = cv2.cvtColor(torso, cv2.COLOR_RGB2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [8, 8], [0, 180, 0, 256]).flatten()
    return (hist / (hist.sum() + 1e-9)).astype(np.float32)
