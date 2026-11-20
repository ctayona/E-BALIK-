# Event Rentals — Current Roadmap Status

Updated: 2026-11-20 (Asia/Singapore). This is the current status summary; earlier handoff notes are historical.

## Implemented university-pilot software

The user selected completion of the university pilot before visitors, event tags or paid bookings. Its local software now includes branded setup/QR, event reports/private images, desk intake/storage, matching/reviewed owner alerts, evidence/claims/pickup/release receipts, separate owner hub permission and administrator publish/unpublish, an event-listings tab in Browse, manager recovery summaries, internal closing ZIP exports, final recovery instructions, acknowledged office custody handovers and immutable closing sign-off. Draft editing, archive and recoverable deletion remain available under existing custody safeguards. See [the complete pilot handoff and test run](EVENT_PILOT_COMPLETION.md). All seven event migrations are verified user-applied; real-account acceptance remains pending. This is implementation completion for the selected pilot scope, not completion of the commercial roadmap or an operational pilot.

## Roadmap comparison

| Phase | Current state | Remaining gate |
|---|---|---|
| 0 — Baseline/dependency map | Current branch/HEAD, baseline and pilot integration boundaries reviewed | Declared Node 22 release verification and user-selected pilot operator/event |
| 1 — Rules/permissions | Pilot action matrix, separate consent, closure/custody/retention rules and limits documented | Staff briefing and later external/commercial policy decisions |
| 2 — Schema/compatibility | All seven event migrations verified user-applied; pilot tables/RLS/functions/triggers/browser restrictions checked read-only Nov 19 | Real-account acceptance; no new migration needed for the draft fix |
| 3 — Event access backend | Scoped reports/claims/media/alerts, hub visibility, summary/export and recipient-only office handovers implemented | Real-account access/isolation acceptance |
| 4 — Setup/branding/preview | Saved branding, explicit portal open/pause, canonical event URL, QR/poster sharing and staff desk implemented locally | Manual/hosted/real-phone acceptance and wider accessibility |
| 5 — Lost-and-found operations | Pilot code complete locally, including explicit hub publication, unresolved register, closing export and acknowledged custody handovers | Full real-account acceptance run |
| 6 — Internal pilot | In-app admin/staff guide, printable desk/fallback pack, snapshot-based next actions and complete acceptance run prepared; actual pilot not started | Selected event/operator, staff briefing, monitored pilot and completed recovery/closure |
| 7 — Tags/external participation | Not started | Event tag allocation/scans, visitor onboarding and privacy/expiry integration |
| 8 — Paid rentals | Not started | Packages, booking, event payment/receipt/reversal source and reconciled revenue |
| 9 — Commercial release | Not started | Acceptance evidence, operational ownership, supported rollout and maintenance |

The report slice deliberately uses separate event tables. Reports/claims/alerts remain event-only even when a safe publication is selected for the hub. Campus Browse APIs and IDs remain unchanged; its event tab reads a separate safe feed and opens the original event flow. Event handovers do not create campus inventory or auction eligibility. See the pilot handoff and earlier reporting inventory for boundaries; external tags, visitors, email and payments remain later gates.

## Current database verification

- 20261115_event_foundation: recorded as applied by the user.
- 20261115b_event_brand_assets: now also recorded as applied by the user.
- event_brand_assets exists; RLS is enabled; browser roles have no table grants; service_role has SELECT/INSERT/UPDATE only.
- Its UUID keys, event/account foreign keys, unique event/kind rule, positive revisions, and event-specific object path constraint are present.
- event-brand-assets exists, private, with 5242880-byte limit and image/webp allow-list.
- This verification read metadata only; no hosted file upload or data mutation was performed by Codex.
- 20261116_event_lifecycle: user-applied and verified read-only on 2026-11-16.
- 20261116b_event_reports: user-applied and verified read-only on 2026-11-16.
- 20261116c_event_recovery: user-applied and verified through read-only metadata in the alerts implementation session; report/release/version columns and event/report scope key are present.
- 20261117_event_match_alerts: user-applied and verified read-only on 2026-11-18; both alert tables have RLS and five alert functions are present.
- 20261118_event_pilot_completion: now verified user-applied on Nov 19. All five pilot tables have RLS, all six invoker functions exist without browser EXECUTE grants, all seven guards are enabled, and browser roles have no pilot-table grants. No remote writes by Codex. Do not rerun this migration.

