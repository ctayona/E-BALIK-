# Codex Constraints — E-Balik (UMak Lost & Found)

## 1. Token Efficiency (Non-Negotiable)
- **Surgical edits only.** Use search-and-replace or targeted diffs. Never rewrite entire files.
- **Grep before reading.** Before opening any file, grep for the exact symbol/section you need. Use line-range reads, not whole-file reads.
- **Never guess.** Never assume API endpoints, props, or DB columns. Verify with grep or a targeted file read first.
- **No filler.** Skip pleasantries, prompt restatements, and explanation paragraphs. Deliver code directly.
- **Complete code only.** No `// rest of code` placeholders. Every implementation must be production-ready.

## 2. Project Context — Read Only What You Need
**Do NOT read PROJECT_CONTEXT.md or database_schema.sql in full.** They are very large. Instead:
- To find architecture, routing, or endpoints → `grep` PROJECT_CONTEXT.md for the specific section heading.
- To find a DB table → use the Supabase MCP tool to inspect the live table directly, or grep database_schema.sql for the table name only.
- To find styling tokens → grep `Users/Frontend/src/styles/theme.css` for the token name.
- Read a full file **only** if the task touches the entire file's domain and grep is insufficient.

**Key facts (no file read needed):**
- Stack: React 18 + TypeScript + Vite + Tailwind CSS v4 + Radix UI (frontend); Python + Flask (backend); Supabase PostgreSQL + Storage.
- Design: "Gallery Glass" — Navy `#1f3160`, Gold `#d1a153`, frost/iris/mint accents. Never flat or generic.
- Navigation: page-state in `Users/Frontend/src/app/App.tsx`. Not React Router.
- Structure: `Users/` and `Admin/` each have `Frontend/` and `Backend/`. One folder per page. Shared Flask utilities in `Server/`.
- Images: buckets `missing-item-images` and `found-item-images`. Preserve `File` objects in multipart uploads.
- Never expose reporter email or campus ID in public listings.
- No mock data for real workflows.

## 3. Supabase MCP (Direct DB Access)
Supabase is strictly read-only for Codex, even when the connector or credentials permit writes. The user runs all migrations.
- Use it to inspect real column types, RLS policies, and table structure **instead of reading schema files**.
- Query only the tables relevant to the current task.
- Never use it to infer the full schema — one table at a time.
- Use only metadata inspection and SELECT queries; prefer an explicit read-only transaction for SQL. Never apply migrations, execute DDL/DML, invoke mutating RPCs, upload/delete storage objects, deploy functions, or change remote settings.
- Prepare migration SQL locally in `Server/manual_migrations/` following the repository convention. Review dependencies, data preservation, constraints/RLS, rerun safety, and verification queries. Record the filename and mark it pending user execution; never claim it was applied without read-only evidence.
- Do not start workflows or tests that may write to the live database, storage, or email services. Offline backend tests must use `EBALIK_TESTING=1`; inspect their isolation before execution.

## 4. Audit Log — Keep It Short
Append to `Audits/YYYY-MM-DD_Audit.md` (local date) after every interaction.

**Format — max 15 lines per entry:**
```
## [5-word title of what changed]
**Prompt:** brief intent (one line)
**Changed:** one bullet per file or logical group — filename + one-line description
**DB:** migration filename, or "None"
**Status:** "Build passes" / "X tests pass", or nothing
```
- Record the prompt intent briefly, files changed or reviewed, and migration status; never copy secrets or personal data into audits. No long prompt restatements or verification prose.
- Group related files into one bullet (e.g. "found_item routes + missing_item routes — date validation").
- Append only; never rewrite earlier entries.

## 5. Environment Files
All env files live in `Environment_Configs/`.
- Backend: `Environment_Configs/backend/.env` (loaded by `Server/config.py`)
- Frontend: `Environment_Configs/frontend/.env.local` (loaded via Vite `envDir`)
- Never create `.env` files inside `Server/` or the frontend folders.

## 6. Dev Commands
- All: `npm run dev` · Frontend: `npm run dev:frontend` · Backend: `npm run dev:backend` · Admin: `npm run dev:admin`

