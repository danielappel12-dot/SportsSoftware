"use client";
import { AlertTriangle } from "lucide-react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-8 text-center">
      <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-danger/10 text-danger"><AlertTriangle className="size-5" /></div>
      <h1 className="text-base font-semibold">We couldn&apos;t load this page</h1>
      <p className="mt-1 text-sm text-ink-400">{error.message || "An unexpected error occurred."}</p>
      <button onClick={reset} className="btn-secondary mt-4">Try again</button>
    </div>
  );
}
