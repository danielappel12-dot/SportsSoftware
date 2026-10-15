import { test } from "node:test";
import assert from "node:assert/strict";
import { completion, isOverdue, isOutstanding, lookup } from "../lib/metrics.ts";

const l = lookup(
  [{ id: "s1", status: "active" }, { id: "s2", status: "archived" }],
  [{ id: "c1", status: "active" }, { id: "c2", status: "canceled" }],
);
const d = (status: string, extra: object = {}) => ({ status, sponsor_id: "s1", contract_id: null, due_date: null, ...extra });

test("not-applicable items are excluded from the denominator", () => {
  const r = completion([d("completed"), d("not_applicable"), d("in_progress"), d("blocked")], l);
  assert.deepEqual([r.eligible, r.completed, r.outstanding], [3, 1, 2]);
  assert.equal(Math.round((r.rate ?? 0) * 100), 33);
});

test("canceled contracts and archived sponsors do not create obligations", () => {
  const r = completion([d("in_progress", { contract_id: "c2" }), d("in_progress", { sponsor_id: "s2" }), d("completed")], l);
  assert.equal(r.eligible, 1);
  assert.equal(r.rate, 1);
});

test("rate is null (not 0%) when nothing is eligible", () => {
  assert.equal(completion([d("not_applicable")], l).rate, null);
  assert.equal(completion([], l).rate, null);
});

test("overdue only applies to outstanding, eligible items", () => {
  const today = "2026-10-15";
  assert.equal(isOverdue(d("in_progress", { due_date: "2026-10-01" }) as never, l, today), true);
  assert.equal(isOverdue(d("completed", { due_date: "2026-10-01" }) as never, l, today), false);
  assert.equal(isOverdue(d("not_applicable", { due_date: "2026-10-01" }) as never, l, today), false);
  assert.equal(isOverdue(d("in_progress", { due_date: "2026-10-15" }) as never, l, today), false);
  assert.equal(isOutstanding(d("blocked") as never, l), true);
});
