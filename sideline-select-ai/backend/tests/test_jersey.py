import numpy as np
import pytest

from sideline.cv import jersey as J
from sideline.cv.ocr import OcrEngine, OcrToken, TemplateDigitOcr


@pytest.mark.parametrize("text,expect", [
    ("23", "23"), (" 7 ", "7"), ("#12", "12"), ("1 2", "12"), ("O7", "07"), ("l5", "15"), ("B", "8"),
    ("07", "07"), ("00", "00"), ("NIKE", None), ("ABC12", None), ("123", None), ("", None), ("2024", None),
])
def test_normalise_number(text, expect):
    assert J.normalise_number(text, max_digits=2, allow_leading_zero=True)[0] == expect


def test_leading_zero_policy():
    assert J.normalise_number("07", 2, allow_leading_zero=False)[0] == "7"
    assert J.normalise_number("00", 2, allow_leading_zero=False)[0] == "0"
    assert J.normalise_number("07", 2, allow_leading_zero=True)[0] == "07"


def test_repaired_reads_carry_a_penalty():
    assert J.normalise_number("23")[1] == 0
    assert J.normalise_number("2S")[1] > 0


def test_geometry_rejects_implausible_boxes():
    ok, _ = J.geometry_score((0.3, 0.3, 0.4, 0.18), 2, player_aspect=0.4)
    tiny, n1 = J.geometry_score((0.3, 0.3, 0.1, 0.03), 2, player_aspect=0.4)       # sponsor text size
    edge, n2 = J.geometry_score((0.9, 0.3, 0.1, 0.18), 1, player_aspect=0.4)       # at the side of the player
    legs, n3 = J.geometry_score((0.3, 0.85, 0.3, 0.1), 2, player_aspect=0.4)       # down at the shorts
    assert ok > 0.9 and tiny < 0.5 and edge < 0.7 and legs < 0.6
    assert n1 and n2 and n3


def test_review_assignment_uses_confidence_bands():
    assert J.assign_status("23", 0.9, 0.7, 0.35) == "auto"
    assert J.assign_status("23", 0.7, 0.7, 0.35) == "auto"
    assert J.assign_status("23", 0.5, 0.7, 0.35) == "needs_review"
    assert J.assign_status("23", 0.2, 0.7, 0.35) == "unknown"
    assert J.assign_status(None, 0.99, 0.7, 0.35) == "unknown"


class FakeOcr(OcrEngine):
    """Returns canned tokens in the coordinates of the (upscaled) region it is given."""
    name = "fake"

    def __init__(self, tokens_fn):
        self.fn = tokens_fn

    def read(self, rgb):
        return self.fn(rgb)


def _player(h=400, w=160):
    return np.full((h, w, 3), 90, np.uint8)


def test_largest_text_is_not_blindly_chosen():
    # A big, confident, but implausible read (e.g. a huge chest logo number placed on the legs) must lose to a
    # smaller plausible back number.
    def fn(img):
        H, W = img.shape[:2]
        return [OcrToken("88", 0.97, (0.05 * W, 0.8 * H, 0.9 * W, 0.19 * H)),   # largest, but at the bottom edge
                OcrToken("23", 0.85, (0.25 * W, 0.30 * H, 0.5 * W, 0.40 * H))]
    best, ranked = J.read_player_number(_player(), FakeOcr(fn))
    assert best.number == "23"
    assert len(ranked) >= 1


def test_conflicting_strong_reads_reduce_confidence():
    def fn(img):
        H, W = img.shape[:2]
        return [OcrToken("23", 0.9, (0.25 * W, 0.25 * H, 0.5 * W, 0.45 * H)), OcrToken("28", 0.88, (0.25 * W, 0.25 * H, 0.5 * W, 0.45 * H))]
    best, _ = J.read_player_number(_player(), FakeOcr(fn))
    assert best.conf < 0.7 and any("conflicting" in n for n in best.notes)


def test_non_numbers_and_too_long_numbers_are_ignored():
    def fn(img):
        H, W = img.shape[:2]
        return [OcrToken("RAIDERS", 0.99, (0.1 * W, 0.2 * H, 0.8 * W, 0.2 * H)), OcrToken("12345", 0.99, (0.1 * W, 0.3 * H, 0.8 * W, 0.2 * H))]
    best, ranked = J.read_player_number(_player(), FakeOcr(fn))
    assert best is None and ranked == []


def test_tiny_crop_is_rejected():
    assert J.read_player_number(np.zeros((10, 5, 3), np.uint8), FakeOcr(lambda i: []))[0] is None


def test_template_ocr_reads_rendered_digits():
    import cv2
    img = np.full((220, 260, 3), (30, 60, 200), np.uint8)
    cv2.putText(img, "47", (50, 150), cv2.FONT_HERSHEY_DUPLEX, 3.2, (255, 255, 255), 7, cv2.LINE_AA)
    toks = TemplateDigitOcr().read(img)
    assert toks and toks[0].text == "47" and toks[0].conf > 0.8
    assert TemplateDigitOcr().read(np.full((200, 200, 3), 120, np.uint8)) == []
