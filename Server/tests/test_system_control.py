import sys
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

from flask import Flask, jsonify

ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent
for path in (ROOT, PROJECT_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.utils import system_control as control
from app.utils.auction_db import AuctionError, AuctionService
from app.utils.auth import JWTService
from Admin.Backend.system_control import routes as system_routes
from Admin.Backend.auctions import routes as auction_routes

NOW = datetime.now(timezone.utc)
ACCOUNT = '11111111-1111-4111-8111-111111111111'


class FakeQuery:
    """Chainable stand-in for a Supabase table; filters are ignored, rows are preset per table."""

    def __init__(self, client, table):
        self.client, self.table, self.op, self.payload, self.calls = client, table, 'select', None, []

    def __getattr__(self, name):
        if name == 'not_':
            return self
        if name in ('insert', 'update', 'delete', 'upsert'):
            def start(payload=None, **kwargs):
                self.op, self.payload = name, payload
                self.client.writes.append((self.table, name, payload))
                return self
            return start

        def chain(*args, **kwargs):
            self.client.filters.append((self.table, name, args))
            return self
        return chain

    def execute(self):
        if self.client.fail.get(self.table):
            raise Exception(self.client.fail[self.table])
        rows = list(self.client.rows.get(self.table, []))
        if self.op == 'insert':
            return MagicMock(data=[{'auction_id': 'new-auction', **self.payload}], count=1)
        return MagicMock(data=rows, count=len(rows))


class FakeClient:
    def __init__(self, rows=None, rpc_result=None, fail=None):
        self.rows, self.writes, self.filters, self.rpc_result, self.fail, self.rpc_calls = rows or {}, [], [], rpc_result, fail or {}, []

    def table(self, name):
        return FakeQuery(self, name)

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        return MagicMock(execute=lambda: MagicMock(data=self.rpc_result))


def profile(**extra):
    return {'account_id': ACCOUNT, 'access_level': 'user', 'is_active': True, 'verification_status': 'verified', 'user_category': 'Student', **extra}


def fake_db(user=None, settings=None, **extra):
    db = MagicMock()
    db.client = FakeClient({'user_profiles': [user or profile()], 'system_settings': settings or [], **extra})
    return db


def token(account=ACCOUNT, issued_ago=0):
    value = JWTService.create_access_token(account, 'x@umak.edu.ph')
    if issued_ago:  # re-sign with an older issue time
        import jwt
        from config import Config
        decoded = jwt.decode(value, Config.JWT_SECRET_KEY, algorithms=['HS256'])
        decoded['iat'] = int(time.time()) - issued_ago
        value = jwt.encode(decoded, Config.JWT_SECRET_KEY, algorithm='HS256')
    return value


def settings_rows(maintenance=False, message='', valid_after=None):
    return [
        {'setting_key': 'maintenance_mode', 'setting_value': {'enabled': maintenance, 'message': message, 'since': None}},
        {'setting_key': 'sessions_valid_after', 'setting_value': {'ts': valid_after}},
    ]


def guarded_app():
    app = Flask(__name__)
    app.config.update(SUPABASE_URL='http://unused', SUPABASE_SERVICE_KEY='unused')
    app.before_request(control.enforce_request)
    for rule in ('/api/found-items', '/api/missing-items', '/api/claims', '/api/auctions/a1/bids', '/api/auth/login', '/api/public/board', '/api/system/status', '/api/profile'):
        app.add_url_rule(rule, endpoint=rule, view_func=lambda: jsonify({'ok': True}), methods=['GET', 'POST'])
    return app.test_client()


def call(db, method, path, bearer=None):
    control.clear_caches()
    with patch('app.utils.get_db', return_value=db):
        return getattr(guarded_app(), method)(path, headers={'Authorization': f'Bearer {bearer}'} if bearer else {})


class EnforcementTests(unittest.TestCase):
    def test_maintenance_locks_standard_users_but_not_admins(self):
        db = fake_db(settings=settings_rows(maintenance=True, message='Upgrading the database'))
        blocked = call(db, 'get', '/api/profile', token())
        self.assertEqual(blocked.status_code, 503)
        self.assertTrue(blocked.get_json()['maintenance'])
        self.assertEqual(blocked.get_json()['error'], 'Upgrading the database')
        admin_db = fake_db(user=profile(access_level='admin'), settings=settings_rows(maintenance=True))
        self.assertEqual(call(admin_db, 'get', '/api/profile', token()).status_code, 200)

    def test_maintenance_keeps_sign_in_and_status_reachable_but_blocks_public_data(self):
        db = fake_db(settings=settings_rows(maintenance=True))
        self.assertEqual(call(db, 'post', '/api/auth/login').status_code, 200)
        self.assertEqual(call(db, 'get', '/api/system/status').status_code, 200)
        self.assertEqual(call(db, 'get', '/api/public/board').status_code, 503)
        self.assertEqual(call(db, 'post', '/api/found-items').status_code, 503)

    def test_force_logout_revokes_only_older_standard_sessions(self):
        cutoff = (NOW - timedelta(seconds=60)).isoformat()
        db = fake_db(settings=settings_rows(valid_after=cutoff))
        revoked = call(db, 'get', '/api/profile', token(issued_ago=3600))
        self.assertEqual(revoked.status_code, 401)
        self.assertTrue(revoked.get_json()['session_revoked'])
        self.assertEqual(call(db, 'get', '/api/profile', token()).status_code, 200)
        staff_db = fake_db(user=profile(access_level='super_admin'), settings=settings_rows(valid_after=cutoff))
        self.assertEqual(call(staff_db, 'get', '/api/profile', token(issued_ago=3600)).status_code, 200)

    def test_suspended_account_is_blocked_with_the_reason_and_date(self):
        until = (NOW + timedelta(days=7)).isoformat()
        db = fake_db(user=profile(is_active=False, suspended_until=until, suspension_reason='Did not collect an auction item'))
        response = call(db, 'get', '/api/profile', token())
        self.assertEqual(response.status_code, 403)
        body = response.get_json()
        self.assertTrue(body['suspended'])
        self.assertIn('Did not collect', body['error'])

    def test_expired_suspension_lifts_itself(self):
        db = fake_db(user=profile(is_active=False, suspended_until=(NOW - timedelta(hours=1)).isoformat(), suspension_reason='x'))
        self.assertEqual(call(db, 'get', '/api/profile', token()).status_code, 200)
        self.assertIn(('user_profiles', 'update', {'is_active': True, 'suspended_until': None, 'suspension_reason': None}), db.client.writes)

    def test_indefinite_suspension_has_no_end_date(self):
        db = fake_db(user=profile(is_active=False, suspended_until=None))
        self.assertEqual(call(db, 'get', '/api/profile', token()).status_code, 403)

    def test_unverified_users_cannot_report_claim_or_bid(self):
        db = fake_db(user=profile(verification_status='pending'))
        for path in ('/api/found-items', '/api/missing-items', '/api/claims', '/api/auctions/a1/bids'):
            response = call(db, 'post', path, token())
            self.assertEqual(response.status_code, 403, path)
            self.assertTrue(response.get_json()['verification_required'])
        self.assertEqual(call(db, 'get', '/api/found-items', token()).status_code, 200)

    def test_verified_users_and_admins_pass_the_gate(self):
        self.assertEqual(call(fake_db(), 'post', '/api/found-items', token()).status_code, 200)
        staff = fake_db(user=profile(access_level='admin', verification_status='pending'))
        self.assertEqual(call(staff, 'post', '/api/claims', token()).status_code, 200)

    def test_rejected_status_is_not_verified(self):
        self.assertEqual(call(fake_db(user=profile(verification_status='rejected')), 'post', '/api/claims', token()).status_code, 403)

    def test_database_failure_fails_open(self):
        db = fake_db()
        db.client.fail['system_settings'] = 'connection reset'
        self.assertEqual(call(db, 'post', '/api/found-items', token()).status_code, 200)

    def test_missing_settings_table_means_no_maintenance(self):
        db = fake_db()
        db.client.fail['system_settings'] = 'Could not find the table public.system_settings in the schema cache'
        self.assertEqual(call(db, 'get', '/api/profile', token()).status_code, 200)

    def test_invalid_and_challenge_tokens_are_ignored_by_the_hook(self):
        db = fake_db(settings=settings_rows())
        self.assertEqual(call(db, 'get', '/api/profile', 'not-a-token').status_code, 200)


class LoginBlockTests(unittest.TestCase):
    def check(self, user, settings=None):
        control.clear_caches()
        db = fake_db(user=user, settings=settings or [])
        with Flask(__name__).app_context():
            return control.login_block(db, user)

    def test_non_staff_cannot_sign_in_during_maintenance_but_staff_can(self):
        self.assertEqual(self.check(profile(), settings_rows(maintenance=True)).status_code, 503)
        self.assertIsNone(self.check(profile(access_level='admin'), settings_rows(maintenance=True)))

    def test_suspended_user_cannot_sign_in(self):
        response = self.check(profile(is_active=False, suspended_until=(NOW + timedelta(days=3)).isoformat()))
        self.assertEqual(response.status_code, 403)
        self.assertTrue(response.get_json()['suspended'])

    def test_normal_user_signs_in(self):
        self.assertIsNone(self.check(profile()))


class SettingsAndCleanupTests(unittest.TestCase):
    def test_cleanup_age_cannot_go_below_30_days(self):
        for bad in (0, 29, -5, 'abc', None, 4000):
            with self.assertRaises(ValueError):
                control.validate_days(bad)
        self.assertEqual(control.validate_days('45'), 45)

    def test_cleanup_targets_old_read_notifications_by_default(self):
        db = MagicMock()
        chain = db.client.table.return_value.delete.return_value
        chain.lt.return_value = chain
        chain.eq.return_value = chain
        chain.execute.return_value = MagicMock(count=12, data=[])
        summary = control.run_cleanup(db, 30, False, ['notifications'], ACCOUNT)
        self.assertEqual(summary['deleted'], {'notifications': 12})
        self.assertEqual(chain.lt.call_args.args[0], 'created_at')
        chain.eq.assert_called_with('is_read', True)

    def test_unread_notifications_are_kept_unless_asked(self):
        db = MagicMock()
        chain = db.client.table.return_value.delete.return_value
        chain.lt.return_value = chain
        chain.execute.return_value = MagicMock(count=3, data=[])
        control.run_cleanup(db, 60, True, ['notifications'], ACCOUNT)
        chain.eq.assert_not_called()

    def test_cleanup_needs_a_known_target(self):
        with self.assertRaises(ValueError):
            control.run_cleanup(MagicMock(), 30, False, ['user_profiles', 'claims'], ACCOUNT)

    def test_force_logout_stamp_is_whole_seconds(self):
        db = MagicMock()
        stamp = control.force_logout(db, ACCOUNT)
        self.assertEqual(datetime.fromisoformat(stamp).microsecond, 0)
        self.assertEqual(db.client.table.return_value.upsert.call_args.args[0]['setting_key'], 'sessions_valid_after')

    def test_maintenance_message_is_trimmed_and_since_is_set_when_enabled(self):
        db = MagicMock()
        value = control.set_maintenance(db, True, 'x' * 500, ACCOUNT)
        self.assertEqual(len(value['message']), control.MAX_MESSAGE_LENGTH)
        self.assertTrue(value['since'])
        self.assertIsNone(control.set_maintenance(db, False, '', ACCOUNT)['since'])

    def test_missing_settings_table_asks_for_the_migration(self):
        db = MagicMock()
        db.client.table.return_value.upsert.return_value.execute.side_effect = Exception('relation "public.system_settings" does not exist')
        with self.assertRaises(control.SystemSetupRequired):
            control.set_maintenance(db, True, '', ACCOUNT)


class HealthScanTests(unittest.TestCase):
    def test_missing_environment_variables_are_reported_without_values(self):
        control.clear_caches()
        db = fake_db(settings=settings_rows())
        db.get_admin_mfa.return_value = {'enabled_at': 'x'}
        with patch.dict('os.environ', {'SUPABASE_URL': 'x', 'SUPABASE_SERVICE_KEY': 'secret-service-key', 'JWT_SECRET_KEY': 'dev-secret-key-change-in-production'}, clear=True):
            report = control.health_scan(db)
        env = next(c for c in report['checks'] if c['id'] == 'environment')
        self.assertEqual(env['status'], 'fail')
        self.assertIn('Missing: APP_ENCRYPTION_KEY', env['items'])
        self.assertNotIn('secret-service-key', str(report))
        self.assertEqual(report['status'], 'fail')

    def test_a_failing_check_does_not_stop_the_scan(self):
        control.clear_caches()
        db = fake_db(settings=settings_rows())
        db.client.fail['user_activity_logs'] = 'boom'
        db.get_admin_mfa.return_value = None
        report = control.health_scan(db)
        ids = [c['id'] for c in report['checks']]
        self.assertEqual(len(ids), 10)
        self.assertEqual(next(c for c in report['checks'] if c['id'] == 'unverified_activity')['status'], 'warn')

    def test_unverified_users_with_heavy_activity_are_flagged(self):
        control.clear_caches()
        logs = [{'account_id': ACCOUNT}] * 20
        db = fake_db(user=profile(verification_status='pending', fname='Ana', lname='Reyes', campus_id='K1'), settings=settings_rows(), user_activity_logs=logs)
        db.get_admin_mfa.return_value = {'enabled_at': 'x'}
        report = control.health_scan(db)
        check = next(c for c in report['checks'] if c['id'] == 'unverified_activity')
        self.assertEqual(check['status'], 'warn')
        self.assertIn('Ana Reyes', check['items'][0])


class SystemRouteTests(unittest.TestCase):
    def client(self):
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='http://unused', SUPABASE_SERVICE_KEY='unused')
        app.register_blueprint(system_routes.system_control_bp, url_prefix='/api/admin')
        return app.test_client()

    def test_every_route_needs_a_super_admin(self):
        client = self.client()
        calls = [('get', '/api/admin/system/overview'), ('put', '/api/admin/system/maintenance'), ('post', '/api/admin/system/force-logout'),
                 ('get', '/api/admin/system/health'), ('get', '/api/admin/system/cleanup/preview'), ('post', '/api/admin/system/cleanup')]
        with patch.object(system_routes, '_require_admin', side_effect=PermissionError('Super administrator access required')) as guard, \
             patch.object(system_routes, '_database') as database:
            for method, path in calls:
                self.assertEqual(getattr(client, method)(path, json={}).status_code, 403, path)
            database.assert_not_called()
            self.assertTrue(all(call.kwargs.get('required_level') == 'super_admin' for call in guard.call_args_list))

    def test_maintenance_toggle_validates_and_logs(self):
        client = self.client()
        admin = {'account_id': ACCOUNT, 'email': 'root@umak.edu.ph'}
        with patch.object(system_routes, '_require_admin', return_value=admin), patch.object(system_routes, '_database', return_value=MagicMock()), \
             patch.object(system_routes.control, 'set_maintenance', return_value={'enabled': True, 'message': 'Back soon', 'since': 'now'}), \
             patch.object(system_routes, '_log_admin_action') as log:
            self.assertEqual(client.put('/api/admin/system/maintenance', json={'enabled': 'yes'}).status_code, 400)
            ok = client.put('/api/admin/system/maintenance', json={'enabled': True, 'message': 'Back soon'})
        self.assertEqual(ok.status_code, 200)
        self.assertIn('locked out', ok.get_json()['message'])
        log.assert_called_once()

    def test_cleanup_rejects_young_data_and_missing_targets(self):
        client = self.client()
        admin = {'account_id': ACCOUNT, 'email': 'root@umak.edu.ph'}
        with patch.object(system_routes, '_require_admin', return_value=admin), patch.object(system_routes, '_database', return_value=MagicMock()):
            self.assertEqual(client.post('/api/admin/system/cleanup', json={'days': 7, 'targets': ['notifications']}).status_code, 400)
            self.assertEqual(client.post('/api/admin/system/cleanup', json={'days': 30}).status_code, 400)
            self.assertEqual(client.get('/api/admin/system/cleanup/preview?days=3').status_code, 400)

    def test_setup_required_returns_503(self):
        client = self.client()
        admin = {'account_id': ACCOUNT, 'email': 'root@umak.edu.ph'}
        with patch.object(system_routes, '_require_admin', return_value=admin), patch.object(system_routes, '_database', return_value=MagicMock()), \
             patch.object(system_routes.control, 'force_logout', side_effect=control.SystemSetupRequired('run the migration')):
            response = client.post('/api/admin/system/force-logout')
        self.assertEqual(response.status_code, 503)
        self.assertTrue(response.get_json()['setup_required'])


