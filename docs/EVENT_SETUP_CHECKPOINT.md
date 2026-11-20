# Event Setup Checkpoint — Artwork Migration and Acceptance

Date: 2026-11-15. Local changes only: no commit, push or deployment.
Status: Both setup migrations verified user-applied on 2026-11-15; manual acceptance remains pending. This file describes the setup snapshot. The subsequent Review/internal lifecycle/staff-access slice is documented in [EVENT_LIFECYCLE_CHECKPOINT.md](EVENT_LIFECYCLE_CHECKPOINT.md); its new migration is pending user execution. See EVENT_PROGRESS.md for current scope.

## Delivered scope

Event drafts support university venues, generated stable event references, event dates/recovery deadline, premium theme palettes, logo/banner artwork, and an assigned team. Campus reporting, matching, claims, roles, tags and payments are not connected to event data by this checkpoint. Event activation, published panels and staff operational access remain closed.

Staff panel: find an existing active account by exact email, review its safe name/email identity, assign manager/desk_staff with future expiry, list assignment states, revoke with a confirmation dialog, and reassign a revoked/expired membership without creating a duplicate. These actions use the existing admin audit helper; user_profiles roles are never changed. Metadata responses use Cache-Control: no-store. The new panel is super-admin-only, consistent with the foundation.

Artwork panel: select an image after saving an event draft; upload logo/banner independently of event details; show signed previews and optional removal. Upload/save conflicts refresh metadata so a stale session cannot overwrite newer artwork. Removing artwork clears only the current metadata reference; replacing/removing never deletes the old stored file automatically. Failed metadata saves attempt to remove only their newly uploaded object.

Images are capped at 5 MB input, validated by decoded content, restricted to non-animated JPEG/PNG/WebP and 20 megapixels, resized to 800px logo / 2400x1400 banner bounds, rebuilt without EXIF, and stored as WebP. No SVG/HTML upload or client-supplied object path is accepted. Private bucket objects receive 10-minute signed URLs; previews refresh periodically. Downloaded images and issued signed URLs cannot be instantly revoked by removing their reference.

## User-run migration

File: Server/manual_migrations/20261115b_event_brand_assets.sql.
Dependency: 20261115_event_foundation must already be recorded as applied.

The filename uses the existing same-day letter suffix convention. SQL adds one event_brand_assets table, one private event-brand-assets bucket, indexes/RLS/grants, and one custom migration_log row. It does not alter event_workspaces, event_memberships, campus tables, existing bucket settings, Storage policies, or ledger protections. UUID, snake_case, VARCHAR, TIMESTAMPTZ, CHECK/UNIQUE/FK and index conventions match the existing project.

Run the following read-only preflight in the intended environment. Expected: foundation recorded, new table/bucket/log row absent, no applicable browser Storage policies.

```sql
SELECT name FROM public.migration_log WHERE name IN ('20261115_event_foundation','20261115b_event_brand_assets');
SELECT to_regclass('public.event_brand_assets');
SELECT id, public FROM storage.buckets WHERE id='event-brand-assets';
SELECT policyname, roles, cmd, qual, with_check FROM pg_policies
WHERE schemaname='storage' AND tablename='objects'
AND roles && ARRAY['public','anon','authenticated']::name[];
```

At implementation time, read-only checks found the foundation installed, the new artwork table/bucket absent, and no Storage object policies. Recheck before applying because live state can change.

1. Review the SQL; verify your normal recoverable backup and use staging first.
2. Run the complete migration manually, including BEGIN/COMMIT. Codex must not run it remotely.
3. It sets 5-second lock and 30-second statement timeouts. Missing dependency, existing object names, repeats or applicable browser Storage policies cause refusal before object creation. Do not remove existing tables/policies to force the migration through; review any mismatch first.
4. On failure, ROLLBACK if the SQL session is aborted. No destructive down-migration is supplied.
5. Verify using read-only queries below. Keep public event operation disabled.

```sql
SELECT name,applied_at,note FROM public.migration_log WHERE name='20261115b_event_brand_assets';
SELECT id,public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id='event-brand-assets';
SELECT relname,relrowsecurity FROM pg_class WHERE oid=to_regclass('public.event_brand_assets');
SELECT grantee,privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='event_brand_assets';
SELECT conname,pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid=to_regclass('public.event_brand_assets');
```

Expected: private bucket, 5242880-byte limit, image/webp only; RLS true; no PUBLIC/anon/authenticated grants on the new table; service_role SELECT/INSERT/UPDATE only. The table owner retains normal privileges. Valid object paths are tied to the event UUID and asset kind. Metadata revisions must be positive and one row per event/kind is enforced.

After a successful commit, leave objects/data in place if rolling back application code; disable draft management and fix forward. Previously applied foundation migration must not be renamed or rerun.

## Backup and retention

