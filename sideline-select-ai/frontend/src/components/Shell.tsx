import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { api, type Project } from "../api";
import { useApp } from "../store";
import { Modal, Toasts } from "./ui";

const NAV: { to: string; label: string; icon: string; stat?: "needs_review" | "blurry" | "keepers" | "bursts" | "players" }[] = [
  { to: "/", label: "Dashboard", icon: "◧" },
  { to: "/import", label: "Import Photos", icon: "⇪" },
  { to: "/photos", label: "All Photos", icon: "▦" },
  { to: "/players", label: "Players", icon: "◉", stat: "players" },
  { to: "/bursts", label: "Burst Groups", icon: "≣", stat: "bursts" },
  { to: "/in-focus", label: "In Focus", icon: "◎" },
  { to: "/out-of-focus", label: "Out of Focus", icon: "◌", stat: "blurry" },
  { to: "/needs-review", label: "Needs Review", icon: "!", stat: "needs_review" },
  { to: "/best", label: "Best Frames", icon: "★", stat: "keepers" },
  { to: "/export", label: "Export", icon: "⇩" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

function NewProject({ onClose }: { onClose: () => void }) {
  const { reloadProjects, setProjectId, toast } = useApp();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [sport, setSport] = useState("football");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try {
      const p = await api.post<Project>("/api/projects", { name, sport, game_date: date || null });
      await reloadProjects(); setProjectId(p.id); onClose(); nav("/import");
    } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(false); }
  }
  return (
    <Modal title="New project" onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void create(); }}>
        <div><label className="label" htmlFor="pn">Game / assignment name</label><input id="pn" autoFocus className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Raiders vs Hawks – Week 6" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="ps">Sport</label><select id="ps" className="input" value={sport} onChange={(e) => setSport(e.target.value)}>{["football", "basketball", "baseball", "soccer", "hockey", "volleyball", "other"].map((s) => <option key={s}>{s}</option>)}</select></div>
          <div><label className="label" htmlFor="pd">Date</label><input id="pd" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!name.trim() || busy}>Create project</button></div>
      </form>
    </Modal>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const { projects, project, setProjectId, stats, toast, reloadProjects, system } = useApp();
  const [creating, setCreating] = useState(false);
  const [nav_open, setNavOpen] = useState(false);
  const nav = useNavigate();

  async function del() {
    if (!project) return;
    if (!window.confirm(`Delete project “${project.name}” from Sideline Select?\n\nThis removes its analysis data and caches only. Your photo files are never touched.`)) return;
    try { await api.del(`/api/projects/${project.id}`); setProjectId(null); await reloadProjects(); nav("/"); } catch (e) { toast((e as Error).message, "error"); }
  }

  const warn = system && (!system.engines.detector.ok || !system.engines.ocr.ok) && project && !project.is_demo;

  return (
    <div className="flex h-full">
      <aside className={`${nav_open ? "flex" : "hidden"} fixed inset-y-0 left-0 z-30 w-60 shrink-0 flex-col border-r border-ink-700 bg-ink-900 md:static md:flex`}>
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-ink-950" aria-hidden><span className="block h-4 w-4 rounded-full border-[3px] border-ink-950" /></div>
          <div className="leading-tight"><div className="text-sm font-semibold text-zinc-50">Sideline Select</div><div className="text-[11px] font-medium uppercase tracking-widest text-accent">AI culling</div></div>
        </div>
        <div className="px-3 pb-3">
          <label className="label" htmlFor="proj">Project</label>
          <select id="proj" className="input" value={project?.id ?? ""} onChange={(e) => { setProjectId(Number(e.target.value)); nav("/"); }}>
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.is_demo ? "◇ " : ""}{p.name}</option>)}
          </select>
          <div className="mt-2 flex gap-2"><button className="btn flex-1 !py-1 text-xs" onClick={() => setCreating(true)}>+ New</button>{project && <button className="btn btn-ghost !py-1 text-xs" onClick={del} title="Remove this project from the app (files are untouched)">Delete</button>}</div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4" aria-label="Main">
          {NAV.map((n) => {
            const count = n.stat && stats ? (n.stat === "players" ? stats.players : n.stat === "bursts" ? stats.bursts : n.stat === "blurry" ? stats.blurry : n.stat === "needs_review" ? stats.needs_review : stats.keepers) : null;
            return (
              <NavLink key={n.to} to={n.to} end={n.to === "/"} onClick={() => setNavOpen(false)}
                className={({ isActive }) => `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${isActive ? "bg-accent/15 text-accent" : "text-zinc-300 hover:bg-ink-800"}`}>
                <span className="w-4 text-center" aria-hidden>{n.icon}</span><span className="flex-1">{n.label}</span>
                {count != null && count > 0 && <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${n.stat === "needs_review" ? "bg-amber-500/20 text-amber-300" : "bg-ink-700 text-zinc-400"}`}>{count}</span>}
              </NavLink>
            );
          })}
        </nav>
        <div className="border-t border-ink-700 px-4 py-3 text-[11px] text-zinc-500">Local-first · your photos never leave this computer{system && <> · v{system.version}</>}</div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-ink-700 bg-ink-900 px-3 py-2 md:hidden"><button className="btn !px-2" onClick={() => setNavOpen((v) => !v)} aria-label="Menu">☰</button><span className="text-sm font-semibold">Sideline Select</span></div>
        {project?.is_demo ? <div className="border-b border-accent/40 bg-accent/10 px-4 py-1.5 text-center text-xs text-accent">DEMO PROJECT – synthetic cartoon images generated for demonstration. Results say nothing about accuracy on real photographs.</div> : null}
        {warn ? <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-1.5 text-center text-xs text-amber-200">
          {!system!.engines.detector.ok && <>Player detection is off – {system!.engines.detector.message} </>}
          {!system!.engines.ocr.ok && <>Jersey OCR is off – {system!.engines.ocr.message} </>}
          Photos are scored on the whole frame and sent to <b>Needs Review</b>; no players or numbers are guessed. <NavLink to="/settings" className="underline">Setup help</NavLink></div> : null}
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </main>
      {creating && <NewProject onClose={() => setCreating(false)} />}
      <Toasts />
    </div>
  );
}
