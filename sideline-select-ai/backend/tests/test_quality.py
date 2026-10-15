import cv2
import numpy as np

from sideline.cv import quality as Q
from sideline.settings import Settings
from conftest import textured_scene

SUBJECT = (slice(100, 620), slice(190, 410))
BOX = (190 / 600, 100 / 700, 220 / 600, 520 / 700)


def score(img):
    return Q.sharpness_score_of(Q.to_gray(img)[SUBJECT])


def test_sharpness_decreases_monotonically_with_blur():
    base = textured_scene()
    vals = [score(cv2.GaussianBlur(base, (0, 0), s)) for s in (0.6, 1.5, 3, 5, 8)]
    assert vals == sorted(vals, reverse=True)
    assert vals[0] > 55 and vals[-1] < 20


def test_sharpness_is_robust_to_sensor_noise():
    base = textured_scene()
    rng = np.random.default_rng(3)
    clean_sharp, clean_soft = score(base), score(cv2.GaussianBlur(base, (0, 0), 4))
    noisy_soft = (cv2.GaussianBlur(base, (0, 0), 4).astype(np.float32) + rng.normal(0, 18, base.shape)).clip(0, 255).astype(np.uint8)
    # a blurred frame must not turn into a "sharp" one just because it is noisy (Laplacian-variance's classic failure)
    assert score(noisy_soft) < 40
    assert abs(score(noisy_soft) - clean_soft) < 15
    assert clean_sharp > 60


def test_flat_region_has_no_measurable_sharpness():
    assert Q.sharpness_score_of(np.full((200, 200), 120, np.uint8)) is None


def test_motion_blur_detected_separately_from_defocus():
    base = textured_scene()
    k = 21
    ker = np.zeros((k, k), np.float32)
    ker[k // 2, :] = 1.0 / k
    motion = cv2.filter2D(base, -1, ker)
    defocus = cv2.GaussianBlur(base, (0, 0), 4)
    mb_motion, _ = Q.motion_blur_score(Q.to_gray(motion)[SUBJECT])
    mb_defocus, _ = Q.motion_blur_score(Q.to_gray(defocus)[SUBJECT])
    mb_sharp, _ = Q.motion_blur_score(Q.to_gray(base)[SUBJECT])
    assert mb_motion > 40
    assert mb_defocus < 15 and mb_sharp < 15


def test_classification_thresholds_and_settings():
    s = Settings()
    assert Q.classify(80, "subject", s) == "in_focus"
    assert Q.classify(40, "subject", s) == "review"
    assert Q.classify(10, "subject", s) == "out_of_focus"
    # whole-frame basis needs extra margin (grass / crowd texture can inflate it)
    assert Q.classify(s.focus_in_threshold + 1, "global", s) == "review"
    assert Q.classify(s.focus_in_threshold + s.global_basis_margin, "global", s) == "in_focus"
    strict = Settings(focus_in_threshold=90, focus_out_threshold=60)
    assert Q.classify(80, "subject", strict) == "review"


def test_full_analysis_uses_subject_crop_and_explains_itself():
    s = Settings()
    sharp = Q.analyse_quality(textured_scene(), [BOX], s)
    blur = Q.analyse_quality(cv2.GaussianBlur(textured_scene(), (0, 0), 6), [BOX], s)
    assert sharp.basis == "subject" and sharp.classification == "in_focus"
    assert blur.classification == "out_of_focus"
    assert sharp.overall > blur.overall
    assert sharp.reasons and "sharpness score" in sharp.reasons[0]


def test_sharp_subject_with_blurred_background_is_not_penalised():
    img = textured_scene()
    bg = cv2.GaussianBlur(img, (0, 0), 6)
    out = bg.copy()
    out[100:620, 190:410] = img[100:620, 190:410]  # sharp subject, soft background (panning / shallow DoF)
    r = Q.analyse_quality(out, [BOX], Settings())
    assert r.classification == "in_focus"
    assert any("sharp against a softer background" in x for x in r.reasons)


def test_without_detector_falls_back_to_global_and_says_so():
    r = Q.analyse_quality(textured_scene(), [], Settings(), detector_note="Player detection unavailable (no model).")
    assert r.basis == "global"
    assert any("unavailable" in x for x in r.reasons)


def test_exposure_clipping_indicators():
    blown = np.full((100, 100), 255, np.uint8)
    hi, lo, mean, sc = Q.exposure_metrics(blown)
    assert hi == 1.0 and lo == 0.0 and sc < 50
    ok = np.full((100, 100), 120, np.uint8)
    assert Q.exposure_metrics(ok)[3] > 90


def test_composition_and_visibility_penalise_cut_off_and_overlapped_subjects():
    assert Q.composition_score((0.4, 0.2, 0.2, 0.6)) > Q.composition_score((0.0, 0.2, 0.2, 0.6))
    assert Q.visibility_score((0.4, 0.2, 0.2, 0.6), []) > Q.visibility_score((0.4, 0.2, 0.2, 0.6), [(0.4, 0.2, 0.2, 0.6)])
