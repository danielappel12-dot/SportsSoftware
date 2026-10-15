import { useEffect, useState } from "react";
import { api, qs, type BrowseResult } from "../api";
import { Modal, Spinner } from "./ui";

/** Server-side folder picker (restricted to the allowed roots). Used for importing in place and choosing export folders. */
export function BrowseModal({ title, actionLabel, start, onPick, onClose }: { title: string; actionLabel: string; start?: string; onPick: (path: string) => void; onClose: () => void }) {
  const [path, setPath] = useState<string | undefined>(start || undefined);
  const [data, setData] = useState<BrowseResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setData(null); setErr(null);
    api.get<BrowseResult>(`/api/fs/browse${qs({ path })}`).then(setData).catch((e: Error) => { setErr(e.message); if (path) setPath(undefined); });
  }, [path]);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="mb-3 break-all rounded bg-ink-900 px-3 py-2 font-mono text-xs text-zinc-300">{data?.path ?? "Allowed locations"}</div>
      {err && <div className="mb-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}
      {!data && !err && <Spinner />}
      {data && (
        <>
          <ul className="mb-3 max-h-80 overflow-auto rounded border border-ink-700">
            {data.path && <li><button className="w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-ink-800" onClick={() => setPath(data.parent ?? undefined)}>⬑ Up</button></li>}
            {data.dirs.map((d) => <li key={d.path}><button className="w-full truncate px-3 py-2 text-left text-sm hover:bg-ink-800" onClick={() => setPath(d.path)}>📁 {d.name}</button></li>)}
            {data.dirs.length === 0 && <li className="px-3 py-3 text-sm text-zinc-500">No sub-folders.</li>}
          </ul>
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">{data.path ? `${data.image_count} supported image(s) directly in this folder` : "Pick a location to start"}</span>
            <button className="btn btn-primary" disabled={!data.path} onClick={() => data.path && onPick(data.path)}>{actionLabel}</button>
          </div>
        </>
      )}
    </Modal>
  );
}
