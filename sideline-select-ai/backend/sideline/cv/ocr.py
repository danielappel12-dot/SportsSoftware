"""Pluggable OCR engines for jersey numbers.

* ``paddleocr``     – PaddleOCR (Apache-2.0). Optional install; lazy-loaded.
* ``demo-template`` – real template-matching reader for the *synthetic* demo digits only.
* ``none``          – explicit "no OCR".
"""
from __future__ import annotations

import threading
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class OcrToken:
    text: str
    conf: float
    box: tuple[float, float, float, float]  # x, y, w, h in the input image's pixel coords


class OcrUnavailable(Exception):
    pass


class OcrEngine:
    name = "base"
    description = ""

    def status(self) -> tuple[bool, str]:
        return True, "ready"

    def read(self, rgb: np.ndarray) -> list[OcrToken]:  # pragma: no cover - interface
        raise NotImplementedError


class NullOcr(OcrEngine):
    name = "none"

    def status(self):
        return False, "No OCR engine installed (see docs/MODELS.md)."

    def read(self, rgb):
        return []


class PaddleOcrEngine(OcrEngine):
    name = "paddleocr"
    description = "PaddleOCR text recognition"

    def __init__(self, use_gpu: bool = False):
        self._ocr = None
        self._lock = threading.Lock()
        self.use_gpu = use_gpu

    def status(self):
        try:
            import paddleocr  # noqa: F401
            return True, "ready"
        except Exception:
            return False, ("PaddleOCR is not installed. Run: pip install -r requirements-ml.txt "
                           "(paddlepaddle + paddleocr, see docs/MODELS.md).")

    def _engine(self):
        if self._ocr is None:
            ok, why = self.status()
            if not ok:
                raise OcrUnavailable(why)
            from paddleocr import PaddleOCR
            try:  # PaddleOCR 2.x
                self._ocr = PaddleOCR(use_angle_cls=False, lang="en", use_gpu=self.use_gpu, show_log=False)
            except (TypeError, ValueError):  # 3.x renamed/dropped arguments
                self._ocr = PaddleOCR(use_textline_orientation=False, lang="en")
        return self._ocr

    def read(self, rgb):
        eng = self._engine()
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        with self._lock:
            try:
                res = eng.ocr(bgr, cls=False)
            except TypeError:
                res = eng.ocr(bgr)
        tokens: list[OcrToken] = []
        if not res:
            return tokens
        page = res[0] if isinstance(res, list) and res else res
        if isinstance(page, dict):  # 3.x result dict
            for poly, text, conf in zip(page.get("dt_polys", []), page.get("rec_texts", []), page.get("rec_scores", [])):
                tokens.append(self._tok(poly, text, conf))
            return tokens
        for item in page or []:
            try:
                poly, (text, conf) = item
                tokens.append(self._tok(poly, text, conf))
            except (TypeError, ValueError):
                continue
        return tokens

    @staticmethod
    def _tok(poly, text, conf) -> OcrToken:
        pts = np.array(poly, dtype=np.float32).reshape(-1, 2)
        x0, y0 = pts.min(0)
        x1, y1 = pts.max(0)
        return OcrToken(str(text), float(conf), (float(x0), float(y0), float(x1 - x0), float(y1 - y0)))


class TemplateDigitOcr(OcrEngine):
    """Segments bright digit glyphs on a dark/saturated jersey and matches them to rendered templates.

    Only works for the Hershey-DUPLEX digits drawn in the demo images – it exists so the whole pipeline can be
    exercised end-to-end offline. It is *not* a general jersey reader.
    """
    name = "demo-template"
    description = "DEMO ONLY – template matcher for the synthetic sample digits"
    _T = (28, 40)

    def __init__(self):
        self._templates: dict[str, np.ndarray] = {}
        for d in "0123456789":
            canvas = np.zeros((120, 90), np.uint8)
            cv2.putText(canvas, d, (8, 100), cv2.FONT_HERSHEY_DUPLEX, 3.2, 255, 7, cv2.LINE_AA)
            self._templates[d] = self._norm(canvas)

    @classmethod
    def _norm(cls, glyph: np.ndarray) -> np.ndarray:
        ys, xs = np.where(glyph > 0)
        if len(xs) == 0:
            return np.zeros(cls._T[::-1], np.float32)
        g = glyph[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        g = cv2.resize(g, cls._T, interpolation=cv2.INTER_AREA).astype(np.float32)
        return g / 255.0

    def read(self, rgb):
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        if (bw > 0).mean() > 0.5:  # digits should be the minority class
            bw = 255 - bw
        bw = cv2.morphologyEx(bw, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
        n, labels, stats, _ = cv2.connectedComponentsWithStats(bw)
        H, W = gray.shape
        glyphs = []
        for i in range(1, n):
            x, y, w, h, area = stats[i]
            if h < 0.2 * H or h > 0.95 * H or w > 1.1 * h or area < 40:
                continue
            if x <= 0 or y <= 0 or x + w >= W or y + h >= H:  # background blobs touch the crop edge, digits do not
                continue
            glyphs.append((x, y, w, h, i))
        glyphs.sort()
        if not glyphs or len(glyphs) > 4:
            return []
        text, confs = "", []
        for x, y, w, h, i in glyphs:
            g = self._norm(((labels[y:y + h, x:x + w] == i) * 255).astype(np.uint8))
            scores = {d: float((g * t).sum() / (np.sqrt((g * g).sum() * (t * t).sum()) + 1e-6))
                      for d, t in self._templates.items()}
            d = max(scores, key=scores.get)
            text += d
            confs.append(scores[d])
        x0 = min(g[0] for g in glyphs); y0 = min(g[1] for g in glyphs)
        x1 = max(g[0] + g[2] for g in glyphs); y1 = max(g[1] + g[3] for g in glyphs)
        conf = float(np.clip((np.mean(confs) - 0.6) / 0.35, 0, 1))
        return [OcrToken(text, conf, (x0, y0, x1 - x0, y1 - y0))]


_cache: dict[tuple, OcrEngine] = {}


def get_ocr(name: str, use_gpu: bool = False, demo: bool = False) -> OcrEngine:
    if name == "auto":
        if demo:
            name = "demo-template"
        else:
            try:
                import paddleocr  # noqa: F401
                name = "paddleocr"
            except Exception:
                name = "none"
    key = (name, use_gpu)
    if key not in _cache:
        _cache[key] = {"paddleocr": lambda: PaddleOcrEngine(use_gpu), "demo-template": TemplateDigitOcr,
                       "none": NullOcr}[name]()
    return _cache[key]
