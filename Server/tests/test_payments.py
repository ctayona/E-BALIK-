"""Payment confirmation: income counts only after an administrator confirms the payment, and every confirmation issues a receipt."""
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from flask import Flask

from app.utils import receipts
from app.utils.income import IncomeError, IncomeService, IncomeUnavailable
from app.utils.payments import PaymentDesk
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from memdb import MemClient  # noqa: E402

ADMIN = '00000000-0000-0000-0000-0000000000aa'
MARIA = '00000000-0000-0000-0000-000000000001'
JUAN = '00000000-0000-0000-0000-000000000002'
AUCTION = '3f9a12bc-0000-4000-8000-000000000001'
NOW = datetime.now(timezone.utc).isoformat()


def setUpModule():
    """No test may send a real email: the confirmation emails the payer, so the sender is replaced for the whole file."""
    global _mail
    _mail = patch('app.utils.email_service.send_notice_email_best_effort', return_value=True)
    _mail.start()


def tearDownModule():
    _mail.stop()


def make(store=None, **kw):
    store = store if store is not None else {}
    store.setdefault('auctions', [
        {'auction_id': AUCTION, 'title': 'Black laptop', 'item_reference': 'FPOST-1', 'status': 'ended', 'fulfillment_status': 'collected', 'winning_amount': '2500.00', 'winner_account_id': MARIA, 'fulfillment_updated_at': NOW},
        {'auction_id': 'a2', 'title': 'Umbrella', 'status': 'ended', 'fulfillment_status': 'awaiting_pickup', 'winning_amount': '300.00', 'winner_account_id': JUAN, 'ended_at': NOW},
        {'auction_id': 'a3', 'title': 'Forfeited bag', 'status': 'ended', 'fulfillment_status': 'forfeited', 'winning_amount': '900.00', 'winner_account_id': JUAN},
    ])
    store.setdefault('smart_tags', [
        {'tag_id': 'TAGPAID00001', 'status': 'pending_verification', 'price': '150.00', 'paid_at': None, 'is_disabled': False, 'owner_account_id': MARIA, 'item_name': 'Wallet'},
        {'tag_id': 'TAGFREE00002', 'status': 'active', 'price': '0', 'paid_at': None, 'is_disabled': False, 'owner_account_id': MARIA, 'item_name': 'Keys'},
        {'tag_id': 'TAGBLANK0003', 'status': 'blank', 'price': '150.00', 'paid_at': None, 'is_disabled': False, 'owner_account_id': None, 'item_name': None},
        {'tag_id': 'TAGOFF000004', 'status': 'active', 'price': '150.00', 'paid_at': None, 'is_disabled': True, 'owner_account_id': JUAN, 'item_name': 'Old'},
    ])
    store.setdefault('user_profiles', [{'account_id': MARIA, 'fname': 'Maria', 'lname': 'Santos'}, {'account_id': JUAN, 'fname': 'Juan', 'lname': 'Cruz'}, {'account_id': ADMIN, 'fname': 'Ana', 'lname': 'Reyes'}])
    db = MagicMock()
    db.client = MemClient(store, **kw)
    names = {MARIA: ('Maria', 'Santos'), JUAN: ('Juan', 'Cruz'), ADMIN: ('Ana', 'Reyes')}
    db.get_user_by_account_id.side_effect = lambda a: {'account_id': a, 'fname': names.get(a, ('X', 'Y'))[0], 'lname': names.get(a, ('X', 'Y'))[1], 'email': 'p@umak.edu.ph', 'campus_id': 'K1'}
    return db, store


class QueueTests(unittest.TestCase):
    def test_only_real_money_owed_is_queued_and_released_items_come_first(self):
        db, _ = make()
        data = PaymentDesk(db).awaiting()
        refs = [(i['source'], i['source_ref'], i['state']) for i in data['items']]
        self.assertEqual(refs[0], ('auction', AUCTION, 'released'))                     # handed over but not paid: flagged first
        self.assertEqual(sorted(r[1] for r in refs), sorted([AUCTION, 'a2', 'TAGPAID00001']))   # no forfeited, free, blank or disabled
        self.assertEqual((data['totals']['count'], data['totals']['amount'], data['totals']['released_unpaid']), (3, 2950.0, 2500.0))
        self.assertEqual(data['items'][0]['payer_name'], 'Maria Santos')

    def test_nothing_counts_as_income_until_it_is_confirmed(self):
        db, _ = make()
        self.assertEqual(IncomeService(db).summary()['total'], 0.0)
        PaymentDesk(db).confirm('auction', AUCTION, 'cash', '', '', '2500', ADMIN)
        summary = IncomeService(db).summary()
        self.assertEqual((summary['total'], summary['by_source']['auction'], summary['sales'], summary['average_sale']), (2500.0, 2500.0, 1, 2500.0))
        self.assertEqual(summary['pending']['auction'], 300.0)                           # the other auction is still owed
        self.assertEqual(summary['by_method']['cash'], 2500.0)


