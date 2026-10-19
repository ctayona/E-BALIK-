"""Income ledger: one sale per auction or tag, manual entries by super admins, summaries, and the Smart Tag price flow."""
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from flask import Flask

from app.utils.income import IncomeError, IncomeService, parse_tag_price
from app.utils.smart_tags import SmartTagService, TagError

ADMIN = '00000000-0000-0000-0000-0000000000aa'
OWNER = '00000000-0000-0000-0000-000000000001'


class Table:
    def __init__(self, store, name):
        self.store, self.name = store, name
        self.filters, self.op, self.payload, self.max_rows, self.order_key = [], 'select', None, None, None

    def select(self, *_a, **_k):
        return self

    def insert(self, payload):
        self.op, self.payload = 'insert', payload
        return self

    def update(self, payload):
        self.op, self.payload = 'update', payload
        return self

    def eq(self, key, value):
        self.filters.append(lambda r: str(r.get(key)) == str(value))
        return self

    def is_(self, key, _value):
        self.filters.append(lambda r: r.get(key) is None)
        return self

    def in_(self, key, values):
        self.filters.append(lambda r: r.get(key) in values)
        return self

    def gte(self, key, value):
        self.filters.append(lambda r: str(r.get(key)) >= str(value))
        return self

    def lt(self, key, value):
        self.filters.append(lambda r: str(r.get(key)) < str(value))
        return self

    def order(self, key, desc=False):
        self.order_key = (key, desc)
        return self

    def limit(self, n):
        self.max_rows = n
        return self

    def range(self, start, end):
        return self

    def execute(self):
        if self.name in self.store.get('missing_tables', ()):
            raise Exception(f'relation "public.{self.name}" does not exist (42P01)')
        rows = self.store.setdefault(self.name, [])
        if self.op == 'insert':
            new = self.payload if isinstance(self.payload, list) else [self.payload]
            for row in new:
                if self.name == 'income_ledger' and row.get('kind') == 'sale' and any(
                        r.get('kind') == 'sale' and r.get('source') == row.get('source') and r.get('source_ref') == row.get('source_ref') for r in rows):
                    raise Exception('duplicate key value violates unique constraint "uq_income_one_sale" (23505)')
                rows.append({'entry_id': f'e{len(rows) + 1}', **row})
            return SimpleNamespace(data=[dict(rows[-1])] if self.name == 'income_ledger' else new)
        matched = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == 'update':
            for row in matched:
                row.update(self.payload)
            return SimpleNamespace(data=[dict(r) for r in matched])
        if self.order_key:
            key, desc = self.order_key
            matched = sorted(matched, key=lambda r: str(r.get(key)), reverse=desc)
        if self.max_rows is not None:
            matched = matched[:self.max_rows]
        return SimpleNamespace(data=[dict(r) for r in matched])


def make_db(store):
    db = MagicMock()
    db.client = SimpleNamespace(table=lambda name: Table(store, name))
    db.get_user_by_account_id.side_effect = lambda account_id: {'account_id': account_id, 'fname': 'Maria', 'lname': 'Santos', 'email': 'm@umak.edu.ph'}
    db._decrypt_profile_sensitive_fields = lambda user: None
    return db


class RecordSaleTests(unittest.TestCase):
    def test_a_sale_is_recorded_once(self):
        store = {}
        service = IncomeService(make_db(store))
        first = service.record_sale('auction', 'A1', '1500', 'Auction: laptop', payer_account_id=OWNER, recorded_by=ADMIN)
        second = service.record_sale('auction', 'A1', '1500', 'Auction: laptop')
        self.assertEqual(len(store['income_ledger']), 1)
        self.assertEqual(first['amount'], '1500.00')
        self.assertEqual(second['entry_id'], first['entry_id'])

    def test_a_missing_table_never_breaks_the_sale(self):
        service = IncomeService(make_db({'missing_tables': ('income_ledger',)}))
        self.assertIsNone(service.record_sale('auction', 'A1', 100, 'Auction'))

    def test_zero_and_nonsense_amounts_are_not_recorded(self):
        store = {}
        service = IncomeService(make_db(store))
        self.assertIsNone(service.record_sale('auction', 'A1', 0, 'x'))
        self.assertIsNone(service.record_sale('auction', 'A2', 'free', 'x'))
        self.assertNotIn('income_ledger', store)


