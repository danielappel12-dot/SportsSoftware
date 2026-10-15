// Applies the migrations + seed to an in-memory Postgres (PGlite) with Supabase auth/storage stubs and checks
// RLS isolation, role permissions, composite-FK integrity and triggers. Run: npm run verify:sql
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../supabase/', import.meta.url));
const db = new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema storage;
create table auth.users(id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table storage.buckets(id text primary key, name text, public bool, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(n text) returns text[] language sql as $$ select string_to_array(n,'/') $$;
grant usage on schema public, auth, storage to anon, authenticated;
grant select on auth.users to authenticated; grant select,insert,update,delete on storage.objects to authenticated;
`);
await db.exec(fs.readFileSync(root+'migrations/0001_schema.sql','utf8'));
await db.exec(fs.readFileSync(root+'migrations/0002_security.sql','utf8'));
console.log('migrations OK');
const as = async (uid, sql, params=[]) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const mk = async (email) => (await db.query(`insert into auth.users(email) values ($1) returning id`,[email])).rows[0].id;
const A = await mk('a@x.com'), B = await mk('b@x.com'), C = await mk('c@x.com'), D = await mk('d@x.com');
const orgA = (await as(A, `select public.create_organization('Org A') id`)).rows[0].id;
const orgB = (await as(B, `select public.create_organization('Org B') id`)).rows[0].id;
// invites
await as(A, `insert into invites(org_id,email,role) values ($1,'c@x.com','read_only'),($1,'d@x.com','creative_staff')`,[orgA]);
console.log('accepted C', (await as(C,`select public.accept_invites() n`)).rows[0].n, 'D', (await as(D,`select public.accept_invites() n`)).rows[0].n);
// seed (as superuser, targeting latest profile => D) just to test the seed script works
await db.exec(fs.readFileSync(root+'seed.sql','utf8'));
const seeded = (await db.query(`select id from organizations where name like 'Riverton%'`)).rows[0].id;
console.log('seed OK; counts', (await db.query(`select (select count(*) from sponsors) s,(select count(*) from deliverables) d,(select count(*) from event_tasks) t,(select count(*) from activity_log) a, (select count(*) from notifications) n`)).rows[0]);
const expectFail = async (label, fn) => { try { await fn(); console.log('FAIL (allowed):', label); process.exitCode=1; } catch(e){ console.log('ok blocked:', label, '-', e.message.slice(0,70)); } };
const zeroRows = async (label, q) => { const r = await q(); if (r.rows.length===0 || r.affectedRows===0) console.log('ok 0 rows:', label); else { console.log('FAIL rows:', label, r.rows.length); process.exitCode=1; } };
// B cannot see Org A or seeded org data
await zeroRows('B sees sponsors of other orgs', () => as(B, `select * from sponsors`));
// A (admin) creates sponsor
const sp = (await as(A, `insert into sponsors(org_id,name) values ($1,'Acme') returning id`,[orgA])).rows[0].id;
await expectFail('B inserts sponsor into org A', () => as(B, `insert into sponsors(org_id,name) values ($1,'Evil')`,[orgA]));
await expectFail('C (read_only) inserts sponsor', () => as(C, `insert into sponsors(org_id,name) values ($1,'Nope')`,[orgA]));
console.log('C reads sponsor:', (await as(C, `select name from sponsors`)).rows.length);
await expectFail('A inserts deliverable pointing to sponsor in other org (composite FK)', () => as(B, `insert into deliverables(org_id,sponsor_id,description) values ($1,$2,'x')`,[orgB, sp]));
const del = (await as(A, `insert into deliverables(org_id,sponsor_id,description,assigned_to) values ($1,$2,'Do it',$3) returning id`,[orgA,sp,D])).rows[0].id;
console.log('D notified:', (await as(D, `select title from notifications`)).rows.length);
// creative can update status
await as(D, `update deliverables set status='completed' where id=$1`,[del]);
console.log('completed_at set:', (await db.query(`select completed_at is not null ok from deliverables where id=$1`,[del])).rows[0].ok);
await as(D, `update deliverables set status='in_progress' where id=$1`,[del]);
console.log('completed_at cleared:', (await db.query(`select completed_at is null ok from deliverables where id=$1`,[del])).rows[0].ok);
await expectFail('creative deletes deliverable', async () => { const r = await as(D, `delete from deliverables where id=$1 returning id`,[del]); if (r.rows.length===0) throw new Error('0 rows deleted'); });
await expectFail('creative creates sponsor', () => as(D, `insert into sponsors(org_id,name) values ($1,'Z')`,[orgA]));
await expectFail('last admin demotion', () => as(A, `update memberships set role='read_only' where org_id=$1 and user_id=$2`,[orgA,A]));
await expectFail('C promotes self', async () => { const r = await as(C, `update memberships set role='admin' where org_id=$1 and user_id=$2 returning 1`,[orgA,C]); if(!r.rows.length) throw new Error('0 rows'); });
await expectFail('non-admin invites', () => as(C, `insert into invites(org_id,email) values ($1,'q@x.com')`,[orgA]));
await expectFail('direct org insert', () => as(A, `insert into organizations(name) values ('hax')`));
await zeroRows('B reads notifications', () => as(B, `select * from notifications`));
await expectFail('storage upload to other org path as B', () => as(B, `insert into storage.objects(bucket_id,name) values ('sponsor-assets', '${orgA}/x/f.png')`));
await as(A, `insert into storage.objects(bucket_id,name) values ('sponsor-assets', '${orgA}/x/f.png')`);
console.log('storage read by B:', (await as(B, `select * from storage.objects`)).rows.length, 'by C:', (await as(C, `select * from storage.objects`)).rows.length);
await zeroRows('B reads unrelated profile', () => as(B, `select * from profiles where id=$1`,[A]));
