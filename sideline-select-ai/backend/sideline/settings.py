"""Persistent, validated application settings (stored as JSON rows in app_settings)."""
from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from .db import get_conn, tx


class RankWeights(BaseModel):
    sharpness: float = 0.30
    motion: float = 0.15
    visibility: float = 0.15
    face: float = 0.10
    composition: float = 0.10
    exposure: float = 0.10
    number: float = 0.05
    representative: float = 0.05


class Settings(BaseModel):
    # paths
    default_project_dir: str = ""
    export_destination: str = ""
    # number recognition
    number_confidence: float = Field(0.70, ge=0.05, le=0.99, description="auto-accept at or above")
    number_review_floor: float = Field(0.35, ge=0.0, le=0.95, description="below this -> Unknown Player")
    max_jersey_digits: int = Field(2, ge=1, le=3)
    allow_leading_zero: bool = True
    detector_engine: Literal["auto", "yolo-onnx", "demo-color", "none"] = "auto"
    ocr_engine: Literal["auto", "paddleocr", "demo-template", "none"] = "auto"
    detector_confidence: float = Field(0.35, ge=0.05, le=0.95)
    # focus (0-100 scale on the sharpness score)
    focus_in_threshold: float = Field(55.0, ge=1, le=100)
    focus_out_threshold: float = Field(30.0, ge=0, le=99)
    global_basis_margin: float = Field(12.0, ge=0, le=50)
    motion_blur_flag: float = Field(55.0, ge=0, le=100)
    # bursts
    burst_similarity: float = Field(0.80, ge=0.3, le=0.99)
    burst_max_gap_seconds: float = Field(4.0, ge=0.1, le=120)
    burst_max_size: int = Field(80, ge=2, le=1000)
    use_embeddings: bool = False
    rank_weights: RankWeights = RankWeights()
    auto_keepers: bool = True
    # performance
    analysis_size: int = Field(1600, ge=640, le=4096)
    use_gpu: bool = False
    max_workers: int = Field(2, ge=1, le=16)
    thumb_size: int = Field(360, ge=120, le=800)

    @model_validator(mode="after")
    def _check(self) -> "Settings":
        if self.focus_out_threshold >= self.focus_in_threshold:
            raise ValueError("focus_out_threshold must be lower than focus_in_threshold")
        if self.number_review_floor >= self.number_confidence:
            raise ValueError("number_review_floor must be lower than number_confidence")
        return self


def load_settings() -> Settings:
    rows = get_conn().execute("SELECT key, value FROM app_settings").fetchall()
    raw = {}
    for r in rows:
        try:
            raw[r["key"]] = json.loads(r["value"])
        except json.JSONDecodeError:
            continue
    try:
        return Settings(**raw)
    except Exception:  # corrupted/legacy values -> fall back to defaults rather than crash
        return Settings()


def save_settings(s: Settings) -> Settings:
    with tx() as c:
        for k, v in s.model_dump().items():
            c.execute(
                "INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, json.dumps(v)),
            )
    return s


def reset_settings() -> Settings:
    with tx() as c:
        c.execute("DELETE FROM app_settings")
    return Settings()
