"""Report lifecycle sync (a released item finishes the reports around it), the custody overview, guard handover and role assignment."""
import io
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
from Admin.Backend.claims_verification import routes as admin_claim_routes  # noqa: E402
from Admin.Backend.found_items import routes as admin_found_routes  # noqa: E402
from Admin.Backend.shared import admin_access  # noqa: E402
from app.utils import custody, housekeeping, rate_limit  # noqa: E402
from app.utils.auction_db import AuctionService  # noqa: E402
from app.utils.report_lifecycle import ReportLifecycle, is_completed  # noqa: E402
from app.utils.supabase_db import SupabaseDB  # noqa: E402
from Users.Backend.claim import routes as user_claim_routes  # noqa: E402
from Users.Backend.found_item import routes as user_found_routes  # noqa: E402

NOW = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)
OWNER = '33333333-3333-4333-8333-333333333333'
OTHER = '44444444-4444-4444-8444-444444444444'
FINDER = '88888888-8888-4888-8888-888888888888'
GUARD = '99999999-9999-4999-8999-999999999999'
GUARD2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
ADMIN = '11111111-1111-4111-8111-111111111111'
PNG = b'\x89PNG\r\n\x1a\n' + b'0' * 64


def missing(item_id, ref, owner=OWNER, name='Black wallet', category='Personal Effects', description='Black leather wallet with a red zipper',
            location='Library', date='2026-10-01', status='missing'):
    return {'item_id': item_id, 'mpost_id': ref, 'account_id': owner, 'reporter_account_id': owner, 'item_name': name, 'category': category,
            'description': description, 'last_location': location, 'last_seen_date': date, 'status': status}


def make_store(claim_status='collected', missing_report_id=None, reports=None, found_status='returned', matches=()):
    return {
        'user_profiles': [
            {'account_id': OWNER, 'fname': 'Maria', 'lname': 'Santos', 'email': 'maria@umak.edu.ph', 'access_level': 'user', 'is_active': True},
            {'account_id': OTHER, 'fname': 'Juan', 'lname': 'Cruz', 'email': 'juan@umak.edu.ph', 'access_level': 'user', 'is_active': True},
            {'account_id': FINDER, 'fname': 'Fina', 'lname': 'Reyes', 'email': 'fina@umak.edu.ph', 'access_level': 'user', 'is_active': True},
            {'account_id': GUARD, 'fname': 'Gio', 'lname': 'Guard', 'email': 'gio@umak.edu.ph', 'access_level': 'guard', 'is_active': True},
            {'account_id': GUARD2, 'fname': 'Gail', 'lname': 'Gone', 'email': 'gail@umak.edu.ph', 'access_level': 'guard', 'is_active': False},
            {'account_id': ADMIN, 'fname': 'Ana', 'lname': 'Admin', 'email': 'ana@umak.edu.ph', 'access_level': 'admin', 'is_active': True},
        ],
        'found_items': [{'item_id': 'F1', 'fpost_id': 'FP1001', 'item_name': 'Black wallet', 'category': 'Personal Effects', 'description': 'Black leather wallet with a red zipper',
                         'location': 'Library', 'found_date': '2026-10-01', 'status': found_status, 'account_id': FINDER, 'reporter_account_id': FINDER}],
        'missing_items': reports if reports is not None else [missing('M1', 'MP1001')],
        'claims': [{'claim_id': 'C1', 'found_item_id': 'F1', 'claimant_account_id': OWNER, 'status': claim_status, 'missing_report_id': missing_report_id,
                    'collected_at': (NOW - timedelta(days=1)).isoformat()}],
        'ai_matches': list(matches),
        'user_notifications': [],
    }


def make_db(store, **client_kwargs):
    db = MagicMock()
    db.client = MemClient(store, **client_kwargs)
    db.create_user_notification.side_effect = lambda account, title, message, **k: store['user_notifications'].append(
        {'to': account, 'title': title, 'type': k.get('notification_type'), 'missing_report_id': k.get('missing_report_id'), 'link_page': k.get('link_page')})
    return db


def status_of(store, item_id):
    return next(r['status'] for r in store['missing_items'] if r['item_id'] == item_id)


def notices(store, title=None):
    return [n for n in store['user_notifications'] if title is None or n['title'] == title]


class CompletedStatusTests(unittest.TestCase):
    def test_which_statuses_count_as_finished(self):
        for status in ('returned', 'resolved', 'closed', 'RETURNED'):
            self.assertTrue(is_completed('missing', status))
        for status in ('missing', 'found', 'open', '', None):
            self.assertFalse(is_completed('missing', status))
        for status in ('returned', 'claimed', 'closed', 'collected'):
            self.assertTrue(is_completed('found', status))
        for status in ('unclaimed', 'review', 'auctioned', 'ready_to_release', None):
            self.assertFalse(is_completed('found', status))


