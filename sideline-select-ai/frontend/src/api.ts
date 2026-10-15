// Thin typed client for the FastAPI backend (same origin in production, proxied by Vite in development).

export type Focus = "in_focus" | "review" | "out_of_focus";

export interface Project { id: number; name: string; sport: string; game_date: string | null; notes: string | null; is_demo: number; photo_count?: number }
export interface PlayerTag { number: string; status: "auto" | "confirmed" | "needs_review" | "unknown" }
export interface PhotoItem {
  id: number; uid: string; filename: string; status: string; status_detail: string | null; capture_time: string | null; capture_ts: number | null;
  width: number | null; height: number | null; reviewed: boolean; is_raw: number; classification: Focus | null; overall: number | null;
  sharpness_score: number | null; motion_blur: number | null; basis: string | null; burst_seq: number | null; burst_id: number | null;
  burst_rank: number | null; is_best: boolean; keeper: boolean; keeper_source: string | null; needs_review: boolean; players: PlayerTag[];
  rank_score?: number; rank_detail?: Record<string, number> | null; similarity?: number | null;
}
export interface PlayerDetail {
  id: number; bx: number; by: number; bw: number; bh: number; det_conf: number; number: string | null; number_conf: number; raw_text: string | null;
  status: PlayerTag["status"]; source: string; note: string | null; has_crop: boolean; roster_name: string | null;
}
export interface Quality {
  global_sharpness: number; subject_sharpness: number | null; sharpness_score: number; motion_blur: number; subject_visibility: number;
  clip_high: number; clip_low: number; mean_luma: number; exposure_score: number; face_count: number; face_visible: boolean; composition: number;
  resolution_mp: number; width: number; height: number; overall: number; classification: Focus; basis: string; reasons: string[] | null;
  subject_bbox: number[] | null; thresholds: { in: number; out: number; detector: string; ocr: string } | null;
}
export interface PhotoDetail extends PhotoItem {
  original_path: string; moved_to: string | null; file_size: number | null; camera_make: string | null; camera_model: string | null;
  exif: Record<string, string | number>; quality: Quality | null; players_detail: PlayerDetail[]; sha256: string | null; ext: string;
  burst: null | { id: number; seq_no: number; rank_score: number | null; similarity: number | null; rank_detail: Record<string, number> | null;
    members: { id: number; filename: string; rank: number; is_best: number; overall: number | null; classification: Focus | null }[] };
}
export interface Job { id: number; project_id: number; kind: string; status: string; phase: string | null; total: number; done: number; skipped: number; failed: number; message: string | null; error: string | null; progress: number }
export interface Stats {
  total: number; analyzed: number; skipped: number; errors: number; pending: number; progress: number; players: number; bursts: number; keepers: number;
  in_focus: number; review_focus: number; blurry: number; needs_review: number; job: Job | null;
}
export interface BurstSummary { id: number; seq_no: number; locked: number; keep_all: number; size: number; t0: string | null; t1: string | null; best_photo: number | null; best_quality: number | null; blurry: number; keepers: number; numbers: string[] }
export interface BurstDetail { id: number; seq_no: number; locked: boolean; keep_all: boolean; photos: PhotoItem[] }
export interface PlayerRow { number: string; name: string | null; team: string | null; photos: number; confirmed: number; best_quality: number | null; cover_photo: number | null }
export interface Engine { name: string; ok: boolean; message: string; description: string }
export interface SystemStatus {
  version: string; engines: { detector: Engine; ocr: Engine }; raw: { ok: boolean; message: string }; embeddings: { ok: boolean; message: string; enabled: boolean };
  allowed_roots: string[]; data_dir: string; models_dir: string; supported_extensions: string[];
}
export interface Settings {
  default_project_dir: string; export_destination: string; number_confidence: number; number_review_floor: number; max_jersey_digits: number; allow_leading_zero: boolean;
  detector_engine: string; ocr_engine: string; detector_confidence: number; focus_in_threshold: number; focus_out_threshold: number; global_basis_margin: number;
  motion_blur_flag: number; burst_similarity: number; burst_max_gap_seconds: number; burst_max_size: number; use_embeddings: boolean; auto_keepers: boolean;
  rank_weights: Record<string, number>; analysis_size: number; use_gpu: boolean; max_workers: number; thumb_size: number;
}
export interface Correction { id: number; kind: string; summary: string; created_at: string; undone_at: string | null }
export interface ExportPreview { root: string; photos: number; files: number; bytes: number; renamed: number; folders: Record<string, number>; warnings: string[]; sample: { photo_id: number; from: string; to: string; renamed: boolean }[]; truncated: boolean }
export interface ExportRecord { id: number; created_at: string; destination: string; mode: string; status: string; item_count: number; failed_count: number; total_count: number; message: string | null; report_path: string | null; contact_sheet_path: string | null; failures?: { src_path: string; dest_path: string; error: string }[] }
export interface BrowseResult { path: string | null; parent: string | null; dirs: { name: string; path: string }[]; image_count: number }

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined && !(body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : Array.isArray(j.detail) ? j.detail.map((d: { msg: string }) => d.msg).join("; ") : msg;
    } catch { /* not json */ }
    throw new ApiError(res.status, msg || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(u: string) => req<T>("GET", u),
  post: <T>(u: string, b?: unknown) => req<T>("POST", u, b ?? {}),
  put: <T>(u: string, b: unknown) => req<T>("PUT", u, b),
  del: <T>(u: string) => req<T>("DELETE", u),
  upload: <T>(u: string, form: FormData) => req<T>("POST", u, form),
};

export const img = {
  thumb: (id: number) => `/api/photos/${id}/thumb`,
  preview: (id: number) => `/api/photos/${id}/preview`,
  full: (id: number) => `/api/photos/${id}/full`,
  crop: (playerId: number) => `/api/players/${playerId}/crop`,
};

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, String(v)); });
  const s = p.toString();
  return s ? `?${s}` : "";
}
