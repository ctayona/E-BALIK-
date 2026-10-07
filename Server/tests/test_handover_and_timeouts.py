"""Handover PINs, premium emails, automatic auction pickup deadlines, the scheduler endpoint and the dashboard analytics."""
import sys
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

from flask import Flask

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT.parent):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from memdb import MemClient  # noqa: E402
from Admin.Backend.claims_verification import routes as claim_routes  # noqa: E402
from app.utils import analytics, auction_email, handover, rate_limit, scheduler  # noqa: E402
from app.utils.auction_db import AuctionError, AuctionService  # noqa: E402
from app.utils.email_service import EmailService  # noqa: E402
from app.utils.email_templates import render_email  # noqa: E402

ADMIN_ID = '11111111-1111-4111-8111-111111111111'
ADMIN2_ID = '12121212-1212-4212-8212-121212121212'
OWNER = '33333333-3333-4333-8333-333333333333'
WINNER = '44444444-4444-4444-8444-444444444444'
CLAIM = '55555555-5555-4555-8555-555555555555'
ITEM = '66666666-6666-4666-8666-666666666666'
AUCTION = '77777777-7777-4777-8777-777777777777'
NOW = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)


def iso(hours_ago=0.0):
    return (NOW - timedelta(hours=hours_ago)).isoformat()


def profiles():
    return [
        {'account_id': ADMIN_ID, 'fname': 'Ana', 'lname': 'Admin', 'email': 'ana@umak.edu.ph', 'campus_id': 'A1', 'access_level': 'admin', 'is_active': True},
        {'account_id': ADMIN2_ID, 'fname': 'Super', 'lname': 'Boss', 'email': 'boss@umak.edu.ph', 'campus_id': 'A2', 'access_level': 'super_admin', 'is_active': True},
        {'account_id': OWNER, 'fname': 'Maria', 'lname': 'Santos', 'email': 'maria@umak.edu.ph', 'campus_id': 'K12345678', 'access_level': 'user', 'is_active': True},
        {'account_id': WINNER, 'fname': 'Juan', 'lname': 'Cruz', 'email': 'juan@umak.edu.ph', 'campus_id': 'K87654321', 'access_level': 'user', 'is_active': True},
    ]


def make_db(store, **client_kwargs):
    db = MagicMock()
    db.client = MemClient(store, unique={'claims': 'handover_pin_hash'}, **client_kwargs)
    db.get_user_by_account_id.side_effect = lambda account_id: next((dict(p) for p in store['user_profiles'] if p['account_id'] == account_id), None)

    def transition(claim_id, status, admin_id, reason=None):
        row = next(r for r in store['claims'] if r['claim_id'] == claim_id)
        if status == 'collected' and row['status'] != 'approved_for_pickup':
            raise RuntimeError('Approved claims can only be marked collected')
        row.update(status=status)
        if status == 'collected':
            row['collected_at'] = iso()
            for item in store.get('found_items', []):
                if item['item_id'] == row['found_item_id']:
                    item['status'] = 'returned'
        return dict(row)
    db.update_claim_status.side_effect = transition
    db.create_user_notification.side_effect = lambda *a, **k: store.setdefault('user_notifications', []).append({'user': a[0], 'title': a[1], 'type': k.get('notification_type')})
    db.get_claim_email_context.side_effect = lambda claim_id: {
        'email': 'maria@umak.edu.ph', 'name': 'Maria Santos', 'claim_reference': 'CL-0001', 'found_item_reference': 'FP1001', 'item_name': 'Blue umbrella'}
    return db


def claim_store(status='approved_for_pickup', **extra):
    return {
        'user_profiles': profiles(),
        'claims': [{'claim_id': CLAIM, 'claim_reference': 'CL-0001', 'status': status, 'found_item_id': ITEM, 'claimant_account_id': OWNER, 'reviewed_at': iso(1), **extra}],
        'found_items': [{'item_id': ITEM, 'fpost_id': 'FP1001', 'item_name': 'Blue umbrella', 'status': 'unclaimed'}],
    }


