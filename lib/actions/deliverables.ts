"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DELIVERABLE_STATUSES, MANAGER_ROLES, PRIORITIES, WORKER_ROLES } from "@/lib/constants";
import { bulkSchema, deliverableSchema } from "@/lib/schemas";
import { assertMember, dbError, fail, guard, parse, type ActionState, type Guarded } from "./util";

type G = Extract<Guarded, { ok: true }>;

async function checkRefs(g: G, d: { sponsor_id: string; contract_id?: string }): Promise<ActionState> {
  if (d.contract_id) {
    const { data } = await g.ctx.supabase.from("contracts").select("sponsor_id").eq("id", d.contract_id).eq("org_id", g.ctx.orgId).maybeSingle();
    if (!data) return fail("Contract not found.", { contract_id: "Contract not found" });
    if (data.sponsor_id !== d.sponsor_id) return fail("That contract belongs to a different sponsor.", { contract_id: "Contract belongs to another sponsor" });
  }
  return assertMember(g, undefined);
}

function toRow(d: z.output<typeof deliverableSchema>) {
  const completed = d.status === "completed";
  return {
    sponsor_id: d.sponsor_id, contract_id: d.contract_id ?? null, event_id: d.event_id ?? null, category: d.category,
    description: d.description, due_date: d.due_date ?? null, assigned_to: d.assigned_to ?? null, priority: d.priority,
    status: d.status, notes: d.notes ?? null, estimated_value: d.estimated_value ?? null,
    // Trigger fills completed_at (now) when status is completed and no date is supplied; cleared otherwise.
    completed_at: completed && d.completed_date ? `${d.completed_date}T12:00:00Z` : null,
  };
}

export async function createDeliverable(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  const p = parse(deliverableSchema, fd);
  if (!p.ok) return p.state;
  const bad = (await checkRefs(g, p.data)) ?? (await assertMember(g, p.data.assigned_to));
  if (bad) return bad;
  const { data, error } = await g.ctx.supabase
    .from("deliverables").insert({ ...toRow(p.data), org_id: g.ctx.orgId, created_by: g.ctx.userId }).select("id").single();
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  redirect(`/deliverables/${data.id}`);
}

export async function updateDeliverable(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(WORKER_ROLES);
  if (!g.ok) return g.state;

  let payload: Record<string, unknown>;
  if (g.ctx.role === "creative_staff") {
    // Creative staff fulfil work: they may change status, completion and notes only.
    const p = parse(deliverableSchema.pick({ status: true, completed_date: true, notes: true }), fd);
    if (!p.ok) return p.state;
    payload = {
      status: p.data.status, notes: p.data.notes ?? null,
      completed_at: p.data.status === "completed" && p.data.completed_date ? `${p.data.completed_date}T12:00:00Z` : null,
    };
  } else {
    const p = parse(deliverableSchema, fd);
    if (!p.ok) return p.state;
    const bad = (await checkRefs(g, p.data)) ?? (await assertMember(g, p.data.assigned_to));
    if (bad) return bad;
    payload = toRow(p.data);
  }
  const { data, error } = await g.ctx.supabase.from("deliverables").update(payload).eq("id", id).eq("org_id", g.ctx.orgId).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return fail("Deliverable not found or you don't have access to change it.");
  revalidatePath("/", "layout");
  return { ok: true, message: "Deliverable saved" };
}

export async function setDeliverableStatus(id: string, status: string): Promise<ActionState> {
  const g = await guard(WORKER_ROLES);
  if (!g.ok) return g.state;
  if (!(DELIVERABLE_STATUSES as readonly string[]).includes(status)) return fail("Invalid status.");
  const { data, error } = await g.ctx.supabase.from("deliverables")
    .update({ status, completed_at: null }).eq("id", id).eq("org_id", g.ctx.orgId).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return fail("Deliverable not found.");
  revalidatePath("/", "layout");
  return { ok: true, message: "Status updated" };
}

export async function bulkDeliverables(input: { ids: string[]; op: string; value?: string }): Promise<ActionState> {
  const p = parse(bulkSchema, input);
  if (!p.ok) return p.state;
  const { ids, op, value } = p.data;
  const g = await guard(op === "status" ? WORKER_ROLES : MANAGER_ROLES);
  if (!g.ok) return g.state;
  const q = g.ctx.supabase.from("deliverables");
  let res;
  if (op === "status") {
    if (!value || !(DELIVERABLE_STATUSES as readonly string[]).includes(value)) return fail("Choose a valid status.");
    res = await q.update({ status: value, completed_at: null }).in("id", ids).eq("org_id", g.ctx.orgId).select("id");
  } else if (op === "priority") {
    if (!value || !(PRIORITIES as readonly string[]).includes(value)) return fail("Choose a valid priority.");
    res = await q.update({ priority: value }).in("id", ids).eq("org_id", g.ctx.orgId).select("id");
  } else if (op === "assign") {
    const assignee = value && value !== "none" ? value : null;
    if (assignee) {
      if (!z.uuid().safeParse(assignee).success) return fail("Choose a valid staff member.");
      const bad = await assertMember(g, assignee);
      if (bad) return bad;
    }
    res = await q.update({ assigned_to: assignee }).in("id", ids).eq("org_id", g.ctx.orgId).select("id");
  } else {
    res = await q.delete().in("id", ids).eq("org_id", g.ctx.orgId).select("id");
  }
  if (res.error) return dbError(res.error);
  revalidatePath("/", "layout");
  const n = res.data?.length ?? 0;
  if (n === 0) return fail("Nothing was changed — you may not have permission for these items.");
  return { ok: true, message: `${n} deliverable${n === 1 ? "" : "s"} updated` };
}

export async function deleteDeliverable(id: string): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  const { data, error } = await g.ctx.supabase.from("deliverables").delete().eq("id", id).eq("org_id", g.ctx.orgId).select("id");
  if (error) return dbError(error);
  if (!data?.length) return fail("Deliverable not found.");
  revalidatePath("/", "layout");
  redirect("/deliverables");
}
