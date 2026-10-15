import { useCallback, useEffect, useRef, useState } from "react";
import { api, img, type PhotoDetail, type PhotoItem } from "../api";
import { useApp } from "../store";
import { FocusChip, Meter, fmtBytes, fmtTime } from "./ui";

interface Props { items: PhotoItem[]; index: number; roster: Record<string, string>; onIndex: (i: number) => void; onClose: () => void }

const STATUS_TEXT: Record<string, string> = { auto: "Auto", confirmed: "Confirmed", needs_review: "Needs review", unknown: "Unknown" };

export function Viewer({ items, index, roster, onIndex, onClose }: Props) {
  const { version, bump, toast } = useApp();
  const item = items[index];
  const [detail, setDetail] = useState<PhotoDetail | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [full, setFull] = useState(false);
  const [boxes, setBoxes] = useState(true);
  const [panel, setPanel] = useState(true);
  const [numInputs, setNumInputs] = useState<Record<number, string>>({});
  const [assign, setAssign] = useState("");
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (!item) return;
    api.get<PhotoDetail>(`/api/photos/${item.id}`).then(setDetail).catch((e: Error) => toast(e.message, "error"));
  }, [item, toast]);
  useEffect(() => { setDetail(null); setZoom(1); setOff({ x: 0, y: 0 }); setFull(false); setNumInputs({}); setAssign(""); }, [item?.id]);
  useEffect(load, [load, version]);

  // preload neighbours so next/previous feels instant
  useEffect(() => {
    [items[index + 1], items[index - 1]].forEach((n) => { if (n) new Image().src = img.preview(n.id); });
  }, [index, items]);

  const undoable = useCallback((cid: number | null | undefined, text: string) => {
    toast(text, "success", cid ? () => { void api.post(`/api/corrections/${cid}/undo`).then(() => { bump(); }).catch((e: Error) => toast(e.message, "error")); } : undefined);
  }, [bump, toast]);

  const setKeeper = useCallback(async (keeper: boolean | null) => {
    if (!item) return;
    try {
      const r = await api.post<{ correction_id: number }>("/api/photos/keepers", { photo_ids: [item.id], keeper });
      bump(); undoable(r.correction_id, keeper ? "Marked keeper" : keeper === false ? "Rejected" : "Back to automatic");
    } catch (e) { toast((e as Error).message, "error"); }
  }, [item, bump, undoable, toast]);

  const markReviewed = useCallback(async () => {
    if (!item) return;
    await api.post("/api/photos/reviewed", { photo_ids: [item.id], reviewed: true }).catch(() => undefined);
    bump(); toast("Marked as reviewed", "success");
  }, [item, bump, toast]);

  const next = useCallback(() => index < items.length - 1 && onIndex(index + 1), [index, items.length, onIndex]);
  const prev = useCallback(() => index > 0 && onIndex(index - 1), [index, onIndex]);
  const zoomBy = useCallback((f: number) => setZoom((z) => { const n = Math.max(1, Math.min(8, z * f)); if (n === 1) setOff({ x: 0, y: 0 }); return n; }), []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") { if (e.key === "Escape") t.blur(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "Escape": onClose(); break;
        case "ArrowRight": case "d": next(); break;
        case "ArrowLeft": case "a": prev(); break;
        case "+": case "=": zoomBy(1.25); break;
        case "-": zoomBy(0.8); break;
        case "0": setZoom(1); setOff({ x: 0, y: 0 }); break;
        case "f": setFull((v) => !v); break;
        case "b": setBoxes((v) => !v); break;
        case "i": setPanel((v) => !v); break;
        case "k": void setKeeper(true); break;
        case "x": void setKeeper(false); break;
        case "u": void setKeeper(null); break;
        case "r": void markReviewed(); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [next, prev, onClose, zoomBy, setKeeper, markReviewed]);

  const onWheel = (e: React.WheelEvent) => { zoomBy(e.deltaY < 0 ? 1.15 : 0.87); };

  async function confirmNumber(pid: number, number: string | null) {
    try {
      const r = await api.post<{ correction_id: number }>(`/api/players/${pid}/number`, { number });
      bump(); undoable(r.correction_id, number ? `Confirmed #${number}` : "Marked as unknown player");
    } catch (e) { toast((e as Error).message, "error"); }
  }
  async function applyBurst(pid: number) {
    try {
      const r = await api.post<{ correction_id: number | null; updated_photos: number[]; skipped: number }>(`/api/players/${pid}/apply-burst`);
      bump(); undoable(r.correction_id, `Applied to ${r.updated_photos.length} other frame(s) in this burst${r.skipped ? ` (${r.skipped} skipped)` : ""}`);
    } catch (e) { toast((e as Error).message, "error"); }
  }
  async function assignPhoto() {
    if (!item || !assign) return;
    try {
      const r = await api.post<{ correction_id: number }>(`/api/photos/${item.id}/assign`, { number: assign });
      setAssign(""); bump(); undoable(r.correction_id, `Assigned to #${assign}`);
    } catch (e) { toast((e as Error).message, "error"); }
  }

  if (!item) return null;
  const q = detail?.quality;
  const src = full ? img.full(item.id) : img.preview(item.id);

  return (
    <div className="fixed inset-0 z-40 flex bg-black" role="dialog" aria-modal="true" aria-label={`Viewing ${item.filename}`}>
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-ink-700 bg-ink-900/95 px-4 py-2 text-sm">
          <button className="btn btn-ghost !px-2" onClick={onClose} aria-label="Close viewer">✕ <span className="kbd">Esc</span></button>
          <div className="min-w-0 flex-1 truncate font-medium text-zinc-100">{item.filename} <span className="ml-2 text-xs text-zinc-500">{index + 1} / {items.length}</span></div>
          <FocusChip value={detail?.classification ?? item.classification} />
          {item.keeper && <span className="chip bg-accent text-ink-950">★ Keeper</span>}
          <div className="hidden items-center gap-1 md:flex">
            <button className="btn !px-2" onClick={() => zoomBy(0.8)} aria-label="Zoom out">−</button>
            <span className="w-12 text-center font-mono text-xs text-zinc-400">{Math.round(zoom * 100)}%</span>
            <button className="btn !px-2" onClick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
            <button className="btn" onClick={() => setFull((v) => !v)} aria-pressed={full} title="Load the full-resolution file (F)">{full ? "Full-res" : "Preview"}</button>
            <button className="btn" onClick={() => setBoxes((v) => !v)} aria-pressed={boxes} title="Toggle player boxes (B)">Boxes</button>
            <button className="btn" onClick={() => setPanel((v) => !v)} aria-pressed={panel} title="Toggle analysis panel (I)">Info</button>
          </div>
        </div>
        <div ref={box} className="relative flex flex-1 items-center justify-center overflow-hidden"
          onWheel={onWheel} onDoubleClick={() => { if (zoom > 1) { setZoom(1); setOff({ x: 0, y: 0 }); } else setZoom(2.5); }}
          onPointerDown={(e) => { if (zoom > 1) { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y }; } }}
          onPointerMove={(e) => { if (drag.current) setOff({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y }); }}
          onPointerUp={() => { drag.current = null; }} style={{ cursor: zoom > 1 ? "grab" : "default", touchAction: "none" }}>
          <div className="relative" style={{ transform: `translate(${off.x}px, ${off.y}px) scale(${zoom})`, transformOrigin: "center", maxWidth: "100%", maxHeight: "100%" }}>
            <img key={src} src={src} alt={item.filename} draggable={false} className="block max-h-[calc(100vh-110px)] max-w-full select-none object-contain" />
            {boxes && detail?.players_detail.filter((p) => p.bw > 0).map((p) => (
              <div key={p.id} className={`pointer-events-none absolute border-2 ${p.status === "confirmed" ? "border-sky-400" : p.status === "auto" ? "border-emerald-400" : p.status === "needs_review" ? "border-amber-400" : "border-zinc-400"}`}
                style={{ left: `${p.bx * 100}%`, top: `${p.by * 100}%`, width: `${p.bw * 100}%`, height: `${p.bh * 100}%` }}>
                <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-black/80 px-1 text-[11px] font-semibold text-white" style={{ transform: `scale(${1 / zoom})`, transformOrigin: "left bottom" }}>{p.number ? `#${p.number}${roster[p.number] ? " " + roster[p.number] : ""}` : "?"}</span>
              </div>
            ))}
          </div>
          <button className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-3 text-xl text-white hover:bg-black/80 disabled:opacity-20" onClick={prev} disabled={index === 0} aria-label="Previous photo">‹</button>
          <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-3 text-xl text-white hover:bg-black/80 disabled:opacity-20" onClick={next} disabled={index === items.length - 1} aria-label="Next photo">›</button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-ink-700 bg-ink-900/95 px-4 py-2 text-xs text-zinc-400">
          <button className="btn btn-primary" onClick={() => setKeeper(true)}>★ Keep <span className="kbd">K</span></button>
          <button className="btn" onClick={() => setKeeper(false)}>Reject <span className="kbd">X</span></button>
          <button className="btn" onClick={() => setKeeper(null)}>Auto <span className="kbd">U</span></button>
          <button className="btn" onClick={markReviewed}>Mark reviewed <span className="kbd">R</span></button>
          <span className="ml-auto hidden lg:inline"><span className="kbd">←</span> <span className="kbd">→</span> navigate · <span className="kbd">wheel</span>/<span className="kbd">+</span><span className="kbd">−</span> zoom · <span className="kbd">0</span> fit · <span className="kbd">F</span> full-res · <span className="kbd">B</span> boxes · <span className="kbd">I</span> info</span>
        </div>
      </div>

      {panel && (
        <aside className="w-[340px] shrink-0 overflow-y-auto border-l border-ink-700 bg-ink-900 p-4 text-sm" aria-label="Analysis">
          {!detail || !q ? (
            <div className="text-zinc-500">{detail ? "This photo has not been analysed yet." : "Loading analysis…"}</div>
          ) : (
            <div className="space-y-5">
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Focus &amp; quality <span className="font-normal normal-case text-zinc-600">(estimates)</span></h3>
                <ul className="mb-3 space-y-1 text-xs text-zinc-300">{(q.reasons ?? []).map((r, i) => <li key={i} className="flex gap-1.5"><span className="text-accent">•</span><span>{r}</span></li>)}</ul>
                <div className="space-y-2">
                  <Meter label={`Sharpness (${q.basis === "subject" ? "player" : "whole frame"})`} value={q.sharpness_score} hint="Edge-width based, 0-100. Measured on the main player crop when one is found." />
                  {q.subject_sharpness != null && <Meter label="Whole-frame sharpness" value={q.global_sharpness} hint="85th percentile over image tiles" />}
                  <Meter label="Motion blur" value={q.motion_blur} invert hint="Directional blur estimate; higher = more blur" />
                  <Meter label="Subject visibility" value={q.subject_visibility} />
                  <Meter label="Exposure" value={q.exposure_score} hint={`Mean luma ${q.mean_luma.toFixed(0)}, highlights clipped ${(q.clip_high * 100).toFixed(1)}%, shadows crushed ${(q.clip_low * 100).toFixed(1)}%`} />
                  <Meter label="Composition" value={q.composition} />
                  <Meter label="Overall" value={q.overall} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-zinc-500">Face / head</dt><dd>{q.face_visible ? `visible (${q.face_count})` : "not detected"}</dd>
                  <dt className="text-zinc-500">Highlights clipped</dt><dd>{(q.clip_high * 100).toFixed(1)}%</dd>
                  <dt className="text-zinc-500">Shadows crushed</dt><dd>{(q.clip_low * 100).toFixed(1)}%</dd>
                  <dt className="text-zinc-500">Resolution</dt><dd>{q.width}×{q.height} ({q.resolution_mp} MP)</dd>
                </dl>
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Players</h3>
                {detail.players_detail.length === 0 && <p className="mb-2 text-xs text-zinc-500">No players detected{detail.quality?.thresholds?.detector === "none" ? " – no detector model is installed (see Settings)." : "."}</p>}
                <div className="space-y-3">
                  {detail.players_detail.map((p) => (
                    <div key={p.id} className="card p-2">
                      <div className="flex gap-2">
                        {p.has_crop && <img src={img.crop(p.id)} alt="" className="h-20 w-14 rounded object-cover" />}
                        <div className="min-w-0 flex-1 text-xs">
                          <div className="flex items-center justify-between"><span className="text-base font-semibold text-zinc-50">{p.number ? `#${p.number}` : "No number"}</span><span className={`chip ${p.status === "confirmed" ? "bg-sky-500/20 text-sky-300" : p.status === "auto" ? "bg-emerald-500/15 text-emerald-300" : p.status === "needs_review" ? "bg-amber-500/15 text-amber-300" : "bg-ink-700 text-zinc-400"}`}>{STATUS_TEXT[p.status]}</span></div>
                          {p.roster_name && <div className="text-zinc-300">{p.roster_name}</div>}
                          <div className="text-zinc-500">Number confidence {(p.number_conf * 100).toFixed(0)}% · detection {(p.det_conf * 100).toFixed(0)}%</div>
                          {p.note && <div className="mt-1 text-zinc-500">{p.note}</div>}
                        </div>
                      </div>
                      <div className="mt-2 flex gap-1.5">
                        <input className="input !py-1" placeholder="Jersey #" inputMode="numeric" maxLength={3} aria-label="Correct jersey number" value={numInputs[p.id] ?? ""}
                          onChange={(e) => setNumInputs({ ...numInputs, [p.id]: e.target.value.replace(/\D/g, "") })}
                          onKeyDown={(e) => { if (e.key === "Enter" && numInputs[p.id]) { void confirmNumber(p.id, numInputs[p.id]); setNumInputs({ ...numInputs, [p.id]: "" }); } }} />
                        <button className="btn" disabled={!numInputs[p.id]} onClick={() => { void confirmNumber(p.id, numInputs[p.id]); setNumInputs({ ...numInputs, [p.id]: "" }); }}>Set</button>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {p.number && p.status !== "confirmed" && <button className="btn !py-1 text-xs" onClick={() => confirmNumber(p.id, p.number)}>✓ Confirm #{p.number}</button>}
                        {p.status === "confirmed" && detail.burst && <button className="btn !py-1 text-xs" onClick={() => applyBurst(p.id)}>Apply to burst</button>}
                        {p.number && <button className="btn !py-1 text-xs" onClick={() => confirmNumber(p.id, null)}>Not this player</button>}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3">
                  <label className="label" htmlFor="assign">Assign photo to a player</label>
                  <div className="flex gap-1.5"><input id="assign" className="input" placeholder="Jersey #" inputMode="numeric" maxLength={3} value={assign} onChange={(e) => setAssign(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") void assignPhoto(); }} /><button className="btn" disabled={!assign} onClick={assignPhoto}>Assign</button></div>
                </div>
              </section>

              {detail.burst && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Burst B{String(detail.burst.seq_no).padStart(4, "0")} <span className="font-normal normal-case text-zinc-600">· {detail.burst.members.length} frames</span></h3>
                  {detail.burst.rank_detail && (
                    <div className="mb-2 flex flex-wrap gap-1 text-[11px]">
                      {Object.entries(detail.burst.rank_detail).map(([k, v]) => <span key={k} className="chip bg-ink-700 text-zinc-300">{k} {v.toFixed(0)}</span>)}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {detail.burst.members.map((m) => {
                      const at = items.findIndex((x) => x.id === m.id);
                      return (
                        <button key={m.id} disabled={at < 0} onClick={() => at >= 0 && onIndex(at)} title={`${m.filename} · rank ${m.rank}${m.overall != null ? ` · Q${m.overall.toFixed(0)}` : ""}`}
                          className={`relative h-12 w-16 overflow-hidden rounded border ${m.id === item.id ? "border-accent" : "border-ink-600"} ${at < 0 ? "opacity-40" : ""}`}>
                          <img src={img.thumb(m.id)} alt={m.filename} className="h-full w-full object-cover" />
                          <span className="absolute bottom-0 left-0 bg-black/70 px-1 text-[10px] text-white">{m.rank}{m.is_best ? "★" : ""}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">File</h3>
                <dl className="grid grid-cols-[88px_1fr] gap-x-2 gap-y-1 text-xs">
                  <dt className="text-zinc-500">Captured</dt><dd>{fmtTime(detail.capture_time)}</dd>
                  <dt className="text-zinc-500">Camera</dt><dd>{[detail.camera_make, detail.camera_model].filter(Boolean).join(" ") || "–"}</dd>
                  {Object.entries(detail.exif).map(([k, v]) => <><dt key={k} className="text-zinc-500">{k.replace(/_/g, " ")}</dt><dd key={k + "v"}>{String(typeof v === "number" ? +v.toFixed(4) : v)}</dd></>)}
                  <dt className="text-zinc-500">Size</dt><dd>{detail.file_size ? fmtBytes(detail.file_size) : "–"}</dd>
                  <dt className="text-zinc-500">Original</dt><dd className="break-all font-mono text-[11px] text-zinc-400">{detail.original_path}</dd>
                  {detail.moved_to && <><dt className="text-zinc-500">Moved to</dt><dd className="break-all font-mono text-[11px] text-zinc-400">{detail.moved_to}</dd></>}
                </dl>
              </section>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
