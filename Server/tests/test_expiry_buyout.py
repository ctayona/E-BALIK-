import sys
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock, patch

from flask import Flask

ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent
for path in (ROOT, PROJECT_ROOT, ROOT / 'tests'):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.utils import smart_tags as tags
from app.utils.auction_db import AuctionError, AuctionService, bidder_alias, parse_buyout
from app.utils.smart_tags import SmartTagService, TagError
from Admin.Backend.smart_tags import routes as admin_routes
from Users.Backend.auctions import routes as auction_routes
from test_smart_tags import ADMIN, CLAIM, OTHER, OWNER, PHONE, TAG, make_service, tag_row
from test_system_control import FakeClient, auction_row

NOW = datetime.now(timezone.utc)
iso = lambda delta: (NOW + delta).isoformat()
DAY = timedelta(days=1)


class ValidityHelperTests(unittest.TestCase):
    def test_adding_months_keeps_the_day_or_clamps_to_the_month_end(self):
        self.assertEqual(tags.add_months(datetime(2026, 8, 15, tzinfo=timezone.utc), 12), datetime(2027, 8, 15, tzinfo=timezone.utc))
        self.assertEqual(tags.add_months(datetime(2026, 1, 31, tzinfo=timezone.utc), 1), datetime(2026, 2, 28, tzinfo=timezone.utc))
        self.assertEqual(tags.add_months(datetime(2027, 1, 31, tzinfo=timezone.utc), 13), datetime(2028, 2, 29, tzinfo=timezone.utc))
        self.assertEqual(tags.add_months(datetime(2026, 11, 30, tzinfo=timezone.utc), 3), datetime(2027, 2, 28, tzinfo=timezone.utc))

    def test_validity_accepts_months_or_never_and_rejects_nonsense(self):
        self.assertEqual(tags.parse_validity(12), 12)
        self.assertEqual(tags.parse_validity('24'), 24)
        for never in (None, '', 0, '0', 'never'):
            self.assertIsNone(tags.parse_validity(never))
        for bad in (-1, 121, 'a year', 2.5 if False else 'x'):
            with self.assertRaises(TagError):
                tags.parse_validity(bad)

    def test_days_left_counts_down_and_goes_negative_after_expiry(self):
        self.assertEqual(tags.days_left(iso(10 * DAY + timedelta(hours=1))), 10)
        self.assertLess(tags.days_left(iso(-2 * DAY)), 0)
        self.assertIsNone(tags.days_left(None))

    def test_tag_types_are_ready_but_only_qr_is_on_by_default(self):
        with patch.dict('os.environ', {}, clear=False):
            import os
            os.environ.pop('SMART_TAG_TYPES_ENABLED', None)
            options = {o['value']: o for o in tags.tag_type_options()}
        self.assertEqual({k: v['enabled'] for k, v in options.items()}, {'qr': True, 'rfid': False, 'nfc': False})
        self.assertEqual(options['rfid']['label'], 'RFID')
        with patch.dict('os.environ', {'SMART_TAG_TYPES_ENABLED': 'qr, RFID ,bogus'}):
            self.assertEqual(tags.enabled_tag_types(), ['qr', 'rfid'])
        with patch.dict('os.environ', {'SMART_TAG_TYPES_ENABLED': 'nonsense'}):
            self.assertEqual(tags.enabled_tag_types(), ['qr'])

    def test_what_gets_written_onto_the_tag_depends_on_its_type(self):
        with patch.dict('os.environ', {'PUBLIC_SITE_URL': 'https://ebalik.example'}):
            self.assertEqual(tags.encode_value('qr', TAG), f'https://ebalik.example/tag/{TAG}')
            self.assertEqual(tags.encode_value('nfc', TAG), f'https://ebalik.example/tag/{TAG}')
            self.assertEqual(tags.encode_value('rfid', TAG), TAG)