class ConfirmTests(unittest.TestCase):
    def test_confirming_writes_one_sale_at_the_servers_amount_and_issues_a_receipt(self):
        db, store = make()
        result = PaymentDesk(db).confirm('auction', AUCTION, 'gcash', '  REF 12345 ', ' paid at the desk ', '2,500.00', ADMIN)
        sale = store['income_ledger'][0]
        self.assertEqual((sale['source'], sale['kind'], sale['amount'], sale['payer_account_id'], sale['recorded_by'], sale['method'], sale['payment_reference']),
                         ('auction', 'sale', '2500.00', MARIA, ADMIN, 'gcash', 'REF 12345'))
        self.assertRegex(sale['receipt_no'], r'^PR-\d{8}-AU-3F9A12BC$')
        receipt = result['receipt']
        self.assertEqual((receipt['receipt_no'], receipt['amount'], receipt['released_to'], receipt['released_by'], receipt['reversed']), (sale['receipt_no'], 2500.0, 'Maria Santos', 'Ana Reyes', False))
        self.assertRegex(receipt['code'], r'^[A-Z2-7]{5}-[A-Z2-7]{5}$')
        notice = db.create_user_notification.call_args
        self.assertEqual((notice.args[0], notice.kwargs['notification_type'], notice.kwargs['link_page']), (MARIA, 'receipt', 'receipts'))
        self.assertEqual([i['source_ref'] for i in PaymentDesk(db).awaiting()['items'] if i['source'] == 'auction'], ['a2'])

    def test_a_smart_tag_payment_marks_the_tag_paid(self):
        db, store = make()
        PaymentDesk(db).confirm('smart_tag', 'TAGPAID00001', 'cash', '', '', '150', ADMIN)
        self.assertIsNotNone(next(t for t in store['smart_tags'] if t['tag_id'] == 'TAGPAID00001')['paid_at'])
        self.assertRegex(store['income_ledger'][0]['receipt_no'], r'^PR-\d{8}-TG-TAGPAID00001$')

    def test_the_same_payment_cannot_be_confirmed_twice(self):
        db, store = make()
        desk = PaymentDesk(db)
        desk.confirm('auction', AUCTION, 'cash', '', '', '2500', ADMIN)
        with self.assertRaises(IncomeError) as caught:
            desk.confirm('auction', AUCTION, 'cash', '', '', '2500', ADMIN)
        self.assertEqual((caught.exception.status, caught.exception.code, len(store['income_ledger'])), (409, 'already_confirmed', 1))

    def test_the_rules_for_what_can_be_confirmed(self):
        db, store = make()
        desk = PaymentDesk(db)
        cases = [
            (('auction', AUCTION, 'cheque', '', '', '2500'), 'how the money was paid'),
            (('auction', AUCTION, 'gcash', '12', '', '2500'), 'reference number'),
            (('auction', AUCTION, 'cash', '', '', ''), 'Confirm the amount'),
            (('auction', AUCTION, 'cash', '', '', '2400'), 'not what your screen showed'),
            (('auction', 'a3', 'cash', '', '', '900'), 'no winner payment'),
            (('auction', 'nope', 'cash', '', '', '1'), 'not found'),
            (('smart_tag', 'TAGFREE00002', 'cash', '', '', '1'), 'free'),
            (('smart_tag', 'TAGBLANK0003', 'cash', '', '', '150'), 'Nobody has registered'),
            (('smart_tag', 'TAGOFF000004', 'cash', '', '', '150'), 'disabled'),
            (('other', 'x', 'cash', '', '', '1'), 'auction or a Smart Tag'),
        ]
        for args, text in cases:
            with self.assertRaisesRegex(IncomeError, text):
                desk.confirm(*args, ADMIN)
        self.assertNotIn('income_ledger', store)
        desk.confirm('auction', 'a2', 'cash', '', '', '300', ADMIN)                       # cash needs no reference
        self.assertEqual(len(store['income_ledger']), 1)

    def test_before_the_migration_the_desk_says_what_to_run(self):
        db, _ = make(missing_columns={'income_ledger': ('payment_reference',)})
        with self.assertRaisesRegex(IncomeUnavailable, '20261024'):
            PaymentDesk(db).confirm('auction', AUCTION, 'cash', '', '', '2500', ADMIN)

    def test_status_of_one_item(self):
        db, _ = make()
        desk = PaymentDesk(db)
        self.assertEqual((desk.status('auction', 'a2')['state'], desk.status('auction', 'a2')['amount']), ('awaiting', 300.0))
        self.assertEqual(desk.status('auction', 'a3')['state'], 'none')
        desk.confirm('auction', 'a2', 'cash', '', '', '300', ADMIN)
        self.assertEqual(desk.status('auction', 'a2')['state'], 'confirmed')


