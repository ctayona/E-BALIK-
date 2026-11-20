# E-Balik Events and Rentals Roadmap — Version 1

Date: 2026-11-15 (Asia/Singapore)
Status updated 2026-11-20: University-pilot software is implemented locally; Nov 19 read-only verification confirmed all seven event migrations user-applied. The Nov 19–20 regression/design review passes; see EVENT_PILOT_TEST_REVIEW.md. Real-account acceptance and actual pilot operation remain pending. Checked implementation items do not imply operational sign-off. See EVENT_PROGRESS.md and EVENT_PILOT_COMPLETION.md for current evidence. Later commercial phases are not complete; dated checkpoints below preserve their historical migration status.

## 1. Objective and operating rule

Add an optional, branded event lost-and-found service to E-Balik while preserving the University of Makati campus experience. Organizers can rent an event workspace, assign staff, offer event-specific reporting and recovery, optionally issue Smart Tags, and receive a closing summary.

No substantial extension can guarantee zero regressions. Release depends on demonstrated compatibility, event isolation, controlled deployment, and a recovery plan. If a gate fails, stop that release and correct the issue before continuing.

Codex prepares local code, tests, documentation, and migration files. Supabase access remains strictly read-only for Codex. The user applies all migrations and operates any live write workflows. Staging writes and deployment actions require explicit authorization; this roadmap does not authorize them.

## 2. Agreed product boundaries

- Events have dedicated attendee and staff panels within the existing application.
- Event reports remain event-only by default.
- An authorized E-Balik administrator may publish a safe representation to the main hub. The original report, claim, and custody history remain single records.
- Publishing does not transfer physical custody, grant organizer access to campus data, or automatically expand matching.
- Event managers and desk staff receive event-specific permissions, never general administrator privileges as a shortcut.
- Event branding affects only that event. Campus branding and behavior remain intact.
- Attendees are not charged for reporting or claiming. Rental charges are paid by the organizer.
- A found report and physical receipt at a desk are separate milestones.
- An event's operating period, recovery period, staff access period, and data retention policy are separate settings.
- No automatic auctioning, deletion, main-hub publication, or Smart Tag ownership reset when an event ends.

## 3. Delivery scope

| Release | Included | Excluded until a later release |
|---|---|---|
| Internal pilot | Admin-created events, basic branding, QR portal, assigned existing staff/users, event reports, desk intake, claims/releases, explicit hub publication, closing summary | External self-service onboarding, rental billing, event tag registration, custom domains |
| Event service | Approved branding templates, event tag batches, visitor access, organizer onboarding, reliable recovery/closure workflow | Arbitrary page builder, SMS, offline synchronization |
| Paid rentals | Packages/quotations, booking confirmation, one full payment per booking, payment receipt/reversal, event revenue reporting | Deposits, installments, subscriptions, automatic card checkout |
| Expansion | Repeat-event setup, supported add-ons and organizer improvements justified by pilots | Features without demonstrated demand |

The internal pilot is not the complete commercial release. A paid external event must pass the visitor, closure, billing, and operational gates first.

## 4. Target experience

### E-Balik administrator

Events → Create → Details → Appearance → Staff → Recovery rules → Preview → Publish.

Manage event status, organizer details, feature availability, publication requests, and closing tasks. Only an authorized E-Balik administrator can approve main-hub visibility or access across events.

### Attendee

Scan event QR → event home → report missing/found item or browse event items → receive a possible match → submit ownership evidence → collect after approval → view release receipt.

Public browsing exposes safe details only. Staff-assisted reporting is the initial fallback for visitors. Existing campus account verification remains unchanged; external self-service requires its own reviewed event participation rules before release.

### Event staff

Open assigned event → review reports → record physical receipt and storage position → review claims if authorized → release through the approved handover flow → record closing custody transfers.

### Organizer

Review event statistics, authorized staff, allocated tags, booking/payment status, and closing export. Organizer access never includes unrelated accounts, campus finances, campus reports, or other events.

## 5. Architecture and data decisions

These are proposed designs, not verified live table names or committed API contracts. Confirm exact schema, constraints, and owning implementations during Phase 0/1.

### Module placement