class BatchGenerationTests(unittest.TestCase):
    def test_a_batch_records_type_validity_and_one_shared_batch_id(self):
        service, _, store = make_service()
        batch = service.create_batch(20, 'AY 2026-2027', ADMIN, 'qr', 12)
        self.assertEqual((batch['tag_type'], batch['validity_months'], len(batch['tag_ids'])), ('qr', 12, 20))
        self.assertEqual(len({r['batch_id'] for r in store['smart_tags']}), 1)
        self.assertEqual(store['smart_tags'][0]['batch_id'], batch['batch_id'])
        self.assertTrue(all(r['tag_type'] == 'qr' and r['validity_months'] == 12 and r.get('valid_until') is None for r in store['smart_tags']))
        self.assertEqual(len(batch['values']), 20)

    def test_two_batches_get_different_ids_even_with_the_same_label(self):
        service, _, store = make_service()
        first, second = service.create_batch(2, 'Same', ADMIN), service.create_batch(2, 'Same', ADMIN)
        self.assertNotEqual(first['batch_id'], second['batch_id'])

    def test_no_validity_means_the_tags_never_expire(self):
        service, _, store = make_service()
        service.create_batch(2, 'Forever', ADMIN, 'qr', None)
        self.assertTrue(all(r['validity_months'] is None for r in store['smart_tags']))

    def test_rfid_and_nfc_are_refused_until_they_are_switched_on(self):
        service, _, store = make_service()
        for kind in ('rfid', 'nfc'):
            with self.assertRaises(TagError) as caught:
                service.create_batch(2, 'x', ADMIN, kind, 12)
            self.assertIn('not available yet', caught.exception.message)
        for bad in ('laser', '<script>'):
            with self.assertRaises(TagError):
                service.create_batch(2, 'x', ADMIN, bad, 12)
        self.assertEqual(store['smart_tags'], [])
        with patch.dict('os.environ', {'SMART_TAG_TYPES_ENABLED': 'qr,rfid'}):
            batch = service.create_batch(3, 'RFID pilot', ADMIN, 'rfid', 24)
        self.assertEqual(batch['values'], batch['tag_ids'])  # an RFID chip is written with the bare code
        self.assertTrue(all(r['tag_type'] == 'rfid' for r in store['smart_tags']))

    def test_an_invalid_validity_creates_nothing(self):
        service, _, store = make_service()
        for bad in (999, -3, 'soon'):
            with self.assertRaises(TagError):
                service.create_batch(2, 'x', ADMIN, 'qr', bad)
        self.assertEqual(store['smart_tags'], [])


