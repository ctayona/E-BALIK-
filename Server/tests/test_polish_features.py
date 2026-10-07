"""Session lifetimes, the guard role, claim pickup reminders and expiry, Smart Tag reminders, evidence retention,
email preferences, handover receipts and QR codes, analytics ranges, and the auctions ready-to-list count."""
import sys
import time
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import jwt
from flask import Flask

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT.parent, ROOT / 'tests'):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from config import Config  # noqa: E402
from memdb import MemClient  # noqa: E402
from test_handover_and_timeouts import ADMIN2_ID, ADMIN_ID, CLAIM, ITEM, NOW, OWNER, WINNER, claim_client, claim_store, iso, make_db, profiles  # noqa: E402
from test_mission_control import fake_db, person  # noqa: E402
from Admin.Backend.claims_verification import routes as claim_routes  # noqa: E402
from Admin.Backend.shared import admin_access  # noqa: E402
from Admin.Backend.users import routes as user_routes  # noqa: E402
from app.utils import analytics, email_prefs, handover, housekeeping, mission_control as mission, system_control  # noqa: E402
from app.utils.auth import JWTService, session_lifetime  # noqa: E402
from app.utils.email_service import EmailService  # noqa: E402
from Users.Backend.claim import routes as user_claim_routes  # noqa: E402
from Users.Backend.email_prefs import routes as prefs_routes  # noqa: E402

DAY = timedelta(days=1)


# ----------------------------------------------------------------------------------------------------------- sessions
class SessionTests(unittest.TestCase):
    @staticmethod
    def decode(token):
        return jwt.decode(token, Config.JWT_SECRET_KEY, algorithms=['HS256'], options={'verify_exp': False})

    @staticmethod
    def forged(level, age_hours, valid_days=30):
        """A token like the ones issued before session limits existed: valid for 30 days, but issued `age_hours` ago."""
        issued = time.time() - age_hours * 3600
        payload = {'account_id': 'a1', 'email': 'a@umak.edu.ph', 'iat': int(issued), 'exp': int(issued + valid_days * 86400)}
        if level:
            payload['access_level'] = level
        return jwt.encode(payload, Config.JWT_SECRET_KEY, algorithm='HS256')

    def test_lifetimes_are_twelve_hours_for_users_and_eight_for_staff(self):
        self.assertEqual(session_lifetime('user'), timedelta(hours=12))
        self.assertEqual(session_lifetime(None), timedelta(hours=12))
        for level in ('admin', 'super_admin', 'guard', 'GUARD'):
            self.assertEqual(session_lifetime(level), timedelta(hours=8), level)

    def test_new_tokens_carry_the_matching_expiry(self):
        user = self.decode(JWTService.create_access_token('a1', 'a@umak.edu.ph', 'Student', 'user'))
        staff = self.decode(JWTService.create_access_token('a2', 'b@umak.edu.ph', 'Admin', 'admin'))
        self.assertEqual(user['exp'] - user['iat'], 12 * 3600)
        self.assertEqual(staff['exp'] - staff['iat'], 8 * 3600)

    def test_a_fresh_token_verifies(self):
        token = JWTService.create_access_token('a1', 'a@umak.edu.ph', 'Student', 'user')
        self.assertEqual(JWTService.verify_token(token)['account_id'], 'a1')

    def test_an_old_thirty_day_token_is_refused_once_past_the_session_limit(self):
        with self.assertRaises(ValueError):
            JWTService.verify_token(self.forged('user', 13))      # a user who left the app open overnight
        with self.assertRaises(ValueError):
            JWTService.verify_token(self.forged('admin', 9))      # an admin session from the night before
        with self.assertRaises(ValueError):
            JWTService.verify_token(self.forged('guard', 9))
        with self.assertRaises(ValueError):
            JWTService.verify_token(self.forged(None, 20))        # tokens without a level count as user sessions

    def test_a_token_inside_the_limit_still_works(self):
        self.assertEqual(JWTService.verify_token(self.forged('admin', 7))['account_id'], 'a1')
        self.assertEqual(JWTService.verify_token(self.forged('user', 11))['account_id'], 'a1')


# ----------------------------------------------------------------------------------------------------------- guard role
class FakeAccounts:
    def __init__(self, level):
        self.level = level

    def get_user_by_account_id(self, account_id):
        return {'account_id': account_id, 'access_level': self.level, 'is_active': True, 'email': 'x@umak.edu.ph'}

    def get_admin_mfa(self, account_id):
        return None


def real_access(level):
    """The real _require_admin, signed in as an account with this access level."""
    return (patch.object(admin_access, 'get_db', return_value=FakeAccounts(level)),
            patch.object(admin_access.JWTService, 'verify_token', return_value={'account_id': 'g1'}),
            patch.object(admin_access.JWTService, 'extract_token_from_header', return_value='t'))


