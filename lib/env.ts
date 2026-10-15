export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** Demo mode: Supabase is not configured (or explicitly disabled). Data is fictional and read-only. */
export const isDemo =
  process.env.NEXT_PUBLIC_DEMO_MODE === "true" || !SUPABASE_URL || !SUPABASE_KEY;

export const DEMO_MESSAGE =
  "Demo mode: this is fictional sample data and nothing can be saved. Configure Supabase (see README) to enable changes.";
