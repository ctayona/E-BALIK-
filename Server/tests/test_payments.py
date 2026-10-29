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
PNG = b'\x89PNG\r\n\x1a\n' + b'0' * 64          # starts like a real PNG: that is all the upload check looks at


class FakeBucket:
    def __init__(self, files):
        self.files = files

    def upload(self, path, data, options=None):
        self.files[path] = data

    def remove(self, paths):
        for path in paths:
            self.files.pop(path, None)

    def create_signed_url(self, path, seconds):
        return {'signedURL': f'https://signed.test/{path}'} if path in self.files else {}


class FakeStorage:
    def __init__(self):
        self.files = {}

    def from_(self, bucket):
        return FakeBucket(self.files)


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
    db.client.storage = FakeStorage()
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
        result = PaymentDesk(db).confirm('auction', AUCTION, 'gcash', '  REF 12345 ', ' paid at the desk ', '2,500.00', ADMIN, proof_data=PNG)
        sale = store['income_ledger'][0]
        self.assertEqual((sale['source'], sale['kind'], sale['amount'], sale['payer_account_id'], sale['recorded_by'], sale['method'], sale['payment_reference']),
                         ('auction', 'sale', '2500.00', MARIA, ADMIN, 'gcash', 'REF 12345'))
        self.assertTrue(sale['proof_path'].endswith('.png'))          # the receipt image is kept with the sale, privately
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
            (('auction', AUCTION, 'gcash', 'REF-12345', '', '2500'), "payer's payment receipt"),
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
        self.assertEqual(store.get('income_ledger', []), [])
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
        self.sale = PaymentDesk(self.db).confirm('auction', AUCTION, 'maya', 'MAYA-998877', '', '2500', ADMIN, proof_data=PNG)['entry']

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
        self.spent = []

        def require(required_level='admin'):
            if required_level == 'super_admin' and level != 'super_admin':
                raise PermissionError('Super administrator access required')
            return {'account_id': ADMIN, 'email': 'ana@umak.edu.ph', 'access_level': level}
        patchers = (patch.object(routes, '_require_admin', side_effect=require), patch.object(routes, '_service', return_value=(self.db, IncomeService(self.db))),
                    patch.object(routes, '_log_admin_action', side_effect=lambda *a, **k: self.logged.append(a[2])),
                    patch.object(routes.rate_limit, 'allow', return_value=not limited),
                    patch.object(routes, 'consume_authenticator_code', side_effect=lambda db, account, code, action: self.spent.append((code, action)) or 1))
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
        reply = boss.post(f"/api/admin/income/entries/{entry['entry_id']}/reverse", json={'reason': 'A long enough reason', 'authenticator_code': '123456'})
        self.assertEqual(reply.status_code, 200)
        self.assertIn('Reverse Payment', self.logged)
        limited = self.client(limited=True)
        self.assertEqual(self.confirm(limited).status_code, 429)
        self.assertNotIn('income_ledger', self.store)


class NoAutomaticIncomeTests(unittest.TestCase):
    def test_collecting_needs_a_confirmed_payment_and_never_counts_income_itself(self):
        from app.utils.auction_db import AuctionError, AuctionService
        db, store = make()
        with patch('app.utils.handover.HandoverService') as handover:
            handover.return_value.clear_auction_pin.return_value = None
            with self.assertRaisesRegex(AuctionError, 'payment has not been confirmed'):
                AuctionService(db).set_fulfillment('a2', 'collected', ADMIN)
            self.assertEqual(store.get('income_ledger', []), [])
            self.assertEqual(IncomeService(db).summary()['total'], 0.0)
            PaymentDesk(db).confirm('auction', 'a2', 'cash', '', '', '300', ADMIN)
            AuctionService(db).set_fulfillment('a2', 'collected', ADMIN)           # works once the payment is confirmed
        self.assertEqual(len(store['income_ledger']), 1)                          # only the confirmation wrote income


