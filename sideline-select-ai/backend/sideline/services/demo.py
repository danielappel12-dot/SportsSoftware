"""Synthetic SAMPLE photos for demo mode and tests.

Everything here is generated, fictional, and labelled as such (the demo project is flagged ``is_demo``).
The images are cartoon field scenes with numbered players; they let the full pipeline run offline without model
weights. They say nothing about accuracy on real photographs.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

TEAMS = [((30, 70, 200), (20, 40, 120)), ((200, 40, 40), (120, 25, 25)),
         ((230, 170, 20), (140, 100, 15)), ((150, 40, 170), (90, 25, 100))]


def _field(rng: np.random.Generator, w: int, h: int) -> np.ndarray:
    img = np.empty((h, w, 3), np.float32)
    img[:] = (58, 105, 62)
    img += rng.normal(0, 7, img.shape)  # grass texture / noise
    out = np.clip(img, 0, 255).astype(np.uint8)
    for x in range(0, w, 160):
        cv2.line(out, (x, 0), (x, h), (205, 215, 205), 2, cv2.LINE_AA)
    return out


def _player(img: np.ndarray, cx: int, base_y: int, height: int, number: str, team: int) -> None:
    jersey, pants = TEAMS[team % len(TEAMS)]
    w = int(height * 0.36)
    top = base_y - height
    head_r = int(height * 0.085)
    cv2.circle(img, (cx, top + head_r), head_r, (205, 165, 135), -1, cv2.LINE_AA)
    torso_top = top + 2 * head_r
    torso_h = int(height * 0.42)
    cv2.rectangle(img, (cx - w // 2, torso_top), (cx + w // 2, torso_top + torso_h), jersey, -1)
    cv2.rectangle(img, (cx - w // 2 + 4, torso_top + torso_h), (cx + w // 2 - 4, base_y), pants, -1)
    scale = height / 190.0 * (1.6 if len(number) == 1 else 1.25)
    while True:  # fit the number inside the jersey width (with margin), like real numbers on real jerseys
        thick = max(2, int(scale * 3))
        (tw, th), _ = cv2.getTextSize(number, cv2.FONT_HERSHEY_DUPLEX, scale, thick)
        if tw <= 0.66 * w or scale < 0.3:
            break
        scale *= 0.93
    cv2.putText(img, number, (cx - tw // 2, torso_top + torso_h // 2 + th // 2), cv2.FONT_HERSHEY_DUPLEX,
                scale, (255, 255, 255), thick, cv2.LINE_AA)


def _degrade(img: np.ndarray, kind: str) -> np.ndarray:
    if kind == "soft":
        return cv2.GaussianBlur(img, (0, 0), 2.6)
    if kind == "blur":
        return cv2.GaussianBlur(img, (0, 0), 6.0)
    if kind == "motion":
        k = 25
        ker = np.zeros((k, k), np.float32)
        ker[k // 2, :] = 1.0 / k
        return cv2.filter2D(img, -1, ker)
    return img


def _write_jpeg(arr: np.ndarray, path: Path, when: datetime) -> None:
    im = Image.fromarray(arr)
    exif = Image.Exif()
    exif[0x010F] = "SidelineDemo"
    exif[0x0110] = "Synthetic Camera"
    ifd = exif.get_ifd(0x8769)
    ifd[0x9003] = when.strftime("%Y:%m:%d %H:%M:%S")
    ifd[0x9291] = f"{when.microsecond // 1000:03d}"
    im.save(path, "JPEG", quality=92, exif=exif)


def generate_demo_set(dest: str | Path, plays: int = 5, frames_per_play: int = 6, seed: int = 7,
                      size: tuple[int, int] = (1200, 800), extras: bool = True) -> dict:
    """Write a labelled sample game to ``dest`` and return the ground-truth manifest (tests use it)."""
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    W, H = size
    start = datetime(2025, 9, 6, 19, 30, 0)
    manifest: dict = {"files": [], "plays": []}
    numbers_pool = ["7", "12", "23", "88", "5", "34", "9", "41"]
    counter = 1
    for p in range(plays):
        num = numbers_pool[p % len(numbers_pool)]
        team = p % len(TEAMS)
        field = _field(rng, W, H)
        t0 = start + timedelta(seconds=p * 45)
        x = int(W * rng.uniform(0.3, 0.6))
        height = int(H * rng.uniform(0.62, 0.75))
        names = []
        for f in range(frames_per_play):
            frame = field.copy()
            # same sensor noise-free field, player drifts a little each frame
            px = x + f * 14
            _player(frame, px, int(H * 0.93), height, num, team)
            kind = "sharp"
            if f == frames_per_play - 1:
                kind = "motion" if p % 2 == 0 else "blur"
            elif f == 2:
                kind = "soft"
            frame = _degrade(frame, kind)
            frame = np.clip(frame.astype(np.float32) + rng.normal(0, 1.5, frame.shape), 0, 255).astype(np.uint8)
            name = f"DEMO_{counter:04d}.jpg"
            _write_jpeg(frame, dest / name, t0 + timedelta(milliseconds=200 * f))
            manifest["files"].append({"name": name, "play": p, "number": num, "quality": kind})
            names.append(name)
            counter += 1
        manifest["plays"].append({"play": p, "number": num, "files": names})
    if extras:
        # exact duplicate of the first file, and a deliberately corrupt file (must not stop the job)
        first = dest / manifest["files"][0]["name"]
        (dest / "DEMO_DUPLICATE_of_0001.jpg").write_bytes(first.read_bytes())
        (dest / "DEMO_CORRUPT.jpg").write_bytes(b"\xff\xd8\xff\xe0 this is not a real jpeg")
        (dest / "notes.txt").write_text("unsupported file types are ignored")
        manifest["duplicate"] = "DEMO_DUPLICATE_of_0001.jpg"
        manifest["corrupt"] = "DEMO_CORRUPT.jpg"
    (dest / "DEMO_MANIFEST.json").write_text(json.dumps(manifest, indent=2))
    return manifest
