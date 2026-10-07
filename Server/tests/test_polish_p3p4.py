"""Polishing round 2: auction lifecycle (stages, limited edits, more time, early auctions), Archive, exact bid steps,
ID verification checks, readable notification references and the admin menu badges."""
import io
import sys
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock, patch

from flask import Flask

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT.parent, ROOT / 'tests'):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from memdb import MemClient  # noqa: E402
from test_handover_and_timeouts import ADMIN_ID, AUCTION, ITEM, WINNER, auction_store, iso, profiles  # noqa: E402
from test_report_lifecycle import staff_patches  # noqa: E402
from Admin.Backend.archive import routes as archive_routes  # noqa: E402
from Admin.Backend.dashboard import routes as dashboard_routes  # noqa: E402
from Admin.Backend.users import routes as user_routes  # noqa: E402
from app.utils import admin_badges, archive  # noqa: E402
from app.utils.auction_db import AuctionError, AuctionService, bid_step_problem, ladder_ceiling  # noqa: E402
from app.utils.supabase_db import SupabaseDB  # noqa: E402
from Users.Backend.profile import routes as profile_routes  # noqa: E402

PNG = b'\x89PNG\r\n\x1a\n' + b'0' * 64


def service_for(store, rpc_handlers=None, **client_kwargs):
    db = MagicMock()
    db.client = MemClient(store, rpc_handlers=rpc_handlers or {}, **client_kwargs)
    db.get_user_by_account_id.side_effect = lambda account_id: next((dict(p) for p in store['user_profiles'] if p['account_id'] == account_id), None)
    db.create_user_notification.side_effect = lambda *a, **k: store.setdefault('notes', []).append({'to': a[0], 'title': a[1], 'type': k.get('notification_type')})
    return AuctionService(db), db


def client_for(blueprint, prefix='/api/admin'):
    app = Flask(__name__)
    app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
    app.register_blueprint(blueprint, url_prefix=prefix)
    return app.test_client()


