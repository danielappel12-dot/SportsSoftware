import Link from "next/link";
import { notFound } from "next/navigation";
import { Calendar, Mail, Pencil, Phone, Plus } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader, Progress, SponsorLogo, StatusBadge, Tabs } from "@/components/ui";
import { DeliverablesTable } from "@/components/deliverables-table";
import { AssetGrid, AssetUploadForm } from "@/components/assets";
import { EvidenceGallery } from "@/components/evidence";
import { MetricForm } from "@/components/metric-form";
import { RunButton } from "@/components/ui/toast";
import { setSponsorStatus } from "@/lib/actions/sponsors";
import { deleteMetric } from "@/lib/actions/reports";
import { MANAGER_ROLES, WORKER_ROLES, label } from "@/lib/constants";
import { canSee, getCtx, getOrgData, memberName } from "@/lib/data";
import { daysBetween, fmtDate, fmtMoney, todayISO } from "@/lib/dates";
import { completion, isOverdue, pct } from "@/lib/metrics";
import { one, orgLookup, type SP } from "@/lib/view";

const TABS = ["overview", "contracts", "deliverables", "assets", "evidence", "reports"] as const;

export default async function SponsorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const [{ id }, sp, ctx, data] = await Promise.all([params, searchParams, getCtx(), getOrgData()]);
  const s = data.sponsors.find((x) => x.id === id);
  if (!s) notFound();
  const tab = (TABS as readonly string[]).includes(one(sp.tab)) ? one(sp.tab) : "overview";
  const today = todayISO();
  const l = orgLookup(data);
  const contracts = data.contracts.filter((c) => c.sponsor_id === id);
  const deliverables = data.deliverables.filter((d) => d.sponsor_id === id);
  const assets = data.assets.filter((a) => a.sponsor_id === id && a.category !== "evidence");
  const evidence = data.evidence.filter((e) => e.sponsor_id === id);
  const metrics = data.metrics.filter((m) => m.sponsor_id === id);
  const reports = data.reports.filter((r) => r.sponsor_id === id);
  const comp = completion(deliverables, l);
  const overdue = deliverables.filter((d) => isOverdue(d, l, today)).length;
  const canManage = canSee(ctx, MANAGER_ROLES);
  const canWork = canSee(ctx, WORKER_ROLES);
  const renewIn = s.renewal_date ? daysBetween(today, s.renewal_date) : null;
  const href = (t: string) => `/partners/${id}?tab=${t}`;

  return (
    <>
      <PageHeader
        back={<Link href="/partners" className="mb-2 inline-block text-xs text-ink-400 hover:text-ink-200">← Partners</Link>}
        title={<span className="flex items-center gap-3"><SponsorLogo name={s.name} assetId={s.logo_asset_id} size={40} /><span className="truncate">{s.name}</span></span>}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={s.status} /><Badge tone="brand">{label(s.tier)}</Badge>{s.industry && <span>{s.industry}</span>}</span>}
        actions={canManage && <>
          <LinkButton href={`/partners/${id}/edit`}><Pencil className="size-3.5" /> Edit</LinkButton>
          {s.status === "archived"
            ? <RunButton className="btn-secondary" action={setSponsorStatus.bind(null, id, "active")}>Restore</RunButton>
            : <RunButton className="btn-secondary" confirm="Archive this sponsor? Its deliverables stop counting toward completion rates." success="Sponsor archived" action={setSponsorStatus.bind(null, id, "archived")}>Archive</RunButton>}
        </>} />

      <Tabs active={tab} tabs={[
        { key: "overview", label: "Overview", href: href("overview") },
        { key: "contracts", label: "Contracts", href: href("contracts"), count: contracts.length },
        { key: "deliverables", label: "Deliverables", href: href("deliverables"), count: deliverables.length },
        { key: "assets", label: "Assets", href: href("assets"), count: assets.length },
        { key: "evidence", label: "Evidence", href: href("evidence"), count: evidence.length },
        { key: "reports", label: "Reports", href: href("reports") },
      ]} />

      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Fulfillment" />
            <div className="grid gap-4 p-4 sm:grid-cols-4">
              <div><p className="label-caps">Completion</p><p className="mt-1 text-2xl font-semibold tabular-nums">{pct(comp.rate)}</p></div>
              <div><p className="label-caps">Eligible</p><p className="mt-1 text-2xl font-semibold tabular-nums">{comp.eligible}</p></div>
              <div><p className="label-caps">Outstanding</p><p className="mt-1 text-2xl font-semibold tabular-nums">{comp.outstanding}</p></div>
              <div><p className="label-caps">Overdue</p><p className={`mt-1 text-2xl font-semibold tabular-nums ${overdue ? "text-danger" : ""}`}>{overdue}</p></div>
              <div className="sm:col-span-4"><Progress value={(comp.rate ?? 0) * 100} tone="ok" /></div>
            </div>
            <div className="border-t border-ink-700">
              <CardHeader title="Next up" action={<Link href={href("deliverables")} className="text-xs text-brand hover:underline">All deliverables</Link>} />
              {(() => {
                const next = deliverables.filter((d) => !["completed", "not_applicable"].includes(d.status)).sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")).slice(0, 5);
                return next.length ? <DeliverablesTable items={next} members={data.members} today={today} /> : <EmptyState title="Nothing outstanding" description="All eligible deliverables are complete." />;
              })()}
            </div>
          </Card>
          <div className="space-y-5">
            <Card>
              <CardHeader title="Partnership" />
              <dl className="space-y-2.5 p-4 text-sm">
                <Row k="Contract value" v={<b className="tabular-nums">{fmtMoney(s.contract_value)}</b>} />
                <Row k="Term" v={<>{fmtDate(s.contract_start)} → {fmtDate(s.contract_end)}</>} />
                <Row k="Renewal" v={<span className="flex items-center gap-1.5"><Calendar className="size-3.5 text-ink-500" />{fmtDate(s.renewal_date)}{renewIn !== null && renewIn >= 0 && renewIn <= 60 && <Badge tone={renewIn <= 30 ? "warn" : "info"}>{renewIn}d</Badge>}</span>} />
                <Row k="Account manager" v={memberName(data.members, s.account_manager_id).replace("Unassigned", "—")} />
              </dl>
            </Card>
            <Card>
              <CardHeader title="Primary contact" />
              <div className="space-y-1.5 p-4 text-sm">
                <p className="font-medium">{s.contact_name ?? "—"}</p>
                {s.contact_email && <a className="flex items-center gap-2 text-ink-300 hover:text-brand" href={`mailto:${s.contact_email}`}><Mail className="size-3.5" />{s.contact_email}</a>}
                {s.contact_phone && <a className="flex items-center gap-2 text-ink-300 hover:text-brand" href={`tel:${s.contact_phone}`}><Phone className="size-3.5" />{s.contact_phone}</a>}
              </div>
            </Card>
            <Card>
              <CardHeader title="Internal notes" sub="Private — never in sponsor reports" />
              <p className="whitespace-pre-wrap p-4 text-sm text-ink-300">{s.notes || <span className="text-ink-500">No notes.</span>}</p>
            </Card>
          </div>
        </div>
      )}

      {tab === "contracts" && (
        <Card>
          <CardHeader title="Contracts" action={canManage && <LinkButton size="sm" href={`/contracts/new?sponsor=${id}`}><Plus className="size-3.5" /> Add contract</LinkButton>} />
          {contracts.length === 0 ? <EmptyState title="No contracts" description="Add the agreement that defines this partnership." /> : (
            <div className="overflow-x-auto"><table className="w-full"><thead className="border-b border-ink-700"><tr><th className="th">Contract</th><th className="th">Status</th><th className="th">Term</th><th className="th text-right">Value</th><th className="th">Deliverables</th></tr></thead>
              <tbody className="divide-y divide-ink-800">{contracts.map((c) => {
                const cc = completion(deliverables.filter((d) => d.contract_id === c.id), l);
                return (<tr key={c.id} className="hover:bg-ink-850"><td className="td font-medium"><Link className="hover:text-brand" href={`/contracts/${c.id}`}>{c.name}</Link></td><td className="td"><StatusBadge status={c.status} /></td>
                  <td className="td text-xs text-ink-300">{fmtDate(c.start_date)} → {fmtDate(c.end_date)}</td><td className="td text-right tabular-nums">{fmtMoney(c.value)}</td><td className="td text-xs text-ink-300">{cc.completed}/{cc.eligible} · {pct(cc.rate)}</td></tr>);
              })}</tbody></table></div>
          )}
        </Card>
      )}

      {tab === "deliverables" && (
        <Card>
          <CardHeader title="Deliverables" action={canManage && <LinkButton size="sm" href={`/deliverables/new?sponsor=${id}`}><Plus className="size-3.5" /> Add deliverable</LinkButton>} />
          {deliverables.length === 0 ? <EmptyState title="No deliverables" description="Track what you owe this sponsor." /> : <DeliverablesTable items={[...deliverables].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))} members={data.members} today={today} />}
        </Card>
      )}

      {tab === "assets" && (
        <div className="space-y-5">
          <Card><CardHeader title="Brand assets & approved creative" /><AssetGrid assets={assets} sponsors={data.sponsors} today={today} canManage={canManage} showSponsor={false} /></Card>
          {canWork && <Card><CardHeader title="Upload assets" /><div className="p-4"><AssetUploadForm sponsors={data.sponsors} sponsorId={id} canApprove={canManage} /></div></Card>}
        </div>
      )}

      {tab === "evidence" && (
        <Card><CardHeader title="Evidence of fulfillment" sub="Photos and documents attached to deliverables and game-day tasks" />
          <EvidenceGallery items={evidence} assets={data.assets} canManage={canManage} empty="Attach photos from a deliverable page or the Game Day view." /></Card>
      )}

      {tab === "reports" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card>
              <CardHeader title="Sponsor recap report" action={<LinkButton size="sm" variant="primary" href={`/reports?sponsor=${id}`}>Generate report</LinkButton>} />
              {reports.length === 0 ? <EmptyState title="No reports generated yet" description="Reports bundle fulfillment, evidence and metrics into a shareable PDF." /> : (
                <ul className="divide-y divide-ink-800">{reports.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span>{fmtDate(r.range_start)} → {fmtDate(r.range_end)}<span className="block text-xs text-ink-500">Generated {fmtDate(r.created_at)}</span></span>
                    <LinkButton size="sm" href={`/reports?sponsor=${id}&from=${r.range_start}&to=${r.range_end}`}>Open</LinkButton></li>))}</ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Performance metrics" sub="Included in sponsor reports when inside the date range" />
              {metrics.length === 0 ? <EmptyState title="No metrics recorded" description="Record attendance, impressions, leads or other results." /> : (
                <table className="w-full"><thead className="border-b border-ink-700"><tr><th className="th">Metric</th><th className="th text-right">Value</th><th className="th">Date</th><th className="th" /></tr></thead>
                  <tbody className="divide-y divide-ink-800">{metrics.map((m) => (
                    <tr key={m.id}><td className="td">{m.metric_name}</td><td className="td text-right tabular-nums">{Number(m.metric_value).toLocaleString()} <span className="text-ink-500">{m.unit}</span></td><td className="td text-ink-300">{fmtDate(m.recorded_on)}</td>
                      <td className="td text-right">{canManage && <RunButton className="btn-ghost btn-sm text-danger" confirm="Remove this metric?" action={deleteMetric.bind(null, m.id)}>Remove</RunButton>}</td></tr>))}</tbody></table>
              )}
            </Card>
          </div>
          {canManage && <Card className="h-fit"><CardHeader title="Record a metric" /><div className="p-4"><MetricForm sponsorId={id} events={data.events} /></div></Card>}
        </div>
      )}
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-3"><dt className="text-ink-400">{k}</dt><dd className="text-right text-ink-100">{v}</dd></div>;
}
