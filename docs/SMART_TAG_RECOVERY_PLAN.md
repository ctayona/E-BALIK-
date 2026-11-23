# Smart Tag recovery enhancement plan

Status as of November 23, 2026. Implemented locally for the university pilot. Production activation, university confirmations and device acceptance remain with the operator. Sections 9–11 record the implementation and release procedure.

Live verification on November 23 confirms both user-applied migration receipts, 239 venues, the management version column, all four RLS-enabled tables with no browser grants, service-only invoker functions, the event venue foreign key/readiness integration and both enabled custody triggers. Normalized function-body hashes match the local migration files. The migrations are applied; no rerun is needed.

## 1. Existing integration points

- `Server/app/utils/smart_tags.py`: `report_found` validates tag eligibility, applies a notification cooldown, then `_notify_owner` creates the existing owner notification and sends email. `link_found_item` already connects an office-received item to the claim workflow.
- `Users/Frontend/src/app/pages/tag/TagPage.tsx`: existing public QR/NFC recovery page and finder message/contact form. Extend this form rather than creating another reporting system.
- `Users/Frontend/src/app/shared/tags/MyTags.tsx` and the My Smart Tags page: add private report history here.
- Existing claim, custody, handover and receipt flows remain authoritative for physical receipt and return. Finder submission is not proof of custody or ownership.
- `Server/app/utils/events.py` currently exposes seven broad campus venue labels. New Smart Tag location detail must not replace these labels or alter event validation and existing report values.

## 2. User experience

1. A finder scans the existing QR or taps the existing NFC URL and chooses “I found this item.” Opening a page alone never sends location or a found alert.
2. Extend the existing form with optional building/area, floor, room and short landmark details. Existing message/contact fields remain supported. Include “Not sure / elsewhere” so incomplete campus knowledge cannot prevent recovery.
3. Add a separate optional “Share my current location” button. Before requesting device access, explain that this is the finder's current location, may differ from the found-at location, who receives it and how long it is retained.
4. Request one position using HTTPS browser geolocation. Show an accuracy estimate and timestamp, a preview, and Remove/Retry controls. Submission explicitly authorizes sharing this selected point. Do not use continuous tracking, IP geolocation or a fallback that silently collects location.
5. Permission denied, unavailable GPS, timeout or an inaccurate reading leaves the manual form usable. Never infer a room or floor from coordinates. Validate coordinates, accuracy and timestamp on the server; treat browser values as unverified.
6. Save the report first; then attempt the existing owner notification and email. Show an honest report-saved result even when email fails. Duplicated submissions and retries must not create duplicate reports or alerts.

## 3. Owner visibility and email

- Web: a private “Recovery activity” panel on each owned tag, with report time, found-at venue/details, finder message/contact and optional finder-shared current location. Show coordinates/accuracy/time and an external map link only inside the authorized detail view. The map provider receives location when its link is opened; explain this. Prefer no embedded third-party map.
- Notification bell: use the existing notification category and navigation, with generic text leading to the selected tag/report. Keep coordinates and finder contact out of notification previews and public DTOs.
- Email, including Gmail recipients: extend the existing email service, with item/tag reference, a minimal manual venue summary and an “Open recovery details” link requiring login and current ownership. Do not put exact coordinates, finder contact, private room details or location-bearing map URLs into email by default. Email copies can be forwarded and cannot be recalled after data expires.
- Thus both web and email inform the owner, while precise location is viewed after signing into E-Balik. Reuse the current email provider; a Gmail API connection is unnecessary. Mail-service acceptance must not be described as confirmed inbox delivery.

## 4. Recovery progress and safety