class ClaimCollectionTests(unittest.TestCase):
    def run_sync(self, store, **kwargs):
        return ReportLifecycle(make_db(store, **kwargs)).complete_for_claim('C1')

    def test_the_lost_report_named_on_the_claim_is_completed_and_the_owner_is_told(self):
        store = make_store(missing_report_id='M1', reports=[missing('M1', 'MP1001', category='Electronics', location='Gym', date='2026-01-01', description='Silver phone')])
        result = self.run_sync(store)
        self.assertEqual(result['missing_closed'], ['MP1001'])
        self.assertEqual(status_of(store, 'M1'), 'returned')
        [notice] = notices(store, 'Your lost report is completed')
        self.assertEqual((notice['to'], notice['type'], notice['missing_report_id'], notice['link_page']), (OWNER, 'report_completed', 'M1', 'my-reports'))

    def test_a_report_an_administrator_confirmed_as_a_match_is_completed(self):
        store = make_store(reports=[missing('M1', 'MP1001', category='Electronics', location='Gym', date='2026-01-01', description='Silver phone')],
                           matches=[{'missing_item_id': 'M1', 'found_item_id': 'F1', 'status': 'confirmed'}])
        self.assertEqual(self.run_sync(store)['missing_closed'], ['MP1001'])

    def test_a_rejected_match_does_not_count(self):
        store = make_store(reports=[missing('M1', 'MP1001', category='Electronics', location='Gym', date='2026-01-01', description='Silver phone')],
                           matches=[{'missing_item_id': 'M1', 'found_item_id': 'F1', 'status': 'rejected'}])
        self.assertEqual(self.run_sync(store)['missing_closed'], [])
        self.assertEqual(status_of(store, 'M1'), 'missing')

    def test_with_no_link_the_one_strong_match_is_completed(self):
        store = make_store()
        self.assertEqual(self.run_sync(store)['missing_closed'], ['MP1001'])
        self.assertEqual(status_of(store, 'M1'), 'returned')

    def test_only_the_best_of_two_strong_matches_is_completed(self):
        store = make_store(reports=[missing('M1', 'MP1001'), missing('M2', 'MP1002', description='Wallet', date='2026-10-02')])
        self.assertEqual(self.run_sync(store)['missing_closed'], ['MP1001'])
        self.assertEqual((status_of(store, 'M1'), status_of(store, 'M2')), ('returned', 'missing'))

    def test_a_weak_match_is_left_open(self):
        store = make_store(reports=[missing('M1', 'MP1001', name='Silver phone', category='Electronics', location='Gym', date='2026-01-01', description='Cracked screen')])
        self.assertEqual(self.run_sync(store)['missing_closed'], [])
        self.assertEqual(status_of(store, 'M1'), 'missing')

    def test_running_it_again_never_completes_a_second_report(self):
        store = make_store(reports=[missing('M1', 'MP1001'), missing('M2', 'MP1002', description='Wallet', date='2026-10-02')])
        self.run_sync(store)
        self.assertEqual(self.run_sync(store)['missing_closed'], [])
        self.assertEqual(status_of(store, 'M2'), 'missing')
        self.assertEqual(len(notices(store, 'Your lost report is completed')), 1)

    def test_when_the_trigger_already_completed_the_named_report_nothing_else_is_touched(self):
        store = make_store(missing_report_id='M1', reports=[missing('M1', 'MP1001', status='returned'), missing('M2', 'MP1002', description='Wallet', date='2026-10-02')])
        self.assertEqual(self.run_sync(store)['missing_closed'], [])
        self.assertEqual(status_of(store, 'M2'), 'missing')

    def test_someone_elses_report_is_never_touched(self):
        store = make_store(reports=[missing('M9', 'MP1009', owner=OTHER)])
        self.assertEqual(self.run_sync(store)['missing_closed'], [])
        self.assertEqual(status_of(store, 'M9'), 'missing')

    def test_the_named_report_must_belong_to_the_claimant(self):
        store = make_store(missing_report_id='M9', reports=[missing('M9', 'MP1009', owner=OTHER, category='Electronics', location='Gym', date='2026-01-01', description='Silver phone')])
        self.assertEqual(self.run_sync(store)['missing_closed'], [])
        self.assertEqual(status_of(store, 'M9'), 'missing')

    def test_the_finder_is_told_once_and_the_claimant_is_not_told_twice(self):
        store = make_store()
        result = self.run_sync(store)
        self.assertTrue(result['finder_notified'])
        [notice] = notices(store, 'The item you turned in reached its owner')
        self.assertEqual((notice['to'], notice['type']), (FINDER, 'report_completed'))

    def test_a_finder_who_is_also_the_claimant_gets_no_finder_notice(self):
        store = make_store()
        store['found_items'][0].update(account_id=OWNER, reporter_account_id=OWNER)
        self.assertFalse(self.run_sync(store)['finder_notified'])

    def test_a_claim_that_is_not_collected_changes_nothing(self):
        store = make_store(claim_status='approved_for_pickup')
        result = self.run_sync(store)
        self.assertEqual((result['missing_closed'], result['finder_notified']), ([], False))
        self.assertEqual(status_of(store, 'M1'), 'missing')

    def test_it_works_before_migration_20261015_adds_the_link_column(self):
        store = make_store()
        self.assertEqual(self.run_sync(store, missing_columns={'claims': ('missing_report_id',)})['missing_closed'], ['MP1001'])

    def test_a_failure_never_raises(self):
        db = make_db(make_store())
        db.client = MagicMock()
        db.client.table.side_effect = RuntimeError('database down')
        self.assertEqual(ReportLifecycle(db).complete_for_claim('C1'), {'missing_closed': [], 'finder_notified': False})

    def test_reconcile_catches_a_missed_report_and_ignores_old_claims(self):
        store = make_store()
        summary = ReportLifecycle(make_db(store)).reconcile(now=NOW)
        self.assertEqual((summary['checked'], summary['closed']), (1, 1))
        self.assertEqual(len(notices(store, 'The item you turned in reached its owner')), 0)   # finder notices are not repeated
        old = make_store()
        old['claims'][0]['collected_at'] = (NOW - timedelta(days=200)).isoformat()
        self.assertEqual(ReportLifecycle(make_db(old)).reconcile(now=NOW)['checked'], 0)

    def test_housekeeping_runs_the_report_sync_step(self):
        store = make_store()
        result = housekeeping.run_housekeeping(make_db(store), NOW)
        self.assertIn('report_sync', result)
        self.assertEqual(status_of(store, 'M1'), 'returned')


