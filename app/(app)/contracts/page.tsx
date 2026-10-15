import Link from "next/link";
import { FileSignature, Plus } from "lucide-react";
import { Badge, Card, EmptyState, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { FilterForm } from "@/components/filter-form";
import { CONTRACT_STATUSES, MANAGER_ROLES, label } from "@/lib/constants";
import { canSee, getCtx, getOrgData } from "@/lib/data";
import { daysBetween, fmtDate, fmtMoney, todayISO } from "@/lib/dates";
import { completion, pct } from "@/lib/metrics";
import { one, orgLookup, type SP } from "@/lib/view";

export const metadata = { title: "Contracts" };

export default async function ContractsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [ctx, data] = await Promise.all([getCtx(), getOrgData()]);
  const today = todayISO();
  const status = one(sp.status), sponsor = one(sp.sponsor), q = one(sp.q).toLowerCase();
  const l = orgLookup(data);
  const rows = data.contracts
    .filter((c) => (!status || c.status === status) && (!sponsor || c.sponsor_id === sponsor) && (!q || c.name.toLowerCase().includes(q)))
    .sort((a, b) => a.end_date.localeCompare(b.end_date));
  const total = rows.filter((c) => c.status === "active").reduce((n, c) => n + Number(c.value), 0);
  const canEdit = canSee(ctx, MANAGER_ROLES);

  return (
    <>
      <PageHeader title="Contracts" description={`${rows.length} contracts · ${fmtMoney(total)} in active value`}
        actions={canEdit && <LinkButton href="/contracts/new" variant="primary"><Plus className="size-4" /> New contract</LinkButton>} />
      <div className="mb-4">
        <FilterForm>
          <input name="q" type="search" defaultValue={sp.q as string} placeholder="Search contracts…" className="input w-56" aria-label="Search contracts" />
          <select name="sponsor" defaultValue={sponsor} className="input w-auto" aria-label="Sponsor"><option value="">All sponsors</option>{data.sponsors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select name="status" defaultValue={status} className="input w-auto" aria-label="Status"><option value="">All statuses</option>{CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        </FilterForm>
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<FileSignature className="size-5" />} title="No contracts found" description="Contracts define the term, value and obligations of each sponsorship." action={canEdit ? <LinkButton href="/contracts/new" variant="primary">Add contract</LinkButton> : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-ink-700"><tr><th className="th">Contract</th><th className="th">Sponsor</th><th className="th">Status</th><th className="th">Term</th><th className="th text-right">Value</th><th className="th">Fulfillment</th><th className="th">Ends</th></tr></thead>
              <tbody className="divide-y divide-ink-800">
                {rows.map((c) => {
                  const sponsorRow = data.sponsors.find((s) => s.id === c.sponsor_id);
                  const comp = completion(data.deliverables.filter((d) => d.contract_id === c.id), l);
                  const left = daysBetween(today, c.end_date);
                  return (
                    <tr key={c.id} className="hover:bg-ink-850">
                      <td className="td font-medium"><Link href={`/contracts/${c.id}`} className="hover:text-brand">{c.name}</Link></td>
                      <td className="td text-ink-300"><Link href={`/partners/${c.sponsor_id}`} className="hover:text-ink-100">{sponsorRow?.name}</Link></td>
                      <td className="td"><StatusBadge status={c.status} /></td>
                      <td className="td whitespace-nowrap text-xs text-ink-300">{fmtDate(c.start_date)} → {fmtDate(c.end_date)}</td>
                      <td className="td text-right tabular-nums">{fmtMoney(c.value)}</td>
                      <td className="td text-xs text-ink-300">{comp.eligible ? `${comp.completed}/${comp.eligible} · ${pct(comp.rate)}` : "No deliverables"}</td>
                      <td className="td">{c.status === "active" && left >= 0 && left <= 45 ? <Badge tone="warn">{left}d left</Badge> : left < 0 ? <span className="text-xs text-ink-500">ended</span> : <span className="text-xs text-ink-400">{left}d</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
