import { useEffect, useRef, useState } from "react";
import { api, type ExportPreview, type ExportRecord } from "../api";
import { BrowseModal } from "../components/BrowseModal";
import { Empty, Spinner, fmtBytes } from "../components/ui";
import { useApp } from "../store";

interface PresetInfo { id: string; label: string }
const DESC: Record<string, string> = {
  player: "Players/15/ · Players/22/ · Players/Unknown_Player/",
  focus: "In_Focus/ · Review/ · Out_Of_Focus/",
  player_focus: "Players/15/In_Focus/ · …/Review/ · …/Out_Of_Focus/",
  best: "Best_Frames/ · Other_Frames/",
  bursts: "Bursts/Burst_0001/ · Bursts/Burst_0002/ …",
};

export default function ExportPage() {
  const { project, stats, toast, bump } = useApp();
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [naming, setNaming] = useState<Record<string, string | number>>({});
  const [defaults, setDefaults] = useState<Record<string, string | number>>({});
  const [chosen, setChosen] = useState<string[]>(["player_focus"]);
  const [scope, setScope] = useState<"keepers" | "all">("keepers");
  const [mode, setMode] = useState<"copy" | "move">("copy");
  const [dest, setDest] = useState("");
  const [folder, setFolder] = useState("");
  const [csv, setCsv] = useState(true);
  const [sheet, setSheet] = useState(false);
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [browse, setBrowse] = useState(false);
  const [confirmMove, setConfirmMove] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [history, setHistory] = useState<ExportRecord[]>([]);
  const [running, setRunning] = useState<ExportRecord | null>(null);
  const timer = useRef<number>();

  useEffect(() => {
    api.get<{ presets: PresetInfo[]; naming_defaults: Record<string, string | number> }>("/api/export/presets").then((r) => { setPresets(r.presets); setDefaults(r.naming_defaults); });
    api.get<{ export_destination: string }>("/api/settings").then((s) => setDest((d) => d || s.export_destination)).catch(() => undefined);
  }, []);
  useEffect(() => { if (project) { setFolder(project.name); api.get<ExportRecord[]>(`/api/projects/${project.id}/exports`).then(setHistory).catch(() => undefined); } setPreview(null); }, [project]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => { setPreview(null); }, [chosen, scope, mode, dest, folder, naming]);

  if (!project) return <Empty title="No project selected" />;
  const body = () => ({
    destination: dest, presets: chosen, scope, mode, naming: Object.fromEntries(Object.entries(naming).filter(([, v]) => v !== "" && v !== undefined)),
    folder_name: folder || null, csv, contact_sheet: sheet, confirm_move: mode === "move" && confirmMove === "MOVE",
  });
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  async function doPreview() {
    setBusy(true);
    try { setPreview(await api.post<ExportPreview>(`/api/projects/${project!.id}/export/preview`, body())); } catch (e) { setPreview(null); toast((e as Error).message, "error"); } finally { setBusy(false); }
  }
  async function poll(id: number) {
    const r = await api.get<ExportRecord>(`/api/exports/${id}`);
    setRunning(r);
    if (r.status === "running") { timer.current = window.setTimeout(() => void poll(id), 800); return; }
    setRunning(null); bump();
    api.get<ExportRecord[]>(`/api/projects/${project!.id}/exports`).then(setHistory).catch(() => undefined);
    toast(r.message ?? r.status, r.failed_count ? "error" : "success");
  }
  async function doExport() {
    setBusy(true);
    try { const r = await api.post<{ export_id: number }>(`/api/projects/${project!.id}/export`, body()); void poll(r.export_id); } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(false); }
  }

  const keepers = stats?.keepers ?? 0;
  const moveOk = mode === "copy" || confirmMove === "MOVE";
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
      <header><h1 className="text-2xl font-semibold text-zinc-50">Export</h1>
        <p className="text-sm text-zinc-400">Organise selected photos into folders. Existing files are never overwritten – name clashes get a <code className="text-zinc-300">_2</code>, <code className="text-zinc-300">_3</code> suffix. Always preview first.</p></header>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-200">1 · Organisation presets <span className="font-normal text-zinc-500">(combine as many as you like)</span></h2>
        <div className="grid gap-2 md:grid-cols-2">
          {presets.map((p) => (
            <label key={p.id} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${chosen.includes(p.id) ? "border-accent bg-accent/5" : "border-ink-600 hover:border-ink-500"}`}>
              <input type="checkbox" className="mt-1 accent-orange-500" checked={chosen.includes(p.id)} onChange={() => toggle(p.id)} />
              <span><span className="block text-sm font-medium text-zinc-100">Preset {p.label}</span><span className="block font-mono text-[11px] text-zinc-500">{DESC[p.id]}</span></span>
            </label>
          ))}
        </div>
        <button className="btn btn-ghost text-xs" onClick={() => setAdvanced((v) => !v)}>{advanced ? "▾" : "▸"} Customise folder names</button>
        {advanced && (
          <div className="grid gap-3 md:grid-cols-3">
            {Object.entries(defaults).map(([k, v]) => (
              <div key={k}><label className="label" htmlFor={`n-${k}`}>{k.replace(/_/g, " ")}</label>
                <input id={`n-${k}`} className="input" type={typeof v === "number" ? "number" : "text"} placeholder={String(v)} value={String(naming[k] ?? "")} onChange={(e) => setNaming({ ...naming, [k]: typeof v === "number" ? Number(e.target.value) : e.target.value })} />
                {k === "player_format" && <p className="mt-0.5 text-[11px] text-zinc-500">Use {"{number}"} and {"{name}"} (roster) e.g. {"{number}_{name}"}</p>}</div>
            ))}
          </div>
        )}
      </section>

      <section className="card space-y-4 p-4">
        <h2 className="text-sm font-semibold text-zinc-200">2 · What and where</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <fieldset><legend className="label">Which photos</legend>
            <label className="mb-1 flex items-center gap-2 text-sm"><input type="radio" name="scope" className="accent-orange-500" checked={scope === "keepers"} onChange={() => setScope("keepers")} /> Selected keepers only <span className="text-zinc-500">({keepers} right now)</span></label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="scope" className="accent-orange-500" checked={scope === "all"} onChange={() => setScope("all")} /> All images, sorted by classification ({stats?.analyzed ?? 0})</label></fieldset>
          <fieldset><legend className="label">File handling</legend>
            <label className="mb-1 flex items-center gap-2 text-sm"><input type="radio" name="mode" className="accent-orange-500" checked={mode === "copy"} onChange={() => setMode("copy")} /> Copy – originals stay untouched (recommended)</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="mode" className="accent-orange-500" checked={mode === "move"} onChange={() => setMode("move")} /> Move – removes originals after every copy is verified</label></fieldset>
        </div>
        {mode === "move" && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
            <b>Move deletes the original after copying.</b> It only runs after each copy is written and size-checked. Type <span className="kbd">MOVE</span> to confirm:
            <input className="input mt-2 !w-40" aria-label="Type MOVE to confirm" value={confirmMove} onChange={(e) => setConfirmMove(e.target.value)} />
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-[1fr_240px]">
          <div><label className="label" htmlFor="dest">Destination folder</label>
            <div className="flex gap-2"><input id="dest" className="input" value={dest} onChange={(e) => setDest(e.target.value)} placeholder="/Users/me/Pictures/Exports" /><button className="btn" onClick={() => setBrowse(true)}>Browse…</button></div></div>
          <div><label className="label" htmlFor="gf">Game folder name</label><input id="gf" className="input" value={folder} onChange={(e) => setFolder(e.target.value)} /></div>
        </div>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-orange-500" checked={csv} onChange={(e) => setCsv(e.target.checked)} /> CSV report (filenames, players, scores, timestamps, classification, burst IDs)</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-orange-500" checked={sheet} onChange={(e) => setSheet(e.target.checked)} /> Review contact sheet (JPEG)</label>
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-zinc-200">3 · Preview &amp; run</h2>
          <div className="flex gap-2"><button className="btn" onClick={doPreview} disabled={busy || !dest || chosen.length === 0}>{busy ? <Spinner /> : null} Preview</button>
            <button className="btn btn-primary" onClick={doExport} disabled={busy || !preview || !moveOk || !!running || (preview.files === 0 && !csv && !sheet)}>{mode === "move" ? "Move files" : "Copy files"}</button></div></div>
        {!preview && <p className="text-sm text-zinc-500">Press Preview to see exactly which folders and filenames will be created. Nothing is written until you run the export.</p>}
        {preview && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-center md:grid-cols-4">
              {[["Photos", preview.photos], ["Files to write", preview.files], ["Total size", fmtBytes(preview.bytes)], ["Renamed (clashes)", preview.renamed]].map(([l, v]) => <div key={l} className="rounded-md bg-ink-900 p-3"><div className="text-xl font-semibold tabular-nums text-zinc-50">{v}</div><div className="text-xs text-zinc-500">{l}</div></div>)}
            </div>
            <div className="break-all font-mono text-xs text-zinc-400">→ {preview.root}</div>
            {preview.warnings.map((w, i) => <div key={i} className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">{w}</div>)}
            <div className="max-h-56 overflow-auto rounded-md border border-ink-700">
              <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-ink-800 text-zinc-400"><tr><th className="px-3 py-1.5">Folder</th><th className="px-3 py-1.5 text-right">Files</th></tr></thead>
                <tbody>{Object.entries(preview.folders).map(([f, n]) => <tr key={f} className="border-t border-ink-800"><td className="px-3 py-1 font-mono">{f}/</td><td className="px-3 py-1 text-right tabular-nums">{n}</td></tr>)}</tbody></table>
            </div>
            <details className="text-xs text-zinc-400"><summary className="cursor-pointer">First {preview.sample.length} file(s){preview.truncated ? " (truncated)" : ""}</summary>
              <ul className="mt-2 max-h-48 space-y-0.5 overflow-auto font-mono">{preview.sample.map((s, i) => <li key={i} className={s.renamed ? "text-amber-300" : ""}>{s.to}{s.renamed ? "  (renamed to avoid a clash)" : ""}</li>)}</ul></details>
          </div>
        )}
        {running && (
          <div className="rounded-md border border-accent/40 bg-accent/5 p-3 text-sm"><div className="mb-1 flex justify-between"><span>Exporting…</span><span className="font-mono">{running.item_count}/{running.total_count}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-ink-700"><div className="h-full bg-accent transition-all" style={{ width: `${running.total_count ? (100 * (running.item_count + running.failed_count)) / running.total_count : 0}%` }} /></div></div>
        )}
      </section>

      {history.length > 0 && (
        <section><h2 className="mb-2 text-sm font-semibold text-zinc-300">Export history</h2>
          <div className="card divide-y divide-ink-700">
            {history.map((h) => (
              <div key={h.id} className="px-4 py-2 text-sm"><div className="flex items-center justify-between"><span className="font-medium text-zinc-100">{new Date(h.created_at).toLocaleString()} · {h.mode}</span><span className={`chip ${h.status === "completed" ? "bg-emerald-500/15 text-emerald-300" : h.status === "running" ? "bg-accent/15 text-accent" : "bg-red-500/15 text-red-300"}`}>{h.status.replace(/_/g, " ")}</span></div>
                <div className="break-all font-mono text-[11px] text-zinc-500">{h.destination}</div><div className="text-xs text-zinc-400">{h.message}{h.report_path ? ` · report: ${h.report_path}` : ""}</div></div>
            ))}
          </div></section>
      )}
      {browse && <BrowseModal title="Choose export destination" actionLabel="Use this folder" start={dest || undefined} onClose={() => setBrowse(false)} onPick={(p) => { setDest(p); setBrowse(false); }} />}
    </div>
  );
}