class ProofTests(unittest.TestCase):
    def test_a_payer_sends_proof_and_the_admin_sees_it_in_the_queue_and_confirms_with_it(self):
        db, store = make()
        desk = PaymentDesk(db)
        proof = desk.submit_proof(JUAN, 'auction', 'a2', 'gcash', 'GC-111222', 'paid at 3pm', PNG)
        self.assertEqual((proof['status'], proof['method'], proof['reference']), ('pending', 'gcash', 'GC-111222'))
        queue = desk.awaiting()
        item = next(i for i in queue['items'] if i['source_ref'] == 'a2')
        self.assertEqual((item['proof']['proof_id'], queue['totals']['proofs_waiting']), (proof['proof_id'], 1))
        self.assertTrue(desk.proof_url(proof['proof_id']).startswith('https://signed.test/'))
        result = desk.confirm('auction', 'a2', 'gcash', '', '', '300', ADMIN, proof_id=proof['proof_id'])        # the reference comes from the proof
        sale = store['income_ledger'][0]
        self.assertEqual((sale['payment_reference'], bool(sale['proof_path'])), ('GC-111222', True))
        self.assertEqual(store['payment_proofs'][0]['status'], 'accepted')
        self.assertTrue(desk.entry_proof_url(result['entry']['entry_id']))
        self.assertTrue(result['receipt']['has_proof'])

    def test_only_the_payer_can_send_proof_and_only_for_something_unpaid(self):
        db, _ = make()
        desk = PaymentDesk(db)
        for args, text in [((MARIA, 'auction', 'a2', 'gcash', 'GC-111222', '', PNG), 'not yours'), ((JUAN, 'auction', 'a2', 'cash', '', '', PNG), 'GCash, Maya'),
                           ((JUAN, 'auction', 'a2', 'gcash', '12', '', PNG), 'reference number'), ((JUAN, 'auction', 'a2', 'gcash', 'GC-111222', '', b'not an image'), 'JPG, PNG or WEBP'),
                           ((JUAN, 'auction', 'a2', 'gcash', 'GC-111222', '', b''), 'Choose the payment receipt')]:
            with self.assertRaisesRegex(IncomeError, text):
                desk.submit_proof(*args)
        desk.confirm('auction', 'a2', 'cash', '', '', '300', ADMIN)
        with self.assertRaisesRegex(IncomeError, 'already confirmed'):
            desk.submit_proof(JUAN, 'auction', 'a2', 'gcash', 'GC-111222', '', PNG)

    def test_a_new_proof_replaces_the_old_one_and_a_rejection_tells_the_payer_why(self):
        db, store = make()
        desk = PaymentDesk(db)
        first = desk.submit_proof(JUAN, 'auction', 'a2', 'gcash', 'GC-111222', '', PNG)
        second = desk.submit_proof(JUAN, 'auction', 'a2', 'gcash', 'GC-333444', '', PNG)
        self.assertEqual([p['status'] for p in store['payment_proofs']], ['replaced', 'pending'])
        with self.assertRaisesRegex(IncomeError, 'no longer waiting'):
            desk.reject_proof(first['proof_id'], 'blurry receipt', ADMIN)
        with self.assertRaisesRegex(IncomeError, 'what is wrong'):
            desk.reject_proof(second['proof_id'], 'x', ADMIN)
        desk.reject_proof(second['proof_id'], 'The amount on the receipt is 250, not 300', ADMIN)
        self.assertEqual(store['payment_proofs'][1]['status'], 'rejected')
        self.assertIn('The amount on the receipt', db.create_user_notification.call_args.args[2])
        mine = desk.my_payments(JUAN)['items'][0]
        self.assertEqual((mine['proof']['status'], mine['proof']['review_note']), ('rejected', 'The amount on the receipt is 250, not 300'))
        with self.assertRaisesRegex(IncomeError, "payer's payment receipt"):
            desk.confirm('auction', 'a2', 'gcash', 'GC-333444', '', '300', ADMIN)           # a rejected proof is not proof

    def test_the_payer_only_sees_their_own_payments_and_the_instructions(self):
        db, _ = make()
        desk = PaymentDesk(db)
        with patch('app.utils.system_control.load_settings', return_value={'payment_instructions': {'text': 'GCash 0917 000 0000'}}):
            mine = desk.my_payments(MARIA)
        self.assertEqual(sorted(i['source_ref'] for i in mine['items']), sorted([AUCTION, 'TAGPAID00001']))
        self.assertEqual(mine['instructions'], 'GCash 0917 000 0000')

    def test_the_images_are_checked_and_the_digital_methods_need_them(self):
        db, store = make()
        desk = PaymentDesk(db)
        with self.assertRaisesRegex(IncomeError, 'larger than 5 MB'):
            desk.confirm('auction', 'a2', 'maya', 'MAYA-1234', '', '300', ADMIN, proof_data=PNG + b'0' * (6 * 1024 * 1024))
        with self.assertRaisesRegex(IncomeError, 'JPG, PNG or WEBP'):
            desk.confirm('auction', 'a2', 'maya', 'MAYA-1234', '', '300', ADMIN, proof_data=b'GIF89a-not-allowed')
        self.assertEqual(store.get('income_ledger', []), [])
        desk.confirm('auction', 'a2', 'cash', '', '', '300', ADMIN)                         # cash needs no image
        self.assertNotIn('proof_path', store['income_ledger'][0])

    def test_a_missing_column_or_bucket_says_what_to_run(self):
        db, _ = make(missing_columns={'income_ledger': ('proof_path',)})
        with self.assertRaisesRegex(IncomeUnavailable, '20261025'):
            PaymentDesk(db).confirm('auction', 'a2', 'gcash', 'GC-111222', '', '300', ADMIN, proof_data=PNG)


