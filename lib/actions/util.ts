import "server-only";
import type { z } from "zod";
import { getCtx, type Ctx } from "@/lib/data";
import { DEMO_MESSAGE } from "@/lib/env";
import { ROLE_LABEL, type Role } from "@/lib/constants";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ActionState } from "./types";
export type { ActionState };

export const fail = (error: string, fieldErrors?: Record<string, string>): ActionState => ({ ok: false, error, fieldErrors });

/** Translate Postgres / PostgREST errors into messages a user can act on. */
export function dbError(err: { code?: string; message: string; details?: string | null }): ActionState {
  switch (err.code) {
    case "23505": return fail("That record already exists (duplicate name or value).");
    case "23503": return fail("A linked record is missing or belongs to a different organization.");
    case "23514": return fail(`A value was rejected by a database rule: ${err.message}`);
    case "42501": return fail("You don't have permission to do that.");
    case "P0001": return fail(err.message);
    default: return fail(err.message || "Something went wrong. Please try again.");
  }
}

export function formObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith("$ACTION")) continue;
    const vals = fd.getAll(key).filter((v): v is string => typeof v === "string");
    const cleaned = vals.map((v) => v.trim());
    if (cleaned.length > 1) out[key] = cleaned.filter(Boolean);
    else if (cleaned[0] !== "") out[key] = cleaned[0];
  }
  return out;
}

export function parse<S extends z.ZodType>(
  schema: S,
  input: FormData | Record<string, unknown>,
): { ok: true; data: z.output<S> } | { ok: false; state: ActionState } {
  const raw = input instanceof FormData ? formObject(input) : input;
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "_");
    fieldErrors[key] ??= issue.message;
  }
  const first = Object.values(fieldErrors)[0];
  return { ok: false, state: fail(first ? `Please fix the highlighted fields. ${first}` : "Invalid input.", fieldErrors) };
}

/** Optional keys that are absent after parsing become explicit nulls (so edits can clear fields). */
export function withNulls<T extends Record<string, unknown>>(shapeKeys: string[], data: T): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const k of shapeKeys) if (out[k] === undefined) out[k] = null;
  return out;
}

export type Guarded = { ok: true; ctx: Ctx & { supabase: SupabaseClient } } | { ok: false; state: ActionState };

/** Server-side authorization for every mutation. RLS enforces the same rules again in the database. */
export async function guard(roles: readonly Role[]): Promise<Guarded> {
  const ctx = await getCtx();
  if (ctx.demo || !ctx.supabase) return { ok: false, state: fail(DEMO_MESSAGE) };
  if (!roles.includes(ctx.role)) {
    return { ok: false, state: fail(`Your role (${ROLE_LABEL[ctx.role]}) isn't allowed to do this.`) };
  }
  return { ok: true, ctx: ctx as Ctx & { supabase: SupabaseClient } };
}

/** Verify a user id is a member of the active org (used for assignee / account-manager fields). */
export async function assertMember(g: Extract<Guarded, { ok: true }>, userId: string | undefined | null): Promise<ActionState> {
  if (!userId) return null;
  const { data } = await g.ctx.supabase.from("memberships").select("user_id").eq("org_id", g.ctx.orgId).eq("user_id", userId).maybeSingle();
  return data ? null : fail("The selected staff member is not part of this organization.", { assigned_to: "Not a member of this organization" });
}
