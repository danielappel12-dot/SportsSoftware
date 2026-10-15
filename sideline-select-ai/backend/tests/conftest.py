import os
import time

import numpy as np
import pytest

from sideline import db


@pytest.fixture()
def env(tmp_path, monkeypatch):
    """Isolated data dir + database + allowed root for each test."""
    monkeypatch.setenv("SIDELINE_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("SIDELINE_DB", str(tmp_path / "data" / "test.db"))
    monkeypatch.setenv("SIDELINE_ALLOWED_ROOTS", str(tmp_path))
    monkeypatch.setenv("SIDELINE_MODELS_DIR", str(tmp_path / "models"))
    db.reset_thread_connection()
    yield tmp_path
    db.reset_thread_connection()


@pytest.fixture()
def client(env):
    from fastapi.testclient import TestClient
    from sideline.main import create_app
    with TestClient(create_app()) as c:
        yield c


def wait_job(client, project_id, timeout=120):
    from sideline.services import jobs
    t0 = time.time()
    while time.time() - t0 < timeout:
        js = client.get(f"/api/projects/{project_id}/jobs").json()
        if js and js[0]["status"] in ("completed", "failed", "cancelled", "paused", "interrupted"):
            jobs.runner.wait(js[0]["id"], 10)
            return js[0]
        time.sleep(0.1)
    raise AssertionError("job did not finish")


def textured_scene(seed=1, w=600, h=700):
    """Player-like synthetic subject on noisy grass used for focus tests."""
    import cv2
    rng = np.random.default_rng(seed)
    img = np.full((h, w, 3), (60, 110, 60), np.uint8)
    img = (img + rng.normal(0, 6, img.shape)).clip(0, 255).astype(np.uint8)
    cv2.rectangle(img, (200, 150), (400, 600), (30, 60, 200), -1)
    cv2.putText(img, "23", (230, 350), cv2.FONT_HERSHEY_DUPLEX, 5, (255, 255, 255), 12)
    cv2.circle(img, (300, 110), 45, (200, 160, 130), -1)
    for i in range(8):
        cv2.line(img, (210, 170 + i * 50), (390, 200 + i * 50), (240, 240, 240), 3, cv2.LINE_AA)
    return img