class ReverseTests(unittest.TestCase):
    def test_a_reversal_adds_a_linked_refund_and_the_receipt_shows_reversed(self):
        db, store = make()
        desk = PaymentDesk(db)
        sale = desk.confirm('auction', AUCTION, 'cash', '', '', '2500', ADMIN)['entry']
        with self.assertRaisesRegex(IncomeError, 'at least 8'):
            desk.reverse(sale['entry_id'], 'oops', ADMIN)
        result = desk.reverse(sale['entry_id'], 'Paid twice by mistake', ADMIN)
        refund = store['income_ledger'][1]
        self.assertEqual((refund['kind'], refund['amount'], refund['receipt_no'], refund['recorded_by']), ('refund', '-2500.00', sale['receipt_no'], ADMIN))
        self.assertEqual(result['receipt_no'], sale['receipt_no'])
        self.assertEqual(IncomeService(db).summary()['total'], 0.0)
        self.assertEqual(IncomeService(db).summary()['reversals'], 1)
        self.assertTrue(receipts.receipt_for_payment(db, sale['entry_id'])['reversed'])
        entries = IncomeService(db).entries()['entries']
        self.assertEqual([e['reversed'] for e in entries if e['kind'] == 'sale'], [True])
        with self.assertRaises(IncomeError) as again:
            desk.reverse(sale['entry_id'], 'Trying a second time', ADMIN)
        self.assertEqual(again.exception.code, 'already_reversed')
        with self.assertRaises(IncomeError):
            desk.reverse(refund['entry_id'], 'Reversing the reversal', ADMIN)             # only a sale can be reversed


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.db, self.store = make()
        self.sale = PaymentDesk(self.db).confirm('auction', AUCTION, 'maya', 'MAYA-998877', '', '2500', ADMIN)['entry']

    def test_the_payer_sees_it_in_my_receipts_and_nobody_else_does(self):
        mine = [r for r in receipts.list_for_owner(self.db, MARIA) if r['kind'] == 'payment']
        self.assertEqual((len(mine), mine[0]['receipt_no'], mine[0]['amount'], mine[0]['method'], mine[0]['payment_reference']), (1, self.sale['receipt_no'], 2500.0, 'maya', 'MAYA-998877'))
        self.assertEqual([r for r in receipts.list_for_owner(self.db, JUAN) if r['kind'] == 'payment'], [])
        self.assertEqual(receipts.get_for_owner(self.db, MARIA, self.sale['receipt_no'])['code'], mine[0]['code'])

    def test_anyone_can_verify_a_receipt_and_learns_only_the_item_and_the_day(self):
        code = receipts.receipt_for_payment(self.db, self.sale['entry_id'])['code']
        result = receipts.verify(self.db, self.sale['receipt_no'].lower(), code.lower().replace('-', ''))
        self.assertEqual(set(result), {'valid', 'kind', 'item_name', 'released_on', 'reversed'})
        self.assertEqual((result['valid'], result['kind'], result['item_name'], result['reversed']), (True, 'payment', 'Auction: Black laptop', False))
        self.assertNotIn('Maria', str(result))
        self.assertEqual(receipts.verify(self.db, self.sale['receipt_no'], 'AAAAA-BBBBB'), {'valid': False})
        self.assertEqual(receipts.verify(self.db, 'PR-20200101-AU-3F9A12BC', code), {'valid': False})        # right code, wrong day
        self.assertEqual(receipts.verify(self.db, 'PR-20261020-XX-1234', code), {'valid': False})

    def test_a_reversed_receipt_still_verifies_but_says_so(self):
        PaymentDesk(self.db).reverse(self.sale['entry_id'], 'Entered on the wrong auction', ADMIN)
        code = receipts.receipt_for_payment(self.db, self.sale['entry_id'])['code']
        self.assertTrue(receipts.verify(self.db, self.sale['receipt_no'], code)['reversed'])

    def test_a_manual_other_entry_has_no_payment_receipt(self):
        manual = IncomeService(self.db).record_manual({'kind': 'sale', 'source': 'other', 'amount': '50', 'description': 'Lost ID replacement', 'method': 'cash'}, ADMIN)
        self.assertIsNone(receipts.receipt_for_payment(self.db, manual['entry_id']))