Follow existing page ownership: new event pages under Users/Frontend and Admin/Frontend; matching page route modules under Users/Backend and Admin/Backend; shared event permission/scope services in Server/app/utils. Register new Flask blueprints through Server/app/blueprints.py.

Use a dedicated event URL such as /events/<slug>. Add only the necessary entry handling and hosting rewrite; preserve existing /admin, /tag, public-share, authentication, and campus navigation behavior. Do not introduce a whole-app routing rewrite for this feature.

### Proposed records

| Concept | Responsibility |
|---|---|
| Event | Stable ID, unique slug, organizer, venue, schedule, recovery deadline, status, feature settings |
| Event branding | Validated colors, template choice, logo/banner references, draft/published versions |
| Event membership | Account, event, permitted actions, access start/end, revocation |
| Event report association | Optional event association on existing report records, if compatibility review confirms this approach |
| Event desk | Receipt location, opening hours, storage positions, custody transfer destination |
| Hub publication | Report reference, public projection, approved audience, consent, publisher, publication/revocation timestamps |
| Event tag allocation | Link event to tag batches and applicable recovery instructions |
| Rental booking | Organizer, package, agreed quote snapshot, service dates, status, terms, payment reference |

Prefer reusing existing report/claim/custody logic where it can enforce event permissions safely. Adding an event_id alone is insufficient. If the shared-table approach cannot satisfy isolation, revise the architecture before implementation rather than accept leaking legacy queries.

### Mandatory invariants

1. An existing report without an event association remains a campus report. Do not reclassify existing data automatically.
2. Campus queries explicitly select campus records plus approved safe hub publications; absence of a filter is not a campus scope.
3. Event queries validate event membership or approved public access before reading or changing records.
4. The server verifies scope on list/detail/create/update/delete, claim, release, media, export, receipt, notification, and bulk paths. A browser-supplied event ID is only a selector.
5. A claim derives its scope from its report. Any stored duplicate scope must be constrained to agree. Linked missing/found reports must belong to the same scope unless an explicit reviewed transfer workflow exists.
6. Normal edits cannot silently move records between events or between an event and campus.
7. Authentication, account verification, and event permission checks are separate concerns. Event staff permission must not grant a global guard/admin role.
8. Audit server-side service-key paths and database RPCs as well as RLS. Existing privileged access may bypass RLS.
9. Event evidence and private photos require authorized delivery. Guessable links or public buckets cannot provide event privacy. Use event-aware private object paths and expiring signed access where needed.
10. Publication exposes an allow-list of safe fields, not the full report. Validate consent and media visibility; unpublishing cannot retract already downloaded public copies.
11. A public hub viewer can enter the report's event claim flow without receiving broader event access.
12. Matching, alerts, feeds, caches, analytics, jobs, receipts, and exports carry scope consistently. Default matching stays within the report's scope even when the report is hub-published.
13. Unclaimed event items are excluded from campus auction eligibility and its RPCs unless a separately approved policy and transfer workflow is implemented.
14. Financial history stays append-only; refunds/reversals add entries. No destructive ledger edits or disabling of the installed ledger protection triggers.

## 6. Customization design

Provide settings and approved templates, with separate draft and published appearance. Do not allow arbitrary scripts, HTML, or CSS.

- Identity: event title, organizer name, logo, banner, safe welcome text.
- Appearance: primary/accent/background colors, readable text colors, controlled font choices and template presets.
- Content: collection desk instructions, hours, venue image, contact route, and announcements.
- Features: approved toggles for reporting, browsing, tags, and announcements. Feature toggles never override permissions or privacy rules.
- Preview: phone/desktop views, empty states, validation errors, and default restoration.
- Publishing: atomically publish validated settings so attendees do not see half-saved branding.

Apply validated CSS variables within the event root. Existing components with hard-coded navy/gold values need targeted variants; do not replace global theme tokens. Verify contrast, keyboard focus, long names, image cropping, and mobile layout. Confirm existing dark-mode behavior and define event light/dark support explicitly.

Validate upload type and size, strip unwanted metadata where appropriate, clean up abandoned drafts safely, and define banner/logo public visibility separately from private claim evidence.

## 7. Phase roadmap and acceptance gates

### Phase 0 — Establish baseline and dependency map

