"use server";
import { revalidatePath } from "next/cache";
import { MANAGER_ROLES } from "@/lib/constants";
import { metricSchema } from "@/lib/schemas";
import { dbError, fail, guard, parse, type ActionState } from "./util";

export async function addMetric(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  const p = parse(metricSchema, fd);
  if (!p.ok) return p.state;
  const { error } = await g.ctx.supabase.from("sponsor_metrics").insert({
    org_id: g.ctx.orgId, sponsor_id: p.data.sponsor_id, event_id: p.data.event_id ?? null, metric_name: p.data.metric_name,
    metric_value: p.data.metric_value, unit: p.data.unit ?? null, recorded_on: p.data.recorded_on, created_by: g.ctx.userId,
  });
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true, message: "Metric recorded" };
}

export async function deleteMetric(id: string): Promise<ActionState> {
  const g = await guard(MANAGER_ROLES);
  if (!g.ok) return g.state;
  const { data, error } = await g.ctx.supabase.from("sponsor_metrics").delete().eq("id", id).eq("org_id", g.ctx.orgId).select("id");
  if (error) return dbError(error);
  if (!data?.length) return fail("Metric not found.");
  revalidatePath("/", "layout");
  return { ok: true, message: "Metric removed" };
}
