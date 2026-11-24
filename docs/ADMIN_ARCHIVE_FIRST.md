# Admin archive-first management

Nov 25 read-only checkpoint: the 20261124c_admin_archive_first receipt and archive guard/deletion functions are present. Do not rerun SQL solely because the source changes are now being released. Existing acceptance checks below still apply.

Working records are archived before their Delete controls become available. Archive preserves status, relationships, photos and custody. Existing deletion authorization, Recycle bin, financial and linked-record checks continue to apply.

## Reports and custody

Found and lost reports can be archived while work is in progress. Use Reports → Found items or Lost items → Archive. The record moves to the Archived tab, where Restore and super-admin Delete are available.

An item physically held by the office stays in Items in custody after archival. That register continues to show its storage, claims and release actions. Its Archive control changes to Restore from archive. Archiving changes administrative visibility and preserves the custody state.

## Other records

- Claims retain their completion requirement before archival.
- Auctions retain completion/cancellation and outstanding-pickup checks. Delete appears only for archived auctions, including the detail modal.
- Accounts have Working and Archived views. Use indefinite suspension before archival. Restore from archive before reactivation. Deletion retains confirmation, Google Authenticator and the existing Recycle bin protections.
- Personal QR/NFC tags and batches have Working and Archived views. Registered tags require deactivation before archival. Blank tags can be archived directly. Archived tags retain their codes and owners, and can be restored. Batch deletion requires the whole batch to be archived. Existing custody links continue to restrict tag deletion.
- Draft, closed and cancelled event workspaces can be archived. Move to Deleted is offered only from Archived. Restoring an archived event uses its recorded previous draft/closed/cancelled state and leaves the attendee portal closed. Existing custody, closing and rental protections continue to apply.

## Manual migration

Apply Server/manual_migrations/20261124c_admin_archive_first.sql using SQL Editor. Existing report/claim/auction archive columns are reused. The migration adds matching timestamp/actor fields to accounts and personal tags, guarded admin deletion adapters, a batch archive command and event archive/restore commands.

It preserves existing rows. Administrative report/account/claim deletion stays gated until the migration receipt exists. The guarded adapters call the existing deletion commands in the same transaction. User-owned report deletion keeps its existing entry points.

The paid-rental migration 20261124b_event_rentals.sql is separately pending from the preceding feature. Apply it before activating rentals. Archive migration C uses the existing archive and event schemas and can be reviewed independently.

## Acceptance

1. Verify active report rows and detail modals have Archive and omit Delete.
2. Archive a found report in custody. Verify the Archived tab, custody register, claim and release history, storage and photos.
3. Restore it. Verify it returns to its working list with its original status.
4. Archive a disposable completed record, then delete from Archived. Verify the Recycle bin restore flow.
5. Repeat direct DELETE calls for an unarchived record. They must fail.
6. Test accounts, individual QR/NFC tags and whole batches. Restore before reactivation. Confirm owned tag URLs and history survive archival.
7. Archive a saved event draft, restore it and edit it. Test archive-before-delete with event custody and rental safeguards.
8. Check normal admin and super-admin permissions, small screens and archive filters.

## Rollback

Retain the added columns and archive metadata. Restore archived records through the application where appropriate. Reverting the application to its earlier release also restores its earlier delete-button behavior, so retain the archive-first release when that safeguard is required. Keep the existing Recycle bin recovery process available.
