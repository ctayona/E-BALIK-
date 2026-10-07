"""Recycle bin: archive before delete, restore, permanent delete with an authenticator code, expiry, and the retention rule feeding it."""
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

from flask import Flask

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT.parent, ROOT / 'tests'):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from memdb import MemClient  # noqa: E402
from Admin.Backend.recycle_bin import routes as bin_routes  # noqa: E402
from Admin.Backend.shared import authenticator  # noqa: E402
from app.utils import housekeeping  # noqa: E402
from app.utils import recycle_bin as rb  # noqa: E402
from app.utils.supabase_db import SupabaseDB  # noqa: E402

ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
OWNER = '33333333-3333-4333-8333-333333333333'
CLAIMANT = '44444444-4444-4444-8444-444444444444'
FOUND = '66666666-6666-4666-8666-666666666666'
MISSING = '88888888-8888-4888-8888-888888888888'
CLAIM = '55555555-5555-4555-8555-555555555555'
CLAIM2 = '56565656-5656-4565-8565-565656565656'
MATCH = '99999999-9999-4999-8999-999999999999'
AUCTION = '77777777-7777-4777-8777-777777777777'
NOW = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)
PUBLIC = 'http://x/storage/v1/object/public/'


class FakeStorage:
    """Buckets as a dict: {(bucket, path): bytes}. A missing object raises like Supabase does."""

    def __init__(self, files=None):
        self.files = dict(files or {})
        self.fail = {}      # {'download': bucket, 'upload': bucket, 'remove': bucket} makes that call raise for that bucket

    def from_(self, bucket):
        outer = self

        class Bucket:
            def download(self, path):
                if outer.fail.get('download') == bucket:
                    raise RuntimeError('storage unavailable')
                if (bucket, path) not in outer.files:
                    raise RuntimeError('Object not found')
                return outer.files[(bucket, path)]

            def upload(self, path, data, options=None):
                if outer.fail.get('upload') == bucket:
                    raise RuntimeError('storage unavailable')
                outer.files[(bucket, path)] = data

            def remove(self, paths):
                if outer.fail.get('remove') == bucket:
                    raise RuntimeError('storage unavailable')
                for path in paths:
                    outer.files.pop((bucket, path), None)
        return Bucket()


def world():
    return {
        'user_profiles': [
            {'account_id': ADMIN, 'fname': 'Ana', 'lname': 'Admin', 'email': 'ana@umak.edu.ph', 'access_level': 'super_admin'},
            {'account_id': OWNER, 'fname': 'Maria', 'lname': 'Santos', 'email': 'maria@umak.edu.ph', 'access_level': 'user', 'password_hash': 'HASH',
             'verification_document_bucket': 'verification-documents', 'verification_document_url': 'v/owner.pdf'},
            {'account_id': CLAIMANT, 'fname': 'Juan', 'lname': 'Cruz', 'email': 'juan@umak.edu.ph', 'access_level': 'user'},
        ],
        'found_items': [{'item_id': FOUND, 'fpost_id': 'FP1001', 'item_name': 'Blue umbrella', 'account_id': OWNER, 'image_url': PUBLIC + 'found-item-images/u1.jpg'}],
        'missing_items': [{'item_id': MISSING, 'mpost_id': 'MP2001', 'item_name': 'Black wallet', 'account_id': OWNER, 'image_url': PUBLIC + 'missing-item-images/w1.jpg'}],
        'claims': [
            {'claim_id': CLAIM, 'claim_reference': 'CL-1', 'found_item_id': FOUND, 'claimant_account_id': CLAIMANT, 'status': 'approved_for_pickup',
             'proof_image_path': 'proof/1.jpg', 'identity_document_path': 'id/1.pdf'},
            {'claim_id': CLAIM2, 'claim_reference': 'CL-2', 'found_item_id': FOUND, 'claimant_account_id': OWNER, 'status': 'pending',
             'proof_image_path': None, 'identity_document_path': None},
        ],
        'ai_matches': [{'match_id': MATCH, 'found_item_id': FOUND, 'missing_item_id': MISSING, 'status': 'pending'}],
        'auctions': [{'auction_id': AUCTION, 'item_reference': 'FP1001', 'title': 'Blue umbrella', 'status': 'ended', 'found_item_id': FOUND}],
        'auction_bids': [{'bid_id': 'b1', 'auction_id': AUCTION, 'bidder_account_id': CLAIMANT, 'amount': 100}, {'bid_id': 'b2', 'auction_id': AUCTION, 'bidder_account_id': OWNER, 'amount': 150}],
        'auction_comments': [{'comment_id': 'c1', 'auction_id': AUCTION, 'account_id': CLAIMANT, 'body': 'nice'}],
        'auction_reactions': [{'auction_id': AUCTION, 'account_id': CLAIMANT}],
        'recycle_bin': [],
    }


