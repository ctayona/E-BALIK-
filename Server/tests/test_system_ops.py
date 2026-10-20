"""System control extras: scheduled maintenance windows, role-based session wipe, staff account health, email health, audit CSV export."""
import json
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from flask import Flask, jsonify

from app.utils import email_service, system_control as control, system_ops

NOW = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)


def iso(moment):
    return moment.isoformat()


def settings(**extra):
    base = {key: dict(value) for key, value in control.DEFAULT_SETTINGS.items()}
    base.update(extra)
    return base


class Table:
    """Just enough of the Supabase query builder for these tests."""
    def __init__(self, store, name):
        self.store, self.name, self.filters, self.window = store, name, [], None

    def select(self, *_a, **_k):
        return self

    def eq(self, key, value):
        self.filters.append(lambda r: str(r.get(key)) == str(value)); return self

    def in_(self, key, values):
        self.filters.append(lambda r: r.get(key) in values); return self

    def gte(self, key, value):
        self.filters.append(lambda r: str(r.get(key)) >= str(value)); return self

    def lt(self, key, value):
        self.filters.append(lambda r: str(r.get(key)) < str(value)); return self

    def order(self, *_a, **_k):
        return self

    def limit(self, _n):
        return self

    def range(self, start, end):
        self.window = (start, end); return self

    def execute(self):
        if self.name in self.store.get('missing', ()):
            raise Exception(f'relation "{self.name}" does not exist')
        rows = [r for r in self.store.get(self.name, []) if all(f(r) for f in self.filters)]
        if self.window:
            rows = rows[self.window[0]:self.window[1] + 1]
        return SimpleNamespace(data=rows, count=len(rows))


def make_db(store):
    return SimpleNamespace(client=SimpleNamespace(table=lambda name: Table(store, name)))


