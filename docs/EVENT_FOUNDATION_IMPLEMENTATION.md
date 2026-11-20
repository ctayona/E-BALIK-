# Events Foundation — Implementation and Migration Handoff

Date: 2026-11-15. Branch: feature/event-foundation.
Status: Foundation migration verified user-applied on 2026-11-15; local draft admin UI added. No public event portal or operational event reports yet.

## 1. Architecture decision

This slice adds event configuration separately from campus workflows. The new event_workspaces and event_memberships tables have no references from found_items, missing_items, claims, Smart Tags, auctions, or payments. No existing table columns, constraints, RLS policies, triggers, money records, or storage buckets are altered.

This deliberate foundation can be built while the detailed report-integration inventory continues. It does not satisfy the release gates for event reports, public events, matching, media, or rentals. Those remain disabled/unimplemented. The full Phase 0 inventory and Node 22 release verification remain open.

## 2. Permission and lifecycle decisions

| Actor | Foundation release | Planned later capability |
|---|---|---|
| Super admin | Create/list/read/edit event drafts when enabled | Assign event managers, approve publication, oversee closure |
| Campus admin | No foundation access | Explicitly granted event administration; no automatic cross-event access |
| Event manager | No foundation API access yet | Manage assigned event configuration and approved staff actions |
| Desk staff | No foundation API access yet | Intake and release assigned event items after permission and verification checks |
| Attendee | No event portal yet | Safe event browsing, own reports/claims, approved participation |
| Anonymous visitor | No event API access | Published safe event panel and supported visitor verification |

Membership assignment/list/revocation APIs are now implemented for super admins; the staff picker UI and event staff console remain pending. A membership never changes user_profiles.access_level. Expiry is mandatory; future permission checks must validate active status, access window, and current account status on every request.

Future lifecycle: draft → scheduled → active → recovery → closed → archived; cancellation preserves records and requires an unresolved-custody plan. This migration deliberately restricts status to draft. No activation endpoint exists. A later reviewed migration will expand the permitted states only after safe operational paths exist.

Reporting ends independently from claiming. Closing requires unresolved-item inventory and custody destination, final recovery instructions, and explicit access/retention policy. No automatic publication, auctioning, or deletion. Matching remains within scope. Hub publication will require safe fields, appropriate consent, admin approval, and a single report/claim history.

## 3. Implemented backend contract

Opt-in configuration: EBALIK_EVENTS_FOUNDATION_ENABLED=true in the existing backend environment location; default is disabled. Leave disabled in production while the feature is under development. This switch only enables super-admin draft APIs, never attendee event operation.

| Method/path | Behavior |
|---|---|
| GET /api/admin/events?offset=0 | Up to 50 drafts; bounded pagination |
| POST /api/admin/events | Create draft with name and unique slug |
| GET /api/admin/events/<event_id> | Load a single draft by UUID |
| PATCH /api/admin/events/<event_id> | Update allowed fields with current integer version |

Allowed fields: name, slug, organizer_name, venue, desk_instructions, starts_at, ends_at, recovery_ends_at, branding. A PATCH requires version; stale saves return 409. Updates compare version and draft status atomically to reject a concurrent change. No DELETE, publish, activation, upload, attendee, or report endpoints are added. A later local slice adds super-admin membership management endpoints (see section 8).

All API calls require existing super-admin authentication. Disabled calls return 503 events_disabled before the route opens a DB connection. Missing event tables return 503 setup_required; permission/other DB errors are not misreported as missing schema. Existing request middleware still runs normally. Successful create/update actions use the existing admin activity audit helper.

Dates are all empty or all present, include timezone, normalize to UTC, and satisfy start < end <= recovery deadline. Branding currently stores only template and validated hex colors. Banner/logo uploads, contrast validation, published appearance, frontend previews, event staff access and theme rendering remain next-phase work; stored colors alone do not establish an accessible theme.

## 4. Live consistency review

Read-only metadata reviewed: user_profiles account UUID/access fields; auction_submissions column/default/constraint/grant patterns; migration_log name/applied_at/note; absence of both proposed event tables.