class RegistryTests(unittest.TestCase):
    def setUp(self):
        self.db, self.store = make()
        self.store['claims'] = [{'claim_id': 'c1', 'claim_reference': 'CL-0007', 'found_item_id': 'f1', 'claimant_account_id': MARIA, 'status': 'collected', 'collected_at': NOW}]
        self.store['found_items'] = [{'item_id': 'f1', 'item_name': 'Blue umbrella'}]
        self.store['auctions'][0]['fulfillment_status'] = 'collected'
        self.paid = PaymentDesk(self.db).confirm('auction', AUCTION, 'cash', '', '', '2500', ADMIN)['entry']

    def test_the_register_lists_every_kind_and_filters_and_searches(self):
        data = receipts.admin_list(self.db)
        self.assertEqual((data['total'], data['counts']), (3, {'payment': 1, 'claim': 1, 'auction': 1, 'payout': 0}))
        self.assertTrue(all('code' not in r for r in data['receipts']))                    # the verification code is only in the opened receipt
        self.assertEqual([r['kind'] for r in receipts.admin_list(self.db, kind='claim')['receipts']], ['claim'])
        self.assertEqual(receipts.admin_list(self.db, q='maria santos')['total'], 3)
        self.assertEqual(receipts.admin_list(self.db, q='umbrella')['total'], 1)
        self.assertEqual(receipts.admin_list(self.db, q='nothing like this')['total'], 0)
        self.assertEqual(receipts.admin_list(self.db, start='2999-01-01')['total'], 0)
        self.assertEqual(receipts.admin_list(self.db, limit=1, offset=1)['receipts'].__len__(), 1)

    def test_reversed_receipts_are_marked_and_filterable_and_history_is_kept(self):
        PaymentDesk(self.db).reverse(self.paid['entry_id'], 'Entered on the wrong auction', ADMIN)
        reversed_only = receipts.admin_list(self.db, status='reversed')
        self.assertEqual([(r['kind'], r['status']) for r in reversed_only['receipts']], [('payment', 'reversed')])
        self.store['user_activity_logs'] = [{'target_id': self.paid['receipt_no'], 'user_name': 'ana', 'action': 'Confirm Payment', 'target_name': 'x', 'created_at': NOW, 'result': 'success'},
                                            {'target_id': 'OTHER', 'user_name': 'ana', 'action': 'Other', 'created_at': NOW}]
        self.assertEqual([h['action'] for h in receipts.history(self.db, self.paid['receipt_no'])], ['Confirm Payment'])

    def test_each_kind_can_be_opened_for_the_office(self):
        self.assertEqual(receipts.receipt_for_claim(self.db, 'c1')['receipt_no'][:3], 'HR-')
        self.assertEqual(receipts.receipt_for_auction(self.db, AUCTION)['receipt_no'][:3], 'AR-')
        self.assertIsNone(receipts.receipt_for_auction(self.db, 'a2'))                      # not collected, so no receipt
        self.assertEqual(receipts.receipt_for_payment(self.db, self.paid['entry_id'])['receipt_no'], self.paid['receipt_no'])

    def test_resending_emails_without_a_second_notice_and_refuses_a_reversed_receipt(self):
        desk = PaymentDesk(self.db)
        before = self.db.create_user_notification.call_count
        with patch('app.utils.email_service.send_notice_email_best_effort', return_value=True) as mail:
            self.assertTrue(desk.resend_receipt(self.paid['entry_id']))
        self.assertEqual((mail.call_count, self.db.create_user_notification.call_count), (1, before))
        desk.reverse(self.paid['entry_id'], 'Entered on the wrong auction', ADMIN)
        with self.assertRaisesRegex(IncomeError, 'reversed'):
            desk.resend_receipt(self.paid['entry_id'])