class EmailTemplateTests(unittest.TestCase):
    def test_everything_is_escaped_and_the_pin_and_button_are_shown(self):
        html, text = render_email(
            title='Your claim is approved <script>', paragraphs=['Hi <b>there</b>'], highlight=('YOUR HANDOVER PIN', 'K7M2QX'),
            details={'Item': 'Blue <umbrella>'}, cta=('View Claim Status', 'https://ebalik.example/?a=1&b=2'))
        self.assertNotIn('<script>', html)
        self.assertNotIn('<b>there</b>', html)
        self.assertIn('K7M2QX', html)
        self.assertIn('View Claim Status', html)
        self.assertIn('href="https://ebalik.example/?a=1&amp;b=2"', html)
        self.assertIn('#1f3160', html)   # UMak navy
        self.assertIn('#d1a153', html)   # UMak gold
        self.assertIn('K7M2QX', text)
        self.assertIn('https://ebalik.example/?a=1&b=2', text)

    def test_the_logo_points_at_the_public_site(self):
        with patch.dict('os.environ', {'PUBLIC_SITE_URL': 'https://ebalik.example/'}):
            html, _ = render_email(title='Hi', paragraphs=['x'])
        self.assertIn('src="https://ebalik.example/icons/icon-192.png"', html)

    def test_service_sends_html_and_plain_text_and_the_claim_email_carries_the_pin(self):
        with patch.object(EmailService, '__init__', lambda self: None):
            service = EmailService()
        service.sg, service.from_email = MagicMock(), 'noreply@umak.edu.ph'
        service.sg.send.return_value = MagicMock(status_code=202)
        ok = service.send_claim_approved_email('maria@umak.edu.ph', 'Maria', 'CL-0001', 'Blue umbrella', 'FP1001', 'K7M2QX')
        sent = service.sg.send.call_args[0][0].get()
        contents = {part['type']: part['value'] for part in sent['content']}
        self.assertTrue(ok)
        self.assertIn('K7M2QX', contents['text/html'])
        self.assertIn('K7M2QX', contents['text/plain'])
        self.assertIn('View Claim Status', contents['text/html'])
        self.assertIn('approved', sent['subject'].lower())

    def test_every_message_type_renders_through_the_premium_layout(self):
        with patch.object(EmailService, '__init__', lambda self: None):
            service = EmailService()
        service.sg, service.from_email = MagicMock(), 'noreply@umak.edu.ph'
        service.sg.send.return_value = MagicMock(status_code=202)
        results = [
            service.send_otp_email('a@umak.edu.ph', '123456', 'registration'),
            service.send_otp_email('a@umak.edu.ph', '654321', 'password_reset'),
            service.send_welcome_email('a@umak.edu.ph', 'Ana'),
            service.send_reference_email('a@umak.edu.ph', 'Ana', 'Your report', 'Saved.', 'Report reference', 'MP1001', {'Item': 'Keys'}),
            service.send_announcement_email('a@umak.edu.ph', 'Ana', 'Hello', 'Line one\nLine two'),
        ]
        self.assertTrue(all(results))
        for call in service.sg.send.call_args_list:
            html = {p['type']: p['value'] for p in call[0][0].get()['content']}['text/html']
            self.assertIn('E-Balik', html)
            self.assertIn('#d1a153', html)
        self.assertFalse(EmailService.send_notice_email(service, '', 'x', title='t', paragraphs=['p']))

    def test_auction_emails_use_the_new_titles_and_deadline_wording(self):
        sent = []
        with patch.dict('os.environ', {'AUCTION_EMAIL_MODE': 'sendgrid'}), \
                patch('app.utils.email_service.send_reference_email_best_effort', side_effect=lambda **kw: sent.append(kw) or True):
            auction_email.send_auction_won_email(to_email='a@b.c', recipient_name='A', item_title='Umbrella', reference='FP1', amount=500)
            auction_email.send_auction_final_warning_email(to_email='a@b.c', recipient_name='A', item_title='Umbrella', reference='FP1', amount=500)
            auction_email.send_auction_forfeited_email(to_email='a@b.c', recipient_name='A', item_title='Umbrella', reference='FP1', amount=500)
        self.assertIn('72 hours', sent[0]['summary'])
        self.assertIn('24', sent[1]['title'])
        self.assertEqual(sent[1]['tone'], 'warning')
        self.assertIn('30 days', sent[2]['summary'])


class PinTests(unittest.TestCase):
    def test_pins_are_six_unambiguous_characters_and_normalise(self):
        for _ in range(300):
            pin = handover.generate_pin()
            self.assertEqual(len(pin), 6)
            self.assertTrue(set(pin) <= set(handover.PIN_ALPHABET))
        self.assertEqual(handover.normalize_pin(' k7m-2qx '), 'K7M2QX')
        for bad in ('', 'K7M2Q', 'K7M2QXX', 'K7M2Q0', 'K7M2QI', None):
            self.assertEqual(handover.normalize_pin(bad), '')

    def test_the_hash_is_stable_and_not_the_pin(self):
        self.assertEqual(handover.pin_hash('K7M2QX'), handover.pin_hash('K7M2QX'))
        self.assertNotEqual(handover.pin_hash('K7M2QX'), handover.pin_hash('K7M2QY'))
        self.assertNotIn('K7M2QX', handover.pin_hash('K7M2QX'))


