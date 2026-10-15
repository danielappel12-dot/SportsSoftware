// Pure report assembly. The output type deliberately has no field for internal notes,
// internal values, priorities or staff assignment: sponsor-facing data only.
import { isEligible, lookup } from "./metrics.ts";
import type { OrgData } from "./types.ts";

export type ReportParams = { sponsor: string; from: string; to: string; highlights?: string };

export type ReportDeliverable = {
  id: string; description: string; category: string; due_date: string | null; status: string;
  completed_on: string | null; event: string | null;
};
export type ReportData = {
  organization: string;
  sponsor: { name: string; industry: string | null; tier: string; contact_name: string | null };
  range: { from: string; to: string };
  contracts: { name: string; status: string; value: number; start_date: string; end_date: string }[];
  contracted: ReportDeliverable[];
  completed: ReportDeliverable[];
  outstanding: ReportDeliverable[];
  completionRate: number | null;
  evidence: { id: string; asset_id: string; caption: string | null; filename: string; mime_type: string; date: string; deliverable: string | null; event: string | null }[];
  metrics: { name: string; value: number; unit: string | null; date: string }[];
  highlights: string | null;
  generatedAt: string;
};

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

export function buildReportData(data: OrgData, orgName: string, p: ReportParams, now = new Date()): ReportData | null {
  const sponsor = data.sponsors.find((s) => s.id === p.sponsor);
  if (!sponsor) return null;
  const inRange = (d: string | null) => !!d && d >= p.from && d <= p.to;
  const l = lookup(data.sponsors, data.contracts);
  const eventOf = (id: string | null) => data.events.find((e) => e.id === id);

  const items = data.deliverables
    .filter((d) => d.sponsor_id === sponsor.id && isEligible(d, l))
    .filter((d) => inRange(d.due_date) || inRange(day(d.completed_at)) || inRange(day(eventOf(d.event_id)?.starts_at ?? null)))
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const view = (d: (typeof items)[number]): ReportDeliverable => ({
    id: d.id, description: d.description, category: d.category, due_date: d.due_date, status: d.status,
    completed_on: day(d.completed_at), event: eventOf(d.event_id)?.name ?? null,
  });
  const contracted = items.map(view);
  const completed = contracted.filter((d) => d.status === "completed");
  const outstanding = contracted.filter((d) => d.status !== "completed");

  const evidence = data.evidence
    .filter((e) => e.sponsor_id === sponsor.id && e.include_in_report && inRange(day(e.created_at)))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .flatMap((e) => {
      const a = data.assets.find((x) => x.id === e.asset_id);
      if (!a) return [];
      return [{
        id: e.id, asset_id: e.asset_id, caption: e.caption, filename: a.original_filename, mime_type: a.mime_type, date: day(e.created_at)!,
        deliverable: data.deliverables.find((d) => d.id === e.deliverable_id)?.description ?? null, event: eventOf(e.event_id)?.name ?? null,
      }];
    });

  return {
    organization: orgName,
    sponsor: { name: sponsor.name, industry: sponsor.industry, tier: sponsor.tier, contact_name: sponsor.contact_name },
    range: { from: p.from, to: p.to },
    contracts: data.contracts
      .filter((c) => c.sponsor_id === sponsor.id && c.status !== "draft" && c.start_date <= p.to && c.end_date >= p.from)
      .map((c) => ({ name: c.name, status: c.status, value: Number(c.value), start_date: c.start_date, end_date: c.end_date })),
    contracted, completed, outstanding,
    completionRate: contracted.length ? completed.length / contracted.length : null,
    evidence,
    metrics: data.metrics.filter((m) => m.sponsor_id === sponsor.id && inRange(m.recorded_on))
      .map((m) => ({ name: m.metric_name, value: Number(m.metric_value), unit: m.unit, date: m.recorded_on })),
    highlights: p.highlights?.trim() || null,
    generatedAt: now.toISOString(),
  };
}