## 7. Documentation Tasks
If the request is a paper, report, manual, or spreadsheet: read `docs/DOCUMENTATION_GUIDE.md` first. Do not edit code during documentation tasks.
## 8. Concept and Implementation Map
- E-Balik serves the University of Makati: report missing/found items, suggest matches, verify ownership claims, receive items into custody, and release them through staff/guard handovers with PINs, history, and receipts.
- Smart Tags link registered belongings to QR stickers, staff verification, owner-controlled contact visibility, and found-item notifications.
- Auction Hall handles eligible unclaimed office items and member-owned seller listings. Seller listings require office custody/review; the office keeps a commission and manages seller payouts. Preserve claim priority, bidder privacy, payment confirmation, and ledger integrity.
- Roles include users, guards, administrators, and super administrators. Enforce access and ownership on the server; preserve account verification, OTP/MFA, privacy, and existing lifecycle rules.
- Frontend owners: `Users/Frontend/src/app/App.tsx`, `Admin/Frontend/src/App.tsx`. Backend mounting: `Server/app/blueprints.py`; page routes: `Users/Backend/`, `Admin/Backend/`; shared logic: `Server/app/utils/`.
- Find deeper context by section in `PROJECT_CONTEXT.md`, lifecycle names in `docs/STATUS_GLOSSARY.md`, and recent work in `Audits/`. Older guides can lag implementation: verify code, package versions, and relevant live metadata before changing anything.

## 9. Verification and Continuity
- Keep all work local. Do not commit, push, or deploy unless the user explicitly changes this instruction; the user will test locally first.
- Frontend changes: run the affected build (`npm run build` / `npm run build:admin`) and affected type check (`npm run typecheck:user` / `npm run typecheck:admin`). The user type check is a ratchet; do not increase its baseline to hide regressions.
- Backend changes: compile touched Python and run relevant isolated tests. CI uses `EBALIK_TESTING=1` and, from `Server/`, `python -m unittest discover -s tests -p "test_*.py"`.
- Shared text validation changes: `node scripts/check-text-guard-parity.mjs`. CI definitions: `.github/workflows/ci.yml`.
- Preserve unrelated edits; do not reset, overwrite, commit, push, or deploy them without authorization. Documentation-only changes need document/diff checks, not application builds.
- Append the daily audit using the user's local date (currently Asia/Singapore). Distinguish checks run now from historical results, and proposed migrations from applied migrations.

## 10. Handoff Snapshot (2026-11-15; Recheck When Relevant)
- Local HEAD and GitHub default branch `main` matched at `39dbd71e4c3c3c1751d684cb1dcea7c19998a0fc` (seller auctions). Existing local differences: modified `CLAUDE.md`; untracked `.claude/settings.local.json`, `Audits/2026-11-01_Audit.md`, `docs/PROMPT_BUILDTRACK_ADMIN_FEATURES.md`. Preserve these.
- Read-only Supabase connection verified against the E-Balik project. Follow-up verification on 2026-11-15 confirmed `20261026_income_ledger_lock` is recorded as applied in `public.migration_log`; both `trg_income_ledger_guard` and `trg_income_ledger_no_truncate` are installed and enabled, with definitions matching the local migration. This supersedes the missing-migration finding from the initial handoff. No database writes were performed by Codex.
- The checked-in user TypeScript baseline is 108 errors. Historical audits report passing builds/tests; no application test suite was rerun during this documentation handoff.

## 11. Event Lifecycle Checkpoint (2026-11-16)
- Event setup now includes Review/readiness and explicit internal lifecycle controls. Assigned staff have a read-only `/event-desk` workspace with fresh membership/account/session checks; no campus role elevation or attendee reporting.
- `Server/manual_migrations/20261116_event_lifecycle.sql` is prepared and isolated-tested, pending user execution. Earlier foundation/artwork migrations were user-applied. Do not rerun those or apply any SQL remotely.
- Read `docs/EVENT_PROGRESS.md` for current status and `docs/EVENT_LIFECYCLE_CHECKPOINT.md` for transitions, migration verification and acceptance. Report integration inventory, event reports/operations, hub promotion and paid rentals remain future work. Keep all changes local and uncommitted.