class ManualEntryTests(unittest.TestCase):
    def setUp(self):
        self.store = {}
        self.service = IncomeService(make_db(self.store))

    def test_a_refund_is_stored_negative_with_its_reason(self):
        entry = self.service.record_manual({'kind': 'refund', 'source': 'auction', 'amount': '200', 'description': 'Refund for A1', 'notes': 'Item was damaged'}, ADMIN)
        self.assertEqual(entry['amount'], '-200.00')
        self.assertEqual(entry['recorded_by'], ADMIN)

    def test_an_adjustment_keeps_its_sign(self):
        self.assertEqual(self.service.record_manual({'kind': 'adjustment', 'source': 'smart_tag', 'amount': '-50', 'description': 'Correction', 'notes': 'Wrong price typed'}, ADMIN)['amount'], '-50.00')
        self.assertEqual(self.service.record_manual({'kind': 'adjustment', 'source': 'smart_tag', 'amount': '50', 'description': 'Correction', 'notes': 'Price fixed later'}, ADMIN)['amount'], '50.00')

    def test_rules(self):
        bad = [
            {'kind': 'sale', 'source': 'auction', 'amount': '10', 'description': 'Manual auction sale'},          # automatic only
            {'kind': 'refund', 'source': 'auction', 'amount': '10', 'description': 'Refund', 'notes': ''},          # reason needed
            {'kind': 'gift', 'source': 'other', 'amount': '10', 'description': 'Donation'},                        # unknown kind
            {'kind': 'sale', 'source': 'other', 'amount': '0', 'description': 'Donation box'},                      # zero
            {'kind': 'sale', 'source': 'other', 'amount': '10', 'description': 'Donation box', 'received_on': '2999-01-01'},  # future
        ]
        for payload in bad:
            with self.assertRaises(IncomeError, msg=payload):
                self.service.record_manual(payload, ADMIN)
        self.assertNotIn('income_ledger', self.store)
        self.assertEqual(self.service.record_manual({'kind': 'sale', 'source': 'other', 'amount': '1,250.5', 'description': 'Donation box'}, ADMIN)['amount'], '1250.50')


class SummaryTests(unittest.TestCase):
    def test_totals_by_source_month_and_what_is_still_owed(self):
        now = datetime.now(timezone.utc)
        store = {
            'income_ledger': [
                {'source': 'auction', 'kind': 'sale', 'amount': '1500.00', 'received_at': now.isoformat()},
                {'source': 'smart_tag', 'kind': 'sale', 'amount': '150.00', 'received_at': now.isoformat()},
                {'source': 'auction', 'kind': 'refund', 'amount': '-200.00', 'received_at': now.isoformat()},
                {'source': 'auction', 'kind': 'sale', 'amount': '999.00', 'received_at': (now - timedelta(days=800)).isoformat()},  # outside the range
            ],
            'auctions': [{'fulfillment_status': 'awaiting_pickup', 'winning_amount': '700'}],
            'smart_tags': [
                {'status': 'blank', 'price': '150', 'is_disabled': False},
                {'status': 'blank', 'price': '150', 'is_disabled': False},
                {'status': 'pending_verification', 'price': '150', 'paid_at': None, 'is_disabled': False},
                {'status': 'blank', 'price': '0', 'is_disabled': False},
            ],
        }
        result = IncomeService(make_db(store)).summary()
        self.assertEqual(result['total'], 1450.0)
        self.assertEqual(result['by_source'], {'auction': 1300.0, 'smart_tag': 150.0, 'other': 0.0})
        self.assertEqual(result['refunds'], -200.0)
        self.assertEqual(result['this_month'], 1450.0)
        self.assertEqual(len(result['by_month']), 12)
        self.assertEqual(result['pending']['auction'], 700.0)
        self.assertEqual((result['pending']['smart_tag'], result['pending']['stock_value'], result['pending']['stock_count']), (150.0, 300.0, 2))

    def test_the_csv_has_a_row_per_entry(self):
        store = {'income_ledger': [{'source': 'auction', 'kind': 'sale', 'amount': '10.00', 'description': 'Auction: pen', 'received_at': datetime.now(timezone.utc).isoformat()}]}
        text = IncomeService(make_db(store)).csv_export()
        self.assertEqual(len(text.strip().splitlines()), 2)
        self.assertIn('Auction Hall', text)


