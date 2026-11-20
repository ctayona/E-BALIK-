# University event pilot: implementation and full test

Updated 2026-11-19, Asia/Singapore. The user selected **complete the university event pilot first**. Local software implementation covers setup through recovery, optional hub visibility and closing custody. All seven event migrations are verified user-applied; operational sign-off still requires real-account acceptance and an actual monitored pilot. External visitors, event tags and paid bookings remain later releases.

## Migration verified; do not rerun

`Server/manual_migrations/20261118_event_pilot_completion.sql`

Read-only verification on Nov 19 confirms foundation, artwork, lifecycle, reports, recovery, alerts and pilot completion are all recorded as applied. The five pilot tables have RLS, six invoker functions deny browser execution, seven guards are enabled and browser roles have no pilot-table grants. Codex performed no hosted database/storage/email writes. Do not rerun these migrations.

Restart the local backend and reload both apps before testing. On Nov 19 the missing local `EBALIK_EVENTS_FOUNDATION_ENABLED` flag was added to the existing backend environment file. A fresh config import confirms it reads true. Each event still obeys its own saved state, portal setting and permissions. The old process-local setup flag did not survive a new shell; saved drafts remain intact. A hosted backend needs its own explicit setting and restart; editing a local environment file does not configure a deployment.

### Schema review

Five new tables, all service-only with RLS:

| Table | Purpose |
|---|---|
| `event_hub_consents` | Separate, versioned owner permission; event-board consent is not hub consent |
| `event_hub_publications` | One publication per original event report, current approval versions and safe listing snapshot |
| `event_custody_transfers` | Pending/accepted/cancelled final office handovers, immutable completed receipts |
| `event_closure_plans` | Generic final recovery instructions, private closing note and final sign-off |
| `event_pilot_history` | Append-only consent/publication/handover/closing audit history |

UUID IDs, composite event/report foreign keys, account references with `ON DELETE SET NULL`, positive versions, timestamps, check constraints and indexed foreign keys follow existing event conventions. The migration creates six invoker functions with fixed search paths and seven triggers on event objects. It is transactional, bounded by 5-second lock/30-second statement timeouts, checks its dependency and collisions, and deliberately refuses reruns. It replaces no existing function, changes no existing columns, backfills no records and changes no campus table or storage bucket.

Service role has SELECT/INSERT/UPDATE on the four state tables and SELECT/INSERT on history. Browser roles have no table/function grants. No DELETE/TRUNCATE grants are added. History failure rolls back its consent/publication/receipt change. Event/report lifecycle triggers withdraw hub visibility; they do not move reports into campus tables.

Read-only verification after your execution:

```sql
SELECT name, applied_at FROM public.migration_log
WHERE name IN ('20261117_event_match_alerts','20261118_event_pilot_completion');
SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
('event_hub_consents','event_hub_publications','event_custody_transfers','event_closure_plans','event_pilot_history');
SELECT tablename, grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND tablename IN
('event_hub_consents','event_hub_publications','event_custody_transfers','event_closure_plans','event_pilot_history')
ORDER BY tablename,grantee,privilege_type;
SELECT p.proname,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname LIKE 'event_pilot_%';
SELECT tgname,tgenabled FROM pg_trigger WHERE tgname LIKE 'trg_event_pilot_%';
```

Expect both migration records, five RLS-enabled tables, six functions with `prosecdef=false` and fixed search paths, and seven enabled triggers. On failure, the transaction rolls back; inspect the error/dependency rather than removing guards or replaying older migrations. To disable the module, pause event portals/use the existing feature flag and keep data/history; no destructive rollback is supplied.

## Operating rules and permission matrix

| Action | Super admin | Current event manager | Desk staff | Verified report owner | Named receiving officer |
|---|---|---|---|---|---|
| Setup, lifecycle, portal open/pause | Yes | No | No | No | No |
| Event reports, matching, physical intake | Only through explicit assignment | Yes | Yes; moderation excluded | Own submissions/tracking | Only through explicit assignment |
| Review/send possible match notices | Only as assigned manager | Yes | No | Receives own notices | No |
| Grant/revoke hub permission | Own report only | Own report only | Own report only | Own report only | Own report only |
| Publish/unpublish generic hub listing | Yes | No | No | No | No |
| Event summary/private register/export | Yes, including closed/deleted history | While existing assignment/window permits | No | No | No |
| Final instructions, handover request/cancel, closing sign-off | Yes | No | No | No | No |
| Acknowledge an office handover | Only if named receiver, different from requester | No, unless separately an office role | Only if named and an existing office role | No | Own assigned handovers only |

