// Shared (client-safe) action result type.
export type ActionState =
  | null
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | { ok: true; message?: string };
