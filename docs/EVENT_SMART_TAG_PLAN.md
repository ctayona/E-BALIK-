# Reusable Event Smart Tags

University of Makati Phase 7 pilot, implemented locally on November 24, 2026. Manual migration, physical-label testing and operator acceptance are pending. See §11 for activation, rollback and acceptance.

## 1. Intended result

Super admins generate an event QR batch in Smart Tags, assign available tags to an event and manage the operation from its workspace. Attendees register belongings, staff acknowledge physical receipt, and authorized staff verify collection. The QR code stays stable across reuse. Every use has its own registration and custody history.

The current interpretation of “cannot be emptied” is that previous sessions remain recorded and unresolved items retain their owner and event association. Collected sessions close and release the physical tag for reuse. Personal data retention follows university policy, including the ability to remove expired private data while retaining necessary transaction facts.

The initial pilot uses existing E-Balik accounts, QR stickers/cards, current university events and the shared campus venue catalogue. Event rental billing, visitor accounts and NFC encoding can follow their existing roadmap phases.

## 2. Attendee and staff journey

1. Super admin chooses an event-purpose batch in Smart Tags. Each tag has a permanent random code and a readable physical label.
2. In Event setup, admin selects the batch and reviews available, assigned, held, disabled and unresolved counts. Admin assigns the available tag subset. The system rejects conflicting allocations.
3. At the entrance, the attendee scans a tag and signs in. The page identifies the currently assigned event and desk. The attendee enters the item type and identifying details and takes a live photo using the existing capture component.
4. Submission creates a pending check-in. The attendee sees an explicit “Awaiting staff receipt” state and keeps possession until the desk accepts the item.
5. Desk staff scan or enter the code, compare the physical item and registration, attach the tag, record a storage position and acknowledge receipt. This creates the custody timestamp and actor history.
6. The attendee receives an in-app confirmation and email linking to their authenticated event registration. A private Handover PIN becomes available for collection.
7. Staff verify the private PIN and the existing in-person identity checks, compare the item and record release. The operation atomically closes custody, creates the receipt fact and frees the tag.
8. Staff can use the tag for another attendee in the same event. After an authorized allocation change, it can serve a future event.

An attached public QR identifies the tag. Collection also requires the private, session-specific PIN and staff verification.

## 3. Lifecycles and reuse

| Object | Planned states and rules |
| --- | --- |
| Tag inventory | Available, allocated, disabled or retired. A tag with an unresolved registration stays reserved. |
| Event allocation | Assigned, released or cancelled. A tag has at most one current allocation. Batch assignment may include only its available tags. |
| Item registration | Pending receipt, in custody, collected, cancelled or transferred to office. Transfer retains the unresolved custody association until an authorized return/resolution. |
| Event operations | Existing draft/scheduled/active/recovery/closed/archived/cancelled states remain authoritative. New check-ins require an active event, open attendee portal and an explicit check-in switch. |

Pending receipt can be cancelled before staff acknowledgement. A timeout may expire an unreceived request after a documented, configurable window. A received item always requires a recorded staff release, handover or resolution.

Closing or cancelling an event stops new check-ins. Uncollected items remain listed in recovery and closing tools. Expired event membership continues to block event staff. Super admins and explicitly authorized receiving office staff handle remaining custody through the documented post-event path.

One unresolved tag must not block all other available tags in its batch from future allocation. Moving available tags does not move unresolved sessions or give a new event access to old records.

## 4. Connection to existing features

