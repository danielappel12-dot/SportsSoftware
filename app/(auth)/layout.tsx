import { Logo } from "@/components/brand";
import { isDemo } from "@/lib/env";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center"><Logo size={34} /></div>
        <div className="card p-6">{children}</div>
        {isDemo && (
          <p className="mt-4 rounded-lg border border-warn/30 bg-warn/10 p-3 text-center text-xs text-warn">
            Supabase isn&apos;t configured, so SponsorSync is in <b>demo mode</b> (fictional, read-only data).{" "}
            <Link href="/dashboard" className="underline">Open the demo</Link>
          </p>
        )}
      </div>
    </main>
  );
}