## 12. Event Reporting and Intake (2026-11-16)
- Lifecycle migration is user-applied and verified read-only. `20261116b_event_reports.sql` is prepared locally, pending user execution. It adds isolated event reports/history, a private image bucket and an explicit default-closed portal flag; no campus item/claim associations are added.
- Branded attendee `/events/<slug>` page, verified-account reports, moderated generic event board, own-report tracking/withdrawal, and assigned staff review/physical intake/storage/private notes are implemented locally. Opening the portal is a separate super-admin Review action after starting the event.
- Use `docs/EVENT_REPORTING_CHECKPOINT.md` for privacy/permissions, architecture inventory and manual acceptance. Claims/releases, matching, main-hub promotion, guest access, billing and tags remain future work. Keep reports event-only; Codex never applies migrations or writes to live Supabase.

## 13. Event Recovery Checkpoint (2026-11-16)
- Reporting migration is verified user-applied. New `20261116c_event_recovery.sql` is pending user execution; never apply it remotely. See `docs/EVENT_RECOVERY_CHECKPOINT.md` and the current progress summary.
- Isolated `event_claims`/`event_claim_history`: private evidence/proof, manager approval after physical receipt, one winner, no self-review/release; claim-bound encrypted pickup code and keyed hash, five-attempt lockout, 24-hour/recovery deadline, owner reset once/minute. Staff responses exclude code/secrets.
- Release RPC atomically updates event report, claim, receipt snapshots and histories. Public receipt verification is minimal; no campus claim/ledger integration. Legacy event triggers guard deleted workspaces/released reports and expire claims on terminal state.
- Workspaces expose draft editing, status filters, archive and recoverable delete/restore. Delete only inactive events without unreleased custody; restore retains prior state and keeps portal closed. No permanent purge or reopening archived events. Restore claims after reports and preserve claim history as append-only.
- Recovery evidence: 1,139 socket-blocked offline backend tests and 70 ephemeral PostgreSQL checks; both builds/admin types pass, user types baseline 108. Synthetic desktop/phone checks pass. Hosted acceptance and declared Node 22 release verification remain pending.

## 14. Event QR Sharing (2026-11-16)
- Read `docs/EVENT_QR_CHECKPOINT.md`: Admin Review now has canonical copy/open event links, QR PNG download and an isolated branded A4 print/PDF poster. `GET /api/admin/events/<id>/share` is super-admin-only, read-only and no-store on success; no new migration or environment change.
- Event QR encodes only `<PUBLIC_SITE_URL>/events/<slug>`, using its own generator. Never route it through Smart Tags, tag batches, tag ownership or handover PIN encoders. Existing attendee authentication/verification and event scope apply on scan; no automatic main-hub publication.
- Read existing PUBLIC_SITE_URL without changing it; localhost/HTTP are preview-only. Export rechecks portal state/deadline and saved version/address; deleted events fail closed. Print global styles exist only in the temporary poster iframe, preserving existing admin print flows.
- QR milestone: 1,151 offline backend tests, admin build/types, 14 synthetic browser cases and two one-page A4 PDF checks pass. Existing user frontend files are unchanged. Manual hosted/real-phone acceptance remains pending; next is event-only matching/notifications. Keep all work local and Supabase read-only.

## 14. Event Entry QR Checkpoint (2026-11-16)
- Admin Review now includes canonical event links, QR PNG downloads and branded A4 print/PDF posters. Read `docs/EVENT_QR_CHECKPOINT.md`; next after manual acceptance is event-only matching/notifications.
- `Server/app/utils/event_share.py` and super-admin-only GET `/api/admin/events/<event_id>/share` read saved metadata only, use existing `PUBLIC_SITE_URL`, and generate opaque black/white event-entry QR images through the installed library. Request Host/Origin/query parameters cannot choose the target. No migration or environment edit.
- Event QR payload is the `/events/<slug>` URL only. Keep it independent of Smart Tag generation/scanning/registration/ownership/payments, campus feeds and handover PIN QR encoding. Existing login, verified-account reporting and event authorization still apply.
- Local/HTTP or closed/expired/draft portals are preview-only; download/print rechecks current state and address. Printed codes follow later portal closure. Print-only page rules live inside an isolated poster iframe, never the normal admin stylesheet.
- QR milestone evidence: 1,151 socket-blocked offline backend tests, 14 synthetic browser cases with real QR decoding and existing tag-parser checks, plus one-page A4 normal/long-title PDF checks. Admin build/types pass; user frontend untouched (previous baseline 108). Three Python files compile. No live database/storage writes, commits, pushes or deployment.