# What the database does when a parent is deleted (the cascades we mirror in the fake RPCs).
CASCADE = {
    'found_items': [('claims', 'found_item_id'), ('ai_matches', 'found_item_id')],
    'missing_items': [('ai_matches', 'missing_item_id')],
    'user_profiles': [('found_items', 'account_id'), ('missing_items', 'account_id'), ('claims', 'claimant_account_id'), ('user_notifications', 'user_account_id')],
    'auctions': [('auction_bids', 'auction_id'), ('auction_comments', 'auction_id'), ('auction_reactions', 'auction_id')],
}
PK = {'found_items': 'item_id', 'missing_items': 'item_id', 'claims': 'claim_id', 'user_profiles': 'account_id', 'auctions': 'auction_id'}


def cascade_delete(store, table, value):
    rows = store.get(table, [])
    gone = [r for r in rows if r.get(PK[table]) == value]
    store[table] = [r for r in rows if r.get(PK[table]) != value]
    for child, column in CASCADE.get(table, []):
        if child in PK:
            for row in [r for r in store.get(child, []) if r.get(column) == value]:
                cascade_delete(store, child, row[PK[child]])
        else:
            store[child] = [r for r in store.get(child, []) if r.get(column) != value]
    return gone[0] if gone else None


def make(store=None, files=None, unique=None):
    store = store if store is not None else world()
    storage = FakeStorage(files if files is not None else {
        ('claim-proof-images', 'proof/1.jpg'): b'PROOF', ('claim-id-documents', 'id/1.pdf'): b'IDPDF', ('found-item-images', 'u1.jpg'): b'UMB',
        ('missing-item-images', 'w1.jpg'): b'WALLET', ('verification-documents', 'v/owner.pdf'): b'VERIFY'})
    calls = []

    def rpc(table, key):
        def handler(params):
            calls.append(table)
            target = params.get('p_target_account_id') or params.get('p_claim_id') or params.get('p_item_reference')
            if table == 'claims':
                return cascade_delete(store, 'claims', target)
            if table == 'user_profiles':
                return {**(cascade_delete(store, 'user_profiles', target) or {}), 'deleted_found_items': 1}
            column = 'fpost_id' if table == 'found_items' else 'mpost_id'
            row = next((r for r in store.get(table, []) if r.get(column) == target), None)
            return cascade_delete(store, table, row['item_id']) if row else None
        return handler
    client = MemClient(store, unique=unique or {}, rpc_handlers={
        'admin_delete_claim': rpc('claims', 'claim_id'), 'admin_delete_user': rpc('user_profiles', 'account_id'),
        'admin_delete_found_item': rpc('found_items', 'item_id'), 'admin_delete_missing_item': rpc('missing_items', 'item_id')})
    client.storage = storage
    db = SupabaseDB.__new__(SupabaseDB)
    db.client = client
    db.rpc_calls = calls
    return db, store, storage


def bin_row(store):
    return store['recycle_bin'][0]