Matched conventions: descriptive snake_case tables; domain-specific UUID primary keys using gen_random_uuid(); account_id foreign keys; VARCHAR sizes and CHECK constraints; created_at/updated_at TIMESTAMPTZ defaults; JSONB settings; idx_* indexes; migration_log entry. New FK columns have useful indexes.

Deletion rules are explicit: creator/assigner links SET NULL; removing an account removes only its event membership; event deletion is restricted while membership rows reference it. No event-delete API exists. Existing campus account deletion remains unchanged.

The existing seller table has broad browser-role grants in live metadata. New private tables explicitly revoke those grants and enable RLS without browser policies, consistent with server-only access. This is a deliberate privilege improvement for new objects, not a change to any existing grants. service_role receives SELECT/INSERT/UPDATE for draft operations and backup restoration, without DELETE/TRUNCATE. Existing backup code discovers public tables; both restore orders now load profiles → workspaces → memberships.

This was a targeted consistency review, not a comprehensive database health or security audit. Existing public report-image buckets are unchanged; event-private images will require separate reviewed storage.

## 5. Manual migration procedure

File: Server/manual_migrations/20261115_event_foundation.sql.

The repository uses manually named/date-prefixed SQL Editor files and a custom migration_log, so this follows that established convention. It is not a Supabase CLI migration-history operation.

1. Review the SQL and use an isolated/staging environment first. Confirm your normal recoverable backup before production schema changes.
2. Run the following read-only preflight in the intended project. The first two relations must exist; both proposed tables and the migration-log row must be absent.

```sql
SELECT to_regclass('public.user_profiles') AS profiles,
       to_regclass('public.migration_log') AS log,
       to_regclass('public.event_workspaces') AS existing_workspaces,
       to_regclass('public.event_memberships') AS existing_memberships;
SELECT name FROM public.migration_log WHERE name = '20261115_event_foundation';
```

3. Run the complete migration file manually in the SQL Editor, including BEGIN/COMMIT. It uses a 5-second lock timeout and 30-second statement timeout. Do not execute selected fragments.
4. On an error, stop and inspect it; ROLLBACK if the transaction remains aborted. Do not delete or rename existing tables to force it through. A name collision or repeat execution deliberately fails closed before creating objects. This file is not silently rerunnable; verify an already-recorded installation instead.
5. Verify with these read-only queries:

```sql
SELECT name, applied_at, note FROM public.migration_log
WHERE name = '20261115_event_foundation';
SELECT c.relname, c.relrowsecurity FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('event_workspaces', 'event_memberships');
SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name IN ('event_workspaces', 'event_memberships')
ORDER BY table_name, grantee, privilege_type;
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid IN ('public.event_workspaces'::regclass, 'public.event_memberships'::regclass)
ORDER BY conrelid, conname;
```

Expect both tables with RLS true; no anon/authenticated/PUBLIC grants; service_role SELECT/INSERT/UPDATE only; creator/assigner/account/event FKs; draft-only status; date, branding, version and role constraints. Table owners retain their normal owner privileges.

6. Keep the foundation switch disabled until deployment/read-only verification is reviewed. There is no need to create live draft records merely to verify installation; isolated tests cover writes.

Recovery: a failure before COMMIT rolls back new objects/log insertion. After a successful commit, disable the feature and preserve the new tables/data; prefer a corrective migration. No destructive down-migration is supplied. Existing campus data is untouched by the migration, but no migration can be guaranteed risk-free in every environment.

## 6. Verification evidence and remaining work

The automated Python suite runs with EBALIK_TESTING=1, dummy Supabase credentials, mock auction email and a socket-connect blocker. See EVENT_RENTALS_BASELINE.md for the interpreter workaround and existing toolchain differences. New tests cover draft creation, campus data separation, input/branding validation, stale-save races, permissions, disabled/setup behavior, audits, and restore ordering.

SQL test: scripts/test-event-foundation-sql.mjs uses a temporary pinned @electric-sql/pglite@0.3.14 package, synthetic profiles and campus sentinel data, and an in-memory Postgres instance. It is not connected to Supabase. Covers table/constraint creation, preserved campus rows, RLS/grants, invalid dates/status/branding/version, FK deletion behavior, and safe refusal of reruns. This does not reproduce every Supabase extension, deployed policy, load, or concurrent production operation. No production migration has been applied by Codex.