class HandoverServiceTests(unittest.TestCase):
    def setUp(self):
        self.store = claim_store()
        self.db = make_db(self.store)
        self.service = handover.HandoverService(self.db)

    def test_issue_stores_a_hash_and_an_encrypted_copy_never_the_pin(self):
        pin = self.service.issue(CLAIM)
        row = self.store['claims'][0]
        self.assertEqual(row['handover_pin_hash'], handover.pin_hash(pin))
        self.assertNotIn(pin, str(row))
        self.assertEqual(self.service.reveal(row), pin)

    def test_only_an_approved_claim_gets_a_pin(self):
        store = claim_store(status='pending')
        with self.assertRaises(handover.HandoverError) as caught:
            handover.HandoverService(make_db(store)).issue(CLAIM)
        self.assertEqual(caught.exception.status, 409)

    def test_a_pin_collision_is_redrawn(self):
        other = dict(self.store['claims'][0], claim_id='other', handover_pin_hash=handover.pin_hash('AAAAAA'))
        self.store['claims'].append(other)
        with patch('app.utils.handover.generate_pin', side_effect=['AAAAAA', 'BBBBBB']):
            self.assertEqual(self.service.issue(CLAIM), 'BBBBBB')

    def test_missing_columns_mean_setup_required(self):
        db = make_db(claim_store(), missing_columns={'claims': ('handover_pin_hash',)})
        with self.assertRaises(handover.HandoverUnavailable):
            handover.HandoverService(db).issue(CLAIM)

    def test_find_shows_who_and_what(self):
        pin = self.service.issue(CLAIM)
        found = self.service.find(pin.lower())
        self.assertEqual((found['claimant_name'], found['claimant_campus_id'], found['item_name']), ('Maria Santos', 'K12345678', 'Blue umbrella'))
        with self.assertRaises(handover.HandoverError) as caught:
            self.service.find('ZZZZZZ')
        self.assertEqual(caught.exception.code, 'pin_not_found')
        with self.assertRaises(handover.HandoverError) as caught:
            self.service.find('12')
        self.assertEqual(caught.exception.code, 'invalid_pin')

    def test_release_closes_the_claim_returns_the_item_and_kills_the_pin(self):
        pin = self.service.issue(CLAIM)
        released = self.service.release(pin, ADMIN_ID)
        self.assertEqual(released['item_name'], 'Blue umbrella')
        self.assertEqual(self.store['claims'][0]['status'], 'collected')
        self.assertEqual(self.store['found_items'][0]['status'], 'returned')
        self.assertIsNone(self.store['claims'][0]['handover_pin_hash'])
        self.db.update_claim_status.assert_called_once_with(CLAIM, 'collected', ADMIN_ID)
        with self.assertRaises(handover.HandoverError):
            self.service.release(pin, ADMIN_ID)   # a used PIN never works twice


def claim_client(db, level='admin'):
    app = Flask(__name__)
    app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
    app.register_blueprint(claim_routes.claims_verification_bp, url_prefix='/api/admin')

    def require(required_level='admin'):
        if level == 'user':
            raise PermissionError('Administrator access required')
        return {'account_id': ADMIN_ID, 'access_level': level}
    patches = (patch.object(claim_routes, 'get_db', return_value=db), patch.object(claim_routes, '_require_admin', side_effect=require),
               patch.object(claim_routes, '_log_admin_action'))
    return app.test_client(), patches