class OtherCompletionPathTests(unittest.TestCase):
    def test_an_auction_pickup_completes_the_found_report_and_tells_the_finder(self):
        store = make_store(found_status='auctioned')
        life = ReportLifecycle(make_db(store))
        self.assertTrue(life.complete_for_auction('F1'))
        self.assertEqual(store['found_items'][0]['status'], 'returned')
        [notice] = notices(store, 'The item you turned in was sold')
        self.assertEqual(notice['to'], FINDER)
        self.assertFalse(life.complete_for_auction('F1'))     # already done
        self.assertEqual(len(notices(store, 'The item you turned in was sold')), 1)

    def test_an_item_that_is_not_in_auction_is_left_alone(self):
        store = make_store(found_status='unclaimed')
        self.assertFalse(ReportLifecycle(make_db(store)).complete_for_auction('F1'))
        self.assertEqual(store['found_items'][0]['status'], 'unclaimed')

    def test_marking_an_auction_collected_runs_the_sync(self):
        store = make_store(found_status='auctioned')
        store['auctions'] = [{'auction_id': 'A1', 'found_item_id': 'F1', 'status': 'ended', 'fulfillment_status': 'awaiting_pickup', 'winner_account_id': OTHER}]
        db = make_db(store)
        service = AuctionService(db)
        with patch.object(AuctionService, '_live_row', return_value=store['auctions'][0]):
            service.set_fulfillment('A1', 'collected')
        self.assertEqual(store['found_items'][0]['status'], 'returned')

    def test_forfeiting_an_auction_does_not_complete_anything(self):
        store = make_store(found_status='auctioned')
        store['auctions'] = [{'auction_id': 'A1', 'found_item_id': 'F1', 'status': 'ended', 'fulfillment_status': 'awaiting_pickup', 'winner_account_id': OTHER}]
        service = AuctionService(make_db(store))
        with patch.object(AuctionService, '_live_row', return_value=store['auctions'][0]):
            service.set_fulfillment('A1', 'forfeited')
        self.assertEqual(store['found_items'][0]['status'], 'unclaimed')

    def test_an_item_set_to_returned_by_hand_closes_only_confirmed_matches(self):
        store = make_store(found_status='unclaimed', reports=[missing('M1', 'MP1001'), missing('M2', 'MP1002')],
                           matches=[{'missing_item_id': 'M1', 'found_item_id': 'F1', 'status': 'confirmed'}])
        self.assertEqual(ReportLifecycle(make_db(store)).complete_for_found_item('F1'), ['MP1001'])
        self.assertEqual((status_of(store, 'M1'), status_of(store, 'M2')), ('returned', 'missing'))


