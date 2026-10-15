"""Image loading, EXIF, RAW handling and thumbnails. Originals are only ever opened read-only."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import ExifTags, Image, ImageOps

Image.MAX_IMAGE_PIXELS = 400_000_000  # camera files are big; still bounded against decompression bombs

STANDARD_EXT = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}
RAW_EXT = {".cr2", ".cr3", ".nef", ".nrw", ".arw", ".dng", ".raf", ".orf", ".rw2", ".pef", ".srw"}
SUPPORTED_EXT = STANDARD_EXT | RAW_EXT


class UnsupportedImage(Exception):
    """File type recognised but cannot be decoded on this machine (message is user facing)."""


class CorruptImage(Exception):
    pass


def is_supported(path: str | Path) -> bool:
    return Path(path).suffix.lower() in SUPPORTED_EXT


def is_raw(path: str | Path) -> bool:
    return Path(path).suffix.lower() in RAW_EXT


def raw_support() -> tuple[bool, str]:
    try:
        import rawpy  # noqa: F401
        return True, "rawpy/LibRaw available"
    except Exception:
        return False, "rawpy is not installed. Run: pip install rawpy  (enables CR2/CR3/NEF/ARW/DNG/RAF/ORF/RW2)"


def _open_raw(path: Path) -> Image.Image:
    ok, why = raw_support()
    if not ok:
        raise UnsupportedImage(f"{path.suffix.upper()} files need RAW support. {why}")
    import rawpy
    try:
        with rawpy.imread(str(path)) as raw:
            try:  # the embedded JPEG preview is fastest and good enough for culling
                thumb = raw.extract_thumb()
                if thumb.format == rawpy.ThumbFormat.JPEG:
                    import io
                    return ImageOps.exif_transpose(Image.open(io.BytesIO(thumb.data)).convert("RGB"))
                if thumb.format == rawpy.ThumbFormat.BITMAP:
                    return Image.fromarray(thumb.data)
            except Exception:
                pass
            rgb = raw.postprocess(use_camera_wb=True, half_size=True, no_auto_bright=False, output_bps=8)
            return Image.fromarray(rgb)
    except UnsupportedImage:
        raise
    except Exception as e:  # LibRaw error classes vary by version
        name = type(e).__name__
        if "Unsupported" in name or "NotSupported" in name:
            raise UnsupportedImage(
                f"LibRaw could not read this {path.suffix.upper()} file ({e.args[0].decode(errors='replace') if e.args and isinstance(e.args[0], bytes) else e}). "
                "It may be damaged, or from a camera newer than the installed LibRaw – upgrade rawpy or export the file to DNG/JPEG."
            ) from e
        raise CorruptImage(f"RAW decode failed: {e}") from e


def open_image(path: str | Path, max_edge: int | None = None) -> Image.Image:
    """Open + orient (EXIF) + convert to RGB. `max_edge` uses JPEG draft mode for fast, low-memory decodes."""
    p = Path(path)
    if is_raw(p):
        im = _open_raw(p)
    else:
        try:
            im = Image.open(p)
            if max_edge and im.format == "JPEG":
                im.draft("RGB", (max_edge, max_edge))
            im.load()
        except Exception as e:
            raise CorruptImage(f"Cannot decode image: {e}") from e
        im = ImageOps.exif_transpose(im)
        if im.mode in ("I;16", "I;16B", "I;16L", "I"):
            arr = np.asarray(im, dtype=np.float32)
            arr = (arr / max(arr.max(), 1) * 255).astype(np.uint8)
            im = Image.fromarray(arr)
        if im.mode != "RGB":
            im = im.convert("RGB")
    if max_edge and max(im.size) > max_edge:
        im.thumbnail((max_edge, max_edge), Image.LANCZOS)
    return im


def image_size(path: str | Path) -> tuple[int, int]:
    """Oriented (w, h) without decoding pixels where possible."""
    p = Path(path)
    if not is_raw(p):
        try:
            with Image.open(p) as im:
                w, h = im.size
                orient = im.getexif().get(0x0112, 1)
                return (h, w) if orient in (5, 6, 7, 8) else (w, h)
        except Exception as e:
            raise CorruptImage(f"Cannot read image header: {e}") from e
    im = open_image(p)
    return im.size


def _to_float(v) -> float | None:
    try:
        return float(v)
    except Exception:
        try:
            return float(v[0]) / float(v[1])
        except Exception:
            return None


def read_exif(path: str | Path) -> dict:
    """Capture time (with sub-seconds), camera + exposure metadata. Never raises."""
    out: dict = {}
    p = Path(path)
    if is_raw(p):
        try:
            import rawpy  # noqa: F401
            import io
            import rawpy as rp
            with rp.imread(str(p)) as raw:
                th = raw.extract_thumb()
                if th.format == rp.ThumbFormat.JPEG:
                    with Image.open(io.BytesIO(th.data)) as im:
                        return _exif_from(im.getexif())
        except Exception:
            return out
        return out
    try:
        with Image.open(p) as im:
            return _exif_from(im.getexif())
    except Exception:
        return out


def _exif_from(exif) -> dict:
    out: dict = {}
    try:
        base = {ExifTags.TAGS.get(k, k): v for k, v in exif.items()}
        sub = {}
        try:
            sub = {ExifTags.TAGS.get(k, k): v for k, v in exif.get_ifd(0x8769).items()}
        except Exception:
            pass
        dt = sub.get("DateTimeOriginal") or sub.get("DateTimeDigitized") or base.get("DateTime")
        subsec = sub.get("SubsecTimeOriginal") or sub.get("SubSecTimeOriginal") or sub.get("SubsecTime")
        if dt:
            try:
                t = datetime.strptime(str(dt).strip(), "%Y:%m:%d %H:%M:%S")
                frac = float(f"0.{str(subsec).strip()}") if subsec and str(subsec).strip().isdigit() else 0.0
                out["capture_ts"] = t.timestamp() + frac  # naive local time as stored by the camera
                out["capture_time"] = t.isoformat() + (f".{str(subsec).strip()}" if frac else "")
            except ValueError:
                pass
        out["camera_make"] = str(base.get("Make", "")).strip() or None
        out["camera_model"] = str(base.get("Model", "")).strip() or None
        extra = {
            "iso": sub.get("ISOSpeedRatings") or sub.get("PhotographicSensitivity"),
            "exposure_time": _to_float(sub.get("ExposureTime")),
            "f_number": _to_float(sub.get("FNumber")),
            "focal_length": _to_float(sub.get("FocalLength")),
            "lens": sub.get("LensModel"),
            "orientation": base.get("Orientation"),
        }
        out["extra"] = {k: (v if isinstance(v, (int, float, str)) else None) for k, v in extra.items() if v is not None}
    except Exception:
        pass
    return out


def exif_json(meta: dict) -> str:
    return json.dumps({k: v for k, v in meta.items() if k in ("capture_time", "camera_make", "camera_model", "extra")})


def save_jpeg(im: Image.Image, dest: Path, quality: int = 88) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    im.convert("RGB").save(tmp, format="JPEG", quality=quality, optimize=True)
    tmp.replace(dest)


def to_array(im: Image.Image) -> np.ndarray:
    return np.asarray(im.convert("RGB"), dtype=np.uint8)
