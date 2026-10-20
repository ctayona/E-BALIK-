"""Match alerts, digital handover receipts, search by photo and the monthly office report."""
import io
import unittest
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from PIL import Image, ImageDraw

from app.utils import image_match, match_alerts, monthly_report, receipts

NOW = datetime.now(timezone.utc)
OWNER, OTHER, FINDER = '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003'


class Table:
    def __init__(self, store, name):
        self.store, self.name, self.filters, self.op, self.payload, self.window, self.want_count = store, name, [], 'select', None, None, False

    def select(self, *_a, count=None, **_k):
        self.want_count = bool(count); return self

    def insert(self, payload):
        self.op, self.payload = 'insert', payload; return self

    def update(self, payload):
        self.op, self.payload = 'update', payload; return self

    def eq(self, key, value):
        self.filters.append(lambda r: str(r.get(key)) == str(value)); return self

    def neq(self, key, value):
        self.filters.append(lambda r: str(r.get(key) or '') != str(value)); return self

    def in_(self, key, values):
        self.filters.append(lambda r: r.get(key) in values); return self

    def gte(self, key, value):
        self.filters.append(lambda r: r.get(key) is not None and str(r.get(key)) >= str(value)); return self

    def lt(self, key, value):
        self.filters.append(lambda r: r.get(key) is not None and str(r.get(key)) < str(value)); return self

    def order(self, *_a, **_k):
        return self

    def limit(self, _n):
        return self

    def range(self, start, end):
        self.window = (start, end); return self

    def execute(self):
        if self.name in self.store.get('missing', ()):
            raise Exception(f'relation "{self.name}" does not exist')
        rows = self.store.setdefault(self.name, [])
        if self.op == 'insert':
            rows.append(dict(self.payload)); return SimpleNamespace(data=[self.payload], count=1)
        matched = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == 'update':
            for row in matched:
                row.update(self.payload)
            return SimpleNamespace(data=matched, count=len(matched))
        total = len(matched)
        if self.window:
            matched = matched[self.window[0]:self.window[1] + 1]
        return SimpleNamespace(data=[dict(r) for r in matched], count=total if self.want_count else None)


def make_db(store, profiles=None):
    profiles = profiles or {}
    db = MagicMock()
    db.client = SimpleNamespace(table=lambda name: Table(store, name))
    db.get_user_by_account_id.side_effect = lambda account_id: profiles.get(str(account_id))
    db.create_user_notification.side_effect = lambda user_id, title, message, **kw: store.setdefault('user_notifications', []).append(
        {'user_account_id': user_id, 'title': title, 'message': message, 'found_item_id': kw.get('found_item_id'), 'missing_report_id': kw.get('missing_report_id'), 'notification_type': kw.get('notification_type'), 'created_at': NOW.isoformat()})
    return db


LAPTOP_FOUND = {'item_id': 'f1', 'fpost_id': 'FP1', 'account_id': FINDER, 'item_name': 'Black Dell laptop', 'category': 'Electronics', 'description': 'Dell laptop with UMak sticker', 'location': 'Library 2F', 'found_date': NOW.date().isoformat(), 'status': 'unclaimed'}


def lost(item_id, owner, name, category='Electronics', place='Library 2F', **extra):
    return {'item_id': item_id, 'mpost_id': f'MP{item_id}', 'account_id': owner, 'item_name': name, 'category': category, 'description': f'{name} with a UMak sticker', 'distinctive_marks': '',
            'last_location': place, 'last_seen_date': NOW.date().isoformat(), 'status': 'missing', **extra}


