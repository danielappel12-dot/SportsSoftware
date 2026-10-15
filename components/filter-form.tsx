"use client";
import { useRef, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

/** GET-based filter bar: updates the URL (so views are shareable) as the user types / selects. */
export function FilterForm({ children, keep = [] }: { children: ReactNode; keep?: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const submit = (form: HTMLFormElement) => {
    const p = new URLSearchParams();
    for (const [k, v] of new FormData(form)) if (typeof v === "string" && v) p.set(k, v);
    for (const k of keep) { const el = form.elements.namedItem(k) as HTMLInputElement | null; if (el?.value) p.set(k, el.value); }
    router.replace(p.size ? `${pathname}?${p}` : pathname, { scroll: false });
  };
  return (
    <form
      role="search"
      onSubmit={(e) => { e.preventDefault(); submit(e.currentTarget); }}
      onChange={(e) => {
        const form = e.currentTarget;
        const t = e.target as unknown as HTMLInputElement;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => submit(form), t.type === "search" || t.type === "text" ? 350 : 0);
      }}
      className="flex flex-wrap items-end gap-2"
    >
      {children}
      <Link href={pathname} className="btn-ghost btn-sm" replace>Reset</Link>
    </form>
  );
}