class ClaimRouteTests(unittest.TestCase):
    def setUp(self):
        rate_limit.reset()
        self.store = claim_store(status='pending')
        self.db = make_db(self.store)

    def run_with(self, level, call):
        client, patches = claim_client(self.db, level)
        with patches[0], patches[1], patches[2]:
            return call(client)

    def test_approval_creates_a_pin_emails_it_and_never_returns_it_to_the_admin(self):
        email = MagicMock()
        email.send_claim_approved_email.return_value = True
        self.db.update_claim_status.side_effect = lambda claim_id, status, admin_id, reason=None: self.store['claims'][0].update(status=status) or dict(self.store['claims'][0])
        with patch.object(claim_routes, 'EmailService', return_value=email):
            response = self.run_with('admin', lambda c: c.patch(f'/api/admin/claims/{CLAIM}/status', json={'status': 'approved_for_pickup'}))
        body = response.get_json()
        pin = email.send_claim_approved_email.call_args.kwargs['handover_pin']
        self.assertEqual(response.status_code, 200)
        self.assertTrue(body['handover_pin_issued'] and body['approval_email_sent'])
        self.assertEqual(len(pin), 6)
        self.assertNotIn(pin, response.get_data(as_text=True))
        self.assertEqual(self.store['claims'][0]['handover_pin_hash'], handover.pin_hash(pin))

    def test_approval_still_succeeds_when_the_pin_columns_do_not_exist_yet(self):
        self.db = make_db(self.store, missing_columns={'claims': ('handover_pin_hash',)})
        self.db.update_claim_status.side_effect = lambda claim_id, status, admin_id, reason=None: self.store['claims'][0].update(status=status) or dict(self.store['claims'][0])
        email = MagicMock()
        email.send_claim_approved_email.return_value = True
        with patch.object(claim_routes, 'EmailService', return_value=email):
            response = self.run_with('admin', lambda c: c.patch(f'/api/admin/claims/{CLAIM}/status', json={'status': 'approved_for_pickup'}))
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.get_json()['handover_pin_issued'])
        self.assertIsNone(email.send_claim_approved_email.call_args.kwargs['handover_pin'])

    def test_guard_enters_the_pin_and_the_item_is_released(self):
        self.store['claims'][0]['status'] = 'approved_for_pickup'
        pin = handover.HandoverService(self.db).issue(CLAIM)
        looked = self.run_with('admin', lambda c: c.post('/api/admin/claims/handover/lookup', json={'pin': pin}))
        wrong = self.run_with('admin', lambda c: c.post('/api/admin/claims/handover/lookup', json={'pin': 'ZZZZZZ'}))
        released = self.run_with('admin', lambda c: c.post('/api/admin/claims/handover/release', json={'pin': pin.lower()}))
        again = self.run_with('admin', lambda c: c.post('/api/admin/claims/handover/release', json={'pin': pin}))
        self.assertEqual((looked.status_code, looked.get_json()['claim']['claimant_name']), (200, 'Maria Santos'))
        self.assertEqual(wrong.status_code, 404)
        self.assertEqual(released.status_code, 200)
        self.assertIn('Blue umbrella', released.get_json()['message'])
        self.assertEqual(self.store['claims'][0]['status'], 'collected')
        self.assertEqual(again.status_code, 404)

    def test_a_lookup_does_not_release_anything(self):
        self.store['claims'][0]['status'] = 'approved_for_pickup'
        pin = handover.HandoverService(self.db).issue(CLAIM)
        self.run_with('admin', lambda c: c.post('/api/admin/claims/handover/lookup', json={'pin': pin}))
        self.assertEqual(self.store['claims'][0]['status'], 'approved_for_pickup')

    def test_signed_in_users_cannot_use_the_guard_endpoints(self):
        for path in ('/api/admin/claims/handover/lookup', '/api/admin/claims/handover/release'):
            self.assertEqual(self.run_with('user', lambda c, p=path: c.post(p, json={'pin': 'K7M2QX'})).status_code, 403)

    def test_guessing_pins_is_rate_limited(self):
        statuses = [self.run_with('admin', lambda c: c.post('/api/admin/claims/handover/lookup', json={'pin': 'ZZZZZZ'})).status_code for _ in range(14)]
        self.assertEqual(statuses[:12], [404] * 12)
        self.assertEqual(statuses[12:], [429, 429])

    def test_reissue_makes_a_new_pin_for_an_approved_claim_only(self):
        email = MagicMock()
        email.send_claim_approved_email.return_value = True
        with patch.object(claim_routes, 'EmailService', return_value=email):
            pending = self.run_with('admin', lambda c: c.post(f'/api/admin/claims/{CLAIM}/handover-pin'))
            self.store['claims'][0]['status'] = 'approved_for_pickup'
            ok = self.run_with('admin', lambda c: c.post(f'/api/admin/claims/{CLAIM}/handover-pin'))
        self.assertEqual((pending.status_code, ok.status_code), (409, 200))
        self.assertEqual(email.send_claim_approved_email.call_count, 2)


def auction_row(**extra):
    row = {
        'auction_id': AUCTION, 'status': 'ended', 'fulfillment_status': 'awaiting_pickup', 'winner_account_id': WINNER, 'winning_amount': 500,
        'title': 'Blue umbrella', 'item_reference': 'FP1001', 'found_item_id': ITEM, 'winner_notified_at': iso(10), 'pickup_warning_sent_at': None,
        'auto_forfeited_at': None, 'starting_price': 100, 'bid_increment': 50, 'current_price': 500, 'starts_at': iso(200), 'ends_at': iso(100),
        'original_ends_at': iso(100), 'anti_snipe_enabled': True, 'created_at': iso(200),
    }
    row.update(extra)
    return row