class GuardRoleTests(unittest.TestCase):
    def setUp(self):
        from app.utils import rate_limit
        rate_limit.reset()
        self.app = Flask(__name__)
        self.app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')

    def require(self, level, required):
        patches = real_access(level)
        with patches[0], patches[1], patches[2], self.app.test_request_context():
            return admin_access._require_admin(required_level=required)

    def test_guard_level_is_kept_and_not_mapped_to_user(self):
        self.assertEqual(self.require('guard', 'guard')['access_level'], 'guard')

    def test_guard_admin_and_super_admin_pass_the_guard_check(self):
        for level in ('guard', 'admin', 'super_admin'):
            self.assertEqual(self.require(level, 'guard')['access_level'], level)

    def test_users_do_not_pass_the_guard_check(self):
        with self.assertRaises(PermissionError):
            self.require('user', 'guard')

    def test_guards_never_pass_an_admin_or_super_admin_check(self):
        for required in ('admin', 'super_admin'):
            with self.assertRaises(PermissionError):
                self.require('guard', required)

    def test_system_control_knows_the_guard(self):
        self.assertEqual(system_control.access_level({'access_level': 'guard'}), 'guard')
        self.assertIn('guard', system_control.DESK_LEVELS)
        self.assertNotIn('guard', system_control.STAFF_LEVELS)

    def routes_as(self, level, store, calls):
        """The claims blueprint with the REAL access check, signed in as `level`."""
        db = make_db(store)
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
        app.register_blueprint(claim_routes.claims_verification_bp, url_prefix='/api/admin')
        patches = real_access(level) + (patch.object(claim_routes, 'get_db', return_value=db), patch.object(claim_routes, '_log_admin_action'),
                                       patch.object(claim_routes, 'EmailService', return_value=MagicMock()))
        for p in patches:
            p.start()
        self.addCleanup(patch.stopall)
        return app.test_client(), db

    def test_a_guard_can_use_the_release_desk_and_nothing_else(self):
        store = claim_store()
        client, db = self.routes_as('guard', store, [])
        pin = handover.HandoverService(db).issue(CLAIM)
        looked = client.post('/api/admin/claims/handover/lookup', json={'pin': pin})
        released = client.post('/api/admin/claims/handover/release', json={'pin': pin})
        listing = client.get('/api/admin/claims')
        reissue = client.post(f'/api/admin/claims/{CLAIM}/handover-pin')
        approve = client.patch(f'/api/admin/claims/{CLAIM}/status', json={'status': 'rejected'})
        self.assertEqual((looked.status_code, released.status_code), (200, 200))
        self.assertEqual(store['claims'][0]['status'], 'collected')
        self.assertEqual((listing.status_code, reissue.status_code, approve.status_code), (403, 403, 403))

    def test_a_signed_in_user_cannot_use_the_release_desk(self):
        client, db = self.routes_as('user', claim_store(), [])
        self.assertEqual(client.post('/api/admin/claims/handover/lookup', json={'pin': 'K7M2QX'}).status_code, 403)

    def test_an_admin_can_still_use_the_release_desk(self):
        store = claim_store()
        client, db = self.routes_as('admin', store, [])
        pin = handover.HandoverService(db).issue(CLAIM)
        self.assertEqual(client.post('/api/admin/claims/handover/lookup', json={'pin': pin}).status_code, 200)

    def test_role_assignment_rules(self):
        """Admins can make someone a guard (and take it away); only super admins deal with administrators; nobody touches a super admin."""
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
        app.register_blueprint(user_routes.users_bp, url_prefix='/api/admin')
        people = {
            OWNER: {'account_id': OWNER, 'access_level': 'user', 'is_active': True, 'email': 'o@umak.edu.ph'},
            'guard-1': {'account_id': 'guard-1', 'access_level': 'guard', 'is_active': True, 'email': 'g@umak.edu.ph'},
            'admin-2': {'account_id': 'admin-2', 'access_level': 'admin', 'is_active': True, 'email': 'a2@umak.edu.ph'},
            'boss-1': {'account_id': 'boss-1', 'access_level': 'super_admin', 'is_active': True, 'email': 'b@umak.edu.ph'},
            'sus-1': {'account_id': 'sus-1', 'access_level': 'user', 'is_active': False, 'email': 's@umak.edu.ph'},
        }
        db = MagicMock()
        db.get_user_by_account_id.side_effect = lambda account_id: people.get(account_id)
        db.set_user_access_level.side_effect = lambda target, level, actor_id: {'email': people[target]['email'], 'access_level': level}
        actor = {'level': 'super_admin'}

        def require(required_level='admin'):
            if required_level == 'super_admin' and actor['level'] != 'super_admin':
                raise PermissionError('Super administrator access required')
            return {'account_id': ADMIN_ID, 'email': 'a@umak.edu.ph', 'access_level': actor['level']}

        def change(target, level):
            return client.patch(f'/api/admin/users/{target}/access-level', json={'access_level': level}).status_code
        with patch.object(user_routes, '_require_admin', side_effect=require), patch.object(user_routes, 'get_db', return_value=db):
            client = app.test_client()
            self.assertEqual((change(OWNER, 'guard'), change(OWNER, 'owner'), change('admin-2', 'user'), change(OWNER, 'admin')), (200, 400, 200, 200))
            self.assertEqual(change('boss-1', 'user'), 403)
            self.assertEqual(change(ADMIN_ID, 'guard'), 400)   # nobody changes their own level
            actor['level'] = 'admin'
            db.set_user_access_level.reset_mock()
            self.assertEqual((change(OWNER, 'guard'), change('guard-1', 'user')), (200, 200))
            self.assertEqual((change(OWNER, 'admin'), change('admin-2', 'user'), change('admin-2', 'guard'), change('boss-1', 'guard')), (403, 403, 403, 403))
            self.assertEqual(change('sus-1', 'guard'), 409)
            self.assertEqual(change('nobody', 'guard'), 404)
            self.assertEqual(db.set_user_access_level.call_count, 2)
        names = [call.args[1] for call in db.create_user_notification.call_args_list]
        self.assertIn('You are now a guard', names)


class StaffLoginTests(unittest.TestCase):
    def login(self, level, admin_only=True):
        from app.utils.auth import PasswordService
        from Users.Backend.home import routes as home_routes
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
        app.register_blueprint(home_routes.home_bp, url_prefix='/api')
        db = MagicMock()
        db.get_user_by_email.return_value = {'account_id': 'g1', 'email': 'g@umak.edu.ph', 'fname': 'Gio', 'lname': 'Guard', 'access_level': level,
                                             'user_role': 'User', 'is_active': True, 'password_hash': PasswordService.hash_password('Secret123!')}
        db.get_admin_mfa.return_value = None
        with patch.object(home_routes, 'get_db', return_value=db), patch.object(home_routes, 'login_block', return_value=None), \
                patch.object(home_routes, '_verification_profile_metadata', return_value={}):
            return app.test_client().post('/api/auth/login', json={'email': 'g@umak.edu.ph', 'password': 'Secret123!', 'admin_only': admin_only})

    def test_a_guard_can_sign_in_to_the_staff_console_with_an_eight_hour_session(self):
        response = self.login('guard')
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        claims = SessionTests.decode(body['token'])
        self.assertEqual((body['access_level'], claims['access_level']), ('guard', 'guard'))
        self.assertEqual(claims['exp'] - claims['iat'], 8 * 3600)

    def test_admins_get_eight_hours_and_users_twelve(self):
        admin = SessionTests.decode(self.login('admin').get_json()['token'])
        user = SessionTests.decode(self.login('user', admin_only=False).get_json()['token'])
        self.assertEqual(admin['exp'] - admin['iat'], 8 * 3600)
        self.assertEqual(user['exp'] - user['iat'], 12 * 3600)

    def test_a_normal_user_cannot_sign_in_to_the_staff_console(self):
        self.assertEqual(self.login('user').status_code, 403)


