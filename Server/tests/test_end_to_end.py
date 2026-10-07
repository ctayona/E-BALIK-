"""Whole-journey checks that chain the pieces together on one in-memory database: report -> custody -> claim -> release -> completed -> archive,
and sale -> pickup -> complete -> archive. Each step uses the real service code; only the database functions (RPCs) are simulated."""
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT.parent, ROOT / 'tests'):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from memdb import MemClient  # noqa: E402
from app.utils import archive, custody  # noqa: E402
from app.utils.auction_db import AuctionService  # noqa: E402
from app.utils.supabase_db import SupabaseDB  # noqa: E402

NOW = datetime.now(timezone.utc)
OWNER, FINDER, GUARD, ADMIN = 'owner-1', 'finder-1', 'guard-1', 'admin-1'
WINNER = 'winner-1'


def iso(days_ago=0.0):
    return (NOW - timedelta(days=days_ago)).isoformat()


def make_world():
    store = {
        'user_profiles': [
            {'account_id': OWNER, 'fname': 'Maria', 'lname': 'Santos', 'email': 'maria@umak.edu.ph', 'access_level': 'user', 'is_active': True},
            {'account_id': FINDER, 'fname': 'Fina', 'lname': 'Reyes', 'email': 'fina@umak.edu.ph', 'access_level': 'user', 'is_active': True},
            {'account_id': GUARD, 'fname': 'Gio', 'lname': 'Guard', 'email': 'gio@umak.edu.ph', 'access_level': 'guard', 'is_active': True},
            {'account_id': ADMIN, 'fname': 'Ana', 'lname': 'Admin', 'email': 'ana@umak.edu.ph', 'access_level': 'admin', 'is_active': True},
            {'account_id': WINNER, 'fname': 'Juan', 'lname': 'Cruz', 'email': 'juan@umak.edu.ph', 'access_level': 'user', 'is_active': True},
        ],
        'found_items': [{'item_id': 'F1', 'fpost_id': 'FP1001', 'item_name': 'Black wallet', 'category': 'Personal Effects', 'description': 'Black leather wallet with a red zipper',
                         'location': 'Library', 'found_date': '2026-10-01', 'status': 'unclaimed', 'account_id': FINDER, 'reporter_account_id': FINDER, 'created_at': iso(5),
                         'turnover_location': 'Main Security Office', 'guard_name_or_id': 'Gio Guard', 'handover_guard_id': GUARD},
                        {'item_id': 'F2', 'fpost_id': 'FP1002', 'item_name': 'Steel bottle', 'category': 'Others', 'description': 'Steel bottle', 'location': 'Gym',
                         'found_date': '2026-08-01', 'status': 'auctioned', 'account_id': FINDER, 'reporter_account_id': FINDER, 'created_at': iso(70)}],
        'missing_items': [{'item_id': 'M1', 'mpost_id': 'MP1001', 'account_id': OWNER, 'reporter_account_id': OWNER, 'item_name': 'Black wallet', 'category': 'Personal Effects',
                           'description': 'Black leather wallet red zipper', 'last_location': 'Library', 'last_seen_date': '2026-10-01', 'status': 'missing'}],
        'claims': [{'claim_id': 'C1', 'found_item_id': 'F1', 'claimant_account_id': OWNER, 'status': 'pending', 'missing_report_id': 'M1'}],
        'auctions': [{'auction_id': 'A1', 'found_item_id': 'F2', 'item_reference': 'FP1002', 'title': 'Steel bottle', 'status': 'ended', 'fulfillment_status': 'awaiting_pickup',
                      'winner_account_id': WINNER, 'winning_amount': 300, 'starting_price': 100, 'bid_increment': 100, 'current_price': 300, 'bid_count': 2,
                      'starts_at': iso(10), 'ends_at': iso(3), 'winner_notified_at': iso(1), 'created_at': iso(11)}],
        'ai_matches': [], 'user_notifications': [],
    }

    def transition(params):
        claim = next(c for c in store['claims'] if c['claim_id'] == params['p_claim_id'])
        status = params['p_status']
        claim['status'] = status
        if status == 'collected':
            next(f for f in store['found_items'] if f['item_id'] == claim['found_item_id'])['status'] = 'returned'
        return dict(claim)
    db = SupabaseDB.__new__(SupabaseDB)
    db.client = MemClient(store, rpc_handlers={'admin_update_claim_status': transition})
    db.create_user_notification = MagicMock(side_effect=lambda account, title, message, **k: store['user_notifications'].append({'to': account, 'title': title, 'page': k.get('link_page')}))
    return store, db


