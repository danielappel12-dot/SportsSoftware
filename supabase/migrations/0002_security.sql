-- SponsorSync: helper functions, triggers, Row Level Security, storage policies.

-- ---------------------------------------------------------------- helpers
create or replace function public.is_org_member(_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.org_id = _org and m.user_id = auth.uid());
$$;

create or replace function public.has_org_role(_org uuid, _roles public.app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = _org and m.user_id = auth.uid() and m.role = any(_roles)
  );
$$;

create or replace function public.shares_org_with(_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships a
    join public.memberships b on a.org_id = b.org_id
    where a.user_id = auth.uid() and b.user_id = _user
  );
$$;

create or replace function public.safe_uuid(_v text)
returns uuid language plpgsql immutable as $$
begin
  return _v::uuid;
exception when others then
  return null;
end $$;

-- ---------------------------------------------------------------- triggers
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger sponsors_touch before update on public.sponsors for each row execute function public.touch_updated_at();
create trigger contracts_touch before update on public.contracts for each row execute function public.touch_updated_at();
create trigger events_touch before update on public.events for each row execute function public.touch_updated_at();
create trigger deliverables_touch before update on public.deliverables for each row execute function public.touch_updated_at();

-- completed_at always mirrors status = 'completed'
create or replace function public.sync_deliverable_completion() returns trigger language plpgsql as $$
begin
  if new.status = 'completed' then
    new.completed_at = coalesce(new.completed_at, now());
  else
    new.completed_at = null;
  end if;
  return new;
end $$;
create trigger deliverables_completion before insert or update on public.deliverables
  for each row execute function public.sync_deliverable_completion();

create or replace function public.sync_task_completion() returns trigger language plpgsql as $$
begin
  if new.status = 'done' then
    new.completed_at = coalesce(new.completed_at, now());
    new.completed_by = coalesce(new.completed_by, auth.uid());
    new.blocker_note = null;
  else
    new.completed_at = null;
    new.completed_by = null;
    if new.status <> 'blocked' then new.blocker_note = null; end if;
  end if;
  return new;
end $$;
create trigger event_tasks_completion before insert or update on public.event_tasks
  for each row execute function public.sync_task_completion();

-- keep at least one admin per organization
create or replace function public.protect_last_admin() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin') then
    if not exists (
      select 1 from public.memberships m
      where m.org_id = old.org_id and m.role = 'admin' and m.user_id <> old.user_id
    ) then
      -- allow cascade deletes when the whole organization is being removed
      if exists (select 1 from public.organizations o where o.id = old.org_id) then
        raise exception 'An organization must keep at least one admin';
      end if;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger memberships_last_admin before update or delete on public.memberships
  for each row execute function public.protect_last_admin();

-- activity log
create or replace function public.log_activity() returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  prev jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  act text := lower(tg_op);
begin
  if tg_op = 'UPDATE' and rec ? 'status' and (rec->>'status') is distinct from (prev->>'status') then
    act := 'status_' || (rec->>'status');
  end if;
  insert into public.activity_log(org_id, actor_id, entity_type, entity_id, action, summary)
  values (
    (rec->>'org_id')::uuid, auth.uid(), tg_table_name, (rec->>'id')::uuid, act,
    left(coalesce(rec->>'name', rec->>'title', rec->>'description', rec->>'original_filename', ''), 200)
  );
  return null;
end $$;

create trigger sponsors_log after insert or update or delete on public.sponsors for each row execute function public.log_activity();
create trigger contracts_log after insert or update or delete on public.contracts for each row execute function public.log_activity();
create trigger events_log after insert or update or delete on public.events for each row execute function public.log_activity();
create trigger deliverables_log after insert or delete on public.deliverables for each row execute function public.log_activity();
create trigger deliverables_status_log after update on public.deliverables
  for each row when (old.status is distinct from new.status) execute function public.log_activity();
create trigger event_tasks_status_log after update on public.event_tasks
  for each row when (old.status is distinct from new.status) execute function public.log_activity();
create trigger assets_log after insert on public.assets for each row execute function public.log_activity();

-- notifications: assignment + blockers
create or replace function public.notify_deliverable() returns trigger language plpgsql security definer set search_path = public as $$
declare
  label text := left(new.description, 120);
  prev_assignee uuid := null;
  prev_status public.deliverable_status := null;