class ExpiryTests(unittest.TestCase):
    def blank(self, months=12, **extra):
        return {'tag_id': TAG, 'status': 'blank', 'owner_account_id': None, 'is_disabled': False, 'validity_months': months, 'batch_id': str(uuid.uuid4()), **extra}

    def test_the_validity_clock_starts_when_the_owner_registers(self):
        service, _, store = make_service([self.blank(12)])
        view = service.claim(TAG, OWNER, CLAIM)
        saved = store['smart_tags'][0]
        until = datetime.fromisoformat(saved['valid_until'])
        self.assertEqual(until, tags.add_months(datetime.fromisoformat(saved['claimed_at']), 12))
        self.assertIn(view['days_left'], (364, 365))
        self.assertEqual(view['validity_months'], 12)

    def test_a_tag_without_a_validity_period_gets_no_expiry_date(self):
        service, _, store = make_service([self.blank(None)])
        service.claim(TAG, OWNER, CLAIM)
        self.assertIsNone(store['smart_tags'][0].get('valid_until'))

    def test_a_scan_after_the_expiry_date_marks_it_expired_and_hides_everything(self):
        service, _, store = make_service([tag_row(valid_until=iso(-DAY), show_name=True, show_email=True, show_phone=True)])
        view = service.public_view(TAG)
        self.assertEqual(view, {'tag_id': TAG, 'status': 'expired'})
        self.assertEqual(store['smart_tags'][0]['status'], 'expired')  # saved, not just hidden
        for private in ('Maria', 'maria@umak.edu.ph', PHONE, 'laptop'):
            self.assertNotIn(private, str(view))

    def test_a_tag_that_is_still_valid_is_unaffected(self):
        service, _, store = make_service([tag_row(valid_until=iso(30 * DAY), show_name=True)])
        self.assertEqual(service.public_view(TAG)['status'], 'active')
        self.assertEqual(store['smart_tags'][0]['status'], 'active')

    def test_the_owner_sees_expired_in_their_dashboard(self):
        service, _, _ = make_service([tag_row(valid_until=iso(-DAY)), tag_row(tag_id='ZZZZZZZZZZ22', valid_until=iso(5 * DAY))])
        mine = {t['tag_id']: t for t in service.my_tags(OWNER)}
        self.assertEqual((mine[TAG]['status'], mine[TAG]['days_left']), ('expired', None))
        self.assertEqual((mine['ZZZZZZZZZZ22']['status'], mine['ZZZZZZZZZZ22']['days_left']), ('active', 4))

    def test_an_expired_tag_cannot_be_edited_and_cannot_notify_anyone(self):
        service, db, _ = make_service([tag_row(valid_until=iso(-DAY))])
        with self.assertRaises(TagError) as caught:
            service.update(TAG, OWNER, {'status': 'lost'})
        self.assertEqual((caught.exception.status, caught.exception.extra['code']), (403, 'expired'))
        with self.assertRaises(TagError) as caught:
            service.report_found(TAG, 'found it', '')
        self.assertEqual(caught.exception.status, 409)
        db.create_user_notification.assert_not_called()

    def test_a_lost_tag_expires_too(self):
        service, _, _ = make_service([tag_row(status='lost', valid_until=iso(-DAY))])
        self.assertEqual(service.public_view(TAG)['status'], 'expired')

    def test_the_admin_list_expires_everything_that_is_due_and_counts_it(self):
        rows = [tag_row(tag_id='DUE000000001', valid_until=iso(-DAY)), tag_row(tag_id='DUE000000002', status='lost', valid_until=iso(-3 * DAY)),
                tag_row(tag_id='OKAY00000001', valid_until=iso(90 * DAY)), {'tag_id': 'BLANK0000001', 'status': 'blank', 'is_disabled': False, 'created_at': '2026-10-01'}]
        service, _, _ = make_service(rows)
        result = service.admin_list('all')
        self.assertEqual((result['stats']['expired'], result['stats']['claimed'], result['stats']['blank']), (2, 3, 1))
        self.assertEqual(sorted(t['tag_id'] for t in service.admin_list('expired')['tags']), ['DUE000000001', 'DUE000000002'])
        one = next(t for t in result['tags'] if t['tag_id'] == 'OKAY00000001')
        self.assertEqual(one['days_left'], 89)
        self.assertEqual(result['tag_types'][0]['value'], 'qr')

    def test_visits_are_counted_but_writes_are_throttled(self):
        service, _, store = make_service([tag_row()])
        service.public_view(TAG)
        service.public_view(TAG)  # inside the 30 second window: not written again
        self.assertEqual(store['smart_tags'][0]['scan_count'], 1)
        store['smart_tags'][0]['last_scanned_at'] = iso(-timedelta(minutes=5))
        service.public_view(TAG)
        self.assertEqual(store['smart_tags'][0]['scan_count'], 2)

    def test_a_blank_tag_visit_writes_nothing(self):
        service, _, store = make_service([{'tag_id': TAG, 'status': 'blank', 'is_disabled': False}])
        service.public_view(TAG)
        self.assertNotIn('scan_count', store['smart_tags'][0])


class RenewalTests(unittest.TestCase):
    def test_renewing_an_expired_tag_makes_it_active_from_today(self):
        service, db, store = make_service([tag_row(status='expired', valid_until=iso(-40 * DAY))])
        row = service.renew(TAG, 12, ADMIN)
        until = datetime.fromisoformat(store['smart_tags'][0]['valid_until'])
        self.assertEqual(store['smart_tags'][0]['status'], 'active')
        self.assertEqual(until.date(), tags.add_months(datetime.now(timezone.utc), 12).date())
        self.assertEqual(db.create_user_notification.call_args.kwargs['notification_type'], 'smart_tag_renewed')

    def test_renewing_a_tag_that_is_still_valid_adds_to_the_end_date(self):
        end = NOW + 60 * DAY
        service, _, store = make_service([tag_row(valid_until=end.isoformat())])
        service.renew(TAG, 6, ADMIN)
        self.assertEqual(datetime.fromisoformat(store['smart_tags'][0]['valid_until']).date(), tags.add_months(end, 6).date())

    def test_only_a_registered_tag_can_be_renewed_and_the_months_are_checked(self):
        service, _, _ = make_service([{'tag_id': TAG, 'status': 'blank', 'is_disabled': False}])
        with self.assertRaises(TagError):
            service.renew(TAG, 12, ADMIN)
        service, _, _ = make_service([tag_row()])
        for bad in (None, 0, 999, 'x'):
            with self.assertRaises(TagError):
                service.renew(TAG, bad, ADMIN)


