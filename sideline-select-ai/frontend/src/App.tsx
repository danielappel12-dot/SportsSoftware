import { Component, type ReactNode } from "react";
import { Route, Routes } from "react-router-dom";
import Shell from "./components/Shell";
import Bursts from "./pages/Bursts";
import Dashboard from "./pages/Dashboard";
import ExportPage from "./pages/Export";
import ImportPage from "./pages/Import";
import Photos from "./pages/Photos";
import Players from "./pages/Players";
import SettingsPage from "./pages/Settings";
import { Empty } from "./components/ui";
import { useApp } from "./store";

class Boundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (this.state.err) return <Empty title="Something went wrong in the interface" icon="⚠">{this.state.err.message}<br /><button className="btn mt-3" onClick={() => this.setState({ err: null })}>Try again</button></Empty>;
    return this.props.children;
  }
}

export default function App() {
  const { project, projects } = useApp();
  return (
    <Shell>
      <Boundary>
        {!project && projects.length === 0 ? <Welcome /> : (
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/photos" element={<Photos title="All Photos" view="all" subtitle="Every analysed photo in this project." />} />
            <Route path="/players" element={<Players />} />
            <Route path="/bursts" element={<Bursts />} />
            <Route path="/in-focus" element={<Photos title="In Focus" view="in_focus" subtitle="Likely sharp enough to keep (an estimate, not a guarantee)." emptyHint="Nothing is classified In Focus yet – analysis may still be running, or thresholds may be strict." />} />
            <Route path="/out-of-focus" element={<Photos title="Out of Focus" view="out_of_focus" subtitle="Likely blurry or unusable. Nothing is deleted – check borderline frames before discarding." />} />
            <Route path="/needs-review" element={<Photos title="Needs Review" view="needs_review" subtitle="Borderline focus, or no jersey number could be read confidently." emptyHint="Nothing needs review – nice." />} />
            <Route path="/best" element={<Photos title="Best Frames" view="best" subtitle="Your keepers plus automatic best-of-burst suggestions (reversible)." emptyHint="No keepers yet. Mark frames with ★ Keep, or let the automatic best-of-burst picks appear after analysis." />} />
            <Route path="/export" element={<ExportPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Empty title="Page not found" />} />
          </Routes>
        )}
      </Boundary>
    </Shell>
  );
}

function Welcome() {
  const { reloadProjects, setProjectId, toast } = useApp();
  async function demo() {
    try {
      const r = await fetch("/api/projects/demo", { method: "POST" }).then((x) => x.json());
      await reloadProjects(); setProjectId(r.project.id); toast("Demo project created – analysing synthetic sample photos…", "success");
    } catch (e) { toast((e as Error).message, "error"); }
  }
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <h1 className="text-3xl font-semibold text-zinc-50">Welcome to Sideline Select <span className="text-accent">AI</span></h1>
      <p className="mt-3 text-zinc-400">Cull game-day photos locally: find jersey numbers, separate sharp from blurry, group bursts and export a tidy folder structure. Nothing is uploaded anywhere.</p>
      <div className="mt-8 flex flex-col items-center gap-3">
        <p className="text-sm text-zinc-500">Create a project with “+ New” in the sidebar, or try the app with clearly-labelled synthetic sample images:</p>
        <button className="btn btn-primary" onClick={demo}>Create demo project</button>
      </div>
    </div>
  );
}