begin
  if tg_op = 'UPDATE' then
    prev_assignee := old.assigned_to;
    prev_status := old.status;
  end if;
  if new.assigned_to is not null and new.assigned_to is distinct from auth.uid()
     and new.assigned_to is distinct from prev_assignee then
    insert into public.notifications(org_id, user_id, kind, title, body, link)
    values (new.org_id, new.assigned_to, 'assignment', 'Deliverable assigned to you', label, '/deliverables/' || new.id);
  end if;
  if new.status = 'blocked' and prev_status is distinct from 'blocked' then
    insert into public.notifications(org_id, user_id, kind, title, body, link)
    select new.org_id, m.user_id, 'blocked', 'Deliverable blocked', label, '/deliverables/' || new.id
    from public.memberships m
    where m.org_id = new.org_id and m.role in ('admin', 'partnerships_manager') and m.user_id is distinct from auth.uid();
  end if;
  return null;
end $$;
create trigger deliverables_notify after insert or update on public.deliverables
  for each row execute function public.notify_deliverable();

create or replace function public.notify_task_blocked() returns trigger language plpgsql security definer set search_path = public as $$
declare ev_name text;
begin
  if new.status = 'blocked' and old.status is distinct from 'blocked' then
    select name into ev_name from public.events where id = new.event_id;
    insert into public.notifications(org_id, user_id, kind, title, body, link)
    select new.org_id, m.user_id, 'blocked', 'Game-day task blocked: ' || left(new.title, 100),
           coalesce(ev_name, '') || coalesce(' — ' || new.blocker_note, ''), '/game-day/' || new.event_id
    from public.memberships m
    where m.org_id = new.org_id and m.role in ('admin', 'partnerships_manager') and m.user_id is distinct from auth.uid();
  end if;
  return null;
end $$;
create trigger event_tasks_notify after update on public.event_tasks
  for each row execute function public.notify_task_blocked();

-- profile row for every new auth user
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, full_name)
  values (new.id, lower(new.email), nullif(left(coalesce(new.raw_user_meta_data->>'full_name', ''), 120), ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- RPCs (security definer)
create or replace function public.create_organization(_name text, _season_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare _org uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if _name is null or char_length(trim(_name)) < 2 then raise exception 'Organization name is too short'; end if;
  insert into public.organizations(name) values (trim(_name)) returning id into _org;
  insert into public.memberships(org_id, user_id, role) values (_org, auth.uid(), 'admin');
  insert into public.seasons(org_id, name, starts_on, ends_on)
  values (_org, coalesce(nullif(trim(_season_name), ''), extract(year from current_date)::text || ' Season'),
          make_date(extract(year from current_date)::int, 1, 1), make_date(extract(year from current_date)::int, 12, 31));
  return _org;
end $$;

create or replace function public.accept_invites() returns integer language plpgsql security definer set search_path = public as $$
declare _email text; _n integer := 0;
begin
  if auth.uid() is null then return 0; end if;
  select lower(u.email) into _email from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
  if _email is null then return 0; end if;
  with accepted as (
    update public.invites i set accepted_at = now()
    where i.email = _email and i.accepted_at is null
    returning i.org_id, i.role
  ), ins as (
    insert into public.memberships(org_id, user_id, role)
    select org_id, auth.uid(), role from accepted
    on conflict (org_id, user_id) do nothing
    returning 1
  )
  select count(*) into _n from ins;
  return _n;
end $$;

revoke all on function public.create_organization(text, text) from public, anon;
revoke all on function public.accept_invites() from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;
grant execute on function public.accept_invites() to authenticated;
revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.has_org_role(uuid, public.app_role[]) from public, anon;
revoke all on function public.shares_org_with(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.app_role[]) to authenticated;
grant execute on function public.shares_org_with(uuid) to authenticated;

-- ---------------------------------------------------------------- Row Level Security
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.invites enable row level security;
alter table public.seasons enable row level security;
alter table public.sponsors enable row level security;
alter table public.contracts enable row level security;
alter table public.events enable row level security;
alter table public.deliverables enable row level security;
alter table public.activations enable row level security;
alter table public.event_tasks enable row level security;
alter table public.assets enable row level security;
alter table public.evidence enable row level security;
alter table public.sponsor_metrics enable row level security;
alter table public.reports enable row level security;
alter table public.notifications enable row level security;
alter table public.activity_log enable row level security;

-- organizations / identity
create policy org_select on public.organizations for select to authenticated using (public.is_org_member(id));
create policy org_update on public.organizations for update to authenticated
  using (public.has_org_role(id, array['admin']::public.app_role[]))
  with check (public.has_org_role(id, array['admin']::public.app_role[]));

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_org_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy memberships_select on public.memberships for select to authenticated using (public.is_org_member(org_id));
create policy memberships_update on public.memberships for update to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin']::public.app_role[]));
create policy memberships_delete on public.memberships for delete to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]) or user_id = auth.uid());