class SalesTotalTests(unittest.TestCase):
    def test_the_auction_totals_count_only_confirmed_payments(self):
        from app.utils.auction_db import AuctionService
        db, store = make()
        now = datetime.now(timezone.utc)
        for row in store['auctions']:
            row.update({'status': 'ended', 'sold': True, 'highest_bidder_id': row['winner_account_id'], 'starts_at': (now.replace(microsecond=0)).isoformat(), 'ends_at': now.isoformat(),
                        'starting_price': 100, 'bid_increment': 10, 'current_price': float(row['winning_amount']), 'bid_count': 2})
        service = AuctionService(db)
        with patch.object(AuctionService, 'settle_and_notify'):
            before = service.admin_list()['stats']
            PaymentDesk(db).confirm('auction', 'a2', 'cash', '', '', '300', ADMIN)
            after = service.admin_list()
        self.assertEqual((before['sales_total'], before['awaiting_payment_total']), (0.0, 2800.0))
        stats = after['stats']
        self.assertEqual((stats['sales_total'], stats['sales_count'], stats['awaiting_payment_total'], stats['awaiting_payment_count']), (300.0, 1, 2500.0, 1))
        card = next(c for c in after['auctions'] if c['id'] == 'a2')
        self.assertEqual((card['payment_confirmed'], card['payment_receipt_no'][:3]), (True, 'PR-'))
        self.assertFalse(next(c for c in after['auctions'] if c['id'] == AUCTION)['payment_confirmed'])


class ProofRouteTests(unittest.TestCase):
    client = RouteTests.client            # the same admin test app, patched the same way

    def test_confirming_with_an_uploaded_receipt_image_and_viewing_it_later(self):
        import io
        client = self.client()
        body = {'source': 'auction', 'source_ref': AUCTION, 'method': 'gcash', 'reference': 'GC-998877', 'notes': '', 'expected_amount': '2500', 'proof': (io.BytesIO(PNG), 'receipt.png')}
        reply = client.post('/api/admin/income/payments/confirm', data=body, content_type='multipart/form-data')
        self.assertEqual(reply.status_code, 201)
        entry = reply.get_json()['entry']
        self.assertTrue(entry['proof_path'])
        url = client.get(f"/api/admin/income/entries/{entry['entry_id']}/proof").get_json()['url']
        self.assertTrue(url.startswith('https://signed.test/'))
        again = client.post('/api/admin/income/payments/confirm', data={**body, 'source_ref': 'a2', 'expected_amount': '300', 'proof': None}, content_type='multipart/form-data')
        self.assertEqual((again.status_code, again.get_json()['code']), (400, 'proof_required'))

    def test_a_proof_can_be_viewed_and_rejected_and_the_payer_is_told(self):
        client = self.client()
        proof = PaymentDesk(self.db).submit_proof(JUAN, 'auction', 'a2', 'maya', 'MAYA-5566', '', PNG)
        self.assertTrue(client.get(f"/api/admin/income/payments/proofs/{proof['proof_id']}/image").get_json()['url'].startswith('https://signed.test/'))
        self.assertEqual(client.get('/api/admin/income/payments/proofs/nope/image').status_code, 404)
        self.assertEqual(client.post(f"/api/admin/income/payments/proofs/{proof['proof_id']}/reject", json={'reason': 'x'}).status_code, 400)
        reply = client.post(f"/api/admin/income/payments/proofs/{proof['proof_id']}/reject", json={'reason': 'The reference does not match'})
        self.assertEqual(reply.status_code, 200)
        self.assertIn('Reject Payment Proof', self.logged)

    def test_the_receipts_register_detail_and_resend(self):
        client = self.client()
        entry = client.post('/api/admin/income/payments/confirm', json={'source': 'auction', 'source_ref': 'a2', 'method': 'cash', 'reference': '', 'notes': '', 'expected_amount': '300'}).get_json()['entry']
        listing = client.get('/api/admin/income/receipts?kind=payment&q=umbrella').get_json()
        self.assertEqual((listing['total'], listing['receipts'][0]['id']), (1, entry['entry_id']))
        detail = client.get(f"/api/admin/income/receipts/payment/{entry['entry_id']}").get_json()
        self.assertEqual((detail['receipt']['receipt_no'], 'owner_id' in detail['receipt']), (entry['receipt_no'], False))
        self.assertEqual(client.get('/api/admin/income/receipts/bogus/1').status_code, 404)
        self.assertEqual(client.get('/api/admin/income/receipts/claim/missing').status_code, 404)
        with patch('app.utils.email_service.send_notice_email_best_effort', return_value=True):
            sent = client.post(f"/api/admin/income/receipts/payment/{entry['entry_id']}/resend")
        self.assertEqual(sent.status_code, 200)
        with patch('app.utils.email_service.send_notice_email_best_effort', return_value=False):
            failed = client.post(f"/api/admin/income/receipts/payment/{entry['entry_id']}/resend")
        self.assertEqual((failed.status_code, failed.get_json()['code']), (502, 'email_failed'))
        self.assertEqual(self.logged.count('Resend Receipt Email'), 2)

    def test_only_super_admins_change_the_payment_instructions(self):
        admin = self.client('admin')
        self.assertEqual(admin.put('/api/admin/income/instructions', json={'text': 'GCash 0917'}).status_code, 403)
        boss = self.client('super_admin')
        with patch('app.utils.system_control.save_setting') as save, patch('app.utils.system_control.load_settings', return_value={'payment_instructions': {'text': 'GCash 0917'}}):
            reply = boss.put('/api/admin/income/instructions', json={'text': '  GCash   0917 000 0000 \n\n  Office hours 8 to 5  '})
            self.assertEqual(boss.get('/api/admin/income/instructions').get_json()['text'], 'GCash 0917')
        self.assertEqual(reply.get_json()['text'], 'GCash 0917 000 0000\n\nOffice hours 8 to 5')
        self.assertEqual(save.call_args.args[1], 'payment_instructions')


