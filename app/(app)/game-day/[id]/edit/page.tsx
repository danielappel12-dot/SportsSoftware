import { notFound } from "next/navigation";
import { Alert, PageHeader } from "@/components/ui";
import { EventForm } from "@/components/event-form";
import { RunButton } from "@/components/ui/toast";
import { deleteEvent, updateEvent } from "@/lib/actions/events";
import { MANAGER_ROLES } from "@/lib/constants";
import { canSee, getCtx, getOrgData } from "@/lib/data";

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ctx, data] = await Promise.all([getCtx(), getOrgData()]);
  const event = data.events.find((e) => e.id === id);
  if (!event) notFound();
  if (!canSee(ctx, MANAGER_ROLES)) return <Alert>Your role can&apos;t edit games.</Alert>;
  return (
    <>
      <PageHeader title={`Edit ${event.name}`} actions={<RunButton className="btn-danger btn-sm" confirm="Delete this game with its tasks and activations?" action={deleteEvent.bind(null, id)}>Delete game</RunButton>} />
      <EventForm action={updateEvent.bind(null, id)} event={event} seasons={data.seasons} cancelHref={`/game-day/${id}`} />
    </>
  );
}
