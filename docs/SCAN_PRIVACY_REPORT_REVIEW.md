# Scan privacy and campus report review

This release includes the earlier rental billing, archive-first and role-ID work. Existing QR/NFC URLs, ownership, payments, PINs, custody/release and event-only reporting stay connected to their existing services.

Nov 25 reliability update: read-only verification confirms the scan/privacy migration, table, RPC and service permissions are installed. No additional SQL is required for this fix. Valid tag page requests now record metadata server-side before returning recovery information, and the admin table refreshes every five seconds while visible. An unset scan flag now activates logging once the migration is installed; explicit false remains an emergency suspension. GET `/api/tags/capabilities` reports setup/configuration state without recording a visit.

## Privacy design and boundaries

- An enabled personal-tag page records a server-timestamped **page open**, not evidence of a physical scan or item recovery. QR and NFC use the same existing page. The initial tag GET records it directly; a per-page receipt in private headers deduplicates refresh/auth retries, and the server stores its hash. Receipts never go in URL query strings. Legacy requests without headers receive a generated receipt, and the browser can retry recording without blocking recovery. No scanner account, IP, user-agent or device fingerprint is added to this table. The tag's owner UUID is snapshotted solely to isolate owner access when ownership changes.
- Basic contact information still follows the owner's visibility settings. Visit logging, GPS failure and declined consent do not block it. Existing approximate aggregate count/last-visit statistics remain separate.
- GPS is requested only by an explicit button after choosing recipients. Admin consent and owner consent are separate unchecked boxes. Area/floor/room selections reuse the shared UMak catalogue; OHSO/office drop-off is optional. Entering selections does not submit them.
- The existing finder-report GPS button remains owner-only. It does not populate the admin scan location. Use **Optional scan location** on the tag page, select the admin recipient, choose GPS/area/drop-off, and press **Share location** to include a location in the admin log. Neither choice is required for the automatic tag ID/timestamp record.
- **Share location** transmits the selected point/area only to chosen recipients. Owner-only coordinates are omitted from admin responses; admin-only coordinates are omitted from owner responses. Neither appears in public posts, activity-log metadata or scan email. Owner history checks both the current owner and the ownership snapshot.
- GPS is a device position with accuracy/capture time, not proof of where an item was found. Share within 15 minutes of the page open; GPS must be fresh within 10 minutes. A receipt authorizes withdrawal, not account access.
- Locations expire after 7 days, or immediately on withdrawal, staff resolution or a linked verified return. Raw visit records expire after 30 days. Read serializers suppress expired fields even before cleanup. The existing scheduler/secret-protected cron removes expired fields and rows; keep it running. Coordinates and receipt hashes are excluded from application backups and all restore paths. Hosting/provider backups and security logs need separate operator retention settings.
- The scanner can withdraw on the open page, including after an uncertain network response. For later requests, the page supplies a visit reference and the existing support address. A recipient may already have seen the location; withdrawal cannot recall a copy.
- Admin → Activity logs → **Smart Tag scans** provides paged, scrollable records, tag/state filters and Resolve/remove location. Only fresh authorized admin/super-admin sessions with Activity logs access can read/resolve scans. Guard access alone is insufficient.
- Current admin-consented GPS rows offer **Open in Google Maps** using the captured coordinates. The link disappears with the location on resolution/withdrawal/expiry. It uses the official [Maps URL format](https://developers.google.com/maps/documentation/urls/get-started); no map tiles or coordinates are sent to Google until the administrator opens the link. Manual area/drop-off entries without GPS remain text rather than an invented pin.
- Owners can see opted-in locations under **My Tags → tag details → Locations shared with you**. Refresh retrieves current server state.

The design follows transparency, purpose limitation, proportionality and optional, recipient-specific consent described in [RA 10173](https://privacy.gov.ph/data-privacy-act/) and [NPC consent guidance](https://privacy.gov.ph/wp-content/uploads/2023/11/NPC-Circular-No.-2023-04_Guidelines-on-Consent_07Nov2023.pdf). This is implementation evidence, not certification of legal compliance. The operator must confirm the controller/contact details, lawful basis for minimal visit logging, retention suitability, provider logs/backups and institutional deployment arrangements. The public `/privacy` notice and scan notice explain the implemented flow.

## Report approval flow

1. After migration, new campus found/missing reports are `pending` for publication. This includes missing reports created when a personal Smart Tag is marked lost. Existing reports retain their approved state.
2. Reports remain visible privately to their reporter and authorized staff. Custody, receipt and handover records retain their own states. Confirmation emails acknowledge receipt, and owner pages show awaiting review.
3. Admin → Reports → **Approve Reports** filters type, category, item title and review state. Review shows description/photo/location and custody context. Approve publishes; rejection requires an explanation and notifies the reporter. Notifications use the existing service. Matching alerts run only after approval and still respect existing notification/email preferences.
4. Content edits reset publication to pending and increment a version. Custody, archive and lifecycle-only edits do not erase review status. Row locks, request IDs, versions and decision history protect competing/retried reviews. A rejection can be corrected by an owner edit and reviewed again.
5. Pending/rejected/archived reports are excluded from campus feed/detail/comments/reactions, public landing cards/counts, browse/search, photo search, matching candidates/alerts and new user claims. Existing claims and custody/release operations remain available through their established private paths.
6. Event reports remain in the existing event-only moderation/publication model. This migration does not move them into campus report tables or change event Smart Tag sessions.
7. SQL enforces RLS and removes direct browser-role grants on the two report tables and new private tables/functions. Flask's service role mediates access. Read-only inspection found the report tables already had RLS enabled with no browser policies; broad grants were still present. No frontend uses a direct Supabase report client.

## Migration and activation

Read-only verification on Nov 25 found receipts for `20261124b_event_rentals`, `20261124c_admin_archive_first` and `20261125_scan_privacy_and_report_review`. Do not rerun them solely for this reliability fix. Their original files remain included for reproducibility. The numbered steps below also describe installation into an environment where the new schema is absent.

1. Use the established operator backup process; Codex has not run it against live data.
2. Deploy matching frontend/backend code **before applying the new migration**, with scan logging off. Verify every backend instance has this release; without the migration the new code preserves existing report behavior. If old instances may still serve requests, use System control maintenance mode until rollout and migration are complete. Old readers do not know publication filters.
3. Apply **Server/manual_migrations/20261125_scan_privacy_and_report_review.sql** manually only if absent. It requires the already-applied `20261123b_smart_tag_recovery`. It adds columns/tables/functions/triggers/indexes; it does not delete existing reports or alter custody status. Existing reports stay approved; new inserts and content edits require review. The file is rerunnable and transactional. Logging is active when that schema is installed and **SMART_TAG_SCAN_LOGGING_ENABLED** is unset or true; false explicitly suspends it. The production Blueprint/example specify true. No hidden GPS is requested.
4. Set **REPORT_REVIEW_ENABLED=true** after migration. It makes submission fail closed if review setup disappears. Migration presence always enforces pending/approved visibility, even when that flag is false; the flag cannot publish pending reports. Without migration, the default preserves the existing report workflow and the approval tab explains setup is unavailable.
5. Keep scheduler/cron running for physical retention cleanup. Expiry masking is independent of the scan feature flag. No cleanup emails contain coordinates. Check the support contact/privacy notice and operator/provider retention arrangements before inviting real scanners.

Useful read-only verification:

```sql
SELECT name FROM public.migration_log WHERE name='20261125_scan_privacy_and_report_review';
SELECT publication_state,count(*) FROM public.found_items GROUP BY 1;
SELECT publication_state,count(*) FROM public.missing_items GROUP BY 1;
SELECT relname,relrowsecurity FROM pg_class WHERE oid IN ('public.smart_tag_scans'::regclass,'public.report_publication_history'::regclass);
SELECT table_name,grantee,privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name IN ('smart_tag_scans','report_publication_history','found_items','missing_items') AND grantee IN ('anon','authenticated'); -- no rows expected
```

## Acceptance checklist

- Open a personal QR and NFC URL signed out. Contacts follow owner visibility. A visit appears without a location prompt; basic recovery remains usable if logging fails.
- Leave both boxes unchecked: no location is sent. Try GPS denial/indoor timeout, then area/room or drop-off fallback. Test admin-only, owner-only and both sharing. Check the opposite recipient receives no point or area.
- Withdraw; refresh the owner/admin history. Resolve another visit; verify location disappears immediately. Confirm a linked verified return clears retained scan locations. Verify seven/30-day expiry with isolated fixtures, not by altering production timestamps.
- Change tag ownership in an authorized test scenario; neither owner can read the other's scan session. A guard or normal account cannot call the scan-log/review APIs.
- Submit lost/found reports with photos. Before approval they appear only privately, not on landing/feed/search/photo matching or as a new claim target. Approve one; reject another with a reason; edit and resubmit the rejected report. Check owner notices and configured matching/email delivery manually.
- Open two admin tabs on the same pending report: the stale review must be rejected. Change report content while a review modal is open: refresh is required. Archive an in-custody report, then restore/release using existing authorized controls.
- Check 390px and desktop layouts: tables scroll inside bounded regions; form controls remain usable; GPS is optional. Regression-check personal tag registration/approval/payment, event tag intake/PIN reuse, rental billing and role changes.

## Rollback

- Fast containment: set SMART_TAG_SCAN_LOGGING_ENABLED=false and restart. New visits/shares stop; existing expiration cleanup continues. Do not restore the scan table from a backup.
- Keep report publication filters and the review schema installed. Do **not** clear pending states or drop tables to roll back the UI.
- If reverting to code from before this release after review activation, first use System control maintenance mode and keep public access closed. Old code does not know publication filters. Deploy a rollback branch that retains those filters (or restore this release) before reopening public access. A blind source revert could expose unreviewed posts.
- Use the release's safety tag as the source reference; revert through a reviewed rollback commit, without force-pushing or destroying data. Database reversal is not required and is not supplied.

## Offline evidence

- `Server/venv/Scripts/python.exe scripts/test-backend-offline.py`: network-blocked full backend regression suite, including consent, owner isolation, authorization, fail-closed publication and legacy workflows.
- Both production builds and type gates; user errors must remain below the unchanged baseline 108.
- `node scripts/test-scan-privacy-report-review-sql.mjs <local-pglite-index.js>`: disposable PostgreSQL migration/rerun, consent/receipt/review/version/retention/role tests.
- `python scripts/test-scan-privacy-concurrency.py <local-postgres-bin>`: fresh loopback-only PostgreSQL, independent competing approval/duplicate-visit/share-withdraw sessions; no project database URL is read.
- `node scripts/test-scan-privacy-browser.mjs`: hidden Edge, fully mocked APIs/GPS, desktop and phone views for scan fallback/withdrawal, approval and activity resolution. Build both apps first. No live email, storage or account writes are part of these checks.
