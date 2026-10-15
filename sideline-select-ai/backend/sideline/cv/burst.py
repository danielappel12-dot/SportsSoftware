"""Burst / near-duplicate grouping. Pure functions over lightweight photo signatures (unit tested)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import numpy as np

from . import hashing


@dataclass
class PhotoSig:
    id: int
    name: str
    ts: float | None
    phash: int
    dhash: int
    sig: np.ndarray
    hist: np.ndarray
    numbers: frozenset[str] = frozenset()   # confident jersey numbers visible in the frame
    embedding: np.ndarray | None = None


def natural_key(s: str):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def pair_similarity(a: PhotoSig, b: PhotoSig) -> float:
    """0..1 blend of perceptual hashes, structural correlation and colour histogram (+ embedding if available)."""
    p = hashing.hash_similarity(a.phash, b.phash)
    d = hashing.hash_similarity(a.dhash, b.dhash)
    s = hashing.signature_similarity(a.sig, b.sig)
    c = hashing.hist_similarity(a.hist, b.hist)
    if a.embedding is not None and b.embedding is not None:
        e = float(np.clip(np.dot(a.embedding, b.embedding) /
                          (np.linalg.norm(a.embedding) * np.linalg.norm(b.embedding) + 1e-9), 0, 1))
        return 0.25 * p + 0.10 * d + 0.20 * s + 0.10 * c + 0.35 * e
    return 0.35 * p + 0.15 * d + 0.35 * s + 0.15 * c


def _compatible(a: PhotoSig, b: PhotoSig, threshold: float, max_gap: float) -> tuple[bool, float]:
    if a.ts is not None and b.ts is not None and abs(b.ts - a.ts) > max_gap:
        return False, 0.0
    sim = pair_similarity(a, b)
    if a.numbers and b.numbers:
        if a.numbers & b.numbers:
            sim = min(1.0, sim + 0.04)
        elif sim < 0.97:
            return False, sim  # clearly different players, do not merge unless near-identical
    return sim >= threshold, sim


def order_photos(photos: list[PhotoSig]) -> list[PhotoSig]:
    """Chronological where the camera clock is known, filename order otherwise."""
    return sorted(photos, key=lambda p: (p.ts is None, p.ts if p.ts is not None else 0.0, natural_key(p.name)))


def group_bursts(photos: list[PhotoSig], threshold: float = 0.8, max_gap: float = 4.0, max_size: int = 80,
                 lookahead: int = 4, min_size: int = 2) -> tuple[list[list[int]], dict[tuple[int, int], float]]:
    """Return (groups of photo ids with >= min_size members, pair-similarity cache).

    Each frame is compared with the next ``lookahead`` frames so a single odd frame (blink, occlusion) does not
    break a sequence, but a time gap > ``max_gap`` or a different-player conflict always does. Group size is capped
    so a long game can never collapse into one giant burst.
    """
    ordered = order_photos(photos)
    parent = {p.id: p.id for p in ordered}
    size = {p.id: 1 for p in ordered}
    sims: dict[tuple[int, int], float] = {}

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, a in enumerate(ordered):
        for b in ordered[i + 1:i + 1 + lookahead]:
            ok, sim = _compatible(a, b, threshold, max_gap)
            sims[(a.id, b.id)] = sim
            if not ok:
                continue
            ra, rb = find(a.id), find(b.id)
            if ra != rb and size[ra] + size[rb] <= max_size:
                parent[rb] = ra
                size[ra] += size[rb]
    groups: dict[int, list[int]] = {}
    for p in ordered:
        groups.setdefault(find(p.id), []).append(p.id)
    return [g for g in groups.values() if len(g) >= min_size], sims


@dataclass
class RankInput:
    id: int
    sharpness: float
    motion_blur: float
    visibility: float
    face_visible: bool
    composition: float
    exposure: float
    number_conf: float = 0.0
    representative: float = 0.5   # mean similarity to the rest of the burst, 0..1
    classification: str = "review"
    ts: float | None = None


@dataclass
class RankResult:
    id: int
    score: float
    rank: int
    parts: dict[str, float] = field(default_factory=dict)


def rank_group(items: list[RankInput], weights: dict[str, float]) -> list[RankResult]:
    """Order frames best-first. Never discards; callers decide what 'keeper' means."""
    total_w = sum(weights.values()) or 1.0
    scored = []
    for it in items:
        parts = {
            "sharpness": it.sharpness,
            "motion": 100 - it.motion_blur,
            "visibility": it.visibility,
            "face": 100.0 if it.face_visible else 40.0,
            "composition": it.composition,
            "exposure": it.exposure,
            "number": 100 * it.number_conf,
            "representative": 100 * it.representative,
        }
        score = sum(weights.get(k, 0.0) * v for k, v in parts.items()) / total_w
        if it.classification == "out_of_focus":
            score *= 0.6  # an out-of-focus frame should rarely beat a usable one
        elif it.classification == "review":
            score *= 0.9
        scored.append((score, it, parts))
    scored.sort(key=lambda t: (-t[0], t[1].ts if t[1].ts is not None else 0.0, t[1].id))
    return [RankResult(it.id, round(sc, 2), i + 1, {k: round(v, 1) for k, v in parts.items()})
            for i, (sc, it, parts) in enumerate(scored)]
