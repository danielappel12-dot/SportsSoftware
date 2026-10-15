"use client";
import { useEffect, useState } from "react";

/** datetime-local input that submits a timezone-correct ISO string (converted in the browser). */
export function DateTimeInput({ name, defaultIso, required }: { name: string; defaultIso?: string | null; required?: boolean }) {
  const [local, setLocal] = useState("");
  useEffect(() => {
    if (!defaultIso) return;
    const d = new Date(defaultIso);
    const p = (n: number) => String(n).padStart(2, "0");
    setLocal(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`);
  }, [defaultIso]);
  const iso = local && !Number.isNaN(Date.parse(local)) ? new Date(local).toISOString() : "";
  return (
    <>
      <input id={name} type="datetime-local" className="input" value={local} required={required} onChange={(e) => setLocal(e.target.value)} />
      <input type="hidden" name={name} value={iso} />
    </>
  );
}
