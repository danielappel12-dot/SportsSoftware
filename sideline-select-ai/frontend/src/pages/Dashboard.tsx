import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Correction } from "../api";
import { JobPanel } from "../components/JobPanel";
import { Empty, ProgressBar, StatCard } from "../components/ui";
import { useApp } from "../store";

export default function Dashboard() {
  const { project, stats, system, version, bump, toast } = useApp();
  const nav = useNavigate();
  const [corr, setCorr] = useState<Correction[]>([]);
  useEffect(() => {
    if (project) api.get<Correction[]>(`/api/projects/${project.id}/corrections?limit=8`).then(setCorr).catch(() => undefined);
  }, [project, version]);
  if (!project) return <Empty title="No project selected" />;
  const s = stats;
  async function undo(id: number) {
    try { await api.post(`/api/corrections/${id}/undo`); bump(); toast("Correction undone", "success"); } catch (e) { toast((e as Error).message, "error"); }
  }
  async function reprocess(reanalyze: boolean) {
    try { await api.post(`/api/projects/${project!.id}/process`, { reanalyze }); bump(); } catch (e) { toast((e as Error).message, "error"); }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">{project.name}</h1>
          <p className="text-sm text-zinc-400">{project.sport}{project.game_date ? ` · ${project.game_date}` : ""}</p>
        </div>
        <div className="flex gap-2"><Link to="/import" className="btn btn-primary">Import photos</Link><Link to="/needs-review" className="btn">Review queue</Link></div>
      </header>

      {!s ? <div className="text-zinc-500">Loading…</div> : s.total === 0 ? (
        <div className="card"><Empty title="This project has no photos yet" icon="⇪">Drop in a folder of game photos on the Import page. Originals are only ever read, never changed.<div className="mt-4"><Link className="btn btn-primary" to="/import">Go to Import</Link></div></Empty></div>
      ) : (
        <>
          <section aria-label="Progress" className="card p-4">
            <div className="mb-2 flex items-center justify-between text-sm"><span className="text-zinc-300">Processing progress</span><span className="font-mono text-zinc-100">{s.progress.toFixed(0)}%</span></div>
            <ProgressBar value={s.progress} />
            <div className="mt-2 text-xs text-zinc-500">{s.analyzed} analysed · {s.skipped} skipped (duplicates) · {s.errors} could not be read · {s.pending} waiting</div>
          </section>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Summary">
            <StatCard label="Photos imported" value={s.total.toLocaleString()} sub={`${s.skipped} duplicate · ${s.errors} unreadable`} onClick={() => nav("/photos")} />
            <StatCard label="Photos analysed" value={s.analyzed.toLocaleString()} sub={`${s.in_focus} in focus · ${s.review_focus} borderline`} onClick={() => nav("/photos")} />
            <StatCard label="Players recognised" value={s.players} sub="distinct jersey numbers" onClick={() => nav("/players")} />
            <StatCard label="Burst groups" value={s.bursts} onClick={() => nav("/bursts")} />
            <StatCard label="Likely keepers" value={s.keepers} accent onClick={() => nav("/best")} sub="your picks + automatic suggestions" />
            <StatCard label="Blurry images" value={s.blurry} onClick={() => nav("/out-of-focus")} sub="estimated out of focus" />
            <StatCard label="Awaiting review" value={s.needs_review} accent={s.needs_review > 0} onClick={() => nav("/needs-review")} sub="borderline focus or unknown player" />
            <StatCard label="Unreadable files" value={s.errors} onClick={() => nav("/import")} sub="see Import for reasons" />
          </section>
        </>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section aria-label="Latest job"><h2 className="mb-2 text-sm font-semibold text-zinc-300">Latest processing job</h2><JobPanel job={s?.job ?? null} />
          {s && s.total > 0 && <div className="mt-2 flex gap-2"><button className="btn text-xs" onClick={() => reprocess(false)} disabled={!!s.job && ["queued", "running", "paused"].includes(s.job.status)}>Process waiting photos</button><button className="btn text-xs" onClick={() => reprocess(true)} disabled={!!s.job && ["queued", "running", "paused"].includes(s.job.status)} title="Re-run analysis with the current settings. Your manual corrections are kept.">Re-analyse all</button></div>}
        </section>
        <section aria-label="Corrections"><h2 className="mb-2 text-sm font-semibold text-zinc-300">Recent corrections</h2>
          <div className="card divide-y divide-ink-700">
            {corr.length === 0 && <div className="p-4 text-sm text-zinc-500">Nothing yet. Corrections you make (numbers, keepers, burst edits) are logged here and can be undone.</div>}
            {corr.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className={c.undone_at ? "text-zinc-600 line-through" : "text-zinc-200"}>{c.summary}<div className="text-[11px] text-zinc-500">{new Date(c.created_at).toLocaleString()}</div></div>
                {!c.undone_at && <button className="btn !py-1 text-xs" onClick={() => undo(c.id)}>Undo</button>}
              </div>
            ))}
          </div>
        </section>
      </div>

      {system && !project.is_demo && (!system.engines.detector.ok || !system.engines.ocr.ok) && (
        <section className="card border-amber-500/40 p-4 text-sm text-amber-100">
          <h2 className="mb-1 font-semibold">Recognition models are not set up</h2>
          <p className="text-amber-200/80">Sharpness, exposure, duplicate and burst analysis work without any model. Player detection and jersey OCR need the optional models: <Link className="underline" to="/settings">see the setup checklist in Settings</Link>. Until then, photos are never given invented players or numbers.</p>
        </section>
      )}
    </div>
  );
}
