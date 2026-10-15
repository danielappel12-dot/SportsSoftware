#!/usr/bin/env python
"""Model helper:  python manage_models.py status | export-yolo | fetch <url> --name yolov8n.onnx [--sha256 HEX]

No model is downloaded automatically and nothing is uploaded anywhere. See ../docs/MODELS.md for licences.
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sideline import config  # noqa: E402
from sideline.cv import embedding  # noqa: E402
from sideline.cv.detection import MODEL_FILENAME  # noqa: E402
from sideline.imageio import raw_support  # noqa: E402

YOLO_STEPS = f"""
Player detector ({MODEL_FILENAME}) – exact procedure
  1. In ANY Python environment (it can be a throw-away one, it is not needed at runtime):
         pip install ultralytics
         yolo export model=yolov8n.pt format=onnx imgsz=640 opset=12
     (this downloads yolov8n.pt from Ultralytics and writes yolov8n.onnx next to it)
  2. Copy yolov8n.onnx to:  {config.models_dir() / MODEL_FILENAME}
     or run:   python manage_models.py export-yolo      (does steps 1-2 for you if ultralytics is installed)
  Licence: Ultralytics YOLOv8 is AGPL-3.0 (commercial licence available). Check it fits how you distribute the app.
  Permissively-licensed alternative: export a YOLOX / RT-DETR / YOLO-NAS person model whose ONNX output is
  (1, 4+classes, N) or (1, N, 5+classes) with class 0 = person, and save it under the same file name.
"""


def status() -> int:
    from sideline.cv.ocr import PaddleOcrEngine
    d = config.models_dir() / MODEL_FILENAME
    print(f"Models folder: {config.models_dir()}")
    print(f"  detector  {MODEL_FILENAME}: {'FOUND' if d.exists() else 'MISSING'}")
    ok, msg = PaddleOcrEngine().status()
    print(f"  OCR       PaddleOCR: {'READY' if ok else 'NOT INSTALLED'}  {'' if ok else msg}")
    ok, msg = embedding.status()
    print(f"  embedding (optional): {'FOUND' if ok else 'not installed'}")
    ok, msg = raw_support()
    print(f"  RAW       rawpy: {'READY' if ok else 'NOT INSTALLED'}  {'' if ok else msg}")
    if not d.exists():
        print(YOLO_STEPS)
    return 0


def export_yolo() -> int:
    try:
        from ultralytics import YOLO  # type: ignore
    except ImportError:
        print("ultralytics is not installed here.\n" + YOLO_STEPS)
        return 1
    with tempfile.TemporaryDirectory() as tmp:
        m = YOLO("yolov8n.pt")
        out = Path(m.export(format="onnx", imgsz=640, opset=12, project=tmp))
        dest = config.models_dir() / MODEL_FILENAME
        shutil.copy2(out, dest)
    print(f"Wrote {dest}")
    return 0


def fetch(url: str, name: str, sha256: str | None) -> int:
    if not url.lower().startswith("https://"):
        print("Only https:// URLs are accepted.")
        return 2
    dest = config.models_dir() / Path(name).name
    tmp = dest.with_suffix(dest.suffix + ".part")
    h = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=60) as r, open(tmp, "wb") as f:  # noqa: S310 - https enforced above
        while chunk := r.read(1 << 20):
            h.update(chunk)
            f.write(chunk)
    if sha256 and h.hexdigest().lower() != sha256.lower():
        tmp.unlink(missing_ok=True)
        print(f"SHA-256 mismatch (got {h.hexdigest()}). File discarded.")
        return 3
    tmp.replace(dest)
    print(f"Saved {dest} (sha256 {h.hexdigest()})")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("status")
    sub.add_parser("export-yolo")
    f = sub.add_parser("fetch")
    f.add_argument("url")
    f.add_argument("--name", default=MODEL_FILENAME)
    f.add_argument("--sha256")
    a = ap.parse_args()
    if a.cmd == "export-yolo":
        sys.exit(export_yolo())
    if a.cmd == "fetch":
        sys.exit(fetch(a.url, a.name, a.sha256))
    sys.exit(status())