Owner: Codex prepares evidence; user reviews any environment limitations.

- [x] Record current branch/commit and existing user changes; isolate feature work without resetting them.
- [x] Recheck root/nested instructions and relevant manifests, CI, routes, SQL functions, storage policies, and tests for the university pilot.
- [x] Relevant live metadata was verified read-only: event migrations through pilot completion on Nov 19; existing ledger-lock verification is recorded in codex.md. Recheck when schema changes.
- [x] Record the university-pilot integration inventory for campus queries/jobs, tags/auctions, matching, receipts, backup/restore, recycle bin and exports in EVENT_PILOT_COMPLETION.md; later commercial integrations need their own review.
- [x] Confirm tests cannot access live database/storage/email; capture baseline builds, type checks, backend tests, and known failures. See EVENT_RENTALS_BASELINE.md; toolchain caveats remain recorded.
- [x] Define the selected university-pilot scope and real-account acceptance checklist in EVENT_PILOT_COMPLETION.md.
- [ ] Name the responsible event operator and record the human go/no-go decision.

Gate: a reproducible baseline and completed dependency inventory. Historical audit test counts are not current results.

### Phase 1 — Specify rules and permissions

- [x] Finalize the university-pilot event/membership/report/publication design against real code; separate tables and safe hub projections are recorded in the checkpoints.
- [x] Write the pilot action matrix; anonymous/external self-service remains excluded. See EVENT_PILOT_COMPLETION.md.
- [x] University pilot: super admins create/manage event workspaces; assigned managers and desk staff have event-only operational permissions.
- [x] Define event states: draft → scheduled → active → recovery → closed → archived; cancellation is explicit and preserves records.
- [x] Define pilot state transitions, Manila schedules, assignment expiry, claim deadlines, acknowledged closing custody and conservative archive/retention rules. See EVENT_PILOT_COMPLETION.md.
- [x] Define separate owner permission and explicit super-admin hub publication for the pilot.
- [ ] Define event tag behavior after recovery ends in Phase 7; campus tags remain separate.
- [x] Decide internal-pilot visitor fallback: staff-assisted reports using existing accounts; external self-service remains a separate later gate.
- [ ] Define request/image quotas and shared infrastructure limits so one event cannot exhaust campus service capacity.

Gate: written rules resolve privacy, ownership, physical custody, and permission questions. No UI implementation should invent these rules independently.

### Phase 2 — Additive migrations and compatibility protection

- [x] Prepare additive pilot migration files locally using repository naming conventions; keep previously applied migrations intact.
- [x] Add separate event/membership/branding/report/claim/alert/publication/closing structures, preserving existing campus IDs and relationships.
- [x] Inspect relevant constraints, foreign keys, indexes, RLS and scoped RPCs; document isolated compatibility evidence in the pilot handoff.
- [ ] Review lock duration, index creation strategy, backfill cost, and compatibility against expected data volume.
- [ ] Include preflight SELECT checks, rerun behavior, migration-log recording, verification queries, and a data-preserving recovery procedure.
- [x] Verify all seven event migrations in disposable PostgreSQL with synthetic scope/claim/custody fixtures and campus sentinel records: 395 checks pass. The full offline backend regression also covers existing campus/tag/auction behavior; this is not live-hosted acceptance.
- [x] User-applied foundation through pilot completion migrations verified read-only, most recently 2026-11-19; no Codex database writes.
- [ ] Keep event creation/data writes disabled until every serving application instance enforces the new scope boundaries.

Gate: schema changes preserve campus fixtures and compatibility tests pass. Missing event schema disables only the event module with an actionable setup message; it must not break campus startup.

### Phase 3 — Scope-aware backend and event access

- [x] Implement server-verified event scope, fresh membership/account checks and deny-by-default permissions for the pilot.
- [x] Add event configuration, membership and state-transition endpoints.
- [x] Enforce pilot scope through separate event services/RPCs and safe public projections; update restore ordering and preserve existing campus query/job contracts. The compatibility inventory documents the deliberate separation.
- [x] Define fresh revocation/access checks on protected operations and event-link visibility guards.
- [x] Add private event media authorization and safe public projections.
- [x] Preserve existing campus request/response contracts; retain explicit backend-module and per-event portal controls. Local module enablement does not bypass portal/state/account checks.