class MatchAlertTests(unittest.TestCase):
    def test_the_owner_of_a_matching_lost_report_is_alerted_once(self):
        store = {'missing_items': [lost('m1', OWNER, 'Black Dell laptop'), lost('m2', OTHER, 'Blue umbrella', 'Others', 'Gym')]}
        db = make_db(store, {OWNER: {'account_id': OWNER, 'fname': 'Maria', 'email': 'maria@umak.edu.ph'}})
        with patch('app.utils.email_service.send_notice_email_best_effort', return_value=True) as mail:
            self.assertEqual(match_alerts.alert_for_new_found_item(db, LAPTOP_FOUND), 1)
            self.assertEqual(match_alerts.alert_for_new_found_item(db, LAPTOP_FOUND), 0)     # the same pair is never alerted twice
        notices = store['user_notifications']
        self.assertEqual((len(notices), notices[0]['user_account_id'], notices[0]['notification_type']), (1, OWNER, 'match_alert'))
        self.assertNotIn(FINDER, notices[0]['message'])                                      # nothing about the finder
        mail.assert_called_once()
        self.assertIn('/api/email/unsubscribe', mail.call_args.kwargs['unsubscribe_url'])

    def test_the_finders_own_lost_report_is_not_alerted_and_email_respects_the_choice(self):
        store = {'missing_items': [lost('m1', FINDER, 'Black Dell laptop'), lost('m3', OWNER, 'Black Dell laptop')]}
        db = make_db(store, {OWNER: {'account_id': OWNER, 'email': 'maria@umak.edu.ph', 'email_preferences': {'matches': False}}})
        with patch('app.utils.email_service.send_notice_email_best_effort', return_value=True) as mail:
            self.assertEqual(match_alerts.alert_for_new_found_item(db, LAPTOP_FOUND), 1)
        self.assertEqual([n['user_account_id'] for n in store['user_notifications']], [OWNER])
        mail.assert_not_called()                                                              # the in-app alert stays, the email is off

    def test_a_new_lost_report_hears_about_items_already_at_the_office(self):
        store = {'found_items': [LAPTOP_FOUND, {**LAPTOP_FOUND, 'item_id': 'f2', 'fpost_id': 'FP2', 'item_name': 'Pink bottle', 'category': 'Others', 'location': 'Gym', 'description': 'bottle'}]}
        db = make_db(store, {OWNER: {'account_id': OWNER, 'email': 'maria@umak.edu.ph'}})
        with patch('app.utils.email_service.send_notice_email_best_effort', return_value=True):
            self.assertEqual(match_alerts.alert_for_new_missing_report(db, lost('m1', OWNER, 'Black Dell laptop')), 1)
            self.assertEqual(match_alerts.alert_for_new_missing_report(db, lost('m1', OWNER, 'Black Dell laptop')), 0)
        self.assertIn('Black Dell laptop', store['user_notifications'][0]['message'])

    def test_a_weak_match_and_a_broken_database_do_nothing(self):
        store = {'missing_items': [lost('m4', OWNER, 'Red scarf', 'Clothing', 'Canteen')]}
        self.assertEqual(match_alerts.alert_for_new_found_item(make_db(store), LAPTOP_FOUND), 0)
        broken = make_db({'missing': ('missing_items',)})
        self.assertEqual(match_alerts.alert_for_new_found_item(broken, LAPTOP_FOUND), 0)       # never raises into the report that caused it


def claim(**extra):
    return {'claim_id': 'c1', 'claim_reference': 'CL-0007', 'found_item_id': 'f1', 'claimant_account_id': OWNER, 'status': 'collected',
            'collected_at': '2026-10-19T16:30:00+00:00', 'updated_at': '2026-10-19T16:30:00+00:00', 'released_by': FINDER, **extra}


