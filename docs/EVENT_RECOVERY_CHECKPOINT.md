# Event recovery and workspace management

Updated 2026-11-16. Implemented locally; hosted acceptance and the new migration are pending. No commit, push, deployment or live database/storage write was performed by Codex.

## Enable this milestone

1. The foundation, artwork, lifecycle and reporting migrations must already be applied. Reporting migration `20261116b_event_reports` was verified read-only in this session.
2. Manually execute [20261116c_event_recovery.sql](../Server/manual_migrations/20261116c_event_recovery.sql) as one complete transaction in your intended project. Codex does not execute it.
3. Restart the local backend with the existing `EBALIK_EVENTS_FOUNDATION_ENABLED=true` setting and reload both frontends. Keep the same encryption configuration used by the existing application across restarts/workers.
4. Use a current event with a manager assigned through the claiming deadline. Start it and explicitly open its portal in Review. Claims and management controls require the new migration; reporting/draft setup remain usable without it.

The migration adds `event_claims`, `event_claim_history`, workspace deletion metadata, and report release metadata. It adds isolated command functions and event-only triggers; it does not replace earlier migrations, modify campus report/claim/financial tables or change storage bucket settings. Proof images use the existing private `event-report-images` bucket with a separate event/claim path.

Preflight refuses existing recovery objects. DDL, grants, constraints and the migration-log insert run in one transaction with lock/statement timeouts. A second execution deliberately fails instead of overwriting objects. If execution fails, roll back an open failed transaction and inspect the error before retrying the complete file; do not run fragments or remove existing event data. Once applied, treat the file as immutable and use a follow-up migration for changes.

