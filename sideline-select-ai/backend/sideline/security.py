"""Path validation + request-origin guard.

The API is for a single local user. It binds to 127.0.0.1, rejects foreign Host/Origin headers
(DNS-rebinding / CSRF from a web page) and only touches paths under allowed roots.
"""
from __future__ import annotations

import os
import platform
from pathlib import Path

from . import config


class PathNotAllowed(ValueError):
    pass


_DENY_UNIX = ("/etc", "/bin", "/sbin", "/usr", "/lib", "/lib64", "/boot", "/dev", "/proc", "/sys", "/var/lib", "/root/.ssh")
_DENY_WIN = ("c:\\windows", "c:\\program files", "c:\\program files (x86)", "c:\\programdata")


def _is_within(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def _denied(p: Path) -> bool:
    s = str(p).lower() if platform.system() == "Windows" else str(p)
    deny = _DENY_WIN if platform.system() == "Windows" else _DENY_UNIX
    return any(s == d or s.startswith(d + os.sep) for d in deny) or p.parent == p  # filesystem root


def resolve_allowed(path: str | os.PathLike, *, must_exist: bool = True) -> Path:
    """Resolve symlinks and ensure the result is inside an allowed root. Raises PathNotAllowed."""
    if path is None or str(path).strip() == "" or "\x00" in str(path):
        raise PathNotAllowed("Empty or invalid path.")
    p = Path(str(path)).expanduser()
    if not p.is_absolute():
        raise PathNotAllowed("Paths must be absolute.")
    try:
        r = p.resolve(strict=must_exist)
    except (OSError, RuntimeError):
        raise PathNotAllowed(f"Path does not exist: {path}") from None
    if _denied(r):
        raise PathNotAllowed(f"Access to system location is not allowed: {r}")
    if not any(_is_within(r, root) for root in config.allowed_roots()):
        raise PathNotAllowed(
            f"{r} is outside the allowed folders. Add its parent to SIDELINE_ALLOWED_ROOTS to permit it."
        )
    return r


def validate_export_destination(path: str) -> Path:
    """Destination must be absolute, allowed, and a directory (existing or creatable)."""
    r = resolve_allowed(path, must_exist=False)
    if r.exists() and not r.is_dir():
        raise PathNotAllowed(f"Export destination is not a folder: {r}")
    # parent chain must exist up to something real so we don't create deep surprising trees
    probe = r
    while not probe.exists():
        probe = probe.parent
    if not os.access(probe, os.W_OK):
        raise PathNotAllowed(f"No write permission for {probe}")
    return r


def safe_component(name: str, fallback: str = "_") -> str:
    """Make one path component safe on Windows + macOS + Linux."""
    bad = '<>:"/\\|?*\x00'
    cleaned = "".join("_" if (c in bad or ord(c) < 32) else c for c in str(name)).strip().strip(".")
    cleaned = cleaned.replace("..", "_")
    reserved = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
    if cleaned.upper() in reserved:
        cleaned = f"_{cleaned}"
    return cleaned[:120] or fallback
