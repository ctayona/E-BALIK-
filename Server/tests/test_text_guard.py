"""Input checks for typed text: the shared cases (also run against the browser copy), markup stripping and refusal messages."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT.parent, ROOT / 'tests'):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.utils.text_guard import RULES, TextRejected, clean_field, strip_markup, text_problem  # noqa: E402

CASES = json.loads((ROOT / 'tests' / 'text_guard_cases.json').read_text(encoding='utf-8'))


class SharedCases(unittest.TestCase):
    def test_real_text_is_accepted(self):
        for case in CASES['ok']:
            with self.subTest(**case):
                self.assertEqual(text_problem(case['text'], case['kind']), '')
                self.assertTrue(clean_field(case['text'], case['kind'], 'x'))

    def test_bad_text_is_refused(self):
        for case in CASES['bad']:
            with self.subTest(**case):
                self.assertNotEqual(text_problem(case['text'], case['kind']), '')
                with self.assertRaises(TextRejected):
                    clean_field(case['text'], case['kind'], 'x')

    def test_foul_language_is_refused_with_its_own_code(self):
        for case in CASES['rude']:
            with self.subTest(**case):
                self.assertEqual(text_problem(case['text'], case['kind']), '')   # the browser cannot know the word list
                with self.assertRaises(TextRejected) as caught:
                    clean_field(case['text'], case['kind'], 'description')
                self.assertEqual(caught.exception.code, 'profanity')
                self.assertEqual(caught.exception.body()['field'], 'description')


class Messages(unittest.TestCase):
    def test_short_text_says_how_long_it_must_be(self):
        self.assertIn('at least 15 characters', text_problem('too short', 'description'))
        self.assertIn('at least 3 characters', text_problem('ab', 'title'))

    def test_random_typing_asks_for_a_real_text(self):
        self.assertIn('random typing', text_problem('asdfghjkl', 'title'))

    def test_empty_optional_text_is_fine_but_required_is_not(self):
        self.assertEqual(text_problem('', 'description', required=False), '')
        self.assertEqual(clean_field('   ', 'description', 'description', required=False), '')
        self.assertIn('Enter the', text_problem('  ', 'description'))

    def test_label_names_the_field_in_the_message(self):
        self.assertIn('claim explanation', text_problem('no', 'reason', label='claim explanation'))

    def test_every_rule_has_a_sensible_range(self):
        for kind, rule in RULES.items():
            self.assertLess(rule['min'], rule['max'], kind)
        self.assertEqual((RULES['title']['min'], RULES['description']['min']), (3, 15))


class Markup(unittest.TestCase):
    def test_tags_and_scripts_are_removed(self):
        self.assertEqual(strip_markup('<b>Black</b> wallet<script>alert(1)</script>'), 'Black wallet')
        self.assertEqual(strip_markup('<img src=x onerror=alert(1)>Keys'), 'Keys')
        self.assertEqual(strip_markup('<style>body{}</style>Umbrella'), 'Umbrella')

    def test_escaped_tags_do_not_slip_through(self):
        self.assertEqual(strip_markup('&lt;script&gt;alert(1)&lt;/script&gt;Keys'), 'Keys')
        self.assertNotIn('<', strip_markup('a < b > c'))

    def test_spaces_are_tidied_and_paragraphs_kept(self):
        self.assertEqual(strip_markup('  A   &amp;  B  '), 'A & B')
        self.assertEqual(strip_markup('one\r\n\r\n\r\n\r\ntwo'), 'one\n\ntwo')
        self.assertEqual(strip_markup('a\x00b\x07c'), 'abc')

    def test_stored_text_is_the_cleaned_text(self):
        self.assertEqual(clean_field('<b>Black</b>   leather wallet with cards inside', 'description', 'description'),
                         'Black leather wallet with cards inside')

    def test_nothing_is_allowed_to_hide_behind_markup(self):
        with self.assertRaises(TextRejected):
            clean_field('<b>hi</b>', 'description', 'description')
        with self.assertRaises(TextRejected):
            clean_field('<script>alert(1)</script>', 'title', 'item_name')


if __name__ == '__main__':
    unittest.main()
