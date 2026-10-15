"use client";
import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import clsx from "clsx";
import { Loader2 } from "lucide-react";
import type { ActionState } from "@/lib/actions/types";
import { Alert } from "@/components/ui";

const Errors = createContext<Record<string, string>>({});

/**
 * Form wired to a server action (useActionState). Validation errors are shown per field and in an
 * alert; user input is preserved on failure.
 */
export function ActionForm({
  action, children, submitLabel = "Save", cancelHref, className, resetOnSuccess, hideSubmit, footerExtra,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: ReactNode; submitLabel?: string; cancelHref?: string; className?: string;
  resetOnSuccess?: boolean; hideSubmit?: boolean; footerExtra?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state?.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);
  const errors = state && state.ok === false ? state.fieldErrors ?? {} : {};
  return (
    <form
      ref={ref}
      noValidate={false}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
    >
      <Errors.Provider value={errors}>
        <div className="space-y-4">
          {children}
          {state && state.ok === false && <Alert>{state.error}</Alert>}
          {state && state.ok === true && state.message && <Alert tone="ok">{state.message}</Alert>}
          {!hideSubmit && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button type="submit" className="btn-primary" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />} {pending ? "Saving…" : submitLabel}
              </button>
              {cancelHref && <Link href={cancelHref} className="btn-ghost">Cancel</Link>}
              {footerExtra}
            </div>
          )}
        </div>
      </Errors.Provider>
    </form>
  );
}

export function Field({ name, label, hint, required, children, className }: { name: string; label: string; hint?: string; required?: boolean; children: ReactNode; className?: string }) {
  const err = useContext(Errors)[name];
  return (
    <div className={className}>
      <label htmlFor={name} className="mb-1.5 block text-xs font-medium text-ink-300">
        {label}{required && <span className="text-brand"> *</span>}
      </label>
      {children}
      {hint && !err && <p className="mt-1 text-[11px] text-ink-500">{hint}</p>}
      {err && <p className="mt-1 text-xs text-danger" role="alert">{err}</p>}
    </div>
  );
}

function useInvalid(name?: string) {
  const err = useContext(Errors);
  return name && err[name] ? true : undefined;
}

export function Input({ name, className, ...rest }: ComponentProps<"input"> & { name: string }) {
  return <input id={name} name={name} aria-invalid={useInvalid(name)} className={clsx("input", className)} {...rest} />;
}
export function Textarea({ name, className, rows = 4, ...rest }: ComponentProps<"textarea"> & { name: string }) {
  return <textarea id={name} name={name} rows={rows} aria-invalid={useInvalid(name)} className={clsx("input", className)} {...rest} />;
}
export function Select({ name, className, children, ...rest }: ComponentProps<"select"> & { name: string }) {
  return <select id={name} name={name} aria-invalid={useInvalid(name)} className={clsx("input pr-8", className)} {...rest}>{children}</select>;
}

export function SubmitButton({ children, className = "btn-primary", pendingLabel = "Working…" }: { children: ReactNode; className?: string; pendingLabel?: string }) {
  return <PendingButton className={className} pendingLabel={pendingLabel}>{children}</PendingButton>;
}
function PendingButton({ children, className, pendingLabel }: { children: ReactNode; className: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? <><Loader2 className="size-4 animate-spin" /> {pendingLabel}</> : children}
    </button>
  );
}
