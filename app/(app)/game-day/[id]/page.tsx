import Link from "next/link";
import { notFound } from "next/navigation";
import { Camera, ListChecks, Pencil, Plus } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Progress, SponsorLogo, StatusBadge } from "@/components/ui";
import { ActionForm, Field, Input, Select, Textarea } from "@/components/ui/form";
import { DateTimeInput } from "@/components/datetime-field";
import { EvidenceGallery, EvidenceUploader } from "@/components/evidence";
import { LocalTime } from "@/components/local-time";
import { TaskRow, type TaskView } from "@/components/task-row";
import { RunButton } from "@/components/ui/toast";
import { setDeliverableStatus } from "@/lib/actions/deliverables";
import { addActivation, addTask, deleteActivation, setEventStatus } from "@/lib/actions/events";
import { MANAGER_ROLES, WORKER_ROLES } from "@/lib/constants";
import { canSee, getCtx, getOrgData, memberName } from "@/lib/data";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ctx, data] = await Promise.all([getCtx(), getOrgData()]);
  const event = data.events.find((e) => e.id === id);
  if (!event) notFound();
  const canWork = canSee(ctx, WORKER_ROLES);
  const canManage = canSee(ctx, MANAGER_ROLES);

  const acts = data.activations.filter((a) => a.event_id === id);
  const sponsorIds = [...new Set(acts.map((a) => a.sponsor_id))];
  const soleSponsor = sponsorIds.length === 1 ? sponsorIds[0] : null;
  const tasks = data.tasks.filter((t) => t.event_id === id).sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? "") || a.position - b.position);
  const evidence = data.evidence.filter((e) => e.event_id === id);
  const views: TaskView[] = tasks.map((t) => {
    const act = acts.find((a) => a.id === t.activation_id);
    return {
      id: t.id, title: t.title, status: t.status, blocker_note: t.blocker_note, scheduled_at: t.scheduled_at,
      assignee: memberName(data.members, t.assigned_to), activation: act?.title ?? null, sponsorId: act?.sponsor_id ?? soleSponsor,
      photos: evidence.filter((e) => e.event_task_id === t.id).length,
    };
  });
  const open = views.filter((t) => t.status !== "done");
  const done = views.length - open.length;
  const blocked = views.filter((t) => t.status === "blocked").length;
  const sponsorOptions = sponsorIds.map((sid) => ({ id: sid, name: data.sponsors.find((s) => s.id === sid)?.name ?? "Sponsor" }));
  const sponsorDeliverables = (sid: string) => data.deliverables.filter((d) => d.sponsor_id === sid && d.status !== "not_applicable");

  return (
    <>
      <PageHeader
        back={<Link href="/game-day" className="mb-2 inline-block text-xs text-ink-400 hover:text-ink-200">← Game Day</Link>}
        title={event.name}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={event.status} /><span><LocalTime iso={event.starts_at} mode="long" /></span><span>· {event.venue ?? "Venue TBD"}</span></span>}
        actions={<>
          {canWork && event.status === "planned" && <RunButton className="btn-primary" action={setEventStatus.bind(null, id, "live")} success="Game is live">Go live</RunButton>}
          {canWork && event.status === "live" && <RunButton className="btn-secondary" action={setEventStatus.bind(null, id, "completed")} success="Game marked completed">Mark completed</RunButton>}
          {canManage && <Link href={`/game-day/${id}/edit`} className="btn-secondary"><Pencil className="size-3.5" /> Edit</Link>}
        </>} />

      <div className="card sticky top-0 z-10 mb-5 p-3 sm:p-4 md:static">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm"><b className="text-lg tabular-nums">{open.length}</b> <span className="text-ink-400">task{open.length === 1 ? "" : "s"} remaining</span></p>
          <div className="flex items-center gap-2 text-xs text-ink-400">{blocked > 0 && <Badge tone="block">{blocked} blocked</Badge>}<span className="tabular-nums">{done}/{views.length} done</span></div>
        </div>
        <Progress value={views.length ? (done / views.length) * 100 : 0} tone="ok" className="mt-2.5 h-2" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Run of show" sub="Tap the box to complete · flag blockers · snap proof photos" />
            {views.length === 0 ? <EmptyState icon={<ListChecks className="size-5" />} title="No run-of-show tasks" description={canManage ? "Add the first task below." : "A manager hasn't added tasks yet."} /> : (
              <ul className="divide-y divide-ink-800">
                {views.map((t) => <TaskRow key={t.id} t={t} eventId={id} canWork={canWork} canManage={canManage} />)}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Evidence" sub={`${evidence.length} file${evidence.length === 1 ? "" : "s"} from this game`} />
            <EvidenceGallery items={evidence} assets={data.assets} canManage={canManage} empty="Use the Photo button on a task, or upload below." />
            {canWork && (
              <details className="border-t border-ink-700 p-4">
                <summary className="flex cursor-pointer items-center gap-2 text-sm text-ink-300 hover:text-ink-100"><Camera className="size-4" /> Upload game photos</summary>
                <div className="mt-3">
                  {sponsorOptions.length ? <EvidenceUploader eventId={id} sponsorOptions={sponsorOptions} compact /> : <p className="text-xs text-ink-400">Add a sponsor activation first so photos can be filed under a sponsor.</p>}
                </div>
              </details>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Sponsor activations" sub={`${acts.length} scheduled`} />
            {acts.length === 0 ? <EmptyState title="No activations" description="Link sponsors and the deliverables being fulfilled at this game." /> : (
              <ul className="divide-y divide-ink-800">
                {acts.map((a) => {
                  const sp = data.sponsors.find((s) => s.id === a.sponsor_id);
                  const del = data.deliverables.find((d) => d.id === a.deliverable_id);
                  return (
                    <li key={a.id} className="space-y-2 p-4">
                      <div className="flex items-start gap-3">
                        <SponsorLogo name={sp?.name ?? "?"} assetId={sp?.logo_asset_id} size={32} />
                        <div className="min-w-0 flex-1"><p className="text-sm font-medium">{a.title}</p><p className="text-xs text-ink-400">{sp?.name}</p>{a.details && <p className="mt-1 text-xs text-ink-300">{a.details}</p>}</div>
                        {canManage && <RunButton className="btn-ghost btn-sm text-danger" confirm="Remove this activation?" action={deleteActivation.bind(null, a.id)}>Remove</RunButton>}
                      </div>
                      {del && (
                        <div className="flex items-center justify-between gap-2 rounded-md bg-ink-850 px-2.5 py-2 text-xs">
                          <Link href={`/deliverables/${del.id}`} className="line-clamp-1 text-ink-300 hover:text-brand">{del.description}</Link>
                          <span className="flex shrink-0 items-center gap-2"><StatusBadge status={del.status} />
                            {canWork && del.status !== "completed" && <RunButton className="btn-primary btn-sm" success="Deliverable fulfilled" action={setDeliverableStatus.bind(null, del.id, "completed")}>Delivered</RunButton>}</span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {canManage && (
            <Card>
              <CardHeader title="Plan this game" />
              <div className="divide-y divide-ink-800">
                <details className="group p-4" open={views.length === 0}>
                  <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium"><Plus className="size-4 text-brand" /> Add run-of-show task</summary>
                  <ActionForm action={addTask} submitLabel="Add task" resetOnSuccess className="mt-3">
                    <input type="hidden" name="event_id" value={id} />
                    <Field name="title" label="Task" required><Input name="title" required maxLength={200} placeholder="e.g. Load LED creative v3" /></Field>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field name="scheduled_at" label="Time"><DateTimeInput name="scheduled_at" defaultIso={event.starts_at} /></Field>
                      <Field name="assigned_to" label="Assigned staff"><Select name="assigned_to" defaultValue=""><option value="">Unassigned</option>{data.members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>)}</Select></Field>
                    </div>
                    <Field name="activation_id" label="Linked activation"><Select name="activation_id" defaultValue=""><option value="">None</option>{acts.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</Select></Field>
                  </ActionForm>
                </details>
                <details className="p-4">
                  <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium"><Plus className="size-4 text-brand" /> Add sponsor activation</summary>
                  <ActionForm action={addActivation} submitLabel="Add activation" resetOnSuccess className="mt-3">
                    <input type="hidden" name="event_id" value={id} />
                    <Field name="sponsor_id" label="Sponsor" required><Select name="sponsor_id" defaultValue="" required><option value="" disabled>Choose…</option>{data.sponsors.filter((s) => s.status !== "archived").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
                    <Field name="title" label="Activation" required><Input name="title" required maxLength={200} placeholder="e.g. Kids health zone" /></Field>
                    <Field name="deliverable_id" label="Fulfills deliverable" hint="Must belong to the chosen sponsor.">
                      <Select name="deliverable_id" defaultValue=""><option value="">None</option>
                        {data.sponsors.flatMap((s) => sponsorDeliverables(s.id).filter((d) => d.status !== "completed").map((d) => <option key={d.id} value={d.id}>{s.name} — {d.description.slice(0, 60)}</option>))}</Select>
                    </Field>
                    <Field name="details" label="Details"><Textarea name="details" rows={2} /></Field>
                  </ActionForm>
                </details>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
