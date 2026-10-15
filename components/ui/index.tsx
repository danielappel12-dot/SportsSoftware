import Link from "next/link";
import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { label } from "@/lib/constants";
import { daysBetween } from "@/lib/dates";

export { clsx };

type Tone = "neutral" | "ok" | "warn" | "danger" | "block" | "info" | "brand";
const TONES: Record<Tone, string> = {
  neutral: "bg-ink-800 text-ink-200 border-ink-700",
  ok: "bg-ok/12 text-ok border-ok/30",
  warn: "bg-warn/12 text-warn border-warn/30",
  danger: "bg-danger/12 text-danger border-danger/35",
  block: "bg-block/15 text-block border-block/40",
  info: "bg-info/12 text-info border-info/30",
  brand: "bg-brand/12 text-brand border-brand/30",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4", TONES[tone], className)}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  not_started: "neutral", in_progress: "info", awaiting_approval: "warn", blocked: "block", completed: "ok", not_applicable: "neutral",
  prospect: "info", active: "ok", paused: "warn", archived: "neutral",
  draft: "neutral", expired: "warn", canceled: "danger",
  planned: "info", live: "brand", todo: "neutral", done: "ok",
  pending: "warn", approved: "ok", rejected: "danger",
};
export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? "neutral"}>
      {status === "blocked" && <span className="size-1.5 rounded-full bg-block pulse-block" />}
      {label(status)}
    </Badge>
  );
}

const PRIORITY_TONE: Record<string, Tone> = { low: "neutral", medium: "info", high: "warn", urgent: "danger" };
export function PriorityBadge({ priority }: { priority: string }) {
  return <Badge tone={PRIORITY_TONE[priority] ?? "neutral"}>{label(priority)}</Badge>;
}

/** Deadline emphasis: overdue = loud red, soon = amber, otherwise quiet. */
export function DueBadge({ date, done, today }: { date: string | null; done?: boolean; today: string }) {
  if (!date) return <span className="text-ink-500">No date</span>;
  if (done) return <span className="text-ink-400">{new Date(date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</span>;
  const diff = daysBetween(today, date);
  if (diff < 0) return <Badge tone="danger" className="font-semibold">{-diff}d overdue</Badge>;
  if (diff === 0) return <Badge tone="warn" className="font-semibold">Due today</Badge>;
  if (diff <= 7) return <Badge tone="warn">In {diff}d</Badge>;
  return <span className="text-ink-300">{new Date(date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</span>;
}

export function Card({ className, children, ...rest }: ComponentProps<"div">) {
  return <div className={clsx("card", className)} {...rest}>{children}</div>;
}

export function CardHeader({ title, action, sub }: { title: ReactNode; action?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-ink-700 px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-ink-400">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back}
        <h1 className="truncate text-xl font-semibold tracking-tight text-ink-100 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="mb-1 grid size-11 place-items-center rounded-full border border-ink-700 bg-ink-850 text-ink-400">{icon}</div>}
      <p className="text-sm font-medium text-ink-200">{title}</p>
      {description && <p className="max-w-sm text-xs text-ink-400">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "danger", children, title }: { tone?: "danger" | "ok" | "info" | "warn"; children: ReactNode; title?: string }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={clsx("flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm", TONES[tone])}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>{title && <p className="font-medium">{title}</p>}<div className={title ? "text-[13px] opacity-90" : ""}>{children}</div></div>
    </div>
  );
}

export function Stat({ label: l, value, sub, tone, href }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "danger" | "warn" | "ok"; href?: string }) {
  const inner = (
    <div className={clsx("card h-full p-4 transition", href && "hover:border-ink-600", tone === "danger" && "border-danger/40")}>
      <p className="label-caps">{l}</p>
      <p className={clsx("mt-1.5 text-2xl font-semibold tabular-nums", tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-ink-100")}>{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-400">{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block rise">{inner}</Link> : <div className="rise">{inner}</div>;
}

export function Progress({ value, tone = "brand", className }: { value: number; tone?: "brand" | "ok" | "danger"; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={clsx("h-1.5 overflow-hidden rounded-full bg-ink-800", className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={clsx("h-full rounded-full transition-all", tone === "ok" ? "bg-ok" : tone === "danger" ? "bg-danger" : "bg-brand")} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
  return <span className={clsx("grid size-6 shrink-0 place-items-center rounded-full bg-ink-700 text-[10px] font-semibold text-ink-200", className)} title={name}>{initials}</span>;
}

/** Sponsor logo served through the permission-checked /api/assets route; falls back to initials. */
export function SponsorLogo({ name, assetId, size = 32 }: { name: string; assetId?: string | null; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
  if (assetId) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/assets/${assetId}`} alt={`${name} logo`} width={size} height={size} className="shrink-0 rounded-md bg-white object-contain p-0.5" style={{ width: size, height: size }} />;
  }
  return (
    <span className="grid shrink-0 place-items-center rounded-md border border-ink-600 bg-ink-800 text-[11px] font-bold tracking-wide text-ink-300" style={{ width: size, height: size }} aria-hidden>
      {initials}
    </span>
  );
}

export function LinkButton({ href, variant = "secondary", size, children, className }: { href: string; variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm"; children: ReactNode; className?: string }) {
  return <Link href={href} className={clsx(`btn-${variant}`, size === "sm" && "btn-sm", className)}>{children}</Link>;
}

export function Tabs({ tabs, active }: { tabs: { href: string; label: string; key: string; count?: number }[]; active: string }) {
  return (
    <nav className="-mx-4 mb-5 overflow-x-auto border-b border-ink-700 px-4 sm:mx-0 sm:px-0" aria-label="Sections">
      <ul className="flex min-w-max gap-1">
        {tabs.map((t) => (
          <li key={t.key}>
            <Link href={t.href} aria-current={active === t.key ? "page" : undefined}
              className={clsx("relative inline-flex items-center gap-1.5 px-3 py-2.5 text-sm transition", active === t.key ? "font-medium text-ink-100 after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand" : "text-ink-400 hover:text-ink-200")}>
              {t.label}
              {t.count != null && <span className="rounded bg-ink-800 px-1.5 text-[10px] text-ink-300">{t.count}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-md bg-ink-800", className)} />;
}

export function DemoNote({ children }: { children?: ReactNode }) {
  return <Badge tone="warn">{children ?? "Demo data"}</Badge>;
}
