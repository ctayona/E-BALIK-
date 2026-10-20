"""Role access (which admin pages each role may open) and page locks (pages isolated while they are being fixed)."""
import unittest
from unittest.mock import MagicMock, patch

from flask import Flask, jsonify

from app.utils import access_control as access
from app.utils import system_control as control


def settings(rbac=None, locks=None):
    base = {key: dict(value) for key, value in control.DEFAULT_SETTINGS.items()}
    base['rbac'] = rbac or {}
    base['page_locks'] = locks or {}
    return base


class MatrixTests(unittest.TestCase):
    def test_defaults_keep_todays_behaviour(self):
        matrix = access.rbac_matrix(settings())
        self.assertIn('smart-tags', matrix['admin'])
        self.assertNotIn('system-control', matrix['admin'])
        self.assertEqual(matrix['guard'], ['release-desk'])

    def test_super_admin_has_everything_whatever_the_matrix(self):
        self.assertEqual(access.allowed_admin_pages(settings({'admin': [], 'guard': ['release-desk']}), 'super_admin'), access.ADMIN_PAGE_IDS)

    def test_admins_always_keep_dashboard_and_profile(self):
        pages = access.rbac_matrix(settings({'admin': ['income']}))['admin']
        self.assertEqual(pages, ['dashboard', 'income', 'admin-profile'])

    def test_validation(self):
        with self.assertRaises(access.AccessError):
            access.validate_rbac({'admin': ['income'], 'guard': []})          # guards need the release desk
        with self.assertRaises(access.AccessError):
            access.validate_rbac({'admin': ['made-up'], 'guard': ['release-desk']})
        matrix = access.validate_rbac({'admin': ['income', 'system-control', 'dashboard'], 'guard': ['release-desk', 'smart-tags']})
        self.assertEqual(matrix, {'admin': ['income'], 'guard': ['smart-tags', 'release-desk']})  # super-only and always pages are dropped


class AdminPathTests(unittest.TestCase):
    def test_a_page_taken_away_closes_its_api(self):
        rules = settings({'admin': ['claims'], 'guard': ['release-desk']})
        self.assertIn('Smart tags', access.admin_path_problem(rules, 'admin', '/smart-tags/batch'))
        self.assertIsNone(access.admin_path_problem(rules, 'admin', '/claims/123/status'))

    def test_shared_apis_stay_open_while_any_page_that_needs_them_is_allowed(self):
        rules = settings({'admin': ['report-hub'], 'guard': ['release-desk']})
        self.assertIsNone(access.admin_path_problem(rules, 'admin', '/claims'))       # Reports reads claims for the custody tab

    def test_the_shell_endpoints_are_always_open(self):
        rules = settings({'admin': [], 'guard': ['release-desk']})
        for path in ('/access/me', '/dashboard', '/nav-badges', '/mfa/status'):
            self.assertIsNone(access.admin_path_problem(rules, 'admin', path), path)

    def test_a_locked_page_refuses_admins_but_not_super_admins(self):
        rules = settings(locks={'admin': {'income': {'message': 'Fixing totals'}}})
        self.assertEqual(access.admin_path_problem(rules, 'admin', '/income/summary'), 'Fixing totals')
        self.assertIsNone(access.admin_path_problem(rules, 'super_admin', '/income/summary'))

    def test_guards_reach_only_what_was_granted(self):
        self.assertFalse(access.guard_may_use(settings(), '/smart-tags'))
        self.assertTrue(access.guard_may_use(settings({'admin': [], 'guard': ['release-desk', 'smart-tags']}), '/smart-tags/batches'))
        self.assertFalse(access.guard_may_use(settings({'admin': [], 'guard': ['release-desk']}), '/nav-badges'))


