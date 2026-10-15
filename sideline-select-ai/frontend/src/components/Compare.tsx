import { useRef, useState } from "react";
import { api, img, type PhotoItem } from "../api";
import { useApp } from "../store";
import { FocusChip, Modal } from "./ui";

/** Side-by-side comparison with shared zoom + pan so the same region can be checked in every frame. */
export function Compare({ items, onClose }: { items: PhotoItem[]; onClose: () => void }) {
  const { bump, toast } = useApp();
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const cols = items.length <= 2 ? 2 : items.length === 3 ? 3 : 2;

  async function keep(ids: number[], keeper: boolean | null) {
    try {
      const r = await api.post<{ correction_id: number }>("/api/photos/keepers", { photo_ids: ids, keeper });
      bump();
      toast(keeper ? "Marked as keeper" : keeper === false ? "Rejected" : "Cleared", "success", () => { void api.post(`/api/corrections/${r.correction_id}/undo`).then(bump); });
    } catch (e) { toast((e as Error).message, "error"); }
  }

  return (
    <Modal title={`Compare ${items.length} frames`} onClose={onClose} wide>
      <div className="mb-3 flex items-center gap-3 text-xs text-zinc-400">
        <label htmlFor="cz">Zoom {zoom.toFixed(1)}×</label>
        <input id="cz" type="range" min={1} max={6} step={0.25} value={zoom} className="accent-orange-500" onChange={(e) => { setZoom(Number(e.target.value)); if (Number(e.target.value) === 1) setOff({ x: 0, y: 0 }); }} />
        <span>Drag to pan all frames together.</span>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {items.map((p) => (
          <div key={p.id} className="card overflow-hidden">
            <div className="relative aspect-[3/2] cursor-grab overflow-hidden bg-black active:cursor-grabbing"
              onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y }; }}
              onPointerMove={(e) => { if (drag.current && zoom > 1) setOff({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) }); }}
              onPointerUp={() => { drag.current = null; }}>
              <img src={img.preview(p.id)} alt={p.filename} draggable={false} className="h-full w-full select-none object-contain" style={{ transform: `translate(${off.x}px, ${off.y}px) scale(${zoom})`, transformOrigin: "center" }} />
              {p.is_best && <span className="chip absolute left-2 top-2 bg-accent text-ink-950">BEST</span>}
            </div>
            <div className="space-y-2 p-3 text-xs">
              <div className="flex items-center justify-between"><span className="truncate font-medium text-zinc-100" title={p.filename}>{p.filename}</span><FocusChip value={p.classification} /></div>
              <div className="grid grid-cols-3 gap-2 font-mono text-zinc-300">
                <span title="Sharpness score">S {p.sharpness_score?.toFixed(0) ?? "–"}</span>
                <span title="Motion blur">M {p.motion_blur?.toFixed(0) ?? "–"}</span>
                <span title="Overall quality">Q {p.overall?.toFixed(0) ?? "–"}</span>
              </div>
              <div className="text-zinc-400">{p.players.length ? p.players.map((x) => `#${x.number}${x.status === "needs_review" ? "?" : ""}`).join(", ") : "No jersey number"}{p.burst_rank ? ` · burst rank ${p.burst_rank}` : ""}</div>
              <div className="flex gap-2">
                <button className={`btn flex-1 ${p.keeper ? "btn-primary" : ""}`} onClick={() => keep([p.id], true)}>★ Keep</button>
                <button className="btn flex-1" onClick={() => keep([p.id], false)}>Reject</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
