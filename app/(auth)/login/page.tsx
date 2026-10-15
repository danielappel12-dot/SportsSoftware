import Link from "next/link";
import { ActionForm, Field, Input } from "@/components/ui/form";
import { login } from "@/lib/actions/auth";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      <h1 className="text-lg font-semibold">Sign in</h1>
      <p className="mb-5 mt-1 text-sm text-ink-400">Welcome back to your partnership workspace.</p>
      {error === "callback" && <p className="mb-4 rounded-lg border border-danger/40 bg-danger/10 p-2.5 text-xs text-danger">That confirmation link is invalid or expired. Try signing in, or sign up again.</p>}
      <ActionForm action={login} submitLabel="Sign in">
        <Field name="email" label="Email" required><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field name="password" label="Password" required><Input name="password" type="password" autoComplete="current-password" required /></Field>
      </ActionForm>
      <p className="mt-5 text-center text-xs text-ink-400">New here? <Link href="/signup" className="text-brand hover:underline">Create an account</Link></p>
    </>
  );
}
