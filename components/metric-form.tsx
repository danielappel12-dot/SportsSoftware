import { ActionForm, Field, Input, Select } from "@/components/ui/form";
import { addMetric } from "@/lib/actions/reports";
import { todayISO } from "@/lib/dates";
import type { GameEvent } from "@/lib/types";

export function MetricForm({ sponsorId, events }: { sponsorId: string; events: GameEvent[] }) {
  return (
    <ActionForm action={addMetric} submitLabel="Record metric" resetOnSuccess>
      <input type="hidden" name="sponsor_id" value={sponsorId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="metric_name" label="Metric" required className="sm:col-span-2"><Input name="metric_name" placeholder="e.g. Social impressions" required /></Field>
        <Field name="metric_value" label="Value" required><Input name="metric_value" type="number" step="any" required /></Field>
        <Field name="unit" label="Unit"><Input name="unit" placeholder="fans, impressions…" /></Field>
        <Field name="recorded_on" label="Date" required><Input name="recorded_on" type="date" defaultValue={todayISO()} required /></Field>
        <Field name="event_id" label="Game (optional)"><Select name="event_id" defaultValue=""><option value="">—</option>{events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
      </div>
    </ActionForm>
  );
}
