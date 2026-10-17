"""The header notification menu's backend: "Mark all as read" changes only the signed-in person's unread notices."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT.parent, ROOT / 'tests'):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from test_otp_and_feed import real_db  # noqa: E402
from test_report_lifecycle import FINDER, OWNER, client_for  # noqa: E402
from Users.Backend.notifications import routes as notice_routes  # noqa: E402


def notice(notification_id, account, read=False):
    return {'notification_id': notification_id, 'user_account_id': account, 'is_read': read, 'title': 'T', 'message': 'M', 'created_at': '2026-10-16T01:00:00+00:00'}


class MarkAllReadTests(unittest.TestCase):
    def call(self, account_id, store, method='post'):
        client = client_for(notice_routes.notifications_bp, '/api/notifications')
        with patch.object(notice_routes, 'get_db', return_value=real_db(store)), patch.object(notice_routes, '_require_auth', return_value={'account_id': account_id}):
            return getattr(client, method)('/api/notifications/read-all')

    def test_every_unread_notice_of_the_person_is_marked_read(self):
        store = {'user_notifications': [notice('n1', OWNER), notice('n2', OWNER), notice('n3', OWNER, read=True)]}
        response = self.call(OWNER, store)
        self.assertEqual((response.status_code, response.get_json()), (200, {'updated': 2, 'unreadCount': 0}))
        self.assertTrue(all(row['is_read'] for row in store['user_notifications']))
        self.assertTrue(all(row.get('read_at') for row in store['user_notifications'] if row['notification_id'] != 'n3'))

    def test_somebody_elses_notices_are_left_alone(self):
        store = {'user_notifications': [notice('n1', OWNER), notice('n2', FINDER)]}
        self.assertEqual(self.call(OWNER, store).get_json()['updated'], 1)
        self.assertEqual([row['is_read'] for row in store['user_notifications']], [True, False])

    def test_nothing_to_mark_is_not_an_error(self):
        response = self.call(OWNER, {'user_notifications': [notice('n1', OWNER, read=True)]})
        self.assertEqual((response.status_code, response.get_json()['updated']), (200, 0))

    def test_patch_works_too_and_a_missing_token_is_refused(self):
        self.assertEqual(self.call(OWNER, {'user_notifications': [notice('n1', OWNER)]}, method='patch').status_code, 200)
        client = client_for(notice_routes.notifications_bp, '/api/notifications')
        with patch.object(notice_routes, 'get_db', return_value=real_db({'user_notifications': []})):
            self.assertEqual(client.post('/api/notifications/read-all').status_code, 401)

    def test_the_single_notice_route_still_works_next_to_it(self):
        store = {'user_notifications': [notice('n1', OWNER)]}
        client = client_for(notice_routes.notifications_bp, '/api/notifications')
        with patch.object(notice_routes, 'get_db', return_value=real_db(store)), patch.object(notice_routes, '_require_auth', return_value={'account_id': OWNER}):
            self.assertEqual(client.patch('/api/notifications/n1/read').status_code, 200)


if __name__ == '__main__':
    unittest.main()
