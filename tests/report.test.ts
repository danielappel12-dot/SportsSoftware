import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReportData } from "../lib/report.ts";
import { buildDemoData, demoId } from "../lib/demo-data.ts";

const now = new Date("2026-10-15T12:00:00Z");
const data = buildDemoData(now);
const params = { sponsor: demoId("demo-s1"), from: "2026-01-01", to: "2026-12-31", highlights: "Great opener" };

test("sponsor-facing report never leaks internal notes", () => {
  const r = buildReportData(data, "Org", params, now)!;
  const json = JSON.stringify(r);
  assert.ok(!json.includes("INTERNAL"), "internal notes must not appear");
  for (const s of data.sponsors) if (s.notes) assert.ok(!json.includes(s.notes));
  assert.ok(!("notes" in r.contracted[0]));
});

test("not-applicable deliverables are excluded from the report", () => {
  const r = buildReportData(data, "Org", { ...params, sponsor: demoId("demo-s2") }, now)!;
  assert.ok(!r.contracted.some((d) => d.description.includes("recap video")));
});

test("completed + outstanding partition the contracted set", () => {
  const r = buildReportData(data, "Org", params, now)!;
  assert.equal(r.completed.length + r.outstanding.length, r.contracted.length);
  assert.ok(r.contracted.length > 0);
});

test("unknown sponsor yields null", () => {
  assert.equal(buildReportData(data, "Org", { ...params, sponsor: "nope" }, now), null);
});
