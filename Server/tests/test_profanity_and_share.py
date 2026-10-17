"""The respectful refusal for foul language (one sentence everywhere, one shared word list) and the single-post route behind shared links."""
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT.parent, ROOT / 'tests'):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from test_integrity_rules import FOUND_FORM, MISSING_FORM, ReportRouteTests, report_db  # noqa: E402
from test_otp_and_feed import FINDER, OWNER, feed_store, social_for  # noqa: E402
from Users.Backend.feed import routes as feed_routes  # noqa: E402
from Users.Backend.found_item import routes as found_routes  # noqa: E402
from Users.Backend.missing_item import routes as missing_routes  # noqa: E402
from app.utils import rate_limit  # noqa: E402
from app.utils.profanity import PROFANITY_MESSAGE, find_profanity  # noqa: E402
from app.utils.report_social import SocialError, clean_comment  # noqa: E402
from app.utils.text_guard import TextRejected, clean_field  # noqa: E402

CASES = json.loads((ROOT / 'tests' / 'profanity_cases.json').read_text(encoding='utf-8'))
SENTENCE = 'Please rewrite respectfully. Inappropriate language is not permitted.'


class SharedWordList(unittest.TestCase):
    def test_the_sentence_is_exactly_the_one_asked_for(self):
        self.assertEqual(PROFANITY_MESSAGE, SENTENCE)

    def test_rude_text_is_caught_and_ordinary_text_is_not(self):
        for text in CASES['rude']:
            self.assertIsNotNone(find_profanity(text), text)
        for text in CASES['clean']:
            self.assertIsNone(find_profanity(text), text)

    def test_the_browser_reads_the_same_list_file(self):
        terms = json.loads((ROOT / 'app' / 'utils' / 'profanity_terms.json').read_text(encoding='utf-8'))
        self.assertGreater(len(terms['english']), 20)
        self.assertGreater(len(terms['filipino']), 20)
        self.assertIn('puta', terms['filipino'])


class OneSentenceEverywhere(unittest.TestCase):
    def test_form_fields_use_it(self):
        for kind in ('title', 'description', 'place', 'marks', 'reason', 'comment'):
            with self.assertRaises(TextRejected) as caught:
                clean_field('this is a fucking long enough text for any field', kind, 'f')
            self.assertEqual((caught.exception.message, caught.exception.code), (SENTENCE, 'profanity'))

    def test_feed_comments_use_it(self):
        with self.assertRaises(SocialError) as caught:
            clean_comment('putangina mo ang bobo mo')
        self.assertEqual((caught.exception.message, caught.exception.code, caught.exception.status), (SENTENCE, 'profanity', 422))


class ReportFieldsAreChecked(ReportRouteTests):
    def test_the_typed_guard_name_is_checked_too(self):
        db = report_db()
        response = self.post(found_routes, found_routes.found_item_bp, '/api/found-items', {**FOUND_FORM, 'guard_name_or_id': 'Guard Gago'}, db)
        self.assertEqual((response.status_code, response.get_json()['code'], response.get_json()['field']), (400, 'profanity', 'guard_name_or_id'))
        self.assertEqual(response.get_json()['error'], SENTENCE)
        db.create_found_item.assert_not_called()

    def test_missing_report_fields_get_the_sentence(self):
        db = report_db()
        response = self.post(missing_routes, missing_routes.missing_item_bp, '/api/missing-items', {**MISSING_FORM, 'description': 'Black wallet of a tarantado who lost it'}, db)
        self.assertEqual((response.status_code, response.get_json()['error'], response.get_json()['field']), (400, SENTENCE, 'description'))


class SinglePostTests(unittest.TestCase):
    def setUp(self):
        rate_limit.reset()
        self.store = feed_store()
        self.social, _ = social_for(self.store)

    def get(self, path, account=OWNER):
        app = Flask(__name__)
        app.register_blueprint(feed_routes.feed_bp, url_prefix='/api/feed')
        with patch.object(feed_routes, '_authenticated_account_id', return_value=account), patch.object(feed_routes, '_social', return_value=self.social):
            return app.test_client().get(path)

    def test_an_open_report_comes_back_as_a_post_without_private_fields(self):
        response = self.get('/api/feed/found/fp1001')
        self.assertEqual(response.status_code, 200)
        post = response.get_json()['post']
        self.assertEqual((post['kind'], post['reference'], post['status']), ('found', 'FP1001', 'unclaimed'))
        self.assertEqual(set(post), {'kind', 'reference', 'item_name', 'category', 'description', 'location', 'date', 'image_url', 'status', 'created_at', 'comment_count', 'helpful_count', 'reacted', 'comments'})
        for private in ('finder@umak.edu.ph', 'fina@umak.edu.ph', 'K1', FINDER, 'item_id'):
            self.assertNotIn(private, str(post), private)

    def test_a_missing_report_works_and_a_closed_or_unknown_one_is_refused(self):
        self.assertEqual(self.get('/api/feed/missing/MP1001').get_json()['post']['reference'], 'MP1001')
        closed = self.get('/api/feed/found/FP1002')
        self.assertEqual((closed.status_code, closed.get_json()['code']), (409, 'report_closed'))
        unknown = self.get('/api/feed/found/FP9999')
        self.assertEqual((unknown.status_code, unknown.get_json()['code']), (404, 'not_found'))
        self.assertEqual(self.get('/api/feed/banana/FP1001').status_code, 400)

    def test_the_comment_routes_still_work_next_to_it(self):
        self.assertEqual(self.get('/api/feed/found/FP1001/comments').status_code, 200)
        self.assertEqual(self.get('/api/feed').status_code, 200)


if __name__ == '__main__':
    unittest.main()