Gate: automated direct-API isolation tests pass, including forged event IDs, stale sessions, cross-event object references, and disabled-feature paths. Campus regression tests remain at baseline or better.

### Phase 4 — Event setup, branding, and preview

- [x] Add Events admin navigation and setup/detail screens without replacing existing pages.
- [x] Implement saved draft branding, validated palettes, responsive previews and explicit attendee portal enablement within the existing lifecycle.
- [x] Add event URL handling, public portal shell, QR generation, and collection-desk details.
- [x] Automated portal/feed tests deny draft, scheduled, paused, expired and private event data; owner history remains separately authorized. Repeat with real accounts during acceptance.
- [ ] Verify one event's colors, fonts, content, and images do not affect another event or campus pages.

Gate: mobile/desktop and accessibility checks pass; existing entry paths still work; no event records leak through global lists.

### Phase 5 — Pilot lost-and-found operations

- [x] Implement event missing/found reports and event-only matching/alerts locally.
- [x] Implement desk intake, storage position, acknowledged closing custody, claims, authorized release and receipts locally.
- [x] Preserve private ownership clues, multipart uploads, confirmation dialogs, rate limits and server-controlled lifecycle transitions in the pilot implementation.
- [x] Implement explicit administrator publish/unpublish with separate owner consent, safe previews, audit records and one underlying event report.
- [x] Implement recovery mode, final instructions, unresolved register, closing export and guarded final sign-off locally.
- [x] Test attendee, finder, desk operator, administrator and manager/organizer journeys with synthetic fixtures; real-account acceptance remains pending.

Gate: a full lost → found → received → claimed → released scenario passes, including hub publication and revocation, without granting cross-event access. Campus controls pass again after integration.

### Phase 6 — Controlled internal pilot

- [ ] Enable only one approved internal event after user-operated migration and deployment checks.
- [ ] Train staff; provide desk instructions, escalation contact, and a manual intake fallback.
- [ ] Monitor failed uploads, response errors, email delivery, unexpected access denials, infrastructure usage, and campus health.
- [ ] Record setup/support effort, recovery outcomes, staff feedback, and organizer willingness to pay. Define which reports are included in each metric.
- [ ] Complete recovery and closing handover before considering the pilot finished.

Gate: no unresolved critical access/data integrity defects, acceptable campus performance, successful closure, and documented fixes. A demo alone does not satisfy this gate.

### Phase 7 — Event Smart Tags and external participation

- [ ] Add event tag allocation/batches while preserving current campus tag behavior.
- [ ] Decide whether existing permanent tags can participate without transferring ownership; event coverage and tag lifetime are distinct.
- [ ] Support approved registration, owner privacy choices, scan instructions, event-scoped auto-posting, and notification links.
- [ ] Define expiry/recovery behavior, batch counts, unsold tags, and ownership protection on any future reuse.
- [ ] Implement reviewed visitor onboarding, email verification/recovery, and private tracking for external events without weakening campus authentication.
- [ ] Establish organizer invitations, event-specific roles, access expiry, and support procedures.

Gate: campus tag registration/scan/renewal still works; event scans and auto-created reports remain correctly scoped; external users cannot reach campus or other-event private data.

### Phase 8 — Rental booking and financial integration

- [ ] Add organizer details, package/quote snapshot, agreed dates, included tags/support, cancellation terms, and booking states.
- [ ] Keep booking/payment status separate from the event operating state; free pilots and authorized exceptions are explicit.
- [ ] Initial scope: one full payment per booking. Defer deposits/installments until their ledger allocation and reconciliation model is designed.
- [ ] Extend backend payment sources, ledger constraints, receipt numbering/verification, proof review, reversals, exports, monthly reports, and admin totals explicitly for event rentals.
- [ ] Store agreed prices server-side; never trust browser totals. Prevent duplicate confirmation and concurrent double recording.
- [ ] Define package inclusions so bundled tag fees are not charged or counted twice.
- [ ] Test cancelled bookings, refunded bookings, disabled events, payment-proof privacy, and correct revenue categorization.
- [ ] Preserve auction sales, seller commissions/payouts, Smart Tag payments, MFA reversal requirements, and append-only ledger protection.

