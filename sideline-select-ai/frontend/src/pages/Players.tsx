import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, img, type PlayerRow } from "../api";
import { Empty } from "../components/ui";
import { useApp } from "../store";

interface RosterRow { number: string; name: string; team: string | null }

export default function Players() {
  const { project, version, bump, toast } = useApp();
  const nav = useNavigate();
  const [rows, setRows] = useState<PlayerRow[]>([]);
  const [unknown, setUnknown] = useState(0);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [num, setNum] = useState("");
  const [name, setName] = useState("");
  const [team, setTeam] = useState("");
  const [csv, setCsv] = useState("");
  const [showCsv, setShowCsv] = useState(false);

  useEffect(() => {
    if (!project) return;
    api.get<{ players: PlayerRow[]; unknown_photos: number }>(`/api/projects/${project.id}/players`).then((r) => { setRows(r.players); setUnknown(r.unknown_photos); }).catch(() => undefined);
    api.get<RosterRow[]>(`/api/projects/${project.id}/roster`).then(setRoster).catch(() => undefined);
  }, [project, version]);
  if (!project) return <Empty title="No project selected" />;

  async function add() {
    try { await api.post(`/api/projects/${project!.id}/roster`, { number: num, name, team: team || null }); setNum(""); setName(""); bump(); } catch (e) { toast((e as Error).message, "error"); }
  }
  async function remove(n: string) { await api.del(`/api/projects/${project!.id}/roster/${encodeURIComponent(n)}`); bump(); }
  async function importCsv() {
    try {
      const r = await api.post<{ imported: number; ignored: string[] }>(`/api/projects/${project!.id}/roster/import`, { csv_text: csv });
      toast(`Imported ${r.imported} roster entr${r.imported === 1 ? "y" : "ies"}${r.ignored.length ? `; ignored ${r.ignored.length} invalid line(s)` : ""}`, r.imported ? "success" : "error");
      setCsv(""); setShowCsv(false); bump();
    } catch (e) { toast((e as Error).message, "error"); }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-6 py-6 lg:grid-cols-[1fr_320px]">
      <section>
        <h1 className="text-2xl font-semibold text-zinc-50">Players</h1>
        <p className="mb-4 text-sm text-zinc-400">Grouped by jersey number (confident reads and your confirmations only). The roster is optional – number-based organisation works without it.</p>
        {rows.length === 0 && unknown === 0 ? <div className="card"><Empty title="No players yet" icon="◉">Players appear after analysis. If none ever appear, check Settings → Recognition models.</Empty></div> : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {rows.map((p) => (
              <button key={p.number} className="card overflow-hidden text-left transition hover:border-accent/60" onClick={() => nav(`/photos?number=${p.number}`)}>
                <div className="relative h-32 bg-ink-900">{p.cover_photo ? <img src={img.thumb(p.cover_photo)} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-ink-500">no photos</div>}
                  <span className="absolute left-2 top-2 rounded-md bg-black/75 px-2 py-0.5 text-lg font-bold text-accent">#{p.number}</span></div>
                <div className="p-3"><div className="truncate text-sm font-medium text-zinc-100">{p.name ?? "No roster name"}</div><div className="text-xs text-zinc-500">{p.photos} photo{p.photos === 1 ? "" : "s"}{p.confirmed ? ` · ${p.confirmed} confirmed` : ""}{p.team ? ` · ${p.team}` : ""}</div></div>
              </button>
            ))}
            <button className="card flex flex-col items-center justify-center gap-1 p-6 text-center hover:border-accent/60" onClick={() => nav("/photos?number=unknown")}>
              <span className="text-3xl text-ink-500">?</span><span className="text-sm font-medium text-zinc-100">Unknown Player</span><span className="text-xs text-zinc-500">{unknown} photo{unknown === 1 ? "" : "s"} without a confident number</span>
            </button>
          </div>
        )}
      </section>
      <aside className="space-y-3">
        <div className="card p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-200">Roster <span className="font-normal text-zinc-500">(optional)</span></h2>
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (num && name) void add(); }}>
            <div className="flex gap-2"><input className="input !w-20" placeholder="#" aria-label="Jersey number" inputMode="numeric" maxLength={3} value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, ""))} /><input className="input" placeholder="Player name" aria-label="Player name" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <input className="input" placeholder="Team (optional)" aria-label="Team" value={team} onChange={(e) => setTeam(e.target.value)} />
            <button className="btn btn-primary w-full" disabled={!num || !name}>Add / update</button>
          </form>
          <button className="btn btn-ghost mt-2 w-full text-xs" onClick={() => setShowCsv((v) => !v)}>Paste CSV (number,name,team)…</button>
          {showCsv && <div className="mt-2 space-y-2"><textarea className="input h-28 font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"7,Sam Rivera,Home\n12,Alex Kim,Home"} /><button className="btn w-full" disabled={!csv.trim()} onClick={importCsv}>Import</button></div>}
        </div>
        <div className="card divide-y divide-ink-700">
          {roster.length === 0 && <div className="p-4 text-xs text-zinc-500">No roster entries.</div>}
          {roster.map((r) => (
            <div key={r.number} className="flex items-center justify-between px-3 py-2 text-sm"><span><b className="text-accent">#{r.number}</b> {r.name}{r.team ? <span className="text-zinc-500"> · {r.team}</span> : null}</span><button className="text-zinc-500 hover:text-red-400" onClick={() => remove(r.number)} aria-label={`Remove ${r.name}`}>✕</button></div>
          ))}
        </div>
      </aside>
    </div>
  );
}
