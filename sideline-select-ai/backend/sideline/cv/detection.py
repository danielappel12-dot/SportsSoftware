"""Pluggable player detectors.

* ``yolo-onnx``  – any YOLOv8/YOLOv5-style ONNX model (class 0 = person) executed through OpenCV DNN,
                   so no PyTorch is required. Weights are NOT bundled (see docs/MODELS.md).
* ``demo-color`` – a plain colour-segmentation detector that only understands the synthetic demo images.
* ``none``       – explicit "no detector" (photos are then marked for manual review; nothing is invented).
"""
from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .. import config


@dataclass
class Detection:
    x: float  # normalised, top-left
    y: float
    w: float
    h: float
    conf: float
    label: str = "person"

    def box(self) -> tuple[float, float, float, float]:
        return (self.x, self.y, self.w, self.h)


class DetectorUnavailable(Exception):
    pass


class PlayerDetector:
    name = "base"
    description = ""

    def status(self) -> tuple[bool, str]:
        return True, "ready"

    def detect(self, rgb: np.ndarray, min_conf: float) -> list[Detection]:  # pragma: no cover - interface
        raise NotImplementedError


class NullDetector(PlayerDetector):
    name = "none"
    description = "Detection disabled"

    def status(self):
        return False, "No player-detection model installed (see docs/MODELS.md)."

    def detect(self, rgb, min_conf):
        return []


MODEL_FILENAME = "yolov8n.onnx"


def nms(boxes: list[list[float]], scores: list[float], iou: float = 0.5) -> list[int]:
    idx = cv2.dnn.NMSBoxes(boxes, scores, 0.0, iou)
    return [int(i) for i in np.array(idx).flatten()] if len(idx) else []


class YoloOnnxDetector(PlayerDetector):
    name = "yolo-onnx"
    description = "YOLO (ONNX) person detector via OpenCV DNN"

    def __init__(self, model_path: Path | None = None, use_gpu: bool = False, size: int = 640):
        self.model_path = model_path or (config.models_dir() / MODEL_FILENAME)
        self.size = size
        self.use_gpu = use_gpu
        self._net = None
        self._lock = threading.Lock()
        self.backend = "cpu"

    def status(self):
        if not self.model_path.exists():
            return False, (f"Model file not found: {self.model_path}. Follow docs/MODELS.md "
                           f"(export yolov8n.onnx and place it there, or set SIDELINE_MODELS_DIR).")
        return True, f"ready ({self.backend})"

    def _load(self):
        if self._net is None:
            ok, why = self.status()
            if not ok:
                raise DetectorUnavailable(why)
            net = cv2.dnn.readNetFromONNX(str(self.model_path))
            if self.use_gpu:
                try:
                    net.setPreferableBackend(cv2.dnn.DNN_BACKEND_CUDA)
                    net.setPreferableTarget(cv2.dnn.DNN_TARGET_CUDA)
                    self.backend = "cuda"
                except Exception:
                    self.backend = "cpu (CUDA unavailable in this OpenCV build)"
            self._net = net
        return self._net

    def detect(self, rgb, min_conf):
        net = self._load()
        h, w = rgb.shape[:2]
        scale = self.size / max(h, w)
        nw, nh = int(round(w * scale)), int(round(h * scale))
        resized = cv2.resize(rgb, (nw, nh), interpolation=cv2.INTER_AREA)
        canvas = np.full((self.size, self.size, 3), 114, np.uint8)
        ox, oy = (self.size - nw) // 2, (self.size - nh) // 2
        canvas[oy:oy + nh, ox:ox + nw] = resized
        blob = cv2.dnn.blobFromImage(canvas, 1 / 255.0, (self.size, self.size), swapRB=False)
        with self._lock:  # cv2.dnn nets are not re-entrant
            net.setInput(blob)
            out = net.forward()
        return self._parse(out, min_conf, scale, ox, oy, w, h)

    @staticmethod
    def _parse(out: np.ndarray, min_conf: float, scale: float, ox: int, oy: int, w: int, h: int) -> list[Detection]:
        p = np.squeeze(out)
        if p.ndim != 2:
            return []
        if p.shape[0] < p.shape[1]:  # (4+nc, N) – YOLOv8 export layout
            p = p.T
        boxes, scores = [], []
        has_obj = p.shape[1] == 85 or (p.shape[1] > 6 and p.shape[1] - 5 in (1, 80))
        for row in p:
            if has_obj:
                conf = float(row[4] * row[5])  # class 0 = person
            else:
                conf = float(row[4])
            if conf < min_conf:
                continue
            if not has_obj and row.shape[0] > 5 and int(np.argmax(row[4:])) != 0:
                continue  # best class is not 'person'
            cx, cy, bw, bh = row[:4]
            x0 = (cx - bw / 2 - ox) / scale
            y0 = (cy - bh / 2 - oy) / scale
            boxes.append([x0, y0, bw / scale, bh / scale])
            scores.append(conf)
        keep = nms(boxes, scores)
        res = []
        for i in keep:
            x0, y0, bw, bh = boxes[i]
            x0, y0 = max(0.0, x0), max(0.0, y0)
            bw, bh = min(bw, w - x0), min(bh, h - y0)
            if bw < 8 or bh < 8:
                continue
            res.append(Detection(x0 / w, y0 / h, bw / w, bh / h, scores[i]))
        return res


class DemoColorDetector(PlayerDetector):
    """Finds the saturated jersey blobs drawn by ``services/demo.py``. Not a real-world detector."""
    name = "demo-color"
    description = "DEMO ONLY – colour segmentation for the synthetic sample images"

    def detect(self, rgb, min_conf):
        hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
        H, W = rgb.shape[:2]
        # field is a muted green; players wear saturated blue/red/yellow/orange jerseys
        hue = hsv[..., 0].astype(np.int32)
        sat, val = hsv[..., 1], hsv[..., 2]
        not_field = ~((hue > 35) & (hue < 85) & (sat > 25))
        mask = (not_field & (sat > 90) & (val > 70)).astype(np.uint8) * 255
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
        n, _, stats, _ = cv2.connectedComponentsWithStats(mask)
        out = []
        for i in range(1, n):
            x, y, w, h, area = stats[i]
            if area < 0.004 * W * H or h < 0.12 * H:
                continue
            # extend upward for the head that sits above the jersey block
            head = int(h * 0.28)
            y0 = max(0, y - head)
            out.append(Detection(x / W, y0 / H, w / W, (y + h - y0) / H, 0.9, "player"))
        return out


_cache: dict[tuple, PlayerDetector] = {}


def get_detector(name: str, use_gpu: bool = False, demo: bool = False) -> PlayerDetector:
    """Resolve engine name. ``auto`` = YOLO if weights exist, demo detector for demo projects, else none."""
    if name == "auto":
        if demo:
            name = "demo-color"
        else:
            name = "yolo-onnx" if (config.models_dir() / MODEL_FILENAME).exists() else "none"
    key = (name, use_gpu)
    if key not in _cache:
        _cache[key] = {"yolo-onnx": lambda: YoloOnnxDetector(use_gpu=use_gpu),
                       "demo-color": DemoColorDetector, "none": NullDetector}[name]()
    return _cache[key]