class ReceiptTests(unittest.TestCase):
    def setup(self):
        store = {'claims': [claim()], 'found_items': [LAPTOP_FOUND], 'auctions': []}
        profiles = {OWNER: {'account_id': OWNER, 'fname': 'Maria', 'lname': 'Santos', 'campus_id': 'K1'}, FINDER: {'account_id': FINDER, 'fname': 'Gus', 'lname': 'Guard'}}
        return store, make_db(store, profiles)

    def test_the_owner_gets_a_numbered_receipt_with_a_code(self):
        store, db = self.setup()
        listed = receipts.list_for_owner(db, OWNER)
        self.assertEqual(len(listed), 1)
        receipt = listed[0]
        self.assertEqual(receipt['receipt_no'], 'HR-20261020-CL-0007')                      # 16:30 UTC on the 19th is the 20th in Manila
        self.assertRegex(receipt['code'], r'^[A-Z2-7]{5}-[A-Z2-7]{5}$')
        self.assertEqual((receipt['item']['name'], receipt['released_to'], receipt['released_by']), ('Black Dell laptop', 'Maria Santos', 'Gus Guard'))
        self.assertEqual(receipts.get_for_owner(db, OWNER, 'hr-20261020-cl-0007')['code'], receipt['code'])

    def test_only_the_owner_can_open_it(self):
        _, db = self.setup()
        with self.assertRaises(receipts.ReceiptError):
            receipts.get_for_owner(db, OTHER, 'HR-20261020-CL-0007')
        self.assertEqual(receipts.list_for_owner(db, OTHER), [])

    def test_verification_confirms_the_item_and_the_day_but_no_person(self):
        _, db = self.setup()
        receipt = receipts.list_for_owner(db, OWNER)[0]
        result = receipts.verify(db, receipt['receipt_no'], receipt['code'].lower().replace('-', ' '))
        self.assertEqual(result, {'valid': True, 'kind': 'claim', 'item_name': 'Black Dell laptop', 'released_on': 'October 20, 2026'})
        self.assertNotIn('Maria', str(result))

    def test_a_wrong_code_a_wrong_number_and_an_unreleased_claim_are_not_valid(self):
        store, db = self.setup()
        receipt = receipts.list_for_owner(db, OWNER)[0]
        self.assertEqual(receipts.verify(db, receipt['receipt_no'], 'AAAAA-AAAAA'), {'valid': False})
        self.assertEqual(receipts.verify(db, 'HR-20261020-CL-9999', receipt['code']), {'valid': False})
        self.assertEqual(receipts.verify(db, 'HR-20261101-CL-0007', receipt['code']), {'valid': False})   # the right claim, the wrong day
        store['claims'][0]['status'] = 'approved_for_pickup'
        self.assertEqual(receipts.verify(db, receipt['receipt_no'], receipt['code']), {'valid': False})
        for bad in (('nonsense', 'x'), ('', ''), ('HR-20261020-CL-0007', '123')):
            with self.assertRaises(receipts.ReceiptError):
                receipts.verify(db, *bad)

    def test_an_auction_win_that_was_collected_has_a_receipt_with_the_amount(self):
        store, db = self.setup()
        store['claims'] = []
        store['auctions'] = [{'auction_id': 'abcdef12-0000-0000-0000-000000000000', 'title': 'Phone', 'item_reference': 'FP9', 'winning_amount': '1500.00', 'winner_account_id': OWNER,
                              'fulfillment_status': 'collected', 'fulfillment_updated_at': '2026-10-19T16:30:00+00:00'}]
        receipt = receipts.list_for_owner(db, OWNER)[0]
        self.assertEqual((receipt['kind'], receipt['receipt_no'], receipt['amount']), ('auction', 'AR-20261020-ABCDEF12', 1500.0))
        self.assertTrue(receipts.verify(db, receipt['receipt_no'], receipt['code'])['valid'])


def picture(color, size=(240, 180), square=None, background=(235, 235, 235), fmt='JPEG'):
    image = Image.new('RGB', size, background)
    draw = ImageDraw.Draw(image)
    box = square or (60, 40, 180, 140)
    draw.rectangle(box, fill=color)
    buffer = io.BytesIO()
    image.save(buffer, fmt)
    return buffer.getvalue()


