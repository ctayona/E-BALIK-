# University paid event rentals

Nov 25 read-only checkpoint: the 20261124b_event_rentals receipt and booking table are present. Do not rerun SQL solely because the source changes are now being released. Activation and real-account acceptance below remain operator-run.

## Scope

Admin-managed packages and bookings, one full payment per booking, complimentary authorization, full refunds, private evidence, receipts and event-rental ledger reporting. Existing event staff, reporting, matching, release and office custody remain independently authorized.

Package pricing, included reusable tags, maximum event hours, support and cancellation terms are entered by a super administrator. No packages or market prices are seeded. An existing active E-Balik account is the payer. This implementation uses staff-confirmed cash or electronic payments and existing proof upload conventions.

## Activation

1. Back up using the existing authorized backup process.
2. Apply Server/manual_migrations/20261124b_event_rentals.sql manually after the event pilot and reusable event tag migrations. It adds three private tables and rental command/guards, expands the two payment source constraints and records its receipt. It preserves existing financial and event rows.
3. Deploy the matching backend and frontend together.
4. Set EVENT_RENTALS_ENABLED=true on the backend and restart. Default is false. The flag and migration receipt must both be present.
5. Use Events → saved event → Review → Rental booking and billing.

## Operator flow

Create a package, then create a booking for a saved draft or scheduled event with complete dates. Select the package and enter the organizer account email and agreement reference. A zero-price package requires the same recorded authorization and creates a complimentary booking.

Each booking freezes its price, package version, included tags, terms, support, organizer and dates. Editing a package affects future bookings. Cancel an unpaid booking before replacing it. Refund a paid booking before creating a replacement. A current booking protects the agreed schedule, organizer and recoverable deletion state.

Confirm payment from the booking or Revenue and payments queue. The server rereads the agreed price. Electronic payments require a reference and private proof image. Check actual receipt of money before confirming. The database writes the sale and booking state together. Electronic rental references are checked against existing sales and serialized against other rental confirmations. Legacy auction and personal tag confirmations retain their existing reference rules.

Rental receipts use the existing admin receipt modal, print, resend, payer My receipts and receipt verification. The Event rentals revenue category appears in totals, monthly charts, CSV and ledger filters. Included event tags use their separate reusable inventory and incur no personal-tag sale. New allocations are limited by the booked allowance and require payment or complimentary authorization.

Full refunds use the existing super-admin Google Authenticator verification. The refund and booking state update together and retain the original receipt. Manual adjustments require MFA. Manual refunds cannot use payment receipt numbers, which prevents a partial manual refund from incorrectly marking a whole sale reversed. Historical manual refunds are preserved.

Financial cancellation and refund retain custody and event recovery records. Event cancellation is still a separate operator action. Staff must reconcile both when cancelling service. Event closing ZIP exports include a rental booking register. Backup and restore ordering includes the three new tables and preserves existing booking records on restore.

## Verification and acceptance

- Create a package, book an event and change the package price. Confirm that the existing booking retains the old quote.
- Confirm one cash payment. Check event status, ledger total, receipt, payer history, print and public receipt/code verification.
- Confirm an electronic payment with private proof. Try a stale amount and an already-recorded reference. Both must fail.
- Retry and double-submit confirmations. Exactly one sale and one paid booking must result.
- Refund with a fresh Google Authenticator code. Check one negative ledger row, refunded booking and reversed receipt. Repeat attempts must fail.
- Check unpaid cancellation, complimentary authorization and replacement bookings.
- Check tag limits and a saved event with previously allocated tags. The package must cover the existing allocation.
- Confirm staff and attendees cannot open billing management. Check receipt owner access and proof privacy.
- Close/cancel the event and complete unresolved recovery/office handovers. Financial state must not remove recovery access.
- Check 390px forms, scrollable booking/package registers, pre-migration behavior and flag-off behavior.

## Rollback

Disable EVENT_RENTALS_ENABLED and restart to stop rental mutations. Existing receipts, ledger history and custody remain stored. Restore the previous app release if necessary. Keep the additive tables and expanded source constraints while rental ledger rows exist. Do not drop or rewrite financial history. Re-enable the matching billing release when processing outstanding refunds.

## Remaining rollout decisions

Choose real package prices, support commitments and cancellation terms before activation. Organizer self-service, visitors, payment-gateway settlement, deposits/installments and partial rental refunds require additional workflows. Phase 9 still requires an operator-led pilot and support arrangements.