def auction_store(**extra):
    return {'user_profiles': profiles(), 'auctions': [auction_row(**extra)], 'claims': [],
            'found_items': [{'item_id': ITEM, 'fpost_id': 'FP1001', 'item_name': 'Blue umbrella', 'status': 'auctioned'}]}


class PickupDeadlineTests(unittest.TestCase):
    def setUp(self):
        self.warn = patch('app.utils.auction_db.send_auction_final_warning_email', return_value={'sent': True}).start()
        self.forfeit = patch('app.utils.auction_db.send_auction_forfeited_email', return_value={'sent': True}).start()
        self.alert = patch('app.utils.email_service.send_reference_email_best_effort', return_value=True).start()
        self.addCleanup(patch.stopall)

    def service(self, **extra):
        self.store = auction_store(**extra)
        self.db = make_db(self.store)
        return AuctionService(self.db)

    def test_nothing_happens_before_48_hours(self):
        service = self.service(winner_notified_at=iso(47))
        summary = service.process_overdue_pickups(NOW)
        self.assertEqual((summary['warned'], summary['forfeited']), (0, 0))
        self.warn.assert_not_called()

    def test_at_48_hours_a_24_hour_final_warning_is_sent_exactly_once(self):
        service = self.service(winner_notified_at=iso(49))
        first = service.process_overdue_pickups(NOW)
        second = service.process_overdue_pickups(NOW + timedelta(hours=1))
        self.assertEqual((first['warned'], second['warned']), (1, 0))
        self.assertEqual(self.warn.call_count, 1)
        self.assertEqual(self.warn.call_args.kwargs['to_email'], 'juan@umak.edu.ph')
        self.assertLessEqual(self.warn.call_args.kwargs['hours_left'], 24)
        self.assertTrue(self.store['auctions'][0]['pickup_warning_sent_at'])
        self.assertEqual(self.store['auctions'][0]['fulfillment_status'], 'awaiting_pickup')
        self.assertIn('auction_final_warning', [n['type'] for n in self.store['user_notifications']])

    def test_at_72_hours_the_win_is_forfeited_the_winner_is_banned_and_admins_are_alerted(self):
        service = self.service(winner_notified_at=iso(73), pickup_warning_sent_at=iso(25))
        summary = service.process_overdue_pickups(NOW)
        row = self.store['auctions'][0]
        winner = next(p for p in self.store['user_profiles'] if p['account_id'] == WINNER)
        self.assertEqual(summary['forfeited'], 1)
        self.assertEqual((row['fulfillment_status'], row['status']), ('forfeited', 'ended'))
        self.assertTrue(row['auto_forfeited_at'])
        self.assertEqual(self.store['found_items'][0]['status'], 'unclaimed')
        until = datetime.fromisoformat(winner['bidding_banned_until'])
        self.assertEqual((until - NOW).days, 30)
        self.forfeit.assert_called_once()
        self.assertEqual(self.forfeit.call_args.kwargs['ban_days'], 30)
        alerted = sorted(n['user'] for n in self.store['user_notifications'] if n['type'] == 'auction_reauction_ready')
        self.assertEqual(alerted, sorted([ADMIN_ID, ADMIN2_ID]))
        self.assertEqual(self.alert.call_count, 2)
        self.assertIn('Re-Auction', self.alert.call_args.kwargs['subject'])

    def test_a_missed_warning_does_not_block_the_forfeit(self):
        service = self.service(winner_notified_at=iso(80))   # the scheduler was down the whole time
        self.assertEqual(service.process_overdue_pickups(NOW)['forfeited'], 1)
        self.warn.assert_not_called()

    def test_a_forfeit_runs_only_once(self):
        service = self.service(winner_notified_at=iso(73))
        service.process_overdue_pickups(NOW)
        again = service.process_overdue_pickups(NOW)
        self.assertEqual(again['checked'], 0)
        self.assertEqual(self.forfeit.call_count, 1)

    def test_staff_winners_are_never_banned(self):
        service = self.service(winner_notified_at=iso(73), winner_account_id=ADMIN_ID)
        service.process_overdue_pickups(NOW)
        admin = next(p for p in self.store['user_profiles'] if p['account_id'] == ADMIN_ID)
        self.assertNotIn('bidding_banned_until', admin)
        self.assertEqual(self.store['auctions'][0]['fulfillment_status'], 'forfeited')

    def test_collected_and_unconfirmed_auctions_are_left_alone(self):
        for extra in ({'fulfillment_status': 'collected'}, {'status': 'awaiting_admin', 'fulfillment_status': None}, {'winner_notified_at': None}):
            service = self.service(**{'winner_notified_at': iso(100), **extra})
            self.assertEqual(service.process_overdue_pickups(NOW)['checked'], 0, extra)

    def test_a_database_that_is_not_migrated_does_not_crash_the_job(self):
        service = self.service(winner_notified_at=iso(73))
        self.db.client.missing_columns = {'auctions': ('auto_forfeited_at',)}
        summary = service.process_overdue_pickups(NOW)
        self.assertEqual(summary['forfeited'], 0)
        self.assertEqual(summary['errors'], 1)

    def test_resending_the_winner_email_does_not_restart_the_clock(self):
        service = self.service(winner_notified_at=iso(60))
        with patch('app.utils.auction_db.send_auction_won_email', return_value={'mode': 'sendgrid', 'sent': True, 'subject': 's'}):
            service.resend_winner_email(AUCTION)
        self.assertEqual(self.store['auctions'][0]['winner_notified_at'], iso(60))


