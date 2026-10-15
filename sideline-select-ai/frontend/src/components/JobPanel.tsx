import { api, type Job } from "../api";
import { useApp } from "../store";
import { ProgressBar } from "./ui";

const LABEL: Record<string, string> = { queued: "Queued", running: "Processing", paused: "Paused", cancelling: "Cancelling…", cancelled: "Cancelled", completed: "Completed", failed: "Failed", interrupted: "Interrupted" };

export function JobPanel({ job }: { job: Job | null }) {
  const { toast, bump } = useApp();
  if (!job) return <div className="card p-4 text-sm text-zinc-400">No processing has run for this project yet.</div>;
  const act = async (a: "pause" | "resume" | "cancel") => {
    try { await api.post(`/api/jobs/${job.id}/${a}`); bump(); } catch (e) { toast((e as Error).message, "error"); }
  };
  const live = ["queued", "running", "paused", "cancelling"].includes(job.status);
  const resumable = ["interrupted", "cancelled", "failed"].includes(job.status);
  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`chip ${job.status === "completed" ? "bg-emerald-500/15 text-emerald-300" : job.status === "failed" ? "bg-red-500/15 text-red-300" : "bg-accent/15 text-accent"}`}>{LABEL[job.status] ?? job.status}</span>
          {job.phase && <span className="text-xs text-zinc-400">{job.phase === "grouping" ? "Grouping bursts" : "Analysing photos"}</span>}
        </div>
        <div className="flex gap-2">
          {job.status === "running" && <button className="btn" onClick={() => act("pause")}>Pause</button>}
          {(job.status === "paused" || resumable) && <button className="btn btn-primary" onClick={() => act("resume")}>Resume</button>}
          {live && <button className="btn btn-danger" onClick={() => act("cancel")}>Cancel</button>}
        </div>
      </div>
      <ProgressBar value={job.progress} />
      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        <div><div className="text-lg font-semibold tabular-nums text-zinc-100">{job.total}</div><div className="text-zinc-500">in this run</div></div>
        <div><div className="text-lg font-semibold tabular-nums text-emerald-300">{job.done}</div><div className="text-zinc-500">completed</div></div>
        <div><div className="text-lg font-semibold tabular-nums text-amber-300">{job.skipped}</div><div className="text-zinc-500">skipped</div></div>
        <div><div className="text-lg font-semibold tabular-nums text-red-300">{job.failed}</div><div className="text-zinc-500">failed</div></div>
      </div>
      {job.message && <div className="text-xs text-zinc-400">{job.message}</div>}
      {job.error && <div className="rounded bg-red-500/10 p-2 font-mono text-xs text-red-300">{job.error}</div>}
    </div>
  );
}
