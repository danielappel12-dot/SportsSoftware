"use client";
import { useRef, useState } from "react";
import { AlertTriangle, Camera, Check, RotateCcw, Trash2 } from "lucide-react";
import clsx from "clsx";
import { LocalTime } from "@/components/local-time";
import { useRunner } from "@/components/ui/toast";
import { uploadEvidence } from "@/lib/actions/assets";
import { deleteTask, setTaskStatus } from "@/lib/actions/events";

export type TaskView = {
  id: string; title: string; status: string; blocker_note: string | null; scheduled_at: string | null;
  assignee: string; activation: string | null; sponsorId: string | null; photos: number;
};

/** Big-target run-of-show row: complete, flag a blocker, or attach a photo in one tap. */
export function TaskRow({ t, eventId, canWork, canManage }: { t: TaskView; eventId: string; canWork: boolean; canManage: boolean }) {
  const { run, pending } = useRunner();
  const [flagging, setFlagging] = useState(false);
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const done = t.status === "done";
  const blocked = t.status === "blocked";

  const photo = (files: FileList | null) => {
    if (!files?.length || !t.sponsorId) return;
    const fd = new FormData();
    fd.set("sponsor_id", t.sponsorId); fd.set("event_task_id", t.id); fd.set("event_id", eventId); fd.set("include_in_report", "on");
    fd.set("caption", t.title);
    for (const f of Array.from(files)) fd.append("file", f);
    run(() => uploadEvidence(null, fd), { success: "Photo attached" });
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <li className={clsx("px-3 py-3 sm:px-4", blocked && "bg-block/8 shadow-[inset_4px_0_0_var(--color-block)]", done && "opacity-60")}>
      <div className="flex items-start gap-3">
        <button type="button" disabled={!canWork || pending} aria-label={done ? `Reopen ${t.title}` : `Complete ${t.title}`}
          onClick={() => run(() => setTaskStatus(t.id, done ? "todo" : "done"))}
          className={clsx("grid size-11 shrink-0 place-items-center rounded-xl border-2 transition active:scale-95 disabled:opacity-40",
            done ? "border-ok bg-ok text-ink-950" : "border-ink-500 text-transparent hover:border-ok hover:text-ok/60")}>
          <Check className="size-6" strokeWidth={3} />
        </button>
        <div className="min-w-0 flex-1">
          <p className={clsx("text-[15px] font-medium leading-snug", done && "line-through")}>{t.title}</p>
          <p className="mt-0.5 text-xs text-ink-400">
            {t.scheduled_at && <><LocalTime iso={t.scheduled_at} mode="time" /> · </>}{t.assignee}{t.activation && <> · {t.activation}</>}{t.photos > 0 && <> · {t.photos} photo{t.photos > 1 ? "s" : ""}</>}
          </p>
          {blocked && <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-block/15 px-2 py-1.5 text-xs text-block"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /><span><b>Blocked:</b> {t.blocker_note}</span></p>}
          {canWork && !done && (
            <div className="mt-2 flex flex-wrap gap-2">
              {blocked ? (
                <button className="btn-secondary h-10" disabled={pending} onClick={() => run(() => setTaskStatus(t.id, "todo"))}><RotateCcw className="size-4" /> Unblock</button>
              ) : (
                <button className="btn-secondary h-10" onClick={() => setFlagging((v) => !v)} aria-expanded={flagging}><AlertTriangle className="size-4 text-block" /> Flag blocker</button>
              )}
              <button className="btn-secondary h-10 disabled:opacity-40" disabled={!t.sponsorId || pending} title={t.sponsorId ? "Attach a photo" : "Link this task to a sponsor activation to attach photos"} onClick={() => fileRef.current?.click()}>
                <Camera className="size-4" /> Photo
              </button>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => photo(e.target.files)} />
              {canManage && <button className="btn-ghost h-10 text-danger" aria-label="Delete task" onClick={() => confirm("Delete this task?") && run(() => deleteTask(t.id))}><Trash2 className="size-4" /></button>}
            </div>
          )}
          {flagging && (
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => setTaskStatus(t.id, "blocked", note), { after: () => { setFlagging(false); setNote(""); } }); }}>
              <input autoFocus required maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's blocking this?" className="input h-10 flex-1" aria-label="Blocker description" />
              <button className="btn-primary h-10" disabled={pending || !note.trim()}>Flag</button>
            </form>
          )}
        </div>
      </div>
    </li>
  );
}
