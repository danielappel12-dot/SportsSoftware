export const ROLES = ["admin", "partnerships_manager", "creative_staff", "read_only"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  partnerships_manager: "Partnerships Manager",
  creative_staff: "Creative Staff",
  read_only: "Read-Only",
};
export const ROLE_DESC: Record<Role, string> = {
  admin: "Full access, members and settings",
  partnerships_manager: "Manage sponsors, contracts, deliverables, events, reports",
  creative_staff: "Update deliverables and game-day tasks, upload assets and evidence",
  read_only: "View everything, change nothing",
};
/** Roles that may create/edit core records (sponsors, contracts, deliverables, events). */
export const MANAGER_ROLES: Role[] = ["admin", "partnerships_manager"];
/** Roles that may fulfil work (update status/tasks, upload files). */
export const WORKER_ROLES: Role[] = ["admin", "partnerships_manager", "creative_staff"];

export const ACCOUNT_STATUSES = ["prospect", "active", "paused", "archived"] as const;
export const SPONSOR_TIERS = ["title", "presenting", "premier", "official", "partner", "supplier"] as const;
export const CONTRACT_STATUSES = ["draft", "active", "expired", "canceled"] as const;
export const DELIVERABLE_STATUSES = [
  "not_started", "in_progress", "awaiting_approval", "blocked", "completed", "not_applicable",
] as const;
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const DELIVERABLE_CATEGORIES = [
  "signage", "broadcast", "digital", "social", "hospitality", "in_game", "activation", "media", "community", "other",
] as const;
export const EVENT_STATUSES = ["planned", "live", "completed", "canceled"] as const;
export const TASK_STATUSES = ["todo", "done", "blocked"] as const;
export const ASSET_CATEGORIES = ["logo", "creative", "image", "document", "evidence", "other"] as const;
export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;

export const LABELS: Record<string, string> = {
  // account / contract
  prospect: "Prospect", active: "Active", paused: "Paused", archived: "Archived",
  draft: "Draft", expired: "Expired", canceled: "Canceled",
  // tiers
  title: "Title", presenting: "Presenting", premier: "Premier", official: "Official", partner: "Partner", supplier: "Supplier",
  // deliverable status
  not_started: "Not Started", in_progress: "In Progress", awaiting_approval: "Awaiting Approval",
  blocked: "Blocked", completed: "Completed", not_applicable: "Not Applicable",
  // priorities
  low: "Low", medium: "Medium", high: "High", urgent: "Urgent",
  // categories
  signage: "Signage", broadcast: "Broadcast", digital: "Digital", social: "Social", hospitality: "Hospitality",
  in_game: "In-Game", activation: "Activation", media: "Media", community: "Community", other: "Other",
  // events / tasks
  planned: "Planned", live: "Live", todo: "To do", done: "Done",
  // assets
  logo: "Logo", creative: "Creative", image: "Image", document: "Document", evidence: "Evidence",
  pending: "Pending", approved: "Approved", rejected: "Rejected",
};
export const label = (v: string | null | undefined) => (v ? LABELS[v] ?? v : "—");

export const ALLOWED_UPLOAD_TYPES: Record<string, string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "application/pdf": ["pdf"],
};
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
