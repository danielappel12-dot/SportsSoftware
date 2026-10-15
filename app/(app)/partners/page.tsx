import Link from "next/link";
import { Handshake, Plus, Search } from "lucide-react";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Progress, SponsorLogo, StatusBadge } from "@/components/ui";
import { FilterForm } from "@/components/filter-form";
import { ACCOUNT_STATUSES, MANAGER_ROLES, SPONSOR_TIERS, label } from "@/lib/constants";
import { canSee, getCtx, getOrgData, memberName } from "@/lib/data";
import { daysBetween, fmtDate, fmtMoney, todayISO } from "@/lib/dates";
import { pct } from "@/lib/metrics";
import { one, sponsorStats, type SP } from "@/lib/view";

export const metadata = { title: "Partners" };

export default async function PartnersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [ctx, data] = await Promise.all([getCtx(), getOrgData()]);
  const today = todayISO();
  const q = one(sp.q).toLowerCase();
  const status = one(sp.status);
  const tier = one(sp.tier);
  const sort = one(sp.sort) || "name";
  const stats = sponsorStats(data, today);

  let rows = data.sponsors.filter((s) => {
    if (status ? s.status !== status : s.status === "archived") return false;
    if (tier && s.tier !== tier) return false;
    if (q && ![s.name, s.industry, s.contact_name, s.contact_email].some((v) => v?.toLowerCase().includes(q))) return false;
    return true;
  });
  const key: Record<string, (a: (typeof rows)[number], b: (typeof rows)[number]) => number> = {
    name: (a, b) => a.name.localeCompare(b.name),
    value: (a, b) => b.contract_value - a.contract_value,
    renewal: (a, b) => (a.renewal_date ?? "9999").localeCompare(b.renewal_date ?? "9999"),
    completion: (a, b) => (stats.get(a.id)?.rate ?? 2) - (stats.get(b.id)?.rate ?? 2),
  };
  rows = [...rows].sort(key[sort] ?? key.name);
  const canEdit = canSee(ctx, MANAGER_ROLES);

  return (
    <>
      <PageHeader title="Partners" description="Every sponsor relationship, its commitments and where it stands."
        actions={canEdit && <LinkButton href="/partners/new" variant="primary"><Plus className="size-4" /> New sponsor</LinkButton>} />

      <div className="mb-4">
        <FilterForm>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-ink-500" />
            <input name="q" type="search" defaultValue={sp.q as string} placeholder="Search sponsors, contacts…" className="input w-64 pl-8" aria-label="Search sponsors" />
          </div>
          <select name="status" defaultValue={status} className="input w-auto" aria-label="Status">
            <option value="">Active & prospects</option>
            {ACCOUNT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
          <select name="tier" defaultValue={tier} className="input w-auto" aria-label="Tier">
            <option value="">All tiers</option>
            {SPONSOR_TIERS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
          <select name="sort" defaultValue={sort} className="input w-auto" aria-label="Sort">
            <option value="name">Sort: Name</option><option value="value">Sort: Contract value</option>
            <option value="renewal">Sort: Renewal date</option><option value="completion">Sort: Lowest completion</option>
          </select>
        </FilterForm>
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Handshake className="size-5" />} title={data.sponsors.length ? "No sponsors match these filters" : "No sponsors yet"}
            description={data.sponsors.length ? "Try clearing the search or filters." : "Add your first sponsor to start tracking contracts and deliverables."}
            action={canEdit && !data.sponsors.length ? <LinkButton href="/partners/new" variant="primary">Add sponsor</LinkButton> : undefined} />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full">
                <thead className="border-b border-ink-700"><tr>
                  <th className="th">Sponsor</th><th className="th">Tier</th><th className="th">Status</th><th className="th">Account manager</th>
                  <th className="th text-right">Value</th><th className="th">Fulfillment</th><th className="th">Renewal</th>
                </tr></thead>
                <tbody className="divide-y divide-ink-800">
                  {rows.map((s) => {
                    const st = stats.get(s.id)!;
                    const dRen = s.renewal_date ? daysBetween(today, s.renewal_date) : null;
                    return (
                      <tr key={s.id} className="hover:bg-ink-850">
                        <td className="td"><Link href={`/partners/${s.id}`} className="flex items-center gap-2.5 font-medium text-ink-100 hover:text-brand">
                          <SponsorLogo name={s.name} assetId={s.logo_asset_id} size={30} /><span><span className="block">{s.name}</span><span className="block text-xs font-normal text-ink-400">{s.industry ?? "—"}</span></span></Link></td>
                        <td className="td text-ink-300">{label(s.tier)}</td>
                        <td className="td"><StatusBadge status={s.status} /></td>
                        <td className="td text-ink-300">{memberName(data.members, s.account_manager_id).replace("Unassigned", "—")}</td>
                        <td className="td text-right tabular-nums">{fmtMoney(s.contract_value)}</td>
                        <td className="td w-44">
                          <div className="flex items-center gap-2"><Progress value={(st.rate ?? 0) * 100} tone={st.overdue ? "danger" : "brand"} className="w-20" /><span className="text-xs tabular-nums text-ink-300">{pct(st.rate)}</span></div>
                          <p className="mt-0.5 text-[11px] text-ink-500">{st.outstanding} open{st.overdue > 0 && <span className="text-danger"> · {st.overdue} overdue</span>}</p>
                        </td>
                        <td className="td whitespace-nowrap text-xs">
                          {s.renewal_date ? <>{fmtDate(s.renewal_date)} {dRen !== null && dRen >= 0 && dRen <= 60 && <Badge tone={dRen <= 30 ? "warn" : "info"} className="ml-1">{dRen}d</Badge>}</> : <span className="text-ink-500">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-ink-800 md:hidden">
              {rows.map((s) => {
                const st = stats.get(s.id)!;
                return (
                  <li key={s.id}><Link href={`/partners/${s.id}`} className="flex items-center gap-3 p-4 active:bg-ink-850">
                    <SponsorLogo name={s.name} assetId={s.logo_asset_id} size={38} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{s.name}</p>
                      <p className="text-xs text-ink-400">{label(s.tier)} · {fmtMoney(s.contract_value)}</p>
                      <div className="mt-1.5 flex items-center gap-2"><Progress value={(st.rate ?? 0) * 100} className="w-24" /><span className="text-[11px] text-ink-400">{pct(st.rate)}{st.overdue > 0 && <span className="text-danger"> · {st.overdue} overdue</span>}</span></div>
                    </div>
                    <StatusBadge status={s.status} />
                  </Link></li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
      <p className="mt-3 text-xs text-ink-500">Showing {rows.length} of {data.sponsors.length} sponsors.</p>
    </>
  );
}
