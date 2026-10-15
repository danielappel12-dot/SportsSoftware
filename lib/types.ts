import type { Role } from "@/lib/constants";

export type Sponsor = {
  id: string; org_id: string; name: string; industry: string | null;
  tier: string; status: string; contact_name: string | null; contact_email: string | null;
  contact_phone: string | null; account_manager_id: string | null; contract_value: number;
  contract_start: string | null; contract_end: string | null; renewal_date: string | null;
  notes: string | null; logo_asset_id: string | null; created_at: string;
};
export type Contract = {
  id: string; org_id: string; sponsor_id: string; name: string; status: string; value: number;
  start_date: string; end_date: string; renewal_date: string | null;
  terms_summary: string | null; notes: string | null; created_at: string;
};
export type Season = { id: string; org_id: string; name: string; starts_on: string; ends_on: string };
export type GameEvent = {
  id: string; org_id: string; season_id: string | null; name: string; starts_at: string;
  opponent: string | null; venue: string | null; description: string | null; status: string;
};
export type Deliverable = {
  id: string; org_id: string; sponsor_id: string; contract_id: string | null; event_id: string | null;
  category: string; description: string; due_date: string | null; assigned_to: string | null;
  priority: string; status: string; completed_at: string | null; notes: string | null;
  estimated_value: number | null; created_at: string;
};
export type Activation = {
  id: string; org_id: string; event_id: string; sponsor_id: string; deliverable_id: string | null;
  title: string; details: string | null;
};
export type EventTask = {
  id: string; org_id: string; event_id: string; activation_id: string | null; title: string;
  scheduled_at: string | null; assigned_to: string | null; status: string; blocker_note: string | null;
  completed_at: string | null; position: number;
};
/** Note: storage_path is intentionally NOT part of this type; it never leaves the database/server. */
export type Asset = {
  id: string; org_id: string; sponsor_id: string; category: string; original_filename: string;
  mime_type: string; size_bytes: number; approval_status: string; expires_on: string | null;
  uploaded_by: string | null; created_at: string;
};
export type Evidence = {
  id: string; org_id: string; sponsor_id: string; asset_id: string; deliverable_id: string | null;
  event_id: string | null; event_task_id: string | null; caption: string | null;
  include_in_report: boolean; created_at: string;
};
export type Metric = {
  id: string; org_id: string; sponsor_id: string; event_id: string | null; metric_name: string;
  metric_value: number; unit: string | null; recorded_on: string;
};
export type ReportRow = {
  id: string; org_id: string; sponsor_id: string; range_start: string; range_end: string;
  highlights: string | null; generated_by: string | null; created_at: string;
};
export type Notification = {
  id: string; kind: string; title: string; body: string | null; link: string | null;
  read_at: string | null; created_at: string;
};
export type Activity = {
  id: string; actor_id: string | null; entity_type: string; entity_id: string | null;
  action: string; summary: string | null; created_at: string;
};
export type Member = { user_id: string; role: Role; full_name: string | null; email: string | null };
export type Invite = { id: string; email: string; role: Role; created_at: string };

export type OrgData = {
  sponsors: Sponsor[]; contracts: Contract[]; seasons: Season[]; events: GameEvent[];
  deliverables: Deliverable[]; activations: Activation[]; tasks: EventTask[]; assets: Asset[];
  evidence: Evidence[]; metrics: Metric[]; reports: ReportRow[]; notifications: Notification[];
  activity: Activity[]; members: Member[]; invites: Invite[];
};
