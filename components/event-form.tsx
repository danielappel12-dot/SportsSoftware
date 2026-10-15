import { ActionForm, Field, Input, Select, Textarea } from "@/components/ui/form";
import { DateTimeInput } from "@/components/datetime-field";
import { EVENT_STATUSES, label } from "@/lib/constants";
import type { ActionState } from "@/lib/actions/types";
import type { GameEvent, Season } from "@/lib/types";

export function EventForm({ action, event, seasons, cancelHref }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; event?: GameEvent; seasons: Season[]; cancelHref: string }) {
  return (
    <ActionForm action={action} cancelHref={cancelHref} submitLabel={event ? "Save game" : "Create game"} className="max-w-2xl">
      <div className="card grid gap-4 p-5 sm:grid-cols-2">
        <Field name="name" label="Name" required className="sm:col-span-2"><Input name="name" defaultValue={event?.name} required maxLength={160} placeholder="e.g. Family Sunday vs Ridge Hawks" /></Field>
        <Field name="starts_at" label="Date & time" required hint="Shown in each viewer's local time zone."><DateTimeInput name="starts_at" defaultIso={event?.starts_at} required /></Field>
        <Field name="status" label="Status"><Select name="status" defaultValue={event?.status ?? "planned"}>{EVENT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></Field>
        <Field name="opponent" label="Opponent / event description"><Input name="opponent" defaultValue={event?.opponent ?? ""} maxLength={160} /></Field>
        <Field name="venue" label="Venue"><Input name="venue" defaultValue={event?.venue ?? ""} maxLength={160} /></Field>
        <Field name="season_id" label="Season"><Select name="season_id" defaultValue={event?.season_id ?? ""}><option value="">None</option>{seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field name="description" label="Notes" className="sm:col-span-2"><Textarea name="description" rows={3} defaultValue={event?.description ?? ""} /></Field>
      </div>
    </ActionForm>
  );
}
