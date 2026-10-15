// Pure helpers (no server-only imports) so they can be unit tested.
import type { z } from "zod";
import type { ActionState } from "./types.ts";

export const fail = (error: string, fieldErrors?: Record<string, string>): ActionState => ({ ok: false, error, fieldErrors });

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

