import { ActionForm, Field, Input, Select, Textarea } from "@/components/ui/form";
import { CONTRACT_STATUSES, label } from "@/lib/constants";
import type { ActionState } from "@/lib/actions/types";
import type { Contract, Sponsor } from "@/lib/types";

export function ContractForm({ action, contract, sponsors, defaultSponsor, cancelHref }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>; contract?: Contract; sponsors: Sponsor[]; defaultSponsor?: string; cancelHref: string;
}) {
  const c = contract;
  return (
    <ActionForm action={action} cancelHref={cancelHref} submitLabel={c ? "Save contract" : "Create contract"} className="max-w-3xl">
      <div className="card grid gap-4 p-5 sm:grid-cols-2">
        <Field name="sponsor_id" label="Sponsor" required>
          <Select name="sponsor_id" defaultValue={c?.sponsor_id ?? defaultSponsor ?? ""} required disabled={!!c}>
            <option value="" disabled>Choose a sponsor…</option>
            {sponsors.filter((s) => s.status !== "archived" || s.id === c?.sponsor_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          {c && <input type="hidden" name="sponsor_id" value={c.sponsor_id} />}
        </Field>
        <Field name="name" label="Contract name" required><Input name="name" defaultValue={c?.name} required maxLength={160} placeholder="e.g. Presenting Partner 2026" /></Field>
        <Field name="status" label="Status"><Select name="status" defaultValue={c?.status ?? "active"}>{CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></Field>
        <Field name="value" label="Value (USD)"><Input name="value" type="number" min={0} step="0.01" defaultValue={c?.value ?? 0} /></Field>
        <Field name="start_date" label="Start date" required><Input name="start_date" type="date" defaultValue={c?.start_date} required /></Field>
        <Field name="end_date" label="End date" required><Input name="end_date" type="date" defaultValue={c?.end_date} required /></Field>
        <Field name="renewal_date" label="Renewal date"><Input name="renewal_date" type="date" defaultValue={c?.renewal_date ?? ""} /></Field>
        <Field name="terms_summary" label="Terms summary" hint="Rights and obligations at a glance." className="sm:col-span-2"><Textarea name="terms_summary" defaultValue={c?.terms_summary ?? ""} rows={3} /></Field>
        <Field name="notes" label="Internal notes" hint="Private. Never shown in sponsor reports." className="sm:col-span-2"><Textarea name="notes" defaultValue={c?.notes ?? ""} rows={3} /></Field>
      </div>
    </ActionForm>
  );
}
