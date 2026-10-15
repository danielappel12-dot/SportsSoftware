"use server";
import { revalidatePath } from "next/cache";
import { ROLES, type Role } from "@/lib/constants";
import { inviteSchema, memberRoleSchema, orgSchema, profileSchema, seasonSchema } from "@/lib/schemas";
import { dbError, fail, guard, parse, type ActionState } from "./util";

export async function updateProfile(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(ROLES);
  if (!g.ok) return g.state;
  const p = parse(profileSchema, fd);
  if (!p.ok) return p.state;
  const { error } = await g.ctx.supabase.from("profiles").update({ full_name: p.data.full_name }).eq("id", g.ctx.userId);
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true, message: "Profile updated" };
}

export async function updateOrg(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(["admin"]);
  if (!g.ok) return g.state;
  const p = parse(orgSchema, fd);
  if (!p.ok) return p.state;
  const { data, error } = await g.ctx.supabase.from("organizations").update({ name: p.data.name }).eq("id", g.ctx.orgId).select("id");
  if (error) return dbError(error);
  if (!data?.length) return fail("Organization not found.");
  revalidatePath("/", "layout");
  return { ok: true, message: "Organization renamed" };
}

export async function inviteMember(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(["admin"]);
  if (!g.ok) return g.state;
  const p = parse(inviteSchema, fd);
  if (!p.ok) return p.state;
  const { error } = await g.ctx.supabase.from("invites").insert({ org_id: g.ctx.orgId, email: p.data.email, role: p.data.role, invited_by: g.ctx.userId });
  if (error) return error.code === "23505" ? fail("That email already has a pending invitation.", { email: "Already invited" }) : dbError(error);
  revalidatePath("/settings");
  return { ok: true, message: `Invitation saved. ${p.data.email} joins as ${p.data.role.replace("_", " ")} when they sign up or sign in with that email.` };
}

export async function revokeInvite(id: string): Promise<ActionState> {
  const g = await guard(["admin"]);
  if (!g.ok) return g.state;
  const { error } = await g.ctx.supabase.from("invites").delete().eq("id", id).eq("org_id", g.ctx.orgId);
  if (error) return dbError(error);
  revalidatePath("/settings");
  return { ok: true, message: "Invitation revoked" };
}

export async function setMemberRole(userId: string, role: Role): Promise<ActionState> {
  const g = await guard(["admin"]);
  if (!g.ok) return g.state;
  const p = parse(memberRoleSchema, { user_id: userId, role });
  if (!p.ok) return p.state;
  const { data, error } = await g.ctx.supabase.from("memberships").update({ role: p.data.role }).eq("org_id", g.ctx.orgId).eq("user_id", p.data.user_id).select("user_id");
  if (error) return dbError(error);
  if (!data?.length) return fail("Member not found.");
  revalidatePath("/", "layout");
  return { ok: true, message: "Role updated" };
}

export async function removeMember(userId: string): Promise<ActionState> {
  const g = await guard(["admin"]);
  if (!g.ok) return g.state;
  const { data, error } = await g.ctx.supabase.from("memberships").delete().eq("org_id", g.ctx.orgId).eq("user_id", userId).select("user_id");
  if (error) return dbError(error);
  if (!data?.length) return fail("Member not found.");
  revalidatePath("/", "layout");
  return { ok: true, message: "Member removed" };
}

export async function createSeason(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(["admin", "partnerships_manager"]);
  if (!g.ok) return g.state;
  const p = parse(seasonSchema, fd);
  if (!p.ok) return p.state;
  const { error } = await g.ctx.supabase.from("seasons").insert({ org_id: g.ctx.orgId, ...p.data });
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true, message: "Season added" };
}

export async function deleteSeason(id: string): Promise<ActionState> {
  const g = await guard(["admin", "partnerships_manager"]);
  if (!g.ok) return g.state;
  const { data, error } = await g.ctx.supabase.from("seasons").delete().eq("id", id).eq("org_id", g.ctx.orgId).select("id");
  if (error) return dbError(error);
  if (!data?.length) return fail("Season not found.");
  revalidatePath("/", "layout");
  return { ok: true, message: "Season removed (games keep their data)" };
}
