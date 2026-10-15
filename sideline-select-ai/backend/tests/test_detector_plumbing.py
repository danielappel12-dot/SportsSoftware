"""Exercises YoloOnnxDetector end-to-end (letterbox -> cv2.dnn forward -> YOLOv8 parsing -> NMS -> coordinates)
using a tiny hand-built ONNX graph that emits a YOLOv8-shaped tensor with planted detections.

This verifies the plumbing and coordinate maths only. It says nothing about detection accuracy – real weights are
not bundled (see docs/MODELS.md)."""
import numpy as np
import pytest

onnx = pytest.importorskip("onnx")
from onnx import TensorProto, helper, numpy_helper  # noqa: E402

from sideline.cv.detection import DetectorUnavailable, YoloOnnxDetector  # noqa: E402

N = 8400


def build_model(path, boxes, layout="v8"):
    """boxes: list of (cx, cy, w, h, conf) in 640-letterbox pixel coords, class 0 (person)."""
    nc = 80
    out = np.zeros((4 + nc, N), np.float32)
    for i, (cx, cy, w, h, conf) in enumerate(boxes):
        out[:4, i] = (cx, cy, w, h)
        out[4, i] = conf          # class 0 score
    if layout == "v5":
        out = np.concatenate([out[:4], np.ones((1, N), np.float32), out[4:]], 0).T[None]   # (1, N, 85) with objectness
    else:
        out = out[None]
    inp = helper.make_tensor_value_info("images", TensorProto.FLOAT, [1, 3, 640, 640])
    outv = helper.make_tensor_value_info("output0", TensorProto.FLOAT, list(out.shape))
    zero = numpy_helper.from_array(np.zeros((1,), np.float32), "zero")
    const = numpy_helper.from_array(out, "const")
    nodes = [
        helper.make_node("ReduceMean", ["images"], ["m"], keepdims=0),          # depends on the input so the graph is not constant-folded
        helper.make_node("Mul", ["m", "zero"], ["z"]),
        helper.make_node("Add", ["const", "z"], ["output0"]),
    ]
    g = helper.make_graph(nodes, "fakeyolo", [inp], [outv], [zero, const])
    m = helper.make_model(g, opset_imports=[helper.make_opsetid("", 13)])
    m.ir_version = 8
    onnx.save(m, str(path))


def test_missing_weights_gives_actionable_error(tmp_path):
    d = YoloOnnxDetector(model_path=tmp_path / "nope.onnx")
    ok, msg = d.status()
    assert not ok and "docs/MODELS.md" in msg
    with pytest.raises(DetectorUnavailable):
        d.detect(np.zeros((100, 100, 3), np.uint8), 0.3)


@pytest.mark.parametrize("layout", ["v8", "v5"])
def test_boxes_map_back_to_image_coordinates_and_nms_applies(tmp_path, layout):
    # image 1200x800 -> letterbox scale 640/1200, vertical padding (640-427)/2
    scale = 640 / 1200
    pad_y = (640 - round(800 * scale)) // 2
    # planted person: pixels in the original image x=600..700, y=200..600  -> centre/size in letterbox space
    cx, cy = (650) * scale, 400 * scale + pad_y
    w, h = 100 * scale, 400 * scale
    p = tmp_path / "m.onnx"
    build_model(p, [(cx, cy, w, h, 0.9), (cx + 3, cy + 2, w, h, 0.6), (100, 100, 60, 120, 0.1)], layout)
    det = YoloOnnxDetector(model_path=p)
    assert det.status()[0]
    res = det.detect(np.zeros((800, 1200, 3), np.uint8), min_conf=0.3)
    assert len(res) == 1                                   # duplicate suppressed by NMS, low-confidence box dropped
    d = res[0]
    assert d.x == pytest.approx(600 / 1200, abs=0.01) and d.y == pytest.approx(200 / 800, abs=0.01)
    assert d.w == pytest.approx(100 / 1200, abs=0.01) and d.h == pytest.approx(400 / 800, abs=0.01)
    assert d.conf == pytest.approx(0.9, abs=0.01)


def test_non_person_classes_are_ignored(tmp_path):
    p = tmp_path / "m.onnx"
    build_model(p, [], "v8")
    out = np.zeros((84, N), np.float32)
    out[:4, 0] = (300, 300, 100, 200)
    out[4 + 7, 0] = 0.95                                   # class 7 (truck) wins -> not a player
    res = YoloOnnxDetector._parse(out[None], 0.3, 1.0, 0, 0, 640, 640)
    assert res == []
