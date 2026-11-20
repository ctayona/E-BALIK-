# NFC Smart Tags — local implementation, 20 November 2026

NFC cards are a separate issuance medium in the existing campus Smart Tag system. Each issued card receives a new random tag ID; it does not reuse an existing QR item's identity. An optional printed backup QR for that NFC card opens the same NFC item. This is independent of event entry QR codes and the deferred event-only tag feature.

## Use it

1. Restart the backend after loading these local changes. QR and NFC issuance are enabled by default. An explicit `SMART_TAG_TYPES_ENABLED=qr` still restricts issuance; use `qr,nfc` where NFC issuance is wanted. RFID remains opt-in. No local secrets/configuration were changed.
2. Admin → Smart tags → Generate batch → NFC. Set the normal label, quantity, price and validity. QR remains the default batch choice.
3. Select **NFC cards**, open an individual tag, expand **NFC card setup**, then **Prepare NFC card**. Label the physical card with that tag's code.
4. In Chrome on a compatible Android phone over HTTPS: **Write card**, hold that card near the phone, then **Verify card** and tap again. NFC permission is requested only by the explicit write/verify gesture. Turn on NFC first. Preparation lasts two minutes; each hardware operation times out after 30 seconds and can be cancelled.
5. Otherwise use the displayed NFC Tools steps. Write the exact URL as a URL/URI record, read it back, and compare it with the preview. The CSV exports URLs for batch handling; it does not encode hardware or certify that any card was written.
6. Close the writer and tap normally. Open the browser link, sign in, register the item with a live photo and consent, and bring it to the office. Existing payment confirmation and staff approval requirements apply before details are public.

`PUBLIC_SITE_URL` must be the stable public HTTPS user site, not the admin URL or localhost. NFC preparation fails clearly if the configuration is unsuitable. Opening a card uses the normal `/tag/<code>` page and requires internet to load current website details. No special app is needed for the normal URL-opening path on compatible phones; phone behavior varies.

Local configuration check: `PUBLIC_SITE_URL` and `SMART_TAG_TYPES_ENABLED` are both absent from the backend env file. New issuance therefore defaults to QR + NFC, but card preparation correctly remains blocked until the user supplies the permanent public HTTPS address. Do not guess that address or silently change existing printed-link targets. This is a configuration prerequisite, not a missing database migration.

## Optional offline name and phone

The owner opens My Smart Tags → Manage → NFC card setup and explicitly selects the offline-contact checkbox, off by default. The server requires the current owner and an active/lost, unexpired, staff-approved tag. Name and phone must already be selected in that tag's privacy settings; initials preferences and the saved visible phone option are respected. Missing/hidden contact fields are rejected, not silently substituted from private profile data.

The resulting message has two records: the URL first, followed by an English UTF-8 Text record with the approved visible name and phone. The preview shows exactly what will be written. Admin preparation always returns URL only; it cannot opt owners into offline contact. No email, campus ID, account ID, token, item photo or private evidence is encoded.

Offline data is a physical public copy, not an automatic offline website. A reader app may be needed to inspect the Text record. Changing privacy, disabling/expiring a tag or removing an account cannot recall a physical copy. To remove it, leave offline contact unchecked, prepare again, explicitly allow replacement, write URL-only and verify that only one record remains. The current owner can do this even while their tag is disabled; the website stays disabled. External NFC Tools can also erase/rewrite a card. Do not permanently lock a card whose contact data may change.

The checkbox authorizes the current preparation/write only; it is not saved as a permanent preference or represented as a database consent record. Contact data and hardware results stay in component memory; the application does not persist them to browser storage or the database.

## Architecture and safety review

