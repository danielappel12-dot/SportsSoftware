# Models, weights and licences

Sideline Select AI is **local-first**: no photo is ever uploaded, and **no model is downloaded automatically**.
Sharpness / exposure / motion-blur analysis, duplicate + burst detection, ranking, review and export need **no model at all**.
Two optional components add player recognition:

| Component | What for | Required? | Status when missing |
|---|---|---|---|
| Player detector (`yolov8n.onnx`) | find players → crops for jersey reading + subject-based sharpness | optional | photos are scored on the **whole frame** and routed to *Needs Review*. No player is invented. |
| Jersey OCR (PaddleOCR) | read numbers from the crops | optional | players are detected but have **no number** → *Unknown Player* / *Needs Review* |
| Embedding model (`embedding.onnx`) | extra burst-similarity signal | optional | grouping uses perceptual hashes + structural + colour similarity |
| RAW decoder (`rawpy`) | CR2/CR3/NEF/ARW/DNG/RAF/ORF/RW2 | optional | RAW files are listed on the Import screen with the exact reason and fix |

Check the current state any time:

```bash
cd backend && python manage_models.py status      # prints exact next steps for anything missing
```
The same information is shown in **Settings → Recognition models & system**.

## 1. Player detector (YOLO, ONNX)

The detector runs through **OpenCV DNN**, so PyTorch is *not* needed at runtime. Any YOLOv8/YOLOv5-style ONNX model whose
output is `(1, 4+classes, N)` or `(1, N, 5+classes)` with **class 0 = person** works. Put it at
`backend/models/yolov8n.onnx` (or set `SIDELINE_MODELS_DIR`).

Exact procedure for the official nano model:

```bash
# any Python environment (can be throw-away; not needed afterwards)
pip install ultralytics
yolo export model=yolov8n.pt format=onnx imgsz=640 opset=12      # downloads yolov8n.pt, writes yolov8n.onnx
cp yolov8n.onnx /path/to/sideline-select-ai/backend/models/yolov8n.onnx
```
or, if `ultralytics` is installed in the app's virtualenv: `python manage_models.py export-yolo`.
Already have an ONNX file on a trusted https URL? `python manage_models.py fetch <https-url> --sha256 <hash>`.

Larger variants (`yolov8s/m`) are more accurate but slower; keep the file name `yolov8n.onnx` or pick the engine in Settings.

**Why not bundled?** Ultralytics YOLOv8 weights are **AGPL-3.0** (a commercial licence is sold by Ultralytics). Bundling them would
force that licence on this project. If AGPL does not suit you, export a permissively licensed person detector
(e.g. **YOLOX – Apache-2.0**, **RT-DETR – Apache-2.0**) to ONNX in the layout above.

Verification note: the detector's letterboxing, ONNX execution, output parsing, NMS and coordinate mapping are unit-tested with a
synthetic ONNX graph (`backend/tests/test_detector_plumbing.py`). **Accuracy on real sports photos has not been measured** by this
repository – evaluate on your own shoots.

## 2. Jersey OCR (PaddleOCR)

```bash
pip install -r backend/requirements-ml.txt     # paddlepaddle 2.6.2 + paddleocr 2.9.1  (Python 3.9 – 3.12)
```
* Apache-2.0 licensed (PaddlePaddle, PaddleOCR and the PP-OCR models).
* On first use PaddleOCR **downloads its small recognition models** (a few MB) to `~/.paddleocr`. That is a download *to* your machine –
  no image data leaves it. For an offline machine, run it once on a connected one and copy that folder.
* NVIDIA GPU: `pip install paddlepaddle-gpu` instead and tick *GPU acceleration* in Settings.
* The OCR is **pluggable** (`backend/sideline/cv/ocr.py`): implement `OcrEngine.read(rgb) -> list[OcrToken]` and register it in `get_ocr`.
* General-purpose OCR is not tuned for stylised/angled/motion-blurred jersey numbers. Expect many *Needs Review* photos on hard
  footage; that is the intended behaviour (low confidence → human decides). A fine-tuned jersey-number model could be plugged in the same way.

PaddleOCR's 3.x API differs from 2.x. The adapter accepts both result shapes, but the pinned, tested-against version is 2.9.1.

## 3. Embeddings (optional)

Place any ONNX image encoder (224×224 RGB → feature vector, e.g. MobileNetV2/ResNet-50 pooled features, a DINOv2/CLIP image tower)
at `backend/models/embedding.onnx` and enable *Use image embeddings* in Settings. They add a 35 % weight to burst similarity.
Check the licence of whichever model you choose.

## 4. RAW decoding

```bash
pip install -r backend/requirements-raw.txt       # rawpy (MIT) wrapping LibRaw (LGPL-2.1 / CDDL-1.0)
```
The embedded full-size JPEG preview is used when present (fast, matches camera rendering); otherwise a half-size demosaic.
Brand-new camera models may need a newer LibRaw – upgrade `rawpy` or export to DNG/JPEG. HEIC/HEIF is not supported
(add `pillow-heif` if you need it).

## Licence summary (not legal advice)

| Software | Licence |
|---|---|
| Sideline Select AI source | as this repository |
| FastAPI, Starlette, Pydantic, Uvicorn | MIT / BSD |
| OpenCV (and its bundled Haar face cascade) | Apache-2.0 / BSD-style |
| NumPy, Pillow | BSD / HPND |
| React, Vite, Tailwind CSS, TanStack Virtual, React Router | MIT |
| PaddlePaddle / PaddleOCR / PP-OCR models | Apache-2.0 |
| Ultralytics YOLOv8 code + weights | **AGPL-3.0** (commercial licence available) |
| rawpy | MIT; LibRaw LGPL-2.1 / CDDL-1.0 |