create policy invites_all on public.invites for all to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin']::public.app_role[]));

-- Standard tables: members read; admins + partnerships managers write.
do $$
declare t text;
begin
  foreach t in array array['seasons','sponsors','contracts','events','deliverables','activations',
                           'event_tasks','assets','evidence','sponsor_metrics','reports']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_org_member(org_id))', t || '_select', t);
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check (public.has_org_role(org_id, array['admin','partnerships_manager']::public.app_role[]))$p$, t || '_insert_mgr', t);
    execute format($p$create policy %I on public.%I for update to authenticated
      using (public.has_org_role(org_id, array['admin','partnerships_manager']::public.app_role[]))
      with check (public.has_org_role(org_id, array['admin','partnerships_manager']::public.app_role[]))$p$, t || '_update_mgr', t);
    execute format($p$create policy %I on public.%I for delete to authenticated
      using (public.has_org_role(org_id, array['admin','partnerships_manager']::public.app_role[]))$p$, t || '_delete_mgr', t);
  end loop;
end $$;

-- Creative staff: fulfil work (update deliverables / tasks), upload assets + evidence.
create policy deliverables_update_creative on public.deliverables for update to authenticated
  using (public.has_org_role(org_id, array['creative_staff']::public.app_role[]))
  with check (public.has_org_role(org_id, array['creative_staff']::public.app_role[]));
create policy event_tasks_update_creative on public.event_tasks for update to authenticated
  using (public.has_org_role(org_id, array['creative_staff']::public.app_role[]))
  with check (public.has_org_role(org_id, array['creative_staff']::public.app_role[]));
create policy assets_insert_creative on public.assets for insert to authenticated
  with check (public.has_org_role(org_id, array['creative_staff']::public.app_role[]) and uploaded_by = auth.uid());
create policy assets_update_creative on public.assets for update to authenticated
  using (public.has_org_role(org_id, array['creative_staff']::public.app_role[]) and uploaded_by = auth.uid())
  with check (public.has_org_role(org_id, array['creative_staff']::public.app_role[]) and uploaded_by = auth.uid());
create policy evidence_insert_creative on public.evidence for insert to authenticated
  with check (public.has_org_role(org_id, array['creative_staff']::public.app_role[]));

-- Notifications are private to the recipient (rows are created by triggers).
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid() and public.is_org_member(org_id));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

create policy activity_select on public.activity_log for select to authenticated using (public.is_org_member(org_id));

-- Table privileges: nothing for anon, DML for signed-in users (RLS decides the rest).
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.organizations, public.activity_log from authenticated;
grant update (name) on public.organizations to authenticated;
revoke insert on public.memberships from authenticated; -- memberships are created via RPCs only

-- ---------------------------------------------------------------- Storage (private bucket)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sponsor-assets', 'sponsor-assets', false, 26214400,
        array['image/png','image/jpeg','image/webp','image/gif','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Object path convention: {org_id}/{sponsor_id}/{uuid}-{filename}
create policy "sponsor-assets read" on storage.objects for select to authenticated
  using (bucket_id = 'sponsor-assets' and public.is_org_member(public.safe_uuid((storage.foldername(name))[1])));
create policy "sponsor-assets upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'sponsor-assets' and public.has_org_role(
    public.safe_uuid((storage.foldername(name))[1]),
    array['admin','partnerships_manager','creative_staff']::public.app_role[]));
create policy "sponsor-assets delete" on storage.objects for delete to authenticated
  using (bucket_id = 'sponsor-assets' and public.has_org_role(
    public.safe_uuid((storage.foldername(name))[1]),
    array['admin','partnerships_manager']::public.app_role[]));
