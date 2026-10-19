"""Report dates: real days only, never in the future (campus time), not more than a year back, on every route that saves one."""
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from flask import Flask

from app.utils.report_dates import campus_today, check_date, date_problem
from app.utils.text_guard import TextRejected

# 16:30 UTC on 19 Oct is already 00:30 on 20 Oct in Manila.
LATE_UTC = datetime(2026, 10, 19, 16, 30, tzinfo=timezone.utc)


class DateRuleTests(unittest.TestCase):
    def test_today_and_past_days_are_accepted(self):
        self.assertIsNone(date_problem('2026-10-20', 'date found', LATE_UTC))
        self.assertIsNone(date_problem('2026-01-02', 'date found', LATE_UTC))

    def test_the_campus_day_decides_what_today_is(self):
        self.assertEqual(campus_today(LATE_UTC).isoformat(), '2026-10-20')

    def test_future_days_are_refused(self):
        self.assertIn('cannot be in the future', date_problem('2026-10-21', 'date found', LATE_UTC))
        self.assertIn('cannot be in the future', date_problem('2030-01-01', 'last seen date', LATE_UTC))

    def test_typing_slips_and_very_old_days_are_refused(self):
        for bad in ('', '2026-02-30', '20/10/2026', 'yesterday'):
            self.assertIsNotNone(date_problem(bad, 'date found', LATE_UTC), bad)
        self.assertIn('more than a year', date_problem('2016-10-20', 'date found', LATE_UTC))

    def test_check_date_names_the_field(self):
        with self.assertRaises(TextRejected) as caught:
            check_date('2999-01-01', 'found_date', 'date found')
        self.assertEqual((caught.exception.field, caught.exception.code, caught.exception.status), ('found_date', 'invalid_date', 400))


class RouteTests(unittest.TestCase):
    """The future date is refused before anything is written."""

    def app(self, blueprint, prefix):
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='http://unused', SUPABASE_SERVICE_KEY='unused')
        app.register_blueprint(blueprint, url_prefix=prefix)
        return app.test_client()

    def test_user_edit_of_a_report_refuses_a_future_date(self):
        from Users.Backend.my_reports import routes
        db = MagicMock()
        db.get_found_items_by_account.return_value = [{'fpost_id': 'FP1001', 'status': 'unclaimed'}]
        with patch.object(routes, 'get_db', return_value=db), patch.object(routes, '_authenticated_account_id', return_value='u1'):
            reply = self.app(routes.my_reports_bp, '/api').put('/api/found-items/FP1001', json={'found_date': '2999-01-01'})
        self.assertEqual(reply.status_code, 400)
        self.assertEqual(reply.get_json()['field'], 'found_date')
        db.update_found_item_by_account.assert_not_called()

    def test_admin_lost_report_refuses_a_future_date(self):
        from Admin.Backend.lost_items import routes
        db = MagicMock()
        with patch.object(routes, 'get_db', return_value=db), patch.object(routes, '_require_admin', return_value={'account_id': 'a1'}):
            reply = self.app(routes.lost_items_bp, '/api/admin').post('/api/admin/lost-items', json={'item': 'Umbrella', 'category': 'Others', 'location': 'Gym', 'dateLost': '2999-01-01'})
        self.assertEqual(reply.status_code, 400)
        self.assertEqual(reply.get_json()['code'], 'invalid_date')
        db.create_missing_item.assert_not_called()

    def test_admin_found_edit_refuses_a_future_date(self):
        from Admin.Backend.found_items import routes
        db = MagicMock()
        with patch.object(routes, 'get_db', return_value=db), patch.object(routes, '_require_admin', return_value={'account_id': 'a1'}):
            reply = self.app(routes.found_items_bp, '/api/admin').put('/api/admin/found-items/FP1001', json={'dateFound': '2999-01-01'})
        self.assertEqual(reply.status_code, 400)
        db.update_admin_found_item.assert_not_called()


if __name__ == '__main__':
    unittest.main()
