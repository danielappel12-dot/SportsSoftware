import type { Focus } from "../api";
import { FOCUS_LABEL } from "./ui";

export interface Filters {
  q: string; number: string; focus: Focus[]; burst: string; minQuality: number; review: string; keeper: string; from: string; to: string; sort: string;
}
export const EMPTY_FILTERS: Filters = { q: "", number: "", focus: [], burst: "", minQuality: 0, review: "", keeper: "", from: "", to: "", sort: "time" };

export function filtersToQuery(f: Filters): Record<string, string | number | undefined> {
  return {
    q: f.q || undefined, number: f.number || undefined, focus: f.focus.length ? f.focus.join(",") : undefined, burst: f.burst || undefined,
    min_quality: f.minQuality > 0 ? f.minQuality : undefined, review: f.review || undefined, keeper: f.keeper || undefined,
    date_from: f.from || undefined, date_to: f.to || undefined, sort: f.sort,
  };
}

export function FilterBar({ f, set, fixedFocus }: { f: Filters; set: (f: Filters) => void; fixedFocus?: boolean }) {
  const up = (p: Partial<Filters>) => set({ ...f, ...p });
  const active = JSON.stringify({ ...f, sort: "" }) !== JSON.stringify({ ...EMPTY_FILTERS, sort: "" });
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-ink-700 bg-ink-900 px-4 py-3">
      <div className="min-w-[160px] flex-1"><label className="label" htmlFor="f-q">Search filename</label><input id="f-q" className="input" placeholder="IMG_0042" value={f.q} onChange={(e) => up({ q: e.target.value })} /></div>
      <div className="w-28"><label className="label" htmlFor="f-n">Jersey #</label><input id="f-n" className="input" placeholder="23 / unknown" value={f.number} onChange={(e) => up({ number: e.target.value.trim() })} /></div>
      {!fixedFocus && (
        <fieldset className="flex flex-col"><legend className="label">Focus</legend>
          <div className="flex gap-1">
            {(Object.keys(FOCUS_LABEL) as Focus[]).map((k) => (
              <button key={k} type="button" aria-pressed={f.focus.includes(k)} onClick={() => up({ focus: f.focus.includes(k) ? f.focus.filter((x) => x !== k) : [...f.focus, k] })}
                className={`btn !px-2 !py-1 text-xs ${f.focus.includes(k) ? "!border-accent !text-accent" : ""}`}>{FOCUS_LABEL[k]}</button>
            ))}
          </div>
        </fieldset>
      )}
      <div className="w-24"><label className="label" htmlFor="f-b">Burst #</label><input id="f-b" inputMode="numeric" className="input" value={f.burst} onChange={(e) => up({ burst: e.target.value.replace(/\D/g, "") })} /></div>
      <div className="w-36"><label className="label" htmlFor="f-mq">Min quality: {f.minQuality}</label><input id="f-mq" type="range" min={0} max={100} step={5} className="w-full accent-orange-500" value={f.minQuality} onChange={(e) => up({ minQuality: Number(e.target.value) })} /></div>
      <div className="w-32"><label className="label" htmlFor="f-r">Review</label>
        <select id="f-r" className="input" value={f.review} onChange={(e) => up({ review: e.target.value })}><option value="">Any</option><option value="needs_review">Needs review</option><option value="reviewed">Reviewed by me</option><option value="ok">No review needed</option></select></div>
      <div className="w-32"><label className="label" htmlFor="f-k">Keeper</label>
        <select id="f-k" className="input" value={f.keeper} onChange={(e) => up({ keeper: e.target.value })}><option value="">Any</option><option value="yes">Keepers</option><option value="no">Not keepers</option></select></div>
      <div><label className="label" htmlFor="f-from">From</label><input id="f-from" type="datetime-local" step={1} className="input" value={f.from} onChange={(e) => up({ from: e.target.value })} /></div>
      <div><label className="label" htmlFor="f-to">To</label><input id="f-to" type="datetime-local" step={1} className="input" value={f.to} onChange={(e) => up({ to: e.target.value })} /></div>
      <div className="w-32"><label className="label" htmlFor="f-s">Sort</label>
        <select id="f-s" className="input" value={f.sort} onChange={(e) => up({ sort: e.target.value })}><option value="time">Capture time</option><option value="name">Filename</option><option value="quality">Quality</option><option value="sharpness">Sharpness</option><option value="burst">Burst / rank</option></select></div>
      {active && <button className="btn btn-ghost text-xs" onClick={() => set({ ...EMPTY_FILTERS, sort: f.sort })}>Clear filters</button>}
    </div>
  );
}