An office receiver must already be an active guard/admin/super admin. Lookup uses an exact email and returns only the eligible account's ID/name. Choosing a receiver does not promote an account. Office receiving access after event expiry grants no general event report/evidence/claim access. Every protected request rechecks current account/session state, and every mutation rechecks authoritative scope/state/version inside its RPC.

- Hub permission is optional and starts absent/false. Granting permission does not publish. Only a super administrator publishes an approved generic label from a current open event. Neither original private images nor descriptions, identities, comparison reasons or ownership evidence go to the hub.
- **Browse items → Event listings** reads its own authenticated, verified-account publication feed. Existing Missing reports and In custody keep their APIs and IDs. A hub link opens the original event listing and existing claim/report form; it does not create a second campus report, duplicate claim system or matching scope.
- Revoking permission, hiding/withdrawing/releasing a report, changing approved listing facts/ownership, or terminal/deleted event state removes hub visibility. Regranting or reapproval does not republish automatically. Pause/deadline also suppress reads. Feed and deep-link reads check the current consent version and approved snapshot, preventing an older restored approval from exposing changed content.
- Final handovers happen after close/cancel/archive. Only physically received, unreleased items without an open claim or existing pending/accepted handover qualify. The requester and receiver must differ. Pending handovers retain desk responsibility; accepted receipts record the real office storage position. Accepted receipts cannot be cancelled or rewritten. Handover is not owner recovery or campus auction eligibility.
- After closure, normal event staff permissions still expire. The super admin manages follow-up registers and final handovers; the named officer acknowledges receipt at `/event-desk` even without an event assignment. Later owner follow-up after a final office handover follows the university office's manual recovery procedure; there is no new campus inventory/auction/automatic office release workflow.
- Closing sign-off requires a terminal event, no open claims, an accepted receipt for every remaining received/unreleased item, valid generic instructions/private note and an explicit acknowledgement. Unreceived or missing unresolved reports remain in the register for follow-up. Sign-off does not mark them recovered.
- No automatic purge or auction is added. Reports, claims, consent changes and custody history are retained. Existing recoverable-delete safeguards still block deletion of events with unreleased received records, including transferred items; retain/archive those events. Permanent deletion and a new retention automation require a later reviewed policy.
- Export is a ZIP with `summary.csv`, `event-register.csv` and `unresolved-custody.csv`. It includes authorized operational labels/storage, not reporter contacts, evidence, media paths or pickup secrets. Treat it as an internal operational record. Spreadsheet formulas are neutralized. Over 5000 reports produces an explicit refusal, never a silent partial export; register pages contain 24 reports.
- Summary counts cover the whole event. Received includes later releases; released counts verified owner handovers; desk custody includes pending office handovers until accepted; transferred counts acknowledged office receipts and is not an owner-return count. Unresolved excludes withdrawn/hidden/owner-released reports. Original claim states are counted separately.
- Both restore implementations restore parent reports first, then pilot records/history, and ignore existing duplicates for all five new tables. Older backups cannot overwrite newer consent withdrawal, publication removal, completed custody receipt or closing sign-off. Backup already discovers all public tables; no new media bucket is needed.

## One complete local acceptance run

### Pilot compatibility review

| Boundary | Reviewed implementation and preservation rule |
|---|---|
| Entry/routing | Existing `Users/Frontend/src/app/App.tsx`, `Server/app/blueprints.py` and `vercel.json` retain event URL/blueprint registration; no application routing rewrite |
| Campus Browse | `BrowseItems.tsx` preserves the existing missing/custody calls and IDs; only its new tab uses `EventHubListings` and `/api/events/hub/publications` |
| Campus matching/reports/claims | Existing user backend modules and `match_alerts.py` continue their campus tables/jobs; only the pure text scorer is reused by separate event matching |
| Tags/auctions/income | `smart_tags.py`, `auction_db.py`, `seller_auctions.py`, `income.py`, campus receipts and installed ledger protections are not altered or fed event records |
| Jobs/cleanup/recycle bin | `scheduler.py`, `housekeeping.py` and `recycle_bin.py` have no references to the new pilot tables; no automatic event purge, auction, campus notification or email job is added |
| Media | Existing private event report/proof and brand assets retain their authorization/buckets; hub listings expose no private media; closing ZIP contains authorized metadata only |
| Backup/restore | Backup discovers public tables; both restore owners explicitly order new records after reports and preserve existing pilot states/history |
| Statistics/export | Event-only snapshot RPC returns fixed operational fields/counts; no campus dashboard/financial totals change. Stored hub-publication counts represent approvals; actual hub availability is independently rechecked on feed/detail reads |
| Authorization | Existing admin super-admin gate and user fresh account/session/maintenance checks wrap every route; new RPCs recheck scope/state/version. Receiver access is restricted to that account's office handovers |