Both restore paths explicitly restore profiles → event_workspaces → event_memberships/event_brand_assets. Existing table discovery includes the new metadata table. File backup defaults now include event-brand-assets when --with-files is used. Custom --buckets lists must explicitly include it. Missing uninstalled buckets are skipped/logged by existing backup behavior.

Replaced/removed files are intentionally retained. The existing automatic orphan cleaner does not manage the new bucket. A reviewed event artwork retention/cleanup policy is future work; storage usage can therefore grow with repeated replacements. Do not manually delete active referenced objects. No real backup, restore, cleanup or Storage operation was run by Codex.

## Full checkpoint manual acceptance

Use the same existing local startup instructions in EVENT_LOCAL_TESTING.md. EBALIK_EVENTS_FOUNDATION_ENABLED=true enables super-admin draft management only. Local servers can point at live Supabase: choose the intended test environment before saving or uploading.

- [ ] Current campus sign-in, reports, auctions, tags and admin pages still work normally.
- [ ] Super admin can open Events; ordinary admin/guard cannot use its UI or direct APIs.
- [ ] Create a draft with a normal name, choose an existing university venue, set all three dates or leave all three empty. Save generates a reference; rename keeps it.
- [ ] Try Heritage/Afterglow/Fieldhouse and custom colors; phone/wide layouts keep event styling separate from campus chrome.
- [ ] After the artwork migration, upload a square logo and landscape banner. Confirm both appear in artwork controls and the event preview, including after a refresh.
- [ ] Oversized, SVG, corrupt or animated uploads are refused. File extensions alone do not establish an allowed image.
- [ ] Replace/remove artwork; confirm the current preview updates. Check two sessions: stale revisions are rejected instead of overwriting a newer save.
- [ ] Find an existing active account by email and assign an event role with expiry. Reject inactive/nonexistent accounts, past expiry and dates after the recovery deadline.
- [ ] List active, expired/revoked assignments. Revoke through the dialog, then reassign the same account; ensure no duplicate membership is created and its campus role is unchanged.
- [ ] Event draft edits are protected from stale saves. Unsaved edits and active artwork/team saves prevent accidental switching or warn on page exit.
- [ ] Runtime activity audit records successful draft, staff and artwork actions.
- [ ] If artwork migration is not installed, only artwork shows its setup message; draft details/team management still work.
- [ ] No public event, reporting, payment, or claim workflow is opened by this checkpoint.

## Verification limits

Automated evidence is in today's daily audit: admin build/type checking, offline backend suite, foundation SQL checks and artwork SQL checks against an in-memory Postgres engine. The SQL fixture includes minimal synthetic Storage tables, not the complete hosted Storage service. Actual hosted file upload/download and authenticated end-to-end browser acceptance remain user-run checks; isolated tests cannot guarantee production behavior.

After acceptance, proceed to event-specific membership enforcement and lifecycle transitions, then scoped reporting/claims and deliberate main-hub publication. Assigning a membership in this checkpoint does not grant access to a staff operating console yet.

## Compact setup layout update

The editor now uses Details → Schedule → Appearance → Artwork → Team tabs. Only one section occupies layout at a time; inactive components retain draft state. Save/Discard and Back/Next stay in a compact footer. The Drafts button opens a picker dialog, and Preview opens the shared focus-managed AdminModal with phone/wide controls and its own scroll area. The old inline sticky preview and stacked artwork/team layout were removed.

Retest: switch through all five tabs; keep unsaved theme/detail edits across tab changes; verify Save catches missing names/partial dates and returns to the relevant tab; open/close Preview and Drafts dialogs; check desktop dark/light and narrow screens; confirm artwork/team still require saved details and respect busy states. Team assignment lists have a bounded internal scroll area.

Verification: admin build and TypeScript check pass. An isolated browser fixture with synthetic read responses and blocked writes passed seven checks (desktop Details, Appearance, Artwork, Team, preview dialog, exact 390px mobile, and light mode). Checks include one visible setup panel, no inline preview, preserved theme changes, modal viewport/background-scroll containment, and unclipped visible controls. No authenticated live session or DB operation was used; backend behavior was unchanged in this layout-only slice.

## Staff access expiry clarification

Staff access now defaults to Until final claiming date when the event has one. Custom expiry is optional, with Manila-time min/max bounds, immediate date-specific feedback and an Edit event schedule shortcut. Already-expired recovery periods explicitly require a saved Schedule update. No deadline/assignment records were changed by Codex; the existing rule that staff expiry cannot exceed the recovery deadline remains enforced server-side.

Retest: default expiry with a future claiming date; custom earlier expiry; a custom date after the limit (shows the exact limit and disables assignment); an expired claiming date (Schedule shortcut); update/save Schedule and return to Team; malformed custom values do not throw. Seven date-helper tests, three isolated browser scenarios and 1,078 offline backend tests pass; admin build/type check pass. No live assignment was performed.
