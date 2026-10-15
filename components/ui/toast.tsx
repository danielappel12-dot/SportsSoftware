"use client";
import { createContext, useCallback, useContext, useState, useTransition, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import clsx from "clsx";
import type { ActionState } from "@/lib/actions/types";

type Toast = { id: number; tone: "ok" | "danger"; message: string };
const Ctx = createContext<{ push: (t: Omit<Toast, "id">) => void }>({ push: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setItems((cur) => [...cur.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== id)), t.tone === "danger" ? 8000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[100] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:px-6" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.tone === "danger" ? "alert" : "status"}
            className={clsx("rise pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-xl shadow-black/40",
              t.tone === "ok" ? "border-ok/40 bg-ink-850 text-ok" : "border-danger/50 bg-ink-850 text-danger")}>
            {t.tone === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
            <span className="text-ink-100">{t.message}</span>
            <button className="ml-1 text-ink-400 hover:text-ink-100" aria-label="Dismiss" onClick={() => setItems((c) => c.filter((x) => x.id !== t.id))}><X className="size-3.5" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** Run a server action from a button, surfacing success / failure as a toast. */
export function useRunner() {
  const { push } = useToast();
  const [pending, start] = useTransition();
  const run = (action: () => Promise<ActionState | void>, opts?: { success?: string; after?: () => void }) =>
    start(async () => {
      try {
        const res = await action();
        if (res && res.ok === false) push({ tone: "danger", message: res.error });
        else {
          if (opts?.success || (res && res.ok && res.message)) push({ tone: "ok", message: opts?.success ?? (res as { message?: string }).message ?? "Saved" });
          opts?.after?.();
        }
      } catch (e) {
        if (e instanceof Error && /NEXT_REDIRECT/.test(e.message)) throw e;
        push({ tone: "danger", message: "Something went wrong. Please try again." });
      }
    });
  return { run, pending };
}

export function RunButton({
  action, children, className = "btn-secondary btn-sm", success, confirm, title, disabled,
}: {
  action: () => Promise<ActionState | void>; children: ReactNode; className?: string; success?: string; confirm?: string; title?: string; disabled?: boolean;
}) {
  const { run, pending } = useRunner();
  return (
    <button type="button" className={className} disabled={pending || disabled} title={title}
      onClick={() => { if (confirm && !window.confirm(confirm)) return; run(action, { success }); }}>
      {children}
    </button>
  );
}
