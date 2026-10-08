"""Connecting the loose ends: the handover log, guard receipts, Smart Tag matches, the daily summary, claims vs auctions, one name for the
finished state, Philippine time, complete list reads, startup checks and the migration log."""
import sys
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from flask import Flask

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT.parent, ROOT / 'tests'):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from memdb import MemClient  # noqa: E402
from test_handover_and_timeouts import ADMIN_ID, AUCTION, CLAIM, ITEM, OWNER, WINNER, auction_row, auction_store, claim_client, claim_store, make_db as auction_db, iso  # noqa: E402
from test_report_lifecycle import ADMIN, FINDER, GUARD, GUARD2, make_db, make_store, missing, staff_patches  # noqa: E402
from Admin.Backend.claims_verification import routes as claim_routes  # noqa: E402
from Admin.Backend.found_items import routes as found_routes  # noqa: E402
from Users.Backend.claim import routes as user_claim_routes  # noqa: E402
from Users.Backend.email_prefs import routes as prefs_routes  # noqa: E402
from app.utils import admin_digest, analytics, custody, custody_log, email_prefs, migrations, paging, startup_checks  # noqa: E402
from app.utils.auction_db import AuctionService  # noqa: E402
from app.utils.email_service import EmailService  # noqa: E402
from app.utils.localtime import PHT, to_pht_date  # noqa: E402
from app.utils.smart_tags import SmartTagService, TagError  # noqa: E402
from app.utils.supabase_db import SupabaseDB  # noqa: E402

TAG = 'ABCDEFGHJK23'


def client_for(blueprint, prefix='/api/admin'):
    app = Flask(__name__)
    app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
    app.register_blueprint(blueprint, url_prefix=prefix)
    return app.test_client()


def real_db(store, **client_kwargs):
    db = SupabaseDB.__new__(SupabaseDB)
    db.client = MemClient(store, **client_kwargs)
    return db


class BrokenClient:
    """A database that fails every call, like a table that has not been created."""

    def table(self, name):
        raise RuntimeError(f'relation "{name}" does not exist (42P01)')


def held(item_id='F1', reference='FP1001', status='unclaimed', guard_id=GUARD, received_at=None, **extra):
    return {'item_id': item_id, 'fpost_id': reference, 'item_name': 'Black wallet', 'category': 'Personal Effects', 'description': 'Black wallet', 'location': 'Library',
            'turnover_location': 'Gate 1', 'found_date': '2026-10-01', 'created_at': '2026-10-01T02:00:00+00:00', 'status': status, 'guard_name_or_id': 'Gio Guard',
            'account_id': FINDER, 'reporter_account_id': FINDER, 'handover_guard_id': guard_id, 'received_at': received_at, 'received_by': GUARD if received_at else None, **extra}


# ------------------------------------------------------------------------------------------------------------ handover log
class CustodyLogTests(unittest.TestCase):
    def test_a_line_is_saved_for_a_known_event(self):
        store = {}
        self.assertTrue(custody_log.record(MemClient(store), 'F1', 'received', GUARD, 'Gio Guard', 'ok'))
        self.assertEqual([(r['found_item_id'], r['event'], r['actor_label']) for r in store['custody_log']], [('F1', 'received', 'Gio Guard')])

    def test_unknown_events_and_missing_items_are_ignored(self):
        store = {}
        self.assertFalse(custody_log.record(MemClient(store), 'F1', 'made_up'))
        self.assertFalse(custody_log.record(MemClient(store), None, 'received'))
        self.assertEqual(store.get('custody_log', []), [])

    def test_a_broken_database_never_blocks_the_action_it_describes(self):
        self.assertFalse(custody_log.record(BrokenClient(), 'F1', 'received'))

    def world(self, **item_extra):
        store = make_store(claim_status='collected')
        store['found_items'] = [held(status='returned', received_at='2026-10-01T05:00:00+00:00', **item_extra)]
        store['claims'] = [{'claim_id': 'C1', 'claim_reference': 'CL-1', 'found_item_id': 'F1', 'claimant_account_id': OWNER, 'status': 'collected',
                            'created_at': '2026-10-02T02:00:00+00:00', 'reviewed_at': '2026-10-03T02:00:00+00:00', 'reviewed_by': ADMIN,
                            'collected_at': '2026-10-04T02:00:00+00:00', 'released_by': GUARD}]
        return store

    def test_an_old_item_without_log_rows_is_rebuilt_from_its_timestamps_in_order(self):
        history = custody_log.timeline(MemClient(self.world()), 'FP1001')
        self.assertEqual([e['type'] for e in history['events']], ['turned_over', 'received', 'claim_filed', 'claim_approved', 'released'])
        self.assertEqual(history['events'][0]['actor'], 'Fina Reyes')
        self.assertEqual(history['events'][3]['actor'], 'Ana Admin')
        self.assertEqual(history['item']['fpost_id'], 'FP1001')

    def test_a_logged_event_is_never_shown_twice(self):
        store = self.world()
        store['custody_log'] = [{'log_id': 'l1', 'found_item_id': 'F1', 'event': 'received', 'actor_account_id': GUARD, 'actor_label': 'Gio Guard',
                                 'detail': 'The guard confirmed they have the item.', 'created_at': '2026-10-01T04:00:00+00:00'}]
        events = custody_log.timeline(MemClient(store), 'FP1001')['events']
        self.assertEqual([e['type'] for e in events].count('received'), 1)
        self.assertEqual(next(e for e in events if e['type'] == 'received')['at'], '2026-10-01T04:00:00+00:00')

    def test_steps_that_only_the_log_knows_are_included(self):
        store = self.world()
        store['custody_log'] = [{'log_id': 'l1', 'found_item_id': 'F1', 'event': 'auction_cancelled', 'actor_account_id': ADMIN, 'actor_label': None,
                                 'detail': 'The owner came forward.', 'created_at': '2026-10-02T12:00:00+00:00'}]
        events = custody_log.timeline(MemClient(store), 'FP1001')['events']
        cancelled = next(e for e in events if e['type'] == 'auction_cancelled')
        self.assertEqual((cancelled['label'], cancelled['actor'], cancelled['detail']), ('Auction cancelled', 'Ana Admin', 'The owner came forward.'))

    def test_an_unknown_item_has_no_history(self):
        self.assertIsNone(custody_log.timeline(MemClient(self.world()), 'FP9999'))

    def test_it_still_works_before_the_receipt_columns_exist(self):
        store = self.world()
        for column in ('received_at', 'received_by', 'smart_tag_id', 'handover_guard_id'):
            store['found_items'][0].pop(column, None)   # a database without these columns does not return them
        history = custody_log.timeline(MemClient(store, missing_columns={'found_items': ('received_at', 'received_by', 'smart_tag_id', 'handover_guard_id')}), 'FP1001')
        self.assertNotIn('received', [e['type'] for e in history['events']])
        self.assertIn('claim_filed', [e['type'] for e in history['events']])


