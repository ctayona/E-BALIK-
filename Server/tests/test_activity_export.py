"""The activity log CSV export: date range (Manila days), spreadsheet-safe cells, the super-admin-only administrator log, and the download being logged."""
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask

import app.utils  # noqa: F401  (puts the repository root on the import path, as the other admin route tests rely on)
from Admin.Backend.activity_logs import routes  # noqa: E402

ENTRIES = [
    {'id': 'L1', 'timestamp': '2026-10-10T04:00:00+00:00', 'user': '=HYPERLINK("http://x")', 'userId': 'u1', 'action': 'Confirm Payment', 'module': 'Income', 'target': 'PR-1', 'targetId': 'e1', 'result': 'Success'},
    {'id': 'L2', 'timestamp': '2026-10-20T20:00:00+00:00', 'user': 'Ana', 'userId': 'u2', 'action': 'Finalize Auction', 'module': 'Auctions', 'target': 'A1', 'targetId': 'a1', 'result': 'Success'},
]


class FakeDb:
    def __init__(self):
        self.asked = []

    def get_activity_logs_for_actor_type(self, include_admins, limit):
        self.asked.append((include_admins, limit))
        return list(ENTRIES)


class ExportTests(unittest.TestCase):
    def call(self, query, level_error=None):
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
        app.register_blueprint(routes.activity_logs_bp, url_prefix='/api/admin')
        self.db, self.logged, self.levels = FakeDb(), [], []

        def require(required_level='admin'):
            self.levels.append(required_level)
            if level_error:
                raise level_error
            return {'account_id': 'admin-1', 'email': 'a@x'}
        with patch.object(routes, '_require_admin', side_effect=require), patch.object(routes, 'get_db', return_value=self.db), \
                patch('Admin.Backend.shared.admin_access._log_admin_action', side_effect=lambda *a, **k: self.logged.append(a[2:])):
            return app.test_client().get('/api/admin/activity-logs/export' + query)

    def test_everything_without_dates_and_cells_cannot_run_formulas(self):
        reply = self.call('')
        text = reply.get_data(as_text=True)
        self.assertEqual(reply.status_code, 200)
        self.assertIn('text/csv', reply.content_type)
        self.assertIn('Log ID,Time (ISO),Person', text)
        self.assertIn('L1', text)
        self.assertIn('L2', text)
        self.assertNotIn(',=HYPERLINK', text)                         # a leading "=" is neutralised
        self.assertEqual(self.db.asked, [(False, 1000)])
        self.assertEqual(self.logged[0][:1], ('Export Activity Log',))

    def test_the_date_range_uses_manila_days(self):
        text = self.call('?from=2026-10-21&to=2026-10-21').get_data(as_text=True)    # 20:00 UTC on the 20th is 04:00 on the 21st in Manila
        self.assertIn('L2', text)
        self.assertNotIn('L1', text)
        self.assertIn('L1', self.call('?to=2026-10-10').get_data(as_text=True))

    def test_bad_dates_are_a_400_and_nothing_is_logged(self):
        for query in ('?from=yesterday', '?from=2026-10-20&to=2026-10-01'):
            self.assertEqual(self.call(query).status_code, 400)
            self.assertEqual(self.logged, [])

    def test_the_administrator_log_needs_a_super_admin(self):
        self.call('?scope=admin')
        self.assertEqual(self.levels, ['super_admin'])
        self.assertEqual(self.db.asked, [(True, 1000)])
        reply = self.call('?scope=admin', level_error=PermissionError('Super admin only'))
        self.assertEqual(reply.status_code, 403)
        self.assertEqual(self.logged, [])
        self.assertEqual(self.call('', level_error=ValueError('Invalid token')).status_code, 401)


if __name__ == '__main__':
    unittest.main()
