# Event entry QR and poster

Implemented locally on 2026-11-16. No migration, package installation, live database/storage write, environment edit, commit, push or deployment was performed for this milestone.

## Where to use it

1. Restart the local backend and reload the admin frontend.
2. Open **Events → Workspaces**, select the saved event and choose **Review**.
3. Under **Attendee event page**, use the canonical link or open **QR & poster**.
4. Preview the saved event palette, name, organizer, venue, collection instructions and final claiming date. Long instructions are shortened on paper; the event page retains the full instructions.
5. When the event portal is open and the attendee website address is ready, use **Download QR** for a PNG, or **Print poster / PDF** for an A4 poster. The browser's print dialog provides Save as PDF.

The QR opens `/events/<slug>` on the existing attendee website. Scanning does not register a Smart Tag, allocate a tag batch, associate a belonging with an owner, submit a report, claim an item, transfer custody or publish anything to the main hub. Attendees still sign in through E-Balik and follow the existing event verification/permissions rules.

## Website address and access

The endpoint reads the existing backend `PUBLIC_SITE_URL` setting to build the same canonical event link for copying, previewing and QR generation. It does not infer the attendee website from the admin port, request Host/Origin, browser-provided URL parameters or the API domain. It accepts a website origin only, such as `https://your-ebalik-site.example`, without `/admin`, `/events`, credentials, query parameters or fragments.

No configuration values were changed. Keep an already correct `PUBLIC_SITE_URL`. This setting is shared with existing application links; do not change it to an event-specific path or a separate admin/API URL. If configuration needs correction, make that change manually in the existing backend environment configuration and restart the backend.

Missing configuration defaults to a localhost preview. Local or HTTP origins can be previewed/copied but cannot be downloaded/printed for distribution. The interface explains what is missing. Copying a preview link does not open the portal.

Draft, scheduled, paused, expired, closed, cancelled and archived portals cannot export for attendees. Deleted events return not found. Opening the sharing modal and each download/print recheck current saved event state through a read-only GET. If the event/address changed since preview, the updated card must be reviewed before retrying. Future closure/pause continues to apply to already printed QR codes: the code is an entry URL, not an access credential.

## Implementation and isolation

- `Server/app/utils/event_share.py`: independent event QR generator using the already installed `qrcode[pil]` dependency; opaque black/white modules and a four-module quiet zone. No Smart Tag services or handover-PIN encoders are used.
- `GET /api/admin/events/<event_id>/share`: existing feature flag and super-admin authorization, event lookup, reporting-setup check, safe event-field projection, canonical link, PNG data URI and current export readiness. Successful responses are no-store. It performs reads only and accepts no mutation method.
- `EventShareControls.tsx`: scoped modal, saved branding, canonical copy/open controls, fresh export checks and event-specific PNG filenames. No public report/evidence/account data is embedded in the code or poster.
- `eventSharePrint.ts` and isolated print stylesheet: a temporary iframe contains only a cloned poster, embedded QR and its own styles. The admin dashboard, other dialogs and private workspace text are excluded; existing admin analytics/receipt print rules are not changed. The iframe is cleaned up after printing.
- Existing `/events/<slug>` entry handling, E-Balik sign-in, event reports/claims, Smart Tag routes/tables/scanning/payments, main-hub feeds and all financial records remain unchanged.

No new schema objects or bucket settings are needed. The earlier reporting migration must already be applied for attendee reporting. The recovery migration remains a separate user-run step for claims/releases; its live application status was not rechecked for this QR milestone.

## Manual acceptance

- [ ] Restart locally and confirm the saved event link uses the attendee website rather than the admin/API address.
- [ ] Open the poster on desktop and phone; verify event colors, name, organizer, venue, shortened instructions and Manila claiming deadline.
- [ ] Copy/open the URL. Download the PNG and scan it with a real phone. It must open this event's page, preserving the event slug.
- [ ] Print or Save as PDF. Verify one A4 page, readable QR and printed URL, correct colors and no admin content. Check a long event title and long collection instructions.
- [ ] Pause the portal after opening preview, then try downloading/printing. Export must be refused; an already printed code must lead to the closed/paused event experience.
- [ ] Check preview-only behavior for a draft and localhost address. Check expired/closed/cancelled/archived events and deleted-event lookup.
- [ ] Open a second event and confirm its code/link differ. Renaming the first draft must retain its existing event slug.
- [ ] Check event sign-in, reports, claims and staff desk as before; verify an existing Smart Tag scan still reaches `/tag/<code>` and retains its original behavior.

Automated evidence: 1,151 socket-blocked offline backend tests pass, including event sharing and existing campus/Smart Tag regressions. Admin build and TypeScript pass. Fourteen synthetic browser cases cover phone layout, color contrast, exact QR decoding, copied/downloaded URLs, fresh-state export refusal, changed origins, print cleanup, setup failures and the existing portal toggle. Normal and long-title posters render to single-page A4 PDFs. Hosted/authenticated and real-phone acceptance remain pending.

After acceptance, the next roadmap feature is event-only matching and notifications. Main-hub promotion remains a later explicit publish/unpublish workflow; event Smart Tags remain a separate future phase.

## Subsequent matching milestone

Staff-only event possible matches are now implemented locally; see [matching checkpoint](EVENT_MATCHING_CHECKPOINT.md). Private attendee alerts remain the next matching step. QR and Smart Tag behavior remain separate.