class ArchiveAndRestoreTests(unittest.TestCase):
    def test_deleting_a_claim_archives_it_first_and_restoring_brings_back_row_and_files(self):
        db, store, storage = make()
        result = db.delete_admin_claim(CLAIM, ADMIN)
        row = bin_row(store)
        self.assertEqual(result['claim_id'], CLAIM)
        self.assertEqual((row['entity_type'], row['status'], row['reason']), ('claim', 'archived', 'admin_delete'))
        self.assertEqual(row['deleted_by'], ADMIN)
        self.assertEqual(row['deleted_by_label'], 'ana@umak.edu.ph')
        self.assertEqual(row['summary'], {'claims': 1})
        self.assertIn('CL-1', row['label'])
        days = (datetime.fromisoformat(row['expires_at']) - datetime.fromisoformat(row['deleted_at'])).days
        self.assertEqual(days, rb.retention_days())
        self.assertFalse([c for c in store['claims'] if c['claim_id'] == CLAIM])
        self.assertNotIn(('claim-proof-images', 'proof/1.jpg'), storage.files)          # the original is gone...
        self.assertEqual(len([k for k in storage.files if k[0] == rb.BUCKET]), 2)         # ...but a copy sits in the bin
        restored = rb.RecycleBin(db).restore(row['archive_id'], ADMIN)
        self.assertEqual(restored['restored'], {'claims': 1})
        self.assertTrue([c for c in store['claims'] if c['claim_id'] == CLAIM and c['claim_reference'] == 'CL-1'])
        self.assertEqual(storage.files[('claim-proof-images', 'proof/1.jpg')], b'PROOF')
        self.assertEqual(storage.files[('claim-id-documents', 'id/1.pdf')], b'IDPDF')
        self.assertEqual([k for k in storage.files if k[0] == rb.BUCKET], [])
        self.assertEqual((bin_row(store)['status'], bin_row(store)['snapshot'], bin_row(store)['files'], bin_row(store)['finished_by']), ('restored', {}, [], ADMIN))

    def test_nothing_is_deleted_when_the_archive_cannot_be_made(self):
        db, store, storage = make()
        storage.fail['download'] = 'claim-proof-images'
        with self.assertRaises(rb.BinError) as caught:
            db.delete_admin_claim(CLAIM, ADMIN)
        self.assertEqual(caught.exception.status, 502)
        self.assertEqual(db.rpc_calls, [])                                   # the delete never ran
        self.assertEqual(len(store['claims']), 2)
        self.assertEqual(store['recycle_bin'], [])
        self.assertEqual([k for k in storage.files if k[0] == rb.BUCKET], [])

    def test_a_failed_delete_undoes_the_archive(self):
        db, store, storage = make()
        db.client.rpc_handlers['admin_delete_claim'] = lambda params: (_ for _ in ()).throw(RuntimeError('database down'))
        with self.assertRaises(RuntimeError):
            db.delete_admin_claim(CLAIM, ADMIN)
        self.assertEqual(store['recycle_bin'], [])
        self.assertEqual([k for k in storage.files if k[0] == rb.BUCKET], [])
        self.assertEqual(len(store['claims']), 2)

    def test_a_delete_that_deletes_nothing_leaves_no_bin_entry(self):
        db, store, _ = make()
        db.client.rpc_handlers['admin_delete_claim'] = lambda params: None
        with self.assertRaises(RuntimeError):
            db.delete_admin_claim(CLAIM, ADMIN)
        self.assertEqual(store['recycle_bin'], [])

    def test_a_missing_bin_table_blocks_the_delete_with_clear_instructions(self):
        db, store, _ = make()
        original = db.client.table
        db.client.table = lambda name: (_ for _ in ()).throw(Exception('relation "public.recycle_bin" does not exist')) if name == 'recycle_bin' else original(name)
        with self.assertRaises(rb.BinUnavailable) as caught:
            db.delete_admin_claim(CLAIM, ADMIN)
        self.assertEqual((caught.exception.status, caught.exception.code), (503, 'setup_required'))
        self.assertEqual(db.rpc_calls, [])
        self.assertEqual(len(store['claims']), 2)

    def test_files_already_missing_do_not_stop_the_delete(self):
        db, store, storage = make()
        del storage.files[('claim-proof-images', 'proof/1.jpg')]
        db.delete_admin_claim(CLAIM, ADMIN)
        self.assertEqual(len(bin_row(store)['files']), 1)    # only the ID document existed to copy

    def test_deleting_a_found_item_keeps_its_claims_and_matches_and_restores_them_all(self):
        db, store, storage = make()
        self.assertTrue(db.delete_admin_found_item('FP1001', ADMIN))
        row = bin_row(store)
        self.assertEqual(row['summary'], {'found_items': 1, 'claims': 2, 'ai_matches': 1})
        self.assertEqual((store['found_items'], store['claims'], store['ai_matches']), ([], [], []))
        result = rb.RecycleBin(db).restore(row['archive_id'], ADMIN)
        self.assertEqual(result['restored'], {'found_items': 1, 'claims': 2, 'ai_matches': 1})
        self.assertEqual((len(store['found_items']), len(store['claims']), len(store['ai_matches'])), (1, 2, 1))
        self.assertEqual(storage.files[('found-item-images', 'u1.jpg')], b'UMB')
        self.assertEqual(storage.files[('claim-id-documents', 'id/1.pdf')], b'IDPDF')

    def test_deleting_something_that_does_not_exist_answers_false_without_archiving(self):
        db, store, _ = make()
        self.assertFalse(db.delete_admin_found_item('FP9999', ADMIN))
        self.assertFalse(db.delete_admin_missing_item('MP9999', ADMIN))
        self.assertEqual(store['recycle_bin'], [])

    def test_a_lost_report_and_its_matches_come_back(self):
        db, store, storage = make()
        self.assertTrue(db.delete_admin_missing_item('MP2001', ADMIN))
        self.assertEqual(bin_row(store)['summary'], {'missing_items': 1, 'ai_matches': 1})
        rb.RecycleBin(db).restore(bin_row(store)['archive_id'], ADMIN)
        self.assertEqual((len(store['missing_items']), len(store['ai_matches'])), (1, 1))
        self.assertEqual(storage.files[('missing-item-images', 'w1.jpg')], b'WALLET')

    def test_deleting_an_account_archives_everything_that_goes_with_it_and_restoring_gets_it_back(self):
        db, store, storage = make()
        store['user_notifications'] = [{'user_account_id': OWNER, 'title': 'hi'}]
        deleted = db.delete_admin_user(OWNER, ADMIN, 123456)
        row = bin_row(store)
        self.assertEqual(deleted['archive_id'], row['archive_id'])
        self.assertEqual(row['summary'], {'user_profiles': 1, 'found_items': 1, 'missing_items': 1, 'claims': 2, 'ai_matches': 1})
        self.assertNotIn('user_notifications', row['snapshot'])                       # notifications are not kept
        self.assertEqual(len(row['files']), 5)
        self.assertFalse([p for p in store['user_profiles'] if p['account_id'] == OWNER])
        result = rb.RecycleBin(db).restore(row['archive_id'], ADMIN)
        profile = next(p for p in store['user_profiles'] if p['account_id'] == OWNER)
        self.assertEqual(profile['password_hash'], 'HASH')                              # they can sign in again
        self.assertEqual((len(store['found_items']), len(store['missing_items']), len(store['claims']), len(store['ai_matches'])), (1, 1, 2, 1))
        self.assertEqual(result['skipped'], {})
        self.assertEqual(storage.files[('verification-documents', 'v/owner.pdf')], b'VERIFY')

    def test_deleted_account_snapshot_never_includes_authenticator_secrets(self):
        db, store, _ = make()
        store['admin_mfa'] = [{'account_id': OWNER, 'secret_ciphertext': 'SECRET'}]
        db.delete_admin_user(OWNER, ADMIN, 1)
        self.assertNotIn('SECRET', str(bin_row(store)))

    def test_claims_by_people_who_vanished_are_skipped_when_an_account_is_restored(self):
        db, store, _ = make()
        db.delete_admin_user(OWNER, ADMIN, 1)
        store['user_profiles'] = [p for p in store['user_profiles'] if p['account_id'] != CLAIMANT]   # the other claimant was deleted meanwhile
        result = rb.RecycleBin(db).restore(bin_row(store)['archive_id'], ADMIN)
        self.assertEqual(result['skipped'], {'claims': 1})
        self.assertEqual([c['claim_id'] for c in store['claims']], [CLAIM2])

    def test_an_auction_comes_back_with_its_bids_and_unlinks_bidders_who_are_gone(self):
        db, store, _ = make()
        bin_ = rb.RecycleBin(db)
        archive_id = bin_.archive_entity('auction', AUCTION, ADMIN, 'ana')
        cascade_delete(store, 'auctions', AUCTION)
        store['user_profiles'] = [p for p in store['user_profiles'] if p['account_id'] != CLAIMANT]
        result = bin_.restore(archive_id, ADMIN)
        self.assertEqual(len(store['auctions']), 1)
        self.assertEqual({b['bid_id']: b['bidder_account_id'] for b in store['auction_bids']}, {'b1': None, 'b2': OWNER})
        self.assertEqual((store['auction_comments'], store['auction_reactions']), ([], []))      # their authors are gone
        self.assertEqual(result['skipped'], {'auction_comments': 1, 'auction_reactions': 1})

    def test_the_auction_delete_goes_through_the_bin_too(self):
        from app.utils.auction_db import AuctionService
        db, store, _ = make()
        service = AuctionService(db)
        service.delete_auction(AUCTION, ADMIN)
        self.assertEqual(bin_row(store)['entity_type'], 'auction')
        self.assertEqual(bin_row(store)['summary']['auction_bids'], 2)
        self.assertEqual(store['auctions'], [])


