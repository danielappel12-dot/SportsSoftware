import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { img, type PhotoItem } from "../api";
import { FOCUS_LABEL, FOCUS_STYLE } from "./ui";

interface Props {
  items: PhotoItem[];
  selected: Set<number>;
  roster?: Record<string, string>;
  onToggle: (id: number, e: { shift: boolean; meta: boolean }, index: number) => void;
  onOpen: (index: number) => void;
  minCell?: number;
  showRank?: boolean;
}

function Cell({ p, index, selected, roster, onToggle, onOpen, showRank }: { p: PhotoItem; index: number; selected: boolean; roster?: Record<string, string>; onToggle: Props["onToggle"]; onOpen: Props["onOpen"]; showRank?: boolean }) {
  const confident = p.players.filter((x) => x.status === "auto" || x.status === "confirmed");
  const suggested = p.players.filter((x) => x.status === "needs_review");
  return (
    <div
      role="button" tabIndex={0} aria-pressed={selected} aria-label={`${p.filename}${p.classification ? `, ${FOCUS_LABEL[p.classification]}` : ""}`}
      onClick={(e) => onToggle(p.id, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey }, index)}
      onDoubleClick={() => onOpen(index)}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(index); if (e.key === " ") { e.preventDefault(); onToggle(p.id, { shift: e.shiftKey, meta: true }, index); } }}
      className={`group relative flex h-full cursor-pointer select-none flex-col overflow-hidden rounded-md border bg-ink-850 transition ${selected ? "border-accent ring-2 ring-accent/60" : "border-ink-700 hover:border-ink-500"}`}
    >
      <div className="relative min-h-0 flex-1 bg-ink-900">
        <img src={img.thumb(p.id)} alt="" loading="lazy" draggable={false} className="h-full w-full object-contain" />
        <div className="absolute left-1 top-1 flex gap-1">
          {p.burst_seq != null && <span className="chip bg-black/70 font-mono text-zinc-200" title="Burst group">B{String(p.burst_seq).padStart(4, "0")}{showRank && p.burst_rank ? ` · #${p.burst_rank}` : ""}</span>}
          {p.is_best && <span className="chip bg-accent/90 text-ink-950" title="Best frame of its burst">BEST</span>}
        </div>
        <div className="absolute right-1 top-1 flex gap-1">
          {p.needs_review && <span className="chip bg-amber-500/90 text-ink-950" title="Needs review">!</span>}
          {p.keeper && <span className="chip bg-accent text-ink-950" title={p.keeper_source === "user" ? "Keeper (your pick)" : "Keeper (automatic suggestion)"}>★{p.keeper_source === "auto" ? "·auto" : ""}</span>}
        </div>
        {p.is_raw === 1 && <span className="absolute bottom-1 right-1 chip bg-black/70 text-zinc-300">RAW</span>}
      </div>
      <div className="space-y-1 px-2 py-1.5">
        <div className="truncate text-xs font-medium text-zinc-100" title={p.filename}>{p.filename}</div>
        <div className="flex items-center justify-between gap-1">
          <div className="flex min-w-0 flex-wrap gap-1">
            {confident.length === 0 && suggested.length === 0 && <span className="chip bg-ink-700 text-zinc-400" title="No confident jersey number">Unknown</span>}
            {confident.slice(0, 3).map((x, i) => <span key={i} className={`chip ${x.status === "confirmed" ? "bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40" : "bg-ink-700 text-zinc-100"}`}>{roster?.[x.number] ? `#${x.number} ${roster[x.number]}` : `#${x.number}`}</span>)}
            {confident.length === 0 && suggested.slice(0, 1).map((x, i) => <span key={i} className="chip bg-amber-500/15 text-amber-300" title="Suggested, not confirmed">#{x.number}?</span>)}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {p.classification && <span className={`chip ${FOCUS_STYLE[p.classification]}`}>{FOCUS_LABEL[p.classification]}</span>}
            <span className="font-mono text-[11px] text-zinc-400" title="Overall quality score">{p.overall != null ? p.overall.toFixed(0) : "–"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PhotoGrid({ items, selected, roster, onToggle, onOpen, minCell = 210, showRank }: Props) {
  const parent = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const el = parent.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const cols = Math.max(1, Math.floor((width - 8) / minCell));
  const cellW = (width - 8) / cols;
  const rowH = Math.round(cellW * 0.72 + 62);
  const rows = Math.ceil(items.length / cols);
  const v = useVirtualizer({ count: rows, getScrollElement: () => parent.current, estimateSize: () => rowH + 8, overscan: 4 });
  useEffect(() => { v.measure(); }, [rowH, v]);
  const rowsView = v.getVirtualItems();
  const idx = useMemo(() => items, [items]);
  return (
    <div ref={parent} className="h-full overflow-auto px-1" data-testid="photo-grid">
      <div style={{ height: v.getTotalSize(), position: "relative", width: "100%" }}>
        {rowsView.map((r) => (
          <div key={r.key} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${r.start}px)`, height: rowH, display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8 }}>
            {Array.from({ length: cols }, (_, c) => {
              const i = r.index * cols + c;
              const p = idx[i];
              return p ? <Cell key={p.id} p={p} index={i} selected={selected.has(p.id)} roster={roster} onToggle={onToggle} onOpen={onOpen} showRank={showRank} /> : <div key={`e${c}`} />;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