def batch_rows():
    a, b, c = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    rows = []
    for i in range(3):  # batch A: 3 tags, one registered and expiring in 10 days
        rows.append({'tag_id': f'AAAAAAAAAA{i}2', 'status': 'blank', 'batch_id': a, 'batch_label': 'Batch A', 'is_disabled': False, 'created_at': '2026-09-01', 'validity_months': 12, 'tag_type': 'qr'})
    rows[0].update(status='active', owner_account_id=OWNER, valid_until=iso(10 * DAY), item_name='Laptop')
    for i in range(2):  # batch B: expires in 200 days
        rows.append({'tag_id': f'BBBBBBBBBB{i}2', 'status': 'active', 'owner_account_id': OTHER, 'batch_id': b, 'batch_label': 'Batch B', 'is_disabled': False, 'created_at': '2026-09-02', 'validity_months': 12, 'tag_type': 'qr', 'valid_until': iso(200 * DAY)})
    rows.append({'tag_id': 'CCCCCCCCCC22', 'status': 'blank', 'batch_id': c, 'batch_label': 'Batch C', 'is_disabled': False, 'created_at': '2026-10-01', 'tag_type': 'qr'})  # never expires
    return rows, a, b, c


class BatchManagementTests(unittest.TestCase):
    def test_batches_are_listed_closest_to_expiring_first_with_counts(self):
        rows, a, b, c = batch_rows()
        service, _, _ = make_service(rows)
        result = service.batches()['batches']
        self.assertEqual([x['label'] for x in result], ['Batch A', 'Batch B', 'Batch C'])
        first = result[0]
        self.assertEqual((first['total'], first['blank'], first['active'], first['expiring_soon']), (3, 2, 1, 1))
        self.assertEqual(first['days_to_expiry'], 9)
        self.assertEqual(result[1]['days_to_expiry'], 199)
        self.assertIsNone(result[2]['days_to_expiry'])
        self.assertEqual(result[2]['batch_id'], c)

    def test_deactivating_a_batch_switches_off_only_that_batch_and_tells_each_owner_once(self):
        rows, a, b, c = batch_rows()
        service, db, store = make_service(rows)
        with self.assertRaises(TagError):
            service.set_batch_disabled(a, True, '', ADMIN)  # a reason is required
        outcome = service.set_batch_disabled(a, True, 'Roll stolen from the office', ADMIN)
        self.assertEqual(outcome['changed'], 3)
        disabled = {r['tag_id'] for r in store['smart_tags'] if r['is_disabled']}
        self.assertEqual(disabled, {'AAAAAAAAAA02', 'AAAAAAAAAA12', 'AAAAAAAAAA22'})
        self.assertEqual(db.create_user_notification.call_count, 1)  # only the registered tag has an owner
        self.assertEqual(db.create_user_notification.call_args.args[0], OWNER)
        # a blank sticker from the stolen roll can no longer be registered
        with self.assertRaises(TagError) as caught:
            service.claim('AAAAAAAAAA12', OTHER, CLAIM)
        self.assertEqual(caught.exception.status, 403)
        self.assertEqual(service.public_view('AAAAAAAAAA02'), {'tag_id': 'AAAAAAAAAA02', 'status': 'disabled'})

    def test_reactivating_a_batch_restores_it(self):
        rows, a, b, c = batch_rows()
        service, _, store = make_service(rows)
        service.set_batch_disabled(a, True, 'Stolen', ADMIN)
        self.assertEqual(service.set_batch_disabled(a, False, '', ADMIN)['changed'], 3)
        self.assertFalse(any(r['is_disabled'] for r in store['smart_tags']))
        self.assertEqual(service.set_batch_disabled(a, False, '', ADMIN)['changed'], 0)  # nothing left to restore

    def test_an_unknown_or_malformed_batch_is_a_404(self):
        service, _, _ = make_service(batch_rows()[0])
        for bad in ('not-a-uuid', str(uuid.uuid4()), '', "1' OR '1'='1"):
            with self.assertRaises(TagError) as caught:
                service.set_batch_disabled(bad, True, 'stolen roll', ADMIN)
            self.assertEqual(caught.exception.status, 404)


