# Event desk possible matches

Implemented locally on 2026-11-16 as the first matching step in Phase 5. No migration, package/configuration change, live database/storage write, commit, push or deployment was performed. Attendee alerts are a separate next step.

## Use the panel

1. Restart the local backend and reload the user frontend.
2. Sign in as an assigned event manager or desk staff member and open **Event desk → Open event desk → Possible matches**.
3. Choose an eligible missing or found report. Reports are listed in pages of 24; hidden, withdrawn and released entries are excluded from the chooser.
4. Inspect suggested counterparts, similarity components, reasons and differences. Suggestions stay within the selected event and compare opposite report types.
5. Use **Review source** or **Review found/missing report** to open the existing private report modal. Its current moderation, intake, private photo and note permissions still apply.
6. **Find possible matches** in a report modal also opens matching with that report selected. **Compare from this report** reverses the comparison direction.
7. A found report's existing **Ownership claims for this item** button opens that report's event claims. The claimant still submits evidence and follows manager approval, physical intake and verified release rules.

On phones, the chooser collapses after selection; **Change report** reopens it. Results display four cards per view. **More suggestions** pages through the current shortlist without another server query. **Older candidates** compares the next group of eligible candidate records; **Newer candidates** returns to the preceding group.

## Scoring and limits

The event adapter reuses only the existing pure `matching.match_details` function. The campus matching algorithm, query paths, alert hooks and stored campus matches are unchanged. Event rows are adapted in memory; no campus item/post identifiers are created or passed into write workflows.

The comparison uses name/description, category, university venue and incident date. English/Filipino synonyms, typo handling and contradiction penalties come from the existing scorer. Incident dates are converted to Manila calendar dates for its date component. A found timestamp preceding the missing timestamp is excluded before scoring, including on the same day.

Each request reads up to 100 candidates plus a next-page marker, using deterministic ordering and an explicit event filter. Known categories compare against that category and `Others`; an `Others` source can compare across categories. The server excludes same-reporter pairs and requires eligible pending/approved records. It returns at most 12 suggestions, requiring overall similarity of at least 60/100 and a text component of at least 30/100. Category, venue and date alone are insufficient.

The shortlist is ranked within that candidate group. It is not a search of every event report in one request; use older/newer candidate controls to extend the comparison. Absence from the shortlist or a low score does not disprove ownership. The score is similarity, not a probability of ownership or an approval decision.

Images are not scored in this milestone. No image features are generated and no private image is fetched for matching. Staff can inspect a photo through the existing authenticated report modal.

## Access, privacy and connections

- `GET /api/events/<event_id>/reports/<report_id>/matches?offset=0` uses the existing private event wrapper: current account/session/maintenance checks, fresh event membership, assignment expiry and event operating window. Responses are no-store; matching is limited to 30 requests per account/minute.
- Both managers and desk staff can compare. An attendee or global administrator without an event assignment cannot use this endpoint. Supplying an event, report or actor ID does not grant access.
- The source and candidate reads explicitly filter by event. Candidates are checked again in memory. Hidden, withdrawn and released sources are rejected; expired, closed, cancelled, archived and deleted workspaces follow existing staff access restrictions. Pausing the public portal does not remove valid staff access.
- Recommendation cards exclude reporter/account identifiers, contact details, private object paths, storage position and pickup credentials. Reasons can reflect private report clues, so this staff response must never be reused directly in attendee/public notices.
- No Smart Tag tables, scan/registration/ownership/payment functions, campus item tables, campus matching jobs, notification tables or email services are used. No new report associations or match records are saved.
- Suggestions cannot approve a report or claim, notify an owner, reserve/release an item, withdraw a missing report or publish to the hub. Staff review uses the existing audited report actions; ownership/release still use existing event claim safeguards.

The reporting migration is required. Matching remains usable before the separate recovery migration; its queries omit recovery-only columns until that migration is recorded as installed. This work did not recheck or change hosted migration status.

## Manual acceptance

- [ ] Create a missing/found pair in one current event with compatible details and valid chronology. Compare from each direction; check scores, explanations and Manila dates.
- [ ] Create a similar pair in another event. Neither pair must appear across event boundaries, campus matching or Smart Tag workflows.
- [ ] Test hidden, withdrawn, released and same-reporter candidates. Test a found timestamp earlier than the missing timestamp; matching category/location alone must not create a strong suggestion.
- [ ] Compare as manager and desk staff. Open the original private report, inspect its photo, add a permitted note and confirm desk staff cannot moderate.
- [ ] Open the found report's claims panel. Confirm suggestions do not create claims, bypass ownership checks or release items. Existing release must remove that found report from refreshed suggestions.
- [ ] Test an unassigned account/global admin, another event's IDs, revoked/expired membership, suspended account, revoked session and closed/deleted event. No suggestions should be returned.
- [ ] Check empty results, report-page navigation, older/newer candidates and four-card shortlist navigation. On phones, change the source through the collapsed chooser and check modal/layout behavior.
- [ ] Verify refresh after moderation/withdrawal/release. Review original records again before any action because suggestions are read-time recommendations, not locks or reservations.
- [ ] Confirm the reporting-only/missing-reporting-setup behavior. Exercise normal campus matching, Smart Tag scans/registration and event QR sharing as regressions.

Evidence: 1,166 socket-blocked offline backend tests pass, including 15 event matching/authorization tests. Eighteen synthetic browser cases pass using data produced by the actual service against in-memory rows. The user production build passes; TypeScript remains at the existing 108-error baseline. Three Python files compile; source/diff formatting checks pass. Hosted/manual acceptance remains pending. Earlier SQL/QR/recovery results remain historical evidence; no SQL checks were needed for this read-only addition.

## Next roadmap step

After acceptance, add private event attendee alerts with explicit recipient ownership, event scope, safe generic content, current-report rechecks, duplicate suppression and resolution/withdrawal handling. Persistent notices may need a separate user-run migration; do not reuse campus notification foreign keys or email hooks without a reviewed event design. Main-hub publish/unpublish and closing/custody exports remain later Phase 5 work. Event Smart Tags and paid rentals retain their separate roadmap phases.

Follow-up (2026-11-18): reviewed in-app notices are now implemented locally; see [event alerts checkpoint](EVENT_ALERTS_CHECKPOINT.md). Possible matches optionally shows manager notify controls and pair sent-state only after the new migration is installed. Scoring itself remains read-only and sending is an explicit separate action. The new migration is pending user execution; this earlier matching milestone's verification record remains historical.
