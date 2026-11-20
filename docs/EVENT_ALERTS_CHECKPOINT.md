# Private event match alerts

Implemented locally on 2026-11-18 as the next Phase 5 slice. Assigned event managers can review a suggestion and send a generic notice to the missing-report owner. The attendee opens it in **that event's Alerts tab**, then uses the existing evidence/claim/pickup workflow. A match alert never proves ownership or reserves an item.

## Enable and use

1. The recovery migration `20261116c_event_recovery` is now confirmed user-applied through read-only metadata checks. Do not rerun it.
2. Follow-up verification on 2026-11-18 confirms **20261117_event_match_alerts is now user-applied**, both tables have RLS and five alert functions exist. Do not rerun this migration. The Nov 17 filename records its preparation date; Codex did not apply it.
3. Restart the local backend and reload the frontend. See EVENT_PILOT_COMPLETION.md for the newer user-run pilot completion migration and a complete test run. Before alert setup, older reporting/matching/claims remain usable with alert controls hidden.
4. Open a current event's attendee portal through the existing admin Review control. Sign in as an assigned manager and open **Event desk → Possible matches**. Review both originals and approve a generic public label on the found report first.
5. Select **Notify report owner**, review the exact generic notice/approved listing in the modal, and select **Send event alert**. Desk staff can still compare reports but cannot notify owners. A report's owner must have an active verified account.
6. Sign in as the missing-report owner and return to `/events/<slug>` → **Alerts**. Review marks the notice read; Dismiss moves it to **All alerts**. The badge counts only currently available unread alerts for this account/event.
7. **This might be mine** opens the existing private ownership form. An existing pending/approved/released ownership request links to **My claims** instead. Intake, evidence, manager decisions, pickup credentials and verified physical release keep their existing safeguards.

## Persistence and safety

- New tables are `event_match_alerts` and `event_alert_history`. They use UUID keys, composite event/report foreign keys, account references with `ON DELETE SET NULL`, positive reviewed versions, timestamp/check constraints and supporting indexes consistent with the existing event schema. Browser roles have no table/function access; service-only RLS and fresh backend authorization protect each route.
- The migration is transactional with bounded lock/statement timeouts and dependency/collision preflight. It creates two tables, five functions and three triggers; it adds no columns or rows to campus item/claim/notification/tag/payment tables and changes no storage buckets. Existing event tables receive availability triggers only; existing reports/history/claim/release functions are not replaced.
- The manager cannot supply recipient IDs, message text, scores or private comparison reasons. The server derives the missing-report owner and recomputes the existing pure similarity threshold. The send RPC locks/rechecks the event, current account/membership, reports, versions, public consent/approval, chronology, recipient status and existing ownership requests before persisting.
- One alert is allowed per event/missing/found pair for its lifetime, even after dismissal or invalidation. Retry replay creates no new notice/history. The event lock serializes duplicate and quota checks: at most 10 notices per recipient/event and 50 per sender/event in a rolling 24 hours; the send route also allows 10 attempts/minute/account.
- Read/dismiss operations are owner-only, event-scoped, idempotent and audited atomically. Existing acknowledgements and inactive timestamps cannot be rewritten; inactive alerts cannot reactivate. There is no delete API. History has service SELECT/INSERT only.
- Withdrawn/hidden/released linked reports and changed/anonymized missing-report ownership permanently invalidate their active notices with history. Closing/cancelling/archiving/deleting an event does the same. Pausing the portal or reaching its deadline suppresses listing/claim actions and unread counts on reads; reads do not mutate records. A temporary pause can be resumed while the event remains eligible.
- Generic recipient responses exclude the finder, contact information, private descriptions/photos, score/reasons, storage positions and pickup secrets. An inactive response also omits the found listing. The missing item's label comes only from the recipient's own report.
- Releasing a found item invalidates notices pointing to that item within the existing release transaction. It does not automatically withdraw a guessed missing-report counterpart. The owner withdraws the missing report after recovery to prevent further unrelated leads.
- Both restore implementations load reports before alerts and alerts before history, and ignore existing alert/history duplicates. Restoring an older backup cannot overwrite newer read/dismiss/inactive state. There is no new file bucket to back up. Restored rows are also rechecked against current event/report availability when read.