Gate: booking → payment → receipt → reporting → reversal is reconciled in isolated tests; all existing financial tests pass. Confirm organizer-facing document wording and operational obligations before commercial release; no tax/compliance status is assumed by this roadmap.

### Phase 9 — Commercial launch and maintenance

- [ ] Set packages from measured costs and organizer feedback; do not invent market demand or guaranteed revenue.
- [ ] Agree service limits, support hours, physical custody responsibilities, recovery deadlines, and information retention with each organizer.
- [ ] Verify backups and restore coverage for new data and media; do not perform a live restore as a test.
- [ ] Roll out to a small approved organizer group, then expand based on observed reliability and support capacity.
- [ ] Publish operator/attendee guides and incident procedures; schedule reviews of expired access and unresolved custody.
- [ ] Add repeat-event templates and further customization only when validated by use.

Gate: documented ownership of operations, support, billing, recovery, and security; successful acceptance evidence; user-approved production rollout.

## 8. Regression and acceptance matrix

| Area | Required evidence |
|---|---|
| Campus access | Existing login, OTP, MFA, verification, role access, session, and page-lock behavior preserved |
| Campus reports | Create/edit/delete/upload, own-report access, public browsing, status rules, and confirmations preserved |
| Campus matching | Existing results preserved for campus fixtures; event reports excluded from campus matching by default |
| Event isolation | Event A cannot list, fetch, mutate, claim, export, scan private media for, or receive notices about Event B |
| Anonymous access | Only published safe content; no draft events, reporter identities, private clues, claimant evidence, or private files |
| Permissions | Direct API and RPC calls enforce membership; expiry/revocation takes effect; organizer never becomes global admin |
| Custody and claims | Physical receipt, concurrent claims/releases, PIN limits, status transitions, receipts, and closing transfer remain consistent |
| Hub publication | Default event-only; authorized and consented publishing; no duplicate records; safe revocation; correct claim destination |
| Tags | Campus tag behavior preserved; event batch/scan/expiry/auto-post scope correct |
| Auctions and finance | Event items excluded from campus eligibility; bids, buyout, payments, ledger locks, commissions/payouts and reversals preserved |
| Background work | Matching alerts, reminders, retention, cleanup, and scheduled auction operations respect event lifecycle and scope |
| Branding/routes | No theme bleed; event/admin/tag/share links and refresh behavior work; accessible mobile layouts |
| Operations | Feature disabled, missing event schema, notification failure, quotas, closure, backup/restore order and recovery procedures covered |

Run meaningful concurrency/constraint tests on an isolated Postgres environment where in-memory test doubles cannot establish correctness. Use synthetic accounts/data. Live production writes are not part of Codex verification.

## 9. Verification commands and evidence

Confirm installed dependencies and the CI definitions before running. From the repository root, the currently documented frontend checks are:

```powershell
npm run build
npm run build:admin
npm run typecheck:user
npm run typecheck:admin
node scripts/check-text-guard-parity.mjs
```

For isolated backend verification, after confirming the selected Python interpreter and test isolation, run from Server:

```powershell
$env:EBALIK_TESTING = '1'
$env:PYTHONDONTWRITEBYTECODE = '1'
python -m unittest discover -s tests -p 'test_*.py'
```

Use an existing environment with the required dependencies. Inspect any additional event tests for isolation before running them. Do not launch the normal app, scheduler, cron endpoint, production migrations, email tests, or database setup/restore scripts merely to establish a baseline.

Run targeted tests during development and the full compatibility suite at integration/release gates. Record command, environment, outcome, known failures, and untested cases. The checked-in user type-check baseline was 108 during the handoff; recheck it and never raise it to hide new errors. Historical passing test counts are not release evidence.

## 10. Deployment, disablement, and recovery

