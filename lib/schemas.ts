import { z } from "zod";
import {
  ACCOUNT_STATUSES, APPROVAL_STATUSES, ASSET_CATEGORIES, CONTRACT_STATUSES, DELIVERABLE_CATEGORIES,
  DELIVERABLE_STATUSES, EVENT_STATUSES, PRIORITIES, ROLES, SPONSOR_TIERS, TASK_STATUSES,
} from "./constants";

const str = (max: number, min = 0) => z.string().trim().min(min).max(max);
const optStr = (max: number) => str(max).optional();
const reqStr = (max: number, what: string) => str(max, 1).min(1, `${what} is required`);
const optDate = z.iso.date("Use a valid date").optional();
const reqDate = (what: string) => z.iso.date(`${what} must be a valid date`);
const optUuid = z.uuid("Invalid selection").optional();
const money = z.coerce.number("Enter a number").min(0, "Must be 0 or more").max(10_000_000_000, "Too large");
const optMoney = money.optional();
const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

export const sponsorSchema = z
  .object({
    name: reqStr(160, "Company name"),
    industry: optStr(80),
    tier: z.enum(SPONSOR_TIERS),
    status: z.enum(ACCOUNT_STATUSES).default("active"),
    contact_name: optStr(120),
    contact_email: z.email("Enter a valid email").max(200).optional(),
    contact_phone: optStr(40),
    account_manager_id: optUuid,
    contract_value: money.default(0),
    contract_start: optDate,
    contract_end: optDate,
    renewal_date: optDate,
    notes: optStr(10000),
  })
  .refine((v) => !v.contract_start || !v.contract_end || v.contract_end >= v.contract_start, {
    path: ["contract_end"], message: "End date must be on or after the start date",
  });

export const contractSchema = z
  .object({
    sponsor_id: z.uuid("Choose a sponsor"),
    name: reqStr(160, "Contract name"),
    status: z.enum(CONTRACT_STATUSES).default("active"),
    value: money.default(0),
    start_date: reqDate("Start date"),
    end_date: reqDate("End date"),
    renewal_date: optDate,
    terms_summary: optStr(5000),
    notes: optStr(10000),
  })
  .refine((v) => v.end_date >= v.start_date, { path: ["end_date"], message: "End date must be on or after the start date" });

export const deliverableSchema = z.object({
  sponsor_id: z.uuid("Choose a sponsor"),
  contract_id: optUuid,
  event_id: optUuid,
  category: z.enum(DELIVERABLE_CATEGORIES),
  description: reqStr(2000, "Description"),
  due_date: optDate,
  assigned_to: optUuid,
  priority: z.enum(PRIORITIES).default("medium"),
  status: z.enum(DELIVERABLE_STATUSES).default("not_started"),
  completed_date: optDate,
  notes: optStr(10000),
  estimated_value: optMoney,
});

export const bulkSchema = z.object({
  ids: z.array(z.uuid()).min(1, "Select at least one deliverable").max(500),
  op: z.enum(["status", "assign", "priority", "delete"]),
  value: z.string().optional(),
});

export const eventSchema = z.object({
  name: reqStr(160, "Event name"),
  starts_at: z.string().min(1, "Date and time are required").refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date and time"),
  opponent: optStr(160),
  venue: optStr(160),
  description: optStr(5000),
  status: z.enum(EVENT_STATUSES).default("planned"),
  season_id: optUuid,
});

export const activationSchema = z.object({
  event_id: z.uuid(),
  sponsor_id: z.uuid("Choose a sponsor"),
  deliverable_id: optUuid,
  title: reqStr(200, "Title"),
  details: optStr(3000),
});

export const taskSchema = z.object({
  event_id: z.uuid(),
  title: reqStr(200, "Task"),
  scheduled_at: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid time").optional(),
  assigned_to: optUuid,
  activation_id: optUuid,
});

export const taskStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(TASK_STATUSES),
  blocker_note: optStr(1000),
});

export const assetSchema = z.object({
  sponsor_id: z.uuid("Choose a sponsor"),
  category: z.enum(ASSET_CATEGORIES),
  approval_status: z.enum(APPROVAL_STATUSES).default("pending"),
  expires_on: optDate,
});

export const evidenceSchema = z.object({
  sponsor_id: z.uuid("Choose a sponsor"),
  deliverable_id: optUuid,
  event_id: optUuid,
  event_task_id: optUuid,
  caption: optStr(500),
  include_in_report: checkbox.default(true),
});

export const metricSchema = z.object({
  sponsor_id: z.uuid(),
  event_id: optUuid,
  metric_name: reqStr(120, "Metric name"),
  metric_value: z.coerce.number("Enter a number").min(-1e12).max(1e12),
  unit: optStr(30),
  recorded_on: reqDate("Date"),
});

export const reportParamsSchema = z
  .object({
    sponsor: z.uuid("Choose a sponsor"),
    from: reqDate("Start date"),
    to: reqDate("End date"),
    highlights: optStr(5000),
  })
  .refine((v) => v.to >= v.from, { path: ["to"], message: "End date must be on or after the start date" })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 800, { path: ["to"], message: "Range is too long (max ~2 years)" });

export const seasonSchema = z
  .object({ name: reqStr(80, "Season name"), starts_on: reqDate("Start"), ends_on: reqDate("End") })
  .refine((v) => v.ends_on >= v.starts_on, { path: ["ends_on"], message: "End must be on or after start" });

export const orgSchema = z.object({ name: str(120, 2).min(2, "Organization name must be at least 2 characters") });
export const inviteSchema = z.object({ email: z.email("Enter a valid email").transform((v) => v.toLowerCase()), role: z.enum(ROLES) });
export const memberRoleSchema = z.object({ user_id: z.uuid(), role: z.enum(ROLES) });
export const profileSchema = z.object({ full_name: str(120, 1).min(1, "Name is required") });

export const loginSchema = z.object({ email: z.email("Enter a valid email"), password: str(200, 1).min(1, "Password is required") });
export const signupSchema = z.object({
  full_name: str(120, 1).min(1, "Name is required"),
  email: z.email("Enter a valid email"),
  password: str(200, 8).min(8, "Use at least 8 characters"),
});