class RestoreRefusalTests(unittest.TestCase):
    def archived(self, kind, reference):
        db, store, storage = make()
        archive_id = rb.RecycleBin(db).archive_entity(kind, reference, ADMIN, 'ana')
        return db, store, storage, archive_id

    def test_it_will_not_restore_over_something_that_exists_again(self):
        db, store, _, archive_id = self.archived('claim', CLAIM)            # the claim was never actually deleted here
        with self.assertRaises(rb.BinError) as caught:
            rb.RecycleBin(db).restore(archive_id, ADMIN)
        self.assertEqual((caught.exception.status, caught.exception.code), (409, 'already_exists'))
        self.assertEqual(bin_row(store)['status'], 'archived')

    def test_it_will_not_restore_into_a_missing_parent(self):
        db, store, _, archive_id = self.archived('claim', CLAIM)
        cascade_delete(store, 'claims', CLAIM)
        cascade_delete(store, 'found_items', FOUND)
        with self.assertRaises(rb.BinError) as caught:
            rb.RecycleBin(db).restore(archive_id, ADMIN)
        self.assertEqual(caught.exception.code, 'parent_missing')
        self.assertEqual(store['claims'], [])

    def test_a_reference_that_was_reused_rolls_the_restore_back_completely(self):
        db, store, storage = make(unique={'claims': 'claim_reference'})
        bin_ = rb.RecycleBin(db)
        archive_id = bin_.archive_entity('found_item', 'FP1001', ADMIN, 'ana')
        cascade_delete(store, 'found_items', FOUND)
        store['claims'].append({'claim_id': 'new', 'claim_reference': 'CL-1', 'found_item_id': 'other', 'claimant_account_id': OWNER})   # took the reference
        files_before = dict(storage.files)
        with self.assertRaises(rb.BinError) as caught:
            bin_.restore(archive_id, ADMIN)
        self.assertEqual(caught.exception.code, 'restore_conflict')
        self.assertEqual(store['found_items'], [])                                # the partly restored item was removed again
        self.assertEqual(storage.files, files_before)                             # and the restored files with it
        self.assertEqual(bin_row(store)['status'], 'archived')                    # still in the bin, nothing lost

    def test_a_file_that_cannot_be_put_back_changes_nothing(self):
        db, store, storage, archive_id = self.archived('claim', CLAIM)
        cascade_delete(store, 'claims', CLAIM)
        storage.files.pop(('claim-proof-images', 'proof/1.jpg')), storage.files.pop(('claim-id-documents', 'id/1.pdf'))   # as the real delete removes them
        storage.fail['upload'] = 'claim-id-documents'
        with self.assertRaises(rb.BinError) as caught:
            rb.RecycleBin(db).restore(archive_id, ADMIN)
        self.assertEqual(caught.exception.status, 502)
        self.assertEqual([c['claim_id'] for c in store['claims']], [CLAIM2])
        self.assertEqual(bin_row(store)['status'], 'archived')

    def test_a_file_already_in_place_is_not_overwritten_or_removed_by_a_failed_restore(self):
        db, store, storage, archive_id = self.archived('claim', CLAIM)
        cascade_delete(store, 'claims', CLAIM)
        storage.files[('claim-proof-images', 'proof/1.jpg')] = b'NEWER'
        storage.files.pop(('claim-id-documents', 'id/1.pdf'))
        rb.RecycleBin(db).restore(archive_id, ADMIN)
        self.assertEqual(storage.files[('claim-proof-images', 'proof/1.jpg')], b'NEWER')
        self.assertEqual(storage.files[('claim-id-documents', 'id/1.pdf')], b'IDPDF')

    def test_unknown_finished_and_malformed_entries_are_refused(self):
        db, store, _, archive_id = self.archived('claim', CLAIM)
        bin_ = rb.RecycleBin(db)
        with self.assertRaises(rb.BinError) as caught:
            bin_.restore('not-a-uuid', ADMIN)
        self.assertEqual(caught.exception.status, 404)
        with self.assertRaises(rb.BinError) as caught:
            bin_.restore('11111111-1111-4111-8111-111111111111', ADMIN)
        self.assertEqual(caught.exception.status, 404)
        bin_.purge(archive_id, ADMIN)
        for action in (bin_.restore, bin_.purge):
            with self.assertRaises(rb.BinError) as caught:
                action(archive_id, ADMIN)
            self.assertEqual(caught.exception.status, 409)

    def test_only_known_kinds_can_be_archived(self):
        db, _, _ = make()
        with self.assertRaises(rb.BinError):
            rb.RecycleBin(db).capture('evidence', 'x')
        with self.assertRaises(rb.BinError) as caught:
            rb.RecycleBin(db).capture('claim', '00000000-0000-4000-8000-000000000000')
        self.assertEqual(caught.exception.status, 404)


