"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROLES } from "@/lib/constants";
import { dbError, fail, guard, type ActionState } from "./util";

export async function markRead(id: string): Promise<ActionState> {
  const g = await guard(ROLES);
  if (!g.ok) return g.state;
  if (!z.uuid().safeParse(id).success) return fail("Invalid notification.");
  const { error } = await g.ctx.supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).eq("user_id", g.ctx.userId);
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function markAllRead(): Promise<ActionState> {
  const g = await guard(ROLES);
  if (!g.ok) return g.state;
  const { error } = await g.ctx.supabase.from("notifications").update({ read_at: new Date().toISOString() })
    .eq("user_id", g.ctx.userId).eq("org_id", g.ctx.orgId).is("read_at", null);
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true, message: "All caught up" };
}