- Timeline: “Finder reported” is explicitly unverified. “Received by guard/office” appears only after the existing authorized custody action and linked found-item reference. “Returned to owner” appears only after the current verified handover/release workflow.
- Reuse the existing claim button, ownership checks, PIN and receipt process. An owner's existing mark-found action does not fabricate staff receipt or verified return.
- Add “Report suspicious report” in private history and an admin review view. Do not expose finder identity to the public or allow public modification of report status.
- Preserve existing cooldowns, add appropriate anonymous submission limits and request deduplication, enforce ownership/staff permissions, escape email/UI text, reject unexpected fields and audit access/status changes without logging coordinates/contact content.
- Location access belongs to the current tag owner and staff with the existing recovery permissions. Ownership changes must not give a new owner the previous owner's private history. Deactivated/expired/unregistered tags retain current restrictions.

## 5. UMak venues and rooms

Source: [UMak official campus map/directory](https://www.umak.edu.ph/about/campus-map/), retrieved through indexed official content November 23, 2026; the page states a July 24, 2026 update and warns of ongoing renovation. Direct page retrieval returned HTTP 403. Treat this as a sourced starting directory, not confirmation of present occupancy.

- Top-level areas: Administration Building, HPSB, Academic Buildings I/II/III, Academic Bridgeway and Stadium/Oval. Preserve existing app labels through explicit aliases instead of renaming historical data. Do not equate the current “Engineering Building” label to another building without confirmation.
- Published room examples: Bridgeway 201–202, 301–302, 401–402; Building III lecture rooms 301–312 and 401–416; HPSB computer laboratories 606, 806 and 1006, multimedia rooms 901 and 1012; Administration lecture rooms A1–A12 and A–D.
- Building I's public directory does not provide a complete classroom-number list. Building II includes overlapping room-use entries. Do not invent room ranges, assume all numbers exist, or silently resolve contradictory assignments.
- Use stable location IDs with building, floor, room label, public facility name, source URL, source date, verification date and availability. Searchable dependent choices prevent selecting a room from the wrong building. Existing report text remains intact.
- Admins can maintain/retire locations without deleting historical references. Restricted locations are not selectable meeting points. Finder-entered unlisted details remain clearly unverified and private. Confirm the initial catalogue with UMak/OHSO or UFMO before presenting it as university-verified.

## 6. Sticker improvements

Keep all issued tag URLs and QR payloads valid. Improve future print/download layouts with tag code, official E-Balik domain, scan-to-return instruction and readable QR quiet zones. No personal details in the QR payload. NFC continues using the same recovery URL and logic. Test real printed samples separately from browser checks.

## 7. Safe implementation sequence

1. Inspect relevant live schema read-only, current QR/NFC tests, notification routes, email template and custody/release integration; establish current behavior before editing.
2. Prepare an additive, rerunnable migration for private recovery reports/history and the location catalogue after inspecting existing conventions. Prefer a separate short-lived location record for consent/coordinates. No destructive renames, historical updates or changes to issued tag codes. User reviews and runs SQL.
3. Add backend capability detection and a feature flag defaulting off. Legacy found submissions containing only message/contact must continue working. Missing migration/disabled capability preserves the existing form and endpoint behavior. When new reporting is enabled, persistence failure must return a retryable error rather than claim a saved location.
4. Add manual venue form and private owner history; integrate the existing email/notification pipeline with deduplication and explicit partial-failure handling.
5. Add optional geolocation/consent, restricted detail endpoint and documented retention. Proposed default: automatically erase precise coordinates after seven days or verified return, whichever happens first; retain only necessary minimal recovery history under a separate policy. Final retention and privacy notice require UMak privacy review. Prepare cleanup code locally; user explicitly controls live activation.
6. Connect custody timeline, admin misuse review, location maintenance and new sticker layouts. Keep event workflows separate.
7. Verify offline and deliver a manual acceptance checklist before enabling the feature in production. Commit/push only when requested for this work.

## 8. Acceptance and rollback

- Regression: existing printed QR/NFC URLs, blank registration, approval, contact privacy, lost/active/expired/disabled states, renewal, found notices/cooldown, office linking, claims, handover and existing event behavior.
- New: all manual/GPS combinations; permission denial/timeouts/removal; inaccurate/stale input; duplicate/concurrent sends; persistence/email/notification failures; current-owner-only history, ownership change, staff access restrictions, public response leaks; retention enforcement; mobile/light/dark design and source-backed room choices.
- No tests or app workflows may write to live DB/storage or send real emails. Use isolated fixtures and a disposable database. User performs live acceptance and phone/printed-tag tests.
- Rollback: disable the feature and revert application commits. Preserve additive tables/history and issued URLs; no database teardown. Verify rollback preserves old message/contact reporting before release.

Completion means the user has reviewed the venue exceptions and privacy policy, run audited migrations, and passed manual acceptance. Offline tests alone do not establish production readiness.

## 9. Implemented venue inventory

The shared source is `shared/campus.json`. Its stable key is the exact path, such as `HPSB / 6F / Room 606`. The 239 keys include 7 directory buildings/areas, 28 floor paths, 190 room/facility paths and 14 existing app labels. Source date and directory check date apply to the sourced paths. University confirmation of occupancy is pending. Native building, floor and room selectors only offer children of the selected parent.

| Feature | Storage and validation | Implementation |
| --- | --- | --- |
| User Missing Item and Found Item | `missing_items.last_location` and `found_items.location`. Existing text guard, 150-character maximum | Shared picker with the previous initial value. Existing text, report references and images remain readable. |
| My Reports and admin Lost/Found Items | Same text fields. Existing records can contain landmarks, previous labels and free text | Shared catalogue suggestions while editing. Filters still derive choices from recorded values. |
| Campus and event matching | Campus scorer reads last/found location. Event matching adapts its own reports and calls the same scorer. | Explicit aliases compare equally. A building and its room partially match. Identical room numbers in different known buildings do not earn location points. Descriptions and dates keep their existing weighting. |
| Admin event setup, readiness and scheduling | `event_workspaces.venue`, existing versioned transition RPC | Same active catalogue in the form, server validator and SQL readiness check. An existing retired value remains visible when editing. Select a current venue before scheduling. |
| Event attendee and staff reports, board and permitted hub publication | `event_reports.venue` plus separate `location_details`; each report stays under its event ID | Both forms use the event options response. The selected venue can appear on approved event/publication views under existing consent. Put private landmarks in location details. |
| Smart Tag finder, owner and email | Optional catalogue path in a private report; optional one-time device point in a separate table | Room and private message stay in the owner view. Email contains the building/area and a sign-in link to the tag. Staff can read a flagged message in the existing permission-controlled Smart Tags panel. |
| Security desks, event collection instructions, custody and storage | Guard posts, assigned desks, bins, transfer destinations and receipt references have distinct operational meanings | These continue to use their existing controls and physical handover checks. Choosing a classroom never establishes custody. |

Super admins can add, rename, retire and restore entries under **Smart Tags → Manage UMak venues**, after applying the management migration described in section 12. Retiring a building hides its descendants from new catalogue selections. The official directory identifies ongoing renovation. Confirm Building I numbers, Building II rooms 205–206, Building III room 111, legacy Engineering/ICT/Faculty Hall names and suitability of rooms as event meeting points with UFMO/OHSO. Restricted and uncertain entries have been omitted from the sourced choices. [UMak campus directory](https://www.umak.edu.ph/about/campus-map/)

## 10. Migration, operations and rollback

1. Keep both backend switches off during rollout. Apply `Server/manual_migrations/20261123_campus_venues.sql` first. This seeds keys and extends the existing event venue validation. It replaces the previous seven-value event-report CHECK with a foreign key and changes the venue predicate in the existing transition function. Both changes are within one transaction. Historical report values are not rewritten. A dependency, drift or lock failure rolls the transaction back.
2. Apply `Server/manual_migrations/20261123b_smart_tag_recovery.sql`. This creates private report and point tables, a service-only submission RPC and intake/release triggers. Existing QR payloads, NFC records, counters, ownership verification, PINs and receipts keep their roles. A report is saved before the app attempts alerts. Retrying a saved request ID does not send another notification.
3. Verify both receipts and permissions in the SQL Editor. Expect two names, four RLS-enabled tables, no browser SELECT or RPC execute privileges, and 239 initial catalogue keys. The combined venue file includes management and its history table.

```sql
SELECT name FROM public.migration_log
WHERE name IN ('20261123_campus_venues','20261123b_smart_tag_recovery') ORDER BY name;
SELECT count(*) FROM public.campus_venues;
SELECT c.relname, c.relrowsecurity,
       has_table_privilege('anon',c.oid,'SELECT') AS anonymous_read,
       has_table_privilege('authenticated',c.oid,'SELECT') AS browser_read
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('campus_venues','campus_venue_history','tag_recovery_reports','tag_recovery_points');
SELECT role, has_function_privilege(role,'public.tag_recovery_submit(text,uuid,text,text,text,jsonb)','EXECUTE')
FROM (VALUES ('anon'::name),('authenticated'::name),('service_role'::name)) AS roles(role);
```

4. Deploy compatible app versions when ready. Set `CAMPUS_VENUES_ENABLED=true` first and confirm the selectors. After reviewing the consent copy, retention and authorized staff roles, set `SMART_TAG_RECOVERY_ENABLED=true`. Restart the API after flag changes. Use the existing public HTTPS site URL and mail provider.
5. Keep the existing scheduled job running reliably. Owner queries filter expired points immediately. Verified collection deletes the linked point in the release transaction. The scheduler physically deletes time-expired points on its next successful run, including while the feature flag is off. Application backup/restore excludes these points. Review separate host-managed backup retention and the longer-lived report message/contact policy with the university.
6. **Rollback** by setting the recovery flag to false and restarting the API. Set the venue flag to false if needed. Verify a legacy message/contact submission and the original seven event choices. Keep the tables, triggers and issued URLs. Existing detailed locations remain stored; an event with such a location may need a legacy selection before scheduling using an older app. Keep the cleanup worker and backup exclusions deployed while outstanding points exist. If reverting the entire server, arrange equivalent scheduled deletion and backup exclusions first. Avoid resetting a dirty working tree.

## 11. Operator acceptance

- [ ] Scan an already-issued QR, tap an already-encoded NFC card and scan a freshly printed sticker on the HONOR 200. Verify the same HTTPS tag page, owner privacy choices, registration/approval and disabled/expired behavior.
- [ ] Open and cancel a scan without submitting. Check that the browser never requests location on page load. Submit manual-only, GPS-only and both. Deny, remove or retry GPS. Confirm the coordinate/accuracy preview appears only after permission. Retry after a simulated network failure and check for a single report/alert.
- [ ] Sign out and open the recovery email. Sign in as the owner and verify it opens the right tag. Test the bell link with two tags. Check email/preview content for absence of room, contact and coordinates. A second account must receive no history for that tag.
- [ ] Check the finder timestamp and accuracy in owner history. Flag a report and review it as authorized staff. Check that staff review exposes the flagged message, with no separate contact/point fields. Verify ordinary users cannot resolve flags or manage venues.
- [ ] Register the tagged item through office intake. Check the reference and open the existing claim form. Confirm ownership, release using the existing PIN workflow, then check the receipt, timeline and disappearance of the precise point. Marking a tag found alone must not mark it physically returned.
- [ ] Choose a room on campus reports and both event forms. Edit an old free-text report and an old draft, check matching within/across buildings, then retire/restore a room and its parent. Confirm historical display and event isolation.
- [ ] Test phone and desktop layout, light/dark themes, mail delivery, scheduler cadence and both rollback flags with designated pilot accounts before general activation.

Offline evidence includes the full socket-blocked Python suite (`scripts/test-backend-offline.py`), the real event migrations and both new migrations in disposable PostgreSQL (`scripts/test-tag-recovery-sql.mjs`), synthetic browser GPS and staff workflows, software decoding of a generated sticker, both frontend builds and type checks. The user type check has a pre-existing baseline of 108 errors. None of these exercises a physical device, a live release, or an actual owner's mailbox.

## 12. Editable SQL venue catalogue

Added on November 23 following the user's request for editable buildings and rooms. Before any live SQL was applied, venue setup and management were combined into `20261123_campus_venues.sql`. Apply that file first, then `20261123b_smart_tag_recovery.sql`. The combined migration includes row versions, an append-only audit history and a service-only editing command in one transaction. Existing report text is preserved. Editing stays disabled until the combined migration receipt is available. The existing campus flag controls activation.

- Open **Super admin → Smart Tags → Manage UMak venues**. Use Add location to create the building, then its floor, then a room or facility. Enter university-confirmed names. Subsequent additions use the panel and require no new migration or frontend rebuild.
- Search/select an existing path to edit its building, floor or room fields. A rename creates corrected choices and retires the previous path and its descendants in one transaction. Existing reports and foreign keys continue referencing the recorded label. A mistaken rename can be reversed by retiring the new path and restoring the old building/floor/room paths.
- The server checks active parents, duplicates, 80-character length, the three-level format, super-admin role and the row version. A stale editor must refresh. Legacy compatibility labels are protected. Availability is independent for each child; restoring a parent also requires restoring any independently retired child.
- All relevant selectors read current database entries. JSON remains the source record for the initial official directory and compatibility aliases. Admin additions are confirmed by the operator and recorded in `campus_venue_history`. A source lookup is still required before assigning uncertain room numbers or purposes.
- Verification passed with 1,241 socket-blocked backend tests, actual migration reruns and management RPC tests in disposable PostgreSQL, both Node 22 builds, admin types, the unchanged user baseline of 108, and desktop/mobile browser tests for add, rename and retire. Test the actual deployed theme and university room details during operator acceptance.

## 13. Local acceptance and deployment test

The release review reran 1,241 network-blocked backend tests, disposable SQL tests, both type checks and the combined Vercel production build on Node 22. User type checking remains at its existing 108-error baseline. These checks use fixtures; physical QR/NFC, actual mailbox and authorized pickup acceptance are operator-run.

For manual local acceptance, set `CAMPUS_VENUES_ENABLED=true`, `SMART_TAG_RECOVERY_ENABLED=true` and `SCHEDULER_ENABLED=false` in `Environment_Configs/backend/.env`, then restart using `npm run dev`. The local frontend API value is already `http://localhost:5000`. Open the user app at `http://localhost:5173` and admin at `http://localhost:8443/admin/`. Local app submissions use the configured Supabase project and can send real emails. Use designated test accounts and a dedicated approved tag. Codex's tests must continue blocking external connections.

Open `http://localhost:5173/tag/<test-code>` directly in another browser/profile. Existing printed QR payloads still open their configured public site. Test manual submission, GPS denial/share/removal, current-owner history, a second account's denial, suspicious-report review, room add/rename/retirement and office intake/claim/PIN/receipt. Localhost in desktop browsers supports geolocation; phone testing needs a reachable HTTPS frontend and API. Keep local scheduler disabled to avoid running unrelated production housekeeping during laptop tests.

For controlled deployment, ship both frontend and backend, including `shared/`. Leave new flags off initially, then enable venues and recovery deliberately on the hosted API. Keep the permanent `PUBLIC_SITE_URL`, HTTPS API address, CORS and existing provider secrets configured for their respective hosted environments. Recheck the email link after signed-out login, physical QR/NFC on the HONOR and the expiry cleanup schedule. A production push to main can auto-deploy under the existing Render configuration. Applied SQL alone does not activate these app flags.

Rollback initially means disabling the recovery flag and restarting the API. Preserve coordinate cleanup and backup exclusions and verify the old finder form. Keep unrelated paper artifacts out of the feature commit.