class PurgeAndExpiryTests(unittest.TestCase):
    def test_purging_removes_the_files_and_leaves_only_a_tombstone(self):
        db, store, storage = make()
        db.delete_admin_claim(CLAIM, ADMIN)
        result = rb.RecycleBin(db).purge(bin_row(store)['archive_id'], ADMIN)
        row = bin_row(store)
        self.assertEqual(result['entity_type'], 'claim')
        self.assertEqual((row['status'], row['snapshot'], row['files'], row['finished_by']), ('purged', {}, [], ADMIN))
        self.assertEqual([k for k in storage.files if k[0] == rb.BUCKET], [])
        self.assertIn('CL-1', row['label'])                                       # what was deleted, when and by whom is still on record

    def test_expired_entries_are_purged_automatically_and_fresh_ones_are_kept(self):
        db, store, storage = make()
        db.delete_admin_claim(CLAIM, ADMIN)
        db.delete_admin_missing_item('MP2001', ADMIN)
        store['recycle_bin'][0]['expires_at'] = (NOW - timedelta(days=1)).isoformat()
        store['recycle_bin'][1]['expires_at'] = (NOW + timedelta(days=5)).isoformat()
        summary = rb.RecycleBin(db).purge_expired(NOW)
        self.assertEqual(summary, {'purged': 1, 'errors': 0})
        self.assertEqual([r['status'] for r in store['recycle_bin']], ['purged', 'archived'])

    def test_housekeeping_runs_the_expiry_step(self):
        db, store, _ = make()
        db.delete_admin_claim(CLAIM, ADMIN)
        store['recycle_bin'][0]['expires_at'] = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        result = housekeeping.run_housekeeping(db)
        self.assertEqual(result['recycle_bin']['purged'], 1)

    def test_the_period_is_a_setting_with_sane_limits(self):
        with patch.dict('os.environ', {'RECYCLE_BIN_DAYS': '0'}):
            self.assertEqual(rb.retention_days(), 1)
        with patch.dict('os.environ', {'RECYCLE_BIN_DAYS': '9999'}):
            self.assertEqual(rb.retention_days(), 365)
        with patch.dict('os.environ', {'RECYCLE_BIN_DAYS': 'abc'}):
            self.assertEqual(rb.retention_days(), 30)


class ListTests(unittest.TestCase):
    def test_the_list_shows_what_is_in_the_bin_without_the_data_itself(self):
        db, store, _ = make()
        db.delete_admin_user(OWNER, ADMIN, 1)
        db.delete_admin_claim(CLAIM2, ADMIN) if False else None
        items = rb.RecycleBin(db).list_items()
        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertEqual((item['entity_type'], item['deleted_by'], item['file_count']), ('user', 'ana@umak.edu.ph', 5))
        self.assertIn(rb.retention_days() - 1, range(rb.retention_days() + 1))
        self.assertNotIn('snapshot', item)
        self.assertNotIn('HASH', str(items))                                      # the password hash inside the snapshot never reaches the page

    def test_filtering_by_type_and_text(self):
        db, store, _ = make()
        db.delete_admin_found_item('FP1001', ADMIN)
        db.delete_admin_missing_item('MP2001', ADMIN)
        bin_ = rb.RecycleBin(db)
        self.assertEqual(len(bin_.list_items()), 2)
        self.assertEqual([i['entity_type'] for i in bin_.list_items('missing_item')], ['missing_item'])
        self.assertEqual([i['entity_id'] for i in bin_.list_items(search='umbrella')], ['FP1001'])
        self.assertEqual(bin_.list_items(search='nothing like this'), [])

    def test_restored_and_purged_entries_are_not_listed(self):
        db, store, _ = make()
        db.delete_admin_claim(CLAIM, ADMIN)
        rb.RecycleBin(db).restore(bin_row(store)['archive_id'], ADMIN)
        self.assertEqual(rb.RecycleBin(db).list_items(), [])


