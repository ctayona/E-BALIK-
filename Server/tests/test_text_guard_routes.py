"""The text checks as the routes apply them: found and missing reports, claims, report edits, profile names, registration and comments."""
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT.parent, ROOT / 'tests'):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from test_integrity_rules import ACCOUNT, FOUND_FORM, MISSING_FORM, ClaimRouteTests, ReportRouteTests, app_client, report_db  # noqa: E402
from test_report_lifecycle import MyReportsGuardTests  # noqa: E402
from Users.Backend.found_item import routes as found_routes  # noqa: E402
from Users.Backend.missing_item import routes as missing_routes  # noqa: E402
from Users.Backend.profile import routes as profile_routes  # noqa: E402


class ReportFormTests(ReportRouteTests):
    def found(self, **changes):
        db = report_db()
        return self.post(found_routes, found_routes.found_item_bp, '/api/found-items', {**FOUND_FORM, **changes}, db), db

    def missing(self, **changes):
        db = report_db()
        return self.post(missing_routes, missing_routes.missing_item_bp, '/api/missing-items', {**MISSING_FORM, **changes}, db), db

    def test_found_report_names_the_field_that_looks_like_random_typing(self):
        for field, value in (('item_name', 'asdfghjkl'), ('description', 'aaaaaaaaaaaaaaaaaaaa'), ('location', 'zxcvbnm'), ('turnover_location', 'ab')):
            response, db = self.found(**{field: value})
            self.assertEqual((response.status_code, response.get_json()['field']), (400, field), field)
            self.assertEqual(response.get_json()['code'], 'invalid_text')
            db.create_found_item.assert_not_called()

    def test_found_description_is_optional_but_must_be_real_when_given(self):
        self.assertEqual(self.found(description='')[0].status_code, 201)
        response, _ = self.found(description='too short')
        self.assertEqual((response.status_code, response.get_json()['field']), (400, 'description'))

    def test_found_report_is_stored_without_markup(self):
        response, db = self.found(item_name='<b>Blue</b> umbrella', description='<script>alert(1)</script>Large blue umbrella with a curved wooden handle')
        self.assertEqual(response.status_code, 201)
        stored = db.create_found_item.call_args.args[0]
        self.assertEqual(stored['item_name'], 'Blue umbrella')
        self.assertEqual(stored['description'], 'Large blue umbrella with a curved wooden handle')

    def test_foul_language_is_refused_in_a_report(self):
        response, db = self.found(description='This is a fucking blue umbrella with a handle')
        self.assertEqual((response.status_code, response.get_json()['code'], response.get_json()['field']), (400, 'profanity', 'description'))
        db.create_found_item.assert_not_called()

    def test_missing_report_needs_a_real_description_and_title(self):
        for field, value in (('item_name', 'xy'), ('description', 'my thing'), ('description', 'qwertyuiopasdfghjkl'), ('distinctive_marks', 'hahahahahahahaha'), ('last_location', 'aaaaaa')):
            response, db = self.missing(**{field: value})
            self.assertEqual((response.status_code, response.get_json()['field']), (400, field), (field, value))
            db.create_missing_item.assert_not_called()

    def test_missing_report_strips_markup_and_keeps_real_text(self):
        response, db = self.missing(item_name='Black <i>wallet</i>', distinctive_marks='<img src=x onerror=alert(1)>Scratch on the back')
        self.assertEqual(response.status_code, 201)
        stored = db.create_missing_item.call_args.args[0]
        self.assertEqual((stored['item_name'], stored['distinctive_marks']), ('Black wallet', 'Scratch on the back'))


class ClaimTextTests(ClaimRouteTests):
    def test_claim_reason_must_be_a_real_explanation(self):
        for reason in ('mine', 'asdfghjklasdfghjkl', 'hahahahahahahahaha', '<b></b>'):
            db = self.db()
            response = self.post(db, claim_reason=reason)
            self.assertEqual((response.status_code, response.get_json()['field']), (400, 'claim_reason'), reason)
            db.create_claim.assert_not_called()

    def test_claim_reason_is_stored_without_markup(self):
        db = self.db()
        response = self.post(db, claim_reason='<b>It is my umbrella</b>, it has my name inside')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(db.create_claim.call_args.args[0]['claim_reason'], 'It is my umbrella , it has my name inside'.replace(' ,', ','))