def real_db(store, rpc_handlers=None, **client_kwargs):
    db = SupabaseDB.__new__(SupabaseDB)
    db.client = MemClient(store, rpc_handlers=rpc_handlers or {}, **client_kwargs)
    return db


class DatabaseWiringTests(unittest.TestCase):
    def collect_rpc(self, store):
        def handler(params):
            claim = next(c for c in store['claims'] if c['claim_id'] == params['p_claim_id'])
            claim['status'] = 'collected'
            store['found_items'][0]['status'] = 'returned'
            return dict(claim)
        return {'admin_update_claim_status': handler}

    def test_collecting_a_claim_completes_the_lost_report(self):
        store = make_store(claim_status='approved_for_pickup', found_status='unclaimed')
        db = real_db(store, self.collect_rpc(store))
        db.create_user_notification = MagicMock(side_effect=lambda account, title, message, **k: store['user_notifications'].append({'to': account, 'title': title}))
        db.update_claim_status('C1', 'collected', ADMIN)
        self.assertEqual(status_of(store, 'M1'), 'returned')
        self.assertEqual({n['title'] for n in store['user_notifications']}, {'Your lost report is completed', 'The item you turned in reached its owner'})

    def test_approving_a_claim_completes_nothing(self):
        store = make_store(claim_status='pending', found_status='unclaimed')

        def approve(params):
            store['claims'][0]['status'] = 'approved_for_pickup'
            return dict(store['claims'][0])
        db = real_db(store, {'admin_update_claim_status': approve})
        db.update_claim_status('C1', 'approved_for_pickup', ADMIN)
        self.assertEqual(status_of(store, 'M1'), 'missing')

    def test_an_admin_marking_an_item_returned_closes_the_confirmed_report(self):
        store = make_store(found_status='unclaimed', matches=[{'missing_item_id': 'M1', 'found_item_id': 'F1', 'status': 'confirmed'}])
        db = real_db(store)
        db.create_user_notification = MagicMock()
        db.update_admin_found_item('FP1001', {'status': 'returned'})
        self.assertEqual(status_of(store, 'M1'), 'returned')

    def test_the_claim_is_saved_without_the_link_before_the_migration(self):
        store = make_store()
        store['claims'] = []
        db = real_db(store, missing_columns={'claims': ('missing_report_id',)})
        created = db.create_claim({'found_item_id': 'F1', 'claimant_account_id': OWNER, 'claim_reason': 'mine', 'missing_report_id': 'M1', 'status': 'pending'})
        self.assertTrue(created)
        self.assertNotIn('missing_report_id', store['claims'][0])

    def test_the_claim_keeps_the_link_after_the_migration(self):
        store = make_store()
        store['claims'] = []
        db = real_db(store)
        db.create_claim({'found_item_id': 'F1', 'claimant_account_id': OWNER, 'claim_reason': 'mine', 'missing_report_id': 'M1', 'status': 'pending'})
        self.assertEqual(store['claims'][0]['missing_report_id'], 'M1')

    def test_the_found_report_is_saved_without_the_guard_link_before_the_migration(self):
        store = make_store()
        store['found_items'] = []
        db = real_db(store, missing_columns={'found_items': ('handover_guard_id',)})
        db.create_found_item({'fpost_id': 'FP2', 'item_name': 'Keys', 'guard_name_or_id': 'Gio Guard', 'handover_guard_id': GUARD, 'status': 'unclaimed'})
        self.assertEqual(store['found_items'][0]['guard_name_or_id'], 'Gio Guard')
        self.assertNotIn('handover_guard_id', store['found_items'][0])


# ----------------------------------------------------------------------------------------------------------- custody overview
def held(item_id, ref, days, status='unclaimed', guard=''):
    return {'item_id': item_id, 'fpost_id': ref, 'item_name': f'Item {ref}', 'category': 'Bags', 'turnover_location': 'Guard house', 'location': 'Library',
            'created_at': (NOW - timedelta(days=days)).isoformat(), 'status': status, 'guard_name_or_id': guard}


