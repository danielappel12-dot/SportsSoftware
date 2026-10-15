import Link from "next/link";
import { DueBadge, PriorityBadge, StatusBadge, clsx } from "@/components/ui";
import { label } from "@/lib/constants";
import { memberName } from "@/lib/data";
import type { Deliverable, Member, Sponsor } from "@/lib/types";

/** Read-only deliverables list used on sponsor / contract / event pages. */
export function DeliverablesTable({ items, members, today, sponsors }: { items: Deliverable[]; members: Member[]; today: string; sponsors?: Sponsor[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="border-b border-ink-700"><tr>
          <th className="th">Deliverable</th>{sponsors && <th className="th">Sponsor</th>}<th className="th">Category</th><th className="th">Due</th>
          <th className="th">Assigned</th><th className="th">Priority</th><th className="th">Status</th>
        </tr></thead>
        <tbody className="divide-y divide-ink-800">
          {items.map((d) => (
            <tr key={d.id} className={clsx("hover:bg-ink-850", d.status === "blocked" && "bg-block/5 shadow-[inset_3px_0_0_var(--color-block)]")}>
              <td className="td max-w-sm"><Link href={`/deliverables/${d.id}`} className="line-clamp-2 font-medium hover:text-brand">{d.description}</Link></td>
              {sponsors && <td className="td text-ink-300">{sponsors.find((s) => s.id === d.sponsor_id)?.name ?? "—"}</td>}
              <td className="td text-ink-300">{label(d.category)}</td>
              <td className="td"><DueBadge date={d.due_date} done={d.status === "completed" || d.status === "not_applicable"} today={today} /></td>
              <td className="td text-ink-300">{memberName(members, d.assigned_to)}</td>
              <td className="td"><PriorityBadge priority={d.priority} /></td>
              <td className="td"><StatusBadge status={d.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