class ReverseCodeTests(unittest.TestCase):
    """Reversing money needs the super administrator's Google Authenticator code, and the code is only spent on a reversal that really happens."""
    client = RouteTests.client

    def setUp(self):
        self.boss = self.client('super_admin')
        self.entry = self.boss.post('/api/admin/income/payments/confirm', json={'source': 'auction', 'source_ref': 'a2', 'method': 'cash', 'reference': '', 'notes': '', 'expected_amount': '300'}).get_json()['entry']
        self.path = f"/api/admin/income/entries/{self.entry['entry_id']}/reverse"

    def refunds(self):
        return [r for r in self.store['income_ledger'] if r['kind'] == 'refund']

    def test_a_missing_or_malformed_code_is_refused_before_anything_else_and_is_not_counted_as_a_wrong_attempt(self):
        for body in ({'reason': 'A long enough reason'}, {'reason': 'A long enough reason', 'authenticator_code': ''}, {'reason': 'A long enough reason', 'authenticator_code': '12345'},
                     {'reason': 'A long enough reason', 'authenticator_code': 'abcdef'}, {'reason': 'A long enough reason', 'authenticator_code': '1234567'}):
            reply = self.boss.post(self.path, json=body)
            self.assertEqual((reply.status_code, reply.get_json()['code']), (400, 'authenticator_required'))
        self.assertEqual((self.spent, self.refunds()), ([], []))

    def test_the_code_is_not_spent_when_another_rule_stops_the_reversal(self):
        short = self.boss.post(self.path, json={'reason': 'oops', 'authenticator_code': '123456'})
        missing = self.boss.post('/api/admin/income/entries/does-not-exist/reverse', json={'reason': 'A long enough reason', 'authenticator_code': '123456'})
        self.assertEqual((short.status_code, missing.status_code), (400, 404))
        self.assertEqual((self.spent, self.refunds()), ([], []))
        self.assertEqual(self.boss.post(self.path, json={'reason': 'A long enough reason', 'authenticator_code': '123456'}).status_code, 200)
        again = self.boss.post(self.path, json={'reason': 'Trying a second time', 'authenticator_code': '654321'})
        self.assertEqual((again.status_code, again.get_json()['code']), (409, 'already_reversed'))
        self.assertEqual(len(self.spent), 1)                                                   # only the reversal that happened used a code

    def test_a_valid_code_is_spent_once_for_the_right_action_and_the_reversal_is_logged(self):
        reply = self.boss.post(self.path, json={'reason': 'A long enough reason', 'authenticator_code': ' 123456 '})
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(self.spent, [('123456', 'reversing a payment')])
        self.assertEqual((len(self.refunds()), self.refunds()[0]['amount']), (1, '-300.00'))
        self.assertIn('Reverse Payment', self.logged)

    def test_a_wrong_code_writes_nothing_and_answers_with_the_authenticators_own_status(self):
        from Admin.Backend.income import routes
        from Admin.Backend.shared.authenticator import AuthenticatorError
        for status, message in ((401, 'Authenticator code is invalid.'), (423, 'Google Authenticator verification is temporarily locked.'), (403, 'Enable Google Authenticator in your Admin Profile before reversing a payment.')):
            with patch.object(routes, 'consume_authenticator_code', side_effect=AuthenticatorError(message, status)):
                reply = self.boss.post(self.path, json={'reason': 'A long enough reason', 'authenticator_code': '123456'})
            self.assertEqual((reply.status_code, reply.get_json()['error'], reply.get_json()['code']), (status, message, 'authenticator'))
        self.assertEqual(self.refunds(), [])
        self.assertNotIn('Reverse Payment', self.logged)

    def test_the_engine_runs_the_check_after_every_rule_and_before_writing(self):
        db, store = make()
        desk = PaymentDesk(db)
        entry = desk.confirm('auction', 'a2', 'cash', '', '', '300', ADMIN)['entry']
        order = []

        def check():
            order.append(('checked', len(store['income_ledger'])))
        with self.assertRaisesRegex(IncomeError, 'at least 8'):
            desk.reverse(entry['entry_id'], 'short', ADMIN, before_commit=check)
        self.assertEqual(order, [])
        desk.reverse(entry['entry_id'], 'A long enough reason', ADMIN, before_commit=check)
        self.assertEqual(order, [('checked', 1)])                                              # asked while only the original sale existed
        self.assertEqual(len(store['income_ledger']), 2)

        def refuse():
            raise IncomeError('Authenticator code is invalid.', 401)
        other = desk.confirm('auction', AUCTION, 'cash', '', '', '2500', ADMIN)['entry']
        with self.assertRaises(IncomeError):
            desk.reverse(other['entry_id'], 'A long enough reason', ADMIN, before_commit=refuse)
        self.assertEqual(len(store['income_ledger']), 3)                                       # the refused reversal wrote nothing


