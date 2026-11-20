# Event Reporting and Desk Intake

2026-11-16. Implemented locally; no commits, pushes or deployment. The user-applied lifecycle migration was verified read-only this turn. The new `20261116b_event_reports.sql` migration is prepared locally and still awaits user execution.

## What you can use after migration

1. Restart the backend and both frontends using the existing development commands. Keep `EBALIK_EVENTS_FOUNDATION_ENABLED=true` in the backend process.
2. Sign in as a super administrator. Open Events, finish/save the setup, assign an active manager through final claiming, and select Review.
3. For testing, choose dates whose operating window includes now. Start the event. A scheduled future event remains read-only until started manually.
4. In Review, choose **Open attendee portal**, read the publication notice and enter a reason. Copy its link or select View event page. Starting the event alone never opens the portal.
5. On the user frontend, open `/events/<event-slug>`. The slug is the saved event reference, not a new typed event name. Event artwork, palette and theme come from saved setup.
6. An attendee signs in with an existing verified E-Balik account and returns to the event link. They can submit a missing/found report, browse manager-approved generic listings, and track their own submissions.
7. Assigned managers/desk staff sign in on the user frontend, open **Event desk** in the account menu/mobile sidebar, then select **Open event desk** on the assignment card.
8. Managers review private details and approve a generic public label for this event, or hide the listing. Both staff roles can record physical receipt of a found item, specify its private storage position and add private notes.

The page is usable for event reporting, moderation and physical intake. It is not a complete ownership-claim/release workflow. Do not treat a report, approval or intake record as proof of ownership or an authorized release.

## Access and privacy rules

| Capability | Access |
|---|---|
| Open/pause attendee portal | Current active super administrator; opening requires an active/recovery event and an active manager covering recovery |
| See branded event identity/instructions | Anyone with the event link while the portal is open and recovery has not expired |
| Browse approved generic event listings | Active verified E-Balik accounts; explicit assigned staff use their event assignment, which does not verify their campus account |
| Submit attendee report | Same account gate, explicit consent, open portal, active/recovery event, before final claiming |
| Record desk report | Current assigned manager/desk staff, active/recovery event, before final claiming; allowed while attendee portal is paused |
| View private report details/history | Current assigned event staff only |
| Read own reports/photos | Active submitting account, including after portal closure; private staff notes/storage positions are excluded |
| Approve/hide event-board label | Current event manager only |
| Receive found item / add private note | Current event manager or desk staff |
| Withdraw | Submitting account only, during active/recovery before final claiming, and only without physical desk custody |

Global administrator status never substitutes for event staff membership. Assign yourself explicitly if you will operate the desk. Revoked/expired/suspended staff lose access on the next server check. Existing idle/expiry and global/role session revocation remain enforced. Event membership does not change `user_profiles` campus roles.

The board exposes an explicit field allow-list: report reference, generic manager-written label, report type, category, university venue, incident time and receipt status. Original item name, distinguishing description, exact location, reporter identity, storage position, staff notes and photos are excluded. Staff must keep personal names, serial numbers, IDs and contacts out of public labels; validation is a guard, not automatic redaction. Consent to this generic event-only listing is stored with the report.

Private report images use a separate `event-report-images` bucket. Only nonanimated JPG/PNG/WebP up to 5 MB and 20 megapixels are accepted; decoded pixels are resized and rebuilt as WebP without EXIF. The server authorizes owner/staff on every image request and streams bytes with `Cache-Control: no-store`; report photos are not supplied as public or signed board URLs. Already downloaded content cannot be recalled. Public event branding uses the existing signed-artwork mechanism; pausing cannot retract downloaded artwork or issued URLs immediately.

Reports may be filed during the event and recovery period, but the incident itself must fall between event start and event end, and cannot be in the future. Report writes are checked again transactionally against the current account, assignment, event state, version and deadlines. Submissions are limited to 25 per account/event in a rolling day, with an additional per-process attempt limiter. These are pilot limits, not a distributed anti-abuse service.

