import { ActionForm, Field, Input } from "@/components/ui/form";
import { createOrganization, logout } from "@/lib/actions/auth";
import { getUserOnly } from "@/lib/data";

export const metadata = { title: "Set up your organization" };

export default async function OnboardingPage() {
  const { user } = await getUserOnly();
  return (
    <>
      <h1 className="text-lg font-semibold">Create your organization</h1>
      <p className="mb-5 mt-1 text-sm text-ink-400">
        Signed in as {user.email}. Your organization holds all sponsors, contracts and games — you&apos;ll be its admin.
        If a teammate invited you, ask them to invite <b>{user.email}</b> and then reload.
      </p>
      <ActionForm action={createOrganization} submitLabel="Create organization">
        <Field name="name" label="Team / organization name" required><Input name="name" placeholder="e.g. Riverton Rapids" required /></Field>
      </ActionForm>
      <form action={logout} className="mt-4 text-center"><button className="text-xs text-ink-400 hover:text-ink-200">Sign out</button></form>
    </>
  );
}