class BiddingBanTests(unittest.TestCase):
    def service(self, banned_until):
        store = auction_store()
        next(p for p in store['user_profiles'] if p['account_id'] == WINNER)['bidding_banned_until'] = banned_until
        self.rpc = MagicMock()
        db = make_db(store, rpc_handlers={'auction_place_bid': self.rpc})
        return AuctionService(db)

    def test_a_banned_account_cannot_bid(self):
        service = self.service((datetime.now(timezone.utc) + timedelta(days=5)).isoformat())
        with self.assertRaises(AuctionError) as caught:
            service.place_bid(AUCTION, WINNER, 600)
        self.assertEqual((caught.exception.status, caught.exception.extra['code']), (403, 'bidding_banned'))
        self.rpc.assert_not_called()

    def test_an_expired_ban_allows_bidding_again(self):
        service = self.service((datetime.now(timezone.utc) - timedelta(days=1)).isoformat())
        service._assert_can_bid(WINNER)   # does not raise

    def test_a_missing_ban_column_never_blocks_bidding(self):
        service = self.service(None)
        service.client.table = MagicMock(side_effect=Exception('column bidding_banned_until does not exist'))
        service._assert_can_bid(WINNER)


class ReauctionAfterAutoForfeitTests(unittest.TestCase):
    def test_an_auto_forfeited_item_can_be_listed_again_once(self):
        store = auction_store(fulfillment_status='forfeited', auto_forfeited_at=iso(1))
        store['found_items'][0]['status'] = 'unclaimed'
        service = AuctionService(make_db(store))
        result = service.reauction(AUCTION, {}, ADMIN_ID)
        self.assertEqual(len(store['auctions']), 2)
        self.assertEqual(result['new']['reauctioned_from'], AUCTION)
        self.assertEqual(store['auctions'][0]['fulfillment_status'], 'forfeited')
        with self.assertRaises(AuctionError) as caught:
            service.reauction(AUCTION, {}, ADMIN_ID)
        self.assertEqual(caught.exception.status, 409)

    def test_an_item_the_admin_forfeited_by_hand_is_still_refused(self):
        store = auction_store(fulfillment_status='forfeited')
        with self.assertRaises(AuctionError):
            AuctionService(make_db(store)).reauction(AUCTION, {}, ADMIN_ID)

    def test_the_admin_list_flags_items_ready_for_reauction(self):
        store = auction_store(fulfillment_status='forfeited', auto_forfeited_at=iso(1))
        service = AuctionService(make_db(store, rpc_handlers={'auction_settle_due': lambda params: []}))
        listing = service.admin_list()
        self.assertTrue(listing['auctions'][0]['reauction_ready'])
        self.assertEqual(listing['stats']['reauction_ready'], 1)
        service.reauction(AUCTION, {}, ADMIN_ID)
        self.assertEqual(service.admin_list()['stats']['reauction_ready'], 0)


