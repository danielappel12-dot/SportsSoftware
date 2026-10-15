import numpy as np
import pytest
from PIL import Image

from sideline import imageio


def _save(tmp_path, name, im, **kw):
    p = tmp_path / name
    im.save(p, **kw)
    return p


def test_supported_extensions_cover_common_and_raw_formats():
    for n in ["a.jpg", "a.JPEG", "a.png", "a.tif", "a.TIFF", "a.cr3", "a.NEF", "a.arw", "a.dng", "a.raf", "a.orf", "a.rw2"]:
        assert imageio.is_supported(n), n
    for n in ["a.txt", "a.mp4", "a.heic", "a"]:
        assert not imageio.is_supported(n), n
    assert imageio.is_raw("x.CR3") and not imageio.is_raw("x.jpg")


@pytest.mark.parametrize("name,kw", [("a.jpg", {}), ("a.png", {}), ("a.tif", {}), ("a.bmp", {}), ("a.webp", {})])
def test_standard_formats_open_as_rgb(tmp_path, name, kw):
    p = _save(tmp_path, name, Image.fromarray(np.random.default_rng(0).integers(0, 255, (60, 80, 3), dtype=np.uint8)), **kw)
    im = imageio.open_image(p)
    assert im.mode == "RGB" and im.size == (80, 60)
    assert imageio.image_size(p) == (80, 60)


def test_grayscale_cmyk_and_16bit_tiff_are_converted(tmp_path):
    g = _save(tmp_path, "g.png", Image.new("L", (40, 30), 128))
    c = _save(tmp_path, "c.jpg", Image.new("CMYK", (40, 30), (0, 0, 0, 0)))
    arr16 = (np.random.default_rng(1).integers(0, 65535, (30, 40), dtype=np.uint16))
    t = tmp_path / "t.tif"
    Image.fromarray(arr16).save(t)
    for p in (g, c, t):
        assert imageio.open_image(p).mode == "RGB"
    out = imageio.to_array(imageio.open_image(t))
    assert out.dtype == np.uint8 and out.max() > 200      # 16-bit range was rescaled, not clipped to black/white


def test_exif_orientation_is_applied_and_metadata_read(tmp_path):
    im = Image.new("RGB", (80, 40), (10, 20, 30))
    exif = Image.Exif()
    exif[0x0112] = 6                                         # camera rotated: needs 90° turn
    exif[0x010F], exif[0x0110] = "Canon", "EOS R6"
    ifd = exif.get_ifd(0x8769)
    ifd[0x9003], ifd[0x9291] = "2025:09:06 19:31:02", "450"
    ifd[0x829A], ifd[0x829D], ifd[0x8827] = 1 / 1000, 2.8, 3200
    p = _save(tmp_path, "o.jpg", im, exif=exif)
    assert imageio.open_image(p).size == (40, 80)
    assert imageio.image_size(p) == (40, 80)
    m = imageio.read_exif(p)
    assert m["camera_make"] == "Canon" and m["camera_model"] == "EOS R6"
    assert m["capture_time"] == "2025-09-06T19:31:02.450"
    assert m["capture_ts"] % 1 == pytest.approx(0.45, abs=1e-3)           # sub-second precision for burst timing
    assert m["extra"]["iso"] == 3200 and m["extra"]["f_number"] == pytest.approx(2.8, abs=0.01)


def test_missing_exif_never_raises(tmp_path):
    m = imageio.read_exif(_save(tmp_path, "n.png", Image.new("RGB", (10, 10))))
    assert "capture_ts" not in m and not m.get("camera_make")
    assert imageio.read_exif(tmp_path / "does-not-exist.jpg") == {}


def test_corrupt_and_truncated_files_raise_corrupt_image(tmp_path):
    bad = tmp_path / "bad.jpg"
    bad.write_bytes(b"\xff\xd8\xff garbage")
    with pytest.raises(imageio.CorruptImage):
        imageio.open_image(bad)
    good = _save(tmp_path, "g.jpg", Image.fromarray(np.random.default_rng(0).integers(0, 255, (200, 300, 3), dtype=np.uint8)))
    trunc = tmp_path / "t.jpg"
    trunc.write_bytes(good.read_bytes()[:400])
    with pytest.raises(imageio.CorruptImage):
        imageio.open_image(trunc)


def test_max_edge_downscales_large_images(tmp_path):
    p = _save(tmp_path, "big.jpg", Image.new("RGB", (4000, 3000), (50, 60, 70)))
    im = imageio.open_image(p, max_edge=1000)
    assert max(im.size) <= 1000 and abs(im.size[0] / im.size[1] - 4 / 3) < 0.01
    assert imageio.image_size(p) == (4000, 3000)              # real dimensions are still reported


def test_raw_without_decoder_explains_how_to_fix(tmp_path, monkeypatch):
    f = tmp_path / "IMG_0001.CR3"
    f.write_bytes(b"x" * 100)
    monkeypatch.setattr(imageio, "raw_support", lambda: (False, "rawpy is not installed. Run: pip install rawpy"))
    with pytest.raises(imageio.UnsupportedImage, match="pip install rawpy"):
        imageio.open_image(f)


def test_raw_with_decoder_reports_unreadable_file_clearly(tmp_path):
    pytest.importorskip("rawpy")
    f = tmp_path / "IMG_0002.NEF"
    f.write_bytes(b"definitely not a raw file" * 40)
    with pytest.raises((imageio.UnsupportedImage, imageio.CorruptImage)) as ei:
        imageio.open_image(f)
    assert ".NEF" in str(ei.value) or "RAW" in str(ei.value)