## 15. Staff Event Matching (2026-11-16)
- `docs/EVENT_MATCHING_CHECKPOINT.md`: assigned staff can use Possible matches in the event desk or Find possible matches in a report modal, review originals and enter existing found-report claims. No new migration or match writes.
- `Server/app/utils/event_matching.py` filters event reports and adapts only text/category/venue/Manila date into existing pure `matching.match_details`. Never call campus matching query/job/alert helpers or Smart Tag functions. No image fetch/features.
- GET `/api/events/<event>/reports/<report>/matches` uses fresh private session/account/membership/window checks, no-store and 30/minute rate limiting. Exclude hidden/withdrawn/released/same-reporter pairs and impossible found-before-missing timestamps; threshold 60 overall and 30 text. Scan 100 plus a marker, return up to 12, show four per view; older candidate groups remain available.
- Cards omit reporter IDs/media paths/credentials; reasons may contain private clues and are staff-only. Scoring does not approve, release, reserve, notify or publish. Public portal pause preserves valid staff matching access. Reporting-only schemas work without the recovery migration.
- Evidence: 1,166 offline backend tests, 18 synthetic browser cases, user build/type ratchet (108), three Python compilations and diff/source checks pass. Manual hosted acceptance pending. Next: private event attendee alerts with event/recipient scope, safe generic DTOs, deduplication and resolution safeguards; any migration remains user-run. No live writes, commits, push or deployment.

## 16. Private Event Alerts (2026-11-18)
- Read `docs/EVENT_ALERTS_CHECKPOINT.md` and current progress. Recovery migration is now verified user-applied via read-only metadata. New `20261117_event_match_alerts.sql` is prepared/audited locally and pending user execution; do not run it remotely. Its filename records preparation on Nov 17.
- Separate service-only `event_match_alerts`/append-only history: manager preview/send derives the missing-report owner, reuses pure qualifying score, validates approved generic found listing/current versions and active verified recipient. Atomic event-locked RPC enforces fresh membership/window, unique event/report pair, existing-claim suppression and rolling quotas; no automatic notifications or caller-supplied recipient/message.
- Owner-only event portal Alerts tab: unread badge, read/dismiss/All, safe generic listing and existing claim form/My claims. No campus bell, email, campus match-alert jobs, Smart Tags, payment/auction hooks or storage changes. Before migration, existing event pages work with alert controls hidden.
- Withdrawn/hidden/released reports and changed/anonymized missing-report ownership permanently invalidate notices; terminal/deleted events invalidate all active notices. Pause/deadline reads suppress actions/count without mutation. No automatic missing-report withdrawal after a guessed match/release; the owner withdraws it explicitly. Lifetime pair deduplication remains after dismissal/invalidation.
- Restore reports before alerts/history; both restore implementations ignore existing alert/history duplicates to preserve newer acknowledgements/inactive state. Evidence: 1,190 socket-blocked offline backend tests, 85 ephemeral PostgreSQL checks, 24 synthetic alert browser cases, user build/types (baseline 108) and seven Python compilations. Manual hosted acceptance and declared Node 22 release verification remain pending; next Phase 5 gates are explicit hub publish/unpublish and closure/custody exports. Keep all work local and uncommitted; Supabase remains read-only.