class CustodyTests(unittest.TestCase):
    def test_states_follow_claims_and_auctions(self):
        items = [held('1', 'FP1', 3), held('2', 'FP2', 5), held('3', 'FP3', 8), held('4', 'FP4', 9), held('5', 'FP5', 40), held('6', 'FP6', 50),
                 held('7', 'FP7', 12, status='review'), held('8', 'FP8', 60)]
        claims = [{'found_item_id': '2', 'status': 'pending'}, {'found_item_id': '3', 'status': 'approved_for_pickup'}]
        auctions = [
            {'found_item_id': '4', 'status': 'active', 'created_at': '2026-10-01'},
            {'found_item_id': '5', 'status': 'awaiting_admin', 'created_at': '2026-10-01'},
            {'found_item_id': '6', 'status': 'ended', 'fulfillment_status': 'awaiting_pickup', 'winner_account_id': OTHER, 'created_at': '2026-10-01'},
            {'found_item_id': '8', 'status': 'ended', 'fulfillment_status': 'forfeited', 'winner_account_id': OTHER, 'created_at': '2026-10-01'},
        ]
        result = custody.build_overview(items, claims, auctions, NOW)
        states = {row['reference']: row['state'] for row in result['items']}
        self.assertEqual(states, {'FP1': 'waiting', 'FP2': 'claim_review', 'FP3': 'claim_approved', 'FP4': 'auction', 'FP5': 'auction_review',
                                  'FP6': 'sold_pickup', 'FP7': 'hold', 'FP8': 'waiting'})
        self.assertEqual({k: result['summary'][k] for k in ('total', 'needsReview', 'awaitingPickup', 'inAuction', 'waiting', 'onHold', 'auctionEligible', 'minCustodyDays')},
                         {'total': 8, 'needsReview': 2, 'awaitingPickup': 2, 'inAuction': 1, 'waiting': 2, 'onHold': 1, 'auctionEligible': 1, 'minCustodyDays': 30})

    def test_only_waiting_items_old_enough_are_auction_eligible(self):
        rows = custody.build_overview([held('1', 'FP1', 29), held('2', 'FP2', 30), held('3', 'FP3', 90)], [{'found_item_id': '3', 'status': 'pending'}], [], NOW)['items']
        self.assertEqual({r['reference']: r['auctionEligible'] for r in rows}, {'FP1': False, 'FP2': True, 'FP3': False})

    def test_what_needs_attention_comes_first_then_the_oldest(self):
        items = [held('1', 'FP1', 90), held('2', 'FP2', 2), held('3', 'FP3', 10)]
        claims = [{'found_item_id': '2', 'status': 'pending'}, {'found_item_id': '3', 'status': 'approved_for_pickup'}]
        self.assertEqual([r['reference'] for r in custody.build_overview(items, claims, [], NOW)['items']], ['FP2', 'FP3', 'FP1'])

    def test_the_overview_never_contains_who_turned_the_item_in(self):
        row = custody.build_overview([{**held('1', 'FP1', 3, guard='Gio Guard'), 'reporter_email': 'fina@umak.edu.ph', 'account_id': FINDER}], [], [], NOW)['items'][0]
        self.assertEqual(row['guard'], 'Gio Guard')
        self.assertNotIn('fina@umak.edu.ph', str(row))
        self.assertNotIn(FINDER, str(row))

    def test_loading_from_the_database_skips_released_items_and_survives_missing_tables(self):
        store = {'found_items': [held('1', 'FP1', 3), held('2', 'FP2', 4, status='returned'), held('3', 'FP3', 5, status='claimed')], 'claims': [], 'auctions': []}
        result = custody.load_overview(MemClient(store), NOW)
        self.assertEqual({r['reference'] for r in result['items']}, {'FP1', 'FP3'})
        no_guard = custody.load_overview(MemClient({'found_items': [held('1', 'FP1', 3)], 'claims': [], 'auctions': []}, missing_columns={'found_items': ('handover_guard_id',)}), NOW)
        self.assertEqual(no_guard['summary']['total'], 1)
        no_auctions = custody.load_overview(MemClient({'found_items': [held('1', 'FP1', 3)], 'claims': [], 'auctions': []}, missing_columns={'auctions': ('winner_account_id',)}), NOW)
        self.assertEqual(no_auctions['summary']['total'], 1)


# ----------------------------------------------------------------------------------------------------------- routes
def client_for(blueprint, prefix):
    app = Flask(__name__)
    app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
    app.register_blueprint(blueprint, url_prefix=prefix)
    return app.test_client()


FOUND_FORM = {'item_name': 'Blue umbrella', 'location': 'Library', 'category': 'Accessories', 'description': 'Large blue umbrella with a curved wooden handle',
              'found_date': '2026-10-01', 'turnover_location': 'Guard house', 'dpa_consent': 'true'}


