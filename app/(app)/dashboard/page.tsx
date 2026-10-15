import Link from "next/link";
import { CalendarClock, Trophy } from "lucide-react";
import { Badge, Card, CardHeader, DueBadge, EmptyState, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { FilterForm } from "@/components/filter-form";
import { ColumnChart, HBarChart, type Datum } from "@/components/charts";
import { DELIVERABLE_CATEGORIES, DELIVERABLE_STATUSES, label } from "@/lib/constants";
import { getCtx, getOrgData, memberName } from "@/lib/data";
import { addDays, daysBetween, fmtDate, fmtMoney, relativeTime, todayISO } from "@/lib/dates";
import { completion, isDueSoon, isOutstanding, isOverdue, pct } from "@/lib/metrics";
import { one, orgLookup, type SP } from "@/lib/view";

export const metadata = { title: "Dashboard" };

const STATUS_COLOR: Record<string, string> = {
  not_started: "#707c88", in_progress: "#3987e5", awaiting_approval: "#f0b84a", blocked: "#e0569a", completed: "#58c08c", not_applicable: "#4d5762",
};
const VERB: Record<string, string> = {
  insert: "created", update: "updated", delete: "deleted", status_completed: "completed", status_blocked: "blocked", status_done: "completed",
  status_in_progress: "started", status_not_started: "reset", status_awaiting_approval: "submitted for approval", status_archived: "archived",
  status_active: "activated", status_prospect: "marked prospect", status_paused: "paused", status_todo: "reopened", status_not_applicable: "marked N/A",
};
const NOUN: Record<string, string> = { sponsors: "sponsor", contracts: "contract", deliverables: "deliverable", events: "game", event_tasks: "task", assets: "asset" };
const LINK: Record<string, string> = { sponsors: "/partners/", deliverables: "/deliverables/", events: "/game-day/", contracts: "/contracts/" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [ctx, data] = await Promise.all([getCtx(), getOrgData()]);
  const today = todayISO();
  const soonEnd = addDays(today, 7);
  const l = orgLookup(data);
  const f = { season: one(sp.season), sponsor: one(sp.sponsor), event: one(sp.event), category: one(sp.category), assignee: one(sp.assignee) };
  const season = data.seasons.find((s) => s.id === f.season);
  const eventsInSeason = season ? new Set(data.events.filter((e) => e.season_id === season.id).map((e) => e.id)) : null;

  const scoped = data.deliverables.filter((d) => {
    if (f.sponsor && d.sponsor_id !== f.sponsor) return false;
    if (f.category && d.category !== f.category) return false;
    if (f.event && d.event_id !== f.event) return false;
    if (f.assignee && (f.assignee === "none" ? d.assigned_to : d.assigned_to !== (f.assignee === "me" ? ctx.userId : f.assignee))) return false;
    if (season) {
      const inSeason = d.event_id ? eventsInSeason!.has(d.event_id) : !!d.due_date && d.due_date >= season.starts_on && d.due_date <= season.ends_on;
      if (!inSeason) return false;
    }
    return true;
  });

  const comp = completion(scoped, l);
  const overdue = scoped.filter((d) => isOverdue(d, l, today)).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  const dueSoon = scoped.filter((d) => isDueSoon(d, l, today, soonEnd)).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  const blocked = scoped.filter((d) => d.status === "blocked");
  const activeSponsors = data.sponsors.filter((s) => s.status === "active" && (!f.sponsor || s.id === f.sponsor)).length;

  const statusData: Datum[] = DELIVERABLE_STATUSES.map((s) => ({ name: label(s), value: scoped.filter((d) => d.status === s).length, color: STATUS_COLOR[s] }));
  const bySponsor: Datum[] = data.sponsors
    .map((s) => ({ s, c: completion(scoped.filter((d) => d.sponsor_id === s.id), l) }))
    .filter((x) => x.c.eligible > 0)
    .sort((a, b) => (a.c.rate ?? 0) - (b.c.rate ?? 0))
    .slice(0, 8)
    .map(({ s, c }) => ({ name: s.name, value: Math.round((c.rate ?? 0) * 100), detail: `${c.completed}/${c.eligible} done` }));
  const weeks: Datum[] = Array.from({ length: 6 }, (_, i) => {
    const start = addDays(today, i * 7), end = addDays(today, i * 7 + 6);
    return { name: `Wk ${i + 1}`, value: scoped.filter((d) => isOutstanding(d, l) && d.due_date && d.due_date >= start && d.due_date <= end).length };
  });
  const lateCount = overdue.length;
  weeks.unshift({ name: "Late", value: lateCount, color: "#ef5d5d" });

  const upcoming = data.events
    .filter((e) => e.status !== "canceled" && e.status !== "completed" && e.starts_at >= new Date(Date.now() - 6 * 3600_000).toISOString())
    .filter((e) => (!season || e.season_id === season.id) && (!f.event || e.id === f.event))
    .filter((e) => !f.sponsor || data.activations.some((a) => a.event_id === e.id && a.sponsor_id === f.sponsor))
    .slice(0, 5);
  const renewals = data.sponsors
    .filter((s) => s.status !== "archived" && s.renewal_date && s.renewal_date >= today && daysBetween(today, s.renewal_date) <= 90 && (!f.sponsor || s.id === f.sponsor))
    .sort((a, b) => a.renewal_date!.localeCompare(b.renewal_date!));
  const activity = data.activity.slice(0, 8);

  const attention = [...blocked.map((d) => ({ d, kind: "blocked" as const })), ...overdue.filter((d) => d.status !== "blocked").map((d) => ({ d, kind: "overdue" as const })), ...dueSoon.filter((d) => d.status !== "blocked").map((d) => ({ d, kind: "soon" as const }))].slice(0, 8);

  return (
    <>
      <PageHeader title="Dashboard" description={`${ctx.orgName} · live figures from your records as of ${fmtDate(today)}`} />
      <div className="mb-5">
        <FilterForm>
          <select name="season" defaultValue={f.season} className="input w-auto" aria-label="Season"><option value="">All seasons</option>{data.seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select name="sponsor" defaultValue={f.sponsor} className="input w-auto" aria-label="Sponsor"><option value="">All sponsors</option>{data.sponsors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select name="event" defaultValue={f.event} className="input w-auto" aria-label="Event"><option value="">All events</option>{data.events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
          <select name="category" defaultValue={f.category} className="input w-auto" aria-label="Category"><option value="">All categories</option>{DELIVERABLE_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select>
          <select name="assignee" defaultValue={f.assignee} className="input w-auto" aria-label="Assigned user"><option value="">Anyone</option><option value="me">Assigned to me</option><option value="none">Unassigned</option>{data.members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>)}</select>
        </FilterForm>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Active sponsors" value={activeSponsors} href="/partners" sub={`${data.sponsors.filter((s) => s.status === "prospect").length} prospects`} />
        <Stat label="Outstanding" value={comp.outstanding} href="/deliverables" sub={`of ${comp.eligible} eligible deliverables`} />
        <Stat label="Completion" value={pct(comp.rate)} tone={comp.rate != null && comp.rate >= 0.8 ? "ok" : undefined} sub={`${comp.completed} completed`} />
        <Stat label="Overdue" value={overdue.length} tone={overdue.length ? "danger" : undefined} href="/deliverables?due=overdue" sub={blocked.length ? `${blocked.length} blocked` : "none blocked"} />
        <Stat label="Due in 7 days" value={dueSoon.length} tone={dueSoon.length ? "warn" : undefined} href="/deliverables?due=soon" sub="outstanding only" />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Needs attention" sub="Blocked first, then overdue, then due within 7 days" action={<Link href="/deliverables" className="text-xs text-brand hover:underline">All deliverables</Link>} />
          {attention.length === 0 ? <EmptyState title="Nothing urgent" description={scoped.length ? "No blocked, overdue or soon-due deliverables for these filters." : "No deliverables match these filters yet."} /> : (
            <ul className="divide-y divide-ink-800">
              {attention.map(({ d, kind }) => (
                <li key={d.id} className={`flex items-center gap-3 px-4 py-3 ${kind === "blocked" ? "bg-block/5 shadow-[inset_3px_0_0_var(--color-block)]" : kind === "overdue" ? "shadow-[inset_3px_0_0_var(--color-danger)]" : ""}`}>
                  <div className="min-w-0 flex-1"><Link href={`/deliverables/${d.id}`} className="line-clamp-1 text-sm font-medium hover:text-brand">{d.description}</Link>
                    <p className="text-xs text-ink-400">{data.sponsors.find((s) => s.id === d.sponsor_id)?.name} · {memberName(data.members, d.assigned_to)}</p></div>
                  {kind === "blocked" ? <StatusBadge status="blocked" /> : null}
                  <DueBadge date={d.due_date} today={today} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Upcoming games" action={<Link href="/game-day" className="text-xs text-brand hover:underline">Game Day</Link>} />
          {upcoming.length === 0 ? <EmptyState icon={<Trophy className="size-5" />} title="No upcoming games" description="Create a game to plan activations and run-of-show." /> : (
            <ul className="divide-y divide-ink-800">{upcoming.map((e) => {
              const tasks = data.tasks.filter((t) => t.event_id === e.id);
              const left = tasks.filter((t) => t.status !== "done").length;
              const blockedTasks = tasks.filter((t) => t.status === "blocked").length;
              return (
                <li key={e.id}><Link href={`/game-day/${e.id}`} className="block px-4 py-3 hover:bg-ink-850">
                  <p className="text-sm font-medium">{e.name}</p>
                  <p className="text-xs text-ink-400"><LocalTime iso={e.starts_at} /> · {e.venue ?? "Venue TBD"}</p>
                  <p className="mt-1 flex items-center gap-2 text-xs text-ink-300">{data.activations.filter((a) => a.event_id === e.id).length} activations · {left} task{left === 1 ? "" : "s"} left{blockedTasks > 0 && <Badge tone="block">{blockedTasks} blocked</Badge>}</p>
                </Link></li>);
            })}</ul>
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card><CardHeader title="Deliverables by status" /><div className="p-4"><HBarChart data={statusData} label="Deliverables by status" /></div></Card>
        <Card><CardHeader title="Completion by sponsor" sub="Lowest first · eligible deliverables only" /><div className="p-4"><HBarChart data={bySponsor} unit="%" max={100} label="Completion rate by sponsor" /></div></Card>
        <Card><CardHeader title="Outstanding by due week" /><div className="p-4"><ColumnChart data={weeks} label="Outstanding deliverables by due week" /></div></Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming renewals" sub="Next 90 days" />
          {renewals.length === 0 ? <EmptyState icon={<CalendarClock className="size-5" />} title="No renewals in the next 90 days" /> : (
            <ul className="divide-y divide-ink-800">{renewals.map((s) => {
              const n = daysBetween(today, s.renewal_date!);
              return <li key={s.id}><Link href={`/partners/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-ink-850">
                <span><span className="block text-sm font-medium">{s.name}</span><span className="text-xs text-ink-400">{fmtDate(s.renewal_date)} · {fmtMoney(s.contract_value)}</span></span>
                <Badge tone={n <= 30 ? "warn" : "info"}>{n}d</Badge></Link></li>;
            })}</ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Recent activity" />
          {activity.length === 0 ? <EmptyState title="No activity yet" description="Changes to sponsors, deliverables and games appear here." /> : (
            <ul className="divide-y divide-ink-800">{activity.map((a) => {
              const href = a.entity_id && LINK[a.entity_type] && a.action !== "delete" ? LINK[a.entity_type] + a.entity_id : null;
              const text = <><b className="font-medium text-ink-100">{memberName(data.members, a.actor_id).replace("Unassigned", "Someone")}</b> {VERB[a.action] ?? a.action} {NOUN[a.entity_type] ?? "record"} <span className="text-ink-200">{a.summary}</span></>;
              return <li key={a.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm text-ink-400">{href ? <Link href={href} className="hover:text-ink-100">{text}</Link> : <span>{text}</span>}<span className="shrink-0 text-xs text-ink-500">{relativeTime(a.created_at)}</span></li>;
            })}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