1. Prepare and review migrations, compatibility changes, preflight SELECT checks, and the baseline evidence.
2. Confirm a user-managed recoverable backup and authorized staging verification. Restore recovery is a last resort because it can discard newer valid activity.
3. User applies additive schema changes. Verify metadata read-only; keep event creation disabled.
4. Deploy scope-aware compatibility code to every serving instance, including jobs/workers. Confirm old instances cannot read new event data. Repeat campus checks.
5. Enable one approved event only after the scope/isolation gate passes.
6. Define separate controls for new bookings, new reports, event staff writes, and public portal availability. During an incident, disable affected writes while retaining safe recovery instructions where possible.
7. On unauthorized disclosure, financial corruption, or campus regression, contain the affected feature, preserve audit evidence, and follow the incident procedure before reopening.
8. After event data exists, rollback only to a release that understands event scope. Never redeploy an old unfiltered campus build against those records.
9. Prefer disabling the module and fixing forward while retaining data. Do not drop event tables/columns or delete reports as an emergency rollback.
10. Feature switches reduce exposure but do not replace query isolation, authorization, schema compatibility, or tests.

## 11. Tracking and completion rules

| Milestone | Current state | Evidence required |
|---|---|---|
| Roadmap | University-pilot scope selected; later commercial phases retained | EVENT_PROGRESS.md is the current status summary |
| Baseline | Pilot integration inventory and automated evidence recorded | Node 22 release verification and real-account acceptance remain open |
| Architecture/permissions | Pilot scopes and permissions implemented locally | See permission matrix and boundaries in EVENT_PILOT_COMPLETION.md |
| Schema and isolation | All seven event migrations verified user-applied; service-only pilot metadata checked Nov 19 | Isolated SQL evidence plus real-account acceptance still required before operational sign-off |
| Internal pilot | Software/operator tools prepared; actual operation not started | Staff briefing, monitored event and completed recovery/closure |
| Tags/external users | Not started | Scoped tags and visitor/staff acceptance checks |
| Paid rentals | Not started | Reconciled financial integration and operational readiness |
| Commercial release | Not started | Pilot evidence and user-approved rollout |

Implement one phase or small reviewable slice at a time. For each slice, record scope, files, migration dependency, current checks, known limitations, and next gate. Append a daily prompt/edit/database audit. Do not label a phase complete because the UI exists or a build passes.

## 12. Repository evidence and maintenance

This roadmap was grounded in local files inspected during the planning conversation:

- codex.md and AGENTS.md: workflow, read-only Supabase access, audit and verification rules.
- PROJECT_CONTEXT.md: architecture and workflows; confirm exact behavior in owning code when implementing.
- Users/Frontend/src/app/App.tsx and vercel.json: existing entry paths and hosting rewrites.
- Users/Frontend/src/styles/theme.css: campus theme tokens and dark-mode mechanism.
- Server/app/blueprints.py: backend module registration.
- Admin/Backend/shared/admin_access.py and Server/app/utils/access_control.py: current global role/page permission model; event membership is proposed new work.
- Server/app/utils/match_alerts.py: current matching reads need scope review.
- Server/app/utils/smart_tags.py: existing registration, owner/privacy, batch, and report integrations.
- Server/app/utils/payments.py: currently payable sources are auction and smart_tag; event rental support does not exist yet.
- Server/manual_migrations/20261022_income_ledger.sql and 20261026_income_ledger_lock.sql: ledger source constraints and append-only protection.
- .github/workflows/ci.yml: existing verification commands and isolated test configuration.
- Audits/2026-11-15_Audit.md: handoff, migration verification, and planning record.

Keep this roadmap in the repository as engineering guidance. Update its status and decisions when implementation evidence changes; do not copy private organizer information or secrets into it.

## 13. Foundation progress (2026-11-15)

Implemented a draft-only backend on feature/event-foundation. See [foundation handoff](EVENT_FOUNDATION_IMPLEMENTATION.md) for decisions, migration steps, current limits, and schema consistency. The migration has 25 isolated Postgres checks; 1,057 backend tests pass with network connections blocked. No frontend changes or public event operation yet. Phase 0 full integration inventory/Node 22 release verification and later operational phase gates remain open. This foundation does not modify campus report associations. No migration was run remotely.

## 14. Local admin draft panel (2026-11-15)

Foundation migration verified applied using read-only metadata. Admin Events draft setup and color/template preview added locally; see EVENT_LOCAL_TESTING.md for testing. No new migration, public event panel, report integration, asset upload or publishing. Phase 4 remains partial. User requires no commits, pushes or deployments.

## 15. Campus event studio follow-up (2026-11-15)