## Latest recorded automated evidence

- Nov 19–20 regression/design review: 1,215 offline backend tests, 395 disposable PostgreSQL checks across all seven migrations, 15 date/operator utility tests, 161 unique functional browser cases and 64 desktop/mobile light/dark design views pass. Both final builds/admin types pass; user baseline remains 108. Targeted changes to three stylesheets improve event error/setup/portal/hub text contrast without changing handlers. See [review evidence and remaining gates](EVENT_PILOT_TEST_REVIEW.md). Hosted writes were not tested or performed.
- Nov 19 draft-access/presentation follow-up: 1,215 socket-blocked offline backend tests pass, including disabled-module/saved-draft recovery without mutation. Twelve draft, eleven landing and 23 user-navigation synthetic browser cases pass. Both builds/admin types pass; user type baseline remains 108. Local config import reads the event flag as true without starting the application. [Current audit](../Audits/2026-11-19_Audit.md) records scope and limitations; earlier milestone evidence below is historical.
- Operator-tool follow-up: eight offline Node checks, 12 new guide/navigation browser cases plus 30 pilot regression cases, and a three-page A4 sample desk pack pass. Both builds/admin types pass; user type baseline remains 108. No backend/SQL changes or reruns in this follow-up; the counts below are from the earlier pilot implementation milestone.
- 1,214 offline backend tests pass with dummy credentials and sockets blocked on 2026-11-18, including 23 pilot service/route tests and new restore preservation coverage. Nine changed Python files compile.
- Both production builds and admin type checking pass for this milestone. User type checking retains its existing 108-error baseline. Current environment uses Node 24; declared Node 22 release verification remains pending.
- 101 current pilot migration/RPC checks pass in ephemeral PostgreSQL: dependencies/reruns, RLS/grants/invoker functions/indexed foreign keys, separate owner consent, publication/snapshot freshness, transactional audit rollback, original intake/claim/release with alert/hub invalidation, custody acknowledgements and closing guards.
- 30 new synthetic pilot browser cases plus reruns of all 24 alert and 18 matching cases pass: 72 desktop/phone browser cases. These cover actual SQL snapshots/fake APIs, original hub claim flow, campus Browse compatibility, consent, handovers, sign-off and absent-schema behavior.
- Earlier alert migration evidence is 85 isolated checks; earlier recovery, QR and reporting evidence below is historical.
- 70 recovery migration/RPC checks passed, including atomic release rollback and account anonymization. 52 reporting migration/RPC checks previously passed on isolated Postgres; earlier lifecycle/foundation/artwork evidence is 44/25/18 checks.
- 14 earlier event-sharing browser cases pass, including real QR decoding, fresh-state export checks and isolated printing; normal/long-title A4 PDFs are one page.
- 17 earlier synthetic desktop/phone recovery checks pass for claim submission, manager review, wrong/correct pickup code, staff restrictions, owner code replacement, receipts and draft edit/archive/delete/restore. Earlier reporting browser checks remain historical evidence. Manual authenticated/hosted acceptance is pending.

## Constraints followed

All work remains on feature/event-foundation, local and uncommitted. No commit/push/deployment was performed. Codex uses Supabase read-only; the user executes migrations. Existing unrelated changes remain preserved. New tables follow the project's naming/key/timestamp conventions; schema additions avoid changes to campus reports, payment records and existing storage bucket settings. Runtime mutations use the existing activity audit helper and daily prompt/edit/migration/test audits are appended.

## Next action

Restart the local backend to load the persistent event-module flag, refresh the admin app, then use EVENT_PILOT_COMPLETION.md for one complete real-account acceptance run. All seven event migrations are already applied; no SQL rerun is needed. Record results before operating a real university pilot. Visitors, separate event tags and paid bookings remain outside the selected pilot scope; their later roadmap phases are not complete.

The operator tools and draft-access fix add no migration. Use Review → Open operator guide and Event desk → Staff guide to brief the team and download the printable desk pack. Nov 19 read-only verification confirms saved workspaces still exist, including a non-deleted draft; the missing local event-module flag caused the unavailable screen.
