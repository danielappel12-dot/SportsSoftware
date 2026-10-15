-- SponsorSync: core schema
-- Multi-tenant: every business table carries org_id. Cross-table references use
-- composite (id, org_id) foreign keys so a row can never point at another org's data.


-- ---------------------------------------------------------------- enums
create type public.app_role as enum ('admin', 'partnerships_manager', 'creative_staff', 'read_only');
create type public.account_status as enum ('prospect', 'active', 'paused', 'archived');
create type public.sponsor_tier as enum ('title', 'presenting', 'premier', 'official', 'partner', 'supplier');
create type public.contract_status as enum ('draft', 'active', 'expired', 'canceled');
create type public.deliverable_status as enum ('not_started', 'in_progress', 'awaiting_approval', 'blocked', 'completed', 'not_applicable');
create type public.priority_level as enum ('low', 'medium', 'high', 'urgent');
create type public.deliverable_category as enum ('signage', 'broadcast', 'digital', 'social', 'hospitality', 'in_game', 'activation', 'media', 'community', 'other');
create type public.event_status as enum ('planned', 'live', 'completed', 'canceled');
create type public.task_status as enum ('todo', 'done', 'blocked');
create type public.asset_category as enum ('logo', 'creative', 'image', 'document', 'evidence', 'other');
create type public.approval_status as enum ('pending', 'approved', 'rejected');

-- ---------------------------------------------------------------- identity
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text check (full_name is null or char_length(full_name) <= 120),
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null default 'read_only',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  role public.app_role not null default 'read_only',
  invited_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index invites_open_unique on public.invites(org_id, email) where accepted_at is null;

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (id, org_id)
);
create index seasons_org_idx on public.seasons(org_id, starts_on desc);

-- ---------------------------------------------------------------- sponsors
create table public.sponsors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  industry text check (industry is null or char_length(industry) <= 80),
  tier public.sponsor_tier not null default 'partner',
  status public.account_status not null default 'active',
  contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  contact_email text check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 40),
  account_manager_id uuid references public.profiles(id) on delete set null,
  contract_value numeric(14,2) not null default 0 check (contract_value >= 0),
  contract_start date,
  contract_end date,
  renewal_date date,
  notes text check (notes is null or char_length(notes) <= 10000), -- INTERNAL ONLY
  logo_asset_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (contract_end is null or contract_start is null or contract_end >= contract_start),
  unique (id, org_id)
);
create unique index sponsors_name_unique on public.sponsors(org_id, lower(name));
create index sponsors_org_status_idx on public.sponsors(org_id, status);
create index sponsors_renewal_idx on public.sponsors(org_id, renewal_date) where renewal_date is not null;

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  sponsor_id uuid not null,
  name text not null check (char_length(name) between 1 and 160),
  status public.contract_status not null default 'active',
  value numeric(14,2) not null default 0 check (value >= 0),
  start_date date not null,
  end_date date not null,
  renewal_date date,
  terms_summary text check (terms_summary is null or char_length(terms_summary) <= 5000),
  notes text check (notes is null or char_length(notes) <= 10000), -- INTERNAL ONLY
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  unique (id, org_id),
  foreign key (sponsor_id, org_id) references public.sponsors(id, org_id) on delete cascade
);
create index contracts_org_sponsor_idx on public.contracts(org_id, sponsor_id);
create index contracts_org_end_idx on public.contracts(org_id, end_date);

-- ---------------------------------------------------------------- events
create table public.events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  season_id uuid,
  name text not null check (char_length(name) between 1 and 160),
  starts_at timestamptz not null,
  opponent text check (opponent is null or char_length(opponent) <= 160),
  venue text check (venue is null or char_length(venue) <= 160),
  description text check (description is null or char_length(description) <= 5000),
  status public.event_status not null default 'planned',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (season_id, org_id) references public.seasons(id, org_id) on delete set null (season_id)
);
create index events_org_start_idx on public.events(org_id, starts_at);

-- ---------------------------------------------------------------- deliverables
create table public.deliverables (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  sponsor_id uuid not null,
  contract_id uuid,
  event_id uuid,
  category public.deliverable_category not null default 'other',
  description text not null check (char_length(description) between 1 and 2000),
  due_date date,
  assigned_to uuid references public.profiles(id) on delete set null,
  priority public.priority_level not null default 'medium',
  status public.deliverable_status not null default 'not_started',
  completed_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 10000), -- INTERNAL ONLY
  estimated_value numeric(14,2) check (estimated_value is null or estimated_value >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  check ((status = 'completed') = (completed_at is not null)),
  foreign key (sponsor_id, org_id) references public.sponsors(id, org_id) on delete cascade,
  foreign key (contract_id, org_id) references public.contracts(id, org_id) on delete set null (contract_id),
  foreign key (event_id, org_id) references public.events(id, org_id) on delete set null (event_id)
);
create index deliverables_org_status_idx on public.deliverables(org_id, status);
create index deliverables_org_due_idx on public.deliverables(org_id, due_date);
create index deliverables_sponsor_idx on public.deliverables(sponsor_id);
create index deliverables_assignee_idx on public.deliverables(assigned_to);
create index deliverables_event_idx on public.deliverables(event_id);
create index deliverables_contract_idx on public.deliverables(contract_id);