Current branch/HEAD: `feature/event-foundation` at `39dbd71e4c3c3c1751d684cb1dcea7c19998a0fc`. Unrelated local changes are preserved. This inventory covers the selected university-pilot boundaries; external identities, tags and financial integrations still require their own reviewed call sites before those later phases.

### Test sequence

Use deliberate test reports and existing test accounts. Codex has not run these hosted write workflows. Prepare a super admin, an assigned event manager, a guard/desk staff member who can receive office custody, and two verified attendees (owner and finder). Use separate browser profiles/private windows so actor/session checks are exercised.

1. **Setup and design.** Create/edit a draft using current university venues; save/reload details, schedule, logo/banner, template and colors. Check phone/desktop preview and stable URL. Assign manager/staff through the recovery deadline. Leave unrelated campus pages open to check branding isolation.
2. **Open the event.** Schedule/start the event through Review and separately open the attendee portal. Use a short controlled event/recovery schedule if you want to complete normal closure in one session. Do not bypass time checks with direct SQL. Copy/scan the event-entry QR, download it and print the A4 poster; this QR must open `/events/<slug>`.
3. **Create the matched pair.** Owner submits a missing report; finder submits a compatible found report in that event, with found time at/after missing time. Choose unique private clues. Manager reviews originals and approves generic labels. Check that descriptions/photos/identities stay off the event board.
4. **Intake and matching.** Desk staff physically receives the found item, records a storage position, and adds a note. Compare reports in both directions; review source/reasons. Desk staff cannot approve publication or send owner alerts. Repeat a similar pair in another event; it must not appear here or in campus matching.
5. **Owner alert.** Manager reviews the exact generic notice and sends it. Owner opens Alerts, checks the unread badge, reviews/dismisses and finds it in All alerts. Repeated sends produce no duplicate. No campus notification/tag record should be created.
6. **Hub permission/publication.** Finder opens My reports → Hub permission and grants separate permission. Super admin opens Events → saved event → Review → Open event operations → Hub visibility, reviews the exact generic listing, enters a reason and publishes. Check Browse items → Event listings, search/type filter and the original event link. An attendee cannot publish directly.
7. **Revocation/stale checks.** Unpublish as super admin, then republish after fresh review. Revoke permission as finder and confirm the hub card/deep link disappears; regrant alone must not republish. Try a stale preview after moderation/consent changes. Reapprove/review/publish explicitly for the next step.
8. **Claim and release.** From the hub link, owner opens the existing ownership form and submits private evidence. Manager approves only after physical receipt/evidence review. Verify that only the owner sees the pickup code. Guard tests wrong code, then correct code plus identity confirmation; verify receipt/history and that the released report/alerts/hub listing become unavailable. Owner withdraws the recovered missing report explicitly.
9. **Keep one unresolved physical item.** Record a second found item, physically receive it, and leave it unclaimed. Save generic final recovery instructions and a private closing note in Operations → Closing plan. Download/inspect the ZIP; counts must distinguish owner return from unresolved custody. Check the manager's Recovery summary as well.
10. **End and close normally.** After event end, begin recovery. After the final claiming deadline, close the event through Review. Current staff access/pickup codes stop according to existing rules. Owner histories and final instructions remain available when signed in. Cancellation can be tested in a separate event as an immediate terminal path; do not treat cancellation as normal completed recovery.
11. **Closing custody.** Super admin opens Operations → Custody handovers, chooses the unresolved item, finds a different eligible office staff account by exact email, and requests handover. Sign-off remains blocked. Receiver opens `/event-desk` → Open office handovers, checks the physical item/reference, enters actual office storage and confirms receipt. Verify the event transfer register now shows accepted, desk custody decreases and transferred count increases. No owner release, campus item or auction listing is created.
12. **Final sign-off.** Super admin reviews all unresolved reports, checks final follow-up arrangements and receipts, and completes Closing plan. Confirm completed instructions/receipt facts are immutable, export the final ZIP and archive the event. Accepted receipt cancellation must fail. Use an empty/draft event to test recoverable delete/restore; custody-bearing events remain protected.
13. **Permissions and regressions.** Test another attendee/event ID, revoked/expired membership, inactive/suspended account, revoked session, paused portal and stale versions. Try read/dismiss/consent/receipt actions on another user's IDs. Check empty/24-row register pages and mobile modals. Recheck campus reports, Browse tabs, matching, claims/receipts, Smart Tag registration/scan and auction/income workflows. Exercise restoration only in an isolated copy.