class ReportEditTextTests(MyReportsGuardTests):
    def call_with(self, method, path, body, **rows):
        from unittest.mock import patch as _patch
        from Users.Backend.my_reports import routes as my_routes
        from test_report_lifecycle import OWNER, client_for
        db = MagicMock()
        db.get_found_items_by_account.return_value = list(rows.get('found', ()))
        db.get_missing_items_by_account.return_value = list(rows.get('missing_rows', ()))
        db.update_found_item_by_account.return_value = {'fpost_id': 'FP1001'}
        db.update_missing_item_by_account.return_value = {'mpost_id': 'MP1001'}
        client = client_for(my_routes.my_reports_bp, '/api')
        with _patch.object(my_routes, 'get_db', return_value=db), _patch.object(my_routes, '_authenticated_account_id', return_value=OWNER):
            return getattr(client, method)(path, json=body), db

    def test_edits_are_checked_and_cleaned(self):
        open_lost = [{'item_id': 'M1', 'mpost_id': 'MP1001', 'status': 'missing'}]
        response, db = self.call_with('put', '/api/missing-items/MP1001', {'description': 'asdfghjkl asdfghjkl'}, missing_rows=open_lost)
        self.assertEqual((response.status_code, response.get_json()['field']), (400, 'description'))
        db.update_missing_item_by_account.assert_not_called()
        response, db = self.call_with('put', '/api/found-items/FP1001', {'item_name': '<b>Blue</b> umbrella', 'category': 'Accessories'}, found=[self.FOUND])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(db.update_found_item_by_account.call_args.args[2], {'item_name': 'Blue umbrella', 'category': 'Accessories'})   # fields not sent are left alone
        response, _ = self.call_with('put', '/api/found-items/FP1001', {'description': ''}, found=[self.FOUND])
        self.assertEqual(response.status_code, 200)   # a found report may have no description


class ProfileNameTests(unittest.TestCase):
    def put(self, body):
        client = app_client(profile_routes.profile_bp)
        db = MagicMock()
        db.get_user_by_account_id.return_value = {'account_id': ACCOUNT, 'email': 'u@umak.edu.ph', 'fname': 'Ana', 'lname': 'Reyes', 'campus_id': 'K1', 'verification_status': 'pending'}
        with patch.object(profile_routes, 'get_db', return_value=db), patch.object(profile_routes.JWTService, 'extract_token_from_header', return_value='t'), \
             patch.object(profile_routes.JWTService, 'verify_token', return_value={'account_id': ACCOUNT}):
            return client.put('/api/auth/profile', json={'email': 'u@umak.edu.ph', 'campus_id': 'K1', **body}, headers={'Authorization': 'Bearer t'}), db

    def test_real_names_are_saved(self):
        response, db = self.put({'fname': 'Ma. Cristina', 'mname': "D'Souza", 'lname': 'Dela Cruz'})
        self.assertEqual(response.status_code, 200)
        saved = db.update_user.call_args.args[1]
        self.assertEqual((saved['fname'], saved['mname'], saved['lname']), ('Ma. Cristina', "D'Souza", 'Dela Cruz'))

    def test_names_that_are_not_names_are_refused(self):
        for body, field in (({'fname': 'J', 'lname': 'Cruz'}, 'fname'), ({'fname': 'Ana', 'lname': 'Cruz123'}, 'lname'), ({'fname': 'Asdfgh', 'lname': 'Cruz'}, 'fname'),
                            ({'fname': 'Ana', 'lname': 'Cruz', 'mname': 'x9'}, 'mname'), ({'fname': '<b>Ana</b>!!', 'lname': 'Cruz'}, 'fname')):
            response, db = self.put(body)
            self.assertEqual((response.status_code, response.get_json()['field']), (400, field), body)
            db.update_user.assert_not_called()

    def test_markup_is_stripped_from_a_name(self):
        response, db = self.put({'fname': '<b>Ana</b>', 'lname': 'Cruz'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(db.update_user.call_args.args[1]['fname'], 'Ana')


if __name__ == '__main__':
    unittest.main()