class LostAndFoundJourney(unittest.TestCase):
    def test_release_completes_everything_and_the_finished_records_can_be_archived(self):
        store, db = make_world()
        # 1. the office is holding the wallet and a claim waits for review
        before = custody.load_overview(db.client)
        self.assertEqual([(r['reference'], r['state']) for r in before['items'] if r['reference'] == 'FP1001'], [('FP1001', 'claim_review')])
        # 2. approve, then the guard releases it (the same status call the release desk makes)
        db.update_claim_status('C1', 'approved_for_pickup', ADMIN)
        self.assertEqual(next(r for r in custody.load_overview(db.client)['items'] if r['reference'] == 'FP1001')['state'], 'claim_approved')
        db.update_claim_status('C1', 'collected', GUARD)
        # 3. the item, the lost report and both people are brought up to date
        self.assertEqual(next(f for f in store['found_items'] if f['item_id'] == 'F1')['status'], 'returned')
        self.assertEqual(store['missing_items'][0]['status'], 'returned')
        titles = {(n['to'], n['title']) for n in store['user_notifications']}
        self.assertIn((OWNER, 'Your lost report is completed'), titles)
        self.assertIn((FINDER, 'The item you turned in reached its owner'), titles)
        self.assertTrue(all(n['page'] == 'my-reports' for n in store['user_notifications']))
        # 4. it has left custody
        self.assertNotIn('FP1001', [r['reference'] for r in custody.load_overview(db.client)['items']])
        # 5. every finished record can now be archived, and shows up flagged in the admin lists
        for kind, reference in (('lost', 'MP1001'), ('found', 'FP1001'), ('claim', 'C1')):
            archive.set_archived(db.client, kind, reference, ADMIN, True)
        self.assertTrue(db.list_admin_missing_items()[0]['archived'])
        self.assertTrue(next(r for r in db.list_admin_found_items() if r['id'] == 'FP1001')['archived'])
        # 6. and restoring brings them back
        archive.set_archived(db.client, 'lost', 'MP1001', ADMIN, False)
        self.assertFalse(db.list_admin_missing_items()[0]['archived'])

    def test_nothing_in_progress_can_be_archived_along_the_way(self):
        store, db = make_world()
        for kind, reference in (('lost', 'MP1001'), ('found', 'FP1001'), ('claim', 'C1')):
            with self.assertRaises(archive.ArchiveError, msg=reference):
                archive.set_archived(db.client, kind, reference, ADMIN, True)
        db.update_claim_status('C1', 'approved_for_pickup', ADMIN)
        with self.assertRaises(archive.ArchiveError):
            archive.set_archived(db.client, 'claim', 'C1', ADMIN, True)   # approved but not collected yet

    def test_a_second_claimant_loses_nothing_when_the_first_one_collects(self):
        store, db = make_world()
        store['claims'].append({'claim_id': 'C2', 'found_item_id': 'F1', 'claimant_account_id': WINNER, 'status': 'pending'})
        store['missing_items'].append({'item_id': 'M2', 'mpost_id': 'MP2001', 'account_id': WINNER, 'reporter_account_id': WINNER, 'item_name': 'Black wallet', 'category': 'Personal Effects',
                                       'description': 'Black leather wallet', 'last_location': 'Library', 'last_seen_date': '2026-10-01', 'status': 'missing'})
        db.update_claim_status('C1', 'approved_for_pickup', ADMIN)
        db.update_claim_status('C1', 'collected', GUARD)
        self.assertEqual(store['missing_items'][1]['status'], 'missing')   # the other person's lost report is left alone

    def test_the_sale_journey_from_awaiting_pickup_to_archived(self):
        store, db = make_world()
        service = AuctionService(db)
        db.get_user_by_account_id = lambda account_id: next((dict(p) for p in store['user_profiles'] if p['account_id'] == account_id), None)
        with patch.object(AuctionService, 'settle_and_notify'):
            listing = service.admin_list()
        self.assertEqual(listing['auctions'][0]['stage'], 'awaiting_pickup')
        self.assertEqual(next(r for r in custody.load_overview(db.client)['items'] if r['reference'] == 'FP1002')['state'], 'sold_pickup')
        with self.assertRaises(Exception):
            service.set_archived('A1', ADMIN, True)               # not finished yet
        service.set_fulfillment('A1', 'collected')                # the "Complete auction" button
        self.assertEqual(next(f for f in store['found_items'] if f['item_id'] == 'F2')['status'], 'returned')
        self.assertIn((FINDER, 'The item you turned in was sold'), {(n['to'], n['title']) for n in store['user_notifications']})
        with patch.object(AuctionService, 'settle_and_notify'):
            self.assertEqual(service.admin_list()['auctions'][0]['stage'], 'completed')
        service.set_archived('A1', ADMIN, True)
        with patch.object(AuctionService, 'settle_and_notify'):
            result = service.admin_list()
        self.assertEqual((result['auctions'][0]['archived'], result['stats']['archived'], result['stats']['completed']), (True, 1, 1))
        self.assertNotIn('FP1002', [r['reference'] for r in custody.load_overview(db.client)['items']])


if __name__ == '__main__':
    unittest.main()
