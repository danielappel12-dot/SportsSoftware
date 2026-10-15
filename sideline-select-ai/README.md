# Sideline Select AI

A **local-first** culling and organisation tool for sports photographers. Import hundreds or thousands of game-day frames and it will
find jersey numbers, separate sharp from soft, group bursts, rank the frames inside each burst and export a clean folder structure –
without uploading a single photo and without ever modifying an original.

> **Read this first – what is and isn't verified.** Everything in the "Implemented" list below is built and covered by tests
> (106 backend tests + scripted browser runs). Model-dependent steps (player detection, OCR) need weights that are **not bundled**
> (licences – see [docs/MODELS.md](docs/MODELS.md)). The build environment had no real sports photos and no model weights, so:
> accuracy of YOLO/PaddleOCR on real footage is **unmeasured**, focus thresholds were calibrated on synthetic images, and RAW decoding,
> GPU acceleration, PaddleOCR and embeddings were **not exercised with real files/models here**. Without models the app says so and
> routes photos to *Needs Review* – it never invents players or numbers.

![stack](https://img.shields.io/badge/stack-React%20%2B%20TypeScript%20%2B%20Vite%20%2B%20Tailwind%20%7C%20FastAPI%20%2B%20OpenCV%20%2B%20SQLite-orange)

---

## Quick start

Requirements: **Python 3.10 – 3.13** and **Node.js 18+** (Node is only needed to build the UI once). macOS, Windows, Linux.

```bash
# macOS / Linux
./scripts/start.sh            # creates .venv, installs pinned deps, builds the UI, starts http://127.0.0.1:8000

# Windows
scripts\start.bat
```
Open <http://127.0.0.1:8000>. No project yet? Press **Create demo project** – it generates *clearly labelled synthetic* cartoon photos
(five "plays" of six frames, with sharp, soft and motion-blurred frames, a corrupt file and an exact duplicate) and runs the full pipeline
offline so you can try every screen.

Development with hot reload: `./scripts/dev.sh` (API on :8000, UI on :5173) · tests: `make test` · model status: `make models`.

Manual setup, if you prefer:
```bash
python3 -m venv .venv && source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
(cd frontend && npm ci && npm run build)
cd backend && python -m sideline.main
```

### Optional add-ons
| Want | Do |
|---|---|
| Player detection + sharpness on the player | place `yolov8n.onnx` in `backend/models/` – exact steps in [docs/MODELS.md](docs/MODELS.md) |
| Jersey-number OCR | `pip install -r backend/requirements-ml.txt` (Python ≤ 3.12) |
| Camera RAW files | `pip install -r backend/requirements-raw.txt` |
| Anything unclear | `cd backend && python manage_models.py status` |

---

## Workflow

1. **Projects** – one per game/assignment (sidebar). Deleting a project removes only database rows and caches.
2. **Import** – drag & drop files/folders, *Choose files/folder*, *Import a folder in place* (server-side picker) or paste a path.
   Known files (by path **and** by SHA-256 content) are not processed again. Corrupt/unsupported files are reported with a reason and the
   job carries on. Pause / resume / cancel; progress is persisted so a restart resumes where it stopped.
3. **Analysis** (background, N concurrent tasks) – EXIF + thumbnail + cached analysis image → player detection → jersey OCR → quality
   metrics → focus class. Then burst grouping, ranking and automatic (reversible) keeper suggestions.
4. **Review** – *Needs Review*, *Players*, *Burst Groups*, the full-screen viewer, compare view, roster, corrections with **Undo**.
5. **Export** – presets A–E (combinable, custom names), preview → copy (or confirmed move), CSV report, contact sheet.

### Keyboard (viewer)
`←` `→` navigate · wheel / `+` `−` zoom · `0` fit · double-click zoom · `F` full-resolution · `B` player boxes · `I` info panel ·
`K` keep · `X` reject · `U` back to automatic · `R` mark reviewed · `Esc` close.

---

## Features

### Implemented and tested
| Area | Details |
|---|---|
| **Import** | JPEG/PNG/TIFF/BMP/WebP + RAW detection (CR2 CR3 NEF NRW ARW DNG RAF ORF RW2 PEF SRW). EXIF capture time (incl. sub-second), camera, exposure; original filenames kept. Dedupe by path + content hash. Corrupt files isolated. Unsupported RAW → explicit message with fix. |
| **Safety** | Originals opened read-only (verified by a hash+mtime test). Server binds to `127.0.0.1`, rejects foreign `Host`/`Origin`, only touches allowed roots, resolves symlinks, sanitises every path component. |
| **Quality** | Edge-width sharpness (contrast-invariant, noise-robust) on the **main player crop** (whole-frame fallback with extra margin), separate directional **motion-blur** estimate, exposure + clipping %, subject visibility (edge/occlusion), composition, head/face (Haar, weak with helmets), resolution, overall score. Every metric + human-readable reasons stored and shown. In Focus / Review / Out of Focus with adjustable thresholds. |
| **Bursts** | 64-bit DCT pHash + dHash + 16×16 structural correlation + HSV histogram (+ optional ONNX embeddings), EXIF time gap, max group size, different-confident-number veto. Stable `Burst_NNNN` ids. Manual **split / merge / retain whole sequence**; manual groups survive regrouping; all undoable. |
| **Ranking** | Weighted (editable) blend of player sharpness, motion, visibility, face, composition, exposure, number confidence, representativeness; out-of-focus frames are down-weighted, never deleted. Per-factor breakdown shown. Best frame = suggestion (★auto), you can override, reject or keep any/all. |
| **Jersey numbers** | Detector → torso regions → OCR (pluggable) → normalisation (1–3 digits, leading zeroes optional, look-alike repair only when all characters are digit-like, rejects words / long digit strings) → geometry plausibility (size, aspect, position) → confidence. *Not* "largest text wins". Conflicting reads lower confidence. Bands: **auto ≥ accept**, **needs review**, **unknown**. Multiple players per photo. |
| **Same player across a burst** | Jersey-colour histogram + position proximity give *suggestions* ("Suggested from DEMO_0015 …, not confirmed") – never auto-confirmed, ambiguous matches skipped. |
| **Corrections** | Confirm/correct number, assign a photo to a player, roster (optional, CSV paste), apply to burst, keeper picks, burst edits – all logged and **undoable**; **survive re-analysis** (only *Reset manual corrections* removes them). |
| **UI** | Dark/orange dashboard, 11 sections, virtualised thumbnail grid (thousands of photos), filters (filename, jersey #, focus, burst, min quality, date range, review, keeper, sort), full-screen viewer with zoom/pan/boxes + analysis side panel, burst contact sheets, 2–4-way synced compare, toasts with Undo. |
| **Export** | Presets A By Player · B By Focus · C Player+Focus · D Best/Other · E Bursts; combine freely; custom folder names (incl. `{number}_{name}`); keepers-only or all; copy (default) or **move** (typed `MOVE` confirmation, source deleted only after all copies are size-verified); preview first; exclusive-create copies + `_2`/`_3` suffixes (never overwrite, case-insensitive); CSV (formula-injection safe); review contact sheet; export history. |
| **Persistence** | SQLite (WAL) with versioned migrations: projects, photos, detected players, roster, quality, bursts + membership, corrections, keepers, jobs, settings, export history + items. Stable photo uid; original path vs exported path stored separately. |
| **Jobs** | Thread-pool worker with configurable concurrency, pause/resume/cancel, restart recovery (`interrupted` → resume), per-photo failure isolation, memory-bounded (one decoded image per worker; JPEG draft decoding). |
| **Settings** | Folders, number thresholds, digits, leading zeroes, engines, focus thresholds, burst similarity/gap/size, ranking weights, analysis size, workers, GPU toggle, thumbnail size – validated and persisted. |

### Optional / environment dependent (implemented, not verified here)
YOLO-ONNX detector on **real weights** (plumbing tested with a synthetic ONNX graph) · PaddleOCR adapter · RAW decode via `rawpy` ·
embeddings via an ONNX encoder · CUDA (OpenCV-DNN CUDA / paddlepaddle-gpu) – the app reports when CUDA isn't available and stays on CPU.

### Not implemented / future ideas
* Re-identification tracking beyond colour+position hints; no claim of reliable identity tracking is made.
* Fine-tuned jersey-number recognition model; scene-text models for angled/occluded numbers; team-colour clustering.
* Face/eye-open detection that works with helmets; action/peak-moment scoring (catch, tackle, celebration).
* HEIC/HEIF, video, XMP/IPTC sidecar writing or star-rating export for Lightroom/Capture One (CSV only today).
* Multi-user / network deployment (deliberately single-user, localhost-only).
* Desktop packaging (Electron/Tauri) – today it runs as a local web app.

---

## How the estimates work (and their limits)

*Classifications are estimates, not guarantees of photographic quality.*

* **Sharpness score (0–100)** = median *edge width* of strong, isolated edges on the main player's crop (0.8 px pre-smoothing; a crisp edge
  ≈ 2 px → ~100, ≈ 4 px → ~55, ≈ 6 px → ~30). Unlike Laplacian variance it ignores noise and dense texture (grass, crowd), and is
  contrast-invariant. Calibrated on synthetic blur/noise ladders (σ = 0.6–8 px blur, noise σ up to 20). Defaults: **In Focus ≥ 55**, **Out ≤ 30**.
* **Subject first.** The player crop is used when a detector is available; a sharp player on a blurred background is therefore *not*
  penalised (the viewer says so). Without a player the 85th-percentile tile score is used and *in focus* needs +12 more points.
* **Motion blur** compares edge widths per gradient orientation: a large anisotropy with visibly soft edges ⇒ directional blur. It is a
  separate metric and only demotes an *In Focus* frame to *Review* when ≥ 80.
* Edge cases to expect on real footage: heavy bokeh, tiny distant players (small crops), helmets (face detector), flat jerseys (falls
  back to whole frame), strong compression. Check *Review* and *Out of Focus* before discarding; nothing is ever deleted automatically.

## Architecture

```
frontend/ (React 18 · TS · Vite · Tailwind)  ──/api──▶  backend/sideline/ (FastAPI)
  pages: Dashboard Import Photos Players Bursts          api/        routers (projects, photos, people, bursts, exports)
         Export Settings   components: Viewer, Grid…     services/   pipeline · jobs · bursts · corrections · exporter · demo
                                                          cv/         quality · hashing · burst · detection · ocr · jersey · embedding
                                                          db.py       SQLite + migrations   settings.py  validated settings
                                                          security.py path validation, sanitising
```
Data directory (`SIDELINE_DATA_DIR`, default `~/SidelineSelect`): `sideline.db`, and per project `thumbs/`, `analysis/` (≤1600 px JPEG
used for re-analysis so RAW/large files are decoded once), `crops/`, `uploads/` (drag-and-drop copies).

Useful endpoints (interactive docs at `/docs`): `POST /api/projects`, `/api/projects/demo`, `…/import`, `…/upload`, `…/process`,
`GET …/photos` (filters), `GET /api/photos/{id}`, `POST /api/players/{id}/number`, `…/apply-burst`, `…/bursts/split|merge`,
`POST …/export/preview`, `…/export`, `POST /api/corrections/{id}/undo`.

## Tests

```bash
make test            # or: cd backend && pip install -r requirements-dev.txt && python -m pytest -q   (≈ 2 min)
cd frontend && npm run build        # TypeScript type-check + production build
```
106 tests cover (one needs `rawpy` and is skipped without it): focus scoring (monotonic blur ladder, noise robustness, motion vs defocus, thresholds, background handling), perceptual
hashing and near-duplicates, burst grouping (time gaps, max size, number conflicts, filename fallback), ranking, jersey normalisation /
geometry / confidence bands / "largest text is not chosen", template OCR, YOLO plumbing, DB schema/persistence/rollback/cascades/settings,
export presets A–E, collisions, no-overwrite, move confirmation, destination + symlink validation, CSV injection, and the HTTP
workflow end-to-end (import → analyse → corrections/undo → split/merge → keepers → export → move; pause/resume/cancel/restart recovery;
origin/host guards; unavailable-model honesty; upload traversal), plus image I/O (EXIF orientation + sub-second time, 16-bit TIFF, CMYK, corrupt/truncated files, RAW with and without `rawpy`).

Also verified by hand in headless Chromium: the full UI flow (demo → grid/viewer/keyboard → corrections + undo → upload → export preview → copy; MOVE blocked until confirmed) with no console errors; 5 000 photos render ~35 DOM cells (virtualised grid), list API 0.4 s; a 24 MP JPEG analyses in ≈ 0.6 s per worker (~475 MB peak RSS).

## Privacy & security model
Single-user, localhost only: binds to `127.0.0.1`; `Host` allow-list (DNS-rebinding) and `Origin` check on writes (CSRF); filesystem
access limited to allowed roots; no telemetry; the only outbound traffic is whatever *you* trigger (e.g. `pip`/`npm` installs, PaddleOCR
fetching its small OCR models on first run). If you ever expose it beyond localhost, add authentication first.

## Troubleshooting & licences
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) · [docs/MODELS.md](docs/MODELS.md) (model install, AGPL note for Ultralytics, licence table).
