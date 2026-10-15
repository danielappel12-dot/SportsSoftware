import { FileText } from "lucide-react";
import { Badge, EmptyState, StatusBadge } from "@/components/ui";
import { ActionForm, Field, Input, Select } from "@/components/ui/form";
import { RunButton } from "@/components/ui/toast";
import { deleteAsset, setAssetApproval, updateAssetMeta, uploadAssetAction } from "@/lib/actions/assets";
import { ASSET_CATEGORIES, APPROVAL_STATUSES, label } from "@/lib/constants";
import { daysBetween, fmtBytes, fmtDate } from "@/lib/dates";
import type { Asset, Sponsor } from "@/lib/types";

export function AssetUploadForm({ sponsors, sponsorId, canApprove }: { sponsors: Sponsor[]; sponsorId?: string; canApprove: boolean }) {
  return (
    <ActionForm action={uploadAssetAction} submitLabel="Upload" resetOnSuccess className="max-w-xl">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="sponsor_id" label="Sponsor" required>
          <Select name="sponsor_id" defaultValue={sponsorId ?? ""} required>
            <option value="" disabled>Choose a sponsor…</option>{sponsors.filter((s) => s.status !== "archived").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field name="category" label="Category" required>
          <Select name="category" defaultValue="creative">{ASSET_CATEGORIES.filter((c) => c !== "evidence").map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>
        </Field>
        {canApprove && (
          <Field name="approval_status" label="Approval status"><Select name="approval_status" defaultValue="pending">{APPROVAL_STATUSES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select></Field>
        )}
        <Field name="expires_on" label="Expiration date (optional)"><Input name="expires_on" type="date" /></Field>
        <Field name="file" label="Files" hint="PNG, JPG, WebP, GIF or PDF · up to 25 MB each" className="sm:col-span-2">
          <input id="file" name="file" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
            className="input file:mr-3 file:rounded file:border-0 file:bg-ink-700 file:px-2 file:py-1 file:text-xs file:text-ink-100" />
        </Field>
      </div>
    </ActionForm>
  );
}

export function AssetGrid({ assets, sponsors, today, canManage, showSponsor = true }: {
  assets: Asset[]; sponsors: Sponsor[]; today: string; canManage: boolean; showSponsor?: boolean;
}) {
  if (!assets.length) return <EmptyState icon={<FileText className="size-5" />} title="No assets" description="Upload logos, approved creative and sponsor documents." />;
  return (
    <ul className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {assets.map((a) => {
        const sponsor = sponsors.find((s) => s.id === a.sponsor_id);
        const exp = a.expires_on ? daysBetween(today, a.expires_on) : null;
        return (
          <li key={a.id} className="flex flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-850">
            <a href={`/api/assets/${a.id}`} target="_blank" rel="noopener" className="grid aspect-[16/10] place-items-center bg-ink-800" aria-label={`Open ${a.original_filename}`}>
              {a.mime_type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/assets/${a.id}`} alt={a.original_filename} loading="lazy" className="size-full object-contain" />
              ) : <FileText className="size-9 text-ink-400" />}
            </a>
            <div className="flex flex-1 flex-col gap-2 p-3">
              <div>
                <p className="truncate text-sm font-medium" title={a.original_filename}>{a.original_filename}</p>
                <p className="text-xs text-ink-400">{showSponsor && sponsor ? `${sponsor.name} · ` : ""}{label(a.category)} · {fmtBytes(a.size_bytes)}</p>
                <p className="text-[11px] text-ink-500">{a.mime_type.split("/")[1]?.toUpperCase()} · uploaded {fmtDate(a.created_at)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={a.approval_status} />
                {exp !== null && (exp < 0 ? <Badge tone="danger">Expired</Badge> : exp <= 30 ? <Badge tone="warn">Expires in {exp}d</Badge> : <Badge>Expires {fmtDate(a.expires_on)}</Badge>)}
              </div>
              <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                <a href={`/api/assets/${a.id}?download=1`} className="btn-secondary btn-sm">Download</a>
                {canManage && a.approval_status !== "approved" && <RunButton className="btn-ghost btn-sm text-ok" action={setAssetApproval.bind(null, a.id, "approved")}>Approve</RunButton>}
                {canManage && a.approval_status !== "rejected" && <RunButton className="btn-ghost btn-sm" action={setAssetApproval.bind(null, a.id, "rejected")}>Reject</RunButton>}
                {canManage && <RunButton className="btn-ghost btn-sm text-danger" confirm="Delete this file permanently?" action={deleteAsset.bind(null, a.id)}>Delete</RunButton>}
              </div>
              {canManage && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-ink-400 hover:text-ink-200">Edit details</summary>
                  <ActionForm action={updateAssetMeta.bind(null, a.id)} submitLabel="Save" className="mt-2">
                    <Field name="category" label="Category"><Select name="category" defaultValue={a.category}>{ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select></Field>
                    <Field name="expires_on" label="Expires"><Input name="expires_on" type="date" defaultValue={a.expires_on ?? ""} /></Field>
                  </ActionForm>
                </details>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