class WindowTests(unittest.TestCase):
    def saved(self):
        calls = []
        return calls, patch.object(control, 'save_setting', side_effect=lambda db, key, value, actor: calls.append((key, value)))

    def test_a_running_window_locks_the_app_and_an_upcoming_one_shows_a_banner(self):
        running = {'id': 'a', 'start': iso(NOW - timedelta(minutes=10)), 'end': iso(NOW + timedelta(hours=1)), 'message': 'Upgrading the database'}
        soon = {'id': 'b', 'start': iso(NOW + timedelta(hours=20)), 'end': iso(NOW + timedelta(hours=22)), 'message': ''}
        self.assertEqual(control.effective_maintenance(settings(maintenance_windows={'items': [running]}), NOW)[:2], (True, 'Upgrading the database'))
        rules = settings(maintenance_windows={'items': [soon]})
        self.assertFalse(control.effective_maintenance(rules, NOW)[0])
        notice = control.upcoming_notice(rules, NOW)
        self.assertEqual((notice['tone'], notice['title']), ('warning', 'Scheduled maintenance'))
        self.assertIn('Manila time', notice['message'])
        far = settings(maintenance_windows={'items': [{**soon, 'start': iso(NOW + timedelta(days=5)), 'end': iso(NOW + timedelta(days=5, hours=2))}]})
        self.assertIsNone(control.upcoming_notice(far, NOW))

    def test_the_manual_switch_still_wins_and_a_finished_window_does_nothing(self):
        done = {'id': 'c', 'start': iso(NOW - timedelta(hours=3)), 'end': iso(NOW - timedelta(hours=1)), 'message': ''}
        self.assertFalse(control.effective_maintenance(settings(maintenance_windows={'items': [done]}), NOW)[0])
        manual = settings(maintenance_mode={'enabled': True, 'message': 'By hand', 'since': iso(NOW)})
        self.assertEqual(control.effective_maintenance(manual, NOW)[:2], (True, 'By hand'))

    def test_scheduling_rules(self):
        calls, saver = self.saved()
        db = MagicMock()
        start = datetime.now(timezone.utc) + timedelta(days=1)
        with saver, patch.object(control, 'load_settings', return_value=settings()):
            window = control.add_window(db, iso(start), iso(start + timedelta(hours=2)), '<b>Back by 11</b>', 'a1')
        self.assertEqual(window['message'], 'bBack by 11/b')
        self.assertEqual(calls[0][0], 'maintenance_windows')
        bad = [
            (iso(start - timedelta(days=3)), iso(start)),                    # in the past
            (iso(start), iso(start - timedelta(hours=1))),                   # ends before it starts
            (iso(start), iso(start + timedelta(hours=73))),                  # too long
            ('', ''),                                                        # missing
        ]
        for first, last in bad:
            with saver, patch.object(control, 'load_settings', return_value=settings()), self.assertRaises(ValueError):
                control.add_window(db, first, last, '', 'a1')
        existing = {'id': 'x', 'start': iso(start), 'end': iso(start + timedelta(hours=3)), 'message': ''}
        with saver, patch.object(control, 'load_settings', return_value=settings(maintenance_windows={'items': [existing]})), self.assertRaises(ValueError):
            control.add_window(db, iso(start + timedelta(hours=1)), iso(start + timedelta(hours=4)), '', 'a1')

    def test_cancelling_removes_only_that_window(self):
        calls, saver = self.saved()
        items = [{'id': 'a', 'start': iso(NOW), 'end': iso(NOW + timedelta(hours=1)), 'message': ''}, {'id': 'b', 'start': iso(NOW + timedelta(days=1)), 'end': iso(NOW + timedelta(days=1, hours=1)), 'message': ''}]
        with saver, patch.object(control, 'load_settings', return_value=settings(maintenance_windows={'items': items})):
            control.remove_window(MagicMock(), 'a', 'a1')
            with self.assertRaises(ValueError):
                control.remove_window(MagicMock(), 'zzz', 'a1')
        self.assertEqual([w['id'] for w in calls[0][1]['items']], ['b'])

    def test_public_status_reports_a_running_window(self):
        running = {'id': 'a', 'start': iso(datetime.now(timezone.utc) - timedelta(minutes=5)), 'end': iso(datetime.now(timezone.utc) + timedelta(hours=1)), 'message': 'Upgrading'}
        with patch.object(control, 'load_settings', return_value=settings(maintenance_windows={'items': [running]})):
            status = control.public_status(MagicMock())
        self.assertEqual((status['maintenance'], status['message']), (True, 'Upgrading'))


class RoleWipeTests(unittest.TestCase):
    def app(self, level, wipes, iat):
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
        app.before_request(control.enforce_request)
        app.add_url_rule('/api/ping', 'ping', lambda: jsonify({'ok': True}))
        state = {'level': level, 'is_active': True, 'verification_status': 'verified', 'suspended_until': None, 'suspension_reason': None}
        patches = [patch.object(control, 'load_settings', return_value=settings(role_session_wipes=wipes)), patch('app.utils.get_db', return_value=MagicMock()),
                   patch.object(control, 'account_state', return_value=state), patch.object(control, '_token_payload', return_value={'account_id': 'u1', 'iat': iat})]
        return app, patches

    def run_request(self, level, wipes, iat):
        app, patches = self.app(level, wipes, iat)
        for p in patches:
            p.start()
        try:
            return app.test_client().get('/api/ping')
        finally:
            patch.stopall()

    def test_only_the_wiped_role_is_signed_out(self):
        wipe = {'guard': {'ts': iso(NOW), 'by': 'a1'}}
        old = (NOW - timedelta(hours=1)).timestamp()
        self.assertEqual(self.run_request('guard', wipe, old).status_code, 401)
        self.assertEqual(self.run_request('user', wipe, old).status_code, 200)
        self.assertEqual(self.run_request('admin', wipe, old).status_code, 200)

    def test_a_session_started_after_the_wipe_survives(self):
        wipe = {'admin': {'ts': iso(NOW), 'by': 'a1'}}
        self.assertEqual(self.run_request('admin', wipe, (NOW + timedelta(minutes=1)).timestamp()).status_code, 200)
        self.assertEqual(self.run_request('admin', wipe, (NOW - timedelta(minutes=1)).timestamp()).status_code, 401)

    def test_super_admins_are_never_signed_out(self):
        wipe = {role: {'ts': iso(NOW), 'by': 'a1'} for role in ('user', 'guard', 'admin')}
        self.assertEqual(self.run_request('super_admin', wipe, (NOW - timedelta(hours=5)).timestamp()).status_code, 200)

    def test_wiping_validates_the_roles(self):
        calls = []
        with patch.object(control, 'save_setting', side_effect=lambda db, key, value, actor: calls.append(value)), patch.object(control, 'load_settings', return_value=settings()):
            stamp, roles = control.wipe_sessions(MagicMock(), ['admin', 'user'], 'a1')
            self.assertEqual(roles, ['user', 'admin'])
            self.assertEqual(set(calls[0]), {'user', 'admin'})
            for bad in ([], ['super_admin'], 'user', ['user', 5]):
                with self.assertRaises(ValueError):
                    control.wipe_sessions(MagicMock(), bad, 'a1')