class TagPriceTests(unittest.TestCase):
    def test_price_parsing(self):
        self.assertEqual(str(parse_tag_price('')), '0.00')
        self.assertEqual(str(parse_tag_price('149.999')), '150.00')
        for bad in ('-1', 'abc', '100001'):
            with self.assertRaises(IncomeError):
                parse_tag_price(bad)

    def test_a_priced_batch_stores_the_price_on_every_tag(self):
        store = {'smart_tags': []}
        batch = SmartTagService(make_db(store)).create_batch(3, 'Sept', ADMIN, 'qr', None, '150')
        self.assertEqual((batch['price'], batch['stock_value']), (150.0, 450.0))
        self.assertEqual({row['price'] for row in store['smart_tags']}, {'150.00'})

    def test_a_free_batch_does_not_need_the_price_column(self):
        store = {'smart_tags': []}
        SmartTagService(make_db(store)).create_batch(2, 'Free', ADMIN, 'qr', None, '')
        self.assertTrue(all('price' not in row for row in store['smart_tags']))

    def test_a_bad_price_is_refused_before_anything_is_saved(self):
        store = {'smart_tags': []}
        with self.assertRaises(TagError):
            SmartTagService(make_db(store)).create_batch(2, 'x', ADMIN, 'qr', None, '-5')
        self.assertEqual(store['smart_tags'], [])

    def pending_tag(self, **extra):
        return {'tag_id': 'ABCDEFGHJK23', 'status': 'pending_verification', 'prior_status': None, 'owner_account_id': OWNER, 'item_name': 'Laptop',
                'price': '150.00', 'paid_at': None, 'validity_months': None, **extra}

    def test_first_approval_records_the_sale_and_marks_the_tag_paid(self):
        store = {'smart_tags': [self.pending_tag()]}
        SmartTagService(make_db(store)).approve('ABCDEFGHJK23', ADMIN)
        entry = store['income_ledger'][0]
        self.assertEqual((entry['source'], entry['source_ref'], entry['amount'], entry['payer_account_id']), ('smart_tag', 'ABCDEFGHJK23', '150.00', OWNER))
        self.assertIsNotNone(store['smart_tags'][0]['paid_at'])

    def test_a_new_photo_or_a_free_tag_records_nothing(self):
        for tag in (self.pending_tag(prior_status='active'), self.pending_tag(price='0'), self.pending_tag(paid_at='2026-10-01T00:00:00+00:00')):
            store = {'smart_tags': [tag]}
            SmartTagService(make_db(store)).approve('ABCDEFGHJK23', ADMIN)
            self.assertNotIn('income_ledger', store)

    def test_changing_a_batch_price_only_touches_unsold_tags(self):
        batch = '11111111-1111-1111-1111-111111111111'
        store = {'smart_tags': [{'tag_id': 'T1', 'batch_id': batch, 'status': 'blank', 'price': '100'}, {'tag_id': 'T2', 'batch_id': batch, 'status': 'active', 'price': '100'}]}
        result = SmartTagService(make_db(store)).set_batch_price(batch, '120', ADMIN)
        self.assertEqual(result['updated'], 1)
        self.assertEqual([row['price'] for row in store['smart_tags']], ['120.00', '100'])


class AuctionIncomeTests(unittest.TestCase):
    """Collecting a sold auction (by staff, or the guard with the pickup PIN) writes the sale; a forfeit writes nothing."""

    def run_fulfillment(self, action):
        from app.utils.auction_db import AuctionService
        store = {'auctions': [{'auction_id': 'A1', 'title': 'Black laptop', 'fulfillment_status': 'awaiting_pickup', 'winning_amount': '2500.00',
                               'winner_account_id': OWNER, 'found_item_id': None}]}
        service = AuctionService(make_db(store))
        with patch('app.utils.handover.HandoverService') as handover:
            handover.return_value.clear_auction_pin.return_value = None
            service.set_fulfillment('A1', action, ADMIN)
        return store

    def test_collected_records_the_winning_amount(self):
        entry = self.run_fulfillment('collected')['income_ledger'][0]
        self.assertEqual((entry['source'], entry['source_ref'], entry['amount'], entry['payer_account_id'], entry['recorded_by']), ('auction', 'A1', '2500.00', OWNER, ADMIN))

    def test_forfeited_records_nothing(self):
        self.assertNotIn('income_ledger', self.run_fulfillment('forfeited'))


class RouteTests(unittest.TestCase):
    def client(self, level):
        from Admin.Backend.income import routes
        app = Flask(__name__)
        app.config.update(SUPABASE_URL='http://unused', SUPABASE_SERVICE_KEY='unused')
        app.register_blueprint(routes.income_bp, url_prefix='/api/admin')

        def require(required_level='admin'):
            if required_level == 'super_admin' and level != 'super_admin':
                raise PermissionError('Super administrator access required')
            return {'account_id': ADMIN, 'email': 'a@umak.edu.ph'}
        store = {}
        return app.test_client(), patch.object(routes, '_require_admin', side_effect=require), patch.object(routes, 'get_db', return_value=make_db(store)), store

    def test_only_super_admins_add_entries(self):
        client, auth, db, store = self.client('admin')
        with auth, db:
            reply = client.post('/api/admin/income/entries', json={'kind': 'sale', 'source': 'other', 'amount': '10', 'description': 'Donation box'})
        self.assertEqual(reply.status_code, 403)
        client, auth, db, store = self.client('super_admin')
        with auth, db:
            reply = client.post('/api/admin/income/entries', json={'kind': 'sale', 'source': 'other', 'amount': '10', 'description': 'Donation box'})
        self.assertEqual(reply.status_code, 201)

    def test_setup_required_before_the_migration(self):
        client, auth, db, store = self.client('admin')
        store['missing_tables'] = ('income_ledger',)
        with auth, db:
            reply = client.get('/api/admin/income/summary')
        self.assertEqual((reply.status_code, reply.get_json()['code']), (503, 'setup_required'))


if __name__ == '__main__':
    unittest.main()
