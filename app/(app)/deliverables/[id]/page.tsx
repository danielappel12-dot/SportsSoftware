import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader, PageHeader, StatusBadge } from "@/components/ui";
import { DeliverableForm } from "@/components/deliverable-form";
import { EvidenceGallery, EvidenceUploader } from "@/components/evidence";
import { RunButton } from "@/components/ui/toast";
import { deleteDeliverable, setDeliverableStatus, updateDeliverable } from "@/lib/actions/deliverables";
import { MANAGER_ROLES, WORKER_ROLES } from "@/lib/constants";
import { canSee, getCtx, getOrgData } from "@/lib/data";

export default async function DeliverablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ctx, data] = await Promise.all([getCtx(), getOrgData()]);
  const d = data.deliverables.find((x) => x.id === id);
  if (!d) notFound();
  const sponsor = data.sponsors.find((s) => s.id === d.sponsor_id);
  const evidence = data.evidence.filter((e) => e.deliverable_id === id);
  const canWork = canSee(ctx, WORKER_ROLES);
  const canManage = canSee(ctx, MANAGER_ROLES);
  return (
    <>
      <PageHeader
        title={<span className="line-clamp-2 whitespace-normal">{d.description}</span>}
        description={<><Link href={`/partners/${d.sponsor_id}`} className="text-brand hover:underline">{sponsor?.name}</Link> · <StatusBadge status={d.status} /></>}
        actions={<>
          {canWork && d.status !== "completed" && <RunButton className="btn-primary btn-sm" success="Marked complete" action={setDeliverableStatus.bind(null, id, "completed")}>Mark complete</RunButton>}
          {canManage && <RunButton className="btn-danger btn-sm" confirm="Delete this deliverable and its links?" action={deleteDeliverable.bind(null, id)}>Delete</RunButton>}
        </>} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          {canWork ? (
            <DeliverableForm action={updateDeliverable.bind(null, id)} deliverable={d} sponsors={data.sponsors}
              contracts={data.contracts.filter((c) => c.sponsor_id === d.sponsor_id)} events={data.events} members={data.members}
              cancelHref="/deliverables" limited={ctx.role === "creative_staff"} />
          ) : <p className="text-sm text-ink-400">Read-only access.</p>}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Supporting evidence" sub={`${evidence.length} file${evidence.length === 1 ? "" : "s"}`} />
            <EvidenceGallery items={evidence} assets={data.assets} canManage={canManage} />
          </Card>
          {canWork && (
            <Card>
              <CardHeader title="Attach evidence" />
              <div className="p-4"><EvidenceUploader sponsorId={d.sponsor_id} deliverableId={id} compact /></div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
