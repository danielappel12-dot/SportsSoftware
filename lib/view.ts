import { completion, isOverdue, lookup } from "./metrics";
import { todayISO } from "./dates";
import type { OrgData } from "./types";

export type SP = Record<string, string | string[] | undefined>;
export const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

export function orgLookup(d: OrgData) {
  return lookup(d.sponsors, d.contracts);
}

export function sponsorStats(d: OrgData, today = todayISO()) {
  const l = orgLookup(d);
  const out = new Map<string, { eligible: number; completed: number; outstanding: number; rate: number | null; overdue: number }>();
  for (const s of d.sponsors) {
    const list = d.deliverables.filter((x) => x.sponsor_id === s.id);
    const c = completion(list, l);
    out.set(s.id, { ...c, overdue: list.filter((x) => isOverdue(x, l, today)).length });
  }
  return out;
}
