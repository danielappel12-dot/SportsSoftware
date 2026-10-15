import Link from "next/link";
import { Plus, Trophy } from "lucide-react";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Progress, StatusBadge } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { MANAGER_ROLES } from "@/lib/constants";
import { canSee, getCtx, getOrgData } from "@/lib/data";
import type { GameEvent, OrgData } from "@/lib/types";

export const metadata = { title: "Game Day" };

function EventCard({ e, data }: { e: GameEvent; data: OrgData }) {
  const tasks = data.tasks.filter((t) => t.event_id === e.id);
  const done = tasks.filter((t) => t.status === "done").length;
  const blocked = tasks.filter((t) => t.status === "blocked").length;
  const acts = data.activations.filter((a) => a.event_id === e.id);
  return (
    <Link href={`/game-day/${e.id}`} className="card block p-4 transition hover:border-ink-600">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><p className="truncate font-medium">{e.name}</p><p className="text-xs text-ink-400"><LocalTime iso={e.starts_at} /> · {e.venue ?? "Venue TBD"}</p></div>
        <StatusBadge status={e.status} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Progress value={tasks.length ? (done / tasks.length) * 100 : 0} tone="ok" className="flex-1" />
        <span className="text-xs tabular-nums text-ink-300">{done}/{tasks.length}</span>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-400">{acts.length} activation{acts.length === 1 ? "" : "s"} · {tasks.length - done} tasks left{blocked > 0 && <Badge tone="block">{blocked} blocked</Badge>}</p>
    </Link>
  );
}

export default async function GameDayPage() {
  const [ctx, data] = await Promise.all([getCtx(), getOrgData()]);
  const cutoff = new Date(Date.now() - 6 * 3600_000).toISOString();
  const upcoming = data.events.filter((e) => e.starts_at >= cutoff && e.status !== "completed" && e.status !== "canceled");
  const past = data.events.filter((e) => !upcoming.includes(e)).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  return (
    <>
      <PageHeader title="Game Day Command Center" description="Plan activations, run the show, and capture proof of fulfillment — built for the concourse."
        actions={canSee(ctx, MANAGER_ROLES) && <LinkButton href="/game-day/new" variant="primary"><Plus className="size-4" /> New game</LinkButton>} />
      <h2 className="label-caps mb-2">Upcoming & live</h2>
      {upcoming.length === 0 ? <Card><EmptyState icon={<Trophy className="size-5" />} title="No upcoming games" description="Create a game, attach sponsor activations, and build the run-of-show." /></Card>
        : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{upcoming.map((e) => <EventCard key={e.id} e={e} data={data} />)}</div>}
      {past.length > 0 && (<><h2 className="label-caps mb-2 mt-8">Past & canceled</h2><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{past.map((e) => <EventCard key={e.id} e={e} data={data} />)}</div></>)}
    </>
  );
}