## 17. University Pilot Completion (2026-11-18)
- User selected the university pilot first; visitors, separate event tags and paid bookings remain later gates. Read `docs/EVENT_PILOT_COMPLETION.md` for the full test run, rules, compatibility inventory and migration checks; current status is in EVENT_PROGRESS.md. Pilot software is complete locally; actual migration/real-account acceptance and Phase 6 operation are not complete.
- Alerts migration is now verified user-applied: both alert tables have RLS and five functions exist. New `20261118_event_pilot_completion.sql` is pending user execution; never apply remotely. Five service-only event tables, six invoker functions and seven guards; no existing columns/functions/campus tables/storage settings are replaced or changed.
- Owner grants separate hub permission in event My reports; super admin explicitly previews/publishes/withdraws approved generic listings through Events → Review → Operations. Browse items has a separate event tab/IDs and original-event deep links; existing campus APIs/IDs remain intact. Visibility checks consent version/public snapshot/current event/report state, including stale restored approvals. No duplicate campus report or cross-scope matching.
- Manager Recovery summary and private ZIP export; super-admin final instructions, unresolved register and closing sign-off. After terminal state, super admin requests handover to a different active existing guard/admin/super admin; the named receiver uses `/event-desk` office inbox, confirms physical receipt and records office storage. This does not grant event report/claim access, release to an owner or create campus inventory/auction eligibility. Accepted receipts/final sign-off are immutable; original release/claim paths have custody guards.
- Existing deletion remains conservative: unreleased received records, including office-transferred items, block deletion; archive/retain those events. No auto purge. Owner histories/final instructions remain accessible after closure. Both restore implementations load reports before pilot records/history and ignore existing duplicates for all five tables; exports exclude contacts/evidence/media/credentials and neutralize formulas (5000-report cap).
- Evidence: 1,214 socket-blocked offline backend tests, 101 ephemeral PostgreSQL checks including existing claim/release with alert/hub invalidation, 30 pilot + 24 alert + 18 matching browser cases, both builds/admin types, user baseline 108 and nine Python compilations pass. Declared Node 22, user-run migration/post-verification, real-account acceptance, operator/staff briefing and monitored pilot remain pending. No live writes, commit, push or deployment.

## 18. Pilot Operator Tools (2026-11-18)
- Admin Review → Open operator guide and assigned Event desk → Staff guide share pure content/print helpers in `operatorGuide.ts`; each frontend retains its own React/modal primitives. Staff links reuse permitted reports/matches/claims/manager-summary panels. Missing optional reporting schema does not prevent reading the guide or enable unavailable workflows.
- Downloadable standalone HTML desk pack contains saved event metadata and blank briefing/intake/reconciliation fields only; escaped content, restrictive CSP, no scripts/remote assets/report records/credentials or offline submissions. Print from the downloaded file; standard sample is three A4 pages. Staff record original paper receipt time in a private note when reconciling, never fake consent/backdate system receipt or release offline.
- Admin/manager summaries use existing snapshot counts for advisory next actions. Admin shortcuts select existing custody/closing tabs; original server checks and role restrictions remain authoritative. No new route, migration, package or database/storage changes. Previous pilot migration status was not rechecked in this frontend-only follow-up.
- Current follow-up evidence: eight offline Node tests (`node --test scripts/test-event-operator.mjs`), 12 new synthetic operator browser cases + 30 pilot regressions, A4 sample printing, both builds/admin types and user baseline 108 pass. Earlier backend/SQL counts remain historical. Phase 6 actual operation, real-account acceptance, Node 22 verification and later commercial phases remain open.

## 19. Draft Access and Presentation (2026-11-19)
- All seven event migrations are now verified user-applied through read-only metadata; the five pilot tables have RLS/no browser grants, six invoker functions deny browser execution and seven guards are enabled. Saved draft records exist. This supersedes earlier pending-migration notes; do not rerun SQL. Current gates are in EVENT_PROGRESS.md and EVENT_PILOT_COMPLETION.md.
- Missing local `EBALIK_EVENTS_FOUNDATION_ENABLED` caused disabled setup. The existing ignored backend environment file now explicitly enables it; a fresh config import confirms true. User must restart the backend; Codex did not start its live scheduler. Hosted environments require their own setting. Per-event state/portal and server account permissions remain authoritative.
- Admin setup now offers saved workspaces, separate list/options errors and retry; successful independent loads survive, stale/aborted responses are ignored, saved drafts return to the Drafts filter. No role bypass or database mutation was used to diagnose this.
- Landing uses a locally bundled 1280px archival UMak oval photo (Steverv0206, CC BY-SA 4.0; ATTRIBUTIONS.md), existing login/register and public boards, explicit board-error recovery and responsive artwork. UserHeader/NotificationMenu use scoped paired surface/text colors, opaque menus and readable badges; navigation/auth/event handlers remain intact.
- Latest evidence: 1,215 socket-blocked offline backend tests, twelve draft, eleven landing and 23 navigation synthetic browser cases, both builds/admin types and user baseline 108 pass. Sampled header/menu text contrast is at least 5.18:1 in the tested states. Details are in the Nov 19 audit. Real-account acceptance/monitored pilot and Node 22 release verification remain pending; no live writes, commits, push or deployment.