class FoundReportGuardTests(unittest.TestCase):
    def setUp(self):
        rate_limit.reset()

    def post(self, store, **form):
        db = make_db(store)
        db.get_user_by_account_id.return_value = store['user_profiles'][2]    # the finder
        db.get_missing_items_by_account.return_value = []
        db.get_found_items_by_account.return_value = []
        db.next_fpost_id.return_value = 'FP2001'
        db.create_found_item.side_effect = lambda payload: {**payload, 'item_id': 'new-item'}
        client = client_for(user_found_routes.found_item_bp, '/api')
        with patch.object(user_found_routes, 'get_db', return_value=db), patch.object(user_found_routes, '_authenticated_account_id', return_value=FINDER), \
             patch.object(user_found_routes, 'send_reference_email_best_effort', return_value=True) as email:
            response = client.post('/api/found-items', data={**FOUND_FORM, **form})
        return response, db, email

    def test_the_guard_list_has_names_only_and_skips_inactive_guards(self):
        store = make_store()
        db = make_db(store)
        client = client_for(user_found_routes.found_item_bp, '/api')
        with patch.object(user_found_routes, 'get_db', return_value=db), patch.object(user_found_routes, '_authenticated_account_id', return_value=FINDER):
            response = client.get('/api/found-items/guards')
        self.assertEqual(response.get_json(), {'guards': [{'id': GUARD, 'name': 'Gio Guard'}]})
        self.assertNotIn('umak.edu.ph', response.get_data(as_text=True))

    def test_choosing_a_guard_stores_their_name_and_id_and_tells_them(self):
        response, db, email = self.post(make_store(), handover_guard_id=GUARD, guard_name_or_id='Someone typed this')
        self.assertEqual(response.status_code, 201)
        saved = db.create_found_item.call_args.args[0]
        self.assertEqual((saved['guard_name_or_id'], saved['handover_guard_id']), ('Gio Guard', GUARD))
        notice = db.create_user_notification.call_args
        self.assertEqual((notice.args[0], notice.kwargs['notification_type'], notice.kwargs['found_item_id']), (GUARD, 'guard_handover', 'new-item'))
        self.assertIn('gio@umak.edu.ph', [call.kwargs.get('to_email') for call in email.call_args_list])

    def test_a_guard_who_is_inactive_or_not_a_guard_is_refused(self):
        for bad in (GUARD2, OTHER, 'not-a-guard'):
            response, db, _ = self.post(make_store(), handover_guard_id=bad)
            self.assertEqual((response.status_code, response.get_json()['code']), (400, 'guard_unavailable'), bad)
            db.create_found_item.assert_not_called()

    def test_a_typed_guard_name_still_works_when_no_guard_is_chosen(self):
        response, db, _ = self.post(make_store(), guard_name_or_id='Guard Santos')
        self.assertEqual(response.status_code, 201)
        saved = db.create_found_item.call_args.args[0]
        self.assertEqual((saved['guard_name_or_id'], saved['handover_guard_id']), ('Guard Santos', None))
        db.create_user_notification.assert_not_called()

    def test_a_guard_is_required_one_way_or_the_other(self):
        response, db, _ = self.post(make_store())
        self.assertEqual(response.status_code, 400)
        db.create_found_item.assert_not_called()

    def test_a_failed_guard_notice_never_blocks_the_report(self):
        store = make_store()
        db = make_db(store)
        db.create_user_notification.side_effect = RuntimeError('down')
        db.get_user_by_account_id.return_value = store['user_profiles'][2]
        db.get_missing_items_by_account.return_value = []
        db.get_found_items_by_account.return_value = []
        db.next_fpost_id.return_value = 'FP2001'
        db.create_found_item.side_effect = lambda payload: {**payload, 'item_id': 'new-item'}
        client = client_for(user_found_routes.found_item_bp, '/api')
        with patch.object(user_found_routes, 'get_db', return_value=db), patch.object(user_found_routes, '_authenticated_account_id', return_value=FINDER), \
             patch.object(user_found_routes, 'send_reference_email_best_effort', side_effect=[RuntimeError('smtp'), True]):
            response = client.post('/api/found-items', data={**FOUND_FORM, 'handover_guard_id': GUARD})
        self.assertEqual(response.status_code, 201)