Existing campus venues enforced server-side; event references auto-generated from names; premium scoped theme presets and reusable preview shell added. Staff assignment/list/revocation APIs added for super admins with active-account and expiry checks; staff UI and operational access enforcement remain pending. No new migration or public reporting enabled. Detailed evidence is in EVENT_FOUNDATION_IMPLEMENTATION.md section 8.

## 16. Event setup checkpoint handoff (2026-11-15)

Staff-management UI and private logo/banner customization implemented locally. New 20261115b_event_brand_assets.sql migration is prepared for user execution and isolated-tested; not applied by Codex. Checkpoint code is ready for review, but migration verification and user acceptance are pending. See EVENT_SETUP_CHECKPOINT.md. This is not a completion claim for event publication, operational staff access, reporting or rentals.

## 17. Readiness, lifecycle and staff access (2026-11-16)

The next local slice adds the sixth Review tab, readiness checks, explicit internal event state changes with atomic history/version checks, and fresh membership/account/session authorization for a read-only `/event-desk` workspace. See [lifecycle handoff](EVENT_LIFECYCLE_CHECKPOINT.md) for the state graph, migration safety and acceptance checklist. `20261116_event_lifecycle.sql` is pending user execution. Public reporting, operational item handling, campus hub promotion, claims and paid rentals are not enabled. The earlier foundation/artwork migrations are user-applied; no remote writes, commits, pushes or deployments were performed by Codex.

## 18. Event-only reporting and intake (2026-11-16)

Lifecycle migration is now verified user-applied. The next local milestone implements a branded `/events/<slug>` attendee page, explicit admin portal open/pause, verified-account missing/found submissions with stored generic-listing consent and private images, moderated event-only listings, own-report tracking/withdrawal, and assigned staff review/intake/storage/private notes. `20261116b_event_reports.sql` is pending user execution. Architecture uses separate event report/history tables after reviewing the campus query/job/storage boundaries; it does not add partially scoped rows to legacy campus tables. See [reporting checkpoint](EVENT_REPORTING_CHECKPOINT.md) for migration safety, scope inventory and manual acceptance. Claims/releases, matching/alerts, main-hub publication, closure exports and paid rentals remain future gated work. All changes are local and uncommitted; no remote writes or deployment performed.

## 19. Ownership and workspace management checkpoint (2026-11-16)

Reporting migration is verified user-applied. Local implementation now includes private ownership claims/proof, manager approval/rejection after physical receipt, claimant-only pickup codes, verified atomic physical release, private printable receipts with minimal public verification, saved-draft editing, workspace filters, archival and recoverable deletion/restore. New `20261116c_event_recovery.sql` is pending user execution. Deletion preserves all records and is blocked by unreleased custody; terminal states invalidate open pickup claims. See [recovery checkpoint](EVENT_RECOVERY_CHECKPOINT.md) for migration safety, permissions, evidence and manual acceptance. Matching, main-hub promotion, custody transfer/exports, tags and paid rentals remain gated.

## 20. Event entry QR checkpoint (2026-11-16)

Canonical event links, QR PNG downloads and branded printable A4 posters are implemented locally in Admin Review. The read-only sharing endpoint uses the existing attendee website origin and saved event metadata, enforces super-admin access and current portal readiness, and requires no migration. It does not use Smart Tag records/scans, tag allocation or ownership, handover PIN QR encoders, campus listings or financial workflows. Browser tests decode exact event URLs and verify isolated one-page printing, current access checks and phone layout. See [QR checkpoint](EVENT_QR_CHECKPOINT.md) for manual acceptance. The next feature after acceptance is event-only matching/notifications; explicit hub promotion and closure/custody exports remain later Phase 5 work.

## 21. Staff event matching checkpoint (2026-11-16)

The Phase 5 staff matching step is implemented locally: event-only missing/found suggestions, similarity components/reasons/conflicts, report-review shortcuts and existing found-report claim navigation. It reuses only the pure existing scorer; campus queries/jobs/alerts and Smart Tags are unchanged. No migration or stored match associations are introduced. Each request scans at most 100 same-event candidate reports and returns up to 12 qualifying suggestions; the UI shows four per view and supports older candidates. See [matching checkpoint](EVENT_MATCHING_CHECKPOINT.md) for eligibility, authorization, limits and acceptance. Attendee alerts remain the next separate step, requiring reviewed recipient scope, privacy, duplicate suppression and resolution rules before persistence/email integration. Hub publish/unpublish and closure exports remain later Phase 5 work.