class AdminHealthTests(unittest.TestCase):
    def test_flags_and_ordering(self):
        recent = iso(NOW - timedelta(days=2))
        store = {
            'user_profiles': [
                {'account_id': 's1', 'fname': 'Sam', 'lname': 'Super', 'email': 's@umak.edu.ph', 'access_level': 'super_admin', 'is_active': True, 'last_login_at': recent, 'failed_login_attempts': 0},
                {'account_id': 'a1', 'fname': 'Ana', 'lname': 'Admin', 'email': 'a@umak.edu.ph', 'access_level': 'admin', 'is_active': True, 'last_login_at': iso(NOW - timedelta(days=60)), 'failed_login_attempts': 4},
                {'account_id': 'g1', 'fname': 'Gus', 'lname': 'Guard', 'email': 'g@umak.edu.ph', 'access_level': 'guard', 'is_active': True, 'last_login_at': None, 'failed_login_attempts': 0},
                {'account_id': 'a2', 'fname': 'Old', 'lname': 'Admin', 'email': 'o@umak.edu.ph', 'access_level': 'admin', 'is_active': True, 'last_login_at': iso(NOW - timedelta(days=200)), 'failed_login_attempts': 0, 'locked_until': iso(NOW + timedelta(minutes=5))},
            ],
            'admin_mfa': [{'account_id': 'a2', 'enabled_at': recent}],
        }
        report = system_ops.admin_health(make_db(store), NOW)
        by_id = {a['account_id']: a for a in report['accounts']}
        self.assertEqual(by_id['s1']['status'], 'fail')                      # a super admin without an authenticator
        self.assertEqual({f['code'] for f in by_id['a1']['flags']}, {'no_mfa', 'failed_logins', 'dormant'})
        self.assertEqual(by_id['g1']['flags'][0]['code'], 'never_signed_in')
        self.assertIsNone(by_id['g1']['mfa'])                                 # guards have no authenticator
        self.assertTrue(by_id['a2']['locked'])
        self.assertEqual(by_id['a2']['status'], 'fail')                       # dormant for 200 days
        self.assertEqual(report['status'], 'fail')
        self.assertEqual(report['accounts'][0]['status'], 'fail')             # worst first
        self.assertEqual((report['summary']['total'], report['summary']['without_mfa']), (4, 2))

    def test_a_missing_mfa_table_does_not_flag_everyone(self):
        store = {'user_profiles': [{'account_id': 's1', 'fname': 'S', 'lname': 'S', 'access_level': 'super_admin', 'is_active': True, 'last_login_at': iso(NOW)}], 'missing': ('admin_mfa',)}
        report = system_ops.admin_health(make_db(store), NOW)
        self.assertFalse(report['summary']['mfa_available'])
        self.assertEqual(report['accounts'][0]['flags'], [])


