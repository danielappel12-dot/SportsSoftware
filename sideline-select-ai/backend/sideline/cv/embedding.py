"""Optional image embeddings via an ONNX model run with OpenCV DNN (no PyTorch needed).

Any ONNX image encoder that takes 224x224 RGB and returns a feature vector works (e.g. MobileNetV2/ResNet50
pooled features, a CLIP/DINOv2 image tower). Place it at ``<models>/embedding.onnx``. Without it, burst grouping
uses perceptual hashes + structural/colour similarity only – the app says so rather than pretending.
"""
from __future__ import annotations

import threading

import cv2
import numpy as np

from .. import config

_net = None
_lock = threading.Lock()
FILENAME = "embedding.onnx"


def status() -> tuple[bool, str]:
    p = config.models_dir() / FILENAME
    return (p.exists(), "ready" if p.exists() else f"Model not found: {p} (optional, see docs/MODELS.md)")


def embed(rgb: np.ndarray) -> np.ndarray | None:
    global _net
    ok, _ = status()
    if not ok:
        return None
    with _lock:
        if _net is None:
            _net = cv2.dnn.readNetFromONNX(str(config.models_dir() / FILENAME))
        img = cv2.resize(rgb, (224, 224), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
        img = (img - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
        _net.setInput(cv2.dnn.blobFromImage(img, 1.0, (224, 224)))
        v = _net.forward().flatten().astype(np.float32)
    n = np.linalg.norm(v)
    return v / n if n > 0 else None
