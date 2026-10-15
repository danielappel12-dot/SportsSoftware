import { useCallback, useEffect, useRef, useState } from "react";
import { api, img, type BurstDetail, type BurstSummary } from "../api";
import { Compare } from "../components/Compare";
import { PhotoGrid } from "../components/PhotoGrid";
import { Viewer } from "../components/Viewer";
import { Empty, Spinner } from "../components/ui";
import { useRoster } from "../hooks";
import { useApp } from "../store";

export default function Bursts() {
  const { project, version, bump, toast } = useApp();
  const roster = useRoster();
  const [list, setList] = useState<BurstSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<number | null>(null);
  const [detail, setDetail] = useState<BurstDetail | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [viewer, setViewer] = useState<number | null>(null);
  const [compare, setCompare] = useState(false);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!project) return;
    api.get<BurstSummary[]>(`/api/projects/${project.id}/bursts`).then((r) => { setList(r); setActive((a) => (a !== null && r.some((b) => b.id === a) ? a : r[0]?.id ?? null)); }).finally(() => setLoading(false));
  }, [project, version]);
  useEffect(() => {
    if (active === null) { setDetail(null); return; }
    api.get<BurstDetail>(`/api/bursts/${active}`).then(setDetail).catch(() => setDetail(null));
    setSelected(new Set()); last.current = null;
  }, [active, version]);

  const onToggle = useCallback((id: number, e: { shift: boolean; meta: boolean }, index: number) => {
    setSelected((prev) => {
      const n = new Set(e.meta || e.shift ? prev : []);
      if (e.shift && last.current !== null && detail) {
        const [a, b] = [Math.min(last.current, index), Math.max(last.current, index)];
        detail.photos.slice(a, b + 1).forEach((p) => n.add(p.id));
      } else if (prev.has(id) && (e.meta || prev.size === 1)) n.delete(id); else n.add(id);
      return n;
    });
    last.current = index;
  }, [detail]);

  if (!project) return <Empty title="No project selected" />;

  const undoToast = (text: string, cid: number) => toast(text, "success", () => { void api.post(`/api/corrections/${cid}/undo`).then(bump); });
  async function setKeepers(ids: number[], keeper: boolean | null, text: string) {
    try { const r = await api.post<{ correction_id: number }>("/api/photos/keepers", { photo_ids: ids, keeper }); bump(); undoToast(text, r.correction_id); } catch (e) { toast((e as Error).message, "error"); }
  }
  async function keepAll(v: boolean) {
    if (!detail) return;
    try { await api.post(`/api/bursts/${detail.id}/keep-all`, { keep_all: v }); bump(); toast(v ? "Entire sequence retained" : "Sequence no longer retained as a whole", "success"); } catch (e) { toast((e as Error).message, "error"); }
  }
  async function split() {
    try { const r = await api.post<{ correction_id: number }>(`/api/projects/${project!.id}/bursts/split`, { photo_ids: [...selected] }); bump(); undoToast("Split into a new burst", r.correction_id); } catch (e) { toast((e as Error).message, "error"); }
  }
  async function merge() {
    try { const r = await api.post<{ correction_id: number }>(`/api/projects/${project!.id}/bursts/merge`, { burst_ids: [...checked] }); setChecked(new Set()); bump(); undoToast(`Merged ${checked.size} bursts`, r.correction_id); } catch (e) { toast((e as Error).message, "error"); }
  }
  async function regroup() {
    try { await api.post(`/api/projects/${project!.id}/process`, { regroup_only: true }); toast("Regrouping with current settings (manual bursts are kept)…", "info"); bump(); } catch (e) { toast((e as Error).message, "error"); }
  }

  const sel = detail?.photos.filter((p) => selected.has(p.id)) ?? [];
  return (
    <div className="flex h-full">
      <aside className="flex w-72 shrink-0 flex-col border-r border-ink-700 bg-ink-900">
        <div className="space-y-2 border-b border-ink-700 p-3">
          <div className="flex items-center justify-between"><h1 className="text-base font-semibold text-zinc-50">Burst groups</h1><span className="text-xs text-zinc-500">{list.length}</span></div>
          <div className="flex gap-2"><button className="btn flex-1 text-xs" onClick={regroup} title="Re-run automatic grouping using the similarity and time settings">Regroup</button><button className="btn flex-1 text-xs" disabled={checked.size < 2} onClick={merge}>Merge {checked.size >= 2 ? checked.size : ""} checked</button></div>
        </div>
        <ul className="min-h-0 flex-1 overflow-auto">
          {loading && <li className="p-4"><Spinner /></li>}
          {!loading && list.length === 0 && <li className="p-4 text-sm text-zinc-500">No bursts found yet. Bursts need ≥2 similar frames within the time-gap setting.</li>}
          {list.map((b) => (
            <li key={b.id} className={`flex items-center gap-2 border-b border-ink-800 px-3 py-2 ${active === b.id ? "bg-accent/10" : "hover:bg-ink-800"}`}>
              <input type="checkbox" aria-label={`Select burst ${b.seq_no} for merging`} checked={checked.has(b.id)} onChange={(e) => setChecked((s) => { const n = new Set(s); e.target.checked ? n.add(b.id) : n.delete(b.id); return n; })} className="accent-orange-500" />
              <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setActive(b.id)}>
                <div className="h-11 w-14 shrink-0 overflow-hidden rounded bg-ink-800">{b.best_photo && <img src={img.thumb(b.best_photo)} alt="" className="h-full w-full object-cover" loading="lazy" />}</div>
                <div className="min-w-0"><div className="flex items-center gap-1 text-sm font-medium text-zinc-100">B{String(b.seq_no).padStart(4, "0")}{b.locked ? <span title="Manually edited" className="text-accent">✎</span> : null}{b.keep_all ? <span title="Entire sequence retained" className="text-accent">★</span> : null}</div>
                  <div className="truncate text-xs text-zinc-500">{b.size} frames{b.numbers.length ? ` · ${b.numbers.map((n) => "#" + n).join(" ")}` : ""}{b.blurry ? ` · ${b.blurry} blurry` : ""}</div></div>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        {!detail ? <Empty title="Select a burst" icon="≣">Pick a burst to see its contact sheet, ranking and quality scores.</Empty> : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-ink-700 px-4 py-3">
              <div className="mr-2"><h2 className="text-lg font-semibold text-zinc-50">Burst {String(detail.seq_no).padStart(4, "0")}</h2><p className="text-xs text-zinc-500">{detail.photos.length} frames ranked best → worst. Ranking is a suggestion; nothing is discarded.</p></div>
              <button className="btn btn-primary" onClick={() => setKeepers([detail.photos[0].id], true, "Best frame marked as keeper")}>★ Keep best</button>
              <button className={`btn ${detail.keep_all ? "!border-accent !text-accent" : ""}`} aria-pressed={detail.keep_all} onClick={() => keepAll(!detail.keep_all)}>{detail.keep_all ? "★ Entire sequence retained" : "Retain entire sequence"}</button>
              <span className="mx-1 h-5 w-px bg-ink-600" />
              <button className="btn" disabled={!selected.size} onClick={() => setKeepers([...selected], true, `${selected.size} marked keeper`)}>Keep selected</button>
              <button className="btn" disabled={!selected.size} onClick={() => setKeepers([...selected], false, `${selected.size} rejected`)}>Reject selected</button>
              <button className="btn" disabled={sel.length < 2 || sel.length > 4} onClick={() => setCompare(true)}>Compare {sel.length >= 2 ? sel.length : ""}</button>
              <button className="btn" disabled={!selected.size || selected.size === detail.photos.length} onClick={split} title="Move the selected frames into their own burst">Split selected</button>
            </div>
            <div className="min-h-0 flex-1 p-2"><PhotoGrid items={detail.photos} selected={selected} roster={roster} onToggle={onToggle} onOpen={setViewer} minCell={230} showRank /></div>
          </>
        )}
      </section>
      {viewer !== null && detail?.photos[viewer] && <Viewer items={detail.photos} index={viewer} roster={roster} onIndex={setViewer} onClose={() => setViewer(null)} />}
      {compare && <Compare items={sel} onClose={() => setCompare(false)} />}
    </div>
  );
}
