"""Perceptual hashes and cheap image descriptors used for duplicate / burst detection."""
from __future__ import annotations

import cv2
import numpy as np


def phash(rgb: np.ndarray, size: int = 32, hash_size: int = 8) -> int:
    """64-bit DCT perceptual hash."""
    g = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY) if rgb.ndim == 3 else rgb
    g = cv2.resize(g, (size, size), interpolation=cv2.INTER_AREA).astype(np.float32)
    d = cv2.dct(g)[:hash_size, :hash_size]
    med = np.median(d.flatten()[1:])  # ignore DC term
    bits = (d.flatten() > med)
    return int("".join("1" if b else "0" for b in bits), 2)


def dhash(rgb: np.ndarray, hash_size: int = 8) -> int:
    g = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY) if rgb.ndim == 3 else rgb
    g = cv2.resize(g, (hash_size + 1, hash_size), interpolation=cv2.INTER_AREA)
    bits = (g[:, 1:] > g[:, :-1]).flatten()
    return int("".join("1" if b else "0" for b in bits), 2)


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def hash_similarity(a: int, b: int, bits: int = 64) -> float:
    return 1.0 - hamming(a, b) / bits


def hex64(v: int) -> str:
    return f"{v:016x}"


def from_hex(s: str) -> int:
    return int(s, 16)


def signature(rgb: np.ndarray, size: int = 16) -> np.ndarray:
    """Tiny grey layout descriptor (size x size, uint8) – used for structural correlation."""
    g = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    return cv2.resize(g, (size, size), interpolation=cv2.INTER_AREA)


def colour_hist(rgb: np.ndarray, bins: int = 8) -> np.ndarray:
    """Normalised HSV hue/sat histogram, float32."""
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    h = cv2.calcHist([hsv], [0, 1], None, [bins, bins], [0, 180, 0, 256]).flatten()
    h = h / (h.sum() + 1e-9)
    return h.astype(np.float32)


def signature_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Zero-mean normalised correlation mapped to 0..1."""
    x = a.astype(np.float32).flatten()
    y = b.astype(np.float32).flatten()
    x -= x.mean()
    y -= y.mean()
    den = np.linalg.norm(x) * np.linalg.norm(y)
    if den < 1e-6:
        return 1.0 if np.allclose(a, b, atol=3) else 0.0
    return float((np.dot(x, y) / den + 1) / 2)


def hist_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Bhattacharyya coefficient between normalised histograms (1 = identical)."""
    return float(np.sum(np.sqrt(a * b)))