class ClaimLinkTests(unittest.TestCase):
    def post(self, store, **extra):
        db = make_db(store)
        db.get_found_item_by_fpost_id.return_value = {'item_id': 'F1', 'fpost_id': 'FP1001', 'status': 'unclaimed', 'item_name': 'Black wallet'}
        db.get_pending_claim.return_value = None
        db.get_missing_items_by_account.return_value = [r for r in store['missing_items'] if r['account_id'] == OWNER]
        db.create_claim.return_value = {'claim_id': 'C2', 'claim_reference': 'CL2'}
        db.get_user_by_account_id.return_value = store['user_profiles'][0]
        db.client = MagicMock()
        db.client.storage.from_.return_value.create_signed_url.return_value = {'signedURL': 'x'}
        data = {'fpost_id': 'FP1001', 'claim_reason': 'It is my wallet, it has my name inside', 'identity_document_type': 'campus_id', 'dpa_consent': 'true',
                'proof_image': (io.BytesIO(PNG), 'proof.png', 'image/png'), 'identity_document': (io.BytesIO(PNG), 'id.png', 'image/png'), **extra}
        client = client_for(user_claim_routes.claims_bp, '/api/claims')
        with patch.object(user_claim_routes, 'get_db', return_value=db), patch.object(user_claim_routes, '_account_id', return_value=OWNER), \
             patch.object(user_claim_routes, 'send_reference_email_best_effort', return_value=True):
            response = client.post('/api/claims', data=data, content_type='multipart/form-data')
        return response, db

    def test_the_claim_can_name_one_of_the_claimants_open_reports(self):
        response, db = self.post(make_store(), missing_report_id='MP1001')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(db.create_claim.call_args.args[0]['missing_report_id'], 'M1')

    def test_the_link_is_optional(self):
        response, db = self.post(make_store())
        self.assertEqual(response.status_code, 201)
        self.assertNotIn('missing_report_id', db.create_claim.call_args.args[0])

    def test_someone_elses_or_a_completed_or_an_unknown_report_is_refused(self):
        other = make_store(reports=[missing('M9', 'MP1009', owner=OTHER), missing('M1', 'MP1001', status='returned')])
        for ref in ('MP1009', 'MP1001', 'MP7777'):
            response, db = self.post(other, missing_report_id=ref)
            self.assertEqual((response.status_code, response.get_json()['code']), (400, 'invalid_missing_report'), ref)
            db.create_claim.assert_not_called()


def staff_patches(level, account_id):
    """The real _require_admin, signed in as this account with this access level."""
    class Accounts:
        def get_user_by_account_id(self, account):
            return {'account_id': account, 'access_level': level, 'is_active': True, 'email': 'x@umak.edu.ph'}

        def get_admin_mfa(self, account):
            return None
    return (patch.object(admin_access, 'get_db', return_value=Accounts()),
            patch.object(admin_access.JWTService, 'verify_token', return_value={'account_id': account_id}),
            patch.object(admin_access.JWTService, 'extract_token_from_header', return_value='t'))


class AssignedHandoverTests(unittest.TestCase):
    def get(self, level, account_id, **client_kwargs):
        store = make_store()
        store['found_items'] = [
            {**held('1', 'FP1', 3, guard='Gio Guard'), 'handover_guard_id': GUARD, 'created_at': '2026-10-19T10:00:00+00:00'},
            {**held('2', 'FP2', 4, guard='Gail Gone'), 'handover_guard_id': GUARD2, 'created_at': '2026-10-18T10:00:00+00:00'},
            {**held('3', 'FP3', 5, guard='Typed Name'), 'handover_guard_id': None},
            {**held('4', 'FP4', 6, status='returned', guard='Gio Guard'), 'handover_guard_id': GUARD},
        ]
        db = make_db(store, **client_kwargs)
        client = client_for(admin_claim_routes.claims_verification_bp, '/api/admin')
        patches = staff_patches(level, account_id) + (patch.object(admin_claim_routes, 'get_db', return_value=db),)
        with patches[0], patches[1], patches[2], patches[3]:
            return client.get('/api/admin/claims/handover/assigned')

    def test_a_guard_sees_only_the_items_handed_to_them_that_are_still_held(self):
        response = self.get('guard', GUARD)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([i['reference'] for i in response.get_json()['items']], ['FP1'])

    def test_administrators_see_every_guards_items(self):
        response = self.get('admin', ADMIN)
        self.assertEqual(sorted(i['reference'] for i in response.get_json()['items']), ['FP1', 'FP2'])
        self.assertNotIn('reporter', response.get_data(as_text=True).lower())

    def test_a_normal_user_is_refused(self):
        self.assertEqual(self.get('user', OWNER).status_code, 403)

    def test_it_answers_with_setup_required_before_the_migration(self):
        response = self.get('admin', ADMIN, missing_columns={'found_items': ('handover_guard_id',)})
        self.assertEqual((response.status_code, response.get_json()), (200, {'items': [], 'setup_required': True}))


