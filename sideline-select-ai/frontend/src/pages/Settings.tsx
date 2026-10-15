import { useEffect, useState, type ReactNode } from "react";
import { api, type Settings } from "../api";
import { Spinner } from "../components/ui";
import { useApp } from "../store";

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <div className="grid gap-1 py-2 md:grid-cols-[260px_1fr] md:gap-4"><div><div className="text-sm font-medium text-zinc-200">{label}</div>{hint && <div className="text-xs text-zinc-500">{hint}</div>}</div><div>{children}</div></div>;
}

function Slider({ value, min, max, step, onChange, fmt }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return <div className="flex items-center gap-3"><input type="range" className="w-full max-w-xs accent-orange-500" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /><span className="w-16 font-mono text-sm text-zinc-300">{fmt ? fmt(value) : value}</span></div>;
}

export default function SettingsPage() {
  const { project, system, bump, toast, reloadStats } = useApp();
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.get<Settings>("/api/settings").then((x) => { setS(x); setSaved(x); }); }, []);
  if (!s) return <div className="p-6"><Spinner /></div>;
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });

  async function save(reanalyze = false) {
    setSaving(true);
    try {
      const r = await api.put<Settings>("/api/settings", s);
      setS(r); setSaved(r); toast("Settings saved", "success");
      if (reanalyze && project) { await api.post(`/api/projects/${project.id}/process`, { reanalyze: true }); toast("Re-analysing with the new settings (your manual corrections are kept)…", "info"); }
      bump(); void reloadStats();
    } catch (e) { toast((e as Error).message, "error"); } finally { setSaving(false); }
  }
  async function reset() {
    if (!window.confirm("Reset all settings to their defaults?")) return;
    const r = await api.post<Settings>("/api/settings/reset"); setS(r); setSaved(r); toast("Defaults restored", "success"); bump();
  }
  async function resetCorrections() {
    if (!project) return;
    if (!window.confirm("Discard ALL manual number assignments and keeper picks for this project?\n\nThis cannot be undone.")) return;
    try { const r = await api.post<{ removed: number }>(`/api/projects/${project.id}/corrections/reset?confirm=true`); toast(`Removed ${r.removed} manual player entries and keeper picks`, "success"); bump(); } catch (e) { toast((e as Error).message, "error"); }
  }

  const Eng = ({ name, e }: { name: string; e: { ok: boolean; message: string; name: string; description: string } }) => (
    <div className="flex items-start gap-3 py-2"><span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${e.ok ? "bg-emerald-400" : "bg-amber-400"}`} aria-hidden /><div className="text-sm"><div className="font-medium text-zinc-100">{name}: <span className="font-mono">{e.name}</span> – {e.ok ? "ready" : "not available"}</div><div className="text-xs text-zinc-400">{e.message}{e.description ? ` · ${e.description}` : ""}</div></div></div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">
      <header className="flex items-end justify-between"><div><h1 className="text-2xl font-semibold text-zinc-50">Settings</h1><p className="text-sm text-zinc-400">Thresholds apply to future analysis; use “Save &amp; re-analyse” to apply them to existing photos. Manual corrections are kept.</p></div>
        <div className="flex gap-2"><button className="btn" onClick={reset}>Defaults</button><button className="btn" disabled={!dirty || saving} onClick={() => save(false)}>Save</button><button className="btn btn-primary" disabled={saving || !project} onClick={() => save(true)}>Save &amp; re-analyse</button></div></header>

      <section className="card p-4">
        <h2 className="mb-1 text-sm font-semibold text-zinc-100">Recognition models &amp; system</h2>
        {system ? <>
          <Eng name="Player detector" e={system.engines.detector} />
          <Eng name="Jersey OCR" e={system.engines.ocr} />
          <div className="flex items-start gap-3 py-2"><span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${system.raw.ok ? "bg-emerald-400" : "bg-amber-400"}`} /><div className="text-sm"><div className="font-medium text-zinc-100">RAW decoding – {system.raw.ok ? "ready" : "not available"}</div><div className="text-xs text-zinc-400">{system.raw.message}</div></div></div>
          <div className="flex items-start gap-3 py-2"><span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${system.embeddings.ok ? "bg-emerald-400" : "bg-zinc-500"}`} /><div className="text-sm"><div className="font-medium text-zinc-100">Image embeddings (optional) – {system.embeddings.ok ? "model found" : "not installed"}</div><div className="text-xs text-zinc-400">{system.embeddings.message}</div></div></div>
          <p className="mt-2 text-xs text-zinc-500">Model folder: <span className="font-mono">{system.models_dir}</span> · Data folder: <span className="font-mono">{system.data_dir}</span>. Setup steps and licences: <span className="font-mono">docs/MODELS.md</span> in the project.</p>
        </> : <Spinner />}
      </section>

      <section className="card divide-y divide-ink-700 p-4">
        <h2 className="pb-2 text-sm font-semibold text-zinc-100">Jersey number recognition</h2>
        <Row label="Auto-accept confidence" hint="At or above this a number is used automatically (still correctable)."><Slider value={s.number_confidence} min={0.3} max={0.98} step={0.01} onChange={(v) => set("number_confidence", v)} fmt={(v) => `${Math.round(v * 100)}%`} /></Row>
        <Row label="Needs-review floor" hint="Between this and auto-accept → Needs Review. Below → Unknown Player."><Slider value={s.number_review_floor} min={0.05} max={0.9} step={0.01} onChange={(v) => set("number_review_floor", v)} fmt={(v) => `${Math.round(v * 100)}%`} /></Row>
        <Row label="Max digits"><select className="input !w-28" value={s.max_jersey_digits} onChange={(e) => set("max_jersey_digits", Number(e.target.value))}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></Row>
        <Row label="Keep leading zeroes" hint="Keeps “07” and “00” as written (some leagues use them)."><input type="checkbox" className="accent-orange-500" checked={s.allow_leading_zero} onChange={(e) => set("allow_leading_zero", e.target.checked)} /></Row>
        <Row label="Detector engine"><select className="input !w-48" value={s.detector_engine} onChange={(e) => set("detector_engine", e.target.value)}><option value="auto">Automatic</option><option value="yolo-onnx">YOLO (ONNX)</option><option value="demo-color">Demo (synthetic only)</option><option value="none">Off</option></select></Row>
        <Row label="OCR engine"><select className="input !w-48" value={s.ocr_engine} onChange={(e) => set("ocr_engine", e.target.value)}><option value="auto">Automatic</option><option value="paddleocr">PaddleOCR</option><option value="demo-template">Demo (synthetic only)</option><option value="none">Off</option></select></Row>
        <Row label="Player detection confidence"><Slider value={s.detector_confidence} min={0.1} max={0.9} step={0.05} onChange={(v) => set("detector_confidence", v)} fmt={(v) => `${Math.round(v * 100)}%`} /></Row>
      </section>

      <section className="card divide-y divide-ink-700 p-4">
        <h2 className="pb-2 text-sm font-semibold text-zinc-100">Focus classification <span className="font-normal text-zinc-500">– estimates, not guarantees</span></h2>
        <p className="py-2 text-xs text-zinc-400">Scores run 0–100 from edge-width analysis of the main player (or the whole frame when no player is found). A good photograph can still score low (deliberate motion blur) and a poor one can score high, so always glance at <b>Review</b> and <b>Out of Focus</b> before discarding anything.</p>
        <Row label="In Focus at or above"><Slider value={s.focus_in_threshold} min={10} max={100} step={1} onChange={(v) => set("focus_in_threshold", v)} /></Row>
        <Row label="Out of Focus at or below"><Slider value={s.focus_out_threshold} min={0} max={95} step={1} onChange={(v) => set("focus_out_threshold", v)} /></Row>
        <Row label="Extra margin when no player found" hint="Whole-frame sharpness can be inflated by grass/crowd texture."><Slider value={s.global_basis_margin} min={0} max={40} step={1} onChange={(v) => set("global_basis_margin", v)} /></Row>
        <Row label="Motion-blur flag at"><Slider value={s.motion_blur_flag} min={10} max={100} step={1} onChange={(v) => set("motion_blur_flag", v)} /></Row>
      </section>

      <section className="card divide-y divide-ink-700 p-4">
        <h2 className="pb-2 text-sm font-semibold text-zinc-100">Burst grouping</h2>
        <Row label="Similarity threshold" hint="Higher = stricter (fewer, tighter bursts)."><Slider value={s.burst_similarity} min={0.5} max={0.98} step={0.01} onChange={(v) => set("burst_similarity", v)} fmt={(v) => v.toFixed(2)} /></Row>
        <Row label="Max time gap (seconds)" hint="Frames further apart than this never share a burst."><Slider value={s.burst_max_gap_seconds} min={0.2} max={30} step={0.2} onChange={(v) => set("burst_max_gap_seconds", v)} fmt={(v) => `${v.toFixed(1)}s`} /></Row>
        <Row label="Max frames per burst"><input type="number" className="input !w-28" min={2} max={1000} value={s.burst_max_size} onChange={(e) => set("burst_max_size", Number(e.target.value))} /></Row>
        <Row label="Use image embeddings" hint="Needs the optional embedding.onnx model."><input type="checkbox" className="accent-orange-500" checked={s.use_embeddings} onChange={(e) => set("use_embeddings", e.target.checked)} /></Row>
        <Row label="Suggest automatic keepers" hint="Marks the best frame of each burst and sharp singles as ★auto keepers (always reversible)."><input type="checkbox" className="accent-orange-500" checked={s.auto_keepers} onChange={(e) => set("auto_keepers", e.target.checked)} /></Row>
        {Object.entries(s.rank_weights).map(([k, v]) => <Row key={k} label={`Ranking weight – ${k}`}><Slider value={v} min={0} max={0.6} step={0.01} onChange={(x) => set("rank_weights", { ...s.rank_weights, [k]: x })} fmt={(x) => x.toFixed(2)} /></Row>)}
      </section>

      <section className="card divide-y divide-ink-700 p-4">
        <h2 className="pb-2 text-sm font-semibold text-zinc-100">Performance &amp; folders</h2>
        <Row label="Analysis image size" hint="Long edge in pixels. Larger = more detail, slower."><select className="input !w-40" value={s.analysis_size} onChange={(e) => set("analysis_size", Number(e.target.value))}>{[1024, 1280, 1600, 2048, 2560, 3200].map((n) => <option key={n} value={n}>{n}px</option>)}</select></Row>
        <Row label="Concurrent tasks"><Slider value={s.max_workers} min={1} max={16} step={1} onChange={(v) => set("max_workers", v)} /></Row>
        <Row label="GPU acceleration (optional)" hint="Used only if your OpenCV/PaddlePaddle build supports CUDA; otherwise it silently stays on CPU and says so in the status above."><input type="checkbox" className="accent-orange-500" checked={s.use_gpu} onChange={(e) => set("use_gpu", e.target.checked)} /></Row>
        <Row label="Default project folder" hint="Where “Import in place” starts."><input className="input" value={s.default_project_dir} onChange={(e) => set("default_project_dir", e.target.value)} placeholder="/Users/me/Pictures" /></Row>
        <Row label="Default export destination"><input className="input" value={s.export_destination} onChange={(e) => set("export_destination", e.target.value)} placeholder="/Users/me/Pictures/Exports" /></Row>
        <Row label="Allowed folders" hint="The server only reads/writes inside these (set SIDELINE_ALLOWED_ROOTS to add more)."><ul className="font-mono text-xs text-zinc-400">{system?.allowed_roots.map((r) => <li key={r}>{r}</li>)}</ul></Row>
      </section>

      <section className="card border-red-500/30 p-4">
        <h2 className="mb-1 text-sm font-semibold text-red-300">Danger zone</h2>
        <p className="mb-3 text-xs text-zinc-400">Re-analysing never removes your corrections. Only this button does.</p>
        <button className="btn btn-danger" onClick={resetCorrections} disabled={!project}>Reset all manual corrections for this project</button>
      </section>
    </div>
  );
}