class EmailHealthTests(unittest.TestCase):
    def test_not_configured(self):
        with patch.multiple('config.Config', BREVO_API_KEY=None, SENDGRID_API_KEY=None):
            result = system_ops.email_health(live=False)
        self.assertEqual((result['configured'], result['status']), (False, 'fail'))

    def test_a_working_provider_and_a_recent_failure(self):
        clean = {'sent': 0, 'failed': 0, 'last_ok_at': None, 'last_fail_at': None, 'last_error': ''}   # other tests also send (and fail) emails
        with patch.multiple('config.Config', BREVO_API_KEY='k', BREVO_FROM_EMAIL='office@umak.test'), patch.object(email_service, 'check_provider', return_value={'ok': True, 'status_code': 200, 'detail': 'Brevo accepted the key.', 'plan': 'free'}), patch.dict(email_service.STATS, clean):
            self.assertEqual(system_ops.email_health()['status'], 'ok')
            with patch.dict(email_service.STATS, {'last_ok_at': iso(NOW), 'last_fail_at': iso(NOW + timedelta(minutes=1)), 'last_error': 'boom'}):
                warn = system_ops.email_health()
        self.assertEqual(warn['status'], 'warn')
        self.assertIn('boom', warn['detail'])

    def test_a_rejected_key_is_a_failure(self):
        with patch.multiple('config.Config', BREVO_API_KEY='k', BREVO_FROM_EMAIL='office@umak.test'), patch.object(email_service, 'check_provider', return_value={'ok': False, 'status_code': 401, 'detail': 'The provider rejected the key (401).', 'plan': None}):
            result = system_ops.email_health()
        self.assertEqual((result['status'], result['live']['status_code']), ('fail', 401))

    def test_the_live_check_never_sends_mail(self):
        class Reply:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return json.dumps({'plan': [{'type': 'free', 'credits': 280, 'creditsType': 'sendLimit'}]}).encode()
        with patch.multiple('config.Config', BREVO_API_KEY='k'), patch('urllib.request.urlopen', return_value=Reply()) as opened:
            result = email_service.check_provider()
        self.assertTrue(result['ok'])
        self.assertIn('280', result['plan'])
        self.assertEqual(opened.call_args.args[0].full_url, 'https://api.brevo.com/v3/account')
        self.assertIsNone(opened.call_args.args[0].data)


class AuditExportTests(unittest.TestCase):
    def test_csv_columns_range_and_formula_safety(self):
        store = {'user_activity_logs': [
            {'created_at': '2026-10-19T16:30:00+00:00', 'user_name': '=HYPERLINK("http://x")', 'account_id': 'a1', 'module_name': 'Users', 'action': 'Update Role Access', 'target_name': 'rbac', 'target_id': 'rbac', 'result': 'success'},
            {'created_at': '2026-09-01T00:00:00+00:00', 'user_name': 'Old', 'account_id': 'a2', 'module_name': 'Users', 'action': 'Old action', 'target_name': '', 'target_id': '', 'result': 'success'},
        ]}
        result = system_ops.audit_csv(make_db(store), '2026-10-01', '2026-10-31')
        lines = result['csv'].strip().splitlines()
        self.assertEqual((result['rows'], len(lines)), (1, 2))
        self.assertTrue(lines[0].startswith('Time (Manila)'))
        self.assertIn("2026-10-20 00:30:00", lines[1])                       # 16:30 UTC is 00:30 in Manila
        self.assertIn("'=HYPERLINK", lines[1])                               # a formula is neutralised
        with self.assertRaises(ValueError):
            system_ops.audit_csv(make_db(store), '2026-11-01', '2026-10-01')
        with self.assertRaises(ValueError):
            system_ops.audit_csv(make_db(store), 'yesterday', None)

    def test_csv_safe(self):
        self.assertEqual([system_ops.csv_safe(v) for v in ('=1+1', '+5', '-2', '@SUM', 'plain', None)], ["'=1+1", "'+5", "'-2", "'@SUM", 'plain', ''])


