import { Alert, PageHeader } from "@/components/ui";
import { EventForm } from "@/components/event-form";
import { createEvent } from "@/lib/actions/events";
import { MANAGER_ROLES } from "@/lib/constants";
import { canSee, getCtx, getOrgData } from "@/lib/data";

export const metadata = { title: "New game" };

export default async function NewEventPage() {
  const [ctx, data] = await Promise.all([getCtx(), getOrgData()]);
  return (
    <>
      <PageHeader title="New game / event" />
      {canSee(ctx, MANAGER_ROLES) ? <EventForm action={createEvent} seasons={data.seasons} cancelHref="/game-day" /> : <Alert>Your role can&apos;t create games.</Alert>}
    </>
  );
}