# ------------------------------------------------------------------------------------------------------------ guard receipts
class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.store = make_store()
        self.store['found_items'] = [held('F1', 'FP1', guard_id=GUARD), held('F2', 'FP2', guard_id=GUARD2), held('F3', 'FP3', status='returned', guard_id=GUARD)]
        self.store['custody_log'] = []

    def post(self, level, account_id, body, **client_kwargs):
        db = make_db(self.store, **client_kwargs)
        db.get_user_by_account_id.side_effect = lambda a: next((dict(p) for p in self.store['user_profiles'] if p['account_id'] == a), None)
        client = client_for(claim_routes.claims_verification_bp)
        patches = staff_patches(level, account_id) + (patch.object(claim_routes, 'get_db', return_value=db), patch.object(claim_routes, '_log_admin_action'))
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            return client.post('/api/admin/claims/handover/received', json=body)

    def test_a_guard_confirms_an_item_handed_to_them(self):
        response = self.post('guard', GUARD, {'reference': 'FP1'})
        self.assertEqual(response.status_code, 200)
        item = self.store['found_items'][0]
        self.assertTrue(item['received_at'])
        self.assertEqual(item['received_by'], GUARD)
        self.assertEqual([r['event'] for r in self.store['custody_log']], ['received'])
        [notice] = [n for n in self.store['user_notifications'] if n['type'] == 'guard_received']
        self.assertEqual((notice['to'], notice['link_page']), (FINDER, 'my-reports'))

    def test_confirming_twice_changes_nothing_and_tells_nobody_again(self):
        self.post('guard', GUARD, {'reference': 'FP1'})
        again = self.post('guard', GUARD, {'reference': 'FP1'})
        self.assertEqual((again.status_code, again.get_json()['already']), (200, True))
        self.assertEqual(len(self.store['custody_log']), 1)
        self.assertEqual(len([n for n in self.store['user_notifications'] if n['type'] == 'guard_received']), 1)

    def test_a_guard_cannot_confirm_an_item_handed_to_another_guard(self):
        response = self.post('guard', GUARD, {'reference': 'FP2'})
        self.assertEqual(response.status_code, 403)
        self.assertIsNone(self.store['found_items'][1]['received_at'])

    def test_an_administrator_can_confirm_for_any_guard(self):
        self.assertEqual(self.post('admin', ADMIN, {'reference': 'FP2'}).status_code, 200)
        self.assertEqual(self.store['found_items'][1]['received_by'], ADMIN)

    def test_an_item_that_left_custody_cannot_be_confirmed(self):
        self.assertEqual(self.post('guard', GUARD, {'reference': 'FP3'}).status_code, 409)

    def test_bad_requests_and_normal_users(self):
        self.assertEqual(self.post('guard', GUARD, {}).status_code, 400)
        self.assertEqual(self.post('guard', GUARD, {'reference': 'FP404'}).status_code, 404)
        self.assertEqual(self.post('user', OWNER, {'reference': 'FP1'}).status_code, 403)

    def test_before_the_migration_it_asks_for_the_update_instead_of_failing(self):
        response = self.post('guard', GUARD, {'reference': 'FP1'}, missing_columns={'found_items': ('received_at',)})
        self.assertEqual((response.status_code, response.get_json()['code']), (503, 'setup_required'))

    def test_the_guards_list_shows_what_is_confirmed(self):
        self.store['found_items'][0]['received_at'] = '2026-10-02T00:00:00+00:00'
        db = make_db(self.store)
        client = client_for(claim_routes.claims_verification_bp)
        patches = staff_patches('guard', GUARD) + (patch.object(claim_routes, 'get_db', return_value=db),)
        with patches[0], patches[1], patches[2], patches[3]:
            items = client.get('/api/admin/claims/handover/assigned').get_json()['items']
        self.assertEqual([(i['reference'], bool(i['receivedAt'])) for i in items], [('FP1', True)])


