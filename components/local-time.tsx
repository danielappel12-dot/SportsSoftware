"use client";
/** Renders a timestamp in the viewer's own time zone (server renders UTC first, hence suppressHydrationWarning). */
export function LocalTime({ iso, mode = "datetime" }: { iso: string | null | undefined; mode?: "datetime" | "time" | "date" | "long" }) {
  if (!iso) return <>—</>;
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions =
    mode === "time" ? { hour: "numeric", minute: "2-digit" }
    : mode === "date" ? { month: "short", day: "numeric", year: "numeric" }
    : mode === "long" ? { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  return <time dateTime={iso} suppressHydrationWarning>{d.toLocaleString("en-US", opts)}</time>;
}