## 22. Private event alerts checkpoint (2026-11-18)

Manager-reviewed event in-app notices are implemented locally with an exact generic preview, owner-derived recipient, current report/version checks, lifetime pair deduplication, rolling quotas and atomic audit history. Attendees have an event-only Alerts inbox/unread badge, read/dismiss/All views and a connection to the existing private ownership form/My claims. Withdrawal/hide/release and terminal event changes invalidate notices; unavailable reads suppress listing/actions without writing. Recovery is verified user-applied; `20261117_event_match_alerts.sql` remains pending user execution. See [alerts checkpoint](EVENT_ALERTS_CHECKPOINT.md) for the additive schema, permissions, restore rules, verification and manual checklist. Campus bell/email/Smart Tags/financial flows are unchanged. Automated evidence is 1,190 offline backend tests, 85 ephemeral PostgreSQL checks and 24 synthetic browser cases, plus user build/types at the existing baseline. Phase 5 is still gated on hosted/manual acceptance, explicit hub publish/unpublish and closure/custody exports; this is not a commercial-release signoff.

## 23. University pilot code completion (2026-11-18)

The user selected completion of the university pilot first. Remaining local software is now implemented: separate owner hub consent, administrator preview/publish/unpublish, an event-publications tab preserving existing campus Browse APIs/IDs, original-event claim links, manager summaries/private ZIP exports, final attendee recovery instructions, dual-account office custody handovers, unresolved registers and immutable closing sign-off. Alerts are now verified user-applied. `20261118_event_pilot_completion.sql` adds five event-only tables, six service-only invoker functions and seven lifecycle/custody guards without replacing legacy functions or changing campus schemas/storage. It remains pending user execution. See [complete pilot implementation and one full acceptance run](EVENT_PILOT_COMPLETION.md) for permissions, limits, compatibility review, safe migration verification and testing. Evidence: 1,214 offline backend tests, 101 ephemeral PostgreSQL checks, 30 new plus 42 rerun synthetic browser cases, both builds and type checks (user baseline 108). Phase 5 software is ready for user migration/acceptance; Phase 6 still requires an actual operator, staff briefing and monitored event/recovery/closing. Node 22 release verification and later visitor/tag/billing/commercial gates remain open. No live writes, commits, pushes or deployment.

## 24. Internal pilot operator tools (2026-11-18)

Phase 6 preparation now includes a shared in-app operator guide in Admin Review and the assigned event desk, chapter navigation, permitted-workflow shortcuts, an escaped offline HTML desk pack with blank manual intake/reconciliation sheets, and next-action guidance from existing operations snapshots. Custody/closing shortcuts reuse the existing panels and mutation paths; managers receive read-only guidance. No new permissions, routes, migrations, local report storage or campus Smart Tag/payment behavior. Eight offline Node checks, 12 operator plus 30 pilot synthetic browser cases, three-page A4 sample printing, both builds/admin types and user type baseline 108 pass. The actual staff briefing, migration post-verification, real-account acceptance and monitored pilot are still human-operated gates. Later commercial phases remain outside the selected university pilot scope.

## 25. Draft access and current gates (2026-11-19)

Read-only verification now confirms all seven migrations are recorded as applied, including pilot completion. Its five tables have RLS/no browser grants, six invoker functions deny browser execution and seven guards are enabled. Saved events are present (one draft, two scheduled, one active). The disabled setup was caused by a missing local module flag, now explicitly set in the existing backend environment file; restart the backend before testing. No migration rerun is needed. Setup distinguishes unavailable data from an empty list, offers retry, retains independent successful loads, ignores stale responses and opens saved workspaces for continuation. The full offline backend suite passes 1,215 tests; twelve synthetic draft cases cover recovery, filters, editing and creation. Real-account acceptance, staff briefing and the actual monitored pilot remain the next gates. Public landing and user navigation styling are separate presentation improvements, with no added event permissions or campus integration.
