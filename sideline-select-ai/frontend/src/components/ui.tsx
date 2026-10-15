import { useEffect, type ReactNode } from "react";
import type { Focus } from "../api";
import { useApp } from "../store";

export const FOCUS_LABEL: Record<Focus, string> = { in_focus: "In Focus", review: "Review", out_of_focus: "Out of Focus" };
export const FOCUS_STYLE: Record<Focus, string> = {
  in_focus: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40",
  review: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40",
  out_of_focus: "bg-red-500/15 text-red-300 ring-1 ring-red-500/40",
};

export function FocusChip({ value }: { value: Focus | null }) {
  if (!value) return <span className="chip bg-ink-700 text-zinc-400">Pending</span>;
  return <span className={`chip ${FOCUS_STYLE[value]}`}>{FOCUS_LABEL[value]}</span>;
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-accent ${className}`} role="status" aria-label="Loading" />;
}

export function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-ink-700 ${className}`} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-gradient-to-r from-accent-dim to-accent transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Meter({ label, value, invert = false, hint }: { label: string; value: number | null | undefined; invert?: boolean; hint?: string }) {
  const v = value ?? 0;
  const good = invert ? 100 - v : v;
  const color = good >= 65 ? "bg-emerald-500" : good >= 35 ? "bg-amber-500" : "bg-red-500";
  return (
    <div title={hint}>
      <div className="mb-0.5 flex justify-between text-xs"><span className="text-zinc-400">{label}</span><span className="font-mono text-zinc-200">{value == null ? "–" : v.toFixed(0)}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-700"><div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, v))}%` }} /></div>
    </div>
  );
}

export function Empty({ title, children, icon = "◌" }: { title: string; children?: ReactNode; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="text-4xl text-ink-500" aria-hidden>{icon}</div>
      <h3 className="text-base font-semibold text-zinc-200">{title}</h3>
      <div className="max-w-md text-sm text-zinc-400">{children}</div>
    </div>
  );
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`card flex max-h-[90vh] w-full flex-col shadow-2xl ${wide ? "max-w-5xl" : "max-w-xl"}`}>
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          <button className="btn btn-ghost !px-2" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useApp();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`pointer-events-auto card flex items-start gap-3 px-3 py-2 text-sm shadow-xl ${t.kind === "error" ? "border-red-500/60" : t.kind === "success" ? "border-emerald-500/50" : ""}`}>
          <span className={t.kind === "error" ? "text-red-400" : t.kind === "success" ? "text-emerald-400" : "text-accent"}>{t.kind === "error" ? "⚠" : t.kind === "success" ? "✓" : "ℹ"}</span>
          <span className="flex-1 text-zinc-200">{t.text}</span>
          {t.undo && <button className="font-semibold text-accent hover:underline" onClick={() => { t.undo?.(); dismiss(t.id); }}>Undo</button>}
          <button className="text-zinc-500 hover:text-zinc-200" onClick={() => dismiss(t.id)} aria-label="Dismiss">✕</button>
        </div>
      ))}
    </div>
  );
}

export function StatCard({ label, value, sub, accent = false, onClick }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean; onClick?: () => void }) {
  const inner = (
    <>
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">{label}</div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums ${accent ? "text-accent" : "text-zinc-50"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </>
  );
  return onClick ? <button onClick={onClick} className="card p-4 text-left transition hover:border-accent/60">{inner}</button> : <div className="card p-4">{inner}</div>;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${u[i]}`;
}

export function fmtTime(t: string | null): string {
  if (!t) return "–";
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? t : d.toLocaleString([], { dateStyle: "medium", timeStyle: "medium" });
}

export function playerLabel(p: { number: string; status: string }, roster?: Record<string, string>): string {
  const name = roster?.[p.number];
  return name ? `#${p.number} ${name}` : `#${p.number}`;
}
