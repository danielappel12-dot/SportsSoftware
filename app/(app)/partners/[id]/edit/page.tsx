import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Alert, PageHeader } from "@/components/ui";
import { SponsorForm } from "@/components/sponsor-form";
import { updateSponsor } from "@/lib/actions/sponsors";
import { canSee, getCtx, getOrgData } from "@/lib/data";
import { MANAGER_ROLES } from "@/lib/constants";

export const metadata = { title: "Edit sponsor" };

export default async function EditSponsorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const [{ id }, { notice }, ctx, data] = await Promise.all([params, searchParams, getCtx(), getOrgData()]);
  const sponsor = data.sponsors.find((s) => s.id === id);
  if (!sponsor) notFound();
  return (
    <>
      <PageHeader title={`Edit ${sponsor.name}`} back={<Link href={`/partners/${id}`} className="mb-1 inline-flex items-center gap-1 text-xs text-ink-400 hover:text-ink-200"><ArrowLeft className="size-3" /> {sponsor.name}</Link>} />
      {notice === "logo" && <div className="mb-4"><Alert tone="warn">The sponsor was created, but the logo upload failed. Try uploading it again below.</Alert></div>}
      {!canSee(ctx, MANAGER_ROLES) ? <Alert>Your role can&apos;t edit sponsors.</Alert> : <SponsorForm action={updateSponsor.bind(null, id)} sponsor={sponsor} members={data.members} cancelHref={`/partners/${id}`} />}
    </>
  );
}
