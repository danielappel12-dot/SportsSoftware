-- SponsorSync example seed data (ALL FICTIONAL).
--
-- Usage: sign up in the app first (Authentication -> confirm the email), then run this file in the
-- Supabase SQL editor. It creates a new organization "Riverton Rapids (Fictional Demo Data)" and
-- makes the most recently created user its admin. Dates are relative to today so the dashboard
-- always has overdue / due-soon / upcoming rows. Safe to run more than once (each run adds a
-- separate demo organization).

do $seed$
declare
  u uuid;
  org uuid := gen_random_uuid();
  s_north uuid := gen_random_uuid(); s_harbor uuid := gen_random_uuid(); s_summit uuid := gen_random_uuid();
  s_pine uuid := gen_random_uuid(); s_volt uuid := gen_random_uuid(); s_brew uuid := gen_random_uuid();
  c_north uuid := gen_random_uuid(); c_harbor uuid := gen_random_uuid(); c_summit uuid := gen_random_uuid();
  c_pine uuid := gen_random_uuid(); c_volt uuid := gen_random_uuid(); c_brew uuid := gen_random_uuid();
  season uuid := gen_random_uuid();
  e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid(); e3 uuid := gen_random_uuid(); e4 uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); d3 uuid := gen_random_uuid();
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); a3 uuid := gen_random_uuid();
begin
  select id into u from public.profiles order by created_at desc limit 1;
  if u is null then
    raise exception 'No user found. Sign up in the app first, then run this seed.';
  end if;

  insert into public.organizations(id, name) values (org, 'Riverton Rapids (Fictional Demo Data)');
  insert into public.memberships(org_id, user_id, role) values (org, u, 'admin');
  insert into public.seasons(id, org_id, name, starts_on, ends_on)
    values (season, org, 'Current Season', current_date - 120, current_date + 180);

  insert into public.sponsors(id, org_id, name, industry, tier, status, contact_name, contact_email, contact_phone,
    account_manager_id, contract_value, contract_start, contract_end, renewal_date, notes) values
    (s_north, org, 'Northwind Credit Union', 'Financial services', 'title', 'active', 'Dana Whitfield', 'dana@northwind.example', '555-0101', u, 250000, current_date - 120, current_date + 245, current_date + 200, 'INTERNAL: CFO prefers email; wants more broadcast exposure.'),
    (s_harbor, org, 'Harbor Health Systems', 'Healthcare', 'presenting', 'active', 'Marcus Lee', 'marcus@harborhealth.example', '555-0102', u, 120000, current_date - 100, current_date + 20, current_date + 25, 'INTERNAL: renewal at risk — budget cuts.'),
    (s_summit, org, 'Summit Outdoor Co.', 'Retail', 'premier', 'active', 'Priya Nair', 'priya@summitoutdoor.example', '555-0103', u, 60000, current_date - 90, current_date + 270, current_date + 240, null),
    (s_pine, org, 'Pine Ridge Motors', 'Automotive', 'official', 'active', 'Tom Okafor', 'tom@pineridge.example', '555-0104', u, 35000, current_date - 60, current_date + 300, current_date + 45, 'INTERNAL: interested in a tunnel-signage upgrade.'),
    (s_volt, org, 'Volt Energy Drink', 'Food & beverage', 'partner', 'prospect', 'Jess Moreno', 'jess@voltdrink.example', '555-0105', u, 15000, null, null, null, null),
    (s_brew, org, 'Old Mill Brewing', 'Food & beverage', 'supplier', 'archived', 'Sam Cole', 'sam@oldmill.example', '555-0106', u, 20000, current_date - 400, current_date - 35, null, 'INTERNAL: did not renew.');

  insert into public.contracts(id, org_id, sponsor_id, name, status, value, start_date, end_date, renewal_date, terms_summary) values
    (c_north, org, s_north, 'Title Partnership 2 yr', 'active', 250000, current_date - 120, current_date + 245, current_date + 200, 'Naming rights, 20 LED boards, 12 radio reads / month.'),
    (c_harbor, org, s_harbor, 'Presenting Partner', 'active', 120000, current_date - 100, current_date + 20, current_date + 25, 'Presenting sponsor of Family Sundays; 6 in-game features.'),
    (c_summit, org, s_summit, 'Premier Outfitter', 'active', 60000, current_date - 90, current_date + 270, current_date + 240, 'Concourse activation and social features.'),
    (c_pine, org, s_pine, 'Official Vehicle', 'active', 35000, current_date - 60, current_date + 300, current_date + 45, 'Vehicle display, 6 PA announcements per game.'),
    (c_volt, org, s_volt, 'Trial Partnership', 'draft', 15000, current_date + 10, current_date + 200, null, 'Pending signature.'),
    (c_brew, org, s_brew, 'Beer Supplier 2025', 'expired', 20000, current_date - 400, current_date - 35, null, null);

  insert into public.events(id, org_id, season_id, name, starts_at, opponent, venue, status, description) values
    (e1, org, season, 'Season Opener vs Lakeside Lynx', now() - interval '40 days', 'Lakeside Lynx', 'Riverton Field', 'completed', 'Opening night.'),
    (e2, org, season, 'Family Sunday vs Ridge Hawks', now() + interval '2 days' + interval '1 hour', 'Ridge Hawks', 'Riverton Field', 'planned', 'Harbor Health Family Sunday.'),
    (e3, org, season, 'Rivalry Night vs Bay City Bolts', now() + interval '9 days', 'Bay City Bolts', 'Riverton Field', 'planned', 'Sold-out rivalry game.'),
    (e4, org, season, 'Fan Fest', now() + interval '24 days', null, 'Riverton Plaza', 'planned', 'Pre-season community festival.');

  insert into public.deliverables(id, org_id, sponsor_id, contract_id, event_id, category, description, due_date, assigned_to, priority, status, notes, estimated_value) values
    (d1, org, s_north, c_north, e2, 'signage', 'LED board rotation — 20 slots per game', current_date + 2, u, 'high', 'in_progress', 'INTERNAL: creative refresh pending approval.', 8000),
    (d2, org, s_harbor, c_harbor, e2, 'in_game', 'Family Sunday on-field presentation', current_date + 2, u, 'high', 'not_started', null, 6000),
    (d3, org, s_harbor, c_harbor, e2, 'activation', 'Kids health-zone concourse booth', current_date + 2, u, 'medium', 'blocked', 'INTERNAL: waiting on tent permit.', 3500);
  insert into public.deliverables(org_id, sponsor_id, contract_id, event_id, category, description, due_date, assigned_to, priority, status, estimated_value) values
    (org, s_north, c_north, null, 'broadcast', 'Monthly radio reads (12) — month 4', current_date - 5, u, 'high', 'in_progress', 4000),
    (org, s_north, c_north, e1, 'in_game', 'Opening ceremony title-sponsor recognition', current_date - 40, u, 'high', 'completed', 5000),
    (org, s_north, c_north, null, 'digital', 'Website banner placements (quarterly)', current_date + 14, u, 'medium', 'not_started', 2500),
    (org, s_north, c_north, null, 'social', 'Social media features (4 per month)', current_date + 6, u, 'medium', 'awaiting_approval', 1800),
    (org, s_harbor, c_harbor, null, 'social', 'Health tip social series', current_date - 12, u, 'medium', 'in_progress', 1500),
    (org, s_harbor, c_harbor, e1, 'signage', 'Concourse banner install', current_date - 38, u, 'medium', 'completed', 2000),
    (org, s_harbor, c_harbor, null, 'hospitality', 'Suite night for 12 guests', current_date + 12, u, 'low', 'not_started', 3000),
    (org, s_harbor, c_harbor, null, 'media', 'Season recap video feature', current_date + 18, u, 'medium', 'not_applicable', null),
    (org, s_summit, c_summit, e3, 'activation', 'Concourse trail-run simulator activation', current_date + 9, u, 'high', 'in_progress', 5000),
    (org, s_summit, c_summit, null, 'social', 'Giveaway post series', current_date + 3, u, 'medium', 'not_started', 1200),
    (org, s_summit, c_summit, e1, 'in_game', 'Fan of the Game segment', current_date - 40, u, 'low', 'completed', 1500),
    (org, s_summit, c_summit, null, 'digital', 'E-newsletter feature', current_date - 2, u, 'low', 'in_progress', 800),
    (org, s_pine, c_pine, e3, 'activation', 'Vehicle display on main concourse', current_date + 9, u, 'medium', 'not_started', 2500),
    (org, s_pine, c_pine, null, 'broadcast', 'PA announcements — 6 per game (batch 2)', current_date + 5, u, 'medium', 'in_progress', 1000),
    (org, s_pine, c_pine, e1, 'signage', 'Vehicle logo on dugout wall', current_date - 40, u, 'low', 'completed', 1000),
    (org, s_pine, c_pine, null, 'community', 'Test-drive community day', current_date + 30, u, 'low', 'not_started', 2000),
    (org, s_brew, c_brew, null, 'signage', 'Taproom banners', current_date - 100, u, 'low', 'completed', 500);

  insert into public.activations(id, org_id, event_id, sponsor_id, deliverable_id, title, details) values
    (a1, org, e2, s_harbor, d2, 'Family Sunday presentation', 'Pre-game on-field ceremony with Harbor mascot.'),
    (a2, org, e2, s_harbor, d3, 'Kids health zone', 'Concourse booth section 112.'),
    (a3, org, e2, s_north, d1, 'LED board rotation', '20 slots, creative v3.');
  insert into public.activations(org_id, event_id, sponsor_id, title, details)
    values (org, e3, s_summit, 'Trail-run simulator', 'Plaza gate, 2 staff.');

  insert into public.event_tasks(org_id, event_id, activation_id, title, scheduled_at, assigned_to, status, blocker_note, position) values
    (org, e2, null, 'Gates open — check all signage lit', now() + interval '2 days', u, 'todo', null, 1),
    (org, e2, a2, 'Set up Harbor Health booth', now() + interval '2 days' + interval '30 minutes', u, 'blocked', 'Tent permit not received.', 2),
    (org, e2, a3, 'Load LED creative v3 on boards', now() + interval '2 days' + interval '45 minutes', u, 'todo', null, 3),
    (org, e2, a1, 'Mascot + sponsor rep walk-on briefing', now() + interval '2 days' + interval '2 hours', u, 'todo', null, 4),
    (org, e2, a1, 'On-field presentation', now() + interval '2 days' + interval '2 hours 50 minutes', u, 'todo', null, 5),
    (org, e2, null, 'Capture photo evidence for all activations', now() + interval '2 days' + interval '3 hours', u, 'todo', null, 6),
    (org, e3, null, 'Confirm simulator delivery', now() + interval '8 days', u, 'todo', null, 1);

  insert into public.sponsor_metrics(org_id, sponsor_id, event_id, metric_name, metric_value, unit, recorded_on) values
    (org, s_north, e1, 'Attendance (opener)', 8450, 'fans', (current_date - 40)),
    (org, s_north, null, 'Social impressions', 412000, 'impressions', (current_date - 10)),
    (org, s_harbor, null, 'Booth visitors', 640, 'people', (current_date - 38)),
    (org, s_summit, null, 'Giveaway entries', 1870, 'entries', (current_date - 20));

  insert into public.notifications(org_id, user_id, kind, title, body, link)
    values (org, u, 'info', 'Welcome to SponsorSync', 'This organization contains fictional example data.', '/dashboard');
end
$seed$;