def auction_row(**extra):
    return {'auction_id': 'a1', 'title': 'Blue umbrella', 'item_reference': 'FP1001', 'found_item_id': 'item-1', 'status': 'awaiting_admin', 'winner_account_id': 'w1',
            'winning_amount': 450, 'starting_price': 100, 'bid_increment': 50, 'starts_at': (NOW - timedelta(days=3)).isoformat(),
            'original_ends_at': (NOW - timedelta(days=1)).isoformat(), 'anti_snipe_enabled': True, 'gallery_urls': [], **extra}


class AuctionLifecycleTests(unittest.TestCase):
    def service(self, rows=None, rpc_result=None):
        db = MagicMock()
        db.client = FakeClient(rows or {}, rpc_result)
        return AuctionService(db), db

    def test_finalize_success_notifies_the_winner(self):
        service, db = self.service(rpc_result={'ok': True, 'outcome': 'finalized', 'auction': auction_row(status='ended', fulfillment_status='awaiting_pickup')})
        with patch.object(service, '_notify_pending_winners') as notify:
            result = service.finalize('a1', ACCOUNT)
        self.assertEqual(result['outcome'], 'finalized')
        notify.assert_called_once()
        self.assertEqual(db.client.rpc_calls[0][0], 'auction_finalize')

    def test_finalize_errors_map_to_statuses(self):
        for code, status in (('admin_required', 403), ('not_found', 404), ('not_awaiting', 409)):
            service, _ = self.service(rpc_result={'ok': False, 'error': code})
            with self.assertRaises(AuctionError) as caught:
                service.finalize('a1', ACCOUNT)
            self.assertEqual(caught.exception.status, status)

    def test_finalize_cancel_outcome_tells_the_bidder_and_sends_no_winner_notice(self):
        service, db = self.service(rpc_result={'ok': True, 'outcome': 'cancelled', 'auction': auction_row(status='cancelled', cancel_reason='An ownership claim for this item is under review.')})
        with patch.object(service, '_notify_pending_winners') as notify:
            result = service.finalize('a1', ACCOUNT)
        self.assertEqual(result['outcome'], 'cancelled')
        notify.assert_not_called()
        self.assertEqual(db.create_user_notification.call_args.kwargs['notification_type'], 'auction_cancelled')

    def test_reauction_forfeits_and_lists_the_item_again(self):
        service, db = self.service(rows={'auctions': [auction_row(status='ended', fulfillment_status='awaiting_pickup')], 'found_items': [{'status': 'unclaimed'}], 'claims': []})
        result = service.reauction('a1', {'starting_price': '300', 'duration_minutes': 1440, 'reason': 'Winner never replied'}, ACCOUNT)
        writes = [w for w in db.client.writes if w[0] == 'auctions']
        forfeit = writes[0][2]
        self.assertEqual((forfeit['status'], forfeit['fulfillment_status']), ('ended', 'forfeited'))
        self.assertEqual(forfeit['reauction_reason'], 'Winner never replied')
        fresh = writes[1][2]
        self.assertEqual((fresh['status'], fresh['starting_price'], fresh['current_price'], fresh['reauctioned_from']), ('active', 300.0, 300.0, 'a1'))
        self.assertEqual(result['previous_winner_id'], 'w1')
        self.assertEqual(datetime.fromisoformat(fresh['ends_at']) - datetime.fromisoformat(fresh['starts_at']), timedelta(minutes=1440))

    def test_reauction_after_pickup_failure_returns_the_item_to_custody(self):
        service, db = self.service(rows={'auctions': [auction_row(status='ended', fulfillment_status='awaiting_pickup')], 'found_items': [{'status': 'auctioned'}], 'claims': []})
        service.reauction('a1', {}, ACCOUNT)
        self.assertIn(('found_items', 'update', {'status': 'unclaimed', 'custody_status': 'turned_over', 'updated_at': unittest.mock.ANY}), db.client.writes)

    def test_reauction_only_after_a_winner_was_confirmed(self):
        # Awaiting admin is refused: the admin must confirm the winner first, then re-auction if they flake.
        for row in (auction_row(status='awaiting_admin'), auction_row(status='active'), auction_row(status='ended', fulfillment_status='collected'), auction_row(status='cancelled')):
            service, _ = self.service(rows={'auctions': [row]})
            with self.assertRaises(AuctionError) as caught:
                service.reauction('a1', {}, ACCOUNT)
            self.assertEqual(caught.exception.status, 409)

    def test_reauction_refuses_when_an_owner_claim_is_open(self):
        service, db = self.service(rows={'auctions': [auction_row(status='ended', fulfillment_status='awaiting_pickup')], 'found_items': [{'status': 'unclaimed'}], 'claims': [{'claim_id': 'c1'}]})
        with self.assertRaises(AuctionError):
            service.reauction('a1', {}, ACCOUNT)
        self.assertEqual([w for w in db.client.writes if w[0] == 'auctions'], [])

    def test_reauction_validates_terms_before_changing_anything(self):
        service, db = self.service(rows={'auctions': [auction_row(status='ended', fulfillment_status='awaiting_pickup')], 'found_items': [{'status': 'unclaimed'}], 'claims': []})
        for bad in ({'starting_price': '-1'}, {'duration_minutes': 2}, {'bid_increment': 'x'}):
            with self.assertRaises(AuctionError):
                service.reauction('a1', bad, ACCOUNT)
        self.assertEqual([w for w in db.client.writes if w[0] == 'auctions'], [])

    def test_a_forfeited_winner_never_gets_the_you_won_notice(self):
        service, db = self.service()
        service._notify_pending_winners()
        statuses = [f for f in db.client.filters if f[1] == 'in_' and f[2] and f[2][0] == 'fulfillment_status']
        self.assertEqual(statuses[0][2][1], ['awaiting_pickup', 'collected'])


