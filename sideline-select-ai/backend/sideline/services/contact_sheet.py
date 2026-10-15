"""Review contact sheets (JPEG) built from cached thumbnails – originals are never opened."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

CLASS_COLOURS = {"in_focus": (80, 200, 120), "review": (240, 180, 60), "out_of_focus": (230, 80, 80), None: (120, 120, 120)}


def _font(size: int):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def make_contact_sheets(items: list[dict], dest_dir: Path, base_name: str, title: str, cols: int = 6, rows: int = 5,
                        cell: int = 240) -> list[Path]:
    """items: dicts with thumb (path|None), label, sub, cls, star(bool). Returns written paths (never overwrites)."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    per_page = cols * rows
    pages = max(1, -(-len(items) // per_page))
    f_small, f_title = _font(13), _font(22)
    pad, label_h, head_h = 10, 40, 56
    W = cols * (cell + pad) + pad
    H = head_h + rows * (cell + label_h + pad) + pad
    out: list[Path] = []
    for pg in range(pages):
        sheet = Image.new("RGB", (W, H), (24, 24, 27))
        d = ImageDraw.Draw(sheet)
        d.text((pad, 14), f"{title}  –  page {pg + 1}/{pages}", fill=(250, 250, 250), font=f_title)
        d.text((W - 360, 22), "Auto classifications are estimates", fill=(150, 150, 155), font=f_small)
        for i, it in enumerate(items[pg * per_page:(pg + 1) * per_page]):
            r, c = divmod(i, cols)
            x = pad + c * (cell + pad)
            y = head_h + r * (cell + label_h + pad)
            col = CLASS_COLOURS.get(it.get("cls"), CLASS_COLOURS[None])
            d.rectangle([x - 2, y - 2, x + cell + 1, y + cell + 1], outline=col, width=3)
            tp = it.get("thumb")
            if tp and Path(tp).exists():
                try:
                    with Image.open(tp) as th:
                        th = th.convert("RGB")
                        th.thumbnail((cell, cell))
                        sheet.paste(th, (x + (cell - th.width) // 2, y + (cell - th.height) // 2))
                except Exception:
                    d.text((x + 8, y + 8), "thumbnail unreadable", fill=(200, 200, 200), font=f_small)
            else:
                d.text((x + 8, y + 8), "no thumbnail", fill=(200, 200, 200), font=f_small)
            if it.get("star"):
                d.text((x + 6, y + 4), "★ KEEP", fill=(255, 170, 40), font=f_small)
            d.text((x, y + cell + 4), str(it.get("label", ""))[:34], fill=(235, 235, 235), font=f_small)
            d.text((x, y + cell + 21), str(it.get("sub", ""))[:40], fill=(160, 160, 165), font=f_small)
        p = _unique(dest_dir / f"{base_name}_{pg + 1:02d}.jpg")
        sheet.save(p, "JPEG", quality=88)
        out.append(p)
    return out


def _unique(p: Path) -> Path:
    if not p.exists():
        return p
    n = 2
    while True:
        q = p.with_name(f"{p.stem}_{n}{p.suffix}")
        if not q.exists():
            return q
        n += 1
