import { LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="card mx-auto mt-10 max-w-md p-8 text-center">
      <h1 className="text-base font-semibold">Not found</h1>
      <p className="mt-1 text-sm text-ink-400">That record doesn&apos;t exist, was archived, or you don&apos;t have access to it.</p>
      <div className="mt-4"><LinkButton href="/dashboard">Back to dashboard</LinkButton></div>
    </div>
  );
}