class AuctionAdminRouteTests(unittest.TestCase):
    def client(self):
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='http://unused', SUPABASE_SERVICE_KEY='unused')
        app.register_blueprint(auction_routes.auctions_bp, url_prefix='/api/admin')
        return app.test_client()

    def run_reauction(self, payload, target):
        service, db = MagicMock(), MagicMock()
        service.reauction.return_value = {'old': {'title': 'Umbrella', 'item_reference': 'FP1001'}, 'new': {'auction_id': 'n1'}, 'previous_winner_id': 'w1'}
        db.get_user_by_account_id.return_value = target
        db.update_user_status.return_value = {}
        with patch.object(auction_routes, '_require_admin', return_value={'account_id': ACCOUNT, 'email': 'a@umak.edu.ph'}), \
             patch.object(auction_routes, '_service', return_value=(db, service)), patch.object(auction_routes, '_log_admin_action'):
            response = self.client().post('/api/admin/auctions/a1/reauction', json=payload)
        return response, db

    def test_reauction_can_suspend_the_previous_winner(self):
        response, db = self.run_reauction({'suspend_days': 7}, {'email': 'w@umak.edu.ph', 'access_level': 'user'})
        self.assertEqual(response.status_code, 201)
        db.update_user_status.assert_called_once()
        self.assertEqual(db.update_user_status.call_args.kwargs['days'], 7)
        self.assertIn('suspended for 7 days', response.get_json()['message'])

    def test_reauction_never_suspends_an_admin(self):
        response, db = self.run_reauction({'suspend_days': 7}, {'email': 'boss@umak.edu.ph', 'access_level': 'admin'})
        db.update_user_status.assert_not_called()
        self.assertFalse(response.get_json()['suspension']['applied'])

    def test_reauction_without_suspension_leaves_the_account_alone(self):
        response, db = self.run_reauction({}, {'access_level': 'user'})
        db.update_user_status.assert_not_called()
        self.assertEqual(response.status_code, 201)

    def test_suspension_length_is_validated(self):
        for bad in (0.5, 400, 'abc'):
            response, db = self.run_reauction({'suspend_days': bad}, {'access_level': 'user'})
            self.assertEqual(response.status_code, 400, bad)
            db.update_user_status.assert_not_called()


if __name__ == '__main__':
    unittest.main()
