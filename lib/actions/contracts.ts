"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { MANAGER_ROLES } from "@/lib/constants";
import { contractSchema } from "@/lib/schemas";
import { dbError, fail, guard, parse, withNulls, type ActionState } from "./util";

const KEYS = Object.keys(contractSchema.shape);

export async function createContract(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  const p = parse(contractSchema, fd);
  if (!p.ok) return p.state;
  const { error } = await g.ctx.supabase.from("contracts").insert({ ...withNulls(KEYS, p.data), org_id: g.ctx.orgId, created_by: g.ctx.userId });
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  redirect(`/partners/${p.data.sponsor_id}?tab=contracts`);
}

export async function updateContract(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  const p = parse(contractSchema, fd);
  if (!p.ok) return p.state;
  const { sponsor_id: _s, ...rest } = withNulls(KEYS, p.data) as Record<string, unknown>;
  void _s;
  const { data, error } = await g.ctx.supabase.from("contracts").update(rest).eq("id", id).eq("org_id", g.ctx.orgId).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return fail("Contract not found.");
  revalidatePath("/", "layout");
  redirect(`/partners/${p.data.sponsor_id}?tab=contracts`);
}

export async function deleteContract(id: string, sponsorId: string): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  const { data, error } = await g.ctx.supabase.from("contracts").delete().eq("id", id).eq("org_id", g.ctx.orgId).select("id");
  if (error) return dbError(error);
  if (!data?.length) return fail("Contract not found.");
  revalidatePath("/", "layout");
  redirect(`/partners/${sponsorId}?tab=contracts`);
}
