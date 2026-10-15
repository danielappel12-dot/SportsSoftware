import { test } from "node:test";
import assert from "node:assert/strict";
import { contractSchema, deliverableSchema, reportParamsSchema, sponsorSchema } from "../lib/schemas.ts";
import { parse } from "../lib/actions/parse.ts";

test("sponsor: rejects bad email and reversed dates", () => {
  const bad = sponsorSchema.safeParse({ name: "A", tier: "title", contact_email: "nope", contract_start: "2026-05-01", contract_end: "2026-04-01" });
  assert.equal(bad.success, false);
  const paths = bad.error!.issues.map((i) => i.path[0]);
  assert.ok(paths.includes("contact_email") && paths.includes("contract_end"));
});

test("sponsor: accepts a minimal valid record and defaults value to 0", () => {
  const ok = sponsorSchema.parse({ name: "Acme", tier: "partner" });
  assert.equal(ok.contract_value, 0);
  assert.equal(ok.status, "active");
});

test("deliverable: requires sponsor uuid, description and valid enums", () => {
  assert.equal(deliverableSchema.safeParse({ sponsor_id: "x", category: "other", description: "d" }).success, false);
  assert.equal(deliverableSchema.safeParse({ sponsor_id: crypto.randomUUID(), category: "other", description: "d", status: "weird" }).success, false);
  assert.equal(deliverableSchema.safeParse({ sponsor_id: crypto.randomUUID(), category: "other", description: "d" }).success, true);
});

test("contract: end before start is rejected; negative value rejected", () => {
  const id = crypto.randomUUID();
  assert.equal(contractSchema.safeParse({ sponsor_id: id, name: "c", start_date: "2026-02-01", end_date: "2026-01-01" }).success, false);
  assert.equal(contractSchema.safeParse({ sponsor_id: id, name: "c", start_date: "2026-01-01", end_date: "2026-02-01", value: -5 }).success, false);
});

test("report params: range limits", () => {
  const sponsor = crypto.randomUUID();
  assert.equal(reportParamsSchema.safeParse({ sponsor, from: "2026-02-01", to: "2026-01-01" }).success, false);
  assert.equal(reportParamsSchema.safeParse({ sponsor, from: "2020-01-01", to: "2026-01-01" }).success, false);
  assert.equal(reportParamsSchema.safeParse({ sponsor, from: "2026-01-01", to: "2026-03-01" }).success, true);
});

test("parse(): FormData empty strings become undefined and errors map to field names", () => {
  const fd = new FormData();
  fd.set("name", " Acme "); fd.set("tier", "partner"); fd.set("industry", "");
  const ok = parse(sponsorSchema, fd);
  assert.ok(ok.ok && ok.data.name === "Acme" && ok.data.industry === undefined);
  const fd2 = new FormData(); fd2.set("name", ""); fd2.set("tier", "partner");
  const bad = parse(sponsorSchema, fd2);
  assert.ok(!bad.ok && bad.state && bad.state.ok === false && "name" in (bad.state.fieldErrors ?? {}));
});
