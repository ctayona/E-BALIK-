import logging
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

from flask import Flask

ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent
for path in (ROOT, PROJECT_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.utils import auction_email
from app.utils.auction_db import AuctionError, AuctionService, AuctionsUnavailable, mask_name, parse_int, parse_money
from Admin.Backend.auctions import routes as admin_routes
from Users.Backend.auctions import routes as user_routes

NOW = datetime.now(timezone.utc)


class FakeQuery:
    """Records chained calls and returns preset rows; filters are ignored (tests preset the matching rows)."""

    def __init__(self, client, table):
        self.client, self.table, self.op, self.payload = client, table, 'select', None

    def __getattr__(self, name):
        if name == 'not_':
            return self
        if name in ('insert', 'update', 'delete'):
            def start(payload=None):
                self.op, self.payload = name, payload
                self.client.writes.append((self.table, name, payload))
                return self
            return start
        return lambda *args, **kwargs: self

    def execute(self):
        rows = self.client.rows.get(self.table, [])
        if self.op == 'insert':
            row = {'auction_id': 'new-auction', **self.payload}
            return MagicMock(data=[row], count=len(rows))
        return MagicMock(data=list(rows), count=len(rows))


class FakeClient:
    def __init__(self, rows=None, rpc_result=None):
        self.rows, self.writes, self.rpc_result, self.rpc_calls = rows or {}, [], rpc_result, []

    def table(self, name):
        return FakeQuery(self, name)

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        return MagicMock(execute=lambda: MagicMock(data=self.rpc_result))


def make_service(rows=None, rpc_result=None):
    db = MagicMock()
    db.client = FakeClient(rows, rpc_result)
    return AuctionService(db), db


def item_row(days_in_custody=45, status='unclaimed'):
    return {'item_id': 'item-1', 'fpost_id': 'FP1001', 'item_name': 'Blue umbrella', 'description': 'Folding', 'category': 'Accessories',
            'location': 'Library', 'image_url': 'http://img/1.jpg', 'status': status,
            'created_at': (NOW - timedelta(days=days_in_custody)).isoformat()}


class HelperTests(unittest.TestCase):
    def test_masked_name_hides_email_and_campus_id(self):
        profile = {'fname': 'Maria Clara', 'lname': 'Santos', 'email': 'm@umak.edu.ph', 'campus_id': 'K123'}
        self.assertEqual(mask_name(profile), 'Maria S.')
        self.assertEqual(mask_name(None), 'Former bidder')
        self.assertNotIn('umak', mask_name(profile))

    def test_money_parsing_rounds_and_enforces_bounds(self):
        self.assertEqual(str(parse_money('1,250.555', 'bid')), '1250.56')
        for bad in ('abc', '0', '-5', '99999999999'):
            with self.assertRaises(AuctionError):
                parse_money(bad, 'bid')
        with self.assertRaises(AuctionError):
            parse_int('7', 'window', 30, 3600)


class BidTests(unittest.TestCase):
    def auction(self, **extra):
        return {'auction_id': 'a1', 'title': 'Blue umbrella', 'item_reference': 'FP1001', 'starting_price': 100, 'bid_increment': 50,
                'current_price': 150, 'bid_count': 2, 'highest_bidder_id': 'bidder-2', 'status': 'active',
                'starts_at': (NOW - timedelta(days=1)).isoformat(), 'ends_at': (NOW + timedelta(hours=1)).isoformat(), **extra}

    def test_business_rule_errors_map_to_http_statuses(self):
        for code, status in (('auction_closed', 409), ('already_highest', 409), ('account_inactive', 403), ('not_found', 404)):
            service, _ = make_service(rpc_result={'ok': False, 'error': code})
            with self.assertRaises(AuctionError) as caught:
                service.place_bid('a1', 'bidder-2', '200')
            self.assertEqual(caught.exception.status, status)

    def test_low_bid_reports_the_minimum(self):
        service, _ = make_service(rpc_result={'ok': False, 'error': 'bid_too_low', 'min_bid': 200})
        with self.assertRaises(AuctionError) as caught:
            service.place_bid('a1', 'bidder-3', 150)
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(caught.exception.extra['min_bid'], 200)
        self.assertIn('200.00', caught.exception.message)

    def test_garbage_amount_never_reaches_the_database(self):
        service, db = make_service()
        with self.assertRaises(AuctionError):
            service.place_bid('a1', 'bidder-3', 'lots')
        self.assertEqual(db.client.rpc_calls, [])

    def test_successful_bid_notifies_the_previous_leader_once(self):
        result = {'ok': True, 'extended': True, 'bid_id': 'b9', 'previous_bidder_id': 'bidder-2', 'auction': self.auction(current_price=200, highest_bidder_id='bidder-3')}
        service, db = make_service(rows={'user_profiles': [{'account_id': 'bidder-3', 'fname': 'Ana', 'lname': 'Reyes', 'email': 'a@x'}]}, rpc_result=result)
        outcome = service.place_bid('a1', 'bidder-3', 200)
        self.assertTrue(outcome['extended'])
        self.assertEqual(outcome['auction']['current_price'], 200)
        db.create_user_notification.assert_called_once()
        self.assertEqual(db.create_user_notification.call_args[0][0], 'bidder-2')
        self.assertEqual(db.client.rpc_calls[0][0], 'auction_place_bid')

    def test_missing_migration_is_reported_as_unavailable(self):
        service, db = make_service()
        db.client.rpc = MagicMock(side_effect=Exception('Could not find the function public.auction_place_bid in the schema cache'))
        with self.assertRaises(AuctionsUnavailable):
            service.place_bid('a1', 'bidder-3', 200)


class CreateAuctionTests(unittest.TestCase):
    payload = {'found_item_reference': 'FP1001', 'starting_price': '350', 'bid_increment': '25', 'duration_minutes': 1440}

    def test_item_in_custody_less_than_a_month_is_rejected(self):
        service, _ = make_service(rows={'found_items': [item_row(days_in_custody=12)]})
        with self.assertRaises(AuctionError) as caught:
            service.create_auction(self.payload, [], 'admin-1')
        self.assertEqual(caught.exception.status, 409)
        self.assertIn('30 days', caught.exception.message)

    def test_claimed_item_is_rejected(self):
        service, _ = make_service(rows={'found_items': [item_row(status='claimed')]})
        with self.assertRaises(AuctionError):
            service.create_auction(self.payload, [], 'admin-1')

    def test_open_claim_blocks_the_auction(self):
        service, _ = make_service(rows={'found_items': [item_row()], 'claims': [{'claim_id': 'c1'}]})
        with self.assertRaises(AuctionError) as caught:
            service.create_auction(self.payload, [], 'admin-1')
        self.assertIn('claim', caught.exception.message)

    def test_valid_auction_is_saved_with_timer_and_snipe_defaults(self):
        service, db = make_service(rows={'found_items': [item_row()]})
        created = service.create_auction({**self.payload, 'anti_snipe_window_seconds': 120}, ['u1', 'u2', 'u3', 'u4', 'u5'], 'admin-1')
        saved = created
        self.assertEqual(saved['starting_price'], 350.0)
        self.assertEqual(saved['current_price'], 350.0)
        self.assertEqual(saved['status'], 'active')
        self.assertEqual(saved['anti_snipe_window_seconds'], 120)
        self.assertEqual(saved['anti_snipe_extension_seconds'], 300)
        self.assertEqual(len(saved['gallery_urls']), 4)
        starts = datetime.fromisoformat(saved['starts_at'])
        self.assertEqual(datetime.fromisoformat(saved['ends_at']) - starts, timedelta(minutes=1440))
        self.assertEqual(saved['found_item_id'], 'item-1')

    def test_future_start_is_scheduled_and_bad_inputs_are_rejected(self):
        service, _ = make_service(rows={'found_items': [item_row()]})
        later = (NOW + timedelta(days=2)).isoformat()
        self.assertEqual(service.create_auction({**self.payload, 'starts_at': later}, [], 'admin-1')['status'], 'scheduled')
        for bad in ({'starting_price': '0'}, {'duration_minutes': 3}, {'bid_increment': 'x'}, {'anti_snipe_window_seconds': 5}):
            with self.assertRaises(AuctionError):
                service.create_auction({**self.payload, **bad}, [], 'admin-1')


class EligibilityTests(unittest.TestCase):
    def test_items_already_in_a_live_auction_or_with_claims_are_excluded(self):
        rows = {'found_items': [item_row(), {**item_row(), 'item_id': 'item-2', 'fpost_id': 'FP1002'}, {**item_row(), 'item_id': 'item-3', 'fpost_id': 'FP1003'}]}

        class Routing(FakeClient):
            def table(self, name):
                query = FakeQuery(self, name)
                if name in ('auctions', 'claims'):
                    query.client = FakeClient({name: [{'found_item_id': 'item-2' if name == 'auctions' else 'item-3'}]})
                return query
        db = MagicMock()
        db.client = Routing(rows)
        result = AuctionService(db).eligible_items()
        self.assertEqual([i['reference'] for i in result['items']], ['FP1001'])
        self.assertEqual(result['min_custody_days'], 30)
        self.assertGreaterEqual(result['items'][0]['days_in_custody'], 44)


class WinnerNoticeTests(unittest.TestCase):
    def test_mock_email_is_logged_not_sent_and_masks_the_address(self):
        with self.assertLogs(auction_email.logger, level=logging.INFO) as logs:
            with patch.dict('os.environ', {'AUCTION_EMAIL_MODE': 'mock'}):
                result = auction_email.send_auction_won_email(to_email='maria@umak.edu.ph', recipient_name='Maria', item_title='Blue umbrella', reference='FP1001', amount=450)
        self.assertEqual(result['mode'], 'mock')
        self.assertTrue(result['sent'])
        text = '\n'.join(logs.output)
        self.assertIn('[MOCK EMAIL]', text)
        self.assertIn('PHP 450.00', text)
        self.assertNotIn('maria@umak.edu.ph', text)

    def test_winner_gets_in_app_notice_and_the_email_mode_is_recorded(self):
        auction = {'auction_id': 'a1', 'winner_account_id': 'w1', 'title': 'Blue umbrella', 'item_reference': 'FP1001', 'winning_amount': 450}
        service, db = make_service(rows={'user_profiles': [{'account_id': 'w1', 'fname': 'Maria', 'lname': 'S', 'email': 'maria@umak.edu.ph'}]})
        with patch.dict('os.environ', {'AUCTION_EMAIL_MODE': 'mock'}):
            service._send_winner_notice(auction)
        db.create_user_notification.assert_called_once()
        kwargs = db.create_user_notification.call_args.kwargs
        self.assertEqual(kwargs['notification_type'], 'auction_won')
        self.assertEqual(kwargs['link_page'], 'auction-hall')
        self.assertIn(('auctions', 'update', {'winner_email_mode': 'mock'}), db.client.writes)


class RouteTests(unittest.TestCase):
    def client(self, blueprint, prefix):
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='http://unused', SUPABASE_SERVICE_KEY='unused')
        app.register_blueprint(blueprint, url_prefix=prefix)
        return app.test_client()

    def test_public_feed_needs_no_login_and_reports_missing_setup_as_503(self):
        client = self.client(user_routes.auctions_bp, '/api/auctions')
        service = MagicMock()
        service.public_feed.return_value = {'live': [], 'past': [], 'server_time': NOW.isoformat()}
        with patch.object(user_routes, '_service', return_value=service):
            self.assertEqual(client.get('/api/auctions').status_code, 200)
        service.public_feed.side_effect = AuctionsUnavailable('not set up')
        with patch.object(user_routes, '_service', return_value=service):
            response = client.get('/api/auctions')
        self.assertEqual(response.status_code, 503)
        self.assertTrue(response.get_json()['setup_required'])

    def test_bidding_and_commenting_require_a_signed_in_user(self):
        client = self.client(user_routes.auctions_bp, '/api/auctions')
        with patch.object(user_routes, '_service', return_value=MagicMock()) as service:
            self.assertEqual(client.post('/api/auctions/a1/bids', json={'amount': 500}).status_code, 401)
            self.assertEqual(client.post('/api/auctions/a1/comments', json={'body': 'hi'}).status_code, 401)
            service.assert_not_called()

    def test_signed_in_bid_returns_the_new_state_and_rule_errors_keep_their_status(self):
        client = self.client(user_routes.auctions_bp, '/api/auctions')
        service = MagicMock()
        service.place_bid.return_value = {'auction': {'id': 'a1'}, 'extended': True, 'bid_id': 'b1'}
        with patch.object(user_routes, '_authenticated_account_id', return_value='u1'), patch.object(user_routes, '_service', return_value=service):
            response = client.post('/api/auctions/a1/bids', json={'amount': '500'})
            self.assertEqual(response.status_code, 201)
            self.assertIn('extended', response.get_json()['message'])
            service.place_bid.side_effect = AuctionError('Your bid must be at least PHP 550.00.', 409, min_bid=550)
            low = client.post('/api/auctions/a1/bids', json={'amount': '500'})
        self.assertEqual(low.status_code, 409)
        self.assertEqual(low.get_json()['min_bid'], 550)

    def test_anonymous_detail_view_works(self):
        client = self.client(user_routes.auctions_bp, '/api/auctions')
        service = MagicMock()
        service.public_detail.return_value = {'auction': {'id': 'a1'}, 'bids': [], 'comments': []}
        with patch.object(user_routes, '_service', return_value=service):
            response = client.get('/api/auctions/a1', headers={'Authorization': 'Bearer nonsense'})
        self.assertEqual(response.status_code, 200)
        service.public_detail.assert_called_once_with('a1', None)

    def test_admin_routes_require_admin_and_only_super_admin_deletes(self):
        client = self.client(admin_routes.auctions_bp, '/api/admin')
        with patch.object(admin_routes, '_require_admin', side_effect=PermissionError('Admin access required')):
            self.assertEqual(client.get('/api/admin/auctions').status_code, 403)
            self.assertEqual(client.post('/api/admin/auctions', json={}).status_code, 403)

        def require(required_level='admin'):
            if required_level == 'super_admin':
                raise PermissionError('Super administrator access required')
            return {'account_id': 'a-1', 'email': 'admin@umak.edu.ph'}
        with patch.object(admin_routes, '_require_admin', side_effect=require), patch.object(admin_routes, '_service') as service:
            self.assertEqual(client.delete('/api/admin/auctions/a1').status_code, 403)
            service.assert_not_called()

    def test_admin_create_returns_validation_errors_and_logs_success(self):
        client = self.client(admin_routes.auctions_bp, '/api/admin')
        service, db = MagicMock(), MagicMock()
        with patch.object(admin_routes, '_require_admin', return_value={'account_id': 'a-1', 'email': 'admin@umak.edu.ph'}), \
             patch.object(admin_routes, '_service', return_value=(db, service)), patch.object(admin_routes, '_log_admin_action') as log:
            service.create_auction.side_effect = AuctionError('An item must be in custody for at least 30 days before it can be auctioned.', 409)
            rejected = client.post('/api/admin/auctions', json={'found_item_reference': 'FP1001'})
            service.create_auction.side_effect = None
            service.create_auction.return_value = {'auction_id': 'a9', 'title': 'Blue umbrella', 'item_reference': 'FP1001'}
            created = client.post('/api/admin/auctions', json={'found_item_reference': 'FP1001', 'gallery': []})
        self.assertEqual(rejected.status_code, 409)
        self.assertEqual(created.status_code, 201)
        log.assert_called_once()


