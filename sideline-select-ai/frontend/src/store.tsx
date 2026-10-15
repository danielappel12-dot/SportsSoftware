import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type Project, type Stats, type SystemStatus } from "./api";

interface Toast { id: number; kind: "info" | "error" | "success"; text: string; undo?: () => void }

interface Ctx {
  projects: Project[];
  project: Project | null;
  setProjectId: (id: number | null) => void;
  reloadProjects: () => Promise<void>;
  stats: Stats | null;
  reloadStats: () => Promise<void>;
  /** bumps whenever data changed (job progress, corrections) so lists can refetch */
  version: number;
  bump: () => void;
  system: SystemStatus | null;
  toasts: Toast[];
  toast: (text: string, kind?: Toast["kind"], undo?: () => void) => void;
  dismiss: (id: number) => void;
}

const C = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(C);

export function AppProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setPid] = useState<number | null>(() => {
    try { const v = localStorage.getItem("sideline.project"); return v ? Number(v) : null; } catch { return null; }
  });
  const [stats, setStats] = useState<Stats | null>(null);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((text: string, kind: Toast["kind"] = "info", undo?: () => void) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, text, undo }]);
    window.setTimeout(() => dismiss(id), undo ? 9000 : kind === "error" ? 8000 : 4000);
  }, [dismiss]);

  const reloadProjects = useCallback(async () => {
    try { setProjects(await api.get<Project[]>("/api/projects")); } catch (e) { toast(String((e as Error).message), "error"); }
  }, [toast]);

  const setProjectId = useCallback((id: number | null) => {
    setPid(id);
    try { id === null ? localStorage.removeItem("sideline.project") : localStorage.setItem("sideline.project", String(id)); } catch { /* storage unavailable */ }
    setStats(null);
  }, []);

  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId]);

  useEffect(() => { void reloadProjects(); }, [reloadProjects]);
  useEffect(() => {
    if (projects.length && !project) setProjectId(projects[0].id);
  }, [projects, project, setProjectId]);

  const reloadStats = useCallback(async () => {
    if (!projectId) return;
    try { setStats(await api.get<Stats>(`/api/projects/${projectId}/stats`)); } catch { /* project may have been deleted */ }
  }, [projectId]);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // Poll stats; faster while a job is active, and bump `version` when the job's counters move.
  const lastSig = useRef("");
  useEffect(() => {
    if (!projectId) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await api.get<Stats>(`/api/projects/${projectId}/stats`);
        if (stop) return;
        setStats(s);
        const sig = `${s.analyzed}/${s.skipped}/${s.errors}/${s.job?.status}/${s.bursts}`;
        if (sig !== lastSig.current) { lastSig.current = sig; setVersion((v) => v + 1); }
        const active = s.job && ["queued", "running", "cancelling"].includes(s.job.status);
        timer = window.setTimeout(tick, active ? 1200 : 6000);
      } catch { timer = window.setTimeout(tick, 8000); }
    };
    let timer = window.setTimeout(tick, 0);
    return () => { stop = true; window.clearTimeout(timer); };
  }, [projectId]);

  useEffect(() => {
    api.get<SystemStatus>(`/api/system/status${projectId ? `?project_id=${projectId}` : ""}`).then(setSystem).catch(() => undefined);
  }, [projectId, version]);

  const value = useMemo<Ctx>(() => ({ projects, project, setProjectId, reloadProjects, stats, reloadStats, version, bump, system, toasts, toast, dismiss }),
    [projects, project, setProjectId, reloadProjects, stats, reloadStats, version, bump, system, toasts, toast, dismiss]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
