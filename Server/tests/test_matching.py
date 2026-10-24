"""Matching a lost report with a found item: real components, plain reasons, contradictions that count, photos when both items have one."""
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from memdb import MemClient  # noqa: E402

from app.utils import image_match  # noqa: E402
from app.utils.matching import best_candidates, match_details, match_percentage  # noqa: E402
from app.utils.supabase_db import SupabaseDB  # noqa: E402

LOST = {'item_name': 'Black Jansport backpack', 'category': 'Bags', 'description': 'Black bag with a green keychain and a laptop inside', 'distinctive_marks': 'torn left strap',
        'last_location': 'Library', 'last_seen_date': '2026-10-18'}


def found(**over):
    base = {'item_name': 'Jansport bag, black', 'category': 'Bags', 'description': 'black backpack, green key chain', 'location': 'Library 2nd floor', 'found_date': '2026-10-19'}
    base.update(over)
    return base


def picture(color, size=(96, 96)):
    out = io.BytesIO()
    Image.new('RGB', size, color).save(out, 'PNG')
    return out.getvalue()


class ScoringTests(unittest.TestCase):
    def test_the_same_item_scores_high_with_reasons_and_no_conflicts(self):
        result = match_details(LOST, found())
        self.assertGreaterEqual(result['score'], 85)
        self.assertEqual(result['conflicts'], [])
        text = ' '.join(result['reasons'])
        for expected in ('Same category: Bags', 'Same brand: jansport', 'Same colour', 'One place is inside the other'):
            self.assertIn(expected, text)
        self.assertIsNone(result['components']['image'])          # no photos: the weights are re-scaled, not punished
        self.assertEqual(sum(c['weight'] for c in result['components'].values() if c), 100)

    def test_typos_plurals_synonyms_and_filipino_words_still_match(self):
        score = match_percentage(LOST, found(item_name='Itim na bagpack', description='jansprt with strap torn', location='Library', found_date='2026-10-18'))
        self.assertGreaterEqual(score, 85)
        self.assertGreaterEqual(match_percentage({'item_name': 'Cellphone', 'category': 'Electronics'}, {'item_name': 'Mobile phones', 'category': 'Electronics'}), 60)
        self.assertGreaterEqual(match_percentage({'item_name': 'Payong', 'category': 'Accessories'}, {'item_name': 'umbrellas', 'category': 'Accessories'}), 60)

    def test_contradictions_count_against_the_pair(self):
        good = match_percentage(LOST, found())
        other = match_details(LOST, found(item_name='Red Herschel backpack', description='red bag', location='Library', found_date='2026-10-18'))
        self.assertLess(other['score'], 55)
        self.assertTrue(any(c.startswith('Different brands') for c in other['conflicts']))
        self.assertTrue(any(c.startswith('Colours differ') for c in other['conflicts']))
        wrong_kind = match_details(LOST, found(item_name='Samsung A54 phone', category='Electronics', description='black phone'))
        self.assertLess(wrong_kind['score'], 40)
        self.assertGreater(good, other['score'] + 30)

    def test_compatible_colours_are_not_a_conflict_and_a_neutral_category_is_not_a_miss(self):
        details = match_details({'item_name': 'Grey bag', 'category': 'Other'}, {'item_name': 'Black bag', 'category': 'Bags'})
        self.assertFalse(any('Colours differ' in c for c in details['conflicts']))
        self.assertEqual(details['components']['category']['percent'], 35)

    def test_found_before_it_was_lost_is_impossible(self):
        result = match_details(LOST, found(found_date='2026-10-10'))
        self.assertLessEqual(result['score'], 45)
        self.assertIn('Found before it was last seen, which is not possible', result['conflicts'])
        self.assertEqual(match_details(LOST, found(found_date='2026-10-18'))['components']['date']['percent'], 100)

    def test_too_little_evidence_is_capped(self):
        self.assertLessEqual(match_percentage({'item_name': 'Bag'}, {'item_name': 'Bag'}), 60)
        self.assertEqual(match_percentage({}, {}), 0.0)

    def test_model_numbers_count(self):
        a = {'item_name': 'Samsung A54 phone', 'category': 'Electronics'}
        self.assertIn('Same model or number: a54', ' '.join(match_details(a, {'item_name': 'phone a54', 'category': 'Electronics'})['reasons']))

    def test_the_best_candidates_come_back_best_first(self):
        pool = [found(item_name='Blue umbrella', category='Accessories', description='', location='Gym'), found(), found(description='black bag', location='Oval')]
        ranked = best_candidates(LOST, pool, top=2)
        self.assertEqual(len(ranked), 2)
        self.assertGreaterEqual(ranked[0][1]['score'], ranked[1][1]['score'])
        self.assertEqual(ranked[0][0]['location'], 'Library 2nd floor')


