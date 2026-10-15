import { FolderOpen, Upload } from "lucide-react";
import { Card, CardHeader, EmptyState, PageHeader, SponsorLogo } from "@/components/ui";
import { FilterForm } from "@/components/filter-form";
import { AssetGrid, AssetUploadForm } from "@/components/assets";
import { APPROVAL_STATUSES, ASSET_CATEGORIES, MANAGER_ROLES, WORKER_ROLES, label } from "@/lib/constants";
import { canSee, getCtx, getOrgData } from "@/lib/data";
import { addDays, todayISO } from "@/lib/dates";
import { one, type SP } from "@/lib/view";

export const metadata = { title: "Asset Library" };

export default async function AssetsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [ctx, data] = await Promise.all([getCtx(), getOrgData()]);
  const today = todayISO();
  const f = { sponsor: one(sp.sponsor), category: one(sp.category), approval: one(sp.approval), expiry: one(sp.expiry), q: one(sp.q).toLowerCase() };
  const assets = data.assets.filter((a) => {
    if (f.category ? a.category !== f.category : a.category === "evidence") return false;
    if (f.sponsor && a.sponsor_id !== f.sponsor) return false;
    if (f.approval && a.approval_status !== f.approval) return false;
    if (f.expiry === "soon" && !(a.expires_on && a.expires_on >= today && a.expires_on <= addDays(today, 30))) return false;
    if (f.expiry === "expired" && !(a.expires_on && a.expires_on < today)) return false;
    if (f.q && !a.original_filename.toLowerCase().includes(f.q)) return false;
    return true;
  });
  const groups = data.sponsors.map((s) => ({ s, items: assets.filter((a) => a.sponsor_id === s.id).sort((a, b) => a.category.localeCompare(b.category) || b.created_at.localeCompare(a.created_at)) })).filter((g) => g.items.length);
  const canUpload = canSee(ctx, WORKER_ROLES);
  const canManage = canSee(ctx, MANAGER_ROLES);
  const expiring = data.assets.filter((a) => a.expires_on && a.expires_on <= addDays(today, 30)).length;

  return (
    <>
      <PageHeader title="Asset Library" description={`Private storage for logos, creative and documents · ${data.assets.filter((a) => a.category !== "evidence").length} files${expiring ? ` · ${expiring} expiring or expired` : ""}`} />
      {canUpload && (
        <details className="card mb-5 open:pb-1">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium"><Upload className="size-4 text-brand" /> Upload files</summary>
          <div className="border-t border-ink-700 p-4">
            {data.sponsors.length ? <AssetUploadForm sponsors={data.sponsors} canApprove={canManage} /> : <p className="text-sm text-ink-400">Add a sponsor first — every file is filed under one.</p>}
          </div>
        </details>
      )}
      <div className="mb-4">
        <FilterForm>
          <input name="q" type="search" defaultValue={sp.q as string} placeholder="Search filenames…" className="input w-52" aria-label="Search files" />
          <select name="sponsor" defaultValue={f.sponsor} className="input w-auto" aria-label="Sponsor"><option value="">All sponsors</option>{data.sponsors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select name="category" defaultValue={f.category} className="input w-auto" aria-label="Category"><option value="">All categories</option>{ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select>
          <select name="approval" defaultValue={f.approval} className="input w-auto" aria-label="Approval"><option value="">Any approval</option>{APPROVAL_STATUSES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select>
          <select name="expiry" defaultValue={f.expiry} className="input w-auto" aria-label="Expiration"><option value="">Any expiration</option><option value="soon">Expiring in 30 days</option><option value="expired">Expired</option></select>
        </FilterForm>
      </div>
      {groups.length === 0 ? (
        <Card><EmptyState icon={<FolderOpen className="size-5" />} title={data.assets.length ? "No files match these filters" : "No files uploaded yet"} description="Files are stored in a private bucket and served only to members of your organization." /></Card>
      ) : (
        <div className="space-y-5">
          {groups.map(({ s, items }) => (
            <Card key={s.id}>
              <CardHeader title={<span className="flex items-center gap-2.5"><SponsorLogo name={s.name} assetId={s.logo_asset_id} size={24} />{s.name}</span>} sub={`${items.length} file${items.length === 1 ? "" : "s"}`} />
              <AssetGrid assets={items} sponsors={data.sponsors} today={today} canManage={canManage} showSponsor={false} />
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
