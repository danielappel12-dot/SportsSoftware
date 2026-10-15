"use client";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type Datum = { name: string; value: number; color?: string; detail?: string };

const AXIS = "#9aa5b0";
const GRID = "#272d34";
const BLUE = "#3987e5"; // categorical slot 1 (dark-mode step)

function Tip({ active, payload, unit }: { active?: boolean; payload?: { payload: Datum }[]; unit?: string }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-ink-600 bg-ink-850 px-2.5 py-1.5 text-xs shadow-xl">
      <p className="font-medium text-ink-100">{d.name}</p>
      <p className="tabular-nums text-ink-300">{d.value}{unit}{d.detail ? ` · ${d.detail}` : ""}</p>
    </div>
  );
}

function DataTable({ data, unit }: { data: Datum[]; unit?: string }) {
  return (
    <details className="mt-2 text-xs text-ink-400">
      <summary className="cursor-pointer hover:text-ink-200">View as table</summary>
      <table className="mt-2 w-full"><tbody>{data.map((d) => <tr key={d.name}><td className="py-0.5 pr-3 text-ink-300">{d.name}</td><td className="py-0.5 text-right tabular-nums">{d.value}{unit}{d.detail ? ` (${d.detail})` : ""}</td></tr>)}</tbody></table>
    </details>
  );
}

/** Horizontal bars with direct value labels (rank/magnitude by category). */
export function HBarChart({ data, unit, max, label }: { data: Datum[]; unit?: string; max?: number; label: string }) {
  if (!data.length) return <p className="p-6 text-center text-sm text-ink-500">No data for the current filters.</p>;
  return (
    <figure aria-label={label}>
      <div style={{ height: Math.max(120, data.length * 34 + 16) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 36, top: 4, bottom: 0 }} barCategoryGap={8}>
            <CartesianGrid horizontal={false} stroke={GRID} />
            <XAxis type="number" hide domain={[0, max ?? "dataMax"]} />
            <YAxis type="category" dataKey="name" width={118} tickLine={false} axisLine={false} tick={{ fill: AXIS, fontSize: 12 }} />
            <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<Tip unit={unit} />} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={18}>
              {data.map((d) => <Cell key={d.name} fill={d.color ?? BLUE} />)}
              <LabelList dataKey="value" position="right" fill="#e6eaee" fontSize={11} formatter={(v: unknown) => `${v}${unit ?? ""}`} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable data={data} unit={unit} />
    </figure>
  );
}

/** Vertical columns (counts over time). */
export function ColumnChart({ data, label }: { data: Datum[]; label: string }) {
  return (
    <figure aria-label={label}>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: -16, right: 4, top: 14, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fill: AXIS, fontSize: 11 }} interval={0} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: AXIS, fontSize: 11 }} width={32} />
            <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<Tip />} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={28}>
              {data.map((d) => <Cell key={d.name} fill={d.color ?? BLUE} />)}
              <LabelList dataKey="value" position="top" fill="#e6eaee" fontSize={11} formatter={(v: unknown) => (Number(v) ? String(v) : "")} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable data={data} />
    </figure>
  );
}