| Existing feature | Planned integration |
| --- | --- |
| Admin Smart Tags | Add a purpose selector for personal tags or reusable event tags. Retain QR as the issuance medium. Extend the existing batch filter, CSV and print/download tools with event-purpose inventory. Show allocation, availability and event links. |
| Event setup and Review | Add an Event tags step/tab with batch allocation, collection desk, storage instructions and enable switch. Readiness checks validate permissions, event timing and physical desk preparation. |
| Attendee event portal | Add My checked-in items and entry instructions. Each registration links to its exact event and tag. Account creation retains the scanned context after the existing OTP sign-in flow. |
| Event desk workspace | Add Event items with pending receipt, in-custody, collection and unresolved tabs. Apply existing manager/desk_staff membership checks on every request. |
| Personal Smart Tags | Keep current QR/NFC ownership, pricing, approval, expiry and recovery contracts. Event-purpose tags have an independent inventory and session lifecycle. |
| Lost-and-found reports | Intentional storage intake has its own custody record. A manager can explicitly escalate an unresolved or genuinely found item into an event recovery report with a source reference and duplicate prevention. Ordinary storage registrations do not populate the public board. |
| Notifications and email | Reuse the existing provider and link patterns. Send receipt, collection and recovery reminders after committed transitions. Include generic references in previews. Private evidence, contacts and PINs stay in authenticated views. |
| PINs and receipts | Reuse reviewed PIN generation, hashing/encryption, limits and receipt verification patterns through an event-storage adapter. Existing event claim commands require a report and cannot directly serve a check-in session. |
| Custody and office handovers | Extend the operations summary with held event-tag items. Add an explicit handover source for storage sessions with receiving staff acknowledgement and destination storage. Existing report handovers keep their current behavior. |
| Closing/export/archive/delete | Include pending and held registrations, transfers and available-tag counts. Unresolved custody blocks tag reuse and event deletion. Export references and transaction facts through the authorized closing export. |
| Campus venues | Use current SQL building/floor/room options for attendee location and desk selection. Keep shelf/bin positions as private storage fields. Preserve historical labels. |
| Hub publication | Use the existing explicit report-consent and admin-publication flow after a recovery report exists. Check-in photos, names and storage positions stay private. |
| Income, auctions and rental billing | Include operational tag counts in the event summary. Future billing can reference the allocation. Paid personal-tag approval, income-ledger entries and auction eligibility remain under their existing rules. |

## 5. Admin permissions

| Role | Planned access |
| --- | --- |
| Super admin | Generate event-purpose batches, allocate/release available tags, disable tags, review incidents and resolve post-event exceptions with reasons. |
| Event manager | Manage intake, storage, pickup exceptions and unresolved items in assigned events. Escalate recovery reports and request office handover. |
| Desk staff | Confirm receipt and verified collection for the assigned event. No inventory allocation or publication permission. |
| Receiving office staff | Read and acknowledge their assigned transfer and process authorized follow-up. This grants access to that custody record. |
| Attendee | Create and view their own current registration, cancel before receipt, view their PIN and obtain their receipt/history. |
| Public scanner | See availability and generic current-event instructions, then authenticate. Previous owners, item histories, PINs and private storage are restricted. |

## 6. Proposed technical structure

Use existing React pages, shared modals, mobile item picker, live photo field, authentication and Flask blueprint conventions. Add shared event-tag service logic and explicit admin/user endpoints within the current folder architecture.

Generate batch continues to default to personal tags. Choosing event purpose dispatches to the event inventory service. Keep purpose separate from the QR/NFC medium. Existing API callers that supply no purpose retain their current issuance behavior.

Use a stable route such as `/event-tag/<code>` for new event-purpose QR payloads. The server resolves the current allocation and registration. The existing `/tag/<code>` personal route and event-poster QR route retain their current contracts. Existing issued personal batches keep their purpose.

The schema proposal is additive and must be checked against live metadata before drafting SQL.

| Proposed table | Responsibility |
| --- | --- |
| event_tag_batches | Event-purpose issuance group, label, creator and creation time. |
| event_tags | Permanent random code, physical label, batch and inventory availability. |
| event_tag_allocations | One tag allocation to an event, assignment/release actors and timestamps. |
| event_tag_registrations | Per-use attendee, item/photo reference, intake/storage, PIN, release and resolution facts. |
| event_tag_history | Append-only transition facts, actor and reason with private content excluded. |
| event_tag_transfers | Versioned storage-session office handover and receiving acknowledgement, linked to its source registration. |

Use the existing UUID/timestamptz, request ID, version and migration receipt conventions. Add indexed foreign keys, RLS and explicit service-only grants. Preserve historical associations. A unique active-registration constraint and transactional tag/allocation locks prevent double registration, double allocation and double release.

Each submission carries a stable request ID and the allocation/version it was opened against. Reassignment makes old submissions stale. Side effects follow the database commit and use existing best-effort mail semantics with honest saved-versus-notified results. Failed photo uploads, retries and partial failures must leave consistent records and cleanup behavior.

The new QR routes, inventory views and mutations require a default-off feature flag and verified migration capability. Partial backend/frontend deployment must leave the existing personal-tag and event flows usable.

## 7. Implementation phases and completion checks