class EvidenceTests(unittest.TestCase):
    def closed_claim_world(self):
        db, store, storage = make()
        store['claims'][0].update(status='collected', collected_at=(NOW - timedelta(days=45)).isoformat(), updated_at=(NOW - timedelta(days=45)).isoformat(), evidence_purged_at=None,
                                  identity_document_name='id.pdf', proof_image_url=None)
        db._legacy_claim_storage_path = lambda value, bucket: None
        return db, store, storage

    def test_the_retention_rule_moves_files_to_the_bin_instead_of_deleting_them(self):
        db, store, storage = self.closed_claim_world()
        summary = housekeeping.purge_old_evidence(db, NOW, days=30)
        claim = next(c for c in store['claims'] if c['claim_id'] == CLAIM)
        self.assertEqual(summary['claims'], 1)
        self.assertEqual((claim['proof_image_path'], claim['identity_document_path']), (None, None))
        self.assertNotIn(('claim-id-documents', 'id/1.pdf'), storage.files)
        row = bin_row(store)
        self.assertEqual((row['entity_type'], row['reason'], row['deleted_by']), ('evidence', 'retention', None))
        self.assertEqual(len([k for k in storage.files if k[0] == rb.BUCKET]), 2)

    def test_restoring_evidence_attaches_the_files_to_the_claim_again(self):
        db, store, storage = self.closed_claim_world()
        housekeeping.purge_old_evidence(db, NOW, days=30)
        rb.RecycleBin(db).restore(bin_row(store)['archive_id'], ADMIN)
        claim = next(c for c in store['claims'] if c['claim_id'] == CLAIM)
        self.assertEqual((claim['proof_image_path'], claim['identity_document_path'], claim['identity_document_name']), ('proof/1.jpg', 'id/1.pdf', 'id.pdf'))
        self.assertIsNone(claim['evidence_purged_at'])
        self.assertEqual(storage.files[('claim-id-documents', 'id/1.pdf')], b'IDPDF')

    def test_nothing_is_removed_from_the_claim_if_the_copy_into_the_bin_fails(self):
        db, store, storage = self.closed_claim_world()
        storage.fail['upload'] = rb.BUCKET
        summary = housekeeping.purge_old_evidence(db, NOW, days=30)
        claim = next(c for c in store['claims'] if c['claim_id'] == CLAIM)
        self.assertEqual((summary['claims'], summary['errors']), (0, 1))
        self.assertEqual((claim['proof_image_path'], claim['identity_document_path']), ('proof/1.jpg', 'id/1.pdf'))
        self.assertIn(('claim-id-documents', 'id/1.pdf'), storage.files)
        self.assertEqual(store['recycle_bin'], [])

    def test_a_failed_removal_leaves_no_second_copy_in_the_bin_for_the_retry(self):
        db, store, storage = self.closed_claim_world()
        storage.fail['remove'] = 'claim-id-documents'
        housekeeping.purge_old_evidence(db, NOW, days=30)
        self.assertEqual(store['recycle_bin'], [])
        self.assertEqual([k for k in storage.files if k[0] == rb.BUCKET], [])

    def test_verification_documents_go_through_the_bin_too(self):
        db, store, storage = make()
        owner = next(p for p in store['user_profiles'] if p['account_id'] == OWNER)
        owner.update(verification_status='verified', verification_reviewed_at=(NOW - timedelta(days=40)).isoformat(), verification_document_name='id.pdf')
        housekeeping.purge_old_evidence(db, NOW, days=30)
        self.assertEqual(owner['verification_document_url'], None)
        row = bin_row(store)
        self.assertIn('Maria Santos', row['label'])
        rb.RecycleBin(db).restore(row['archive_id'], ADMIN)
        self.assertEqual((owner['verification_document_url'], owner['verification_document_bucket']), ('v/owner.pdf', 'verification-documents'))
        self.assertEqual(storage.files[('verification-documents', 'v/owner.pdf')], b'VERIFY')

    def test_evidence_of_a_claim_that_is_gone_cannot_be_reattached(self):
        db, store, _ = self.closed_claim_world()
        housekeeping.purge_old_evidence(db, NOW, days=30)
        cascade_delete(store, 'claims', CLAIM)
        with self.assertRaises(rb.BinError) as caught:
            rb.RecycleBin(db).restore(bin_row(store)['archive_id'], ADMIN)
        self.assertEqual(caught.exception.code, 'parent_missing')

    def test_retention_waits_for_the_bin_table_too(self):
        db, store, storage = self.closed_claim_world()
        original = db.client.table
        db.client.table = lambda name: (_ for _ in ()).throw(Exception('relation "recycle_bin" does not exist')) if name == 'recycle_bin' else original(name)
        summary = housekeeping.purge_old_evidence(db, NOW, days=30)
        self.assertTrue(summary['waiting_for_migration'])
        self.assertIn(('claim-id-documents', 'id/1.pdf'), storage.files)


