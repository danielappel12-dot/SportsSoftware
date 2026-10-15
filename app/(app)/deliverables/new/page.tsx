import { Alert, PageHeader } from "@/components/ui";
import { DeliverableForm } from "@/components/deliverable-form";
import { createDeliverable } from "@/lib/actions/deliverables";
import { MANAGER_ROLES } from "@/lib/constants";
import { canSee, getCtx, getOrgData } from "@/lib/data";
import { one, type SP } from "@/lib/view";

export const metadata = { title: "New deliverable" };

export default async function NewDeliverablePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [ctx, data] = await Promise.all([getCtx(), getOrgData()]);
  return (
    <>
      <PageHeader title="New deliverable" />
      {!canSee(ctx, MANAGER_ROLES) ? <Alert>Your role can&apos;t create deliverables.</Alert>
        : data.sponsors.length === 0 ? <Alert tone="info">Create a sponsor first — deliverables belong to a sponsor.</Alert>
        : <div className="max-w-3xl"><DeliverableForm action={createDeliverable} sponsors={data.sponsors} contracts={data.contracts} events={data.events} members={data.members}
            defaults={{ sponsor: one(sp.sponsor), contract: one(sp.contract), event: one(sp.event) }} cancelHref="/deliverables" /></div>}
    </>
  );
}