## Read-only verification after manual execution

```sql
SELECT name, applied_at FROM public.migration_log
WHERE name IN ('20261116c_event_recovery','20261117_event_match_alerts');
SELECT relname, relrowsecurity FROM pg_class
WHERE oid IN ('public.event_match_alerts'::regclass,'public.event_alert_history'::regclass);
SELECT tablename, grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND tablename IN ('event_match_alerts','event_alert_history')
ORDER BY tablename, grantee, privilege_type;
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgname IN ('trg_event_alert_guard','trg_event_alert_event_end','trg_event_alert_report_end');
SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
('event_alert_guard','event_invalidate_alerts','event_send_match_alert','event_alert_action','event_alert_unread_count');
```

Expected: both migration records, both tables with RLS, three enabled triggers, five invoker functions with fixed search paths. Browser roles have no grants. Service role has SELECT/INSERT/UPDATE on alerts and SELECT/INSERT on history; it has no DELETE/TRUNCATE grants on either table. Rerunning the migration deliberately fails instead of overwriting existing objects.

## Manual acceptance

- [ ] In one current event, submit a compatible missing/found pair with correct chronology. Approve the generic found label. Review the notice preview, send once, refresh/retry and confirm only one notice/history entry.
- [ ] As the missing-report owner, open Alerts, check the unread badge, Review, Dismiss and All alerts. Reload and confirm persisted state. Check desktop, phone, theme contrast and modal scrolling.
- [ ] Open This might be mine, submit private evidence, and follow My claims. An existing ownership request should offer tracking instead of another claim. Complete ordinary intake/approval/PIN release and confirm its alert becomes inactive with no claim action or unread count.
- [ ] Withdraw/hide a linked report; hide then reapprove the found report. The original alert must stay inactive and cannot be resent. Recover a missing item and withdraw its missing report explicitly.
- [ ] Pause/resume the portal, cross the recovery deadline, close/cancel/archive/delete the event, and inspect owner history. Unavailable alerts must not show a found listing or permit a claim.
- [ ] Test desk staff, unassigned super admin, other attendees/event IDs, revoked/expired manager membership, inactive/unverified recipient and revoked sessions. Forged recipient/message/version fields must fail without writes.
- [ ] Change a report after opening a preview, then Send. Refresh/review is required; stale versions must fail. Test empty inbox, 24-row pages, duplicate sends and limits. Dismissal is not deletion, report withdrawal or claim withdrawal.
- [ ] Recheck normal event reporting, report/claim/receipt screens, QR sharing, campus matches/notifications, Smart Tag scans/registration and existing auction/financial flows. Exercise backup/restore only in an isolated copy.

Automated evidence: 1,190 socket-blocked offline backend tests, 85 ephemeral PostgreSQL checks and 24 synthetic desktop/phone alert browser cases pass. All 18 existing matching browser cases were rerun and pass, for 42 browser cases this milestone. The user production build passes and its type check retains the existing 108-error baseline. Seven touched Python files compile. SQL checks include transactional audit failures, duplicate/acknowledgement guards, quotas, availability, account anonymization, privileges and the existing intake/claim/release transaction. Synthetic browser fixtures use service-produced DTOs and an entirely fake API; no hosted application writes were performed. Authenticated hosted/manual acceptance and declared Node 22 release verification remain pending.

## Next gate

Finish manual recovery/matching/alert acceptance before adding more operational scope. Next Phase 5 work is explicit manager-controlled main-hub publish/unpublish with a reviewed association/privacy design, plus event closure/custody exports. Alerts currently stay in the event inbox; the campus notification bell, email, Smart Tags, event tags, rentals and financial integration retain their own gates.
