import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { ActionForm, Field, Input, Select } from "@/components/ui/form";
import { MemberRow } from "@/components/member-row";
import { RunButton } from "@/components/ui/toast";
import { createSeason, deleteSeason, inviteMember, revokeInvite, updateOrg, updateProfile } from "@/lib/actions/settings";
import { MANAGER_ROLES, ROLES, ROLE_DESC, ROLE_LABEL } from "@/lib/constants";
import { canSee, getCtx, getOrgData } from "@/lib/data";
import { fmtDate } from "@/lib/dates";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [ctx, data] = await Promise.all([getCtx(), getOrgData()]);
  const isAdmin = canSee(ctx, ["admin"]);
  return (
    <>
      <PageHeader title="Settings" description={`${ctx.orgName} · you are ${ctx.demo ? "browsing the demo" : `signed in as ${ROLE_LABEL[ctx.role]}`}`} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Your profile" />
          <div className="p-4"><ActionForm action={updateProfile} submitLabel="Save profile">
            <Field name="full_name" label="Display name" required><Input name="full_name" defaultValue={ctx.fullName ?? ""} required maxLength={120} /></Field>
            <p className="text-xs text-ink-500">Signed in as {ctx.email}</p>
          </ActionForm></div>
        </Card>
        <Card>
          <CardHeader title="Organization" />
          <div className="p-4">{isAdmin ? (
            <ActionForm action={updateOrg} submitLabel="Rename"><Field name="name" label="Organization name" required><Input name="name" defaultValue={ctx.orgName} required minLength={2} maxLength={120} /></Field></ActionForm>
          ) : <p className="text-sm text-ink-300">{ctx.orgName}<span className="block text-xs text-ink-500">Only admins can rename the organization.</span></p>}</div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Team & roles" sub={`${data.members.length} member${data.members.length === 1 ? "" : "s"}`} />
          <ul className="divide-y divide-ink-800">
            {data.members.map((m) => isAdmin
              ? <MemberRow key={m.user_id} userId={m.user_id} name={m.full_name || m.email || "Member"} email={m.email ?? ""} role={m.role} isSelf={m.user_id === ctx.userId} />
              : <li key={m.user_id} className="flex items-center justify-between px-4 py-3"><span><span className="block text-sm font-medium">{m.full_name || m.email}</span><span className="text-xs text-ink-400">{m.email}</span></span><span className="text-xs text-ink-300">{ROLE_LABEL[m.role]}</span></li>)}
          </ul>
          <dl className="grid gap-x-6 gap-y-1 border-t border-ink-700 p-4 text-xs sm:grid-cols-2">
            {ROLES.map((r) => <div key={r}><dt className="inline font-medium text-ink-200">{ROLE_LABEL[r]}: </dt><dd className="inline text-ink-400">{ROLE_DESC[r]}</dd></div>)}
          </dl>
        </Card>

        {isAdmin && (
          <Card className="lg:col-span-2">
            <CardHeader title="Invitations" sub="Invitees join automatically when they sign up or sign in with the invited email" />
            <div className="grid gap-5 p-4 md:grid-cols-2">
              <ActionForm action={inviteMember} submitLabel="Send invitation" resetOnSuccess>
                <Field name="email" label="Email" required><Input name="email" type="email" required /></Field>
                <Field name="role" label="Role"><Select name="role" defaultValue="read_only">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></Field>
              </ActionForm>
              <div>
                <p className="label-caps mb-2">Pending</p>
                {data.invites.length === 0 ? <p className="text-sm text-ink-500">No pending invitations.</p> : (
                  <ul className="divide-y divide-ink-800 rounded-lg border border-ink-700">{data.invites.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm"><span>{i.email}<span className="block text-xs text-ink-500">{ROLE_LABEL[i.role]} · {fmtDate(i.created_at)}</span></span>
                      <RunButton className="btn-ghost btn-sm text-danger" action={revokeInvite.bind(null, i.id)}>Revoke</RunButton></li>))}</ul>)}
              </div>
            </div>
          </Card>
        )}

        <Card className="lg:col-span-2">
          <CardHeader title="Seasons" sub="Used to filter the dashboard and group games" />
          {data.seasons.length === 0 ? <EmptyState title="No seasons" description="Add one to group games and filter the dashboard." /> : (
            <ul className="divide-y divide-ink-800">{data.seasons.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-4 py-2.5 text-sm"><span>{s.name} <span className="text-xs text-ink-400">· {fmtDate(s.starts_on)} – {fmtDate(s.ends_on)}</span></span>
                {canSee(ctx, MANAGER_ROLES) && <RunButton className="btn-ghost btn-sm text-danger" confirm="Remove this season?" action={deleteSeason.bind(null, s.id)}>Remove</RunButton>}</li>))}</ul>)}
          {canSee(ctx, MANAGER_ROLES) && (
            <div className="border-t border-ink-700 p-4"><ActionForm action={createSeason} submitLabel="Add season" resetOnSuccess>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field name="name" label="Name" required><Input name="name" required placeholder="2027 Season" /></Field>
                <Field name="starts_on" label="Starts" required><Input name="starts_on" type="date" required /></Field>
                <Field name="ends_on" label="Ends" required><Input name="ends_on" type="date" required /></Field>
              </div>
            </ActionForm></div>
          )}
        </Card>
      </div>
    </>
  );
}