def admin_client(service, level='admin'):
    app = Flask(__name__)
    app.config.update(SUPABASE_URL='http://unused', SUPABASE_SERVICE_KEY='unused')
    app.register_blueprint(admin_routes.smart_tags_bp, url_prefix='/api/admin')

    def require(required_level='admin'):
        if required_level == 'super_admin' and level != 'super_admin':
            raise PermissionError('Super administrator access required')
        return {'account_id': ADMIN, 'access_level': level}
    return app.test_client(), patch.object(admin_routes, '_service', return_value=(MagicMock(), service)), patch.object(admin_routes, '_require_admin', side_effect=require)


class AdminTagRouteTests(unittest.TestCase):
    def test_generating_with_a_type_and_validity(self):
        service, _, store = make_service()
        client, ps, pa = admin_client(service)
        with ps, pa:
            ok = client.post('/api/admin/smart-tags/batch', json={'count': 5, 'label': 'AY', 'tag_type': 'qr', 'validity_months': 12})
            refused = client.post('/api/admin/smart-tags/batch', json={'count': 5, 'tag_type': 'rfid', 'validity_months': 12})
        self.assertEqual((ok.status_code, ok.get_json()['validity_months'], ok.get_json()['tag_type']), (201, 12, 'qr'))
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(len(store['smart_tags']), 5)

    def test_the_batch_list_and_renewal_work_for_admins(self):
        rows, a, b, c = batch_rows()
        rows[0].update(status='expired', valid_until=iso(-DAY))
        service, _, _ = make_service(rows)
        client, ps, pa = admin_client(service, 'admin')
        with ps, pa:
            listed = client.get('/api/admin/smart-tags/batches')
            renewed = client.post(f"/api/admin/smart-tags/{rows[0]['tag_id']}/renew", json={'months': 12})
            bad = client.post(f"/api/admin/smart-tags/{rows[0]['tag_id']}/renew", json={'months': 999})
        self.assertEqual((listed.status_code, len(listed.get_json()['batches'])), (200, 3))
        self.assertEqual((renewed.status_code, bad.status_code), (200, 400))

    def test_only_a_super_admin_can_deactivate_a_whole_batch(self):
        rows, a, b, c = batch_rows()
        service, _, store = make_service(rows)
        client, ps, pa = admin_client(service, 'admin')
        with ps, pa:
            self.assertEqual(client.post(f'/api/admin/smart-tags/batches/{a}/disable', json={'reason': 'stolen'}).status_code, 403)
            self.assertEqual(client.post(f'/api/admin/smart-tags/batches/{a}/enable').status_code, 403)
        self.assertFalse(any(r['is_disabled'] for r in store['smart_tags']))
        client, ps, pa = admin_client(service, 'super_admin')
        with ps, pa:
            done = client.post(f'/api/admin/smart-tags/batches/{a}/disable', json={'reason': 'Roll stolen'})
            missing = client.post(f'/api/admin/smart-tags/batches/{uuid.uuid4()}/disable', json={'reason': 'stolen roll'})
        self.assertEqual((done.status_code, done.get_json()['changed'], missing.status_code), (200, 3, 404))


# --------------------------------------------------------------------------------------------------- auctions
def auction_service(rows=None, rpc=None):
    db = MagicMock()
    db.client = FakeClient(rows or {}, rpc)
    return AuctionService(db), db


FOUND = {'item_id': 'i1', 'fpost_id': 'FP1001', 'item_name': 'Umbrella', 'status': 'unclaimed', 'created_at': '2026-01-01T00:00:00+00:00', 'category': 'Accessories', 'location': 'Library'}
CREATE = {'found_item_reference': 'FP1001', 'starting_price': '100', 'bid_increment': '50', 'duration_minutes': 1440}


