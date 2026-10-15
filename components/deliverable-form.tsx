import { ActionForm, Field, Input, Select, Textarea } from "@/components/ui/form";
import { DELIVERABLE_CATEGORIES, DELIVERABLE_STATUSES, PRIORITIES, label } from "@/lib/constants";
import type { ActionState } from "@/lib/actions/types";
import type { Contract, Deliverable, GameEvent, Member, Sponsor } from "@/lib/types";

export function DeliverableForm({ action, deliverable, sponsors, contracts, events, members, defaults, cancelHref, limited }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>; deliverable?: Deliverable; sponsors: Sponsor[]; contracts: Contract[];
  events: GameEvent[]; members: Member[]; defaults?: { sponsor?: string; contract?: string; event?: string }; cancelHref: string;
  /** Creative staff: only status / completion / notes are editable. */ limited?: boolean;
}) {
  const d = deliverable;
  const ro = limited ? { disabled: true } : {};
  return (
    <ActionForm action={action} cancelHref={cancelHref} submitLabel={d ? "Save changes" : "Create deliverable"}>
      <div className="card grid gap-4 p-5 sm:grid-cols-2">
        <Field name="sponsor_id" label="Sponsor" required>
          <Select name="sponsor_id" defaultValue={d?.sponsor_id ?? defaults?.sponsor ?? ""} required {...ro}>
            <option value="" disabled>Choose a sponsor…</option>
            {sponsors.filter((s) => s.status !== "archived" || s.id === d?.sponsor_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          {limited && d && <input type="hidden" name="sponsor_id" value={d.sponsor_id} />}
        </Field>
        <Field name="contract_id" label="Associated contract" hint="Must belong to the chosen sponsor.">
          <Select name="contract_id" defaultValue={d?.contract_id ?? defaults?.contract ?? ""} {...ro}>
            <option value="">None</option>
            {contracts.map((c) => <option key={c.id} value={c.id}>{sponsors.find((s) => s.id === c.sponsor_id)?.name} — {c.name}</option>)}
          </Select>
        </Field>
        <Field name="description" label="Description" required className="sm:col-span-2">
          <Textarea name="description" rows={2} defaultValue={d?.description} required maxLength={2000} readOnly={limited} />
        </Field>
        <Field name="category" label="Category" required>
          <Select name="category" defaultValue={d?.category ?? "other"} {...ro}>{DELIVERABLE_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>
        </Field>
        <Field name="event_id" label="Associated game / event">
          <Select name="event_id" defaultValue={d?.event_id ?? defaults?.event ?? ""} {...ro}>
            <option value="">None (use due date)</option>{events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
        </Field>
        <Field name="due_date" label="Due date"><Input name="due_date" type="date" defaultValue={d?.due_date ?? ""} readOnly={limited} /></Field>
        <Field name="assigned_to" label="Assigned staff">
          <Select name="assigned_to" defaultValue={d?.assigned_to ?? ""} {...ro}>
            <option value="">Unassigned</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>)}
          </Select>
        </Field>
        <Field name="priority" label="Priority"><Select name="priority" defaultValue={d?.priority ?? "medium"} {...ro}>{PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}</Select></Field>
        <Field name="status" label="Status" required><Select name="status" defaultValue={d?.status ?? "not_started"}>{DELIVERABLE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></Field>
        <Field name="completed_date" label="Completion date" hint="Used when status is Completed. Defaults to today."><Input name="completed_date" type="date" defaultValue={d?.completed_at?.slice(0, 10) ?? ""} /></Field>
        <Field name="estimated_value" label="Estimated value (USD, optional)"><Input name="estimated_value" type="number" min={0} step="0.01" defaultValue={d?.estimated_value ?? ""} readOnly={limited} /></Field>
        <Field name="notes" label="Internal notes" hint="Private. Never shown in sponsor reports." className="sm:col-span-2"><Textarea name="notes" rows={3} defaultValue={d?.notes ?? ""} /></Field>
      </div>
    </ActionForm>
  );
}
