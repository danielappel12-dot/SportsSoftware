"use server";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isDemo, DEMO_MESSAGE } from "@/lib/env";
import { loginSchema, orgSchema, signupSchema } from "@/lib/schemas";
import { fail, parse, dbError, type ActionState } from "./util";
import { ORG_COOKIE } from "@/lib/data";

async function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function login(_: ActionState, fd: FormData): Promise<ActionState> {
  if (isDemo) return fail(DEMO_MESSAGE);
  const p = parse(loginSchema, fd);
  if (!p.ok) return p.state;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(p.data);
  if (error) return fail(error.message === "Invalid login credentials" ? "Incorrect email or password." : error.message);
  redirect("/dashboard");
}

export async function signup(_: ActionState, fd: FormData): Promise<ActionState> {
  if (isDemo) return fail(DEMO_MESSAGE);
  const p = parse(signupSchema, fd);
  if (!p.ok) return p.state;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: p.data.email,
    password: p.data.password,
    options: { data: { full_name: p.data.full_name }, emailRedirectTo: `${await siteUrl()}/auth/callback` },
  });
  if (error) return fail(error.message);
  if (data.session) redirect("/dashboard");
  return { ok: true, message: "Check your email to confirm your account, then sign in." };
}

export async function logout() {
  if (!isDemo) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}

export async function createOrganization(_: ActionState, fd: FormData): Promise<ActionState> {
  if (isDemo) return fail(DEMO_MESSAGE);
  const p = parse(orgSchema, fd);
  if (!p.ok) return p.state;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data, error } = await supabase.rpc("create_organization", { _name: p.data.name });
  if (error) return dbError(error);
  (await cookies()).set(ORG_COOKIE, data as string, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  redirect("/dashboard");
}

export async function switchOrganization(orgId: string) {
  if (isDemo) return;
  (await cookies()).set(ORG_COOKIE, orgId, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