# ------------------------------------------------------------------------------------------------------------ item history endpoint
class HistoryEndpointTests(unittest.TestCase):
    def get(self, reference, allowed=True):
        store = make_store()
        store['found_items'] = [held()]
        db = make_db(store)
        client = client_for(found_routes.found_items_bp)
        require = patch.object(found_routes, '_require_admin', return_value={'account_id': ADMIN, 'access_level': 'admin'}) if allowed \
            else patch.object(found_routes, '_require_admin', side_effect=PermissionError('Administrator access required'))
        with require, patch.object(found_routes, 'get_db', return_value=db):
            return client.get(f'/api/admin/found-items/{reference}/history')

    def test_an_administrator_gets_the_timeline(self):
        response = self.get('FP1001')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['events'][0]['type'], 'turned_over')

    def test_an_unknown_item_is_404_and_a_non_admin_is_403(self):
        self.assertEqual(self.get('FP404').status_code, 404)
        self.assertEqual(self.get('FP1001', allowed=False).status_code, 403)


# ------------------------------------------------------------------------------------------------------------ Smart Tag match
class SmartTagLinkTests(unittest.TestCase):
    def service(self, **tag_extra):
        tag = {'tag_id': TAG, 'status': 'active', 'owner_account_id': OWNER, 'item_name': 'Umbrella', 'is_disabled': False, 'valid_until': None, **tag_extra}
        store = {'smart_tags': [tag], 'user_profiles': [{'account_id': OWNER, 'fname': 'Maria', 'lname': 'Santos', 'email': 'maria@umak.edu.ph'}]}
        db = MagicMock()
        db.client = MemClient(store)
        db.get_user_by_account_id.side_effect = lambda a: dict(store['user_profiles'][0]) if a == OWNER else None
        db._decrypt_profile_sensitive_fields = None
        return SmartTagService(db), db

    def test_the_owner_is_told_in_the_app_and_by_email(self):
        service, db = self.service()
        with patch('app.utils.email_service.send_reference_email_best_effort', return_value=True) as email:
            service.link_found_item(TAG.lower(), 'FP2001', 'Blue umbrella', 'F9')
        notice = db.create_user_notification.call_args
        self.assertEqual((notice.args[0], notice.kwargs['notification_type'], notice.kwargs['link_page'], notice.kwargs['found_item_id']), (OWNER, 'smart_tag_found', 'claim', 'F9'))
        self.assertEqual(email.call_args.kwargs['to_email'], 'maria@umak.edu.ph')
        self.assertEqual(email.call_args.kwargs['reference'], 'FP2001')

    def test_a_tag_that_cannot_reach_an_owner_is_refused(self):
        for extra, status in (({'status': 'unassigned'}, 409), ({'owner_account_id': None}, 409), ({'is_disabled': True}, 409)):
            service, db = self.service(**extra)
            with self.assertRaises(TagError) as raised:
                service.link_found_item(TAG, 'FP2001', 'Umbrella')
            self.assertEqual(raised.exception.status, status)
            db.create_user_notification.assert_not_called()

    def test_a_code_that_is_not_a_tag_or_not_found(self):
        service, _ = self.service()
        with self.assertRaises(TagError) as bad:
            service.link_found_item('not a tag!', 'FP2001', 'Umbrella')
        self.assertEqual(bad.exception.status, 400)
        with self.assertRaises(TagError) as unknown:
            service.link_found_item('ZZZZZZZZZZ22', 'FP2001', 'Umbrella')
        self.assertEqual(unknown.exception.status, 404)

    def register(self, code, **tag_extra):
        service, db = self.service(**tag_extra)
        db.next_fpost_id.return_value = 'FP2001'
        db.create_found_item.side_effect = lambda payload: {**payload, 'item_id': 'NEW1'}
        client = client_for(found_routes.found_items_bp)
        body = {'item': 'Blue umbrella', 'category': 'Personal Effects', 'locationFound': 'Gate', 'dateFound': '2026-10-05', 'storage': 'Cabinet 2', 'smartTagCode': code}
        profile = {'account_id': ADMIN, 'fname': 'Ana', 'lname': 'Admin', 'email': 'ana@umak.edu.ph'}
        db.get_user_by_account_id.side_effect = lambda a: dict(profile) if a == ADMIN else {'account_id': OWNER, 'fname': 'Maria', 'email': 'maria@umak.edu.ph'}
        with patch.object(found_routes, '_require_admin', return_value={'account_id': ADMIN, 'access_level': 'admin'}), patch.object(found_routes, 'get_db', return_value=db), \
             patch.object(found_routes, '_log_admin_action'), patch('app.utils.email_service.send_reference_email_best_effort', return_value=True):
            return client.post('/api/admin/found-items', json=body), db

    def test_registering_an_item_with_a_tag_links_it_and_tells_the_owner(self):
        response, db = self.register(TAG)
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.get_json()['smart_tag_owner_notified'])
        self.assertIn('Smart Tag owner was told', response.get_json()['message'])
        self.assertEqual(db.create_found_item.call_args.args[0]['smart_tag_id'], TAG)
        self.assertEqual([r['event'] for r in db.client.store['custody_log']], ['registered', 'tag_matched'])

    def test_a_malformed_or_unknown_code_saves_nothing(self):
        for code, status in (('nope!', 400), ('ZZZZZZZZZZ22', 404)):
            response, db = self.register(code)
            self.assertEqual(response.status_code, status, code)
            db.create_found_item.assert_not_called()

    def test_an_inactive_tag_still_registers_the_item_but_says_the_owner_was_not_told(self):
        response, db = self.register(TAG, status='unassigned')
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.get_json()['smart_tag_owner_notified'])
        self.assertIn('could not be told', response.get_json()['message'])
        self.assertEqual([r['event'] for r in db.client.store['custody_log']], ['registered'])

    def test_no_code_means_no_tag(self):
        response, db = self.register('')
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(db.create_found_item.call_args.args[0]['smart_tag_id'])


