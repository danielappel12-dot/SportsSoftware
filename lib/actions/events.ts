"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { MANAGER_ROLES, TASK_STATUSES, WORKER_ROLES } from "@/lib/constants";
import { activationSchema, eventSchema, taskSchema } from "@/lib/schemas";
import { assertMember, dbError, fail, guard, parse, withNulls, type ActionState } from "./util";

const EVENT_KEYS = Object.keys(eventSchema.shape);
const iso = (v: string) => new Date(v).toISOString();

export async function createEvent(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  const p = parse(eventSchema, fd);
  if (!p.ok) return p.state;
  const { data, error } = await g.ctx.supabase.from("events")
    .insert({ ...withNulls(EVENT_KEYS, p.data), starts_at: iso(p.data.starts_at), org_id: g.ctx.orgId, created_by: g.ctx.userId }).select("id").single();
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  redirect(`/game-day/${data.id}`);
}

export async function updateEvent(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  const p = parse(eventSchema, fd);
  if (!p.ok) return p.state;
  const { data, error } = await g.ctx.supabase.from("events")
    .update({ ...withNulls(EVENT_KEYS, p.data), starts_at: iso(p.data.starts_at) }).eq("id", id).eq("org_id", g.ctx.orgId).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return fail("Game not found.");
  revalidatePath("/", "layout");
  redirect(`/game-day/${id}`);
}

export async function setEventStatus(id: string, status: string): Promise<ActionState> {
  const g = await guard(WORKER_ROLES);
  if (!g.ok) return g.state;
  const p = parse(eventSchema.pick({ status: true }), { status });
  if (!p.ok) return p.state;
  const { data, error } = await g.ctx.supabase.from("events").update({ status: p.data.status }).eq("id", id).eq("org_id", g.ctx.orgId).select("id");
  if (error) return dbError(error);
  if (!data?.length) return fail("Game not found or you can't change it.");
  revalidatePath("/", "layout");
  return { ok: true, message: "Game status updated" };
}

export async function deleteEvent(id: string): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  const { data, error } = await g.ctx.supabase.from("events").delete().eq("id", id).eq("org_id", g.ctx.orgId).select("id");
  if (error) return dbError(error);
  if (!data?.length) return fail("Game not found.");
  revalidatePath("/", "layout");
  redirect("/game-day");
}

export async function addActivation(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  const p = parse(activationSchema, fd);
  if (!p.ok) return p.state;
  if (p.data.deliverable_id) {
    const { data } = await g.ctx.supabase.from("deliverables").select("sponsor_id").eq("id", p.data.deliverable_id).eq("org_id", g.ctx.orgId).maybeSingle();
    if (!data || data.sponsor_id !== p.data.sponsor_id) return fail("That deliverable doesn't belong to the chosen sponsor.", { deliverable_id: "Pick a deliverable of this sponsor" });
  }
  const { error } = await g.ctx.supabase.from("activations").insert({
    org_id: g.ctx.orgId, event_id: p.data.event_id, sponsor_id: p.data.sponsor_id, deliverable_id: p.data.deliverable_id ?? null,
    title: p.data.title, details: p.data.details ?? null,
  });
  if (error) return dbError(error);
  // Link the deliverable to this game so it shows up in game-day filters.
  if (p.data.deliverable_id) await g.ctx.supabase.from("deliverables").update({ event_id: p.data.event_id }).eq("id", p.data.deliverable_id).is("event_id", null);
  revalidatePath("/", "layout");
  return { ok: true, message: "Activation added" };
}

export async function deleteActivation(id: string): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  const { data, error } = await g.ctx.supabase.from("activations").delete().eq("id", id).eq("org_id", g.ctx.orgId).select("id");
  if (error) return dbError(error);
  if (!data?.length) return fail("Activation not found.");
  revalidatePath("/", "layout");
  return { ok: true, message: "Activation removed" };
}

export async function addTask(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  const p = parse(taskSchema, fd);
  if (!p.ok) return p.state;
  const bad = await assertMember(g, p.data.assigned_to);
  if (bad) return bad;
  const { count } = await g.ctx.supabase.from("event_tasks").select("id", { count: "exact", head: true }).eq("event_id", p.data.event_id);
  const { error } = await g.ctx.supabase.from("event_tasks").insert({
    org_id: g.ctx.orgId, event_id: p.data.event_id, title: p.data.title, activation_id: p.data.activation_id ?? null,
    scheduled_at: p.data.scheduled_at ? iso(p.data.scheduled_at) : null, assigned_to: p.data.assigned_to ?? null, position: (count ?? 0) + 1,
  });
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true, message: "Task added" };
}

export async function deleteTask(id: string): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  const { data, error } = await g.ctx.supabase.from("event_tasks").delete().eq("id", id).eq("org_id", g.ctx.orgId).select("id");
  if (error) return dbError(error);
  if (!data?.length) return fail("Task not found.");
  revalidatePath("/", "layout");
  return { ok: true, message: "Task removed" };
}

/** Complete / reopen / flag a run-of-show task. Blocking requires a note so the team knows why. */
export async function setTaskStatus(id: string, status: string, note?: string): Promise<ActionState> {
  const g = await guard(WORKER_ROLES);
  if (!g.ok) return g.state;
  const s = z.enum(TASK_STATUSES).safeParse(status);
  if (!s.success) return fail("Invalid task status.");
  const blocker = note?.trim().slice(0, 1000);
  if (s.data === "blocked" && !blocker) return fail("Describe the blocker so the team can help.");
  const { data, error } = await g.ctx.supabase.from("event_tasks")
    .update({ status: s.data, blocker_note: s.data === "blocked" ? blocker : null, completed_at: null, completed_by: null })
    .eq("id", id).eq("org_id", g.ctx.orgId).select("id");
  if (error) return dbError(error);
  if (!data?.length) return fail("Task not found or you can't change it.");
  revalidatePath("/", "layout");
  return { ok: true, message: s.data === "done" ? "Task complete" : s.data === "blocked" ? "Blocker flagged — managers notified" : "Task reopened" };
}