class PublicBoardTests(unittest.TestCase):
    """The signed-out landing board returns only fields already public, never reporter details."""

    def test_board_selects_safe_columns_only(self):
        from app.utils.supabase_db import SupabaseDB
        db = SupabaseDB.__new__(SupabaseDB)
        db.client = MagicMock()
        db.client.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = MagicMock(data=[{'mpost_id': 'MP1001'}], count=7)
        board = db.get_public_board(missing_limit=8, found_limit=8)
        selected = [call.args[0] for call in db.client.table.return_value.select.call_args_list]
        self.assertEqual(board['counts'], {'missing': 7, 'found': 7})
        for columns in selected:
            for private in ('email', 'campus', 'reporter', 'description', 'distinctive'):
                self.assertNotIn(private, columns)

    def test_board_route_needs_no_login(self):
        from Users.Backend.home import routes as home_routes
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='http://unused', SUPABASE_SERVICE_KEY='unused')
        app.register_blueprint(home_routes.home_bp, url_prefix='/api')
        fake = MagicMock()
        fake.get_public_board.return_value = {'missing': [], 'found': [], 'counts': {'missing': 0, 'found': 0}}
        with patch.object(home_routes, 'get_db', return_value=fake):
            response = app.test_client().get('/api/public/board')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['counts'], {'missing': 0, 'found': 0})


if __name__ == '__main__':
    unittest.main()
