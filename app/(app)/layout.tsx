import { Shell } from "@/components/shell";
import { getCtx, getOrgData } from "@/lib/data";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  const data = await getOrgData();
  const unread = data.notifications.filter((n) => !n.read_at).length;
  return (
    <Shell orgName={ctx.orgName} orgs={ctx.orgs} orgId={ctx.orgId} userName={ctx.fullName || ctx.email} role={ctx.role} unread={unread} demo={ctx.demo}>
      {children}
    </Shell>
  );
}