1. **Trace and freeze compatibility.** Inspect live metadata read-only. Record campus tag, event report, membership, handover, receipt, payment and deletion contracts. Define DTOs and receipt/notification sources before implementation.
2. **Foundation and issuance.** Prepare one reviewed, user-run additive migration for the pilot foundation. Add gated event inventory/batch generation, printing and available-tag allocation. Prove uniqueness, retries, role checks and legacy tag compatibility offline.
3. **Attendee registration and intake.** Add the stable scan route, sign-in return path, live-photo registration and staff receipt/storage actions. Prove two simultaneous scans cannot take the same tag and that a scan opened before reassignment cannot submit afterward.
4. **Pickup and reuse.** Add the private PIN, verification/limits, staff release, receipts and per-use history. Prove old PINs and screenshots cannot release a new session. Confirm reuse keeps prior history private.
5. **Recovery and closing integration.** Add explicit escalation, office handover, reminders, export and deletion/archive checks. Prove closure never clears uncollected custody and old events cannot see new registrations.
6. **Integrated acceptance.** Run the isolated backend, disposable SQL and mocked-browser suites with GPS/email/storage/live DB connections blocked where applicable. Run frontend builds and type checks and preserve the existing baseline. The operator applies SQL and tests one small event with real tags and designated accounts.

Each phase finishes its checks before the next starts. The same agent can execute all phases in one implementation effort, with source checkpoints and an audit after each meaningful slice.

## 8. Required regression and operator tests

- Personal QR/NFC registration, approval, price/renewal, contact privacy, finder reports and history.
- Existing event entry QR, memberships, reports, claim approvals, PIN release, hub consent and office transfers.
- Same-name batches, empty and partially available batches, simultaneous allocations, duplicate intake/pickup and cancelled requests.
- Stale pages after reassignment, token expiry, another attendee/event, expired staff membership, disabled tags and lost physical tags.
- Event cancellation, closure, overdue items, office acceptance, archive/delete protection and partial-batch reuse.
- Real print quality, mobile camera/keyboard/safe-area behavior, accessible table scrolling and correct signed-out notification destinations.
- Failed uploads, persistence failures, mail failures and retries. Saved custody/release facts remain authoritative.
- Current-owner private history, minimal public scan response and retention cleanup after account/event lifecycle changes.

## 9. Rollout and rollback

The user runs migrations manually. Start with a small labelled batch, trained desk staff, documented storage positions and a manual fallback.

Disable new registrations and allocations first if the pilot encounters a problem. Keep authenticated history, collection and unresolved-custody access available through a read-only/recovery mode. Preserve allocation locks and all existing held items. A full kill switch must include an operator recovery path.

Keep additive tables and the existing physical QR codes. Record the source checkpoint before release. Avoid reverting to code that cannot account for active custody without preparing a compatible recovery path.

## 10. Size, agent and assumptions

This is a medium-to-large feature across frontend, backend and database. The QR generator is a small portion. Most work is the custody lifecycle, privacy, concurrency, post-event recovery and regression testing.

Use one primary coding agent with high reasoning to own the integration. GPT-6.2 Astra with High reasoning is the recommendation where available in the model picker. Delegated review can be added if explicitly requested, with defined boundaries and a final integration audit by the primary agent.

The recommendation reflects this feature's multi-step architecture and data-integrity work. Higher reasoning effort is supported for complex workflows in the [OpenAI reasoning guidance](https://developers.openai.com/api/docs/guides/reasoning).

The planning assumptions are existing university accounts, free initial operations, reusable event-purpose QR inventory, and retained historical sessions. Exact private-data retention and physical labels/storage procedures need operator confirmation before activation. External visitors, rental payments and event NFC encoding follow later roadmap work.

## 11. Operator handoff

**Status.** Local implementation. The November 24 read-only check confirmed the event-pilot and venue migration receipts, the private event image bucket, the account primary key and the notification link field size. The new migration is pending manual application.

### Activation order

1. Keep both new backend flags false. Preserve a known-good source revision and a recoverable backup of the existing database and private event photo bucket.
2. Apply only [20261124_event_smart_tags.sql](../Server/manual_migrations/20261124_event_smart_tags.sql) manually after `20261118_event_pilot_completion` and `20261123_campus_venues`. The SQL checks those receipts and the private bucket inside a transaction. Existing reports, claims, tag rows and event artwork require no conversion.
3. Verify the new receipt and access boundary using the read-only queries below. Release the compatible backend and both fronts together when authorized. Confirm that `PUBLIC_SITE_URL` is the canonical HTTPS attendee origin and that the existing application encryption key is stable across backend instances.
4. With the existing event foundation enabled, set `EVENT_SMART_TAGS_ENABLED=true`, leave `EVENT_SMART_TAGS_RECOVERY_ONLY=false`, and restart the backend. Print two event tags from **Admin → Smart Tags → Batch purpose → Reusable event tags**. Phone-test a printed label before printing a full batch.
5. In **Events → Review → Event tags and custody**, choose the batch, assign available tags and open check-in. The event must be active, within its event hours, and its attendee portal open. The check-in venue and entrance instructions come from the saved event setup.

