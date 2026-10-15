// Pure business rules. Keep dependency-free so it can be unit tested directly.
import type { Contract, Deliverable, Sponsor } from "./types";

export type EligibilityLookup = {
  sponsors: Map<string, Pick<Sponsor, "status">>;
  contracts: Map<string, Pick<Contract, "status">>;
};

export function lookup(sponsors: Pick<Sponsor, "id" | "status">[], contracts: Pick<Contract, "id" | "status">[]): EligibilityLookup {
  return {
    sponsors: new Map(sponsors.map((s) => [s.id, s])),
    contracts: new Map(contracts.map((c) => [c.id, c])),
  };
}

/**
 * A deliverable counts toward obligations unless it is Not Applicable, belongs to a canceled
 * contract, or belongs to an archived sponsor.
 */
export function isEligible(d: Pick<Deliverable, "status" | "sponsor_id" | "contract_id">, l: EligibilityLookup): boolean {
  if (d.status === "not_applicable") return false;
  if (l.sponsors.get(d.sponsor_id)?.status === "archived") return false;
  if (d.contract_id && l.contracts.get(d.contract_id)?.status === "canceled") return false;
  return true;
}

export function isOutstanding(d: Pick<Deliverable, "status" | "sponsor_id" | "contract_id">, l: EligibilityLookup): boolean {
  return isEligible(d, l) && d.status !== "completed";
}

export function isOverdue(d: Pick<Deliverable, "status" | "due_date" | "sponsor_id" | "contract_id">, l: EligibilityLookup, today: string): boolean {
  return isOutstanding(d, l) && !!d.due_date && d.due_date < today;
}

export function isDueSoon(d: Pick<Deliverable, "status" | "due_date" | "sponsor_id" | "contract_id">, l: EligibilityLookup, today: string, windowEnd: string): boolean {
  return isOutstanding(d, l) && !!d.due_date && d.due_date >= today && d.due_date <= windowEnd;
}

export type Completion = { eligible: number; completed: number; outstanding: number; rate: number | null };

export function completion(list: Pick<Deliverable, "status" | "sponsor_id" | "contract_id">[], l: EligibilityLookup): Completion {
  const eligible = list.filter((d) => isEligible(d, l));
  const completed = eligible.filter((d) => d.status === "completed").length;
  return {
    eligible: eligible.length,
    completed,
    outstanding: eligible.length - completed,
    rate: eligible.length === 0 ? null : completed / eligible.length,
  };
}

export const pct = (rate: number | null) => (rate == null ? "—" : `${Math.round(rate * 100)}%`);
