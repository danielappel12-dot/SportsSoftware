"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import clsx from "clsx";
import {
  Bell, FileBarChart, FileSignature, FolderOpen, Handshake, LayoutDashboard, ListChecks, LogOut, MoreHorizontal,
  Settings, Trophy, X,
} from "lucide-react";
import { Logo } from "@/components/brand";
import { Avatar } from "@/components/ui";
import { logout, switchOrganization } from "@/lib/actions/auth";
import { ROLE_LABEL, type Role } from "@/lib/constants";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/partners", label: "Partners", icon: Handshake },
  { href: "/contracts", label: "Contracts", icon: FileSignature },
  { href: "/deliverables", label: "Deliverables", icon: ListChecks },
  { href: "/game-day", label: "Game Day", icon: Trophy },
  { href: "/assets", label: "Asset Library", icon: FolderOpen },
  { href: "/reports", label: "Reports", icon: FileBarChart },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

type ShellProps = {
  orgName: string; orgs: { id: string; name: string }[]; orgId: string; userName: string; role: Role;
  unread: number; demo: boolean; children: React.ReactNode;
};

export function Shell({ orgName, orgs, orgId, userName, role, unread, demo, children }: ShellProps) {
  const pathname = usePathname();
  const [more, setMore] = useState(false);
  const [, start] = useTransition();
  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const NavLink = ({ item, onClick }: { item: (typeof NAV)[number]; onClick?: () => void }) => {
    const Icon = item.icon;
    return (
      <Link href={item.href} onClick={onClick} aria-current={active(item.href) ? "page" : undefined}
        className={clsx("group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition",
          active(item.href) ? "bg-ink-800 font-medium text-ink-100" : "text-ink-400 hover:bg-ink-850 hover:text-ink-100")}>
        <Icon className={clsx("size-4", active(item.href) ? "text-brand" : "text-ink-500 group-hover:text-ink-300")} />
        <span className="flex-1">{item.label}</span>
        {item.href === "/notifications" && unread > 0 && (
          <span className="rounded-full bg-brand px-1.5 text-[10px] font-bold text-ink-950">{unread > 99 ? "99+" : unread}</span>
        )}
      </Link>
    );
  };

  const mobilePrimary = NAV.filter((n) => ["/dashboard", "/game-day", "/deliverables", "/partners"].includes(n.href));

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-ink-700 bg-ink-900 md:flex">
        <div className="px-4 py-4"><Logo /></div>
        <div className="px-3 pb-3">
          {orgs.length > 1 ? (
            <select aria-label="Organization" value={orgId} className="input py-1.5 text-xs"
              onChange={(e) => start(() => switchOrganization(e.target.value))}>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          ) : (
            <p className="truncate rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-xs text-ink-300" title={orgName}>{orgName}</p>
          )}
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Main">{NAV.map((n) => <NavLink key={n.href} item={n} />)}</nav>
        <div className="border-t border-ink-700 p-3">
          <div className="flex items-center gap-2.5">
            <Avatar name={userName} className="size-8 text-xs" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-ink-100">{userName}</p>
              <p className="truncate text-[11px] text-ink-400">{demo ? "Demo (read-only)" : ROLE_LABEL[role]}</p>
            </div>
            <form action={logout}><button className="rounded-md p-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100" aria-label="Sign out" title="Sign out"><LogOut className="size-4" /></button></form>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        {demo && (
          <div className="border-b border-warn/30 bg-warn/10 px-4 py-1.5 text-center text-xs text-warn">
            <b>DEMO MODE</b> — fictional sample data. Changes are disabled and nothing is saved. Add Supabase keys to go live (see README).
          </div>
        )}
        <header className="flex items-center justify-between border-b border-ink-700 bg-ink-900 px-4 py-3 md:hidden">
          <Logo size={24} />
          <Link href="/notifications" className="relative rounded-md p-1.5 text-ink-300" aria-label="Notifications">
            <Bell className="size-5" />
            {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-brand text-[9px] font-bold text-ink-950">{unread > 9 ? "9+" : unread}</span>}
          </Link>
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-4 pb-28 pt-5 md:px-8 md:pb-10 md:pt-7">{children}</main>
      </div>

      {/* Mobile bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-ink-700 bg-ink-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Mobile">
        {mobilePrimary.map((n) => {
          const Icon = n.icon;
          return (
            <Link key={n.href} href={n.href} className={clsx("flex flex-col items-center gap-0.5 py-2.5 text-[10px]", active(n.href) ? "text-brand" : "text-ink-400")}>
              <Icon className="size-5" />{n.label}
            </Link>
          );
        })}
        <button onClick={() => setMore(true)} className="flex flex-col items-center gap-0.5 py-2.5 text-[10px] text-ink-400"><MoreHorizontal className="size-5" />More</button>
      </nav>
      {more && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="More navigation">
          <button className="absolute inset-0 bg-black/60" aria-label="Close" onClick={() => setMore(false)} />
          <div className="rise absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-ink-700 bg-ink-900 p-4 pb-8">
            <div className="mb-2 flex items-center justify-between"><p className="label-caps">{orgName}</p><button onClick={() => setMore(false)} aria-label="Close"><X className="size-5 text-ink-400" /></button></div>
            <div className="space-y-0.5">{NAV.map((n) => <NavLink key={n.href} item={n} onClick={() => setMore(false)} />)}</div>
            <form action={logout} className="mt-3 border-t border-ink-700 pt-3"><button className="btn-ghost w-full justify-start"><LogOut className="size-4" /> Sign out ({userName})</button></form>
          </div>
        </div>
      )}
    </div>
  );
}