Submission request IDs make retries idempotent. A network error may occur after commit; retry the same form rather than immediately creating another report. Failed uploads are removed only when the server can confirm the new object is unreferenced. Objects from an ambiguous transport failure are retained for later review rather than risking deletion of committed evidence.

The queue uses bounded pages of 24. Its search/filter controls apply to the current page and are labelled accordingly. Private history is bounded to the latest 100 entries in the dialog. Owners can read their reports after closure through My reports on the event URL; withdrawal and staff operations close at the deadline.

## Migration safety and verification

Manually run **Server/manual_migrations/20261116b_event_reports.sql** in the intended project. Do not rerun the already-applied foundation, artwork or lifecycle migrations.

The new file runs in one transaction with 5-second lock and 30-second statement timeouts. It requires the lifecycle migration; refuses colliding tables/functions/bucket/column or a repeat installation; and refuses browser Storage policies that need review. An error should leave no partial installation; roll back an aborted SQL-editor transaction before investigating. Do not remove guards or run selected fragments.

It adds one default-false `portal_enabled` flag to event configuration, two event-only tables, two server-only SECURITY INVOKER functions, and one private image bucket. Existing event states/data, campus reports, claim/custody tables, income ledger, existing buckets and their policies are not rewritten. New tables follow the current UUID, foreign-key, timestamp and naming conventions. Composite history/report keys prevent cross-event history links. New tables have RLS enabled; PUBLIC/anon/authenticated receive no access. Service role gets SELECT/INSERT/UPDATE for reports and SELECT/INSERT for history; no delete/truncate grants are added. Function EXECUTE is server-only.

State/intake updates and history inserts are atomic. Report RPCs lock the event and current account/membership rows and use report versions. New report tables cannot accept a campus `item_id` as a report association. Backups include the private bucket; restoration orders reports after their workspace and history after its report, preserving existing history entries.