class UserLockTests(unittest.TestCase):
    def test_a_locked_page_blocks_its_own_calls_only(self):
        rules = settings(locks={'user': {'auction-hall': {'message': ''}, 'found-item': {'message': 'Back at 3 PM'}}})
        self.assertEqual(access.user_path_lock(rules, 'GET', '/auctions/feed')[0], 'auction-hall')
        self.assertEqual(access.user_path_lock(rules, 'POST', '/found-items'), ('found-item', 'Back at 3 PM'))
        self.assertIsNone(access.user_path_lock(rules, 'GET', '/found-items'))        # reading your own reports still works
        self.assertIsNone(access.user_path_lock(rules, 'GET', '/feed'))

    def test_the_public_scan_page_survives_a_smart_tag_lock(self):
        rules = settings(locks={'user': {'my-tags': {}}})
        self.assertIsNone(access.user_path_lock(rules, 'GET', '/tags/ABCDEFGHJK23'))
        self.assertIsNone(access.user_path_lock(rules, 'POST', '/tags/ABCDEFGHJK23/found'))
        self.assertIsNotNone(access.user_path_lock(rules, 'GET', '/tags/mine'))

    def test_set_lock_rules(self):
        value = access.set_lock({}, 'user', 'claim', True, '<b>Fixing</b> claims', 'a1')
        self.assertEqual(value['user']['claim']['message'], 'bFixing/b claims')
        self.assertEqual(access.set_lock(value, 'user', 'claim', False, '', 'a1')['user'], {})
        for area, page in (('admin', 'system-control'), ('admin', 'dashboard'), ('user', 'nope'), ('elsewhere', 'claim')):
            with self.assertRaises(access.AccessError):
                access.set_lock({}, area, page, True, '', 'a1')

    def test_the_request_hook_answers_423_for_a_locked_user_page(self):
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
        app.before_request(control.enforce_request)
        app.add_url_rule('/api/claims', 'claims', lambda: jsonify({'ok': True}), methods=['GET'])
        app.add_url_rule('/api/system/status', 'status', lambda: jsonify({'ok': True}))
        locked = settings(locks={'user': {'claim': {'message': 'Claims are paused'}}})
        with patch.object(control, 'load_settings', return_value=locked), patch('app.utils.get_db', return_value=MagicMock()):
            client = app.test_client()
            reply = client.get('/api/claims')
            self.assertEqual((reply.status_code, reply.get_json()['page_locked']), (423, 'claim'))
            self.assertEqual(client.get('/api/system/status').status_code, 200)

    def test_public_status_lists_locked_user_pages(self):
        with patch.object(control, 'load_settings', return_value=settings(locks={'user': {'claim': {'message': 'Paused'}}, 'admin': {'income': {}}})):
            self.assertEqual(control.public_status(MagicMock())['locked_pages'], {'claim': 'Paused'})


class RouteTests(unittest.TestCase):
    def client(self, level):
        from Admin.Backend.users import routes
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
        app.register_blueprint(routes.users_bp, url_prefix='/api/admin')

        def require(required_level='admin'):
            if required_level == 'super_admin' and level != 'super_admin':
                raise PermissionError('Super administrator access required')
            return {'account_id': 'a1', 'email': 'a@umak.edu.ph', 'access_level': level}
        return app.test_client(), patch.object(routes, '_require_admin', side_effect=require), patch.object(routes, 'get_db', return_value=MagicMock())

    def test_only_super_admins_change_role_access(self):
        client, auth, db = self.client('admin')
        with auth, db:
            self.assertEqual(client.put('/api/admin/access', json={'admin': [], 'guard': ['release-desk']}).status_code, 403)
        client, auth, db = self.client('super_admin')
        with auth, db, patch('app.utils.system_control.save_setting') as save, patch('app.utils.system_control.load_settings', return_value=settings()):
            reply = client.put('/api/admin/access', json={'admin': ['income'], 'guard': ['release-desk']})
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(save.call_args.args[1:3], ('rbac', {'admin': ['income'], 'guard': ['release-desk']}))

    def test_everyone_on_staff_can_read_their_own_access(self):
        client, auth, db = self.client('guard')
        with auth, db, patch('app.utils.system_control.load_settings', return_value=settings()):
            body = client.get('/api/admin/access/me').get_json()
        self.assertEqual((body['level'], body['pages']), ('guard', ['release-desk']))


if __name__ == '__main__':
    unittest.main()