class SchedulerTests(unittest.TestCase):
    def app(self):
        app = Flask(__name__)
        app.config.update(TESTING=False, SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
        app.register_blueprint(scheduler.cron_bp, url_prefix='/api/cron')
        return app

    def test_the_endpoint_is_off_without_a_secret(self):
        with patch.dict('os.environ', {'CRON_SECRET': ''}):
            self.assertEqual(self.app().test_client().post('/api/cron/run').status_code, 503)

    def test_the_endpoint_needs_the_right_secret(self):
        with patch.dict('os.environ', {'CRON_SECRET': 's3cret'}), patch.object(scheduler, 'run_scheduled_jobs', return_value={'auction_pickups': {'warned': 1}}) as run:
            client = self.app().test_client()
            wrong = client.post('/api/cron/run', headers={'X-Cron-Secret': 'nope'})
            missing = client.post('/api/cron/run')
            ok = client.post('/api/cron/run', headers={'X-Cron-Secret': 's3cret'})
        self.assertEqual((wrong.status_code, missing.status_code, ok.status_code), (403, 403, 200))
        self.assertEqual(ok.get_json()['auction_pickups']['warned'], 1)
        run.assert_called_once()

    def test_the_timer_stays_off_in_tests_and_when_disabled(self):
        testing = Flask(__name__)
        testing.config['TESTING'] = True
        self.assertFalse(scheduler.start_scheduler(testing))
        with patch.dict('os.environ', {'SCHEDULER_ENABLED': 'false'}):
            self.assertFalse(scheduler.start_scheduler(self.app()))

    def test_the_timer_is_off_in_development_unless_asked_for_and_on_in_production(self):
        development, production = self.app(), self.app()
        development.config['DEBUG'], production.config['DEBUG'] = True, False
        env = {k: v for k, v in __import__('os').environ.items() if k not in ('SCHEDULER_ENABLED', 'FLASK_DEBUG', 'WERKZEUG_RUN_MAIN')}
        with patch.dict('os.environ', env, clear=True), patch.object(scheduler.threading, 'Thread') as thread:
            scheduler._started.clear()
            self.assertFalse(scheduler.start_scheduler(development))          # a laptop pointed at the live database stays quiet
            self.assertTrue(scheduler.start_scheduler(production))            # production starts it
            thread.return_value.start.assert_called_once()
            scheduler._started.clear()
            with patch.dict('os.environ', {'SCHEDULER_ENABLED': 'true'}):
                self.assertTrue(scheduler.start_scheduler(development))       # only when explicitly forced on
            scheduler._started.clear()

    def test_running_the_jobs_settles_then_checks_deadlines_and_survives_errors(self):
        app = self.app()
        fake = MagicMock()
        fake.process_overdue_pickups.return_value = {'checked': 1, 'warned': 0, 'forfeited': 0, 'errors': 0}
        with patch('app.utils.get_db'), patch('app.utils.auction_db.AuctionService', return_value=fake), \
                patch('app.utils.housekeeping.run_housekeeping', return_value={'claim_pickups': {'checked': 0}}):
            summary = scheduler.run_scheduled_jobs(app)
        fake.settle_and_notify.assert_called_once_with(force=True)
        self.assertEqual(summary['auction_pickups']['checked'], 1)
        with patch('app.utils.get_db', side_effect=RuntimeError('db down')):
            self.assertIn('error', scheduler.run_scheduled_jobs(app))

    def test_the_interval_is_clamped(self):
        with patch.dict('os.environ', {'SCHEDULER_INTERVAL_MINUTES': '0'}):
            self.assertEqual(scheduler._interval_seconds(), 60)
        with patch.dict('os.environ', {'SCHEDULER_INTERVAL_MINUTES': 'abc'}):
            self.assertEqual(scheduler._interval_seconds(), 900)


class AnalyticsTests(unittest.TestCase):
    TODAY = date(2026, 10, 7)

    def rows(self):
        return [
            {'category': 'Electronics', 'last_seen_date': '2026-10-05'},   # Monday
            {'category': 'Electronics', 'last_seen_date': '2026-10-05'},
            {'category': 'Bags', 'last_seen_date': '2026-10-01'},          # Thursday
            {'category': 'Electronics', 'last_seen_date': '2026-09-14'},   # Monday
            {'category': 'Bags', 'last_seen_date': '2026-09-17'},          # Thursday
            {'category': '', 'last_seen_date': None, 'created_at': '2026-08-07T10:00:00+00:00'},  # Friday, falls back to created_at
            {'category': 'Wallets', 'last_seen_date': '2025-01-01'},       # outside the 12-month window
        ]

    def test_categories_weekdays_months_and_heatmap(self):
        result = analytics.build_visual_analytics(self.rows(), {}, self.TODAY)
        self.assertEqual(result['lost_total'], 7)
        self.assertEqual(result['lost_categories'][0], {'name': 'Electronics', 'value': 3})
        self.assertIn({'name': 'General', 'value': 1}, result['lost_categories'])
        by_day = {d['day']: d['count'] for d in result['lost_by_weekday']}
        self.assertEqual((by_day['Mon'], by_day['Thu'], by_day['Fri']), (3, 2, 1))
        self.assertEqual(result['busiest']['weekday'], 'Monday')
        months = {m['key']: m['count'] for m in result['lost_by_month']}
        self.assertEqual((len(months), months['2026-10'], months['2026-09'], months['2026-08']), (12, 3, 2, 1))
        self.assertEqual(result['busiest']['month'], 'Oct 2026')
        sept = next(m for m in result['lost_heatmap']['months'] if m['key'] == '2026-09')
        self.assertEqual((sept['counts'][0], sept['counts'][3]), (1, 1))
        self.assertEqual(result['lost_heatmap']['max'], 2)

    def test_small_categories_are_grouped_as_other(self):
        rows = [{'category': f'Cat{i}', 'last_seen_date': '2026-10-01'} for i in range(9)]
        result = analytics.build_visual_analytics(rows, {}, self.TODAY)
        self.assertEqual(len(result['lost_categories']), analytics.TOP_CATEGORIES + 1)
        self.assertEqual(result['lost_categories'][-1], {'name': 'Other', 'value': 3})

    def test_outcomes_returned_versus_abandoned_and_auctioned(self):
        counts = {'returned': 6, 'collected': 2, 'auctioned': 3, 'disposed': 1, 'unclaimed': 8}
        outcomes = analytics.build_visual_analytics([], counts, self.TODAY)['outcomes']
        self.assertEqual((outcomes['returned'], outcomes['auctioned'], outcomes['abandoned'], outcomes['in_custody'], outcomes['total_found']), (8, 3, 1, 8, 20))
        self.assertEqual(outcomes['return_rate'], 40.0)

    def test_no_data_gives_empty_but_well_formed_results(self):
        result = analytics.build_visual_analytics([], {}, self.TODAY)
        self.assertEqual(result['lost_categories'], [])
        self.assertEqual(result['outcomes']['return_rate'], 0)
        self.assertEqual(len(result['lost_by_weekday']), 7)
        self.assertEqual(len(result['lost_heatmap']['months']), 12)
        self.assertEqual(result['busiest'], {'weekday': None, 'month': None})

    def test_the_collector_pages_through_rows_and_tolerates_unmigrated_columns(self):
        store = {
            'missing_items': [{'category': 'Keys', 'last_seen_date': datetime.now(timezone.utc).date().isoformat(), 'created_at': datetime.now(timezone.utc).date().isoformat(), 'last_location': 'Library'}],
            'found_items': [{'status': 'returned', 'created_at': datetime.now(timezone.utc).date().isoformat(), 'location': 'Library'}, {'status': 'unclaimed', 'created_at': datetime.now(timezone.utc).date().isoformat()}],
            'claims': [{'claim_id': 'a', 'status': 'collected'}, {'claim_id': 'b', 'status': 'approved_for_pickup'}],
        }
        result = analytics.collect_visual_analytics(make_db(store))
        self.assertEqual(result['outcomes']['returned'], 1)
        self.assertEqual(result['handover'], {'released': 1, 'awaiting': 1})
        self.assertEqual(result['outcomes']['auction_forfeits'], 0)   # no auctions table rows: zero, not an error
        self.assertTrue(result['generated_at'])


class OwnerPinTests(unittest.TestCase):
    def test_the_owner_sees_the_pin_of_an_approved_claim_only(self):
        from app.utils.supabase_db import SupabaseDB
        store = claim_store()
        pin = handover.HandoverService(make_db(store)).issue(CLAIM)
        db = SupabaseDB.__new__(SupabaseDB)
        db.client = MemClient(store)
        claims = [{'claim_id': CLAIM, 'status': 'approved_for_pickup'}, {'claim_id': 'other', 'status': 'pending'}]
        db._attach_handover_pins(claims)
        self.assertEqual(claims[0]['handover_pin'], pin)
        self.assertNotIn('handover_pin', claims[1])

    def test_a_database_without_the_pin_column_just_shows_no_pin(self):
        from app.utils.supabase_db import SupabaseDB
        db = SupabaseDB.__new__(SupabaseDB)
        db.client = MagicMock()
        db.client.table.side_effect = Exception('column handover_pin_encrypted does not exist')
        claims = [{'claim_id': CLAIM, 'status': 'approved_for_pickup'}]
        db._attach_handover_pins(claims)
        self.assertNotIn('handover_pin', claims[0])


if __name__ == '__main__':
    unittest.main()