# ------------------------------------------------------------------------------------------------------------ claims vs auctions
class ClaimAuctionTests(unittest.TestCase):
    def approve(self, status='approved_for_pickup'):
        store = claim_store(status='pending')
        db = auction_db(store)
        db.update_claim_status.side_effect = lambda claim_id, st, admin_id, reason=None: store['claims'][0].update(status=st) or dict(store['claims'][0])
        service = MagicMock()
        service.cancel_open_for_item.return_value = ['Blue umbrella']
        client, patches = claim_client(db)
        email = MagicMock()
        email.send_claim_approved_email.return_value = True
        with patches[0], patches[1], patches[2], patch.object(claim_routes, 'EmailService', return_value=email), patch.object(claim_routes, 'AuctionService', return_value=service):
            response = client.patch(f'/api/admin/claims/{CLAIM}/status', json={'status': status, 'rejection_reason': 'No match'})
        return response, service

    def test_approving_a_claim_cancels_the_auctions_of_that_item(self):
        response, service = self.approve()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['cancelled_auctions'], ['Blue umbrella'])
        self.assertEqual(service.cancel_open_for_item.call_args.args[0], ITEM)
        self.assertIn('ownership claim was approved', service.cancel_open_for_item.call_args.args[1])

    def test_rejecting_a_claim_leaves_the_auction_alone(self):
        response, service = self.approve('rejected')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['cancelled_auctions'], [])
        service.cancel_open_for_item.assert_not_called()

    LIVE = {'status': 'active', 'fulfillment_status': None, 'winner_account_id': None,
            'starts_at': (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(), 'ends_at': (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()}

    def auctions(self, **extra):
        store = auction_store(**extra)
        db = auction_db(store)
        return store, AuctionService(db)

    def test_open_auctions_are_cancelled_the_leader_is_told_and_the_log_records_it(self):
        store, service = self.auctions(**{**self.LIVE, 'highest_bidder_id': WINNER})
        self.assertEqual(service.cancel_open_for_item(ITEM, 'The owner came forward.', ADMIN_ID), ['Blue umbrella'])
        self.assertEqual(store['auctions'][0]['status'], 'cancelled')
        self.assertEqual([n['type'] for n in store['user_notifications']], ['auction_cancelled'])
        self.assertEqual([r['event'] for r in store['custody_log']], ['auction_cancelled'])

    def test_a_finished_auction_is_not_touched(self):
        store, service = self.auctions()
        self.assertEqual(service.cancel_open_for_item(ITEM, 'x', ADMIN_ID), [])
        self.assertEqual(store['auctions'][0]['status'], 'ended')

    def test_it_never_raises_even_when_the_database_fails(self):
        service = AuctionService(SimpleNamespace(client=BrokenClient()))
        self.assertEqual(service.cancel_open_for_item(ITEM, 'x'), [])

    def test_the_auction_list_flags_an_item_with_a_claim_waiting_and_reads_without_writing(self):
        store, service = self.auctions(**self.LIVE)
        store['claims'] = [{'claim_id': 'c1', 'found_item_id': ITEM, 'status': 'pending'}]
        before = [dict(r) for r in store['auctions']]
        with patch.object(AuctionService, 'settle_and_notify') as settle:
            listing = service.admin_list()
        settle.assert_not_called()
        self.assertEqual(store['auctions'], before)
        self.assertTrue(listing['auctions'][0]['pending_claim'])

    def test_a_rejected_claim_or_a_finished_auction_is_not_flagged(self):
        store, service = self.auctions(**self.LIVE)
        store['claims'] = [{'claim_id': 'c1', 'found_item_id': ITEM, 'status': 'rejected'}]
        self.assertFalse(service.admin_list()['auctions'][0]['pending_claim'])
        store2, service2 = self.auctions()
        store2['claims'] = [{'claim_id': 'c1', 'found_item_id': ITEM, 'status': 'pending'}]
        self.assertFalse(service2.admin_list()['auctions'][0]['pending_claim'])

    def listing(self, auction_status):
        store = {
            'claims': [{'claim_id': 'c1', 'claim_reference': 'CL1', 'found_item_id': ITEM, 'claimant_account_id': OWNER, 'status': 'pending', 'created_at': iso(5)}],
            'found_items': [{'item_id': ITEM, 'fpost_id': 'FP1001', 'item_name': 'Blue umbrella'}],
            'user_profiles': [{'account_id': OWNER, 'fname': 'Maria', 'lname': 'Santos', 'campus_id': 'K1', 'email': 'm@umak.edu.ph'}],
            'auctions': [{'auction_id': AUCTION, 'found_item_id': ITEM, 'status': auction_status}],
        }
        with patch.object(SupabaseDB, '_create_signed_storage_url', return_value=''), patch.object(SupabaseDB, '_decrypt_claim_sensitive_fields', lambda self, claim: dict(claim)):
            return real_db(store).list_admin_claims()

    def test_the_claims_list_marks_an_item_that_is_in_an_auction(self):
        for status, expected in (('active', True), ('scheduled', True), ('awaiting_admin', True), ('ended', False), ('cancelled', False)):
            self.assertEqual(self.listing(status)[0]['inAuction'], expected, status)

    def submit_claim(self, auction_status):
        store = make_store()
        store['auctions'] = [{'auction_id': AUCTION, 'found_item_id': 'F1', 'status': auction_status}] if auction_status else []
        db = make_db(store)
        db.get_found_item_by_fpost_id.return_value = {'item_id': 'F1', 'fpost_id': 'FP1001', 'status': 'unclaimed', 'item_name': 'Black wallet'}
        db.get_pending_claim.return_value = None
        db.get_missing_items_by_account.return_value = []
        db.create_claim.return_value = {'claim_id': 'C2', 'claim_reference': 'CL2'}
        db.get_user_by_account_id.return_value = store['user_profiles'][0]
        db.client = MemClient(store)
        db.client.storage = MagicMock()
        db.client.storage.from_.return_value.create_signed_url.return_value = {'signedURL': 'x'}
        import io
        png = b'\x89PNG\r\n\x1a\n' + b'0' * 64
        data = {'fpost_id': 'FP1001', 'claim_reason': 'It is my wallet, it has my name inside', 'identity_document_type': 'campus_id', 'dpa_consent': 'true',
                'proof_image': (io.BytesIO(png), 'proof.png', 'image/png'), 'identity_document': (io.BytesIO(png), 'id.png', 'image/png')}
        client = client_for(user_claim_routes.claims_bp, '/api/claims')
        with patch.object(user_claim_routes, 'get_db', return_value=db), patch.object(user_claim_routes, '_account_id', return_value=OWNER), \
             patch.object(user_claim_routes, '_signed_url', return_value='x'), patch.object(user_claim_routes, 'send_reference_email_best_effort', return_value=True):
            return client.post('/api/claims', data=data, content_type='multipart/form-data')

    def test_a_claimant_is_warned_when_the_item_is_in_an_auction(self):
        response = self.submit_claim('active')
        self.assertEqual(response.status_code, 201)
        self.assertIn('auction', response.get_json()['auction_notice'])

    def test_no_warning_without_an_auction(self):
        self.assertIsNone(self.submit_claim(None).get_json()['auction_notice'])
        self.assertIsNone(self.submit_claim('cancelled').get_json()['auction_notice'])


# ------------------------------------------------------------------------------------------------------------ one name for the finished state
class AiMatchStatusTests(unittest.TestCase):
    def db(self, **report):
        store = make_store(reports=[missing('M1', 'MP1001', **report)])
        store['found_items'].append({'item_id': 'F2', 'fpost_id': 'FP1002', 'item_name': 'Other wallet', 'status': 'unclaimed'})
        db = real_db(store)
        db.log_user_activity = MagicMock()
        db.create_user_notification = MagicMock(return_value={'notification_id': 'n1'})
        db.get_user_by_account_id = MagicMock(return_value={'fname': 'Ana', 'lname': 'Admin'})
        return db, store

    def status(self, store):
        return store['missing_items'][0]['status']

    def test_confirming_a_match_makes_the_lost_report_found(self):
        db, store = self.db()
        db.confirm_ai_match_and_notify('MP1001', 'FP1001', ADMIN)
        self.assertEqual(self.status(store), 'found')

    def test_a_completed_report_is_not_reopened_by_a_new_confirmation(self):
        db, store = self.db(status='returned')
        db.confirm_ai_match_and_notify('MP1001', 'FP1001', ADMIN)
        self.assertEqual(self.status(store), 'returned')

    def test_rejecting_the_only_confirmed_match_sends_the_report_back_to_searching(self):
        db, store = self.db()
        db.confirm_ai_match_and_notify('MP1001', 'FP1001', ADMIN)
        db.reject_ai_match('MP1001', 'FP1001', ADMIN)
        self.assertEqual(self.status(store), 'missing')

    def test_another_confirmed_match_keeps_the_report_found(self):
        db, store = self.db()
        db.confirm_ai_match_and_notify('MP1001', 'FP1001', ADMIN)
        db.confirm_ai_match_and_notify('MP1001', 'FP1002', ADMIN)
        db.reject_ai_match('MP1001', 'FP1001', ADMIN)
        self.assertEqual(self.status(store), 'found')


class ManualCompletionNoticeTests(unittest.TestCase):
    def test_the_owner_is_told_when_an_administrator_completes_a_lost_report_by_hand(self):
        from app.utils.report_lifecycle import ReportLifecycle
        store = make_store(reports=[missing('M1', 'MP1001')])
        ReportLifecycle(make_db(store)).notify_completed_by_hand(store['missing_items'][0])
        [notice] = store['user_notifications']
        self.assertEqual((notice['to'], notice['title'], notice['type']), (OWNER, 'Your lost report is completed', 'report_completed'))


# ------------------------------------------------------------------------------------------------------------ daily summary
NOW_9AM = datetime(2026, 10, 20, 1, 0, tzinfo=timezone.utc)      # 09:00 in Makati, a Tuesday


class DigestTests(unittest.TestCase):
    def store(self, **extra):
        store = {
            'user_profiles': [
                {'account_id': ADMIN, 'fname': 'Ana', 'lname': 'Admin', 'email': 'ana@umak.edu.ph', 'access_level': 'admin', 'is_active': True},
                {'account_id': ADMIN_ID, 'fname': 'Opt', 'lname': 'Out', 'email': 'out@umak.edu.ph', 'access_level': 'super_admin', 'is_active': True, 'email_preferences': {'admin_digest': False}},
                {'account_id': FINDER, 'fname': 'Fina', 'lname': 'Reyes', 'email': 'fina@umak.edu.ph', 'access_level': 'user', 'is_active': True},
            ],
            'claims': [{'claim_id': 'c1', 'found_item_id': 'F1', 'status': 'pending', 'created_at': (NOW_9AM - timedelta(days=9)).isoformat()},
                       {'claim_id': 'c2', 'found_item_id': 'F1', 'status': 'pending', 'created_at': (NOW_9AM - timedelta(days=1)).isoformat()}],
            'found_items': [held('F1', 'FP1', received_at=None)],
            'system_settings': [],
        }
        store.update(extra)
        return store

    def run_digest(self, store, now=NOW_9AM):
        db = SimpleNamespace(client=MemClient(store, unique={'system_settings': 'setting_key'}))
        service = MagicMock()
        service.send_admin_digest_email.return_value = True
        with patch('app.utils.email_service.EmailService', return_value=service), patch.object(email_prefs, 'unsubscribe_url', return_value='https://x/unsub'):
            return admin_digest.process_admin_digest(db, now), service

    def test_it_is_sent_once_to_admins_who_have_not_opted_out(self):
        store = self.store()
        result, service = self.run_digest(store)
        self.assertEqual((result['sent'], result['recipients']), (1, 1))
        args = service.send_admin_digest_email.call_args.args
        self.assertEqual((args[0], args[1], args[3]), ('ana@umak.edu.ph', 'Ana', 'Tuesday, October 20'))
        self.assertEqual(args[2]['counts']['claims'], 2)
        self.assertEqual(args[2]['overdue'][0]['days'], 9)
        self.assertEqual([r['setting_key'] for r in store['system_settings']], ['admin_digest:2026-10-20'])

    def test_a_second_run_the_same_day_sends_nothing(self):
        store = self.store()
        self.run_digest(store)
        result, service = self.run_digest(store, NOW_9AM + timedelta(hours=3))
        self.assertEqual(result['sent'], 0)
        service.send_admin_digest_email.assert_not_called()
        self.assertEqual(len(store['system_settings']), 1)

    def test_the_next_day_sends_again(self):
        store = self.store()
        self.run_digest(store)
        result, _ = self.run_digest(store, NOW_9AM + timedelta(days=1))
        self.assertEqual(result['sent'], 1)
        self.assertEqual(len(store['system_settings']), 2)

    def test_nothing_is_sent_before_the_digest_hour_in_makati(self):
        store = self.store()
        early = datetime(2026, 10, 19, 22, 0, tzinfo=timezone.utc)   # 06:00 on the 20th in Makati
        result, service = self.run_digest(store, early)
        self.assertEqual((result['sent'], store['system_settings']), (0, []))
        service.send_admin_digest_email.assert_not_called()

    def test_the_hour_is_a_setting(self):
        with patch.dict('os.environ', {'ADMIN_DIGEST_HOUR': '10'}):
            self.assertEqual(admin_digest.digest_hour(), 10)
            result, _ = self.run_digest(self.store())
        self.assertEqual(result['sent'], 0)
        with patch.dict('os.environ', {'ADMIN_DIGEST_HOUR': 'banana'}):
            self.assertEqual(admin_digest.digest_hour(), 8)

    def test_when_nothing_is_waiting_nothing_is_sent_and_the_day_stays_open(self):
        store = self.store(claims=[], found_items=[])
        result, service = self.run_digest(store)
        self.assertEqual((result['sent'], store['system_settings']), (0, []))
        service.send_admin_digest_email.assert_not_called()

    def test_everyone_opting_out_sends_nothing_and_does_not_use_up_the_day(self):
        store = self.store()
        store['user_profiles'][0]['email_preferences'] = {'admin_digest': False}
        result, service = self.run_digest(store)
        self.assertEqual((result['sent'], store['system_settings']), (0, []))

    def test_approved_claims_close_to_their_deadline_are_listed(self):
        store = self.store(claims=[
            {'claim_id': 'c1', 'claim_reference': 'CL1', 'found_item_id': 'F1', 'status': 'approved_for_pickup', 'pickup_deadline': (NOW_9AM + timedelta(days=1)).isoformat()},
            {'claim_id': 'c2', 'claim_reference': 'CL2', 'found_item_id': 'F1', 'status': 'approved_for_pickup', 'pickup_deadline': (NOW_9AM + timedelta(days=10)).isoformat()}],
            found_items=[held('F1', 'FP1', guard_id=None)])
        digest = admin_digest.build_digest(MemClient(store), NOW_9AM)
        self.assertEqual([d['reference'] for d in digest['dueSoon']], ['CL1'])
        self.assertEqual(digest['attention'], 1)

    def test_a_guard_who_has_not_confirmed_for_two_days_counts(self):
        store = self.store(claims=[])
        store['found_items'][0]['created_at'] = (NOW_9AM - timedelta(days=3)).isoformat()
        self.assertEqual(admin_digest.build_digest(MemClient(store), NOW_9AM)['lateReceipts'], 1)

    def test_the_email_lists_only_what_is_waiting(self):
        digest = {'counts': {'claims': 2, 'users': 0, 'smart-tags': 0, 'auctions': 1}, 'dueSoon': [{}], 'dueSoonDays': 3, 'lateReceipts': 1, 'auctionReady': 0,
                  'overdue': [{'item': 'Black wallet', 'reference': 'FP1', 'days': 9}], 'attention': 5}
        fake = MagicMock()
        fake.send_notice_email.return_value = True
        self.assertTrue(EmailService.send_admin_digest_email(fake, 'ana@umak.edu.ph', 'Ana', digest, 'Tuesday, October 20', 'https://x/unsub'))
        call = fake.send_notice_email.call_args
        self.assertIn('5 things waiting', call.args[1])
        self.assertEqual(call.kwargs['details'], {'Claims waiting for review': '2', 'Auction results to confirm': '1',
                                                  'Approved claims expiring within 3 days': '1', 'Items a guard has not confirmed receiving': '1'})
        self.assertIn('Black wallet (FP1): a claim has waited 9 days for a decision.', call.kwargs['notes'])


class StaffPreferenceTests(unittest.TestCase):
    def test_the_daily_summary_is_on_unless_switched_off_and_is_not_a_user_choice(self):
        self.assertTrue(email_prefs.allows({}, 'admin_digest'))
        self.assertFalse(email_prefs.allows({'email_preferences': {'admin_digest': False}}, 'admin_digest'))
        self.assertNotIn('admin_digest', email_prefs.get_prefs({'email_preferences': {'admin_digest': False}}))
        self.assertEqual(email_prefs.staff_prefs({'email_preferences': {'admin_digest': False}}), {'admin_digest': False})

    def test_saving_a_user_choice_keeps_the_staff_choice(self):
        merged = email_prefs.merged({'email_preferences': {'admin_digest': False}}, {'reminders': False})
        self.assertEqual(merged, {'admin_digest': False, 'reminders': False, 'announcements': True})
        self.assertEqual(email_prefs.clean_update({'admin_digest': True, 'bogus': True, 'reminders': 'yes'}), {'admin_digest': True})

    def call(self, method, body=None, row=None):
        store = {'user_profiles': [{'account_id': ADMIN, 'email_preferences': row}]}
        db = real_db(store)
        client = client_for(prefs_routes.email_prefs_bp, '/api/email')
        with patch.object(prefs_routes, '_db', return_value=db), patch.object(prefs_routes, '_account_id', return_value=ADMIN):
            response = getattr(client, method)('/api/email/preferences', json=body)
        return response, store

    def test_the_route_reads_and_writes_the_staff_choice(self):
        response, _ = self.call('get', row={'admin_digest': False})
        self.assertEqual(response.get_json()['staff'], {'admin_digest': False})
        response, store = self.call('put', {'admin_digest': False})
        self.assertEqual(response.get_json()['staff'], {'admin_digest': False})
        self.assertFalse(store['user_profiles'][0]['email_preferences']['admin_digest'])


# ------------------------------------------------------------------------------------------------------------ Philippine time
class LocalTimeTests(unittest.TestCase):
    def test_a_plain_date_stays_and_a_timestamp_is_converted(self):
        self.assertEqual(to_pht_date('2026-10-01'), date(2026, 10, 1))
        self.assertEqual(to_pht_date('2026-10-01T18:30:00+00:00'), date(2026, 10, 2))
        self.assertEqual(to_pht_date('2026-10-01T15:59:59Z'), date(2026, 10, 1))
        self.assertEqual(to_pht_date('2026-10-01T16:00:00Z'), date(2026, 10, 2))
        self.assertEqual(to_pht_date('2026-10-01T10:00:00'), date(2026, 10, 1))   # no zone means UTC
        self.assertIsNone(to_pht_date('soon'))
        self.assertIsNone(to_pht_date(''))
        self.assertIsNone(to_pht_date(None))

    def test_the_offset_is_eight_hours(self):
        self.assertEqual(PHT.utcoffset(None), timedelta(hours=8))

    def test_analytics_counts_a_late_evening_report_on_the_makati_day(self):
        self.assertEqual(analytics._day('2026-10-31T17:00:00+00:00'), date(2026, 11, 1))   # 01:00 on 1 November in Makati
        self.assertEqual(analytics._day('2026-10-31'), date(2026, 10, 31))


# ------------------------------------------------------------------------------------------------------------ startup checks
GOOD_ENV = {'SUPABASE_URL': 'https://x.supabase.co', 'SUPABASE_SERVICE_KEY': 'k', 'JWT_SECRET_KEY': 'a-long-random-secret-of-more-than-24-chars', 'APP_ENCRYPTION_KEY': 'enc', 'CORS_ORIGINS': 'https://ebalik.example'}


class StartupCheckTests(unittest.TestCase):
    def test_a_complete_production_environment_starts(self):
        startup_checks.assert_production_ready('production', env=GOOD_ENV)

    def test_every_problem_is_reported_at_once(self):
        with self.assertRaises(RuntimeError) as raised:
            startup_checks.assert_production_ready('production', env={'JWT_SECRET_KEY': 'dev-secret-key-change-in-production'})
        message = str(raised.exception)
        for expected in ('SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'APP_ENCRYPTION_KEY', 'JWT_SECRET_KEY is the development default', 'CORS_ORIGINS'):
            self.assertIn(expected, message)

    def test_a_short_secret_is_refused(self):
        self.assertTrue(any('JWT_SECRET_KEY' in p for p in startup_checks.production_problems({**GOOD_ENV, 'JWT_SECRET_KEY': 'short'})))

    def test_development_and_tests_are_never_blocked(self):
        startup_checks.assert_production_ready('development', env={})
        startup_checks.assert_production_ready('production', testing=True, env={})

    def test_the_emergency_switch_lets_a_broken_server_start(self):
        startup_checks.assert_production_ready('production', env={'ALLOW_INSECURE_START': 'true'})
        with self.assertRaises(RuntimeError):
            startup_checks.assert_production_ready('production', env={'ALLOW_INSECURE_START': 'no'})


# ------------------------------------------------------------------------------------------------------------ complete list reads
class PagingTests(unittest.TestCase):
    def rows(self, count):
        return MemClient({'t': [{'n': i} for i in range(count)]})

    def test_more_than_one_page_is_read_completely(self):
        client = self.rows(2500)
        rows = paging.fetch_all(lambda: client.table('t').select('*').order('n'))
        self.assertEqual(len(rows), 2500)
        self.assertEqual(len({r['n'] for r in rows}), 2500)

    def test_exact_multiples_and_small_tables(self):
        client = self.rows(1000)
        self.assertEqual(len(paging.fetch_all(lambda: client.table('t').select('*'))), 1000)
        self.assertEqual(paging.fetch_all(lambda: self.rows(0).table('t').select('*')), [])
        self.assertEqual(len(paging.fetch_all(lambda: self.rows(7).table('t').select('*'))), 7)

    def test_the_safety_cap_stops_a_runaway_list(self):
        client = self.rows(3500)
        self.assertEqual(len(paging.fetch_all(lambda: client.table('t').select('*'), cap=1500)), 1500)

    def test_the_cap_is_a_setting_with_limits(self):
        with patch.dict('os.environ', {'ADMIN_LIST_MAX': '2500'}):
            self.assertEqual(paging.list_cap(), 2500)
        with patch.dict('os.environ', {'ADMIN_LIST_MAX': '5'}):
            self.assertEqual(paging.list_cap(), 1000)
        with patch.dict('os.environ', {'ADMIN_LIST_MAX': 'many'}):
            self.assertEqual(paging.list_cap(), 10000)

    def test_the_admin_claim_list_reads_past_one_thousand_rows(self):
        store = {'claims': [{'claim_id': f'c{i}', 'claim_reference': f'CL{i}', 'found_item_id': 'F1', 'claimant_account_id': OWNER, 'status': 'pending', 'created_at': iso(i / 100)} for i in range(1100)],
                 'found_items': [{'item_id': 'F1', 'fpost_id': 'FP1', 'item_name': 'x'}], 'user_profiles': [{'account_id': OWNER, 'fname': 'M', 'lname': 'S'}], 'auctions': []}
        with patch.object(SupabaseDB, '_create_signed_storage_url', return_value=''), patch.object(SupabaseDB, '_decrypt_claim_sensitive_fields', lambda self, claim: dict(claim)):
            self.assertEqual(len(real_db(store).list_admin_claims()), 1100)


# ------------------------------------------------------------------------------------------------------------ migration log
class MigrationLogTests(unittest.TestCase):
    def test_applied_missing_and_unknown_migrations(self):
        status = migrations.migration_status(MemClient({'migration_log': [{'name': 'a'}, {'name': 'z'}]}), ['a', 'b'])
        self.assertEqual((status['available'], status['applied'], status['missing'], status['unknown']), (True, ['a', 'z'], ['b'], ['z']))

    def test_without_the_log_table_everything_counts_as_missing(self):
        status = migrations.migration_status(BrokenClient(), ['a', 'b'])
        self.assertEqual((status['available'], status['missing']), (False, ['a', 'b']))

    def test_the_shipped_files_are_listed_and_the_newest_logs_itself(self):
        names = migrations.expected_migrations()
        self.assertEqual(names, sorted(names))
        self.assertIn(migrations.LOG_MIGRATION, names)
        text = (migrations.MIGRATIONS_DIR / f'{migrations.LOG_MIGRATION}.sql').read_text(encoding='utf-8')
        self.assertIn('migration_log', text)
        self.assertIn(f"'{migrations.LOG_MIGRATION}'", text)

    def test_every_file_in_the_log_seed_exists_on_disk(self):
        text = (migrations.MIGRATIONS_DIR / f'{migrations.LOG_MIGRATION}.sql').read_text(encoding='utf-8')
        import re
        seeded = set(re.findall(r"'(\d{8}_[a-z0-9_]+)'", text))
        self.assertTrue(seeded)
        self.assertEqual(sorted(seeded - set(migrations.expected_migrations())), [])


# ------------------------------------------------------------------------------------------------------------ notices
class NoticeOwnershipTests(unittest.TestCase):
    def mark(self, account_id, notification_id='n1'):
        from Users.Backend.notifications import routes as notice_routes
        store = {'user_notifications': [{'notification_id': 'n1', 'user_account_id': GUARD, 'is_read': False}]}
        db = real_db(store)
        client = client_for(notice_routes.notifications_bp, '/api/notifications')
        with patch.object(notice_routes, 'get_db', return_value=db), patch.object(notice_routes, '_require_auth', return_value={'account_id': account_id}):
            return client.patch(f'/api/notifications/{notification_id}/read'), store

    def test_a_person_can_mark_their_own_notice_read(self):
        response, store = self.mark(GUARD)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(store['user_notifications'][0]['is_read'])

    def test_nobody_can_mark_someone_elses_notice_or_an_unknown_one(self):
        response, store = self.mark(FINDER)
        self.assertEqual(response.status_code, 404)
        self.assertFalse(store['user_notifications'][0]['is_read'])
        self.assertEqual(self.mark(GUARD, 'missing')[0].status_code, 404)


# ------------------------------------------------------------------------------------------------------------ overview fields
class OverviewFieldTests(unittest.TestCase):
    NOW = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)

    def test_a_claim_waiting_over_a_week_is_flagged_and_receipts_are_reported(self):
        items = [held('F1', 'FP1', guard_id=GUARD, received_at=None, smart_tag_id=TAG), held('F2', 'FP2', guard_id=GUARD, received_at='2026-10-02T00:00:00+00:00'), held('F3', 'FP3', guard_id=None)]
        claims = [{'claim_id': 'c1', 'found_item_id': 'F1', 'status': 'pending', 'created_at': (self.NOW - timedelta(days=8)).isoformat()},
                  {'claim_id': 'c2', 'found_item_id': 'F2', 'status': 'pending', 'created_at': (self.NOW - timedelta(days=2)).isoformat()}]
        result = custody.build_overview(items, claims, [], self.NOW)
        rows = {r['reference']: r for r in result['items']}
        self.assertEqual((rows['FP1']['claimOverdue'], rows['FP1']['claimWaitingDays'], rows['FP1']['receipt'], rows['FP1']['smartTag']), (True, 8, 'waiting', TAG))
        self.assertEqual((rows['FP2']['claimOverdue'], rows['FP2']['receipt']), (False, 'received'))
        self.assertEqual(rows['FP3']['receipt'], 'none')
        self.assertEqual((result['summary']['overdueClaims'], result['summary']['awaitingReceipt'], result['summary']['staleClaimDays']), (1, 1, 7))


if __name__ == '__main__':
    unittest.main()
