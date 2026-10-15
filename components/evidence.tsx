import { FileText, ImageIcon } from "lucide-react";
import { Badge, EmptyState } from "@/components/ui";
import { ActionForm, Field, Input } from "@/components/ui/form";
import { RunButton } from "@/components/ui/toast";
import { deleteEvidence, setEvidenceInReport, uploadEvidence } from "@/lib/actions/assets";
import { fmtDate } from "@/lib/dates";
import type { Asset, Evidence } from "@/lib/types";

export function EvidenceUploader({ sponsorId, deliverableId, eventId, taskId, compact }: {
  sponsorId?: string; deliverableId?: string; eventId?: string; taskId?: string; compact?: boolean;
}) {
  return (
    <ActionForm action={uploadEvidence} submitLabel="Upload evidence" resetOnSuccess className={compact ? "" : "max-w-xl"}>
      {sponsorId && <input type="hidden" name="sponsor_id" value={sponsorId} />}
      {deliverableId && <input type="hidden" name="deliverable_id" value={deliverableId} />}
      {eventId && <input type="hidden" name="event_id" value={eventId} />}
      {taskId && <input type="hidden" name="event_task_id" value={taskId} />}
      <Field name="file" label="Photos or PDFs" hint="PNG, JPG, WebP, GIF or PDF · up to 25 MB each · up to 10 files">
        <input id="file" name="file" type="file" multiple accept="image/*,application/pdf" capture={undefined}
          className="input file:mr-3 file:rounded file:border-0 file:bg-ink-700 file:px-2 file:py-1 file:text-xs file:text-ink-100" />
      </Field>
      <Field name="caption" label="Caption (optional)"><Input name="caption" maxLength={500} placeholder="What does this show?" /></Field>
      <label className="flex items-center gap-2 text-xs text-ink-300"><input type="checkbox" name="include_in_report" defaultChecked className="accent-[var(--color-brand)]" /> Include in sponsor reports</label>
    </ActionForm>
  );
}

export function EvidenceGallery({ items, assets, canManage, empty }: { items: Evidence[]; assets: Asset[]; canManage: boolean; empty?: string }) {
  if (!items.length) return <EmptyState icon={<ImageIcon className="size-5" />} title="No evidence yet" description={empty ?? "Photos and documents proving fulfillment will appear here."} />;
  return (
    <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((e) => {
        const a = assets.find((x) => x.id === e.asset_id);
        const isImg = a?.mime_type.startsWith("image/");
        return (
          <li key={e.id} className="overflow-hidden rounded-lg border border-ink-700 bg-ink-850">
            <a href={`/api/assets/${e.asset_id}`} target="_blank" rel="noopener" className="block aspect-[4/3] bg-ink-800">
              {isImg ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/assets/${e.asset_id}`} alt={e.caption ?? a?.original_filename ?? "Evidence"} loading="lazy" className="size-full object-cover" />
              ) : (
                <span className="grid size-full place-items-center text-ink-400"><FileText className="size-8" /></span>
              )}
            </a>
            <div className="space-y-1.5 p-2.5">
              <p className="line-clamp-2 text-xs text-ink-200">{e.caption || a?.original_filename}</p>
              <div className="flex items-center justify-between gap-1 text-[11px] text-ink-500">
                <span>{fmtDate(e.created_at)}</span>
                {e.include_in_report ? <Badge tone="info">In reports</Badge> : <Badge>Private</Badge>}
              </div>
              {canManage && (
                <div className="flex gap-1.5">
                  <RunButton className="btn-ghost btn-sm" action={setEvidenceInReport.bind(null, e.id, !e.include_in_report)}>{e.include_in_report ? "Hide from reports" : "Include"}</RunButton>
                  <RunButton className="btn-ghost btn-sm text-danger" confirm="Delete this file permanently?" action={deleteEvidence.bind(null, e.id)}>Delete</RunButton>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
