// FICTIONAL sample data used only in demo mode. Nothing here is ever written to a database.
import { addDays, todayISO } from "./dates.ts";
import type { OrgData, Deliverable, Sponsor, Contract } from "./types.ts";

/** Map readable demo ids ("demo-s1") to deterministic, valid UUIDs so server-side validation behaves like production. */
export function demoId(id: string): string {
  const m = /^demo-([a-z]+)(\d*)$/.exec(id);
  if (!m) return id;
  const hex = [...m[1].slice(0, 4)].map((c) => c.charCodeAt(0).toString(16)).join("").padEnd(8, "0").slice(0, 8);
  return `${hex}-0000-4000-8000-${(m[2] || "0").padStart(12, "0")}`;
}

export const DEMO_ORG = { id: demoId("demo-org"), name: "Riverton Rapids (Fictional Demo)" };
export const DEMO_USER = { id: demoId("demo-u1"), email: "demo@sponsorsync.example", full_name: "Alex Demo" };

export function buildDemoData(now: Date = new Date()): OrgData {
  return JSON.parse(JSON.stringify(build(now)), (_k, v) => (typeof v === "string" ? demoId(v) : v));
}

function build(now: Date): OrgData {
  const today = todayISO(now);
  const day = (n: number) => addDays(today, n);
  const ts = (n: number, hours = 19) => {
    const d = new Date(now); d.setUTCDate(d.getUTCDate() + n); d.setUTCHours(hours, 0, 0, 0); return d.toISOString();
  };
  const org = "demo-org";
  const me = "demo-u1";
  const created = ts(-100);

  const sp = (id: string, name: string, industry: string, tier: string, status: string, contact: string, value: number,
    start: number | null, end: number | null, renewal: number | null, notes: string | null): Sponsor => ({
    id, org_id: org, name, industry, tier, status, contact_name: contact,
    contact_email: `${contact.split(" ")[0].toLowerCase()}@${name.split(" ")[0].toLowerCase()}.example`,
    contact_phone: "555-0100", account_manager_id: "demo-u2", contract_value: value,
    contract_start: start == null ? null : day(start), contract_end: end == null ? null : day(end),
    renewal_date: renewal == null ? null : day(renewal), notes, logo_asset_id: null, created_at: created,
  });
  const sponsors: Sponsor[] = [
    sp("demo-s1", "Northwind Credit Union", "Financial services", "title", "active", "Dana Whitfield", 250000, -120, 245, 200, "INTERNAL: CFO prefers email; wants more broadcast exposure."),
    sp("demo-s2", "Harbor Health Systems", "Healthcare", "presenting", "active", "Marcus Lee", 120000, -100, 20, 25, "INTERNAL: renewal at risk — budget cuts."),
    sp("demo-s3", "Summit Outdoor Co.", "Retail", "premier", "active", "Priya Nair", 60000, -90, 270, 240, null),
    sp("demo-s4", "Pine Ridge Motors", "Automotive", "official", "active", "Tom Okafor", 35000, -60, 300, 45, "INTERNAL: interested in a tunnel-signage upgrade."),
    sp("demo-s5", "Volt Energy Drink", "Food & beverage", "partner", "prospect", "Jess Moreno", 15000, null, null, null, null),
    sp("demo-s6", "Old Mill Brewing", "Food & beverage", "supplier", "archived", "Sam Cole", 20000, -400, -35, null, "INTERNAL: did not renew."),
  ];

  const ct = (id: string, sid: string, name: string, status: string, value: number, s: number, e: number, r: number | null, terms: string | null): Contract => ({
    id, org_id: org, sponsor_id: sid, name, status, value, start_date: day(s), end_date: day(e),
    renewal_date: r == null ? null : day(r), terms_summary: terms, notes: null, created_at: created,
  });
  const contracts: Contract[] = [
    ct("demo-c1", "demo-s1", "Title Partnership 2 yr", "active", 250000, -120, 245, 200, "Naming rights, 20 LED boards, 12 radio reads / month."),
    ct("demo-c2", "demo-s2", "Presenting Partner", "active", 120000, -100, 20, 25, "Presenting sponsor of Family Sundays; 6 in-game features."),
    ct("demo-c3", "demo-s3", "Premier Outfitter", "active", 60000, -90, 270, 240, "Concourse activation and social features."),
    ct("demo-c4", "demo-s4", "Official Vehicle", "active", 35000, -60, 300, 45, "Vehicle display, 6 PA announcements per game."),
    ct("demo-c5", "demo-s5", "Trial Partnership", "draft", 15000, 10, 200, null, "Pending signature."),
    ct("demo-c6", "demo-s6", "Beer Supplier 2025", "expired", 20000, -400, -35, null, null),
  ];

  const seasons = [{ id: "demo-season", org_id: org, name: "Current Season", starts_on: day(-120), ends_on: day(180) }];
  const ev = (id: string, name: string, n: number, opp: string | null, venue: string, status: string, desc: string) => ({
    id, org_id: org, season_id: "demo-season", name, starts_at: ts(n), opponent: opp, venue, description: desc, status,
  });
  const events = [
    ev("demo-e1", "Season Opener vs Lakeside Lynx", -40, "Lakeside Lynx", "Riverton Field", "completed", "Opening night."),
    ev("demo-e2", "Family Sunday vs Ridge Hawks", 2, "Ridge Hawks", "Riverton Field", "planned", "Harbor Health Family Sunday."),
    ev("demo-e3", "Rivalry Night vs Bay City Bolts", 9, "Bay City Bolts", "Riverton Field", "planned", "Sold-out rivalry game."),
    ev("demo-e4", "Fan Fest", 24, null, "Riverton Plaza", "planned", "Pre-season community festival."),
  ];

  let n = 0;
  const dl = (sid: string, cid: string | null, eid: string | null, category: string, description: string, due: number | null,
    priority: string, status: string, value: number | null, notes: string | null = null, assignee = me): Deliverable => ({
    id: `demo-d${++n}`, org_id: org, sponsor_id: sid, contract_id: cid, event_id: eid, category, description,
    due_date: due == null ? null : day(due), assigned_to: assignee, priority, status,
    completed_at: status === "completed" ? ts((due ?? 0), 15) : null, notes, estimated_value: value, created_at: created,
  });
  const deliverables: Deliverable[] = [
    dl("demo-s1", "demo-c1", "demo-e2", "signage", "LED board rotation — 20 slots per game", 2, "high", "in_progress", 8000, "INTERNAL: creative refresh pending approval."),
    dl("demo-s2", "demo-c2", "demo-e2", "in_game", "Family Sunday on-field presentation", 2, "high", "not_started", 6000),
    dl("demo-s2", "demo-c2", "demo-e2", "activation", "Kids health-zone concourse booth", 2, "medium", "blocked", 3500, "INTERNAL: waiting on tent permit.", "demo-u2"),
    dl("demo-s1", "demo-c1", null, "broadcast", "Monthly radio reads (12) — month 4", -5, "high", "in_progress", 4000),
    dl("demo-s1", "demo-c1", "demo-e1", "in_game", "Opening ceremony title-sponsor recognition", -40, "high", "completed", 5000),
    dl("demo-s1", "demo-c1", null, "digital", "Website banner placements (quarterly)", 14, "medium", "not_started", 2500),
    dl("demo-s1", "demo-c1", null, "social", "Social media features (4 per month)", 6, "medium", "awaiting_approval", 1800),
    dl("demo-s2", "demo-c2", null, "social", "Health tip social series", -12, "medium", "in_progress", 1500, null, "demo-u2"),
    dl("demo-s2", "demo-c2", "demo-e1", "signage", "Concourse banner install", -38, "medium", "completed", 2000),
    dl("demo-s2", "demo-c2", null, "hospitality", "Suite night for 12 guests", 12, "low", "not_started", 3000),
    dl("demo-s2", "demo-c2", null, "media", "Season recap video feature", 18, "medium", "not_applicable", null),
    dl("demo-s3", "demo-c3", "demo-e3", "activation", "Concourse trail-run simulator activation", 9, "high", "in_progress", 5000, null, "demo-u2"),
    dl("demo-s3", "demo-c3", null, "social", "Giveaway post series", 3, "medium", "not_started", 1200),
    dl("demo-s3", "demo-c3", "demo-e1", "in_game", "Fan of the Game segment", -40, "low", "completed", 1500),
    dl("demo-s3", "demo-c3", null, "digital", "E-newsletter feature", -2, "low", "in_progress", 800),
    dl("demo-s4", "demo-c4", "demo-e3", "activation", "Vehicle display on main concourse", 9, "medium", "not_started", 2500),
    dl("demo-s4", "demo-c4", null, "broadcast", "PA announcements — 6 per game (batch 2)", 5, "medium", "in_progress", 1000),
    dl("demo-s4", "demo-c4", "demo-e1", "signage", "Vehicle logo on dugout wall", -40, "low", "completed", 1000),
    dl("demo-s4", "demo-c4", null, "community", "Test-drive community day", 30, "low", "not_started", 2000),
    dl("demo-s6", "demo-c6", null, "signage", "Taproom banners", -100, "low", "completed", 500),
  ];

  const activations = [
    { id: "demo-a1", org_id: org, event_id: "demo-e2", sponsor_id: "demo-s2", deliverable_id: "demo-d2", title: "Family Sunday presentation", details: "Pre-game on-field ceremony with Harbor mascot." },
    { id: "demo-a2", org_id: org, event_id: "demo-e2", sponsor_id: "demo-s2", deliverable_id: "demo-d3", title: "Kids health zone", details: "Concourse booth section 112." },
    { id: "demo-a3", org_id: org, event_id: "demo-e2", sponsor_id: "demo-s1", deliverable_id: "demo-d1", title: "LED board rotation", details: "20 slots, creative v3." },
    { id: "demo-a4", org_id: org, event_id: "demo-e3", sponsor_id: "demo-s3", deliverable_id: "demo-d12", title: "Trail-run simulator", details: "Plaza gate, 2 staff." },
  ];

  const tk = (i: number, event: string, act: string | null, title: string, offsetMin: number, status: string, blocker: string | null = null) => ({
    id: `demo-t${i}`, org_id: org, event_id: event, activation_id: act, title,
    scheduled_at: new Date(Date.parse(ts(event === "demo-e2" ? 2 : 9, 16)) + offsetMin * 60000).toISOString(),
    assigned_to: me, status, blocker_note: blocker, completed_at: status === "done" ? ts(-1) : null, position: i,
  });
  const tasks = [
    tk(1, "demo-e2", null, "Gates open — check all signage lit", 0, "todo"),
    tk(2, "demo-e2", "demo-a2", "Set up Harbor Health booth", 30, "blocked", "Tent permit not received."),
    tk(3, "demo-e2", "demo-a3", "Load LED creative v3 on boards", 45, "todo"),
    tk(4, "demo-e2", "demo-a1", "Mascot + sponsor rep walk-on briefing", 120, "todo"),
    tk(5, "demo-e2", "demo-a1", "On-field presentation", 170, "todo"),
    tk(6, "demo-e2", null, "Capture photo evidence for all activations", 180, "todo"),
    tk(7, "demo-e3", "demo-a4", "Confirm simulator delivery", 0, "todo"),
  ];

  const metrics = [
    { id: "demo-m1", org_id: org, sponsor_id: "demo-s1", event_id: "demo-e1", metric_name: "Attendance (opener)", metric_value: 8450, unit: "fans", recorded_on: day(-40) },
    { id: "demo-m2", org_id: org, sponsor_id: "demo-s1", event_id: null, metric_name: "Social impressions", metric_value: 412000, unit: "impressions", recorded_on: day(-10) },
    { id: "demo-m3", org_id: org, sponsor_id: "demo-s2", event_id: null, metric_name: "Booth visitors", metric_value: 640, unit: "people", recorded_on: day(-38) },
    { id: "demo-m4", org_id: org, sponsor_id: "demo-s3", event_id: null, metric_name: "Giveaway entries", metric_value: 1870, unit: "entries", recorded_on: day(-20) },
  ];

  return {
    sponsors, contracts, seasons, events, deliverables, activations, tasks, metrics,
    assets: [], evidence: [], reports: [],
    notifications: [{ id: "demo-n1", kind: "info", title: "Welcome to SponsorSync demo", body: "All data here is fictional and read-only.", link: "/dashboard", read_at: null, created_at: ts(-1) }],
    activity: [
      { id: "demo-l1", actor_id: me, entity_type: "deliverables", entity_id: "demo-d5", action: "status_completed", summary: "Opening ceremony title-sponsor recognition", created_at: ts(-3, 14) },
      { id: "demo-l2", actor_id: "demo-u2", entity_type: "deliverables", entity_id: "demo-d3", action: "status_blocked", summary: "Kids health-zone concourse booth", created_at: ts(-1, 10) },
      { id: "demo-l3", actor_id: me, entity_type: "sponsors", entity_id: "demo-s5", action: "insert", summary: "Volt Energy Drink", created_at: ts(-6, 12) },
    ],
    members: [
      { user_id: me, role: "admin", full_name: DEMO_USER.full_name, email: DEMO_USER.email },
      { user_id: "demo-u2", role: "partnerships_manager", full_name: "Jordan Rivera", email: "jordan@demo.example" },
      { user_id: "demo-u3", role: "creative_staff", full_name: "Sam Patel", email: "sam@demo.example" },
      { user_id: "demo-u4", role: "read_only", full_name: "Casey Brooks", email: "casey@demo.example" },
    ],
    invites: [],
  };
}
