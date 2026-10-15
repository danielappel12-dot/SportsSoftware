import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Alert } from "@/components/ui";
import { SponsorForm } from "@/components/sponsor-form";
import { createSponsor } from "@/lib/actions/sponsors";
import { canSee, getCtx, getOrgData } from "@/lib/data";
import { MANAGER_ROLES } from "@/lib/constants";

export const metadata = { title: "New sponsor" };

export default async function NewSponsorPage() {
  const [ctx, data] = await Promise.all([getCtx(), getOrgData()]);
  return (
    <>
      <PageHeader title="New sponsor" back={<Link href="/partners" className="mb-1 inline-flex items-center gap-1 text-xs text-ink-400 hover:text-ink-200"><ArrowLeft className="size-3" /> Partners</Link>} />
      {!canSee(ctx, MANAGER_ROLES) ? <Alert>Your role can&apos;t create sponsors.</Alert> : <SponsorForm action={createSponsor} members={data.members} cancelHref="/partners" />}
    </>
  );
}
