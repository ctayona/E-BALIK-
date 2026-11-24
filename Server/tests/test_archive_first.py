"""Archive-first policies preserve custody and reject premature admin deletion."""
import unittest
from memdb import MemClient
from app.utils.archive import set_archived, require_archived, ArchiveError


class ArchiveFirstTests(unittest.TestCase):
    def test_archive_and_restore_custody_preserve_status_and_relationships(self):
        row = dict(fpost_id='FP1', status='ready_to_release', item_id='found1',
                   turnover_location='Office safe', archived_at=None)
        claim = dict(claim_id='claim1', found_item_id='found1', status='approved_for_pickup')
        client = MemClient(dict(found_items=[row], claims=[claim]))
        with self.assertRaises(ArchiveError) as caught:
            require_archived(client, 'found', 'FP1')
        self.assertEqual(caught.exception.code, 'archive_required')
        set_archived(client, 'found', 'FP1', 'admin', True)
        require_archived(client, 'found', 'FP1')
        self.assertEqual(row['status'], 'ready_to_release')
        self.assertEqual(row['turnover_location'], 'Office safe')
        self.assertEqual(claim['status'], 'approved_for_pickup')
        set_archived(client, 'found', 'FP1', 'admin', False)
        self.assertIsNone(row['archived_at'])

    def test_accounts_and_registered_tags_require_deactivation(self):
        client = MemClient(dict(user_profiles=[dict(account_id='u', is_active=True, archived_at=None)],
                               smart_tags=[dict(tag_id='t', status='active', is_disabled=False, archived_at=None)]))
        for kind, reference in [('user', 'u'), ('tag', 't')]:
            with self.assertRaises(ArchiveError):
                set_archived(client, kind, reference, 'admin', True)

    def test_disabled_tag_archives_without_changing_owner_or_status(self):
        row = dict(tag_id='tag', status='lost', is_disabled=True, owner_account_id='owner', archived_at=None)
        client = MemClient(dict(smart_tags=[row]))
        set_archived(client, 'tag', 'tag', 'admin', True)
        require_archived(client, 'tag', 'tag')
        self.assertEqual((row['owner_account_id'], row['status']), ('owner', 'lost'))

    def test_missing_delete_migration_blocks_storage_snapshot(self):
        from test_recycle_bin import make, ADMIN
        from app.utils.recycle_bin import BinError
        db, store, storage = make()
        store['migration_log'] = []
        before = dict(storage.files)
        with self.assertRaises(BinError) as caught:
            db.delete_admin_found_item('FP1001', ADMIN)
        self.assertEqual(caught.exception.code, 'setup_required')
        self.assertEqual(storage.files, before)
        self.assertFalse(store.get('recycle_bin'))
