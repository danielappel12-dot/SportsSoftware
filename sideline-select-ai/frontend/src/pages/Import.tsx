import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { BrowseModal } from "../components/BrowseModal";
import { JobPanel } from "../components/JobPanel";
import { Empty } from "../components/ui";
import { useApp } from "../store";

interface Problem { id: number; filename: string; status: string; status_detail: string; original_path: string }
const OK_EXT = /\.(jpe?g|png|tiff?|bmp|webp|cr2|cr3|nef|nrw|arw|dng|raf|orf|rw2|pef|srw)$/i;

// Walk dropped folders using the (webkit) entries API so a whole card/folder can be dropped.
async function collect(items: DataTransferItemList): Promise<File[]> {
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      await new Promise<void>((res) => (entry as FileSystemFileEntry).file((f) => { out.push(f); res(); }, () => res()));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res) => reader.readEntries(res, () => res([])));
        if (!batch.length) break;
        for (const e of batch) await walk(e);
      }
    }
  };
  const entries = [...items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  for (const e of entries) await walk(e);
  return out;
}

export default function ImportPage() {
  const { project, stats, version, bump, toast, system } = useApp();
  const [problems, setProblems] = useState<Problem[]>([]);
  const [over, setOver] = useState(false);
  const [upload, setUpload] = useState<{ done: number; total: number; note: string } | null>(null);
  const [browse, setBrowse] = useState(false);
  const [pathText, setPathText] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (project) api.get<Problem[]>(`/api/projects/${project.id}/problems`).then(setProblems).catch(() => undefined);
  }, [project, version]);

  const send = useCallback(async (files: File[]) => {
    if (!project) return;
    const ok = files.filter((f) => OK_EXT.test(f.name));
    const ignored = files.length - ok.length;
    if (!ok.length) { toast(`No supported image files found${ignored ? ` (${ignored} other file(s) ignored)` : ""}.`, "error"); return; }
    const BATCH = 8;
    let done = 0, saved = 0;
    const notes: string[] = [];
    setUpload({ done: 0, total: ok.length, note: "" });
    try {
      for (let i = 0; i < ok.length; i += BATCH) {
        const form = new FormData();
        ok.slice(i, i + BATCH).forEach((f) => form.append("files", f, f.name));
        const r = await api.upload<{ saved: number; rejected: string[] }>(`/api/projects/${project.id}/upload?start=${i + BATCH >= ok.length}`, form);
        saved += r.saved; notes.push(...r.rejected); done += Math.min(BATCH, ok.length - i);
        setUpload({ done, total: ok.length, note: "" });
      }
      toast(`Uploaded ${saved} photo(s)${ignored ? `, ignored ${ignored} unsupported file(s)` : ""}. Analysis started.`, "success");
      if (notes.length) toast(notes.slice(0, 3).join(" · "), "info");
    } catch (e) { toast((e as Error).message, "error"); } finally { setUpload(null); bump(); }
  }, [project, toast, bump]);

  async function importPath(p: string) {
    if (!project) return;
    try {
      const r = await api.post<{ found: number; added: number; already_imported: number; messages: string[] }>(`/api/projects/${project.id}/import`, { paths: [p] });
      toast(`Found ${r.found} image(s): ${r.added} new, ${r.already_imported} already imported.`, "success");
      r.messages.slice(0, 2).forEach((m) => toast(m, "info"));
      bump();
    } catch (e) { toast((e as Error).message, "error"); }
  }

  if (!project) return <Empty title="Create a project first" />;
  const raw = system?.raw;
  const busy = !!stats?.job && ["queued", "running", "paused", "cancelling"].includes(stats.job.status);
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
      <header><h1 className="text-2xl font-semibold text-zinc-50">Import photos</h1>
        <p className="text-sm text-zinc-400">Originals are only read, never modified. Files already imported are recognised by path and by content, and are not processed twice.</p></header>

      <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={async (e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.items?.length ? await collect(e.dataTransfer.items) : [...e.dataTransfer.files]; void send(f); }}
        className={`card flex flex-col items-center gap-3 border-2 border-dashed px-6 py-10 text-center transition ${over ? "border-accent bg-accent/5" : "border-ink-600"}`} aria-label="Drop zone">
        <div className="text-4xl text-accent" aria-hidden>⇪</div>
        <div className="text-lg font-medium text-zinc-100">Drag &amp; drop photos or folders here</div>
        <div className="max-w-xl text-sm text-zinc-400">JPEG, PNG, TIFF, WebP{raw?.ok ? " and camera RAW (CR2/CR3/NEF/ARW/DNG/RAF/ORF/RW2)" : ""}. Dropped files are copied into the project cache (a working copy; your originals stay where they are).</div>
        {raw && !raw.ok && <div className="max-w-xl rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">RAW decoding is not available on this install – RAW files will be listed below with an explanation instead of being silently ignored. {raw.message}</div>}
        <div className="flex flex-wrap justify-center gap-2">
          <button className="btn" onClick={() => fileInput.current?.click()}>Choose files…</button>
          <button className="btn" onClick={() => folderInput.current?.click()}>Choose folder (upload copy)…</button>
          <button className="btn btn-primary" onClick={() => setBrowse(true)}>Import a folder in place…</button>
        </div>
        <input ref={fileInput} type="file" multiple hidden accept="image/*,.cr2,.cr3,.nef,.nrw,.arw,.dng,.raf,.orf,.rw2,.pef,.srw,.tif,.tiff" onChange={(e) => { if (e.target.files) void send([...e.target.files]); e.target.value = ""; }} />
        <input ref={folderInput} type="file" multiple hidden {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => { if (e.target.files) void send([...e.target.files]); e.target.value = ""; }} />
        <form className="flex w-full max-w-xl gap-2" onSubmit={(e) => { e.preventDefault(); if (pathText.trim()) void importPath(pathText.trim()); }}>
          <input className="input" placeholder="…or paste a folder path, e.g. /Users/me/Pictures/Game6" aria-label="Folder path" value={pathText} onChange={(e) => setPathText(e.target.value)} />
          <button className="btn" disabled={!pathText.trim()}>Import</button>
        </form>
        {upload && <div className="w-full max-w-xl text-sm text-zinc-300">Uploading {upload.done} / {upload.total}…<div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-700"><div className="h-full bg-accent" style={{ width: `${(100 * upload.done) / upload.total}%` }} /></div></div>}
      </div>

      <section aria-label="Processing">
        <h2 className="mb-2 text-sm font-semibold text-zinc-300">Processing</h2>
        <JobPanel job={stats?.job ?? null} />
        {stats && stats.total > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-3 text-center text-xs md:grid-cols-4">
            {[["Total files", stats.total], ["Completed", stats.analyzed], ["Skipped (duplicates)", stats.skipped], ["Unreadable", stats.errors]].map(([l, v]) => (
              <div key={l} className="card p-3"><div className="text-xl font-semibold tabular-nums text-zinc-50">{v}</div><div className="text-zinc-500">{l}</div></div>
            ))}
          </div>
        )}
        {stats && stats.pending > 0 && !busy && (
          <button className="btn btn-primary mt-3" onClick={async () => { try { await api.post(`/api/projects/${project.id}/process`); bump(); } catch (e) { toast((e as Error).message, "error"); } }}>Process {stats.pending} waiting photo(s)</button>
        )}
      </section>

      {problems.length > 0 && (
        <section aria-label="Skipped and failed files">
          <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold text-zinc-300">Skipped &amp; unreadable files ({problems.length})</h2>
            {problems.some((p) => p.status === "error") && <button className="btn text-xs" onClick={async () => { const r = await api.post<{ requeued: number }>(`/api/projects/${project.id}/problems/retry`); toast(`${r.requeued} file(s) queued to retry`, "info"); bump(); }}>Retry unreadable</button>}
          </div>
          <div className="card max-h-80 divide-y divide-ink-700 overflow-auto">
            {problems.map((p) => (
              <div key={p.id} className="flex gap-3 px-3 py-2 text-sm">
                <span className={`chip mt-0.5 shrink-0 ${p.status === "error" ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-300"}`}>{p.status === "error" ? "Unreadable" : "Skipped"}</span>
                <div className="min-w-0"><div className="truncate font-medium text-zinc-100" title={p.original_path}>{p.filename}</div><div className="text-xs text-zinc-400">{p.status_detail}</div></div>
              </div>
            ))}
          </div>
        </section>
      )}
      {browse && <BrowseModal title="Import a folder in place" actionLabel="Import this folder" onClose={() => setBrowse(false)} onPick={(p) => { setBrowse(false); void importPath(p); }} />}
    </div>
  );
}
