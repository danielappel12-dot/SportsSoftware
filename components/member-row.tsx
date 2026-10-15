"use client";
import { useRunner } from "@/components/ui/toast";
import { removeMember, setMemberRole } from "@/lib/actions/settings";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/constants";

export function MemberRow({ userId, name, email, role, isSelf }: { userId: string; name: string; email: string; role: Role; isSelf: boolean }) {
  const { run, pending } = useRunner();
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{name}{isSelf && <span className="ml-1.5 text-xs text-ink-500">(you)</span>}</p><p className="truncate text-xs text-ink-400">{email}</p></div>
      <select className="input w-auto py-1.5 text-xs" value={role} disabled={pending} aria-label={`Role for ${name}`}
        onChange={(e) => run(() => setMemberRole(userId, e.target.value as Role), { success: "Role updated" })}>
        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
      </select>
      <button className="btn-ghost btn-sm text-danger" disabled={pending} onClick={() => confirm(`Remove ${name} from this organization?`) && run(() => removeMember(userId), { success: "Member removed" })}>Remove</button>
    </li>
  );
}
