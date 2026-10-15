import { Plus, Search } from "lucide-react";
import { Card, LinkButton, PageHeader, Progress, Stat } from "@/components/ui";
import { FilterForm } from "@/components/filter-form";
import { DeliverablesBulkTable, type Row } from "@/components/deliverables-bulk";
import { DELIVERABLE_CATEGORIES, DELIVERABLE_STATUSES, MANAGER_ROLES, PRIORITIES, WORKER_ROLES, label } from "@/lib/constants";
import { canSee, getCtx, getOrgData, memberName } from "@/lib/data";
import { addDays, todayISO } from "@/lib/dates";
import { completion, isEligible, isOverdue, isOutstanding, pct } from "@/lib/metrics";
import { one, orgLookup, type SP } from "@/lib/view";

export const metadata = { title: "Deliverables" };

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export default async function DeliverablesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [ctx, data] = await Promise.all([getCtx(), getOrgData()]);
  const today = todayISO();
  const l = orgLookup(data);
  const q = one(sp.q).toLowerCase();
  const f = {
    sponsor: one(sp.sponsor), category: one(sp.category), priority: one(sp.priority), assignee: one(sp.assignee),
    event: one(sp.event), due: one(sp.due), status: one(sp.status) || "open",
  };
  const sort = one(sp.sort) || "due";

  const scope = data.deliverables.filter((d) => {
    if (f.sponsor && d.sponsor_id !== f.sponsor) return false;
    if (f.category && d.category !== f.category) return false;
    if (f.priority && d.priority !== f.priority) return false;
    if (f.event && d.event_id !== f.event) return false;
    if (f.assignee === "none" ? d.assigned_to : f.assignee && d.assigned_to !== (f.assignee === "me" ? ctx.userId : f.assignee)) return false;
    if (f.due === "overdue" && !isOverdue(d, l, today)) return false;
    if (f.due === "soon" && !(isOutstanding(d, l) && d.due_date && d.due_date >= today && d.due_date <= addDays(today, 7))) return false;
    if (f.due === "none" && d.due_date) return false;
    if (q) {
      const sponsor = data.sponsors.find((s) => s.id === d.sponsor_id)?.name ?? "";
      if (![d.description, sponsor, d.notes ?? ""].some((v) => v.toLowerCase().includes(q))) return false;
    }
    return true;
  });
  const comp = completion(scope, l);
  const visible = scope.filter((d) => (f.status === "all" ? true : f.status === "open" ? isOutstanding(d, l) : d.status === f.status));

  const sorters: Record<string, (a: (typeof visible)[number], b: (typeof visible)[number]) => number> = {
    due: (a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
    priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
    status: (a, b) => DELIVERABLE_STATUSES.indexOf(a.status as never) - DELIVERABLE_STATUSES.indexOf(b.status as never),
    sponsor: (a, b) => (data.sponsors.find((s) => s.id === a.sponsor_id)?.name ?? "").localeCompare(data.sponsors.find((s) => s.id === b.sponsor_id)?.name ?? ""),
    newest: (a, b) => b.created_at.localeCompare(a.created_at),
  };
  const sorted = [...visible].sort(sorters[sort] ?? sorters.due);
  const rows: Row[] = sorted.map((d) => ({
    id: d.id, description: d.description, sponsor: data.sponsors.find((s) => s.id === d.sponsor_id)?.name ?? "—", category: d.category,
    due_date: d.due_date, assignee: memberName(data.members, d.assigned_to), priority: d.priority, status: d.status,
    overdue: isOverdue(d, l, today), value: d.estimated_value, eligible: isEligible(d, l),
  }));
  const overdue = scope.filter((d) => isOverdue(d, l, today)).length;
  const canCreate = canSee(ctx, MANAGER_ROLES);

  return (
    <>
      <PageHeader title="Deliverables" description="Every obligation owed to sponsors — what's due, who owns it, and what's blocked."
        actions={canCreate && <LinkButton href="/deliverables/new" variant="primary"><Plus className="size-4" /> New deliverable</LinkButton>} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Completion rate" value={pct(comp.rate)} sub={`${comp.completed} of ${comp.eligible} eligible`} tone={comp.rate != null && comp.rate >= 0.8 ? "ok" : undefined} />
        <Stat label="Outstanding" value={comp.outstanding} sub="excludes Not Applicable" />
        <Stat label="Overdue" value={overdue} tone={overdue ? "danger" : undefined} />
        <Stat label="Blocked" value={scope.filter((d) => d.status === "blocked").length} tone={undefined} sub="need attention" />
      </div>
      <div className="mb-4"><Progress value={(comp.rate ?? 0) * 100} tone="ok" /></div>

      <div className="mb-4">
        <FilterForm>
          <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-ink-500" />
            <input name="q" type="search" defaultValue={sp.q as string} placeholder="Search deliverables…" className="input w-56 pl-8" aria-label="Search" /></div>
          <select name="status" defaultValue={f.status} className="input w-auto" aria-label="Status">
            <option value="open">Open (outstanding)</option><option value="all">All statuses</option>{DELIVERABLE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
          <select name="sponsor" defaultValue={f.sponsor} className="input w-auto" aria-label="Sponsor"><option value="">All sponsors</option>{data.sponsors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select name="category" defaultValue={f.category} className="input w-auto" aria-label="Category"><option value="">All categories</option>{DELIVERABLE_CATEGORIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
          <select name="assignee" defaultValue={f.assignee} className="input w-auto" aria-label="Assignee"><option value="">Anyone</option><option value="me">Assigned to me</option><option value="none">Unassigned</option>{data.members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>)}</select>
          <select name="priority" defaultValue={f.priority} className="input w-auto" aria-label="Priority"><option value="">Any priority</option>{PRIORITIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
          <select name="due" defaultValue={f.due} className="input w-auto" aria-label="Due"><option value="">Any due date</option><option value="overdue">Overdue</option><option value="soon">Due in 7 days</option><option value="none">No due date</option></select>
          <select name="event" defaultValue={f.event} className="input w-auto" aria-label="Game / event"><option value="">Any game</option>{data.events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
          <select name="sort" defaultValue={sort} className="input w-auto" aria-label="Sort"><option value="due">Sort: Due date</option><option value="priority">Sort: Priority</option><option value="status">Sort: Status</option><option value="sponsor">Sort: Sponsor</option><option value="newest">Sort: Newest</option></select>
        </FilterForm>
      </div>

      <Card>
        <DeliverablesBulkTable rows={rows} today={today}
          members={data.members.map((m) => ({ id: m.user_id, name: m.full_name || m.email || "Member" }))}
          canBulk={canSee(ctx, WORKER_ROLES)} canManage={canSee(ctx, MANAGER_ROLES)} />
      </Card>
      <p className="mt-3 text-xs text-ink-500">{rows.length} shown · completion rate counts only eligible deliverables (Not Applicable items, canceled contracts and archived sponsors are excluded).</p>
    </>
  );
}
