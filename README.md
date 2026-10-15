# SponsorSync

Sponsorship management for professional teams, minor-league clubs, college athletic departments and
event operators: sponsors, contracts, deliverables, game-day activations, creative assets, evidence of
fulfillment and sponsor-facing PDF recaps — in one multi-tenant app.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Supabase (Postgres, Auth, private Storage)
· Zod · Recharts · `@react-pdf/renderer`

## Quick start

```bash
npm install
cp .env.example .env.local      # optional – without it the app runs in DEMO MODE
npm run dev                     # http://localhost:3000
```

### Demo mode

If `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing (or `NEXT_PUBLIC_DEMO_MODE=true`),
SponsorSync runs on **clearly-labelled fictional sample data**:

* a banner marks every page as demo;
* the data is **read-only** — every create/update/delete returns an explicit
  *"Demo mode … nothing can be saved"* error instead of pretending to save;
* dashboards, filters, charts, report preview and PDF export all work on the sample data;
* file uploads are unavailable.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | for live mode | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | for live mode | Supabase anon/publishable key (safe for browsers; RLS protects data). `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is also accepted. |
| `NEXT_PUBLIC_SITE_URL` | optional | Public URL for the e-mail confirmation redirect (defaults to the request host) |
| `NEXT_PUBLIC_DEMO_MODE` | optional | `true` forces demo mode |

**The Supabase service-role key is never used and must not be added.** All data access runs as the signed-in
user, so Row Level Security is always in force.

## Database setup (Supabase)

1. Create a project at <https://supabase.com>.
2. Apply the migrations in order — either paste each file into the **SQL editor**, or use the CLI:
   ```bash
   supabase link --project-ref <ref>
   supabase db push            # applies supabase/migrations/*.sql
   ```
   * `0001_schema.sql` – tables, enums, constraints, indexes
   * `0002_security.sql` – helper functions, triggers (activity log, notifications, completion dates),
     Row Level Security policies, the private `sponsor-assets` bucket and its storage policies
3. **Authentication → Providers → Email**: keep e-mail sign-up on. Keep "Confirm email" enabled in production
   (invitations are only honored for *confirmed* e-mails). Add your site URL and
   `https://<your-domain>/auth/callback` under **Authentication → URL Configuration**.
4. Copy the project URL and anon key into `.env.local`.

### Seed data

1. Run the app, **sign up** and confirm your e-mail, then create (or skip) your organization.
2. Paste `supabase/seed.sql` into the SQL editor and run it. It creates a separate organization
   *"Riverton Rapids (Fictional Demo Data)"* with sponsors, contracts, deliverables, games, tasks and metrics
   (dates are relative to today) and makes the most recently created user its admin. Switch organizations
   from the sidebar.

### Verify the SQL locally (no Supabase needed)

```bash
npm run verify:sql
```
Runs both migrations and the seed in an in-memory Postgres (PGlite) with Supabase auth/storage stubs and
asserts tenant isolation, role permissions, composite-FK integrity, triggers and storage policies.

## Data model & security

* **Tenancy:** every business table has `org_id`; every cross-table reference is a composite
  `(id, org_id)` foreign key, so a row can never point at another organization's record.
* **RLS everywhere.** Roles (`memberships.role`):

  | Role | Can do |
  |---|---|
  | Admin | everything, incl. members, invitations, org settings |
  | Partnerships Manager | create/edit/delete sponsors, contracts, deliverables, games, assets, reports |
  | Creative Staff | update deliverable status/notes and game-day tasks, upload assets & evidence (new assets start as *Pending*) |
  | Read-Only | view only |

  Server actions also check the role before every mutation and validate input with Zod; RLS is the second,
  authoritative layer.
* **Last admin protected** by a trigger; org creation and invitation acceptance go through `SECURITY DEFINER`
  RPCs (`create_organization`, `accept_invites`).
* **Files:** private bucket `sponsor-assets`; objects live under `{org_id}/{sponsor_id}/…` with storage RLS
  keyed on that prefix. Uploads are size-limited (25 MB), type-allow-listed and **magic-byte verified**
  (PNG/JPG/WebP/GIF/PDF; SVG is deliberately excluded). The browser never receives a storage path or URL:
  files stream through `/api/assets/[id]`, which reads the asset row with the user's session first.
* **Internal notes** (`notes` columns) are excluded from the report builder by construction (the report type
  has no field for them) and covered by a unit test.
* HTTP security headers (`nosniff`, frame denial, referrer policy) are set in `next.config.ts`.

## Features

Dashboard · Partners (CRUD, search, archive, 6-tab profile) · Contracts · Deliverables (search, filters, sort,
bulk actions, evidence) · Game Day (games, activations, run-of-show, mobile task view with blocker flags and
photo capture) · Asset Library (by sponsor/category, approval, expiry) · Reports (preview + PDF) ·
Notifications (stored + live alerts) · Settings (profile, org, roles, invitations, seasons).

**Completion rate** = completed ÷ *eligible* deliverables. Not-Applicable items, deliverables of canceled
contracts and of archived sponsors are excluded from eligibility, so they never count as outstanding
(`lib/metrics.ts`, unit-tested).

## Scripts

```bash
npm run dev          # development server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm test             # unit tests (metrics, report builder, validation schemas)
npm run verify:sql   # database/RLS checks against in-memory Postgres
```

## Deployment

* **Vercel (recommended):** import the repo, set the two Supabase env vars (and `NEXT_PUBLIC_SITE_URL`),
  deploy. Add the deployed URL to Supabase *Auth → URL Configuration*.
* **Any Node host:** `npm run build && npm start` (Node 20+).
* Uploads go through Server Actions with a 26 MB body limit (`next.config.ts`); platforms with a smaller
  request cap (Vercel serverless ≈ 4.5 MB) will limit file size accordingly — raise the plan limit or move to
  signed direct uploads for large creative files.
* PDF generation runs in the Node.js runtime (not Edge).

## Known limitations / not built (by design for the MVP)

* Data is loaded per organization and filtered in the server process (paged 1,000 rows at a time). Fine for
  thousands of records; very large tenants would want server-side pagination/aggregation views.
* Invitations are stored, not e-mailed; invitees join automatically when they sign up/sign in with that e-mail.
* No e-mail/push delivery of notifications, no sponsor-facing portal, no AI features, integrations or billing.
* Report PDF embeds PNG/JPEG evidence only (up to 18 photos); other files are listed by name.
* Times for games are stored in UTC and displayed in the viewer's time zone; date-only fields use UTC calendar days.