Use these read-only verification queries after your SQL execution:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT name,applied_at FROM public.migration_log WHERE name='20261116b_event_reports';
SELECT column_name,data_type,column_default,is_nullable FROM information_schema.columns
WHERE table_schema='public' AND table_name='event_workspaces' AND column_name='portal_enabled';
SELECT relname,relrowsecurity FROM pg_class
WHERE oid IN (to_regclass('public.event_reports'),to_regclass('public.event_report_history'));
SELECT grantee,table_name,privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name IN ('event_reports','event_report_history');
SELECT grantee,routine_name,privilege_type FROM information_schema.routine_privileges
WHERE routine_schema='public' AND routine_name IN ('event_set_portal','event_report_command');
SELECT id,public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id='event-report-images';
COMMIT;
```

Owner/administrative grants may appear. Browser roles must have no new table access/function EXECUTE. The new bucket must be private, WebP-only, and limited to 5242880 bytes. Report commands require SELECT/UPDATE privileges for the existing profile/membership row locks; these service-role privileges were verified read-only before migration preparation.

Before this migration is installed, the existing assignment workspace still opens and explains that report operations need setup. Draft/lifecycle editing stays available. Portal controls and report writes fail closed. No additional frontend/server secrets or package dependencies were introduced.

## Compatibility inventory for this isolated slice

This is a deliberate revision of the roadmap's initially proposed shared-table association. We use **separate event reports** because existing campus queries/RPCs do not all carry a scope parameter. No event row is inserted into `found_items`, `missing_items`, `claims`, campus custody, notification or auction tables. The reviewed integration owners remain on their existing table sets:

| Area | Code evidence / treatment |
|---|---|
| Campus reporting/browse/matching | `supabase_db.py` campus getters and Users report/browse/matches routes stay unchanged; `match_alerts.py:86` and `:113` query only missing/found campus tables |
| Claims/custody/release | `Users/Backend/claim/routes.py:80` resolves campus fpost references; `report_lifecycle.py`, `handover.py`, `custody_log.py` remain campus-only. Event intake uses its own history, with no claim/release action |
| Tags/auctions/payments/receipts | Existing smart-tag, auction and financial helpers receive no event report records or new payable sources; event found reports are not campus auction inventory |
| Analytics/monthly exports | `analytics.py:189` and `:190`, `monthly_report.py:104` onward name campus tables; event reports are absent from those totals |
| Scheduled maintenance/reminders | Scheduler/housekeeping continue using campus auction, claim and tag records; no event notification or retention job is added |
| Media cleanup | `mission_control.py:29` has an explicit old-bucket allow-list; event media is excluded from campus orphan deletion. Do not add event buckets to it without reference-aware cleanup |
| Recycle bin | Existing `recycle_bin.py` kind/table lists are unchanged; reports are retained/withdrawn, not deleted through campus recycle-bin paths |
| Backup/restore | General backups intentionally include new tables; explicit event parent/history ordering and append-only history restore are updated in both restore implementations |
| Routes/cache | Only `/events/<slug>` and event APIs are added; admin/tag/privacy navigation is preserved. Service-worker caching remains limited to navigation/assets rather than authenticated event API/image responses |

The full cross-feature inventory remains required before event matching, claims/releases, Smart Tags, hub promotion, billing or operational cleanup is integrated. In-memory SQL tests preserve a campus sentinel; network-blocked backend regressions cover current campus behavior. Hosted/manual acceptance is still required; this is not a claim of production readiness.

## Manual acceptance

- [ ] Apply the new SQL yourself; verify the objects/grants/bucket with SELECTs and restart local servers.
- [ ] Before migration, assignments still open; report controls show setup required rather than breaking campus pages.
- [ ] Start a test event with valid current dates and a manager assignment through final claiming; explicitly open its portal in Review.
- [ ] Confirm saved logo/banner, three theme presets, colors and mobile layout on `/events/<slug>`.
- [ ] Sign in as a verified attendee; submit missing and found reports, with and without a private photo. Keep the returned references and check My reports after reload.
- [ ] Retry the same submitted request during a simulated connection failure; no duplicate report/history should appear.
- [ ] Reports initially stay off the board. Manager approval adds only the generic label/category/venue/time/receipt status, with no private fields or photo.
- [ ] A desk-staff account cannot approve/hide; an unassigned campus administrator cannot open the queue or private report/photo APIs.
- [ ] Record physical receipt with the checkbox, storage position and note. Confirm history, prevent a duplicate receipt, and prevent owner withdrawal afterward.
- [ ] Withdraw an unreceived own report; it disappears from the event board without deleting its history. Other accounts cannot withdraw it.
- [ ] Use two staff sessions; a stale action is refused and the latest report must be reviewed before retrying.
- [ ] Pause the portal: attendee page/submissions close, but currently assigned staff can continue intake until the deadline. Revoke/suspend/expire staff and verify the next request is denied.
- [ ] After recovery expires, staff writes/portal access stop even if manual closure was not performed; own report tracking remains available to the submitting account.
- [ ] Normal campus reports, browsing/matching, claims, tags, auctions, income and backups still behave correctly. Event reports never appear in them.

## Remaining features

Ownership requests/evidence, approved release/PINs/receipts, matching/alerts, main-hub promotion/unpublish, closing exports/custody transfers, guest accounts, rental billing and event Smart Tags are not delivered by this checkpoint. They need separate scoped workflows and compatibility tests. Keep any live pilot limited to the capabilities above; retained items need an agreed physical custody process and the next claim/release stage.

## Subsequent recovery milestone

The reporting migration was verified user-applied on 2026-11-16. Claims, authorized release/receipts and workspace management are now implemented locally in the [recovery checkpoint](EVENT_RECOVERY_CHECKPOINT.md), with a separate pending user-run migration. Earlier pending-scope statements above describe this reporting checkpoint only.