Read-only verification after your execution:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT name, applied_at FROM public.migration_log
WHERE name IN ('20261116b_event_reports', '20261116c_event_recovery');
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname='public' AND tablename IN ('event_claims','event_claim_history');
SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name IN ('event_claims','event_claim_history');
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='event_reports'
AND column_name IN ('released_at','released_by');
COMMIT;
```

Both tables must have RLS enabled with no browser grants/policies. `service_role` gets SELECT/INSERT/UPDATE on claims and SELECT/INSERT on claim history; no DELETE/TRUNCATE or history-overwrite grants. New command functions are service-only. UUID keys, composite event/report and event/claim foreign keys, account references, bounded status/text fields, timestamps and indexes follow the existing event-table conventions. Account deletion can anonymize foreign keys without changing released-item facts.

## Claim and pickup scenario

1. A verified attendee opens `/events/<slug>` and selects **This might be mine** on an approved found-item listing. The finder cannot claim their own report.
2. They supply private ownership evidence and optionally a proof photo. Submissions use a stable request reference to make retries idempotent; duplicate open claims are blocked. Daily claim quota: ten per account/event.
3. Assigned staff open `/event-desk`, select the event and choose **Ownership claims**. A found-report detail also links to that item's claims. Staff can inspect private evidence/proof and history.
4. An event manager compares the evidence against the report, records a decision reason, and approves or rejects. Approval requires physical desk receipt and an active verified claimant. A manager cannot review their own claim; only one claim may hold current pickup approval for an item.
5. The claimant opens **My claims → Pickup code**. A server-generated six-character code is encrypted at rest, while a claim-bound keyed hash verifies pickup. Assigned staff never receive the code or stored credentials in their claim responses.
6. At pickup, assigned staff check identity in person, enter the code and record the physical handover note. The identity checkbox is required. The claimant cannot release their own claim, even if assigned staff.
7. A successful command atomically records the report release, completed claim, receipt snapshots and both histories, invalidates pickup credentials and rejects other open claims for that item. The released item disappears from the event board and appears under **Released** in the desk report filters.
8. The claimant can open/print the completed receipt and copy its verification link. Private receipts contain the recipient; public verification shows only generic item label, release date and receipt reference. Receipt verification is rate-limited and no-store.

Pickup approval lasts at most 24 hours and never beyond the final claiming date. Five incorrect attempts lock the current code; failed attempts remain audited even though the API refuses release. The claimant can replace an unexpired code at most once per minute. Replacement invalidates the old code and retains the original deadline. An expired approval can be replaced by a new ownership request while recovery is open; a manager reviews it again. These time checks are enforced on the server. Keep the existing encryption key consistent across backend instances: changing it invalidates outstanding pickup credentials and receipt verification codes; key rotation needs a separate recovery plan.

## Drafts, archive and deletion

- **Events → Workspaces → Drafts → Edit draft** reopens the saved setup. Save updates the same event and stable URL with version checks. Details/artwork remain editable in draft state. Future scheduled events may return to draft through the existing lifecycle; active/completed details remain locked.
- Workspace filters include All, Drafts, Open, Closed, Archived and Deleted. All excludes deleted records. Closed/cancelled events can be archived with a reason from the picker or Review's **Workspace management** section.
- Draft/closed/cancelled/archived events can move to **Deleted** with a reason. This is recoverable soft deletion: records, reports, claims, images and audit histories are retained. Active/scheduled/recovery events cannot be deleted.
- Deletion is blocked while any received item remains unreleased. Archive may retain outstanding custody; it does not transfer or dispose of items.
- **Workspaces → Deleted → Restore** restores the prior state with the portal closed. Restored drafts can be edited. Restoring an archived/closed/cancelled record does not reopen recovery or undo archival.
- Closing, cancelling, archiving or deleting ends open ownership requests and invalidates their codes. Deleted events cannot be published, edited or operated through the old lifecycle/reporting paths. Owners retain access to their own records/receipts; staff access still follows current assignment and event operating window.

## Boundaries and reviewed integration

The new Python service is `Server/app/utils/event_recovery.py`. Existing event routes expose claim submission/tracking/proof/receipt, staff review/release and super-admin workspace management. Every private request keeps the existing fresh account, session, maintenance and event-assignment checks. Payload fields are allowlisted; clients cannot choose stored PINs/hashes, claimant/actor IDs, receipt snapshots or timestamps. Public boards contain no evidence, proof photos or reporter/claimant identity. Media is authenticated, path-scoped, normalized WebP and no-store.

The event claim commands lock the event/report/claim rows and recheck current memberships, profile state, deadline, version and winner constraints inside the transaction. Release rollback, stale writes, code lockout, ownership restrictions, terminal expiry and legacy path guards are covered by isolated SQL tests. History records cannot be overwritten by normal restore: both restore implementations load reports before claims, claims before claim history and preserve existing claim history. The already registered private report bucket covers claim proof backups.

Matching/alerts, main-hub promotion, custody transfer/closure exports, event QR sharing, external attendees, paid rentals and tags remain future work. There is no permanent event purge or unarchive/reopen operation in this milestone. Retention/disposal and post-closure physical custody still need an operational policy before a pilot.

## Manual acceptance checklist

- [ ] Before applying this migration, drafts/reporting still work; new controls explain setup requirements.
- [ ] Edit/reload an existing draft, preserve its URL and test stale saves in two sessions. Check phone layout and preview modal.
- [ ] Submit a claim with optional proof as a verified account; retry it and verify one request. Test duplicate open claim, unverified account, own-finder claim and cross-event IDs.
- [ ] Only assigned staff can inspect evidence/proof. A global administrator without event assignment must be denied. Test revoked/expired membership and suspended/deactivated accounts.
- [ ] Desk staff cannot approve/reject; manager cannot review their own claim; approval before physical receipt is denied. Test two competing approvals.
- [ ] Only the claimant can reveal/replace the pickup code. Check replacement cooldown, old-code rejection and unchanged expiry. Do not share production pickup codes in screenshots/logs.
- [ ] Reject incorrect code, missing identity confirmation, self-release, stale version, expired approval and repeated release. Five failures lock the code; refresh and replace as claimant before retrying.
- [ ] Complete physical release; verify both histories, removal from the board, Released filter and other pending claims' rejection. Compare private receipt with minimal public verification; check copied URL and print output.
- [ ] Archive closed/cancelled events. Delete/restore an empty draft and edit it again. Check Deleted filtering, active-event refusal and custody-blocked deletion.
- [ ] Close/cancel an event with open claims; codes stop working and histories remain. Verify owner records after closure/deletion, and test campus reports/claims/tags/auctions/income as regressions.

Automated evidence: 1,139 offline backend tests pass with dummy credentials and socket connections blocked; 70 checks pass against ephemeral PostgreSQL. Both builds/admin types pass; user types retain the existing 108-error baseline. 17 synthetic desktop/phone browser cases cover claims, approval, failed/correct release, code replacement, receipts and workspace edit/archive/delete/restore. These checks do not replace authenticated hosted acceptance. Current toolchain is Node 24; the declared Node 22 release check remains a separate roadmap gate.

## Subsequent event QR milestone

Event QR sharing and printable branded posters are now implemented locally; see [QR checkpoint](EVENT_QR_CHECKPOINT.md). The previous future-scope statement describes the recovery checkpoint only. This read-only addition requires no new migration and leaves Smart Tag workflows separate.
