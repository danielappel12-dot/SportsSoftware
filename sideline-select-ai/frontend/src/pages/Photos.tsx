import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type Focus } from "../api";
import { Compare } from "../components/Compare";
import { EMPTY_FILTERS, FilterBar, filtersToQuery, type Filters } from "../components/FilterBar";
import { PhotoGrid } from "../components/PhotoGrid";
import { Viewer } from "../components/Viewer";
import { Empty, Spinner } from "../components/ui";
import { usePhotos, useRoster } from "../hooks";
import { useApp } from "../store";

interface Props { title: string; view: string; subtitle?: string; fixedFocus?: Focus; emptyHint?: string }

export default function Photos({ title, view, subtitle, emptyHint }: Props) {
  const { project, stats, bump, toast } = useApp();
  const [params] = useSearchParams();
  const initial = useMemo<Filters>(() => ({ ...EMPTY_FILTERS, number: params.get("number") ?? "", burst: params.get("burst") ?? "" }), [params]);
  const [filters, setFilters] = useState<Filters>(initial);
  useEffect(() => setFilters(initial), [initial]);
  const [debounced, setDebounced] = useState(filters);
  useEffect(() => { const t = window.setTimeout(() => setDebounced(filters), 250); return () => window.clearTimeout(t); }, [filters]);
  const { items, total, loading, error } = usePhotos({ view, ...filtersToQuery(debounced) });
  const roster = useRoster();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [viewer, setViewer] = useState<number | null>(null);
  const [compare, setCompare] = useState(false);
  const last = useRef<number | null>(null);

  useEffect(() => { setSelected((s) => new Set([...s].filter((id) => items.some((i) => i.id === id)))); }, [items]);

  const onToggle = useCallback((id: number, e: { shift: boolean; meta: boolean }, index: number) => {
    setSelected((prev) => {
      const n = new Set(e.meta || e.shift ? prev : []);
      if (e.shift && last.current !== null) {
        const [a, b] = [Math.min(last.current, index), Math.max(last.current, index)];
        items.slice(a, b + 1).forEach((i) => n.add(i.id));
      } else if (prev.has(id) && (e.meta || prev.size === 1)) n.delete(id);
      else n.add(id);
      return n;
    });
    last.current = index;
  }, [items]);

  async function bulk(keeper: boolean | null) {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      const r = await api.post<{ correction_id: number }>("/api/photos/keepers", { photo_ids: ids, keeper });
      bump();
      toast(`${keeper ? "Marked keeper" : keeper === false ? "Rejected" : "Reset to automatic"}: ${ids.length} photo(s)`, "success", () => { void api.post(`/api/corrections/${r.correction_id}/undo`).then(bump); });
    } catch (e) { toast((e as Error).message, "error"); }
  }
  async function reviewed() {
    await api.post("/api/photos/reviewed", { photo_ids: [...selected], reviewed: true });
    bump(); toast(`${selected.size} photo(s) marked reviewed`, "success"); setSelected(new Set());
  }

  const selItems = items.filter((i) => selected.has(i.id));
  const nothingYet = (stats?.total ?? 0) === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end justify-between px-6 pb-2 pt-5">
        <div><h1 className="text-xl font-semibold text-zinc-50">{title}</h1><p className="text-sm text-zinc-400">{subtitle}</p></div>
        <div className="text-sm text-zinc-400">{loading ? <Spinner /> : <><span className="font-semibold text-zinc-100">{total.toLocaleString()}</span> photo{total === 1 ? "" : "s"}</>}</div>
      </div>
      <FilterBar f={filters} set={setFilters} fixedFocus={view === "in_focus" || view === "out_of_focus"} />
      <div className="flex min-h-[44px] items-center gap-2 border-b border-ink-700 bg-ink-900/60 px-4 py-1.5 text-sm">
        {selected.size === 0 ? (
          <><span className="text-xs text-zinc-500">Click to select · Shift/Ctrl-click for ranges · double-click or Enter to open</span>
            <button className="btn btn-ghost ml-auto text-xs" onClick={() => setSelected(new Set(items.map((i) => i.id)))} disabled={!items.length}>Select all {items.length}</button></>
        ) : (
          <>
            <span className="font-medium text-accent">{selected.size} selected</span>
            <button className="btn btn-primary" onClick={() => bulk(true)}>★ Keep</button>
            <button className="btn" onClick={() => bulk(false)}>Reject</button>
            <button className="btn" onClick={() => bulk(null)}>Auto</button>
            <button className="btn" onClick={reviewed}>Mark reviewed</button>
            <button className="btn" disabled={selected.size < 2 || selected.size > 4} title="Select 2-4 photos" onClick={() => setCompare(true)}>Compare</button>
            <button className="btn btn-ghost ml-auto text-xs" onClick={() => setSelected(new Set())}>Clear selection</button>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 p-2">
        {error ? <Empty title="Could not load photos" icon="⚠">{error}</Empty>
          : !loading && items.length === 0 ? (
            <Empty title={nothingYet ? "No photos yet" : "Nothing matches"} icon="▦">
              {nothingYet ? "Import photos to begin." : emptyHint ?? "Try clearing some filters."}
            </Empty>
          ) : <PhotoGrid items={items} selected={selected} roster={roster} onToggle={onToggle} onOpen={setViewer} showRank={filters.sort === "burst"} />}
      </div>
      {viewer !== null && items[viewer] && <Viewer items={items} index={viewer} roster={roster} onIndex={setViewer} onClose={() => setViewer(null)} />}
      {compare && <Compare items={selItems} onClose={() => setCompare(false)} />}
      {!project && <Empty title="No project selected" />}
    </div>
  );
}