# ----------------------------------------------------------------------------------------------------------- exact bid steps
class BidStepTests(unittest.TestCase):
    def test_the_example_from_the_bug_report(self):
        """Starting bid 100 and increment 100: 100, 200, 300 are valid and 150 is not."""
        for good in ('100', '200', '300', '1000'):
            self.assertIsNone(bid_step_problem(Decimal(good), 100, 100), good)
        for bad, suggested in (('150', 200), ('250', 300), ('199.99', 200), ('99', 100), ('101', 200)):
            problem = bid_step_problem(Decimal(bad), 100, 100)
            self.assertEqual((problem['step'], problem['suggested']), (100.0, float(suggested)), bad)

    def test_other_ladders(self):
        self.assertIsNone(bid_step_problem(Decimal('400'), 350, 25))
        self.assertIsNone(bid_step_problem(Decimal('375'), 350, 25))
        self.assertEqual(bid_step_problem(Decimal('380'), 350, 25)['suggested'], 400.0)
        self.assertIsNone(bid_step_problem(Decimal('12.50'), 10, 2.5))

    def test_the_buy_now_price_is_always_allowed(self):
        self.assertIsNone(bid_step_problem(Decimal('450'), 100, 100, buyout=450))
        self.assertIsNone(bid_step_problem(Decimal('777'), 100, 100, buyout=450))   # typing more than Buy Now is a Buy Now
        self.assertIsNotNone(bid_step_problem(Decimal('350'), 100, 100, buyout=450))

    def test_ladder_ceiling(self):
        self.assertEqual(ladder_ceiling(150, 100, 100), Decimal('200.00'))
        self.assertEqual(ladder_ceiling(200, 100, 100), Decimal('200'))
        self.assertEqual(ladder_ceiling(50, 100, 100), Decimal('100'))

    def bid_service(self, current=100, count=0):
        store = {'user_profiles': profiles(), 'auctions': [{'auction_id': AUCTION, 'status': 'active', 'starting_price': 100, 'bid_increment': 100,
                                                            'current_price': current, 'bid_count': count, 'buyout_price': 450}]}
        calls = []

        def place(params):
            calls.append(params)
            return {'ok': True, 'auction': {'auction_id': AUCTION, 'title': 'Umbrella', 'starting_price': 100, 'bid_increment': 100, 'current_price': params['p_amount'],
                                              'bid_count': count + 1, 'status': 'active', 'item_reference': 'FP1001'}, 'previous_bidder_id': None}
        service, db = service_for(store, {'auction_place_bid': place})
        return service, calls

    def test_a_bid_between_two_steps_is_refused_before_it_reaches_the_database(self):
        service, calls = self.bid_service()
        with self.assertRaises(AuctionError) as caught:
            service.place_bid(AUCTION, WINNER, 150)
        self.assertEqual((caught.exception.status, caught.exception.extra['suggested']), (409, 200.0))
        self.assertIn('exact steps', caught.exception.message)
        self.assertEqual(calls, [])

    def test_exact_steps_and_the_buy_now_price_go_through(self):
        for amount in (100, 200, 300, 450, 999):
            service, calls = self.bid_service()
            service.place_bid(AUCTION, WINNER, amount)
            self.assertEqual(len(calls), 1, amount)

    def test_the_database_message_is_translated_when_it_is_the_one_that_refuses(self):
        service, _ = self.bid_service()
        service.client.rpc_handlers['auction_place_bid'] = lambda params: {'ok': False, 'error': 'bid_not_on_step', 'step': 100, 'suggested': 200}
        with patch.object(AuctionService, '_assert_on_step'):
            with self.assertRaises(AuctionError) as caught:
                service.place_bid(AUCTION, WINNER, 150)
        self.assertEqual((caught.exception.status, caught.exception.extra['suggested']), (409, 200.0))

    def test_the_card_shows_the_next_valid_bid(self):
        service, _ = self.bid_service()
        card = service.card({'auction_id': AUCTION, 'status': 'active', 'starting_price': 100, 'bid_increment': 100, 'current_price': 150, 'bid_count': 2,
                             'starts_at': iso(5), 'ends_at': (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()}, {})
        self.assertEqual(card['min_next_bid'], 300.0)   # 150 is an old off-step bid; the next rung above 250 is 300


# ----------------------------------------------------------------------------------------------------------- auction lifecycle
class StageTests(unittest.TestCase):
    def stage(self, **row):
        service, _ = service_for(auction_store(**row))
        full = {**auction_store(**row)['auctions'][0]}
        return service.stage_of(service.card(full, {}), full)

    def test_a_won_auction_is_awaiting_pickup_until_the_winner_has_paid_and_collected(self):
        self.assertEqual(self.stage(), 'awaiting_pickup')
        self.assertEqual(self.stage(fulfillment_status='collected'), 'completed')
        self.assertEqual(self.stage(fulfillment_status='forfeited'), 'forfeited')
        self.assertEqual(self.stage(fulfillment_status=None), 'awaiting_pickup')

    def test_other_stages(self):
        self.assertEqual(self.stage(status='awaiting_admin', fulfillment_status=None), 'awaiting_admin')
        self.assertEqual(self.stage(status='ended', winner_account_id=None, fulfillment_status=None), 'no_bids')
        self.assertEqual(self.stage(status='cancelled', winner_account_id=None, fulfillment_status=None), 'cancelled')

    def test_the_admin_list_reports_stages_and_keeps_archived_lots_out_of_the_working_numbers(self):
        store = auction_store(fulfillment_status='collected', archived_at=iso(1))
        store['auctions'].append(auction_row_copy('a2', fulfillment_status='awaiting_pickup'))
        service, _ = service_for(store)
        with patch.object(AuctionService, 'settle_and_notify'):
            result = service.admin_list()
        stages = {c['id']: (c['stage'], c['archived']) for c in result['auctions']}
        self.assertEqual(stages[AUCTION], ('completed', True))
        self.assertEqual(stages['a2'], ('awaiting_pickup', False))
        self.assertEqual((result['stats']['completed'], result['stats']['archived'], result['stats']['awaiting_pickup']), (1, 1, 1))


def auction_row_copy(auction_id, **extra):
    from test_handover_and_timeouts import auction_row
    return auction_row(auction_id=auction_id, **extra)


class SoldLotEditTests(unittest.TestCase):
    def test_the_title_description_and_photos_of_a_won_lot_can_still_be_corrected(self):
        store = auction_store()
        service, _ = service_for(store)
        updated = service.update_auction(AUCTION, {'title': 'Blue folding umbrella', 'description': 'Has a wooden handle'}, ['https://x/y.jpg'])
        self.assertEqual((updated['title'], store['auctions'][0]['description'], store['auctions'][0]['gallery_urls']), ('Blue folding umbrella', 'Has a wooden handle', ['https://x/y.jpg']))

    def test_prices_and_times_are_final_after_the_sale(self):
        service, _ = service_for(auction_store())
        for payload in ({'starting_price': 10}, {'ends_at': iso(-5)}, {'title': 'x', 'buyout_price': 900}):
            with self.assertRaises(AuctionError) as caught:
                service.update_auction(AUCTION, payload, None)
            self.assertEqual(caught.exception.status, 409)

    def test_a_lot_waiting_for_the_administrator_can_be_edited_the_same_way(self):
        store = auction_store(status='awaiting_admin', fulfillment_status=None)
        service, _ = service_for(store)
        self.assertEqual(service.update_auction(AUCTION, {'description': 'More detail'}, None)['description'], 'More detail')

    def test_a_completed_lot_cannot_be_edited(self):
        service, _ = service_for(auction_store(fulfillment_status='collected'))
        with self.assertRaises(AuctionError):
            service.update_auction(AUCTION, {'title': 'x'}, None)

    def test_an_empty_edit_is_refused(self):
        service, _ = service_for(auction_store())
        with self.assertRaises(AuctionError):
            service.update_auction(AUCTION, {}, None)


class ExtendPickupTests(unittest.TestCase):
    def test_more_time_restarts_the_clocks_and_tells_the_winner(self):
        store = auction_store(pickup_warning_sent_at=iso(2), winner_notified_at=iso(60))
        service, db = service_for(store)
        service.extend_pickup(AUCTION)
        row = store['auctions'][0]
        self.assertIsNone(row['pickup_warning_sent_at'])
        self.assertGreater(row['winner_notified_at'], (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat())
        self.assertEqual([n['type'] for n in store['notes']], ['auction_pickup_extended'])
        self.assertEqual(store['notes'][0]['to'], WINNER)

    def test_only_a_sale_waiting_for_pickup_can_be_extended(self):
        for fulfillment in ('collected', 'forfeited', None):
            service, _ = service_for(auction_store(fulfillment_status=fulfillment))
            with self.assertRaises(AuctionError) as caught:
                service.extend_pickup(AUCTION)
            self.assertEqual(caught.exception.status, 409)

    def test_the_forfeit_clock_really_restarts(self):
        real_now = datetime.now(timezone.utc)
        long_ago = (real_now - timedelta(hours=73)).isoformat()
        service, _ = service_for(auction_store(winner_notified_at=long_ago))
        with patch.object(AuctionService, '_auto_forfeit', return_value=True) as forfeit, patch.object(AuctionService, '_send_final_warning', return_value=True):
            service.process_overdue_pickups(now=real_now)
        forfeit.assert_called_once()                      # without more time the win is forfeited
        service, _ = service_for(auction_store(winner_notified_at=long_ago))
        service.extend_pickup(AUCTION)
        with patch.object(AuctionService, '_auto_forfeit', return_value=True) as forfeit, patch.object(AuctionService, '_send_final_warning', return_value=True) as warn:
            service.process_overdue_pickups(now=real_now + timedelta(minutes=1))
        forfeit.assert_not_called()
        warn.assert_not_called()


class EligibleItemTests(unittest.TestCase):
    def test_every_unclaimed_item_is_listed_with_a_recommendation(self):
        now = datetime.now(timezone.utc)
        store = {'found_items': [
            {'item_id': 'old', 'fpost_id': 'FP1', 'item_name': 'Old umbrella', 'status': 'unclaimed', 'created_at': (now - timedelta(days=45)).isoformat()},
            {'item_id': 'new', 'fpost_id': 'FP2', 'item_name': 'New bottle', 'status': 'unclaimed', 'created_at': (now - timedelta(days=3)).isoformat()},
            {'item_id': 'claimed', 'fpost_id': 'FP3', 'item_name': 'Claimed', 'status': 'unclaimed', 'created_at': (now - timedelta(days=90)).isoformat()},
            {'item_id': 'gone', 'fpost_id': 'FP4', 'item_name': 'Returned', 'status': 'returned', 'created_at': (now - timedelta(days=90)).isoformat()},
            {'item_id': 'live', 'fpost_id': 'FP5', 'item_name': 'In auction', 'status': 'unclaimed', 'created_at': (now - timedelta(days=90)).isoformat()},
        ], 'claims': [{'found_item_id': 'claimed', 'status': 'pending'}], 'auctions': [{'found_item_id': 'live', 'status': 'active'}]}
        service, _ = service_for(store)
        result = service.eligible_items()
        self.assertEqual([(i['reference'], i['recommended']) for i in result['items']], [('FP1', True), ('FP2', False)])
        self.assertEqual(result['recommended_total'], 1)


# ----------------------------------------------------------------------------------------------------------- archive
def archive_store():
    return {
        'missing_items': [{'mpost_id': 'MP1', 'status': 'returned'}, {'mpost_id': 'MP2', 'status': 'missing'}, {'mpost_id': 'MP3', 'status': 'returned', 'archived_at': iso(2)}],
        'found_items': [{'fpost_id': 'FP1', 'status': 'returned'}, {'fpost_id': 'FP2', 'status': 'unclaimed'}, {'fpost_id': 'FP3', 'status': 'claimed'}],
        'claims': [{'claim_id': 'c1', 'status': 'collected'}, {'claim_id': 'c2', 'status': 'rejected'}, {'claim_id': 'c3', 'status': 'pending'}, {'claim_id': 'c4', 'status': 'approved_for_pickup'}],
    }


class ArchiveRuleTests(unittest.TestCase):
    def run_it(self, kind, reference, archived=True, **kwargs):
        store = archive_store()
        return store, archive.set_archived(MemClient(store, **kwargs), kind, reference, ADMIN_ID, archived)

    def test_finished_records_can_be_archived_and_restored(self):
        for kind, reference, table, key in (('lost', 'MP1', 'missing_items', 'mpost_id'), ('found', 'FP1', 'found_items', 'fpost_id'), ('found', 'FP3', 'found_items', 'fpost_id'),
                                            ('claim', 'c1', 'claims', 'claim_id'), ('claim', 'c2', 'claims', 'claim_id')):
            store, result = self.run_it(kind, reference)
            row = next(r for r in store[table] if r[key] == reference)
            self.assertEqual((result['archived'], bool(row['archived_at']), row['archived_by']), (True, True, ADMIN_ID), reference)
            archive.set_archived(MemClient(store), kind, reference, ADMIN_ID, False)
            self.assertIsNone(row['archived_at'], reference)

    def test_live_work_can_never_be_archived(self):
        for kind, reference in (('lost', 'MP2'), ('found', 'FP2'), ('claim', 'c3'), ('claim', 'c4')):
            with self.assertRaises(archive.ArchiveError) as caught:
                self.run_it(kind, reference)
            self.assertEqual((caught.exception.status, caught.exception.code), (409, 'not_finished'), reference)

    def test_archiving_twice_restoring_the_unarchived_and_unknown_records(self):
        with self.assertRaises(archive.ArchiveError) as caught:
            self.run_it('lost', 'MP3')
        self.assertEqual(caught.exception.code, 'already_archived')
        with self.assertRaises(archive.ArchiveError) as caught:
            self.run_it('lost', 'MP1', archived=False)
        self.assertEqual(caught.exception.code, 'not_archived')
        for kind, reference in (('lost', 'MP999'), ('found', 'nope'), ('claim', 'zzz')):
            with self.assertRaises(archive.ArchiveError) as caught:
                self.run_it(kind, reference)
            self.assertEqual(caught.exception.status, 404)
        with self.assertRaises(archive.ArchiveError) as caught:
            self.run_it('smart_tag', 'x')
        self.assertEqual(caught.exception.code, 'unknown_kind')

    def test_before_the_migration_it_asks_for_it_and_changes_nothing(self):
        for table in ('missing_items', 'found_items', 'claims'):
            kind, reference = {'missing_items': ('lost', 'MP1'), 'found_items': ('found', 'FP1'), 'claims': ('claim', 'c1')}[table]
            store = archive_store()
            with self.assertRaises(archive.ArchiveError) as caught:
                archive.set_archived(MemClient(store, missing_columns={table: ('archived_at', 'archived_by')}), kind, reference, ADMIN_ID, True)
            self.assertEqual((caught.exception.status, caught.exception.code), (503, 'setup_required'))

    def test_archived_rows_are_flagged_for_the_admin_lists_and_survive_a_missing_column(self):
        store = archive_store()
        rows = [{'id': 'MP1'}, {'id': 'MP3'}]
        archive.flag_archived(MemClient(store), rows, 'missing_items', 'mpost_id')
        self.assertEqual([r['archived'] for r in rows], [False, True])
        rows = [{'id': 'MP3'}]
        archive.flag_archived(MemClient(store, missing_columns={'missing_items': ('archived_at',)}), rows, 'missing_items', 'mpost_id')
        self.assertEqual(rows[0]['archived'], False)


class ArchiveAuctionTests(unittest.TestCase):
    def test_only_finished_auctions_can_be_archived(self):
        for kwargs, ok in (({'fulfillment_status': 'collected'}, True), ({'fulfillment_status': 'forfeited'}, True), ({'status': 'cancelled', 'winner_account_id': None, 'fulfillment_status': None}, True),
                           ({'status': 'ended', 'winner_account_id': None, 'fulfillment_status': None}, True), ({}, False),
                           ({'status': 'awaiting_admin', 'fulfillment_status': None}, False), ({'status': 'active', 'fulfillment_status': None, 'ends_at': (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()}, False)):
            store = auction_store(**kwargs)
            service, _ = service_for(store)
            if ok:
                service.set_archived(AUCTION, ADMIN_ID, True)
                self.assertTrue(store['auctions'][0]['archived_at'], kwargs)
            else:
                with self.assertRaises(AuctionError, msg=kwargs):
                    service.set_archived(AUCTION, ADMIN_ID, True)

    def test_restore_and_double_archive(self):
        store = auction_store(fulfillment_status='collected', archived_at=iso(1))
        service, _ = service_for(store)
        with self.assertRaises(AuctionError):
            service.set_archived(AUCTION, ADMIN_ID, True)
        service.set_archived(AUCTION, ADMIN_ID, False)
        self.assertIsNone(store['auctions'][0]['archived_at'])
        with self.assertRaises(AuctionError):
            service.set_archived(AUCTION, ADMIN_ID, False)

    def test_before_the_migration_it_asks_for_it(self):
        service, _ = service_for(auction_store(fulfillment_status='collected'), missing_columns={'auctions': ('archived_at',)})
        with self.assertRaises(AuctionError) as caught:
            service.set_archived(AUCTION, ADMIN_ID, True)
        self.assertEqual((caught.exception.status, caught.exception.extra['code']), (503, 'setup_required'))


class ArchiveRouteTests(unittest.TestCase):
    def post(self, level, body, store=None):
        store = store or archive_store()
        db = MagicMock()
        db.client = MemClient(store)
        client = client_for(archive_routes.archive_bp)
        patches = staff_patches(level, ADMIN_ID) + (patch.object(archive_routes, 'get_db', return_value=db), patch.object(archive_routes, '_log_admin_action'))
        for p in patches:
            p.start()
        self.addCleanup(patch.stopall)
        return client.post('/api/admin/archive', json=body), store

    def test_an_administrator_can_archive_and_restore(self):
        response, store = self.post('admin', {'kind': 'lost', 'reference': 'MP1', 'archived': True})
        self.assertEqual((response.status_code, response.get_json()['archived']), (200, True))
        self.assertTrue(store['missing_items'][0]['archived_at'])
        self.assertEqual(self.post('super_admin', {'kind': 'lost', 'reference': 'MP3', 'archived': False})[0].status_code, 200)

    def test_users_and_guards_cannot(self):
        for level in ('user', 'guard'):
            self.assertEqual(self.post(level, {'kind': 'lost', 'reference': 'MP1'})[0].status_code, 403, level)

    def test_errors_are_plain(self):
        self.assertEqual(self.post('admin', {'kind': 'lost', 'reference': 'MP2'})[0].get_json()['code'], 'not_finished')
        self.assertEqual(self.post('admin', {'kind': 'banana', 'reference': 'x'})[0].status_code, 400)
        self.assertEqual(self.post('admin', {'kind': 'claim', 'reference': 'missing'})[0].status_code, 404)

    def test_an_auction_goes_through_the_auction_service(self):
        store = {**auction_store(fulfillment_status='collected'), **archive_store()}
        response, store = self.post('admin', {'kind': 'auction', 'reference': AUCTION, 'archived': True}, store)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(store['auctions'][0]['archived_at'])

    def test_the_admin_lists_carry_the_flag(self):
        store = {'missing_items': [{'item_id': 'i1', 'mpost_id': 'MP3', 'status': 'returned', 'account_id': 'u1', 'created_at': iso(5), 'archived_at': iso(1)}],
                 'user_profiles': profiles()}
        db = SupabaseDB.__new__(SupabaseDB)
        db.client = MemClient(store)
        rows = db.list_admin_missing_items()
        self.assertEqual((rows[0]['id'], rows[0]['archived']), ('MP3', True))


# ----------------------------------------------------------------------------------------------------------- ID verification
class VerificationTests(unittest.TestCase):
    def review(self, body):
        db = MagicMock()
        db.review_account_verification.return_value = {'email': 'maria@umak.edu.ph'}
        client = client_for(user_routes.users_bp)
        with patch.object(user_routes, '_require_admin', return_value={'account_id': ADMIN_ID, 'email': 'a@umak.edu.ph', 'access_level': 'admin'}), \
             patch.object(user_routes, 'get_db', return_value=db), patch.object(user_routes, '_log_admin_action'):
            return client.patch('/api/admin/account-verifications/u1', json=body), db

    def test_approving_needs_the_admin_to_confirm_they_checked_the_id(self):
        response, db = self.review({'status': 'verified', 'user_category': 'Student'})
        self.assertEqual((response.status_code, response.get_json()['code']), (400, 'identity_check_required'))
        db.review_account_verification.assert_not_called()
        for wrong in ('true', 1, False, None):
            self.assertEqual(self.review({'status': 'verified', 'user_category': 'Student', 'identity_checked': wrong})[0].status_code, 400, wrong)
        ok, db = self.review({'status': 'verified', 'user_category': 'Student', 'identity_checked': True})
        self.assertEqual(ok.status_code, 200)
        db.review_account_verification.assert_called_once()

    def test_rejecting_still_needs_a_reason_and_no_id_confirmation(self):
        self.assertEqual(self.review({'status': 'rejected'})[0].status_code, 400)
        self.assertEqual(self.review({'status': 'rejected', 'review_note': 'The photo is blurry.'})[0].status_code, 200)

    def upload(self, content, mime='image/png'):
        db = MagicMock()
        db.get_user_by_account_id.return_value = {'account_id': 'u1', 'email': 'u@umak.edu.ph'}
        db._decrypt_profile_sensitive_fields.side_effect = lambda user: user
        client = client_for(profile_routes.profile_bp, '/api')
        data = {'document': (io.BytesIO(content), 'id.png', mime), 'document_type': 'government_id', 'dpa_consent': 'true'}
        with patch.object(profile_routes.JWTService, 'extract_token_from_header', return_value='t'), patch.object(profile_routes.JWTService, 'verify_token', return_value={'account_id': 'u1'}), \
             patch.object(profile_routes, 'get_db', return_value=db):
            response = client.post('/api/auth/profile/document-upload', data=data, content_type='multipart/form-data', headers={'Authorization': 'Bearer t'})
        return response, db

    def test_a_file_that_is_not_really_an_id_photo_is_refused(self):
        response, db = self.upload(b'this is just text pretending to be a picture')
        self.assertEqual((response.status_code, response.get_json()['code']), (400, 'invalid_document'))
        db.store_verification_document.assert_not_called()

    def test_a_real_image_is_accepted_and_waits_for_review(self):
        response, db = self.upload(PNG)
        self.assertEqual((response.status_code, response.get_json()['status']), (200, 'pending'))
        self.assertEqual(db.store_verification_document.call_args.kwargs['verification_status'], 'pending')


# ----------------------------------------------------------------------------------------------------------- notifications and badges
class NotificationReferenceTests(unittest.TestCase):
    def test_notifications_carry_the_readable_found_item_reference(self):
        store = {'user_notifications': [{'notification_id': 'n1', 'user_account_id': 'u1', 'found_item_id': 'item-1', 'created_at': iso(1)},
                                        {'notification_id': 'n2', 'user_account_id': 'u1', 'found_item_id': None, 'created_at': iso(2)}],
                 'found_items': [{'item_id': 'item-1', 'fpost_id': 'FP2031'}]}
        db = SupabaseDB.__new__(SupabaseDB)
        db.client = MemClient(store)
        notes = {n['notification_id']: n for n in db.get_user_notifications('u1')}
        self.assertEqual((notes['n1']['found_item_reference'], notes['n2']['found_item_reference']), ('FP2031', ''))

    def test_a_failed_lookup_never_hides_the_notifications(self):
        store = {'user_notifications': [{'notification_id': 'n1', 'user_account_id': 'u1', 'found_item_id': 'item-1', 'created_at': iso(1)}], 'found_items': []}
        db = SupabaseDB.__new__(SupabaseDB)
        db.client = MemClient(store, missing_columns={'found_items': ('fpost_id',)})
        self.assertEqual(db.get_user_notifications('u1')[0]['found_item_reference'], '')


class MenuBadgeTests(unittest.TestCase):
    def store(self):
        return {
            'claims': [{'claim_id': 'a', 'status': 'pending'}, {'claim_id': 'b', 'status': 'pending'}, {'claim_id': 'c', 'status': 'collected'}],
            'user_profiles': [{'account_id': '1', 'verification_status': 'pending', 'verification_document_url': 'x/y'}, {'account_id': '2', 'verification_status': 'pending', 'verification_document_url': None},
                              {'account_id': '3', 'verification_status': 'verified', 'verification_document_url': 'x/z'}],
            'smart_tags': [{'tag_id': 't1', 'status': 'pending_verification'}, {'tag_id': 't2', 'status': 'active'}],
            'auctions': [{'auction_id': 'a1', 'status': 'awaiting_admin'}, {'auction_id': 'a2', 'status': 'active'}, {'auction_id': 'a3', 'status': 'ended'}],
        }

    def test_only_work_waiting_for_an_administrator_is_counted(self):
        self.assertEqual(admin_badges.nav_badges(MemClient(self.store())), {'badges': {'claims': 2, 'users': 1, 'smart-tags': 1, 'auctions': 1}, 'total': 5})

    def test_a_missing_table_gives_zero_not_an_error(self):
        store = self.store()
        del store['smart_tags']
        client = MemClient(store, missing_columns={'auctions': ('auction_id',)})
        counts = admin_badges.pending_counts(client)
        self.assertEqual((counts['claims'], counts['smart-tags'], counts['auctions']), (2, 0, 0))

    def test_the_endpoint_is_for_administrators_only(self):
        db = MagicMock()
        db.client = MemClient(self.store())
        client = client_for(dashboard_routes.dashboard_bp)
        for level, status in (('admin', 200), ('super_admin', 200), ('guard', 403), ('user', 403)):
            patches = staff_patches(level, ADMIN_ID) + (patch.object(dashboard_routes, 'get_db', return_value=db),)
            for p in patches:
                p.start()
            try:
                self.assertEqual(client.get('/api/admin/nav-badges').status_code, status, level)
            finally:
                patch.stopall()


if __name__ == '__main__':
    unittest.main()