class PhotoSearchTests(unittest.TestCase):
    def test_the_same_object_matches_best_and_a_different_one_matches_less(self):
        red = image_match.fingerprint(picture((200, 30, 30)))
        red_bigger = image_match.fingerprint(picture((200, 30, 30), size=(480, 360), square=(120, 80, 360, 280), fmt='PNG'))
        blue = image_match.fingerprint(picture((30, 60, 200)))
        green_tall = image_match.fingerprint(picture((20, 160, 60), square=(10, 10, 80, 170)))
        self.assertGreater(image_match.similarity(red, red_bigger), 0.85)
        self.assertGreater(image_match.similarity(red, red_bigger), image_match.similarity(red, blue))
        self.assertLess(image_match.similarity(red, green_tall), image_match.similarity(red, red_bigger))
        self.assertEqual(image_match.similarity(red, red), 1.0)

    def test_colourless_items_compare_by_brightness(self):
        black = image_match.fingerprint(picture((10, 10, 10), background=(15, 15, 15)))
        dark = image_match.fingerprint(picture((25, 25, 25), background=(20, 20, 20)))
        white = image_match.fingerprint(picture((250, 250, 250), background=(245, 245, 245)))
        self.assertGreater(image_match.similarity(black, dark), image_match.similarity(black, white))

    def test_unreadable_and_huge_images_are_refused(self):
        self.assertIsNone(image_match.fingerprint(b'not an image'))
        self.assertIsNone(image_match.fingerprint(b''))
        with patch.object(image_match, 'MAX_PIXELS', 100):
            self.assertIsNone(image_match.fingerprint(picture((1, 2, 3))))

    def test_search_ranks_open_items_with_photos_and_fills_in_missing_fingerprints(self):
        red = picture((200, 30, 30))
        store = {'found_items': [
            {'item_id': 'a', 'fpost_id': 'FP1', 'item_name': 'Red bag', 'category': 'Bags', 'location': 'Library', 'found_date': '2026-10-01', 'image_url': 'https://x/red.jpg', 'status': 'unclaimed', 'image_features': image_match.fingerprint(picture((190, 40, 40), size=(300, 225), square=(75, 50, 225, 175)))},
            {'item_id': 'b', 'fpost_id': 'FP2', 'item_name': 'Blue bottle', 'category': 'Others', 'location': 'Gym', 'found_date': '2026-10-02', 'image_url': 'https://x/blue.jpg', 'status': 'unclaimed', 'image_features': None},
            {'item_id': 'c', 'fpost_id': 'FP3', 'item_name': 'No photo', 'category': 'Others', 'location': 'Gym', 'found_date': '2026-10-02', 'image_url': '', 'status': 'unclaimed'},
            {'item_id': 'd', 'fpost_id': 'FP4', 'item_name': 'Already returned', 'category': 'Bags', 'location': 'Gym', 'found_date': '2026-10-02', 'image_url': 'https://x/r.jpg', 'status': 'returned'},
        ]}
        db = make_db(store)
        with patch.object(image_match, 'download', return_value=picture((30, 60, 200))) as fetch:
            outcome = image_match.search(db, red)
        self.assertEqual(fetch.call_count, 1)                                                # only the item without a fingerprint was fetched
        self.assertEqual(outcome['results'][0]['reference'], 'FP1')
        self.assertGreater(outcome['results'][0]['similarity'], 60)
        self.assertNotIn('FP3', [r['reference'] for r in outcome['results']])
        self.assertNotIn('FP4', [r['reference'] for r in outcome['results']])
        self.assertIsNotNone(store['found_items'][1]['image_features'])                      # remembered for next time
        self.assertEqual(set(outcome['results'][0]), {'reference', 'item_name', 'category', 'location', 'found_date', 'image_url', 'similarity'})   # nothing about who found it

    def test_the_search_works_before_the_migration(self):
        store = {'found_items': [{'item_id': 'a', 'fpost_id': 'FP1', 'item_name': 'Red bag', 'category': 'Bags', 'location': 'Library', 'found_date': '2026-10-01', 'image_url': 'https://x/red.jpg', 'status': 'unclaimed'}]}
        db = make_db(store)
        real_table = db.client.table

        def table(name):
            builder = real_table(name)
            original = builder.select
            builder.select = lambda columns, **kw: (_ for _ in ()).throw(Exception('column found_items.image_features does not exist')) if 'image_features' in columns else original(columns, **kw)
            return builder
        db.client = SimpleNamespace(table=table)
        image_match._cache.clear()
        with patch.object(image_match, 'download', return_value=picture((200, 30, 30))):
            outcome = image_match.search(db, picture((200, 30, 30)))
        self.assertEqual(outcome['results'][0]['reference'], 'FP1')