class RouteTests(unittest.TestCase):
    def client(self, level='admin', limited=False):
        from Admin.Backend.income import routes
        app = Flask(__name__)
        app.register_blueprint(routes.income_bp, url_prefix='/api/admin')
        self.db, self.store = make()
        self.logged = []

        def require(required_level='admin'):
            if required_level == 'super_admin' and level != 'super_admin':
                raise PermissionError('Super administrator access required')
            return {'account_id': ADMIN, 'email': 'ana@umak.edu.ph', 'access_level': level}
        patchers = (patch.object(routes, '_require_admin', side_effect=require), patch.object(routes, '_service', return_value=(self.db, IncomeService(self.db))),
                    patch.object(routes, '_log_admin_action', side_effect=lambda *a, **k: self.logged.append(a[2])),
                    patch.object(routes.rate_limit, 'allow', return_value=not limited))
        for p in patchers:
            p.start()
            self.addCleanup(p.stop)          # stop only these: patch.stopall() would also stop the file-wide email patch
        return app.test_client()

    def confirm(self, client, **over):
        body = {'source': 'auction', 'source_ref': AUCTION, 'method': 'cash', 'reference': '', 'notes': '', 'expected_amount': '2500'}
        body.update(over)
        return client.post('/api/admin/income/payments/confirm', json=body)

    def test_confirming_returns_the_receipt_without_the_internal_owner_id_and_is_logged(self):
        client = self.client()
        reply = self.confirm(client)
        body = reply.get_json()
        self.assertEqual(reply.status_code, 201)
        self.assertNotIn('owner_id', body['receipt'])
        self.assertEqual(self.logged, ['Confirm Payment'])
        self.assertEqual(self.confirm(client).status_code, 409)
        self.assertEqual(self.confirm(client, expected_amount='1').status_code, 409)

    def test_the_queue_status_receipt_and_log_endpoints(self):
        client = self.client()
        self.assertEqual(client.get('/api/admin/income/payments/awaiting').get_json()['totals']['count'], 3)
        self.assertEqual(client.get(f'/api/admin/income/payments/status?source=auction&ref={AUCTION}').get_json()['state'], 'awaiting')
        entry = self.confirm(client).get_json()['entry']
        receipt = client.get(f"/api/admin/income/entries/{entry['entry_id']}/receipt").get_json()['receipt']
        self.assertEqual((receipt['receipt_no'], 'owner_id' in receipt), (entry['receipt_no'], False))
        self.assertEqual(client.get('/api/admin/income/entries/missing/receipt').status_code, 404)
        self.store.setdefault('user_activity_logs', []).append({'log_id': 'l1', 'module_name': 'Income', 'action': 'Confirm Payment', 'user_name': 'ana', 'created_at': NOW, 'result': 'success'})
        self.store['user_activity_logs'].append({'log_id': 'l2', 'module_name': 'Claims', 'action': 'Other', 'created_at': NOW})
        self.assertEqual([a['action'] for a in client.get('/api/admin/income/activity').get_json()['activity']], ['Confirm Payment'])

    def test_only_super_admins_reverse_and_confirming_is_rate_limited(self):
        client = self.client('admin')
        entry = self.confirm(client).get_json()['entry']
        self.assertEqual(client.post(f"/api/admin/income/entries/{entry['entry_id']}/reverse", json={'reason': 'A long enough reason'}).status_code, 403)
        boss = self.client('super_admin')
        entry = self.confirm(boss).get_json()['entry']
        reply = boss.post(f"/api/admin/income/entries/{entry['entry_id']}/reverse", json={'reason': 'A long enough reason'})
        self.assertEqual(reply.status_code, 200)
        self.assertIn('Reverse Payment', self.logged)
        limited = self.client(limited=True)
        self.assertEqual(self.confirm(limited).status_code, 429)
        self.assertNotIn('income_ledger', self.store)


class NoAutomaticIncomeTests(unittest.TestCase):
    def test_collecting_an_auction_and_approving_a_tag_count_nothing_by_themselves(self):
        from app.utils.auction_db import AuctionService
        db, store = make()
        with patch('app.utils.handover.HandoverService') as handover:
            handover.return_value.clear_auction_pin.return_value = None
            AuctionService(db).set_fulfillment('a2', 'collected', ADMIN)
        self.assertNotIn('income_ledger', store)
        self.assertEqual(IncomeService(db).summary()['total'], 0.0)
        self.assertIn('a2', [i['source_ref'] for i in PaymentDesk(db).awaiting()['items']])     # still waiting for someone to confirm payment


if __name__ == '__main__':
    unittest.main()