Record pass/fail for each step, account roles (no credentials), report/event references and any visible error. Review response errors/upload failures, unexpected access denials and support effort during the user-run pilot. No pilot deployment, staff training, actual recovery outcomes or commercial readiness is implied by automated checks.

## Operator tools added after pilot implementation

Open **Admin Events → saved event → Review → Open operator guide**, or **Event desk → assigned event → Staff guide**. Both use the same instructions for preparation, intake, matching/alerts, ownership verification, recovery, closing and incidents. The desk guide links directly to existing permitted workflows; manager-only summaries remain manager-only. The guide remains usable when optional report operations are not installed, without enabling them.

**Download desk pack** saves a standalone HTML file with saved event details, a staff briefing/contact sheet, recovery/incident guidance and a blank manual intake sheet. Open that file and use the browser's Print command to print or save as PDF. The standard sample prints as three A4 pages; long saved text may require more. Print extra copies of the final page before the shift. Downloads contain no report records, photos, identities, credentials or pickup codes. Metadata is escaped and the file disallows scripts, remote resources and form submissions. No offline data is stored or uploaded by the app.

Fill in the responsible manager, campus escalation contact, shift and storage custodian before opening. Number fallback sheets uniquely within the event. Keep completed sheets private, never approve/release offline, check for existing records before entering a replacement, and reconcile to the original event using a private note for the paper reference/original receipt time. Do not fabricate attendee consent or backdate system receipts. If access or the event has ended, escalate to the super admin. Follow university retention procedures for paper records.

Operations Summary now identifies the next step from the existing server snapshot: lifecycle review, claim blockers, unassigned custody, pending office receipts or final closing review. Its shortcuts open the existing custody/closing tabs. The manager summary shows the same guidance without administrator actions. This is advisory: it does not grant permissions, change state, mark a briefing complete or replace server validation. Refresh for current figures.

Extra acceptance: open all four chapters as super admin, manager and desk staff; check phone layout and keyboard navigation; download/print the pack; navigate from the staff guide back into reports/claims/summary; confirm staff cannot open the manager summary; confirm next actions change after an actual office receipt. Record staff briefing, incident/support time and feedback separately during the real pilot. No new migration, dependency, backend route or database/storage mutation was added for these tools.

Current operator-tool evidence: eight offline Node checks, 12 new synthetic browser cases plus all 30 pilot browser regressions, and a three-page A4 sample print pass. Both builds/admin types pass; user types retain the 108-error baseline. Backend/SQL counts below are evidence from the earlier implementation milestone, not reruns for this frontend-only addition.

## Pilot implementation evidence and remaining gates

- 1,214 socket-blocked offline backend tests pass, including pilot service/route coverage and restore preservation. Nine changed Python files compile.
- 101 isolated PostgreSQL checks pass, covering missing dependency/rerun rollback, indexed foreign keys, service-only RLS/grants/functions, owner consent, stale approvals/restored snapshots, lifecycle revocation, transactional audit failures, original intake/claim/release with alert/hub invalidation, custody receipts and immutable closing.
- 30 new synthetic pilot browser cases pass with real SQL snapshot fixtures and fake APIs, plus reruns of all 24 alert and 18 matching browser cases: 72 browser cases this milestone. Phone/desktop modal limits, campus Browse compatibility, hub-to-original claim, consent, office receipt and missing-schema behavior are covered.
- Both production builds and admin type checking pass; user type checking stays at its existing 108-error baseline. Tests ran with Node 24; declared Node 22/CI release verification is still pending.

Migration application and read-only post-verification are complete as of Nov 19. Still required: restart the local backend after the flag fix, this real-account acceptance run, a selected pilot operator/event, actual staff briefing and monitored recovery/closing. Only then is Phase 6 operationally complete. External visitor onboarding/event tags and commercial pricing/booking/financial integration remain outside the selected pilot scope.