class MyReportsGuardTests(unittest.TestCase):
    """People cannot edit or delete a report once it is completed, and cannot delete a found report that has claims on it."""
    def call(self, method, path, found=(), missing_rows=(), claims=()):
        from Users.Backend.my_reports import routes as my_routes
        db = MagicMock()
        db.get_found_items_by_account.return_value = list(found)
        db.get_missing_items_by_account.return_value = list(missing_rows)
        db.client = MemClient({'claims': list(claims)})
        db.delete_found_item_by_account.return_value = True
        db.delete_missing_item_by_account.return_value = True
        db.update_found_item_by_account.return_value = {'fpost_id': 'FP1001'}
        db.update_missing_item_by_account.return_value = {'mpost_id': 'MP1001'}
        client = client_for(my_routes.my_reports_bp, '/api')
        with patch.object(my_routes, 'get_db', return_value=db), patch.object(my_routes, '_authenticated_account_id', return_value=OWNER):
            response = getattr(client, method)(path, json={'item_name': 'x'})
        return response, db

    FOUND = {'item_id': 'F1', 'fpost_id': 'FP1001', 'status': 'unclaimed'}

    def test_a_completed_report_cannot_be_edited_or_deleted(self):
        for status in ('returned', 'closed'):
            for method in ('put', 'delete'):
                response, db = self.call(method, '/api/found-items/FP1001', found=[{**self.FOUND, 'status': status}])
                self.assertEqual((response.status_code, response.get_json()['code']), (409, 'report_completed'), (status, method))
                db.delete_found_item_by_account.assert_not_called()
                db.update_found_item_by_account.assert_not_called()
        for method in ('put', 'delete'):
            response, db = self.call(method, '/api/missing-items/MP1001', missing_rows=[{'item_id': 'M1', 'mpost_id': 'MP1001', 'status': 'returned'}])
            self.assertEqual(response.status_code, 409)
            db.delete_missing_item_by_account.assert_not_called()
            db.update_missing_item_by_account.assert_not_called()

    def test_open_reports_can_still_be_edited_and_deleted(self):
        self.assertEqual(self.call('put', '/api/found-items/FP1001', found=[self.FOUND])[0].status_code, 200)
        self.assertEqual(self.call('delete', '/api/found-items/FP1001', found=[self.FOUND])[0].status_code, 200)
        open_lost = [{'item_id': 'M1', 'mpost_id': 'MP1001', 'status': 'missing'}]
        self.assertEqual(self.call('put', '/api/missing-items/MP1001', missing_rows=open_lost)[0].status_code, 200)
        self.assertEqual(self.call('delete', '/api/missing-items/MP1001', missing_rows=open_lost)[0].status_code, 200)

    def test_a_found_report_with_claims_or_an_auction_cannot_be_deleted(self):
        response, db = self.call('delete', '/api/found-items/FP1001', found=[self.FOUND], claims=[{'claim_id': 'C1', 'found_item_id': 'F1'}])
        self.assertEqual((response.status_code, response.get_json()['code']), (409, 'report_in_use'))
        db.delete_found_item_by_account.assert_not_called()
        response, db = self.call('delete', '/api/found-items/FP1001', found=[{**self.FOUND, 'status': 'auctioned'}])
        self.assertEqual(response.status_code, 409)
        db.delete_found_item_by_account.assert_not_called()


class CustodyRouteTests(unittest.TestCase):
    def test_admins_get_the_overview_and_users_do_not(self):
        store = {'found_items': [held('1', 'FP1', 3, guard='Gio Guard')], 'claims': [], 'auctions': []}
        db = MagicMock()
        db.client = MemClient(store)
        client = client_for(admin_found_routes.found_items_bp, '/api/admin')
        with patch.object(admin_found_routes, 'get_db', return_value=db), patch.object(admin_found_routes, '_require_admin', return_value={'account_id': ADMIN}):
            body = client.get('/api/admin/found-items/custody').get_json()
        self.assertEqual((body['summary']['total'], body['items'][0]['reference']), (1, 'FP1'))
        with patch.object(admin_found_routes, 'get_db', return_value=db), patch.object(admin_found_routes, '_require_admin', side_effect=PermissionError('Admin access required')):
            self.assertEqual(client.get('/api/admin/found-items/custody').status_code, 403)


if __name__ == '__main__':
    unittest.main()