- Existing `smart_tags.tag_type` already accepts `qr`, `rfid`, `nfc`, is non-null, and defaults to `qr`. `tag_id` remains the unique primary key. Live metadata and constraints were checked through explicit read-only transactions. **No migration is required.**
- Generation, registration, live photo, office review, payments, renewal, disable/reactivate, deletion rules, owner privacy, lost/found handling and notifications use the existing Smart Tag services. A tap cannot bypass approval or prove ownership. NFC records can be copied; the physical chip UID is not an authentication credential.
- `Server/app/utils/nfc_tags.py` prepares allowlisted records using reads only. It deliberately does not call `public_view`, expiry mutation, scan counters, storage or notification helpers. No changes to QR generation, parsing, payment or recovery logic.
- Admin-only `GET /api/admin/smart-tags/<id>/nfc` prepares URL only. Owner-authenticated `POST /api/tags/<id>/nfc` prepares URL plus explicitly requested eligible contact; preparation itself makes no database writes. Successful responses are no-store; user errors are also no-store.
- Admin `type=all|qr|nfc|rfid` filtering applies before the list limit and to status counts. Batches follow the selected medium; revenue totals remain for all media and are labelled accordingly. Existing role restrictions on batch price, disable/reactivate and deletion remain intact.
- Framework-independent `Users/Frontend/src/app/utils/nfc.ts` handles Web NFC, exact read-back comparison, NDEF size estimation, cancellation and errors. The two panels use their own frontend's React runtime. Payloads are reloaded from the server, not constructed from editable URLs. QR items never expose the NFC writer.
- Existing card content is protected by default (`overwrite: false`). Replacement requires an explicit checkbox identifying the physical code and warning that all records will be replaced. Read-back rejects another URL, extra records or mismatched contact text. Hardware success is reported separately from read-back verification and is never claimed as a persisted inventory status.
- Use writable NDEF-compatible tags; the preview estimates Type 2 NDEF storage requirements including TLV overhead. NTAG215/216 offer room for URL plus contact. Actual chip capacity, factory formatting, hardware permissions and read-only locks must be checked on the physical card.

## Verification and remaining acceptance

- Full socket-blocked backend suite: **1,231 tests passed**, including the first 16 NFC tests. A final additional NFC payment-gating test passed in the focused **17/17 NFC** run; no production logic changed after the full run. Four touched backend modules compile.
- `node --test scripts/test-nfc.mjs`: **12 passed**, including NDEF URI/Text encoding, UTF-8/long records, overwrite protection, read-back mismatch/extra data, cancellation, unavailable hardware and permission errors.
- **31 unique offline browser cases passed**, with real components and separate frontend React bundles, mocked API/NFC hardware, fresh Edge profile and all external HTTP(S) traffic blocked. Includes both tag-management entry points, NFC filtering, QR management/download presence, batch choices, consent, failure states and light/dark 320px and 390px layouts. Theme cases were rerun using the actual `data-theme` selector; screenshots visually reviewed.
- Both production builds and admin TypeScript pass. User TypeScript stays at the existing **108-error baseline**. Node 24 was available locally; declared Node 22 release verification remains pending.
- No live application workflows, database/storage writes, migrations, commits, pushes or deployments were performed. No card has been physically encoded or hardware-certified by these tests.

Before issuing cards: generate one test NFC item and a separate QR item, confirm their IDs differ, encode/read back on your HONOR 200, register and approve through real accounts, check hidden contacts and wrong-account access, test finder notification/office recovery, and confirm QR scanning still works. Test optional offline contact in airplane mode using a reader app, change website privacy to observe that the physical copy remains, then rewrite URL-only and confirm it is gone. Confirm the NFC card's backup QR opens the same item. Test disabled, expired, read-only, insufficient-capacity and wrong-card cases. These physical/real-account acceptance steps are user-run.

## Reference specifications

- [Chrome Web NFC](https://developer.chrome.com/docs/capabilities/nfc): Android support, user gestures, NDEF writing, scanning, overwrite and cancellation.
- [HONOR 200 specifications](https://www.honor.com/global/phones/honor-200/spec/): NFC reader/writer support; sensing area beside the rear camera.
- [Android NFC basics](https://developer.android.com/develop/connectivity/nfc/nfc): NDEF records and URI dispatch.
- [NXP NTAG213/215/216](https://www.nxp.com/products/NTAG213_215_216): memory capacities and NDEF-compatible Type 2 tags.