class UserPaymentRouteTests(unittest.TestCase):
    def client(self, account=JUAN, limited=False):
        import io
        from Users.Backend.payments import routes
        app = Flask(__name__)
        app.register_blueprint(routes.payments_bp, url_prefix='/api/payments')
        self.db, self.store = make()
        for p in (patch.object(routes, '_authenticated_account_id', return_value=account), patch.object(routes, '_desk', return_value=PaymentDesk(self.db)),
                  patch.object(routes.rate_limit, 'allow', return_value=not limited)):
            p.start()
            self.addCleanup(p.stop)
        self.io = io
        return app.test_client()

    def send(self, client, **over):
        data = {'source': 'auction', 'source_ref': 'a2', 'method': 'gcash', 'reference': 'GC-111222', 'note': '', 'image': (self.io.BytesIO(PNG), 'r.png')}
        data.update(over)
        return client.post('/api/payments/proof', data={k: v for k, v in data.items() if v is not None}, content_type='multipart/form-data')

    def test_a_payer_sees_only_their_own_dues_and_can_send_a_receipt(self):
        client = self.client()
        mine = client.get('/api/payments/mine').get_json()
        self.assertEqual([i['source_ref'] for i in mine['items']], ['a2'])
        reply = self.send(client)
        self.assertEqual((reply.status_code, reply.get_json()['proof']['status']), (200, 'pending'))
        self.assertEqual(client.get('/api/payments/mine').get_json()['items'][0]['proof']['reference'], 'GC-111222')

    def test_the_refusals_are_plain(self):
        client = self.client()
        cases = [(self.send(client, image=None), 400), (self.send(client, source_ref=AUCTION), 403), (self.send(client, method='cash'), 400), (self.send(client, reference='1'), 400)]
        self.assertEqual([r.status_code for r, _ in cases], [c for _, c in cases])
        self.assertEqual(self.store.get('payment_proofs', []), [])
        self.assertEqual(self.send(self.client(limited=True)).status_code, 429)


if __name__ == '__main__':
    unittest.main()
