# Event Review and Private Staff Access

2026-11-16. Local implementation, uncommitted. The lifecycle migration is pending user execution. Codex has not changed Supabase data or storage.

Subsequent update: the lifecycle migration was verified user-applied on 2026-11-16. This file describes the prior lifecycle-only checkpoint. See [EVENT_REPORTING_CHECKPOINT.md](EVENT_REPORTING_CHECKPOINT.md) for the implemented reporting/intake extension and its pending migration.

## After Save draft

Open the sixth setup tab, **Review**. It reads saved details and checks the event name/organizer, a venue from the existing university list, collection desk instructions, ordered dates with the event ending in the future, and an active, unsuspended manager whose assignment covers final claiming. Artwork is optional. Save unsaved changes first; each check links back to its setup tab.

Scheduling/starting changes the internal workspace state only. It does not publish the attendee preview, enable reports, expose event items in campus search or create payments. Existing report, claim, matching, tag, auction and payment schemas are untouched.

## States and timing

| From | Next | Condition |
|---|---|---|
| Draft | Scheduled | Readiness complete; start is in the future |
| Draft or scheduled | Active | Readiness complete; start <= now < event end |
| Scheduled | Draft | Before start; unlocks details/artwork |
| Active | Recovery | Event has ended |
| Recovery | Closed | Final claiming deadline has passed |
| Closed | Archived | Explicit administrator action |
| Draft, scheduled, active or recovery | Cancelled | Explicit administrator action |

Every action requires a plain-text reason of 5–1000 characters in a confirmation modal. Cancellation/archiving are final in this release. Details/artwork remain draft-only; new staff cannot be assigned to closed, archived or cancelled events. Administrators can still revoke assignments.

There is no automatic state scheduler in this checkpoint. Start a scheduled event manually during its operating hours. Missing the entire operating window leaves cancellation available; activation cannot be backdated. Staff access expires independently of manual closure at the earlier of assignment expiry and final claiming.

## User-run migration

Run **Server/manual_migrations/20261116_event_lifecycle.sql** yourself after the already-applied foundation migration. Applying it changes no existing event rows and no campus tables or storage settings.

It verifies the foundation log/expected status constraint; refuses existing lifecycle objects; expands only the event status allow-list; adds `event_state_history` with UUID keys, event/account foreign keys, timestamp/indexes; enables RLS and removes browser grants. Service-role history access is SELECT/INSERT only. The actor reference can become null if its account is deleted, consistent with other event audit foreign keys.

The server-only SECURITY INVOKER `event_transition` function verifies the current super-administrator account, version, schedule and manager. A workspace row lock serializes state changes. Event status/version and history insertion succeed or roll back together. The service key stays backend-only. History restoration inserts only missing entries, after workspace parents; existing ledger restoration behavior is preserved.

The migration/log insert run in one transaction with 5-second lock and 30-second statement timeouts. If execution fails, roll back an aborted SQL-editor transaction and inspect the error; do not run selected fragments or remove guards. A rerun after success deliberately refuses. Before migration, Review still shows setup checks but state actions are unavailable; existing draft setup continues working.

Verify afterward with read-only queries:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT name, applied_at FROM public.migration_log
WHERE name = '20261116_event_lifecycle';
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public.event_workspaces'::regclass
  AND conname = 'event_workspaces_status_check';
SELECT relname, relrowsecurity FROM pg_class
WHERE oid = to_regclass('public.event_state_history');
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public' AND routine_name = 'event_transition';
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'event_state_history';
COMMIT;
```

Owner/administrative grants may appear. Browser roles must have no history privileges/function EXECUTE. Service role needs SELECT/INSERT on history and EXECUTE on the function.

## Private staff workspace

Sign in with the existing E-Balik account and select **Event desk** in the account menu/mobile sidebar, or open `/event-desk` on the user frontend. This is a read-only assignment workspace; attendee reporting, item handling and claims are future work.

Only currently assigned managers/desk staff see their own scheduled, active or recovery workspaces. Every API request reads the current account, assignment and deadlines. Revocation, expiry, suspension and cancellation deny the next request. Global/role session revocation and maintenance settings are freshly checked; authorization-read failures deny access. The page uses the existing idle/expiry session guard and clears the stored sign-in after an authentication failure. Campus administrator status does not bypass membership. Event assignments never change campus roles.

The browser refreshes access every visible minute, on focus and on demand, clearing stale results during revalidation. Downloaded metadata cannot be recalled instantly from an idle screen. No item data, reporter identities, account emails, private artwork paths or payment details are returned.

Read endpoints: `GET /api/events/mine` and `GET /api/events/<id>/workspace`. Responses are not cached; staff routes offer no writes. Admin Review/transition endpoints remain super-admin-only.

## Acceptance checklist

- [ ] Before migration: drafts work, Review shows setup checks/pending migration, no state action is available.
- [ ] After applying SQL and restarting local servers: Review shows current readiness and available actions.
- [ ] Missing organizer, desk, venue, dates or a manager blocks scheduling/starting; checks link to the correct tabs.
- [ ] Assign an active manager through final claiming; save details and re-open Review.
- [ ] Schedule a future event with a reason. Confirm saved state/history, locked details/artwork, and persistence after reload.
- [ ] Return to draft before start, edit and reschedule. During the operating window, Refresh exposes Start event; no automatic start occurs.
- [ ] Drafts within their operating window can start directly; events past their end cannot start.
- [ ] A stale administrator session cannot overwrite a newer state transition; refusal asks for refresh.
- [ ] Staff see only their assigned open events. A campus administrator without membership cannot see them.
- [ ] Revoke/suspend/cancel, then Refresh access: event disappears or access is denied. Expiry/final claiming deny access without waiting for closure.
- [ ] Global/role force logout rejects an older staff token; fresh sign-in still requires a current assignment.
- [ ] Recovery cannot begin early, closure cannot shorten recovery, and archive requires closure. Cancellation warns that it is final.
- [ ] Preview report buttons stay disabled; campus reports, claims, auctions, tags and payments behave as before.
- [ ] Phone tabs reveal the selected step; confirmations fit the viewport; history stays collapsed and bounded.

Manual acceptance and hosted migration verification are pending. Local frontends may still point at the live backend/database; select the intended test environment before performing write-based acceptance. Codex used synthetic/offline checks only.

## Next roadmap gate

Finish the report/query/RPC/job/storage integration inventory and design isolated event reports before enabling attendee reporting. Next: event-specific lost/found reports and scoped staff item handling. Claims, custody, matching and explicit admin promotion to the main hub require their own compatibility checks. Event activation must never implicitly publish campus reports.