class PhotoTests(unittest.TestCase):
    def test_photos_are_compared_only_when_both_items_have_one(self):
        red, blue = image_match.fingerprint(picture('#cc2222')), image_match.fingerprint(picture('#2222cc'))
        same = match_details({**LOST, 'image_features': red}, found(image_features=red))
        different = match_details({**LOST, 'image_features': red}, found(image_features=blue))
        self.assertEqual(same['components']['image']['percent'], 100)
        self.assertTrue(same['used_image'])
        self.assertLess(different['components']['image']['percent'], 40)
        self.assertGreater(same['score'], different['score'] + 15)
        self.assertTrue(any(c.startswith('Photos look different') for c in different['conflicts']))
        self.assertFalse(match_details({**LOST, 'image_features': red}, found())['used_image'])


class AdminListTests(unittest.TestCase):
    def make(self, store):
        db = SupabaseDB.__new__(SupabaseDB)
        db.client = MemClient(store)
        return db

    def store(self):
        return {
            'missing_items': [
                {'item_id': 'm1', 'mpost_id': 'M1', 'status': 'missing', 'image_url': '', **{k: v for k, v in LOST.items()}},
                {'item_id': 'm2', 'mpost_id': 'M2', 'status': 'returned', **LOST},                      # already resolved: not proposed again
                {'item_id': 'm3', 'mpost_id': 'M3', 'status': 'missing', 'item_name': 'Blue umbrella', 'category': 'Accessories', 'last_location': 'Gym', 'last_seen_date': '2026-10-01'},
            ],
            'found_items': [
                {'item_id': 'f1', 'fpost_id': 'F1', 'status': 'unclaimed', 'image_url': '', **found()},
                {'item_id': 'f2', 'fpost_id': 'F2', 'status': 'claimed', 'image_url': '', **found(item_name='Black Jansport backpack')},   # already claimed: not offered
                {'item_id': 'f3', 'fpost_id': 'F3', 'status': 'unclaimed', 'image_url': '', **found(item_name='Red Herschel backpack', description='red', location='Gym')},
            ],
            'ai_matches': [],
        }

    def test_the_list_has_real_components_reasons_and_runner_ups_for_open_items_only(self):
        rows = self.make(self.store()).list_admin_ai_matches()
        self.assertEqual([r['lostId'] for r in rows], ['M1'])
        row = rows[0]
        self.assertEqual((row['foundId'], row['status']), ('F1', 'High Confidence'))
        self.assertEqual([b['key'] for b in row['breakdown']], ['image', 'text', 'category', 'location', 'date'])
        self.assertIsNone(row['breakdown'][0]['percent'])                                  # no photos: shown as "no photo to compare", never invented
        self.assertGreater(row['breakdown'][1]['percent'], 60)
        self.assertTrue(row['reasons'])
        self.assertEqual([a['foundId'] for a in row['alternatives']], ['F3'])
        for invented in ('visualSim', 'descSim', 'locationSim', 'timeSim'):
            self.assertNotIn(invented, row)

    def test_a_decided_pair_stays_visible_with_its_decision(self):
        store = self.store()
        store['ai_matches'] = [{'missing_item_id': 'm3', 'found_item_id': 'f3', 'status': 'rejected', 'rejected_at': '2026-10-20T00:00:00+00:00'}]
        rows = self.make(store).list_admin_ai_matches()
        rejected = next(r for r in rows if r['lostId'] == 'M3')
        self.assertEqual((rejected['status'], rejected['foundId']), ('Rejected', 'F3'))
        self.assertEqual(rows[-1]['lostId'], 'M3')                                         # decisions sort after the ones still waiting

    def test_photos_are_fingerprinted_for_the_shortlist_and_make_the_score_use_them(self):
        store = self.store()
        store['missing_items'][0]['image_url'] = 'https://img.test/lost.png'
        store['found_items'][0]['image_url'] = 'https://img.test/found.png'
        pictures = {'https://img.test/lost.png': picture('#cc2222'), 'https://img.test/found.png': picture('#cc2222')}
        image_match._cache.clear()
        with patch.object(image_match, 'download', side_effect=lambda url: pictures.get(url)):
            row = self.make(store).list_admin_ai_matches()[0]
        self.assertTrue(row['usedImage'])
        self.assertEqual(row['breakdown'][0]['percent'], 100)


if __name__ == '__main__':
    unittest.main()