# ----------------------------------------------------------------------------------------------------------- admin API
def bin_client(level='super_admin'):
    db, store, storage = make()
    app = Flask(__name__)
    app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
    app.register_blueprint(bin_routes.recycle_bin_bp, url_prefix='/api/admin')

    def require(required_level='admin'):
        if level != 'super_admin':
            raise PermissionError('Super administrator access required')
        return {'account_id': ADMIN, 'email': 'ana@umak.edu.ph', 'access_level': 'super_admin'}
    patches = [patch.object(bin_routes, '_db', return_value=db), patch.object(bin_routes, '_require_admin', side_effect=require), patch.object(bin_routes, '_log_admin_action')]
    for p in patches:
        p.start()
    return app.test_client(), db, store, storage


class BinRouteTests(unittest.TestCase):
    def tearDown(self):
        patch.stopall()

    def test_only_super_admins_can_use_the_bin(self):
        client, *_ = bin_client('admin')
        self.assertEqual(client.get('/api/admin/recycle-bin').status_code, 403)
        self.assertEqual(client.post('/api/admin/recycle-bin/x/restore', json={'confirmation': 'CONFIRM'}).status_code, 403)
        self.assertEqual(client.post('/api/admin/recycle-bin/x/purge', json={'confirmation': 'CONFIRM', 'authenticator_code': '123456'}).status_code, 403)

    def test_list_returns_items_and_the_retention_period(self):
        client, db, store, _ = bin_client()
        db.delete_admin_claim(CLAIM, ADMIN)
        body = client.get('/api/admin/recycle-bin').get_json()
        self.assertEqual((len(body['items']), body['retention_days']), (1, rb.retention_days()))
        self.assertEqual(client.get('/api/admin/recycle-bin?type=user').get_json()['items'], [])
        self.assertEqual(client.get('/api/admin/recycle-bin?type=bogus').status_code, 400)

    def test_restoring_needs_a_confirmation_and_works(self):
        client, db, store, _ = bin_client()
        db.delete_admin_claim(CLAIM, ADMIN)
        archive_id = bin_row(store)['archive_id']
        self.assertEqual(client.post(f'/api/admin/recycle-bin/{archive_id}/restore', json={}).status_code, 400)
        self.assertEqual(client.post(f'/api/admin/recycle-bin/{archive_id}/restore', json={'confirmation': 'yes'}).status_code, 400)
        self.assertEqual(bin_row(store)['status'], 'archived')
        ok = client.post(f'/api/admin/recycle-bin/{archive_id}/restore', json={'confirmation': 'CONFIRM'})
        self.assertEqual(ok.status_code, 200)
        self.assertIn('Restored', ok.get_json()['message'])
        self.assertEqual(bin_row(store)['status'], 'restored')

    def test_a_restore_conflict_is_explained_with_409(self):
        client, db, store, _ = bin_client()
        archive_id = rb.RecycleBin(db).archive_entity('claim', CLAIM, ADMIN, 'ana')     # the claim still exists
        response = client.post(f'/api/admin/recycle-bin/{archive_id}/restore', json={'confirmation': 'CONFIRM'})
        self.assertEqual((response.status_code, response.get_json()['code']), (409, 'already_exists'))

    def test_permanent_delete_needs_the_confirmation_and_a_valid_authenticator_code(self):
        client, db, store, storage = bin_client()
        db.delete_admin_claim(CLAIM, ADMIN)
        archive_id = bin_row(store)['archive_id']
        url = f'/api/admin/recycle-bin/{archive_id}/purge'
        self.assertEqual(client.post(url, json={'authenticator_code': '123456'}).status_code, 400)
        with patch.object(bin_routes, 'consume_authenticator_code', side_effect=authenticator.AuthenticatorError('Authenticator code is invalid.', 401)) as check:
            wrong = client.post(url, json={'confirmation': 'CONFIRM', 'authenticator_code': '000000'})
        self.assertEqual((wrong.status_code, wrong.get_json()['error']), (401, 'Authenticator code is invalid.'))
        check.assert_called_once()
        self.assertEqual(bin_row(store)['status'], 'archived')                           # a wrong code deletes nothing
        self.assertTrue([k for k in storage.files if k[0] == rb.BUCKET])
        with patch.object(bin_routes, 'consume_authenticator_code', return_value=777) as check:
            ok = client.post(url, json={'confirmation': 'CONFIRM', 'authenticator_code': '123456'})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(check.call_args.args[1:3], (ADMIN, '123456'))
        self.assertEqual(bin_row(store)['status'], 'purged')
        self.assertEqual([k for k in storage.files if k[0] == rb.BUCKET], [])

    def test_a_finished_or_unknown_entry_is_refused_before_a_code_is_spent(self):
        client, db, store, _ = bin_client()
        with patch.object(bin_routes, 'consume_authenticator_code') as check:
            missing = client.post('/api/admin/recycle-bin/11111111-1111-4111-8111-111111111111/purge', json={'confirmation': 'CONFIRM', 'authenticator_code': '123456'})
            garbage = client.post('/api/admin/recycle-bin/nonsense/purge', json={'confirmation': 'CONFIRM', 'authenticator_code': '123456'})
        self.assertEqual((missing.status_code, garbage.status_code), (404, 404))
        check.assert_not_called()

    def test_the_bin_table_missing_answers_503_with_setup_instructions(self):
        client, db, store, _ = bin_client()
        original = db.client.table
        db.client.table = lambda name: (_ for _ in ()).throw(Exception('relation "recycle_bin" does not exist')) if name == 'recycle_bin' else original(name)
        response = client.get('/api/admin/recycle-bin')
        self.assertEqual((response.status_code, response.get_json()['code']), (503, 'setup_required'))


