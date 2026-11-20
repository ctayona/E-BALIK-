# University pilot regression and design review

Completed November 20, 2026 (Asia/Singapore); checks began November 19.

The roadmap is aligned with the selected university pilot. Automated implementation checks pass, with no functional regression found in this isolated run. This is not live-hosted or commercial-release acceptance. Later event tags, visitor onboarding and paid bookings remain separate phases.

## Results

| Check | Result | Coverage and limits |
|---|---|---|
| Offline backend suite | 1,215 passed | Permissions, validation, event scope, missing-schema behavior, campus regressions and backup/restore; dummy credentials and socket connections blocked |
| Disposable PostgreSQL | 395 passed | All seven migration suites: foundation 25, artwork 18, lifecycle 44, reports 52, recovery 70, alerts 85, pilot completion 101 |
| Date/operator utilities | 15 passed | Manila staff expiry, recovery boundaries, operator guidance and escaped offline desk packs |
| Functional browser cases | 161 passed | Current components with synthetic API responses; network requests blocked |
| Design views | 64 passed | Sixteen setup/workflow scenes at 390px/1440px, each in light/dark mode; no tested horizontal overflow |
| User/admin production builds | Passed | Final CSS changes compiled successfully |
| Admin TypeScript | Passed | No type errors |
| User TypeScript ratchet | Passed at baseline | 108 pre-existing errors remain; baseline was not increased |
| Diff/source checks | Passed | Existing unrelated changes preserved |

The functional browser total comprises 30 pilot operations, 12 operator-guide, 24 alert, 18 matching, 17 recovery/workspace-management, 14 QR/poster, 23 draft/landing and 23 user-navigation cases. Landing cases also cover 320px and 820px widths.

The database suites exercise dependencies, rejected reruns, RLS/grants, event/account isolation, atomic claim release, consent revocation, stale publication guards, custody acknowledgements and closing restrictions. They run in local in-memory PostgreSQL, never the hosted Supabase project.

## Presentation corrections

- Admin event error banners now use the actual `data-theme="dark"` selector, making errors readable in dark mode.
- Setup-step numbers and descriptions no longer reduce already-muted text opacity in light mode.
- Event hub card labels use the application's theme-aware muted text token instead of a fixed gold that measured 3.90:1 on white.
- Attendee portal navigation and section labels use stronger opacity while retaining the event's own palette.

Only three application stylesheets changed in this review: `Admin/Frontend/src/pages/events/events.css`, `Users/Frontend/src/app/pages/event-desk/eventPages.css`, and `Users/Frontend/src/app/pages/event-desk/eventPilot.css`. No application handler, API, permission, migration or data model changed. Existing event branding remains independent of the campus theme.

Visual inspection included setup appearance, phone preview, operations, campus/event Browse transitions, portal alerts, claim/release screens and office custody panels. Contrast sampling checks visible text on resolvable solid/translucent backgrounds; it is not a full WCAG certification. Decorative preview separators are excluded from content-contrast conclusions. Network blocking may use fallback fonts, so final device/font rendering still belongs in manual acceptance.

Two initial poster tests failed because the generic test bundler omitted Vite's inline CSS imports; using the correct inline-CSS fixture passed all 14 sharing cases. An older setup fixture expected a retired link label; it now verifies the current saved portal state, with actual link/QR behavior covered by the sharing suite. These were fixture corrections, not application regressions. The interrupted browser run resumed in a fresh isolated profile; the final case total counts unique cases, not reruns.

## Remaining acceptance gates

1. If not already done after the draft-access fix, restart the local backend to load its event-module flag.
2. Perform the [complete real-account acceptance run](EVENT_PILOT_COMPLETION.md#one-complete-local-acceptance-run), including real uploads, two distinct events/accounts, physical QR scanning, approved claim release, hub consent/publication and office custody receipt.
3. Verify the declared Node 22 release environment and serving-instance configuration. This local run used Node 24.
4. Assign the pilot operator, confirm shared infrastructure/capacity limits, brief staff and record the go/no-go decision before a monitored university event.
5. Complete the monitored recovery/closing process before marking Phase 6 operationally complete.

No live database/storage/email writes, migrations, commits, pushes or deployment were performed. Migration status remains the Nov 19 read-only verification recorded in [current progress](EVENT_PROGRESS.md); this review introduces no SQL and requires no migration rerun.