## 20. Pilot Regression and Design Review (2026-11-20)
- Read EVENT_PILOT_TEST_REVIEW.md for the Nov 19–20 review: 1,215 socket-blocked backend tests, 395 disposable PostgreSQL checks across all seven migrations, 15 utility tests, 161 unique functional browser cases and 64 desktop/mobile/theme views pass. Both final builds/admin types pass; user baseline remains 108.
- CSS-only corrections in admin events.css and user eventPages.css/eventPilot.css: actual dark-theme selector for error banners, readable setup-step text, stronger portal labels and theme-aware hub labels. No application handlers, permissions, schemas or live records changed.
- Roadmap completed checks now reference tested pilot scope; real-account uploads/access/QR acceptance, declared Node 22, serving-instance/capacity checks, operator assignment, briefing and actual monitored recovery/closing remain open. Later commercial phases are not implemented. Nov 19 remains the latest live migration verification; no new SQL or rerun is needed. No live writes, commit, push or deployment.

## 21. Campus Gallery and NFC Advice (2026-11-20)
- LandingCampusGallery.tsx adds two locally bundled licensed 1280px archival UMak photos; photographer/license links are under each photo and in ATTRIBUTIONS.md. Desktop grid, native mobile swipe/previous/next, lazy loading, fallback and reduced motion; 17 offline landing cases, user build and type baseline 108 pass.
- NFC was discussed, not enabled or physically encoded. Existing smart_tags.py `encode_value` returns the public `/tag/<code>` URL for QR/NFC; admin CSV already exports "Value to write on the tag". Future issuance should copy the server-generated public HTTPS URL into an NDEF URI record with an external writer, read back/test hardware, and preserve existing registration/staff verification/privacy. Campus NFC is separate from deferred event tags.