class BuyoutRuleTests(unittest.TestCase):
    def test_the_buyout_price_must_beat_the_starting_bid(self):
        self.assertIsNone(parse_buyout(None, Decimal(100)))
        self.assertIsNone(parse_buyout('', Decimal(100)))
        self.assertEqual(parse_buyout('500', Decimal(100)), Decimal('500.00'))
        for bad in ('100', '99', '-5', 'cheap'):
            with self.assertRaises(AuctionError):
                parse_buyout(bad, Decimal(100))

    def test_an_auction_can_be_created_with_or_without_a_buyout(self):
        service, db = auction_service({'found_items': [FOUND], 'claims': [], 'auctions': []})
        service.create_auction({**CREATE, 'buyout_price': '800'}, [], ADMIN)
        service.create_auction(CREATE, [], ADMIN)
        inserted = [w[2] for w in db.client.writes if w[0] == 'auctions' and w[1] == 'insert']
        self.assertEqual(inserted[0]['buyout_price'], 800.0)
        self.assertNotIn('buyout_price', inserted[1])  # nothing sent when unused, so it works before the migration too

    def test_a_buyout_below_the_starting_bid_is_refused_before_anything_is_saved(self):
        service, db = auction_service({'found_items': [FOUND], 'claims': [], 'auctions': []})
        with self.assertRaises(AuctionError):
            service.create_auction({**CREATE, 'buyout_price': '50'}, [], ADMIN)
        self.assertEqual([w for w in db.client.writes if w[1] == 'insert'], [])

    def live_row(self, **extra):
        base = dict(status='active', starts_at=iso(-DAY), ends_at=iso(DAY), bid_count=0, current_price=100, buyout_price=None)
        return auction_row(**{**base, **extra})

    def test_the_buyout_can_be_set_removed_and_checked_while_nobody_has_bid(self):
        service, db = auction_service({'auctions': [self.live_row()]})
        service.update_auction('a1', {'buyout_price': '900'}, None)
        service.update_auction('a1', {'buyout_price': ''}, None)
        sent = [w[2] for w in db.client.writes if w[1] == 'update']
        self.assertEqual((sent[0]['buyout_price'], sent[1]['buyout_price']), (900.0, None))
        with self.assertRaises(AuctionError):
            service.update_auction('a1', {'buyout_price': '100'}, None)

    def test_raising_the_starting_bid_above_an_existing_buyout_is_refused(self):
        service, _ = auction_service({'auctions': [self.live_row(buyout_price=300)]})
        with self.assertRaises(AuctionError):
            service.update_auction('a1', {'starting_price': '400'}, None)

    def test_the_buyout_is_locked_once_bidding_has_started(self):
        service, _ = auction_service({'auctions': [{**self.live_row(), 'bid_count': 2}]})
        with self.assertRaises(AuctionError) as caught:
            service.update_auction('a1', {'buyout_price': '900'}, None)
        self.assertEqual(caught.exception.status, 409)

    def test_the_public_card_shows_the_buyout_price(self):
        service, _ = auction_service()
        card = service.card({**self.live_row(), 'auction_id': 'a1', 'buyout_price': 750}, {})
        self.assertEqual((card['buyout_price'], card['bought_out']), (750.0, False))
        self.assertIsNone(service.card({**self.live_row(), 'auction_id': 'a1'}, {})['buyout_price'])


