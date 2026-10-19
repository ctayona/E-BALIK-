"""Registration says "already registered" straight away: while typing (email-available) and from the Google button (purpose=register)."""
import unittest
from unittest.mock import MagicMock, patch

from flask import Flask

from app.utils import rate_limit
from Users.Backend.home import routes as home_routes


def client():
    app = Flask(__name__)
    app.config.update(SUPABASE_URL='http://unused', SUPABASE_SERVICE_KEY='unused', GOOGLE_CLIENT_ID='client-id')
    app.register_blueprint(home_routes.home_bp, url_prefix='/api')
    return app.test_client()


class EmailAvailableTests(unittest.TestCase):
    def setUp(self):
        rate_limit.reset()

    def ask(self, email, existing):
        db = MagicMock()
        db.get_user_by_email.return_value = {'account_id': 'a'} if existing else None
        with patch.object(home_routes, 'get_db', return_value=db):
            return client().get('/api/auth/email-available', query_string={'email': email})

    def test_a_registered_email_is_reported_taken(self):
        reply = self.ask('Maria@umak.edu.ph', True)
        self.assertEqual(reply.get_json(), {'valid': True, 'available': False})
        self.assertEqual(reply.headers['Cache-Control'], 'no-store')

    def test_a_new_email_is_available(self):
        self.assertEqual(self.ask('new@umak.edu.ph', False).get_json(), {'valid': True, 'available': True})

    def test_a_malformed_email_is_not_looked_up(self):
        db = MagicMock()
        with patch.object(home_routes, 'get_db', return_value=db):
            reply = client().get('/api/auth/email-available', query_string={'email': 'nope'})
        self.assertEqual(reply.get_json(), {'valid': False, 'available': None})
        db.get_user_by_email.assert_not_called()

    def test_a_database_problem_is_not_reported_as_taken(self):
        with patch.object(home_routes, 'get_db', side_effect=RuntimeError('down')):
            reply = client().get('/api/auth/email-available', query_string={'email': 'new@umak.edu.ph'})
        self.assertEqual(reply.get_json(), {'valid': True, 'available': None})

    def test_checks_are_rate_limited(self):
        statuses = [self.ask('a@umak.edu.ph', False).status_code for _ in range(45)]
        self.assertEqual(statuses[0], 200)
        self.assertEqual(statuses[-1], 429)


class GoogleRegisterTests(unittest.TestCase):
    def call(self, purpose, existing):
        db = MagicMock()
        db.get_user_by_email.return_value = {'account_id': 'a', 'email': 'maria@gmail.com', 'fname': 'Maria'} if existing else None
        token = {'email': 'maria@gmail.com', 'email_verified': True, 'given_name': 'Maria', 'family_name': 'Santos', 'sub': '1'}
        with patch.object(home_routes, 'get_db', return_value=db), patch.object(home_routes.id_token, 'verify_oauth2_token', return_value=token):
            return client().post('/api/auth/google-login', json={'credential': 'x', 'purpose': purpose}), db

    def test_registering_with_a_registered_google_email_is_refused_at_once_and_signs_nobody_in(self):
        reply, db = self.call('register', True)
        body = reply.get_json()
        self.assertEqual(body['code'], 'EMAIL_ALREADY_REGISTERED')
        self.assertNotIn('token', body)
        db.update_user.assert_not_called()

    def test_registering_with_a_new_google_email_still_prefills_the_form(self):
        reply, _ = self.call('register', False)
        self.assertEqual(reply.get_json()['code'], 'REGISTER_REQUIRED')


if __name__ == '__main__':
    unittest.main()
