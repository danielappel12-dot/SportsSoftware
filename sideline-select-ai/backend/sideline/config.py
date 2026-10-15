"""Runtime configuration (environment driven, see .env.example)."""
from __future__ import annotations

import os
import platform
from pathlib import Path

APP_NAME = "Sideline Select AI"
VERSION = "1.0.0"

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent


def _load_dotenv() -> None:
    """Tiny .env reader (KEY=VALUE lines, # comments). Real environment variables always win."""
    f = PROJECT_DIR / ".env"
    if not f.is_file():
        return
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip().strip('"').strip("'")
        if k.strip() and v:
            os.environ.setdefault(k.strip(), v)


_load_dotenv()


def data_dir() -> Path:
    """Where the SQLite DB, thumbnails and caches live. Never the photo folders."""
    p = Path(os.environ.get("SIDELINE_DATA_DIR") or Path.home() / "SidelineSelect").expanduser()
    p.mkdir(parents=True, exist_ok=True)
    return p


def db_path() -> Path:
    return Path(os.environ.get("SIDELINE_DB") or data_dir() / "sideline.db")


def models_dir() -> Path:
    p = Path(os.environ.get("SIDELINE_MODELS_DIR") or BACKEND_DIR / "models").expanduser()
    p.mkdir(parents=True, exist_ok=True)
    return p


def cache_dir(project_id: int) -> Path:
    p = data_dir() / "projects" / str(project_id)
    p.mkdir(parents=True, exist_ok=True)
    return p


def allowed_roots() -> list[Path]:
    """Folders the API may read photos from / browse / export into.

    The server only listens on localhost, but we still refuse to hand out the whole filesystem:
    the user's home, removable-media mount points, any drive letters on Windows and anything listed
    in SIDELINE_ALLOWED_ROOTS (os.pathsep separated).
    """
    roots: list[Path] = [Path.home(), data_dir()]
    system = platform.system()
    if system == "Darwin":
        roots.append(Path("/Volumes"))
    elif system == "Windows":
        import string
        roots += [Path(f"{d}:\\") for d in string.ascii_uppercase if Path(f"{d}:\\").exists()]
    else:
        roots += [Path("/media"), Path("/mnt"), Path("/run/media")]
    for extra in filter(None, os.environ.get("SIDELINE_ALLOWED_ROOTS", "").split(os.pathsep)):
        roots.append(Path(extra))
    out: list[Path] = []
    for r in roots:
        try:
            rr = r.expanduser().resolve()
        except OSError:
            continue
        if rr.exists() and rr not in out:
            out.append(rr)
    return out


def allowed_origins() -> list[str]:
    extra = [o for o in os.environ.get("SIDELINE_ORIGINS", "").split(",") if o]
    ports = ["5173", "4173", os.environ.get("SIDELINE_PORT", "8000")]
    base = [f"http://{h}:{p}" for h in ("localhost", "127.0.0.1") for p in ports]
    return base + extra