class BuyNowTests(unittest.TestCase):
    def bought(self, **extra):
        base = dict(status='awaiting_admin', bought_out=True, winner_account_id='buyer', highest_bidder_id='buyer', winning_amount=800, current_price=800, buyout_price=800, bid_count=3)
        return auction_row(**{**base, **extra})

    def test_a_buyout_notifies_the_buyer_and_the_outbid_leader_and_reports_it(self):
        service, db = auction_service({'user_profiles': [{'account_id': 'buyer', 'email': 'b@umak.edu.ph'}]},
                                      {'ok': True, 'extended': False, 'bought_out': True, 'previous_bidder_id': 'leader', 'auction': self.bought(), 'bid_id': 'b1'})
        result = service.place_bid('a1', 'buyer', 800)
        self.assertTrue(result['bought_out'])
        self.assertEqual(result['auction']['status'], 'awaiting')  # waiting for the admin, not "ended"
        titles = {c.args[0]: c.args[1] for c in db.create_user_notification.call_args_list}
        self.assertEqual(titles['buyer'], 'You used Buy Now')
        self.assertEqual(titles['leader'], 'Auction ended: Buy Now')
        self.assertEqual(db.log_user_activity.call_args.kwargs['action'], 'Buy Now (Auction)')

    def test_a_buyer_who_was_already_leading_gets_one_notice(self):
        service, db = auction_service({}, {'ok': True, 'bought_out': True, 'previous_bidder_id': 'buyer', 'auction': self.bought(), 'bid_id': 'b1'})
        service.place_bid('a1', 'buyer', 900)
        self.assertEqual(db.create_user_notification.call_count, 1)

    def test_an_ordinary_bid_is_unchanged(self):
        row = auction_row(status='active', current_price=450, buyout_price=800, highest_bidder_id='w1', bid_count=2)
        service, db = auction_service({}, {'ok': True, 'extended': False, 'previous_bidder_id': 'old', 'auction': row, 'bid_id': 'b1'})
        result = service.place_bid('a1', 'w1', 450)
        self.assertFalse(result['bought_out'])
        self.assertEqual(db.create_user_notification.call_args.args[1], 'You have been outbid')

    def test_the_public_page_hides_the_buyer_and_logs_the_buyout(self):
        rows = {'auctions': [self.bought(winner_account_id='buyer', finalized_at=None)], 'auction_bids': [{'bid_id': 'b1', 'bidder_account_id': 'buyer', 'amount': 800, 'created_at': NOW.isoformat()}],
                'auction_comments': [], 'user_profiles': [{'account_id': 'buyer', 'fname': 'Rosa', 'lname': 'Cruz', 'email': 'rosa@umak.edu.ph'}]}
        service, _ = auction_service(rows)
        service.settle_and_notify = lambda *a, **k: 0
        detail = service.public_detail('a1')
        self.assertEqual(detail['auction']['status'], 'awaiting')
        self.assertTrue(detail['auction']['bought_out'])
        events = [e for e in detail['log'] if e['type'] == 'buyout']
        self.assertEqual(len(events), 1)
        self.assertIn(bidder_alias('a1', 'buyer'), events[0]['text'])
        self.assertIn('Buy Now', events[0]['text'])
        self.assertNotIn('closed', [e['type'] for e in detail['log']])
        self.assertNotIn('Rosa', str(detail))

    def test_the_route_reports_a_buyout_to_the_buyer(self):
        app = Flask(__name__)
        app.register_blueprint(auction_routes.auctions_bp, url_prefix='/api/auctions')
        service = MagicMock()
        service.place_bid.return_value = {'auction': {}, 'extended': False, 'bought_out': True, 'bid_id': 'b1'}
        with patch.object(auction_routes, '_service', return_value=service), patch.object(auction_routes, '_authenticated_account_id', return_value='buyer'):
            response = app.test_client().post('/api/auctions/a1/bids', json={'amount': 800})
        self.assertEqual(response.status_code, 201)
        self.assertIn('Buy Now', response.get_json()['message'])
        self.assertTrue(response.get_json()['bought_out'])


class BuyoutSqlTests(unittest.TestCase):
    """The decision happens in Postgres, so check the migration text for the rules that matter."""

    sql = (ROOT / 'manual_migrations' / '20261009_tag_expiry_and_auction_buyout.sql').read_text(encoding='utf-8')

    def test_the_function_caps_the_price_ends_the_auction_and_hands_it_to_the_admin(self):
        body = self.sql[self.sql.index('CREATE OR REPLACE FUNCTION public.auction_place_bid'):]
        for needle in ("is_buyout := a.buyout_price IS NOT NULL AND v_amount >= a.buyout_price", "v_amount := a.buyout_price", "status = 'awaiting_admin'",
                       'winner_account_id = p_bidder_id', 'winning_amount = v_amount', 'bought_out = true', 'FOR UPDATE',
                       "a.highest_bidder_id = p_bidder_id AND NOT is_buyout", 'REVOKE ALL ON FUNCTION public.auction_place_bid', 'TO service_role'):
            self.assertIn(needle, body)

    def test_the_migration_is_additive_and_guarded(self):
        for needle in ('ADD COLUMN IF NOT EXISTS buyout_price', 'ADD COLUMN IF NOT EXISTS valid_until', 'ADD COLUMN IF NOT EXISTS tag_type',
                       "'expired'", 'to_regclass', 'auctions_buyout_price_check', 'smart_tags_tag_type_check'):
            self.assertIn(needle, self.sql)
        for forbidden in ('DROP TABLE', 'DELETE FROM', 'TRUNCATE'):
            self.assertNotIn(forbidden, self.sql)


if __name__ == '__main__':
    unittest.main()
