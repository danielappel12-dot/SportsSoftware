import Link from "next/link";
import { AlertTriangle, Bell, CalendarClock, ShieldAlert, TimerReset } from "lucide-react";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { RunButton } from "@/components/ui/toast";
import { markAllRead, markRead } from "@/lib/actions/notifications";
import { getCtx, getOrgData } from "@/lib/data";
import { addDays, daysBetween, fmtDate, relativeTime, todayISO } from "@/lib/dates";
import { isDueSoon, isOverdue } from "@/lib/metrics";
import { orgLookup } from "@/lib/view";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const [ctx, data] = await Promise.all([getCtx(), getOrgData()]);
  const today = todayISO();
  const l = orgLookup(data);
  const mine = data.deliverables.filter((d) => d.assigned_to === ctx.userId);
  const alerts = [
    ...mine.filter((d) => isOverdue(d, l, today)).map((d) => ({ icon: AlertTriangle, tone: "text-danger", text: `Overdue: ${d.description}`, sub: `Was due ${fmtDate(d.due_date)}`, href: `/deliverables/${d.id}` })),
    ...mine.filter((d) => isDueSoon(d, l, today, addDays(today, 3))).map((d) => ({ icon: TimerReset, tone: "text-warn", text: `Due soon: ${d.description}`, sub: `Due ${fmtDate(d.due_date)}`, href: `/deliverables/${d.id}` })),
    ...data.tasks.filter((t) => t.status === "blocked").map((t) => ({ icon: ShieldAlert, tone: "text-block", text: `Blocked game-day task: ${t.title}`, sub: t.blocker_note ?? "", href: `/game-day/${t.event_id}` })),
    ...data.sponsors.filter((s) => s.status !== "archived" && s.renewal_date && daysBetween(today, s.renewal_date) >= 0 && daysBetween(today, s.renewal_date) <= 30)
      .map((s) => ({ icon: CalendarClock, tone: "text-info", text: `Renewal in ${daysBetween(today, s.renewal_date!)} days: ${s.name}`, sub: fmtDate(s.renewal_date), href: `/partners/${s.id}` })),
    ...data.assets.filter((a) => a.expires_on && daysBetween(today, a.expires_on) <= 14).map((a) => ({ icon: AlertTriangle, tone: "text-warn", text: `${daysBetween(today, a.expires_on!) < 0 ? "Expired" : "Expiring"} asset: ${a.original_filename}`, sub: fmtDate(a.expires_on), href: "/assets?expiry=soon" })),
  ];
  const unread = data.notifications.filter((n) => !n.read_at).length;

  return (
    <>
      <PageHeader title="Notifications" description="Assignments and blockers sent to you, plus live alerts computed from your current records."
        actions={unread > 0 && <RunButton className="btn-secondary" action={markAllRead}>Mark all read</RunButton>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Inbox" sub={`${unread} unread`} />
          {data.notifications.length === 0 ? <EmptyState icon={<Bell className="size-5" />} title="Inbox is empty" description="You'll be notified when work is assigned to you or something is blocked." /> : (
            <ul className="divide-y divide-ink-800">{data.notifications.map((n) => (
              <li key={n.id} className="flex items-start gap-3 px-4 py-3">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read_at ? "bg-ink-700" : "bg-brand"}`} aria-label={n.read_at ? "Read" : "Unread"} />
                <div className="min-w-0 flex-1">
                  {n.link ? <Link href={n.link} className="text-sm font-medium hover:text-brand">{n.title}</Link> : <p className="text-sm font-medium">{n.title}</p>}
                  {n.body && <p className="line-clamp-2 text-xs text-ink-400">{n.body}</p>}
                  <p className="mt-0.5 text-[11px] text-ink-500">{relativeTime(n.created_at)}</p>
                </div>
                {!n.read_at && <RunButton className="btn-ghost btn-sm" action={markRead.bind(null, n.id)}>Mark read</RunButton>}
              </li>))}</ul>)}
        </Card>
        <Card>
          <CardHeader title="Live alerts" sub="Always current — not stored" />
          {alerts.length === 0 ? <EmptyState title="No alerts" description="Nothing overdue, blocked or expiring." /> : (
            <ul className="divide-y divide-ink-800">{alerts.map((a, i) => { const Icon = a.icon; return (
              <li key={i}><Link href={a.href} className="flex items-start gap-3 px-4 py-3 hover:bg-ink-850"><Icon className={`mt-0.5 size-4 shrink-0 ${a.tone}`} /><span><span className="block text-sm">{a.text}</span><span className="text-xs text-ink-400">{a.sub}</span></span></Link></li>); })}</ul>)}
        </Card>
      </div>
    </>
  );
}