Next slices: admin draft/appearance UI; actual membership enforcement and assignment; published branding/assets; full campus/report scope inventory and protections before any event reports; attendee panel and claims; tags; billing. Global role changes and broad query replacements are not shortcuts for these gates.

Local SQL test invocation after a temporary PGlite install:

```powershell
$pgliteModule = Join-Path $env:TEMP 'ebalik-event-sql-tests-20261115/node_modules/@electric-sql/pglite/dist/index.js'
node scripts/test-event-foundation-sql.mjs $pgliteModule
```

Final results: 1,057 offline backend tests passed; 25 isolated Postgres migration checks passed; touched Python syntax checks and git diff --check passed. Frontend builds/type checks were not rerun because this slice changes no frontend files. No migration has been applied remotely.

## 7. Admin UI follow-up

Super-admin Events navigation, draft create/edit/list, validated dates, appearance templates/colors and phone/wide preview are implemented locally. No asset uploads or publish action yet. See EVENT_LOCAL_TESTING.md. Live metadata confirms the user applied the foundation migration, both tables have RLS, browser-role grants are absent, and service_role has SELECT/INSERT/UPDATE only. No remote writes were performed by Codex. Commits, pushes and deployment are prohibited pending explicit new user instructions.

## 8. Campus venues, automatic references, themes and staff foundation

The event venue dropdown reads GET /api/admin/events/options. It uses the existing admin CAMPUS_LOCATIONS values (Library, Gymnasium, Cafeteria, Admin Building, Oval Track, Engineering Building, Lost and Found Office). Backend validation rejects a supplied nonempty off-list venue; blank venues remain allowed in unfinished drafts. Existing stored venue values are not rewritten. A test detects drift between this server list and the existing admin list. The official venue list remains user-provided future work.

Event name is now the only required identity input in the UI. On create, the server generates a normalized lowercase/hyphenated reference from the name plus a random suffix. Existing references are retained on rename. The API still accepts valid explicit slugs for backward compatibility, but the UI no longer asks for or edits one. No schema change is needed.

The editor now has separate identity/location/appearance sections and Heritage, Afterglow and Fieldhouse theme cards. EventPreview.tsx is a reusable draft-only visual shell with scoped CSS, adaptive text color, mobile/wide mode, event details and desk/recovery information. It shows no sample report records and has no live report actions. Colors and template IDs persist in the existing branding JSON; banner/logo uploads still require the next reviewed media step. A local synthetic three-theme HTML render was visually inspected through a headless Edge screenshot, without loading the live app or authenticating. It does not establish full authenticated browser acceptance.

Next-step staff APIs (all remain super-admin-only and behind the foundation switch):
- GET /api/admin/events/<event_id>/memberships lists up to 500 assignments.
- POST /api/admin/events/<event_id>/memberships accepts account_id, role (manager/desk_staff) and timezone-aware expires_at; requires an existing active account and future expiry, bounded by the recovery deadline when present.
- POST /api/admin/events/<event_id>/memberships/<membership_id>/revoke updates only the membership belonging to that event.

Assignments never update user_profiles or grant campus roles. Duplicate/reassignment is refused in this release. Successful assignment/revocation uses the existing admin activity audit. No invitation emails are sent. No manager/desk staff console is enabled yet: the new role records alone grant no API access. Later protected event operations must enforce membership status/expiry/account status on every request; shortening recovery deadlines must also reconcile access windows before those operations are enabled.

Verification for this slice: 1,066 offline backend tests pass, admin build/type check pass, three synthetic mobile theme renders visually inspected. No migration, remote data writes, commits, pushes or deployments performed.

## 9. Complete setup checkpoint implementation

See EVENT_SETUP_CHECKPOINT.md for the staff picker, revoke/reassign support, private logo/banner uploads, pending 20261115b_event_brand_assets.sql migration and full user acceptance checklist. The previous statements that staff UI/artwork are absent describe earlier snapshots. Those components are now implemented locally. Public event operations remain unavailable. No commits, pushes, deployments or remote writes performed.