## 22. Campus NFC Smart Tags (2026-11-20)
- Supersedes the advisory-only NFC status above. Read `docs/NFC_SMART_TAGS.md`: existing `smart_tags` metadata accepts NFC with unique IDs and QR default; no migration or live write. Issuance defaults to `qr,nfc`, explicit server restrictions remain honored, batch selection still defaults to QR. Existing campus lifecycle, payment/approval, privacy and recovery remain shared; event tags remain deferred.
- Admin Smart tags has server-side medium filtering/counts, per-tag NFC preparation, browser write/read-back and manual NFC Tools instructions. Owner Manage adds a separate default-off offline name/phone choice, restricted to current approved/unexpired tags and already-visible fields/initials. URL first, optional UTF-8 Text second; admins get URL only. Card copies cannot be remotely revoked; owner URL-only rewrite can remove physical contact even when disabled without reactivation.
- New NFC preparation endpoints read only, do not record scans/expiry or write consent. Pure `nfc.ts` is shared; each app uses its own React panel. Explicit replacement, 30-second cancellation/timeout, two-minute preparation expiry, exact record comparison, no permanent locking and no persisted hardware-certification claim. QR-tag management never shows the NFC writer.
- Evidence: full 1,231 socket-blocked backend tests pass; final focused NFC suite 17/17 includes one additional payment-approval regression; 12 Node tests, 31 unique synthetic browser cases and actual light/dark phone views pass. Both builds/admin types pass; user baseline stays 108. Four backend modules compile. Real cards/real-account acceptance and Node 22 release verification remain user-run.
- Local backend env has no PUBLIC_SITE_URL or type override. NFC issuance uses the new default, but encoding requires the user's permanent public HTTPS user-site address; asked for it, not guessed or configured. Restart backend after local changes. Do not start live workflows, commit, push or deploy; user still applies any future migrations.
## Event Workspace Management Follow-up (2026-11-20)
- Workspace rows now show Review and explicit cancellation for scheduled/active/recovery events, followed by existing archive/recoverable-delete controls after cancellation. The list stays open after management changes so the next action is visible. Cancellation uses the existing versioned transition endpoint, requires confirmation/reason, closes access and remains final; no automatic cancellation/deletion chain.
- Drafts still edit/delete directly; terminal events archive/delete and Deleted records restore. Unreleased custody still blocks deletion; archive and retain those events. Backend permissions, RPCs, migrations and campus features are unchanged. Missing management setup is explained in the picker instead of silently hiding all controls.
## Release Review and Push Authorization (2026-11-20)
- User explicitly authorized committing and pushing every reviewed project change, superseding the earlier local-only restriction for this release. Push target is the existing `feature/event-foundation` branch; no merge to main or production deployment is authorized by this checkpoint.
- Fresh review passes: 1,232 socket-blocked backend tests; Node 22.23.5 production packaging, admin types and user baseline 108; text parity; 27 NFC/date/operator tests; 395 disposable PostgreSQL checks; 161 core browser cases and 31 NFC/QR cases. Event management's ten focused browser checks passed in the preceding fix. Live read-only metadata confirms all seven migrations and RLS/no browser table grants on all 15 event tables.
- `docs/RELEASE_20261120.md` records configuration, acceptance and code-revert steps. Recovery tag `safety/pre-event-nfc-20261120` identifies `39dbd71`; `release/event-nfc-20261120` will identify this release commit. CI now runs on this feature branch and includes the utility tests. Private env, Claude machine settings, dependencies, generated builds and temporary fixtures are excluded. Physical NFC/real-account acceptance remains operator-run; no database rollback or migration execution.
## Production Branch Synchronization (2026-11-20)
- User explicitly requested production synchronization after the feature-only push, authorizing promotion to main and keeping both branches at the same head. This supersedes the preceding feature-only push target. GitHub CI for `ecc21b4` passed, and Vercel's successful feature build was Preview, not Production.
- Existing GitHub deployment records identify the backend as https://ebalik-api.onrender.com; its public status CORS header identifies https://e-balik-kappa.vercel.app as the frontend origin. Retrieve hosted addresses from these records rather than asking the user to re-enter them. Hosted env settings remain independent of local env.
- Keep `safety/pre-event-nfc-20261120` and `release/event-nfc-20261120`; production synchronization adds a documentation-only commit and `release/event-nfc-production-20261120`. Both main and feature branches are to be pushed at the same reviewed head. Source rollback must reverse the synchronization documentation commit before the original release commit; preserve database tables and records.
- Follow-up production verification: GitHub CI, Vercel Production and Render succeeded at `81aaccc`; served public assets contain the new photos, NFC setup and event management. Backend event options returned `503 events_disabled`. Render blueprint/production example now explicitly enable the pilot and QR/NFC issuance; existing service must sync Blueprint or update dashboard env and redeploy. No Render API credential is available locally. Do not claim live event activation solely from source/deploy success; check the endpoint again. A new config-release tag preserves ordered rollback across all three release commits.
## Landing Contrast Correction (2026-11-20)
- Landing How It Works has fixed light editorial surfaces; its heading/card copy, label and step numbers now use matching scoped colors rather than app-theme utilities. Removed the feature card's bg-white utility that dark-mode overrides recolored independently. Do not reset the user's theme to fix a component palette.
- LiveBoard keeps theme-aware text and now uses an opaque `--color-page` surface, avoiding pale text over the light marketing canvas in dark mode. Community-strip eyebrow contrast is strengthened. Changes are presentation-only; public-board reads, auth entry points, animations and reporting actions remain intact.
- Node 22 user build/type ratchet (108) and 30 offline browser cases pass: seven rendered contrast/layout/theme-change checks plus 23 landing/auth/board regressions. Checked ordinary text at 4.5:1 and large text at 3:1; representative 1440px/320px views inspected. User explicitly authorized commit/push; keep main and feature branch synchronized. Existing case-study documentation edits remain separate from this contrast patch.

