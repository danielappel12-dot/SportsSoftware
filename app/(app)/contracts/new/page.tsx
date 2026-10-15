import { Alert, PageHeader } from "@/components/ui";
import { ContractForm } from "@/components/contract-form";
import { createContract } from "@/lib/actions/contracts";
import { MANAGER_ROLES } from "@/lib/constants";
import { canSee, getCtx, getOrgData } from "@/lib/data";
import { one, type SP } from "@/lib/view";

export const metadata = { title: "New contract" };

export default async function NewContractPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [ctx, data] = await Promise.all([getCtx(), getOrgData()]);
  return (
    <>
      <PageHeader title="New contract" />
      {!canSee(ctx, MANAGER_ROLES) ? <Alert>Your role can&apos;t create contracts.</Alert>
        : data.sponsors.length === 0 ? <Alert tone="info">Create a sponsor first — every contract belongs to one.</Alert>
        : <ContractForm action={createContract} sponsors={data.sponsors} defaultSponsor={one(sp.sponsor)} cancelHref="/contracts" />}
    </>
  );
}