```sql
BEGIN READ ONLY;
SELECT name, applied_at FROM public.migration_log WHERE name='20261124_event_smart_tags';
SELECT relname, relrowsecurity,
       has_table_privilege('anon',oid,'SELECT') AS anonymous_read,
       has_table_privilege('authenticated',oid,'SELECT') AS browser_read
FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'
  AND relname IN ('event_tag_batches','event_tags','event_tag_desks','event_tag_allocations',
                  'event_tag_registrations','event_tag_transfers','event_tag_history');
SELECT has_function_privilege('authenticated',
  'public.event_tag_command(uuid,text,uuid,uuid,uuid,uuid,integer,jsonb)','EXECUTE') AS browser_command;
COMMIT;
```

Expect one receipt, seven RLS-enabled tables and false for every browser access result.

### Acceptance with two labels and two attendees

- Generate a personal batch through the default selector. Open an existing personal QR and NFC link and the existing event entrance poster. Each should reach its original workflow.
- Select reusable event tags, print or download a QR image, assign the available subset to Event A and open the desk. The desktop and phone scan should show the event venue and desk instructions.
- Sign in as a verified attendee from the scanned URL. Take a fresh item photo, submit, and confirm **Awaiting staff receipt**. Try the same tag on the second account. Staff should see one pending registration.
- At the assigned desk, find the tag using its printed label or scanned URL. Compare the item and photo, enter the private shelf, and confirm receipt. Check the attendee’s bell, email, private PIN and custody history. Check that the public scan, the other attendee and unrelated desk staff disclose no registration details.
- Verify in-person identity and test one incorrect PIN before collecting with the correct one. Download the owner receipt and reuse the same label for the other attendee. The old PIN must fail and each attendee should see only their own use.
- Keep one item held, then release unused allocations and assign them to Event B. An old Event A form must fail. Pause or close Event A. Review its closing export and confirm that its outstanding item prevents sign-off, archive, deletion and reuse.
- Request an office handover for that item and have the named receiver accept it in **Event desk → Event item office handovers**. Check that expired event staff cannot handle pickup. Have the receiver verify the PIN and identity, then complete closing.
- On a separate held item, exercise the explicit recovery permission and manager escalation. Confirm that the resulting missing report starts in moderation. Main-hub publication still requires the report owner’s separate consent and the existing administrator action.

### Rollback and recovery

For one event, pause check-in in Review. For all events, set `EVENT_SMART_TAGS_RECOVERY_ONLY=true` and restart. This mode takes precedence over issuance, blocks new registrations and physical intake, and permits private history, pending cancellation, verified collection, office handovers, closing exports and release of unused allocations. Keep the existing event foundation enabled during recovery.

Reconcile pending check-ins with attendees, resolve held and office items, export the closing register, then release unused allocations. Once custody is clear, set both flags false. Preserve the additive schema, its guards, history, private media and the source version capable of interpreting them. An older application version offers no event-item recovery UI.

The operating assumptions are verified university attendees, free QR custody, trained staff, and an identified private shelf or bin. Agree with the university on private photo/history retention, office responsibilities and the fallback when an attendee loses account access before operating. An ambiguous storage/RPC timeout may leave a private upload. Reconcile its exact path against committed registrations before cleanup. Email delivery is best effort. The private registration and receipt remain authoritative.

### Reproducing offline evidence

Run `scripts/test-backend-offline.py` with the project interpreter, both frontend builds and both type checks. Run `scripts/test-event-smart-tags-sql.mjs` with a local PGlite module, `scripts/test-event-smart-tags-concurrency.mjs` with a local PostgreSQL bin directory and `scripts/test-event-smart-tags-browser.mjs` with a local Chromium executable after the builds. The race harness creates a password-protected loopback cluster under the ignored cache. The browser fixture uses synthetic photos and mocked HTTP. Keep actual phone, printer and mail-provider acceptance as operator tests.
