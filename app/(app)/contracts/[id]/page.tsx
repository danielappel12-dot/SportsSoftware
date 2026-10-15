import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Card, CardHeader, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { ContractForm } from "@/components/contract-form";
import { DeliverablesTable } from "@/components/deliverables-table";
import { RunButton } from "@/components/ui/toast";
import { deleteContract, updateContract } from "@/lib/actions/contracts";
import { MANAGER_ROLES } from "@/lib/constants";
import { canSee, getCtx, getOrgData } from "@/lib/data";
import { todayISO } from "@/lib/dates";

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ctx, data] = await Promise.all([getCtx(), getOrgData()]);
  const contract = data.contracts.find((c) => c.id === id);
  if (!contract) notFound();
  const sponsor = data.sponsors.find((s) => s.id === contract.sponsor_id);
  const items = data.deliverables.filter((d) => d.contract_id === id);
  const canEdit = canSee(ctx, MANAGER_ROLES);
  return (
    <>
      <PageHeader title={contract.name} description={<>Sponsor: <Link className="text-brand hover:underline" href={`/partners/${contract.sponsor_id}`}>{sponsor?.name}</Link></>}
        actions={canEdit && <RunButton className="btn-danger btn-sm" confirm="Delete this contract? Its deliverables are kept but unlinked." action={deleteContract.bind(null, id, contract.sponsor_id)}>Delete</RunButton>} />
      {canEdit ? <ContractForm action={updateContract.bind(null, id)} contract={contract} sponsors={data.sponsors} cancelHref="/contracts" /> : <Alert tone="info">Read-only access.</Alert>}
      <Card className="mt-6">
        <CardHeader title="Deliverables under this contract" action={canEdit && <LinkButton href={`/deliverables/new?sponsor=${contract.sponsor_id}&contract=${id}`} size="sm">Add deliverable</LinkButton>} />
        {items.length ? <DeliverablesTable items={items} members={data.members} today={todayISO()} /> : <EmptyState title="No deliverables yet" description="Add the obligations this contract commits you to." />}
      </Card>
    </>
  );
}
