import cv2
import numpy as np

from sideline.cv import burst as B
from sideline.cv import hashing as H
from conftest import textured_scene


def sig_for(i, img, name=None, ts=None, numbers=()):
    return B.PhotoSig(i, name or f"IMG_{i:04d}.jpg", ts, H.phash(img), H.dhash(img), H.signature(img), H.colour_hist(img), frozenset(numbers))


def test_phash_identical_resized_and_different():
    a = textured_scene(1)
    small = cv2.resize(a, (300, 350))
    other = np.roll(cv2.flip(textured_scene(9), 1), 200, axis=1)
    other[:] = (255 - other)
    assert H.hamming(H.phash(a), H.phash(a)) == 0
    assert H.hamming(H.phash(a), H.phash(small)) <= 6          # robust to resizing
    assert H.hamming(H.phash(a), H.phash(other)) > 12          # clearly different picture
    assert H.hash_similarity(H.phash(a), H.phash(a)) == 1.0


def test_hex_roundtrip():
    v = H.phash(textured_scene())
    assert H.from_hex(H.hex64(v)) == v


def test_near_duplicate_similarity_high_unrelated_low():
    a = textured_scene(1)
    jitter = np.clip(a.astype(np.int16) + np.random.default_rng(0).normal(0, 3, a.shape), 0, 255).astype(np.uint8)
    b = np.zeros_like(a); b[:, :, 0] = np.tile(np.linspace(0, 255, a.shape[1]), (a.shape[0], 1))
    assert B.pair_similarity(sig_for(1, a), sig_for(2, jitter)) > 0.9
    assert B.pair_similarity(sig_for(1, a), sig_for(3, b)) < 0.7


def _play(base_id, scene_seed, n, t0, step=0.2, shift=6):
    base = textured_scene(scene_seed)
    out = []
    for k in range(n):
        M = np.float32([[1, 0, shift * k], [0, 1, 0]])
        f = cv2.warpAffine(base, M, (base.shape[1], base.shape[0]), borderMode=cv2.BORDER_REFLECT)
        out.append(sig_for(base_id + k, f, ts=t0 + step * k))
    return out


def test_bursts_group_each_play_without_merging_the_game():
    p1, p2, p3 = _play(1, 1, 5, 1000.0), _play(11, 40, 5, 1030.0), _play(21, 80, 5, 1060.0)
    groups, _ = B.group_bursts(p1 + p2 + p3, threshold=0.8, max_gap=4.0)
    sets = sorted(sorted(g) for g in groups)
    assert len(sets) == 3
    assert sets[0] == [1, 2, 3, 4, 5] and sets[1] == [11, 12, 13, 14, 15]


def test_time_gap_splits_identical_looking_frames():
    a = _play(1, 1, 3, 1000.0)
    b = _play(11, 1, 3, 1100.0)  # same scene, 100 s later
    groups, _ = B.group_bursts(a + b, threshold=0.8, max_gap=4.0)
    assert sorted(map(sorted, groups)) == [[1, 2, 3], [11, 12, 13]]


def test_max_group_size_prevents_mega_burst():
    frames = _play(1, 1, 12, 1000.0, step=0.1, shift=1)
    groups, _ = B.group_bursts(frames, threshold=0.6, max_gap=5.0, max_size=5)
    assert all(len(g) <= 5 for g in groups)


def test_different_confident_numbers_do_not_merge_similar_frames():
    img = textured_scene(1)
    moved = cv2.warpAffine(img, np.float32([[1, 0, 12], [0, 1, 0]]), (img.shape[1], img.shape[0]), borderMode=cv2.BORDER_REFLECT)
    same_player = [sig_for(1, img, ts=1.0, numbers={"7"}), sig_for(2, moved, ts=1.2, numbers={"7"})]
    other_player = [sig_for(1, img, ts=1.0, numbers={"7"}), sig_for(2, moved, ts=1.2, numbers={"88"})]
    assert B.pair_similarity(*other_player) < 0.97             # similar, but not near-identical
    assert len(B.group_bursts(same_player, threshold=0.8)[0]) == 1
    assert B.group_bursts(other_player, threshold=0.8)[0] == []   # two different players: never merged


def test_no_timestamps_falls_back_to_filename_order():
    frames = _play(1, 1, 4, 0.0)
    for f in frames:
        f.ts = None
    groups, _ = B.group_bursts(list(reversed(frames)), threshold=0.8)
    assert sorted(groups[0]) == [1, 2, 3, 4]
    assert [p.id for p in B.order_photos(list(reversed(frames)))] == [1, 2, 3, 4]


def test_ranking_prefers_sharp_visible_and_penalises_out_of_focus():
    w = {"sharpness": .3, "motion": .15, "visibility": .15, "face": .1, "composition": .1, "exposure": .1, "number": .05, "representative": .05}
    good = B.RankInput(1, 85, 0, 90, True, 80, 85, 0.9, 0.9, "in_focus", 1.0)
    soft = B.RankInput(2, 35, 10, 90, True, 80, 85, 0.9, 0.9, "review", 1.1)
    blur = B.RankInput(3, 8, 70, 90, False, 80, 85, 0.2, 0.9, "out_of_focus", 1.2)
    res = B.rank_group([blur, soft, good], w)
    assert [r.id for r in res] == [1, 2, 3]
    assert [r.rank for r in res] == [1, 2, 3]
    assert set(res[0].parts) >= {"sharpness", "motion", "face", "composition"}  # explainable
