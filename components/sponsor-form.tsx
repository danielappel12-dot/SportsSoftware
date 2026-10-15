import { ActionForm, Field, Input, Select, Textarea } from "@/components/ui/form";
import { ACCOUNT_STATUSES, SPONSOR_TIERS, label } from "@/lib/constants";
import type { ActionState } from "@/lib/actions/types";
import type { Member, Sponsor } from "@/lib/types";

export function SponsorForm({
  action, sponsor, members, cancelHref,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  sponsor?: Sponsor; members: Member[]; cancelHref: string;
}) {
  const s = sponsor;
  return (
    <ActionForm action={action} cancelHref={cancelHref} submitLabel={s ? "Save changes" : "Create sponsor"} className="max-w-3xl">
      <div className="card grid gap-4 p-5 sm:grid-cols-2">
        <Field name="name" label="Company name" required className="sm:col-span-2"><Input name="name" defaultValue={s?.name} required maxLength={160} /></Field>
        <Field name="industry" label="Industry"><Input name="industry" defaultValue={s?.industry ?? ""} maxLength={80} placeholder="e.g. Financial services" /></Field>
        <Field name="tier" label="Sponsorship tier" required>
          <Select name="tier" defaultValue={s?.tier ?? "partner"}>{SPONSOR_TIERS.map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select>
        </Field>
        <Field name="status" label="Account status" required>
          <Select name="status" defaultValue={s?.status ?? "active"}>{ACCOUNT_STATUSES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select>
        </Field>
        <Field name="account_manager_id" label="Account manager">
          <Select name="account_manager_id" defaultValue={s?.account_manager_id ?? ""}>
            <option value="">Unassigned</option>
            {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>)}
          </Select>
        </Field>
        <Field name="logo" label="Logo" hint="PNG, JPG, WebP or GIF · stored privately" className="sm:col-span-2">
          <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="input file:mr-3 file:rounded file:border-0 file:bg-ink-700 file:px-2 file:py-1 file:text-xs file:text-ink-100" />
        </Field>
      </div>

      <div className="card grid gap-4 p-5 sm:grid-cols-3">
        <p className="label-caps sm:col-span-3">Primary contact</p>
        <Field name="contact_name" label="Name"><Input name="contact_name" defaultValue={s?.contact_name ?? ""} /></Field>
        <Field name="contact_email" label="Email"><Input name="contact_email" type="email" defaultValue={s?.contact_email ?? ""} /></Field>
        <Field name="contact_phone" label="Phone"><Input name="contact_phone" type="tel" defaultValue={s?.contact_phone ?? ""} /></Field>
      </div>

      <div className="card grid gap-4 p-5 sm:grid-cols-4">
        <p className="label-caps sm:col-span-4">Partnership term</p>
        <Field name="contract_value" label="Contract value (USD)"><Input name="contract_value" type="number" min={0} step="0.01" defaultValue={s?.contract_value ?? 0} /></Field>
        <Field name="contract_start" label="Start date"><Input name="contract_start" type="date" defaultValue={s?.contract_start ?? ""} /></Field>
        <Field name="contract_end" label="End date"><Input name="contract_end" type="date" defaultValue={s?.contract_end ?? ""} /></Field>
        <Field name="renewal_date" label="Renewal date"><Input name="renewal_date" type="date" defaultValue={s?.renewal_date ?? ""} /></Field>
      </div>

      <div className="card p-5">
        <Field name="notes" label="Internal notes" hint="Private to your team. Never included in sponsor-facing reports."><Textarea name="notes" defaultValue={s?.notes ?? ""} maxLength={10000} /></Field>
      </div>
    </ActionForm>
  );
}
