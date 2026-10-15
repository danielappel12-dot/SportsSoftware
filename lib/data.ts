import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isDemo } from "@/lib/env";
import { buildDemoData, DEMO_ORG, DEMO_USER } from "@/lib/demo-data";
import type { Role } from "@/lib/constants";
import type { Asset, Member, OrgData } from "@/lib/types";

export const ORG_COOKIE = "ss_org";

export type Ctx = {
  demo: boolean;
  supabase: SupabaseClient | null;
  userId: string;
  email: string;
  fullName: string | null;
  orgId: string;
  orgName: string;
  role: Role;
  orgs: { id: string; name: string }[];
};

export const can = (ctx: Ctx, roles: readonly Role[]) => !ctx.demo && roles.includes(ctx.role);
/** UI-level affordance check: in demo mode controls are shown (as an admin) but actions refuse to save. */
export const canSee = (ctx: Ctx, roles: readonly Role[]) => roles.includes(ctx.role);

/** Resolve the signed-in user + active organization. Redirects to /login or /onboarding when needed. */
export const getCtx = cache(async (): Promise<Ctx> => {
  if (isDemo) {
    return {
      demo: true, supabase: null, userId: DEMO_USER.id, email: DEMO_USER.email, fullName: DEMO_USER.full_name,
      orgId: DEMO_ORG.id, orgName: DEMO_ORG.name, role: "admin", orgs: [DEMO_ORG],
    };
  }
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const load = async () =>
    supabase.from("memberships").select("org_id, role, organizations(id, name)").eq("user_id", auth.user!.id);
  let { data: rows } = await load();
  if (!rows?.length) {
    // Accept any pending invitation addressed to this (verified) email, then re-check.
    await supabase.rpc("accept_invites");
    ({ data: rows } = await load());
  }
  if (!rows?.length) redirect("/onboarding");

  const orgs = rows!.map((r) => {
    const o = r.organizations as unknown as { id: string; name: string };
    return { id: o.id, name: o.name };
  });
  const wanted = (await cookies()).get(ORG_COOKIE)?.value;
  const active = rows!.find((r) => r.org_id === wanted) ?? rows![0];
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", auth.user.id).maybeSingle();
  return {
    demo: false, supabase, userId: auth.user.id, email: auth.user.email ?? "", fullName: profile?.full_name ?? null,
    orgId: active.org_id, orgName: orgs.find((o) => o.id === active.org_id)!.name, role: active.role as Role, orgs,
  };
});

/** Signed-in user without requiring an organization (used by onboarding). */
export async function getUserOnly() {
  if (isDemo) redirect("/dashboard");
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  return { supabase, user: data.user };
}

const ASSET_COLUMNS =
  "id, org_id, sponsor_id, category, original_filename, mime_type, size_bytes, approval_status, expires_on, uploaded_by, created_at";

async function fetchAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await run(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return out;
}

/** Every record the active organization can see. One data path for all pages (RLS-scoped). */
export const getOrgData = cache(async (): Promise<OrgData> => {
  const ctx = await getCtx();
  if (ctx.demo) return buildDemoData();
  const db = ctx.supabase!;
  const org = ctx.orgId;
  const table = <T,>(name: string, cols = "*", order = "created_at") =>
    fetchAll<T>((a, b) => db.from(name).select(cols).eq("org_id", org).order(order).order("id").range(a, b) as never);

  const [sponsors, contracts, seasons, events, deliverables, activations, tasks, assets, evidence, metrics] =
    await Promise.all([
      table<OrgData["sponsors"][number]>("sponsors", "*", "name"),
      table<OrgData["contracts"][number]>("contracts"),
      table<OrgData["seasons"][number]>("seasons", "*", "starts_on"),
      table<OrgData["events"][number]>("events", "*", "starts_at"),
      table<OrgData["deliverables"][number]>("deliverables"),
      table<OrgData["activations"][number]>("activations"),
      table<OrgData["tasks"][number]>("event_tasks", "*", "position"),
      table<Asset>("assets", ASSET_COLUMNS),
      table<OrgData["evidence"][number]>("evidence"),
      table<OrgData["metrics"][number]>("sponsor_metrics", "*", "recorded_on"),
    ]);

  const [reports, notifications, activity, members, invites] = await Promise.all([
    db.from("reports").select("*").eq("org_id", org).order("created_at", { ascending: false }).limit(50),
    db.from("notifications").select("id, kind, title, body, link, read_at, created_at")
      .eq("org_id", org).eq("user_id", ctx.userId).order("created_at", { ascending: false }).limit(100),
    db.from("activity_log").select("id, actor_id, entity_type, entity_id, action, summary, created_at")
      .eq("org_id", org).order("created_at", { ascending: false }).limit(40),
    db.from("memberships").select("user_id, role, profiles(full_name, email)").eq("org_id", org),
    ctx.role === "admin"
      ? db.from("invites").select("id, email, role, created_at").eq("org_id", org).is("accepted_at", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [reports, notifications, activity, members, invites]) if (r.error) throw new Error(r.error.message);

  const memberList: Member[] = (members.data ?? []).map((m) => {
    const p = m.profiles as unknown as { full_name: string | null; email: string | null } | null;
    return { user_id: m.user_id, role: m.role as Role, full_name: p?.full_name ?? null, email: p?.email ?? null };
  });

  return {
    sponsors, contracts, seasons, events, deliverables, activations, tasks, assets, evidence, metrics,
    reports: reports.data ?? [], notifications: notifications.data ?? [], activity: activity.data ?? [],
    members: memberList, invites: (invites.data ?? []) as OrgData["invites"],
  };
});

export function memberName(members: Member[], id: string | null | undefined): string {
  if (!id) return "Unassigned";
  const m = members.find((x) => x.user_id === id);
  return m?.full_name || m?.email || "Former member";
}
