# Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Banner: *"Player detection is off"* | No detector model installed. This is expected on a fresh install. Follow `docs/MODELS.md` §1. Until then photos are scored on the whole frame and sent to **Needs Review**; nothing is guessed. |
| Players are found but all say *Unknown* | OCR not installed (`pip install -r backend/requirements-ml.txt`, Python ≤ 3.12) or reads are below the *Auto-accept confidence*. Lower it in Settings, or correct numbers in the viewer (then **Apply to burst**). |
| RAW files show as *Unreadable – needs RAW support* | `pip install -r backend/requirements-raw.txt`. If it still fails, your camera is newer than the bundled LibRaw – upgrade `rawpy` or convert to DNG. |
| *"… is outside the allowed folders"* | The server only reads/writes inside your home folder, `/Volumes`, `/media`, `/mnt`, Windows drive letters and `SIDELINE_ALLOWED_ROOTS`. Add the folder there (`.env`) and restart. |
| Drag-and-drop is slow for thousands of RAW files | Browsers cannot expose file paths, so dropped files are *uploaded* (copied) to the cache. Use **Import a folder in place…** (or paste a path) to analyse files where they are. |
| Everything is *Out of Focus* / nothing is *In Focus* | Thresholds are estimates tuned on synthetic images. Open a few photos, read the reasons in the side panel, and adjust **Settings → Focus classification**, then *Save & re-analyse*. Whole-frame scores (no player detected) need the extra margin on purpose. |
| Sharp frames flagged *Review* | Directional blur ≥ 80 or whole-frame fallback margin; see the viewer's reasons list. |
| Bursts too big / too small | Raise/lower *Similarity threshold* and *Max time gap*, press **Regroup**. Manually split/merged bursts (✎) are never touched by regrouping. |
| Burst grouping ignores timing | Camera clock/EXIF missing → files are ordered by filename and only similarity is used. |
| Port already in use | `SIDELINE_PORT=8010 ./scripts/start.sh` |
| `no space left on device` while analysing | Caches (thumbnails + 1600 px analysis JPEGs) live under `SIDELINE_DATA_DIR`; move it to a larger drive or delete a project (originals are never touched). |
| Job stuck as *Interrupted* | The app was closed mid-run. Press **Resume**; finished photos are not redone. |
| Windows: `python` not found | Install Python 3.10–3.13 from python.org and tick *Add to PATH*, or run `py -3.12 -m venv .venv` manually. |
| Apple-silicon: PaddlePaddle won't install | Use Python 3.11/3.12 and `pip install paddlepaddle==2.6.2` (CPU). |
| API docs | http://127.0.0.1:8000/docs while the server runs. |

Logs: the terminal that started the server. Database: `SIDELINE_DATA_DIR/sideline.db` (SQLite; safe to open read-only with any SQLite browser).
Resetting everything: stop the app and delete `SIDELINE_DATA_DIR` – your photos are unaffected.
