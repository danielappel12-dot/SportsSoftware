"use client";
import Link from "next/link";
import { useState } from "react";
import { ListChecks } from "lucide-react";
import clsx from "clsx";
import { DueBadge, EmptyState, PriorityBadge, StatusBadge } from "@/components/ui";
import { useRunner } from "@/components/ui/toast";
import { bulkDeliverables } from "@/lib/actions/deliverables";
import { DELIVERABLE_STATUSES, PRIORITIES, label } from "@/lib/constants";

export type Row = {
  id: string; description: string; sponsor: string; category: string; due_date: string | null; assignee: string;
  priority: string; status: string; overdue: boolean; value: number | null; eligible: boolean;
};

export function DeliverablesBulkTable({ rows, members, today, canBulk, canManage }: {
  rows: Row[]; members: { id: string; name: string }[]; today: string; canBulk: boolean; canManage: boolean;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const { run, pending } = useRunner();
  const [status, setStatus] = useState(""); const [assignee, setAssignee] = useState(""); const [priority, setPriority] = useState("");
  const allOn = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const apply = (op: string, value?: string) =>
    run(() => bulkDeliverables({ ids: [...sel], op, value }), { after: () => { setSel(new Set()); setStatus(""); setAssignee(""); setPriority(""); } });

  if (rows.length === 0) {
    return <EmptyState icon={<ListChecks className="size-5" />} title="No deliverables match" description="Adjust the filters, or add a deliverable to a sponsor's contract." />;
  }
  return (
    <div>
      {canBulk && sel.size > 0 && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-brand/30 bg-ink-850 px-3 py-2.5" role="toolbar" aria-label="Bulk actions">
          <span className="text-sm font-medium text-brand">{sel.size} selected</span>
          <select className="input w-auto py-1.5 text-xs" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Set status">
            <option value="">Set status…</option>{DELIVERABLE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
          <button className="btn-secondary btn-sm" disabled={!status || pending} onClick={() => apply("status", status)}>Apply</button>
          {canManage && (<>
            <select className="input w-auto py-1.5 text-xs" value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assign to">
              <option value="">Assign to…</option><option value="none">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button className="btn-secondary btn-sm" disabled={!assignee || pending} onClick={() => apply("assign", assignee)}>Assign</button>
            <select className="input w-auto py-1.5 text-xs" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Set priority">
              <option value="">Priority…</option>{PRIORITIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
            <button className="btn-secondary btn-sm" disabled={!priority || pending} onClick={() => apply("priority", priority)}>Set</button>
            <button className="btn-danger btn-sm" disabled={pending} onClick={() => { if (confirm(`Permanently delete ${sel.size} deliverable(s)?`)) apply("delete"); }}>Delete</button>
          </>)}
          <button className="btn-ghost btn-sm ml-auto" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full">
          <thead className="border-b border-ink-700"><tr>
            {canBulk && <th className="th w-10"><input type="checkbox" aria-label="Select all" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(rows.map((r) => r.id)))} className="accent-[var(--color-brand)]" /></th>}
            <th className="th">Deliverable</th><th className="th">Sponsor</th><th className="th">Category</th><th className="th">Due</th><th className="th">Assigned</th><th className="th">Priority</th><th className="th">Status</th>
          </tr></thead>
          <tbody className="divide-y divide-ink-800">
            {rows.map((r) => (
              <tr key={r.id} className={clsx("hover:bg-ink-850", sel.has(r.id) && "bg-brand/5", r.status === "blocked" && "bg-block/5 shadow-[inset_3px_0_0_var(--color-block)]", r.overdue && r.status !== "blocked" && "shadow-[inset_3px_0_0_var(--color-danger)]")}>
                {canBulk && <td className="td"><input type="checkbox" aria-label={`Select ${r.description}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="accent-[var(--color-brand)]" /></td>}
                <td className="td max-w-md"><Link href={`/deliverables/${r.id}`} className="line-clamp-2 font-medium hover:text-brand">{r.description}</Link>
                  {!r.eligible && r.status !== "not_applicable" && <span className="text-[11px] text-ink-500">Not counted (canceled contract / archived sponsor)</span>}</td>
                <td className="td text-ink-300">{r.sponsor}</td>
                <td className="td text-ink-300">{label(r.category)}</td>
                <td className="td"><DueBadge date={r.due_date} done={r.status === "completed" || r.status === "not_applicable"} today={today} /></td>
                <td className="td text-ink-300">{r.assignee}</td>
                <td className="td"><PriorityBadge priority={r.priority} /></td>
                <td className="td"><StatusBadge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-ink-800 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className={clsx("flex gap-3 p-4", r.status === "blocked" && "bg-block/5 shadow-[inset_3px_0_0_var(--color-block)]", r.overdue && r.status !== "blocked" && "shadow-[inset_3px_0_0_var(--color-danger)]")}>
            {canBulk && <input type="checkbox" aria-label={`Select ${r.description}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="mt-1 size-5 accent-[var(--color-brand)]" />}
            <Link href={`/deliverables/${r.id}`} className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-medium">{r.description}</p>
              <p className="mt-0.5 text-xs text-ink-400">{r.sponsor} · {label(r.category)} · {r.assignee}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5"><StatusBadge status={r.status} /><PriorityBadge priority={r.priority} /><DueBadge date={r.due_date} done={r.status === "completed" || r.status === "not_applicable"} today={today} /></div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