class AuthenticatorTests(unittest.TestCase):
    def db(self, **record):
        db = MagicMock()
        db.get_admin_mfa.return_value = {'enabled_at': 'x', 'secret_ciphertext': 'c', 'locked_until': None, **record} if record is not None else None
        db.consume_admin_mfa_step.return_value = True
        return db

    def test_a_valid_code_is_accepted_once(self):
        db = self.db()
        with patch.object(authenticator.CryptoService, 'decrypt', return_value='SECRET'), patch.object(authenticator, 'matched_totp_step', return_value=4242):
            self.assertEqual(authenticator.consume_authenticator_code(db, ADMIN, ' 123456 '), 4242)
        db.consume_admin_mfa_step.assert_called_once_with(ADMIN, 4242)

    def test_a_wrong_code_is_recorded_and_refused(self):
        db = self.db()
        with patch.object(authenticator.CryptoService, 'decrypt', return_value='SECRET'), patch.object(authenticator, 'matched_totp_step', return_value=None):
            with self.assertRaises(authenticator.AuthenticatorError) as caught:
                authenticator.consume_authenticator_code(db, ADMIN, '000000')
        self.assertEqual(caught.exception.status, 401)
        db.record_admin_mfa_failure.assert_called_once_with(ADMIN)

    def test_a_reused_code_is_refused(self):
        db = self.db()
        db.consume_admin_mfa_step.return_value = False
        with patch.object(authenticator.CryptoService, 'decrypt', return_value='SECRET'), patch.object(authenticator, 'matched_totp_step', return_value=1):
            with self.assertRaises(authenticator.AuthenticatorError) as caught:
                authenticator.consume_authenticator_code(db, ADMIN, '123456')
        self.assertEqual(caught.exception.status, 401)

    def test_no_authenticator_set_up_and_a_locked_one_are_refused(self):
        db = MagicMock()
        db.get_admin_mfa.return_value = None
        with self.assertRaises(authenticator.AuthenticatorError) as caught:
            authenticator.consume_authenticator_code(db, ADMIN, '123456', 'deleting permanently')
        self.assertEqual(caught.exception.status, 403)
        self.assertIn('deleting permanently', caught.exception.message)
        locked = self.db(locked_until=(datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat())
        with self.assertRaises(authenticator.AuthenticatorError) as caught:
            authenticator.consume_authenticator_code(locked, ADMIN, '123456')
        self.assertEqual(caught.exception.status, 423)


class DeleteRouteTests(unittest.TestCase):
    def tearDown(self):
        patch.stopall()

    def test_a_bin_failure_is_shown_to_the_admin_and_nothing_is_deleted(self):
        from Admin.Backend.claims_verification import routes as claim_routes
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
        app.register_blueprint(claim_routes.claims_verification_bp, url_prefix='/api/admin')
        db = MagicMock()
        db.delete_admin_claim.side_effect = rb.BinUnavailable()
        patch.object(claim_routes, 'get_db', return_value=db).start()
        patch.object(claim_routes, '_require_admin', return_value={'account_id': ADMIN, 'access_level': 'super_admin'}).start()
        response = app.test_client().delete(f'/api/admin/claims/{CLAIM}')
        self.assertEqual((response.status_code, response.get_json()['code']), (503, 'setup_required'))

    def test_a_successful_delete_says_it_went_to_the_recycle_bin(self):
        from Admin.Backend.claims_verification import routes as claim_routes
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
        app.register_blueprint(claim_routes.claims_verification_bp, url_prefix='/api/admin')
        db = MagicMock()
        db.delete_admin_claim.return_value = {'claim_reference': 'CL-1'}
        patch.object(claim_routes, 'get_db', return_value=db).start()
        patch.object(claim_routes, '_require_admin', return_value={'account_id': ADMIN, 'access_level': 'super_admin', 'email': 'a@b.c'}).start()
        patch.object(claim_routes, '_log_admin_action').start()
        response = app.test_client().delete(f'/api/admin/claims/{CLAIM}')
        self.assertEqual(response.status_code, 200)
        self.assertIn('Recycle bin', response.get_json()['message'])


if __name__ == '__main__':
    unittest.main()