class MonthlyReportTests(unittest.TestCase):
    def store(self):
        octo = '2026-10-10T04:00:00+00:00'
        sept = '2026-09-10T04:00:00+00:00'
        return {
            'found_items': [{'item_id': 'f1', 'category': 'Electronics', 'location': 'Library', 'status': 'unclaimed', 'created_at': octo}, {'item_id': 'f2', 'category': 'Electronics', 'location': 'Library', 'status': 'returned', 'created_at': octo},
                            {'item_id': 'f3', 'category': 'Bags', 'location': 'Gym', 'status': 'unclaimed', 'created_at': sept}],
            'missing_items': [{'item_id': 'm1', 'category': 'Electronics', 'last_location': 'Library', 'created_at': octo}],
            'claims': [{'claim_id': 'c1', 'status': 'collected', 'created_at': '2026-10-08T04:00:00+00:00', 'collected_at': '2026-10-12T04:00:00+00:00'},
                       {'claim_id': 'c2', 'status': 'pending', 'created_at': octo, 'collected_at': None}],
            'income_ledger': [{'source': 'auction', 'kind': 'sale', 'amount': '1500.00', 'received_at': octo}, {'source': 'smart_tag', 'kind': 'sale', 'amount': '150.00', 'received_at': octo},
                              {'source': 'auction', 'kind': 'refund', 'amount': '-200.00', 'received_at': octo}, {'source': 'auction', 'kind': 'sale', 'amount': '900.00', 'received_at': sept}],
            'user_notifications': [{'notification_type': 'match_alert', 'created_at': octo}, {'notification_type': 'claim', 'created_at': octo}],
            'smart_tags': [{'tag_id': 'T1', 'claimed_at': octo}],
        }

    def test_the_month_with_comparison(self):
        report = monthly_report.build(make_db(self.store()), '2026-10', today=date(2026, 10, 20))
        figures = report['figures']
        self.assertEqual((figures['found_received'], figures['lost_filed'], figures['returned'], figures['claims_filed']), (2, 1, 1, 2))
        self.assertEqual(figures['income']['total'], 1450.0)
        self.assertEqual((figures['income']['auctions_sold'], figures['income']['tags_sold'], figures['income']['refunds']), (1, 1, -200.0))
        self.assertEqual(report['previous']['found_received'], 1)
        self.assertEqual(report['changes']['found_received'], 100.0)
        self.assertEqual(report['claims']['average_days_to_return'], 4.0)
        self.assertEqual(report['intake']['found_by_category'][0], {'name': 'Electronics', 'count': 2})
        self.assertEqual(report['match_alerts'], {'sent': 1})
        self.assertEqual(report['smart_tags']['registered'], 1)
        self.assertEqual(sum(b['count'] for b in report['waiting']['buckets']), report['waiting']['total'])

    def test_a_missing_table_leaves_only_that_section_out(self):
        store = self.store()
        store['missing'] = ('income_ledger', 'smart_tags')
        report = monthly_report.build(make_db(store), '2026-10', today=date(2026, 10, 20))
        self.assertIsNone(report['figures']['income'])
        self.assertIsNone(report['smart_tags'])
        self.assertEqual(report['figures']['found_received'], 2)

    def test_month_rules_and_csv(self):
        today = date(2026, 10, 20)
        self.assertEqual(monthly_report.parse_month('', today), date(2026, 10, 1))
        for bad in ('2026-13', 'October', '2027-01', '2019-12'):
            with self.assertRaises(ValueError):
                monthly_report.parse_month(bad, today)
        report = monthly_report.build(make_db(self.store()), '2026-10', today=today)
        text = monthly_report.to_csv(report)
        self.assertIn('Found items received,2', text)
        self.assertIn('Total income (PHP),1450.00', text)
        self.assertTrue(text.startswith('E-Balik monthly report,October 2026'))


class RouteTests(unittest.TestCase):
    def test_the_receipt_verification_is_public_and_throttled(self):
        from flask import Flask
        from Users.Backend.receipts import routes
        from app.utils import rate_limit
        rate_limit.reset()
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
        app.register_blueprint(routes.receipts_bp, url_prefix='/api/receipts')
        client = app.test_client()
        with patch.object(routes, '_db', return_value=make_db({'claims': [], 'found_items': []})):
            first = client.post('/api/receipts/verify', json={'receipt_no': 'HR-20261020-CL-0007', 'code': 'AAAAA-AAAAA'})
            self.assertEqual((first.status_code, first.get_json()), (200, {'valid': False}))
            self.assertEqual(client.get('/api/receipts').status_code, 401)                  # the list itself needs a login
            codes = [client.post('/api/receipts/verify', json={'receipt_no': 'HR-20261020-CL-0007', 'code': 'AAAAA-AAAAA'}).status_code for _ in range(25)]
        self.assertEqual(codes[-1], 429)


if __name__ == '__main__':
    unittest.main()