## Campus Hero Slideshow (2026-11-21)
- LandingHero preserves its asymmetric photo frame, caption and overlapping return card, with five locally bundled 1280px campus photos. New licensed photos show the HPSB classroom and an elevated campus view; each slide has source/license links and ATTRIBUTIONS.md records dates and adaptation terms.
- Seven-second rotation pauses on hover/focus, hidden tabs and offscreen; manual navigation pauses until Play. Reduced-motion preferences disable autoplay/animation. Images have independent fallbacks, and only the next photo is prefetched when visible. Keep the campus gallery and existing auth/public-board actions intact.
- Node 22 user build and type ratchet (108 existing errors) pass; 38 offline browser cases cover slideshow, existing draft/landing/auth/board behavior and both-theme contrast. User authorized committing/pushing this slideshow on Nov 21; synchronize main and feature/event-foundation. Preserve `safety/pre-campus-slideshow-20261121` for rollback and leave unrelated paper artifacts local. No DB changes.

## Smart Tag recovery and UMak venues (2026-11-23)
- Local implementation and release handoff are in `docs/SMART_TAG_RECOVERY_PLAN.md` §§9–11. Current instruction: preserve the dirty tree; no commit, push or live writes.
- User applies `20261123_campus_venues.sql` then `20261123b_smart_tag_recovery.sql`. Backend flags `CAMPUS_VENUES_ENABLED` and `SMART_TAG_RECOVERY_ENABLED` default off. Keep coordinate cleanup and backup exclusions during rollback.
- `shared/campus.json` supplies sourced paths and legacy aliases. Extend through a new user-run migration, preserve recorded text, and review the directory exceptions before adding rooms. Campus custody storage and security posts have separate semantics.
- Run `Server/venv/Scripts/python.exe scripts/test-backend-offline.py` for the network-blocked fixture suite. The test-mode environment variable alone does not isolate providers.
- Venue setup and management are combined in `20261123_campus_venues.sql`; the separate c migration was removed before user execution. Apply combined venues, then recovery. Super admin → Smart Tags → Manage UMak venues adds/renames/retires paths using a versioned, audited SQL command. JSON seeds the initial directory; active DB additions are read by shared selectors. Renames retain previous labels for historical reports. See recovery plan §12.
- Both combined venues and recovery are now verified user-applied through read-only metadata on Nov 23. Four invoker function bodies match local SQL, four new tables have RLS/no browser grants, and the two custody triggers and Event catalogue checks are installed. See recovery plan §13 for local/deployment acceptance. New local flags are absent; latest Node 22 combined packaging, types and 1,241 network-blocked backend tests pass. No commit/push authorized by this review.

## Admin roles, scan privacy and report review (2026-11-25)
- User authorized committing/pushing the complete reviewed local source/document release to main and feature/event-foundation. This authorization applies to this release; retain the default local-only rule for later unrelated edits.
- Automatic E-Balik display IDs derive from the permanent account UUID and affiliation/access prefix. Preserve official campus IDs and account relationships. University affiliation and access role are separate controls; guard promotion uses the existing guarded RPC.
- Read-only metadata now confirms the rental B and archive-first C receipts, booking table and archive guard/deletion functions. New 20261125_scan_privacy_and_report_review.sql remains pending user execution. Never apply SQL or test live mutations.
- Personal QR/NFC page visits can use SMART_TAG_SCAN_LOGGING_ENABLED=true only with the new migration. Default off. GPS is never automatic; admin and owner consent are independent. Locations expire at seven days/withdrawal/resolution/linked return, visit rows at 30 days. Backups exclude scan rows. Scheduler cleanup continues even if logging is disabled.
- Campus reports gain publication_state/version, a Reports > Approve Reports queue, reasoned rejection, edit re-review and notifications. Keep public feed/search/photo/matching/new-claim paths approved-only once the migration exists. REPORT_REVIEW_ENABLED=true additionally requires setup for submission; switching it off must never expose pending reports. Preserve existing claims, custody and event-only publication.
- docs/SCAN_PRIVACY_REPORT_REVIEW.md is the current activation, privacy boundaries, migration verification, acceptance and rollback guide. Never blindly revert to pre-review readers after activation; use maintenance and retain publication filters. Safety reference: safety/pre-privacy-review-20261125 at c3b5fa1.
- Fresh offline evidence: 1,287 network-blocked backend tests, both builds/admin types, user type count 44 versus unchanged baseline 108, nine desktop/mobile/light/dark browser cases, disposable SQL/reruns, independent scan/review races, rental/archive SQL and text parity. Real-account/device/email acceptance remains operator-run.
