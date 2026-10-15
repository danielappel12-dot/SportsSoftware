import Link from "next/link";
import { Download, FileBarChart, FileText } from "lucide-react";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Progress, StatusBadge } from "@/components/ui";
import { getCtx, getOrgData } from "@/lib/data";
import { addDays, fmtDate, fmtMoney, todayISO } from "@/lib/dates";
import { label } from "@/lib/constants";
import { reportParamsSchema } from "@/lib/schemas";
import { buildReportData } from "@/lib/report";
import { one, type SP } from "@/lib/view";

export const metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [ctx, data] = await Promise.all([getCtx(), getOrgData()]);
  const today = todayISO();
  const submitted = Boolean(sp.sponsor);
  const raw = { sponsor: one(sp.sponsor) || undefined, from: one(sp.from) || addDays(today, -90), to: one(sp.to) || today, highlights: one(sp.highlights) || undefined };
  const parsed = submitted ? reportParamsSchema.safeParse(raw) : null;
  const report = parsed?.success ? buildReportData(data, ctx.orgName, parsed.data) : null;
  const qs = parsed?.success ? new URLSearchParams({ sponsor: parsed.data.sponsor, from: parsed.data.from, to: parsed.data.to, ...(parsed.data.highlights ? { highlights: parsed.data.highlights } : {}) }).toString() : "";

  return (
    <>
      <PageHeader title="Reports" description="Generate a sponsor-facing recap with fulfillment, evidence and results. Internal notes are never included." />
      <Card className="mb-6">
        <CardHeader title="Report builder" />
        <form method="get" className="grid gap-4 p-4 md:grid-cols-4">
          <div><label htmlFor="sponsor" className="mb-1.5 block text-xs font-medium text-ink-300">Sponsor <span className="text-brand">*</span></label>
            <select id="sponsor" name="sponsor" required defaultValue={raw.sponsor ?? ""} className="input"><option value="" disabled>Choose a sponsor…</option>{data.sponsors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><label htmlFor="from" className="mb-1.5 block text-xs font-medium text-ink-300">From</label><input id="from" name="from" type="date" required defaultValue={raw.from} className="input" /></div>
          <div><label htmlFor="to" className="mb-1.5 block text-xs font-medium text-ink-300">To</label><input id="to" name="to" type="date" required defaultValue={raw.to} className="input" /></div>
          <div className="flex items-end"><button className="btn-primary w-full">Preview report</button></div>
          <div className="md:col-span-4"><label htmlFor="highlights" className="mb-1.5 block text-xs font-medium text-ink-300">Campaign highlights (shared with the sponsor)</label>
            <textarea id="highlights" name="highlights" rows={3} maxLength={5000} defaultValue={raw.highlights} placeholder="Standout moments, results, and wins from this period…" className="input" /></div>
        </form>
      </Card>

      {parsed && !parsed.success && <Alert>{parsed.error.issues[0]?.message ?? "Check the report settings."}</Alert>}
      {parsed?.success && !report && <Alert>That sponsor wasn&apos;t found.</Alert>}

      {report && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-semibold">{report.sponsor.name}</h2><p className="text-sm text-ink-400">{fmtDate(report.range.from)} – {fmtDate(report.range.to)}</p></div>
            <a href={`/api/reports/pdf?${qs}`} className="btn-primary"><Download className="size-4" /> Download PDF</a>
          </div>
          {ctx.demo && <Alert tone="warn">Demo data: this report is built from fictional records. Evidence photos are unavailable in demo mode.</Alert>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[["Contracted", report.contracted.length], ["Delivered", report.completed.length], ["Outstanding", report.outstanding.length], ["Fulfillment", report.completionRate == null ? "—" : `${Math.round(report.completionRate * 100)}%`]].map(([k, v]) => (
              <div key={k} className="card p-4"><p className="label-caps">{k}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{v}</p></div>))}
          </div>
          <Progress value={(report.completionRate ?? 0) * 100} tone="ok" />

          {report.highlights && <Card><CardHeader title="Campaign highlights" /><p className="whitespace-pre-wrap p-4 text-sm text-ink-200">{report.highlights}</p></Card>}

          <Card><CardHeader title="Agreement" />
            {report.contracts.length === 0 ? <p className="p-4 text-sm text-ink-400">No active contract overlaps this period.</p> : (
              <table className="w-full"><tbody className="divide-y divide-ink-800">{report.contracts.map((c, i) => <tr key={i}><td className="td font-medium">{c.name}</td><td className="td text-ink-300">{fmtDate(c.start_date)} – {fmtDate(c.end_date)}</td><td className="td"><StatusBadge status={c.status} /></td><td className="td text-right tabular-nums">{fmtMoney(c.value)}</td></tr>)}</tbody></table>)}
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card><CardHeader title={`Completed (${report.completed.length})`} />
              {report.completed.length === 0 ? <EmptyState title="Nothing completed in this range" /> : <ul className="divide-y divide-ink-800">{report.completed.map((d) => <li key={d.id} className="px-4 py-2.5 text-sm"><p>{d.description}</p><p className="text-xs text-ink-400">{label(d.category)} · completed {fmtDate(d.completed_on)}{d.event ? ` · ${d.event}` : ""}</p></li>)}</ul>}
            </Card>
            <Card><CardHeader title={`Outstanding (${report.outstanding.length})`} />
              {report.outstanding.length === 0 ? <EmptyState title="Nothing outstanding" description="Everything in this range has been delivered." /> : <ul className="divide-y divide-ink-800">{report.outstanding.map((d) => <li key={d.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm"><span><span className="block">{d.description}</span><span className="text-xs text-ink-400">{label(d.category)} · due {fmtDate(d.due_date)}</span></span><StatusBadge status={d.status} /></li>)}</ul>}
            </Card>
          </div>

          <Card><CardHeader title="Performance metrics" />
            {report.metrics.length === 0 ? <EmptyState title="No metrics recorded in this range" description="Record results on the sponsor's Reports tab." /> : (
              <table className="w-full"><tbody className="divide-y divide-ink-800">{report.metrics.map((m, i) => <tr key={i}><td className="td">{m.name}</td><td className="td text-right font-semibold tabular-nums">{m.value.toLocaleString()} <span className="font-normal text-ink-500">{m.unit}</span></td><td className="td text-right text-ink-400">{fmtDate(m.date)}</td></tr>)}</tbody></table>)}
          </Card>

          <Card><CardHeader title={`Evidence (${report.evidence.length})`} sub="Only items marked “Include in reports”" />
            {report.evidence.length === 0 ? <EmptyState icon={<FileText className="size-5" />} title="No shareable evidence in this range" /> : (
              <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">{report.evidence.map((e) => (
                <li key={e.id} className="overflow-hidden rounded-lg border border-ink-700">
                  {e.mime_type.startsWith("image/") ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/assets/${e.asset_id}`} alt={e.caption ?? e.filename} loading="lazy" className="aspect-[4/3] w-full object-cover" /> : <div className="grid aspect-[4/3] place-items-center bg-ink-800"><FileText className="size-7 text-ink-400" /></div>}
                  <p className="line-clamp-2 p-2 text-[11px] text-ink-300">{e.caption || e.deliverable || e.filename}</p></li>))}</ul>)}
          </Card>
        </div>
      )}

      <Card className="mt-8">
        <CardHeader title="Recent reports" sub="Created whenever a PDF is downloaded" />
        {data.reports.length === 0 ? <EmptyState icon={<FileBarChart className="size-5" />} title="No reports generated yet" /> : (
          <ul className="divide-y divide-ink-800">{data.reports.map((r) => {
            const s = data.sponsors.find((x) => x.id === r.sponsor_id);
            const q = new URLSearchParams({ sponsor: r.sponsor_id, from: r.range_start, to: r.range_end, ...(r.highlights ? { highlights: r.highlights } : {}) }).toString();
            return <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span><b className="font-medium">{s?.name ?? "Sponsor"}</b> <span className="text-ink-400">· {fmtDate(r.range_start)} – {fmtDate(r.range_end)}</span><span className="block text-xs text-ink-500">Generated {fmtDate(r.created_at)}</span></span>
              <span className="flex gap-2"><Link className="btn-secondary btn-sm" href={`/reports?${q}`}>Preview</Link><a className="btn-ghost btn-sm" href={`/api/reports/pdf?${q}`}>PDF</a></span></li>;
          })}</ul>)}
      </Card>
    </>
  );
}