# ----------------------------------------------------------------------------------------------------------- handover QR and receipt
class QrAndReceiptTests(unittest.TestCase):
    def test_the_qr_prefix_is_understood_by_the_pin_check(self):
        self.assertEqual(handover.normalize_pin(handover.qr_payload('K7M2QX')), 'K7M2QX')
        self.assertEqual(handover.normalize_pin('ebalik-handover:k7m 2qx'), 'K7M2QX')
        self.assertEqual(handover.normalize_pin('OTHER-APP:K7M2QX'), '')

    def test_the_qr_image_is_a_png(self):
        self.assertTrue(handover.qr_png('K7M2QX').startswith(b'\x89PNG'))

    def user_client(self, store, account):
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
        app.register_blueprint(user_claim_routes.claims_bp, url_prefix='/api/claims')
        db = make_db(store)
        patches = (patch.object(user_claim_routes, 'get_db', return_value=db), patch.object(user_claim_routes, '_account_id', return_value=account))
        for p in patches:
            p.start()
        self.addCleanup(patch.stopall)
        return app.test_client(), db

    def test_the_owner_gets_their_qr_and_nobody_else_does(self):
        store = claim_store()
        client, db = self.user_client(store, OWNER)
        handover.HandoverService(db).issue(CLAIM)
        mine = client.get(f'/api/claims/{CLAIM}/handover-qr')
        self.assertEqual((mine.status_code, mine.mimetype, mine.headers['Cache-Control']), (200, 'image/png', 'no-store'))
        self.assertTrue(mine.data.startswith(b'\x89PNG'))
        other, _ = self.user_client(store, WINNER)
        self.assertEqual(other.get(f'/api/claims/{CLAIM}/handover-qr').status_code, 404)
        self.assertEqual(client.get('/api/claims/not-a-uuid/handover-qr').status_code, 404)

    def test_no_qr_without_an_active_pin(self):
        store = claim_store(status='collected')
        client, _ = self.user_client(store, OWNER)
        self.assertEqual(client.get(f'/api/claims/{CLAIM}/handover-qr').status_code, 404)

    def test_releasing_by_pin_emails_the_owner_a_receipt(self):
        store = claim_store()
        db = make_db(store)
        pin = handover.HandoverService(db).issue(CLAIM)
        email = MagicMock()
        email.send_handover_receipt_email.return_value = True
        client, patches = claim_client(db, 'guard')
        with patches[0], patches[1], patches[2], patch.object(claim_routes, 'EmailService', return_value=email):
            response = client.post('/api/admin/claims/handover/release', json={'pin': pin})
        sent = email.send_handover_receipt_email.call_args.kwargs
        self.assertEqual(response.status_code, 200)
        self.assertEqual((sent['to_email'], sent['item_name']), ('maria@umak.edu.ph', 'Blue umbrella'))
        self.assertNotIn(pin, str(sent))

    def test_a_failed_receipt_never_undoes_the_release(self):
        store = claim_store()
        db = make_db(store)
        pin = handover.HandoverService(db).issue(CLAIM)
        email = MagicMock()
        email.send_handover_receipt_email.side_effect = RuntimeError('smtp down')
        client, patches = claim_client(db, 'guard')
        with patches[0], patches[1], patches[2], patch.object(claim_routes, 'EmailService', return_value=email):
            response = client.post('/api/admin/claims/handover/release', json={'pin': pin})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(store['claims'][0]['status'], 'collected')

    def test_marking_collected_on_the_claims_page_also_sends_the_receipt(self):
        store = claim_store()
        db = make_db(store)
        email = MagicMock()
        email.send_handover_receipt_email.return_value = True
        client, patches = claim_client(db, 'admin')
        with patches[0], patches[1], patches[2], patch.object(claim_routes, 'EmailService', return_value=email):
            response = client.patch(f'/api/admin/claims/{CLAIM}/status', json={'status': 'collected'})
        self.assertEqual(response.status_code, 200)
        email.send_handover_receipt_email.assert_called_once()

    def test_approval_starts_the_pickup_clock_and_names_the_deadline_in_the_email(self):
        store = claim_store(status='pending')
        db = make_db(store)
        db.update_claim_status.side_effect = lambda claim_id, status, admin_id, reason=None: store['claims'][0].update(status=status) or dict(store['claims'][0])
        email = MagicMock()
        email.send_claim_approved_email.return_value = True
        client, patches = claim_client(db, 'admin')
        with patches[0], patches[1], patches[2], patch.object(claim_routes, 'EmailService', return_value=email):
            response = client.patch(f'/api/admin/claims/{CLAIM}/status', json={'status': 'approved_for_pickup'})
        self.assertEqual(response.status_code, 200)
        deadline = datetime.fromisoformat(store['claims'][0]['pickup_deadline'])
        self.assertAlmostEqual((deadline - datetime.now(timezone.utc)).total_seconds() / 86400, housekeeping.claim_pickup_days(), delta=0.01)
        self.assertTrue(email.send_claim_approved_email.call_args.kwargs['pickup_deadline_text'])

    def test_email_service_builds_the_new_messages(self):
        with patch.object(EmailService, '__init__', lambda self: None):
            service = EmailService()
        service.sg, service.from_email = MagicMock(), 'noreply@umak.edu.ph'
        service.sg.send.return_value = MagicMock(status_code=202)
        url = email_prefs.unsubscribe_url(OWNER, 'reminders')
        self.assertTrue(service.send_handover_receipt_email('a@b.c', 'Maria', 'Umbrella', 'CL-1', 'FP1', 'October 7, 2026'))
        self.assertTrue(service.send_claim_pickup_reminder_email('a@b.c', 'Maria', 'Umbrella', 'CL-1', 7, 'October 21, 2026', unsubscribe_url=url))
        self.assertTrue(service.send_claim_expired_email('a@b.c', 'Maria', 'Umbrella', 'CL-1', 'October 21, 2026'))
        self.assertTrue(service.send_tag_expiry_reminder_email('a@b.c', 'Maria', 'Laptop', 'ABCD', 30, 'November 6, 2026', unsubscribe_url=url))
        messages = [call[0][0].get() for call in service.sg.send.call_args_list]
        reminder, tag = messages[1], messages[3]
        for optional in (reminder, tag):
            self.assertIn('List-Unsubscribe', optional['headers'])
            self.assertEqual(optional['headers']['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
            html = {p['type']: p['value'] for p in optional['content']}
            self.assertIn('Unsubscribe from', html['text/html'])
            self.assertIn(url, html['text/plain'])
        for transactional in (messages[0], messages[2]):   # receipt and expiry notice are always sent: no unsubscribe link
            self.assertNotIn('headers', transactional)


# ----------------------------------------------------------------------------------------------------------- claim pickups
def approved_store(approved_days_ago, deadline_days_from_now=None, **extra):
    store = claim_store(reviewed_at=iso(approved_days_ago * 24), **extra)
    if deadline_days_from_now is not None:
        store['claims'][0]['pickup_deadline'] = (NOW + timedelta(days=deadline_days_from_now)).isoformat()
    store['claims'][0]['pickup_reminder_sent_at'] = extra.get('pickup_reminder_sent_at')
    return store


class ClaimPickupTests(unittest.TestCase):
    def setUp(self):
        self.service = MagicMock()
        patcher = patch('app.utils.housekeeping._email_service', return_value=self.service)
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_job(self, store):
        self.db = make_db(store)
        return housekeeping.process_claim_pickups(self.db, NOW)

    def test_an_older_approved_claim_gets_a_fresh_deadline_instead_of_being_closed(self):
        store = approved_store(40)    # approved long before deadlines existed
        summary = self.run_job(store)
        self.assertEqual((summary['started'], summary['expired']), (1, 0))
        self.assertEqual(store['claims'][0]['status'], 'approved_for_pickup')
        deadline = datetime.fromisoformat(store['claims'][0]['pickup_deadline'])
        self.assertEqual((deadline - NOW).days, housekeeping.claim_pickup_days())
        self.service.send_claim_expired_email.assert_not_called()

    def test_nothing_happens_before_the_reminder_time(self):
        store = approved_store(3, deadline_days_from_now=11)
        summary = self.run_job(store)
        self.assertEqual((summary['reminded'], summary['expired']), (0, 0))
        self.service.send_claim_pickup_reminder_email.assert_not_called()

    def test_a_reminder_is_sent_once_a_week_after_approval(self):
        store = approved_store(8, deadline_days_from_now=6)
        first = self.run_job(store)
        second = housekeeping.process_claim_pickups(self.db, NOW)
        self.assertEqual((first['reminded'], second['reminded']), (1, 0))
        self.service.send_claim_pickup_reminder_email.assert_called_once()
        kwargs = self.service.send_claim_pickup_reminder_email.call_args
        self.assertEqual(kwargs[0][0], 'maria@umak.edu.ph')
        self.assertIn('/api/email/unsubscribe?t=', kwargs[1]['unsubscribe_url'])
        self.assertIn('claim_reminder', [n['type'] for n in store['user_notifications']])
        self.assertEqual(store['claims'][0]['status'], 'approved_for_pickup')

    def test_someone_who_opted_out_of_reminders_still_gets_the_in_app_notice_but_no_email(self):
        store = approved_store(8, deadline_days_from_now=6)
        next(p for p in store['user_profiles'] if p['account_id'] == OWNER)['email_preferences'] = {'reminders': False}
        summary = self.run_job(store)
        self.assertEqual(summary['reminded'], 1)
        self.service.send_claim_pickup_reminder_email.assert_not_called()
        self.assertIn('claim_reminder', [n['type'] for n in store['user_notifications']])

    def test_at_the_deadline_the_claim_closes_and_the_pin_stops_working(self):
        store = approved_store(15, deadline_days_from_now=-1)
        pin = handover.HandoverService(make_db(store)).issue(CLAIM)
        summary = self.run_job(store)
        row = store['claims'][0]
        self.assertEqual(summary['expired'], 1)
        self.assertEqual(row['status'], 'rejected')
        self.assertIn('pickup deadline', row['rejection_reason'])
        self.assertIsNone(row['handover_pin_hash'])
        with self.assertRaises(handover.HandoverError):
            handover.HandoverService(self.db).find(pin)
        self.service.send_claim_expired_email.assert_called_once()
        self.assertIn('claim_update', [n['type'] for n in store['user_notifications']])
        self.assertEqual(store['found_items'][0]['status'], 'unclaimed')   # the item stays in custody for a new claim or an auction
        self.db.log_user_activity.assert_called_once()

    def test_a_claim_collected_a_moment_ago_is_not_closed(self):
        store = approved_store(15, deadline_days_from_now=-1)
        db = make_db(store)
        store['claims'][0]['status'] = 'collected'
        self.assertEqual(housekeeping.process_claim_pickups(db, NOW)['checked'], 0)
        self.assertEqual(store['claims'][0]['status'], 'collected')

    def test_a_race_with_the_guard_wins_for_whoever_updates_first(self):
        store = approved_store(15, deadline_days_from_now=-1)
        db = make_db(store)
        row = dict(store['claims'][0])
        store['claims'][0]['status'] = 'collected'      # the guard released it after the job read the row
        self.assertFalse(housekeeping._expire_claim(db, row, NOW - DAY))
        self.service.send_claim_expired_email.assert_not_called()

    def test_a_database_without_the_new_columns_is_left_alone(self):
        store = approved_store(8, deadline_days_from_now=6)
        db = make_db(store)
        db.client.table = MagicMock(side_effect=Exception('column pickup_reminder_sent_at does not exist'))
        summary = housekeeping.process_claim_pickups(db, NOW)
        self.assertEqual(summary['errors'], 1)
        self.service.send_claim_pickup_reminder_email.assert_not_called()

    def test_settings_are_clamped(self):
        with patch.dict('os.environ', {'CLAIM_PICKUP_DAYS': '1', 'CLAIM_REMINDER_DAYS': '99'}):
            self.assertEqual(housekeeping.claim_pickup_days(), 3)
            self.assertEqual(housekeeping.claim_reminder_days(), 2)
        with patch.dict('os.environ', {'CLAIM_PICKUP_DAYS': 'abc'}):
            self.assertEqual(housekeeping.claim_pickup_days(), 14)


# ----------------------------------------------------------------------------------------------------------- Smart Tag reminders
def tag(**extra):
    row = {'tag_id': 'ABCDEFGHJKLM', 'status': 'active', 'owner_account_id': OWNER, 'item_name': 'Black Dell laptop', 'is_disabled': False,
           'valid_until': (NOW + timedelta(days=20)).isoformat(), 'expiry_reminder_sent_at': None}
    row.update(extra)
    return row


class TagReminderTests(unittest.TestCase):
    def setUp(self):
        self.service = MagicMock()
        patcher = patch('app.utils.housekeeping._email_service', return_value=self.service)
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_job(self, *tags, prefs=None):
        self.store = {'user_profiles': profiles(), 'smart_tags': list(tags)}
        if prefs is not None:
            next(p for p in self.store['user_profiles'] if p['account_id'] == OWNER)['email_preferences'] = prefs
        self.db = make_db(self.store)
        return housekeeping.process_tag_expiry_reminders(self.db, NOW)

    def test_a_tag_expiring_within_thirty_days_gets_one_reminder(self):
        first = self.run_job(tag())
        second = housekeeping.process_tag_expiry_reminders(self.db, NOW)
        self.assertEqual((first['reminded'], second['reminded']), (1, 0))
        self.service.send_tag_expiry_reminder_email.assert_called_once()
        args = self.service.send_tag_expiry_reminder_email.call_args[0]
        self.assertEqual((args[0], args[2], args[4]), ('maria@umak.edu.ph', 'Black Dell laptop', 20))
        self.assertIn('smart_tag_expiring', [n['type'] for n in self.store['user_notifications']])

    def test_tags_outside_the_window_or_not_eligible_are_skipped(self):
        skipped = [
            tag(tag_id='AAAAAAAAAAAA', valid_until=(NOW + timedelta(days=40)).isoformat()),
            tag(tag_id='BBBBBBBBBBBB', valid_until=(NOW - DAY).isoformat(), status='expired'),
            tag(tag_id='CCCCCCCCCCCC', status='pending_verification'),
            tag(tag_id='DDDDDDDDDDDD', is_disabled=True),
            tag(tag_id='EEEEEEEEEEEE', expiry_reminder_sent_at=iso(48)),
            tag(tag_id='FFFFFFFFFFFF', valid_until=None),
        ]
        self.assertEqual(self.run_job(*skipped)['reminded'], 0)
        self.service.send_tag_expiry_reminder_email.assert_not_called()

    def test_opting_out_of_reminders_stops_the_email_but_not_the_in_app_notice(self):
        self.assertEqual(self.run_job(tag(), prefs={'reminders': False})['reminded'], 1)
        self.service.send_tag_expiry_reminder_email.assert_not_called()
        self.assertIn('smart_tag_expiring', [n['type'] for n in self.store['user_notifications']])

    def test_renewing_a_tag_allows_a_new_reminder_later(self):
        from test_smart_tags import make_service, tag_row
        service, _, store = make_service([tag_row(expiry_reminder_sent_at=iso(48), valid_until=iso(-24))])
        service.renew(tag_row()['tag_id'], 12, ADMIN_ID)
        self.assertIsNone(store['smart_tags'][0]['expiry_reminder_sent_at'])

    def test_a_database_without_the_reminder_column_does_not_break_renewal(self):
        from test_smart_tags import make_service, tag_row
        service, _, store = make_service([tag_row(valid_until=iso(-24))])
        original = service._table
        calls = []

        class Picky:
            def __init__(self, table):
                self.table = table

            def update(self, payload):
                if 'expiry_reminder_sent_at' in payload:
                    raise Exception('column expiry_reminder_sent_at does not exist')
                calls.append(payload)
                return self.table.update(payload)

            def __getattr__(self, name):
                return getattr(self.table, name)
        service._table = lambda: Picky(original())
        row = service.renew(tag_row()['tag_id'], 12, ADMIN_ID)
        self.assertTrue(row['valid_until'])


# ----------------------------------------------------------------------------------------------------------- evidence retention
class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.store = {
            'user_profiles': profiles(),
            'claims': [
                {'claim_id': 'old-collected', 'status': 'collected', 'collected_at': iso(45 * 24), 'updated_at': iso(45 * 24), 'proof_image_path': 'p/1.jpg',
                 'identity_document_path': 'i/1.pdf', 'identity_document_name': 'x', 'evidence_purged_at': None},
                {'claim_id': 'old-rejected', 'status': 'rejected', 'reviewed_at': iso(60 * 24), 'updated_at': iso(60 * 24), 'proof_image_path': 'p/2.jpg',
                 'identity_document_path': None, 'evidence_purged_at': None},
                {'claim_id': 'recent', 'status': 'collected', 'collected_at': iso(10 * 24), 'updated_at': iso(10 * 24), 'proof_image_path': 'p/3.jpg',
                 'identity_document_path': 'i/3.pdf', 'evidence_purged_at': None},
                {'claim_id': 'open', 'status': 'approved_for_pickup', 'updated_at': iso(90 * 24), 'proof_image_path': 'p/4.jpg',
                 'identity_document_path': 'i/4.pdf', 'evidence_purged_at': None},
                {'claim_id': 'no-files', 'status': 'rejected', 'reviewed_at': iso(90 * 24), 'updated_at': iso(90 * 24), 'proof_image_path': None,
                 'identity_document_path': None, 'evidence_purged_at': None},
                {'claim_id': 'done', 'status': 'collected', 'collected_at': iso(90 * 24), 'updated_at': iso(90 * 24), 'proof_image_path': None,
                 'identity_document_path': None, 'evidence_purged_at': iso(30 * 24)},
            ],
        }
        self.removed = []
        self.db = make_db(self.store)
        self.db._legacy_claim_storage_path = lambda value, bucket: None
        storage = MagicMock()
        storage.from_.side_effect = lambda bucket: MagicMock(remove=lambda paths, b=bucket: self.removed.append((b, tuple(paths))))
        self.db.client.storage = storage

    def claim(self, claim_id):
        return next(c for c in self.store['claims'] if c['claim_id'] == claim_id)

    def test_files_of_old_closed_claims_are_deleted_and_their_paths_cleared(self):
        summary = housekeeping.purge_old_evidence(self.db, NOW, days=30)
        self.assertEqual(summary['claims'], 3)   # old-collected, old-rejected, and the one with no files (marked so it stops being re-read)
        self.assertEqual(sorted(self.removed), [('claim-id-documents', ('i/1.pdf',)), ('claim-proof-images', ('p/1.jpg',)), ('claim-proof-images', ('p/2.jpg',))])
        gone = self.claim('old-collected')
        self.assertEqual((gone['proof_image_path'], gone['identity_document_path'], gone['identity_document_name']), (None, None, None))
        self.assertTrue(gone['evidence_purged_at'])
        self.assertTrue(self.claim('no-files')['evidence_purged_at'])

    def test_recent_open_and_already_purged_claims_are_left_alone(self):
        housekeeping.purge_old_evidence(self.db, NOW, days=30)
        self.assertEqual(self.claim('recent')['proof_image_path'], 'p/3.jpg')
        self.assertEqual(self.claim('open')['identity_document_path'], 'i/4.pdf')
        self.assertEqual(self.claim('done')['evidence_purged_at'], iso(30 * 24))
        self.assertNotIn(('claim-proof-images', ('p/3.jpg',)), self.removed)

    def test_running_twice_deletes_nothing_more(self):
        housekeeping.purge_old_evidence(self.db, NOW, days=30)
        before = len(self.removed)
        self.assertEqual(housekeeping.purge_old_evidence(self.db, NOW, days=30)['claims'], 0)
        self.assertEqual(len(self.removed), before)

    def test_a_longer_retention_keeps_the_files(self):
        self.assertEqual(housekeeping.purge_old_evidence(self.db, NOW, days=50)['claims'], 2)   # only the 60 and 90 day old cases
        self.assertEqual(self.claim('old-collected')['proof_image_path'], 'p/1.jpg')

    def test_nothing_is_deleted_before_the_migration_has_been_run(self):
        owner = next(p for p in self.store['user_profiles'] if p['account_id'] == OWNER)
        owner.update(verification_status='verified', verification_reviewed_at=iso(40 * 24), verification_document_url='v/owner.pdf',
                     verification_document_name='id.pdf', verification_document_bucket='verification-documents')
        with patch.object(housekeeping, '_retention_ready', return_value=False):
            summary = housekeeping.purge_old_evidence(self.db, NOW, days=30)
        self.assertTrue(summary['waiting_for_migration'])
        self.assertEqual(self.removed, [])
        self.assertEqual(owner['verification_document_url'], 'v/owner.pdf')
        self.assertEqual(self.claim('old-collected')['proof_image_path'], 'p/1.jpg')

    def test_readiness_check_reports_a_missing_column(self):
        ok = MagicMock()
        self.assertTrue(housekeeping._retention_ready(ok))
        broken = MagicMock()
        broken.client.table.side_effect = Exception('column claims.evidence_purged_at does not exist')
        self.assertFalse(housekeeping._retention_ready(broken))

    def test_zero_days_switches_deletion_off(self):
        summary = housekeeping.purge_old_evidence(self.db, NOW, days=0)
        self.assertTrue(summary['disabled'])
        self.assertEqual(self.removed, [])
        with patch.dict('os.environ', {'EVIDENCE_RETENTION_DAYS': '0'}):
            self.assertEqual(housekeeping.retention_days(), 0)
        with patch.dict('os.environ', {'EVIDENCE_RETENTION_DAYS': '2'}):
            self.assertEqual(housekeeping.retention_days(), 7)

    def test_a_storage_failure_keeps_the_record_so_it_is_retried(self):
        self.db.client.storage.from_.side_effect = lambda bucket: MagicMock(remove=MagicMock(side_effect=RuntimeError('storage down')))
        summary = housekeeping.purge_old_evidence(self.db, NOW, days=30)
        self.assertGreaterEqual(summary['errors'], 1)
        self.assertEqual(self.claim('old-collected')['proof_image_path'], 'p/1.jpg')
        self.assertIsNone(self.claim('old-collected')['evidence_purged_at'])

    def test_verification_documents_go_after_review_but_pending_ones_stay(self):
        owner = next(p for p in self.store['user_profiles'] if p['account_id'] == OWNER)
        owner.update(verification_status='verified', verification_reviewed_at=iso(40 * 24), verification_document_url='v/owner.pdf',
                     verification_document_name='id.pdf', verification_document_bucket='verification-documents')
        winner = next(p for p in self.store['user_profiles'] if p['account_id'] == WINNER)
        winner.update(verification_status='pending', verification_reviewed_at=None, verification_document_url='v/winner.pdf',
                      verification_document_name='id.pdf', verification_document_bucket='verification-documents')
        summary = housekeeping.purge_old_evidence(self.db, NOW, days=30)
        self.assertEqual(summary['verifications'], 1)
        self.assertIn(('verification-documents', ('v/owner.pdf',)), self.removed)
        self.assertEqual((owner['verification_document_url'], owner['verification_document_bucket']), (None, None))
        self.assertEqual(owner['verification_status'], 'verified')
        self.assertEqual(winner['verification_document_url'], 'v/winner.pdf')


# ----------------------------------------------------------------------------------------------------------- email preferences
class EmailPrefsTests(unittest.TestCase):
    def test_defaults_and_overrides(self):
        self.assertEqual(email_prefs.get_prefs(None), {'reminders': True, 'announcements': True})
        self.assertEqual(email_prefs.get_prefs({'email_preferences': {'reminders': False}}), {'reminders': False, 'announcements': True})
        self.assertEqual(email_prefs.get_prefs({'email_preferences': 'garbage'}), {'reminders': True, 'announcements': True})
        self.assertFalse(email_prefs.allows({'email_preferences': {'announcements': False}}, 'announcements'))
        self.assertEqual(email_prefs.clean_update({'reminders': False, 'announcements': 'no', 'other': True}), {'reminders': False})

    def test_tokens_cannot_be_forged_or_reused_for_another_category(self):
        token = email_prefs.make_token(OWNER, 'reminders')
        self.assertEqual(email_prefs.read_token(token), (OWNER, 'reminders'))
        body, signature = token.split('.')
        self.assertIsNone(email_prefs.read_token(f'{body}.{"0" * len(signature)}'))
        self.assertIsNone(email_prefs.read_token(email_prefs.make_token(OWNER, 'reminders').replace(body[:3], 'AAA', 1)))
        self.assertIsNone(email_prefs.read_token('nonsense'))
        self.assertIsNone(email_prefs.read_token(None))
        self.assertIsNone(email_prefs.read_token(email_prefs.make_token(OWNER, 'billing')))

    def test_the_link_uses_the_public_api_address(self):
        with patch.dict('os.environ', {'PUBLIC_API_URL': 'https://api.example/'}):
            self.assertTrue(email_prefs.unsubscribe_url(OWNER, 'reminders').startswith('https://api.example/api/email/unsubscribe?t='))


class PrefsRouteTests(unittest.TestCase):
    def setUp(self):
        self.store = {'user_profiles': profiles()}
        self.db = make_db(self.store)
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
        app.register_blueprint(prefs_routes.email_prefs_bp, url_prefix='/api/email')
        self.client = app.test_client()
        for p in (patch.object(prefs_routes, '_db', return_value=self.db), patch.object(prefs_routes, '_account_id', return_value=OWNER)):
            p.start()
        self.addCleanup(patch.stopall)

    def owner(self):
        return next(p for p in self.store['user_profiles'] if p['account_id'] == OWNER)

    def test_the_user_reads_and_saves_their_choices(self):
        self.assertEqual(self.client.get('/api/email/preferences').get_json()['preferences'], {'reminders': True, 'announcements': True})
        saved = self.client.put('/api/email/preferences', json={'reminders': False})
        self.assertEqual((saved.status_code, saved.get_json()['preferences']), (200, {'reminders': False, 'announcements': True}))
        self.assertEqual(self.owner()['email_preferences'], {'reminders': False, 'announcements': True})
        later = self.client.put('/api/email/preferences', json={'announcements': False})
        self.assertEqual(later.get_json()['preferences'], {'reminders': False, 'announcements': False})

    def test_bad_input_is_refused(self):
        self.assertEqual(self.client.put('/api/email/preferences', json={'reminders': 'off'}).status_code, 400)
        self.assertEqual(self.client.put('/api/email/preferences', json={}).status_code, 400)

    def test_saving_before_the_migration_explains_what_to_do(self):
        with patch.object(prefs_routes, '_read_prefs_row', return_value=(None, False)):
            read = self.client.get('/api/email/preferences').get_json()
            saved = self.client.put('/api/email/preferences', json={'reminders': False})
        self.assertFalse(read['available'])
        self.assertEqual(saved.status_code, 503)

    def test_the_unsubscribe_page_only_asks_until_the_button_is_pressed(self):
        token = email_prefs.make_token(OWNER, 'reminders')
        page = self.client.get(f'/api/email/unsubscribe?t={token}')
        self.assertEqual(page.status_code, 200)
        self.assertIn('Unsubscribe', page.get_data(as_text=True))
        self.assertNotIn('email_preferences', self.owner())            # opening the link (or a mail scanner doing so) changes nothing
        done = self.client.post(f'/api/email/unsubscribe?t={token}')
        self.assertEqual(done.status_code, 200)
        self.assertEqual(self.owner()['email_preferences'], {'reminders': False, 'announcements': True})
        self.assertEqual(page.headers['Cache-Control'], 'no-store')

    def test_a_mail_apps_one_click_post_works_and_keeps_the_other_choice(self):
        self.owner()['email_preferences'] = {'announcements': False}
        token = email_prefs.make_token(OWNER, 'reminders')
        response = self.client.post(f'/api/email/unsubscribe?t={token}', data={'List-Unsubscribe': 'One-Click'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.owner()['email_preferences'], {'reminders': False, 'announcements': False})

    def test_a_bad_link_is_refused(self):
        self.assertEqual(self.client.get('/api/email/unsubscribe?t=broken').status_code, 400)
        self.assertEqual(self.client.post('/api/email/unsubscribe').status_code, 400)

    def test_the_unsubscribe_link_works_without_signing_in_and_during_maintenance(self):
        self.assertIn('/api/email/unsubscribe', system_control.PUBLIC_PATHS)


class BroadcastPreferenceTests(unittest.TestCase):
    def test_a_campus_wide_email_skips_people_who_opted_out_and_carries_an_unsubscribe_link(self):
        users = [person('a0', 'Yes0'), person('a1', 'Yes1'), person('a2', 'No2')]
        users[2]['email_preferences'] = {'announcements': False}
        db = fake_db(tables={'user_profiles': users, 'user_notifications': []})
        with patch('config.Config.SENDGRID_API_KEY', 'key'), patch.object(mission.threading, 'Thread') as thread:
            result = mission.send_message(db, 'all', None, 'Notice', 'Everyone please read', True, False)
        sent_to = thread.call_args.kwargs['args'][0]
        self.assertEqual((result['email_queued'], result['email_opted_out']), (2, 1))
        self.assertEqual(sorted(r['account_id'] for r in sent_to), ['a0', 'a1'])
        self.assertTrue(thread.call_args.kwargs['args'][3])

    def test_the_broadcast_sender_adds_the_unsubscribe_link_but_a_direct_message_does_not(self):
        service = MagicMock()
        service.send_announcement_email.return_value = True
        people = [{'account_id': OWNER, 'email': 'maria@umak.edu.ph', 'fname': 'Maria'}]
        with patch('app.utils.email_service.EmailService', return_value=service):
            mission._send_emails(people, 'S', 'Body', broadcast=True)
            mission._send_emails(people, 'S', 'Body')
        broadcast, direct = service.send_announcement_email.call_args_list
        self.assertIn('/api/email/unsubscribe?t=', broadcast.kwargs['unsubscribe_url'])
        self.assertEqual(direct.args, ('maria@umak.edu.ph', 'Maria', 'S', 'Body'))
        self.assertEqual(direct.kwargs, {})


# ----------------------------------------------------------------------------------------------------------- analytics ranges
class AnalyticsRangeTests(unittest.TestCase):
    TODAY = date(2026, 10, 7)

    def test_presets_and_custom_ranges(self):
        self.assertEqual(analytics.resolve_range('30d', today=self.TODAY), (date(2026, 9, 8), self.TODAY, '30d'))
        self.assertEqual(analytics.resolve_range('all', today=self.TODAY), (None, self.TODAY, 'all'))
        self.assertEqual(analytics.resolve_range(None, today=self.TODAY)[2], '12m')
        self.assertEqual(analytics.resolve_range('weird', today=self.TODAY)[2], '12m')
        self.assertEqual(analytics.resolve_range(None, '2026-09-01', '2026-09-30', self.TODAY), (date(2026, 9, 1), date(2026, 9, 30), 'custom'))
        self.assertEqual(analytics.resolve_range(None, '2026-09-01', None, self.TODAY), (date(2026, 9, 1), self.TODAY, 'custom'))

    def test_bad_ranges_are_refused(self):
        for args in (('x', 'nope', None), (None, '2026-10-05', '2026-10-01'), (None, '2000-01-01', '2026-10-01')):
            with self.assertRaises(analytics.RangeError):
                analytics.resolve_range(*args, today=self.TODAY)

    def rows(self):
        return [
            {'category': 'Electronics', 'last_seen_date': '2026-10-05', 'last_location': 'Library '},
            {'category': 'Electronics', 'last_seen_date': '2026-09-20', 'last_location': 'library'},
            {'category': 'Bags', 'last_seen_date': '2026-08-01', 'last_location': 'Canteen'},
            {'category': 'Keys', 'last_seen_date': '2025-01-01', 'last_location': 'Gym'},
        ]

    def test_the_range_limits_every_figure(self):
        everything = analytics.build_visual_analytics(self.rows(), {}, self.TODAY)
        recent = analytics.build_visual_analytics(self.rows(), {}, self.TODAY, start=date(2026, 9, 8), end=self.TODAY)
        self.assertEqual((everything['lost_total'], recent['lost_total']), (4, 2))
        self.assertEqual(recent['lost_categories'], [{'name': 'Electronics', 'value': 2}])
        self.assertEqual([m['key'] for m in recent['lost_by_month']], ['2026-09', '2026-10'])
        self.assertEqual(sum(m['count'] for m in recent['lost_by_month']), 2)

    def test_hotspots_merge_spellings_and_count_lost_and_found(self):
        found = [{'location': 'Library'}, {'location': 'Canteen'}, {'location': 'Canteen'}, {'location': ''}]
        result = analytics.build_visual_analytics(self.rows(), {}, self.TODAY, found_rows=found)
        spots = {s['location'].lower(): s for s in result['hotspots']}
        self.assertEqual((spots['library']['lost'], spots['library']['found'], spots['library']['total']), (2, 1, 3))
        self.assertEqual((spots['canteen']['lost'], spots['canteen']['found']), (1, 2))
        self.assertEqual(result['hotspots'][0]['total'], 3)
        self.assertEqual(len(analytics.build_visual_analytics([{'last_location': f'P{i}', 'category': 'x'} for i in range(20)], {}, self.TODAY)['hotspots']), analytics.TOP_LOCATIONS)

    def test_a_long_range_shows_at_most_two_years_of_months(self):
        result = analytics.build_visual_analytics([], {}, self.TODAY, start=date(2018, 1, 1), end=self.TODAY)
        self.assertEqual(len(result['lost_by_month']), analytics.MONTHS_MAX)

    def test_the_collector_applies_the_range_to_lost_reports_and_found_items(self):
        today = datetime.now(timezone.utc).date()
        store = {
            'missing_items': [{'category': 'Keys', 'last_seen_date': today.isoformat(), 'last_location': 'Library'},
                              {'category': 'Bags', 'last_seen_date': (today - timedelta(days=200)).isoformat(), 'last_location': 'Gym'}],
            'found_items': [{'status': 'returned', 'created_at': today.isoformat(), 'location': 'Library'},
                            {'status': 'unclaimed', 'created_at': (today - timedelta(days=200)).isoformat(), 'location': 'Gym'}],
        }
        month = analytics.collect_visual_analytics(make_db(store), '30d')
        everything = analytics.collect_visual_analytics(make_db(store), 'all')
        self.assertEqual((month['lost_total'], month['outcomes']['total_found']), (1, 1))
        self.assertEqual((everything['lost_total'], everything['outcomes']['total_found']), (2, 2))
        self.assertEqual(month['range']['key'], '30d')
        self.assertEqual(everything['range']['start'], None)
        self.assertEqual([s['location'] for s in month['hotspots']], ['Library'])


class AnalyticsRouteTests(unittest.TestCase):
    def client(self):
        from Admin.Backend.dashboard import routes as dashboard_routes
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
        app.register_blueprint(dashboard_routes.dashboard_bp, url_prefix='/api/admin')
        self.store = {'missing_items': [], 'found_items': []}
        patches = (patch.object(dashboard_routes, '_require_admin', return_value={'account_id': ADMIN_ID}),
                   patch.object(dashboard_routes, 'get_db', return_value=make_db(self.store)))
        for p in patches:
            p.start()
        self.addCleanup(patch.stopall)
        return app.test_client()

    def test_the_route_passes_the_range_and_rejects_nonsense(self):
        client = self.client()
        ok = client.get('/api/admin/dashboard/analytics?range=90d')
        custom = client.get('/api/admin/dashboard/analytics?start=2026-09-01&end=2026-09-30')
        backwards = client.get('/api/admin/dashboard/analytics?start=2026-10-05&end=2026-10-01')
        garbage = client.get('/api/admin/dashboard/analytics?start=banana')
        self.assertEqual((ok.status_code, ok.get_json()['range']['key']), (200, '90d'))
        self.assertEqual(custom.get_json()['range'], {'key': 'custom', 'start': '2026-09-01', 'end': '2026-09-30'})
        self.assertEqual((backwards.status_code, garbage.status_code), (400, 400))


# ----------------------------------------------------------------------------------------------------------- auctions ready to list
class ReadyToAuctionTests(unittest.TestCase):
    def test_the_dashboard_gets_only_a_count(self):
        from Admin.Backend.auctions import routes as auction_routes
        app = Flask(__name__)
        app.register_blueprint(auction_routes.auctions_bp, url_prefix='/api/admin')
        service = MagicMock()
        service.eligible_items.return_value = {'items': [{'days_in_custody': 41}, {'days_in_custody': 33}], 'min_custody_days': 30}
        with patch.object(auction_routes, '_require_admin', return_value={'account_id': ADMIN_ID}), patch.object(auction_routes, '_service', return_value=(MagicMock(), service)):
            client = app.test_client()
            summary = client.get('/api/admin/auctions/eligible-items?summary=1')
            full = client.get('/api/admin/auctions/eligible-items')
        self.assertEqual(summary.get_json(), {'count': 2, 'oldest_days': 41, 'min_custody_days': 30})
        self.assertEqual(len(full.get_json()['items']), 2)


if __name__ == '__main__':
    unittest.main()