create table public.activations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  event_id uuid not null,
  sponsor_id uuid not null,
  deliverable_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  details text check (details is null or char_length(details) <= 3000),
  created_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (event_id, org_id) references public.events(id, org_id) on delete cascade,
  foreign key (sponsor_id, org_id) references public.sponsors(id, org_id) on delete cascade,
  foreign key (deliverable_id, org_id) references public.deliverables(id, org_id) on delete set null (deliverable_id)
);
create index activations_event_idx on public.activations(event_id);
create index activations_sponsor_idx on public.activations(sponsor_id);

create table public.event_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  event_id uuid not null,
  activation_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  scheduled_at timestamptz,
  assigned_to uuid references public.profiles(id) on delete set null,
  status public.task_status not null default 'todo',
  blocker_note text check (blocker_note is null or char_length(blocker_note) <= 1000),
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, org_id),
  check ((status = 'done') = (completed_at is not null)),
  foreign key (event_id, org_id) references public.events(id, org_id) on delete cascade,
  foreign key (activation_id, org_id) references public.activations(id, org_id) on delete set null (activation_id)
);
create index event_tasks_event_idx on public.event_tasks(event_id, position);
create index event_tasks_assignee_idx on public.event_tasks(assigned_to);

-- ---------------------------------------------------------------- assets & evidence
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  sponsor_id uuid not null,
  category public.asset_category not null default 'other',
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  storage_path text not null unique, -- never returned to the browser
  approval_status public.approval_status not null default 'pending',
  expires_on date,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, org_id),
  check (position(org_id::text || '/' in storage_path) = 1),
  foreign key (sponsor_id, org_id) references public.sponsors(id, org_id) on delete cascade
);
create index assets_org_sponsor_idx on public.assets(org_id, sponsor_id, category);
create index assets_expiry_idx on public.assets(org_id, expires_on) where expires_on is not null;

alter table public.sponsors
  add constraint sponsors_logo_fk foreign key (logo_asset_id) references public.assets(id) on delete set null;

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  sponsor_id uuid not null,
  asset_id uuid not null,
  deliverable_id uuid,
  event_id uuid,
  event_task_id uuid,
  caption text check (caption is null or char_length(caption) <= 500),
  include_in_report boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (sponsor_id, org_id) references public.sponsors(id, org_id) on delete cascade,
  foreign key (asset_id, org_id) references public.assets(id, org_id) on delete cascade,
  foreign key (deliverable_id, org_id) references public.deliverables(id, org_id) on delete set null (deliverable_id),
  foreign key (event_id, org_id) references public.events(id, org_id) on delete set null (event_id),
  foreign key (event_task_id, org_id) references public.event_tasks(id, org_id) on delete set null (event_task_id)
);
create index evidence_sponsor_idx on public.evidence(org_id, sponsor_id, created_at desc);
create index evidence_deliverable_idx on public.evidence(deliverable_id);
create index evidence_event_idx on public.evidence(event_id);

-- ---------------------------------------------------------------- reporting
create table public.sponsor_metrics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  sponsor_id uuid not null,
  event_id uuid,
  metric_name text not null check (char_length(metric_name) between 1 and 120),
  metric_value numeric(18,2) not null,
  unit text check (unit is null or char_length(unit) <= 30),
  recorded_on date not null default current_date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (sponsor_id, org_id) references public.sponsors(id, org_id) on delete cascade,
  foreign key (event_id, org_id) references public.events(id, org_id) on delete set null (event_id)
);
create index sponsor_metrics_idx on public.sponsor_metrics(org_id, sponsor_id, recorded_on);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  sponsor_id uuid not null,
  range_start date not null,
  range_end date not null,
  highlights text check (highlights is null or char_length(highlights) <= 5000),
  generated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (range_end >= range_start),
  foreign key (sponsor_id, org_id) references public.sponsors(id, org_id) on delete cascade
);
create index reports_org_idx on public.reports(org_id, created_at desc);

-- ---------------------------------------------------------------- notifications & activity
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, read_at, created_at desc);

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  summary text,
  created_at timestamptz not null default now()
);
create index activity_org_idx on public.activity_log(org_id, created_at desc);
