"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { MANAGER_ROLES } from "@/lib/constants";
import { sponsorSchema } from "@/lib/schemas";
import { uploadAsset } from "@/lib/storage";
import { assertMember, dbError, fail, guard, parse, withNulls, type ActionState } from "./util";

const KEYS = Object.keys(sponsorSchema.shape);

async function attachLogo(g: Extract<Awaited<ReturnType<typeof guard>>, { ok: true }>, sponsorId: string, fd: FormData): Promise<ActionState> {
  const file = fd.get("logo");
  if (!(file instanceof File) || file.size === 0) return null;
  if (!file.type.startsWith("image/")) return fail("Logo must be an image (PNG, JPG, WebP or GIF).", { logo: "Choose an image file" });
  const up = await uploadAsset(g.ctx.supabase, {
    orgId: g.ctx.orgId, sponsorId, userId: g.ctx.userId, file, category: "logo", approval_status: "approved",
  });
  if ("error" in up) return fail(up.error, { logo: up.error });
  const { error } = await g.ctx.supabase.from("sponsors").update({ logo_asset_id: up.id }).eq("id", sponsorId);
  return error ? dbError(error) : null;
}

export async function createSponsor(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  const p = parse(sponsorSchema, fd);
  if (!p.ok) return p.state;
  const bad = await assertMember(g, p.data.account_manager_id);
  if (bad) return fail("The selected account manager is not part of this organization.", { account_manager_id: "Not a member" });

  const { data, error } = await g.ctx.supabase
    .from("sponsors")
    .insert({ ...withNulls(KEYS, p.data), org_id: g.ctx.orgId, created_by: g.ctx.userId })
    .select("id")
    .single();
  if (error) return error.code === "23505" ? fail("A sponsor with that name already exists.", { name: "Name already in use" }) : dbError(error);
  const logoErr = await attachLogo(g, data.id, fd);
  revalidatePath("/partners");
  revalidatePath("/dashboard");
  if (logoErr) redirect(`/partners/${data.id}/edit?notice=logo`);
  redirect(`/partners/${data.id}`);
}

export async function updateSponsor(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  const p = parse(sponsorSchema, fd);
  if (!p.ok) return p.state;
  const bad = await assertMember(g, p.data.account_manager_id);
  if (bad) return fail("The selected account manager is not part of this organization.", { account_manager_id: "Not a member" });

  const { error, data } = await g.ctx.supabase
    .from("sponsors").update(withNulls(KEYS, p.data)).eq("id", id).eq("org_id", g.ctx.orgId).select("id").maybeSingle();
  if (error) return error.code === "23505" ? fail("A sponsor with that name already exists.", { name: "Name already in use" }) : dbError(error);
  if (!data) return fail("Sponsor not found.");
  const logoErr = await attachLogo(g, id, fd);
  if (logoErr) return logoErr;
  revalidatePath("/", "layout");
  redirect(`/partners/${id}`);
}

export async function setSponsorStatus(id: string, status: "active" | "archived" | "paused" | "prospect"): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  if (!["active", "archived", "paused", "prospect"].includes(status)) return fail("Invalid status.");
  const { error, data } = await g.ctx.supabase
    .from("sponsors").update({ status }).eq("id", id).eq("org_id", g.ctx.orgId).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return fail("Sponsor not found.");
  revalidatePath("/", "layout");
  return { ok: true, message: status === "archived" ? "Sponsor archived" : "Sponsor updated" };
}