class BackupStatusTests(unittest.TestCase):
    def status(self, last):
        return system_ops.backup_status({'last_backup': last}, NOW)

    def test_never_reported_is_a_warning_with_a_pointer_to_the_guide(self):
        result = system_ops.backup_status({'last_backup': {}}, NOW)
        self.assertEqual(result['status'], 'warn')
        self.assertIn('BACKUP_GUIDE', result['detail'])

    def test_fresh_encrypted_backup_is_healthy_and_an_unencrypted_one_is_flagged(self):
        fresh = {'at': iso(NOW - timedelta(hours=5)), 'tables': 30, 'rows': 900, 'encrypted': True}
        self.assertEqual(self.status(fresh)['status'], 'ok')
        self.assertEqual(self.status({**fresh, 'encrypted': False})['status'], 'warn')

    def test_old_backups_warn_then_fail(self):
        self.assertEqual(self.status({'at': iso(NOW - timedelta(hours=50)), 'encrypted': True})['status'], 'warn')
        self.assertEqual(self.status({'at': iso(NOW - timedelta(days=9)), 'encrypted': True})['status'], 'fail')

    def test_a_failure_after_the_last_success_is_a_failure_until_a_later_success(self):
        last = {'at': iso(NOW - timedelta(hours=30)), 'failed_at': iso(NOW - timedelta(hours=2)), 'error': 'pg_dump: connection refused', 'encrypted': True}
        result = self.status(last)
        self.assertEqual(result['status'], 'fail')
        self.assertIn('connection refused', result['detail'])
        self.assertEqual(self.status({**last, 'at': iso(NOW - timedelta(hours=1))})['status'], 'ok')

    def test_the_health_scan_includes_it(self):
        with patch.object(control, 'load_settings', return_value=settings(last_backup={})):
            report = control.health_scan(MagicMock())
        self.assertEqual(next(check for check in report['checks'] if check['id'] == 'backups')['status'], 'warn')


class RouteTests(unittest.TestCase):
    def client(self, level):
        from Admin.Backend.system_control import routes
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
        app.register_blueprint(routes.system_control_bp, url_prefix='/api/admin')

        def require(required_level='admin'):
            if required_level == 'super_admin' and level != 'super_admin':
                raise PermissionError('Super administrator access required')
            return {'account_id': 'a1', 'email': 'a@umak.edu.ph', 'access_level': level}
        return app.test_client(), [patch.object(routes, '_require_admin', side_effect=require), patch.object(routes, '_database', return_value=MagicMock())]

    def test_every_new_route_is_for_super_admins_only(self):
        client, patches = self.client('admin')
        for p in patches:
            p.start()
        try:
            for method, path in (('get', '/api/admin/system/admin-health'), ('get', '/api/admin/system/email-health'), ('get', '/api/admin/system/audit-export'), ('get', '/api/admin/system/backup-status'),
                                 ('post', '/api/admin/system/session-wipe'), ('get', '/api/admin/system/maintenance-windows'), ('post', '/api/admin/system/maintenance-windows')):
                self.assertEqual(getattr(client, method)(path).status_code, 403, path)
        finally:
            patch.stopall()

    def test_the_export_is_a_csv_download_and_is_logged(self):
        from Admin.Backend.system_control import routes
        client, patches = self.client('super_admin')
        for p in patches:
            p.start()
        try:
            with patch('app.utils.system_ops.audit_csv', return_value={'csv': 'a,b\n1,2\n', 'rows': 1, 'truncated': False}), patch.object(routes, '_log_admin_action') as log:
                reply = client.get('/api/admin/system/audit-export?start=2026-10-01&end=2026-10-31')
            self.assertEqual((reply.status_code, reply.mimetype), (200, 'text/csv'))
            self.assertIn('attachment', reply.headers['Content-Disposition'])
            self.assertEqual(log.call_args.args[2], 'Export Audit Log')
        finally:
            patch.stopall()

    def test_a_bad_window_answers_400(self):
        client, patches = self.client('super_admin')
        for p in patches:
            p.start()
        try:
            with patch.object(control, 'load_settings', return_value=settings()):
                reply = client.post('/api/admin/system/maintenance-windows', json={'start': '', 'end': ''})
            self.assertEqual(reply.status_code, 400)
        finally:
            patch.stopall()


if __name__ == '__main__':
    unittest.main()
