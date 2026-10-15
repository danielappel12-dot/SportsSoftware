import Link from "next/link";
import { ActionForm, Field, Input } from "@/components/ui/form";
import { signup } from "@/lib/actions/auth";

export const metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <>
      <h1 className="text-lg font-semibold">Create your account</h1>
      <p className="mb-5 mt-1 text-sm text-ink-400">Invited by a teammate? Sign up with the email they invited and you&apos;ll join automatically.</p>
      <ActionForm action={signup} submitLabel="Create account">
        <Field name="full_name" label="Full name" required><Input name="full_name" autoComplete="name" required /></Field>
        <Field name="email" label="Work email" required><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field name="password" label="Password" hint="At least 8 characters" required><Input name="password" type="password" autoComplete="new-password" minLength={8} required /></Field>
      </ActionForm>
      <p className="mt-5 text-center text-xs text-ink-400">Already have an account? <Link href="/login" className="text-brand hover:underline">Sign in</Link></p>
    </>
  );
}
