"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ASSET_CATEGORIES, APPROVAL_STATUSES, MANAGER_ROLES, WORKER_ROLES } from "@/lib/constants";
import { assetSchema, evidenceSchema } from "@/lib/schemas";
import { BUCKET, uploadAsset } from "@/lib/storage";
import { dbError, fail, guard, parse, type ActionState } from "./util";

export async function uploadAssetAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(WORKER_ROLES);
  if (!g.ok) return g.state;
  const p = parse(assetSchema, fd);
  if (!p.ok) return p.state;
  const files = fd.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return fail("Choose at least one file.", { file: "Choose a file" });
  if (files.length > 10) return fail("Upload up to 10 files at a time.", { file: "Too many files" });
  // Creative staff can upload but not approve their own work.
  const approval = g.ctx.role === "creative_staff" ? "pending" : p.data.approval_status;
  let ok = 0;
  const errors: string[] = [];
  for (const file of files) {
    const res = await uploadAsset(g.ctx.supabase, {
      orgId: g.ctx.orgId, sponsorId: p.data.sponsor_id, userId: g.ctx.userId, file,
      category: p.data.category, approval_status: approval, expires_on: p.data.expires_on,
    });
    if ("error" in res) errors.push(`${file.name}: ${res.error}`); else ok++;
  }
  revalidatePath("/", "layout");
  if (errors.length) return fail(`${ok ? `${ok} uploaded. ` : ""}${errors.join(" · ")}`, { file: errors[0] });
  return { ok: true, message: `Uploaded ${ok} file${ok === 1 ? "" : "s"}` };
}

export async function setAssetApproval(id: string, status: string): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  if (!(APPROVAL_STATUSES as readonly string[]).includes(status)) return fail("Invalid approval status.");
  const { data, error } = await g.ctx.supabase.from("assets").update({ approval_status: status }).eq("id", id).eq("org_id", g.ctx.orgId).select("id");
  if (error) return dbError(error);
  if (!data?.length) return fail("Asset not found.");
  revalidatePath("/", "layout");
  return { ok: true, message: `Marked ${status}` };
}

const metaSchema = z.object({
  category: z.enum(ASSET_CATEGORIES),
  expires_on: z.iso.date().optional(),
});
export async function updateAssetMeta(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  const p = parse(metaSchema, fd);
  if (!p.ok) return p.state;
  const { data, error } = await g.ctx.supabase.from("assets").update({ category: p.data.category, expires_on: p.data.expires_on ?? null })
    .eq("id", id).eq("org_id", g.ctx.orgId).select("id");
  if (error) return dbError(error);
  if (!data?.length) return fail("Asset not found.");
  revalidatePath("/", "layout");
  return { ok: true, message: "Asset updated" };
}

export async function deleteAsset(id: string): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  const { data: row } = await g.ctx.supabase.from("assets").select("storage_path").eq("id", id).eq("org_id", g.ctx.orgId).maybeSingle();
  if (!row) return fail("Asset not found.");
  const { error } = await g.ctx.supabase.from("assets").delete().eq("id", id).eq("org_id", g.ctx.orgId);
  if (error) return dbError(error);
  await g.ctx.supabase.storage.from(BUCKET).remove([row.storage_path]);
  revalidatePath("/", "layout");
  return { ok: true, message: "Asset deleted" };
}

/** Upload photo / document evidence and link it to a deliverable, game task or sponsor. */
export async function uploadEvidence(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(WORKER_ROLES);
  if (!g.ok) return g.state;
  const p = parse(evidenceSchema, fd);
  if (!p.ok) return p.state;
  const files = fd.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return fail("Attach at least one photo or file.", { file: "Choose a file" });
  if (files.length > 10) return fail("Upload up to 10 files at a time.", { file: "Too many files" });

  const db = g.ctx.supabase;
  let { sponsor_id, event_id } = p.data;
  const { deliverable_id, event_task_id } = p.data;
  // Derive links server-side so the evidence always points at consistent records.
  if (deliverable_id) {
    const { data } = await db.from("deliverables").select("sponsor_id, event_id").eq("id", deliverable_id).eq("org_id", g.ctx.orgId).maybeSingle();
    if (!data) return fail("Deliverable not found.");
    sponsor_id = data.sponsor_id; event_id ??= data.event_id ?? undefined;
  }
  if (event_task_id) {
    const { data } = await db.from("event_tasks").select("event_id, activations(sponsor_id)").eq("id", event_task_id).eq("org_id", g.ctx.orgId).maybeSingle();
    if (!data) return fail("Task not found.");
    event_id = data.event_id;
    const act = data.activations as unknown as { sponsor_id: string } | null;
    if (act?.sponsor_id && !deliverable_id) sponsor_id = act.sponsor_id;
  }

  let ok = 0;
  const errors: string[] = [];
  for (const file of files) {
    const up = await uploadAsset(db, { orgId: g.ctx.orgId, sponsorId: sponsor_id, userId: g.ctx.userId, file, category: "evidence", approval_status: "approved" });
    if ("error" in up) { errors.push(`${file.name}: ${up.error}`); continue; }
    const { error } = await db.from("evidence").insert({
      org_id: g.ctx.orgId, sponsor_id, asset_id: up.id, deliverable_id: deliverable_id ?? null, event_id: event_id ?? null,
      event_task_id: event_task_id ?? null, caption: p.data.caption ?? null, include_in_report: p.data.include_in_report, created_by: g.ctx.userId,
    });
    if (error) { errors.push(`${file.name}: ${error.message}`); continue; }
    ok++;
  }
  revalidatePath("/", "layout");
  if (errors.length) return fail(`${ok ? `${ok} saved. ` : ""}${errors.join(" · ")}`, { file: errors[0] });
  return { ok: true, message: `Attached ${ok} file${ok === 1 ? "" : "s"} as evidence` };
}

export async function deleteEvidence(id: string): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  const { data: ev } = await g.ctx.supabase.from("evidence").select("asset_id").eq("id", id).eq("org_id", g.ctx.orgId).maybeSingle();
  if (!ev) return fail("Evidence not found.");
  return deleteAsset(ev.asset_id); // cascades to the evidence row
}

export async function setEvidenceInReport(id: string, include: boolean): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  const { data, error } = await g.ctx.supabase.from("evidence").update({ include_in_report: include }).eq("id", id).eq("org_id", g.ctx.orgId).select("id");
  if (error) return dbError(error);
  if (!data?.length) return fail("Evidence not found.");
  revalidatePath("/", "layout");
  return { ok: true, message: include ? "Included in reports" : "Excluded from reports" };
}
