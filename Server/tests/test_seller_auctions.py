"""Seller auctions: a person lists their own item, the office checks and auctions it, the buyer pays the office, the office keeps a commission
and pays the rest to the seller. Income must count the commission only, and every step must leave a record (ledger, payout, receipt)."""
import sys
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock, patch

from flask import Flask

from app.utils import receipts, system_control
from app.utils.auction_db import AuctionError, AuctionService
from app.utils.income import IncomeError, IncomeService
from app.utils.payments import PaymentDesk
from app.utils.seller_auctions import SellerDesk, SellerError, fee

sys.path.insert(0, str(Path(__file__).resolve().parent))
from memdb import MemClient  # noqa: E402

SELLER = '00000000-0000-0000-0000-0000000000s1'
BUYER = '00000000-0000-0000-0000-0000000000b1'
ADMIN = '00000000-0000-0000-0000-0000000000aa'
OTHER = '00000000-0000-0000-0000-0000000000o1'
JPG = b'\xff\xd8\xff' + b'0' * 64
PNG = b'\x89PNG\r\n\x1a\n' + b'0' * 64
LONG_AGO = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()


class Bucket:
    def __init__(self, files, name):
        self.files, self.name = files, name

    def upload(self, path, data, options=None):
        self.files[f'{self.name}/{path}'] = data

    def remove(self, paths):
        for path in paths:
            self.files.pop(f'{self.name}/{path}', None)

    def get_public_url(self, path):
        return f'https://db.test/storage/v1/object/public/{self.name}/{path}'

    def create_signed_url(self, path, seconds):
        return {'signedURL': f'https://signed.test/{path}'} if f'{self.name}/{path}' in self.files else {}


class Storage:
    def __init__(self):
        self.files = {}

    def from_(self, bucket):
        return Bucket(self.files, bucket)


def setUpModule():
    global _mail
    _mail = patch('app.utils.email_service.send_notice_email_best_effort', return_value=True)
    _mail.start()


def tearDownModule():
    _mail.stop()


def make(verified=True):
    store = {
        'user_profiles': [
            {'account_id': SELLER, 'fname': 'Sam', 'lname': 'Seller', 'campus_id': 'K11', 'email': 's@umak.edu.ph', 'verification_status': 'verified' if verified else 'pending'},
            {'account_id': BUYER, 'fname': 'Bea', 'lname': 'Buyer', 'campus_id': 'K22', 'email': 'b@umak.edu.ph', 'verification_status': 'verified'},
            {'account_id': ADMIN, 'fname': 'Ana', 'lname': 'Admin', 'campus_id': 'A1', 'email': 'a@umak.edu.ph', 'verification_status': 'verified'},
            {'account_id': OTHER, 'fname': 'Oli', 'lname': 'Other', 'campus_id': 'K33', 'email': 'o@umak.edu.ph', 'verification_status': 'verified'},
        ],
        'system_settings': [], 'auctions': [], 'auction_submissions': [], 'seller_payouts': [], 'income_ledger': [], 'payment_proofs': [],
    }
    db = MagicMock()
    db.client = MemClient(store, unique={'system_settings': 'setting_key'})
    db.client.storage = Storage()
    people = {p['account_id']: p for p in store['user_profiles']}
    db.get_user_by_account_id.side_effect = lambda a: dict(people.get(a) or {})
    return db, store


def listing(**overrides):
    fields = {'title': 'Casio scientific calculator', 'description': 'A Casio fx-991ES Plus calculator in good working condition, with its cover.',
              'category': 'Electronics', 'condition': 'used', 'starting_price': '500', 'duration_days': '3',
              'payout_method': 'gcash', 'payout_account_name': 'Sam Seller', 'payout_account_number': '0917 123 4567', 'accept_terms': 'true'}
    fields.update(overrides)
    return fields


class FeeTests(unittest.TestCase):
    def test_rate_minimum_cap_and_the_parts_always_add_up(self):
        self.assertEqual(fee(1000, 5, 10, 500), (fee(1000, 5, 10, 500)[0], fee(1000, 5, 10, 500)[1]))
        self.assertEqual([str(x) for x in fee(1000, 5, 10, 500)], ['50.00', '950.00'])
        self.assertEqual([str(x) for x in fee(100, 5, 10, 500)], ['10.00', '90.00'])          # the minimum
        self.assertEqual([str(x) for x in fee(20000, 5, 10, 500)], ['500.00', '19500.00'])   # the cap
        self.assertEqual([str(x) for x in fee(8, 5, 10, 0)], ['8.00', '0.00'])               # never more than the sale
        self.assertEqual([str(x) for x in fee(333.33, 5, 0, 0)], ['16.67', '316.66'])        # rounded to the centavo
        for gross in (50, 77.77, 1234.56, 99999):
            commission, share = fee(gross, 7.5, 10, 500)
            self.assertEqual(commission + share, fee(gross, 0)[1])


class SubmitTests(unittest.TestCase):
    def setUp(self):
        system_control.clear_caches()

    def test_a_verified_user_lists_an_item_with_the_terms_copied_onto_it(self):
        db, store = make()
        view = SellerDesk(db).submit(SELLER, listing(), [JPG, PNG])
        row = store['auction_submissions'][0]
        self.assertEqual((row['status'], row['commission_rate'], row['commission_minimum'], row['commission_cap']), ('pending', '5.0', '10.0', '500.0'))
        self.assertEqual(row['payout_account_number'], '09171234567')
        self.assertEqual(len(row['photo_urls']), 2)
        self.assertEqual(view['payout_account_number'], '•••• 4567')            # the seller sees it masked
        self.assertEqual((view['fee']['commission'], view['fee']['you_get']), (25.0, 475.0))
        self.assertEqual(view['phase'], 'pending')
        self.assertIn('Bring the item', view['next_step'])

    def test_the_rules_are_checked_before_anything_is_saved(self):
        db, store = make()
        desk = SellerDesk(db)
        cases = [
            (listing(accept_terms=''), [JPG], 'terms_required'),
            (listing(), [], 'photos_required'),
            (listing(), [JPG] * 5, 'photos_required'),
            (listing(title='Vape pen with case'), [JPG], 'prohibited'),
            (listing(starting_price='20'), [JPG], 'invalid'),
            (listing(buyout_price='400'), [JPG], 'invalid'),
            (listing(payout_account_number='12345'), [JPG], 'invalid'),
            (listing(duration_days='2'), [JPG], 'invalid'),
            (listing(), [b'GIF89a not allowed'], 'photo_invalid'),
        ]
        for fields, photos, code in cases:
            with self.assertRaises(SellerError) as caught:
                desk.submit(SELLER, fields, photos)
            self.assertEqual(caught.exception.code, code, fields)
        self.assertEqual(store['auction_submissions'], [])
        self.assertEqual(db.client.storage.files, {})                          # a refused photo is never left behind

    def test_only_verified_people_within_the_limit_can_sell(self):
        db, _ = make(verified=False)
        with self.assertRaises(SellerError) as caught:
            SellerDesk(db).submit(SELLER, listing(), [JPG])
        self.assertIn('Verify your UMak ID', caught.exception.message)
        db, _ = make()
        desk = SellerDesk(db)
        for _ in range(3):
            desk.submit(SELLER, listing(), [JPG])
        self.assertFalse(desk.eligibility(SELLER)['can_sell'])
        with self.assertRaises(SellerError):
            desk.submit(SELLER, listing(), [JPG])

    def test_the_seller_edits_after_a_change_request_and_can_withdraw(self):
        db, store = make()
        desk = SellerDesk(db)
        sid = desk.submit(SELLER, listing(), [JPG, PNG])['id']
        desk.review(ADMIN, sid, 'request_changes', {'note': 'Add a photo of the back of the calculator.'})
        self.assertEqual(store['auction_submissions'][0]['status'], 'changes_requested')
        keep = [store['auction_submissions'][0]['photo_urls'][0]]
        view = desk.update(SELLER, sid, listing(starting_price='600'), [PNG], keep)
        self.assertEqual((view['status'], view['starting_price'], len(view['photos'])), ('pending', 600.0, 2))
        self.assertEqual(len(db.client.storage.files), 2)                        # the dropped photo was deleted
        with self.assertRaises(SellerError):
            desk.update(OTHER, sid, listing(), [], keep)                         # someone else's listing
        desk.withdraw(SELLER, sid)
        self.assertEqual(store['auction_submissions'][0]['status'], 'withdrawn')
        with self.assertRaises(SellerError):
            desk.withdraw(SELLER, sid)


class ReviewTests(unittest.TestCase):
    def setUp(self):
        system_control.clear_caches()

    def test_approval_needs_the_item_and_creates_a_seller_auction(self):
        db, store = make()
        desk = SellerDesk(db)
        sid = desk.submit(SELLER, listing(buyout_price='900'), [JPG, PNG])['id']
        with self.assertRaises(SellerError) as caught:
            desk.review(ADMIN, sid, 'approve', {})
        self.assertEqual(caught.exception.code, 'item_not_received')
        with self.assertRaises(SellerError):
            desk.review(SELLER, sid, 'approve', {'item_received': True})        # nobody approves their own listing
        view = desk.review(ADMIN, sid, 'approve', {'item_received': True})
        auction = store['auctions'][0]
        self.assertEqual((auction['seller_account_id'], auction['submission_id'], auction['found_item_id']), (SELLER, sid, None))
        self.assertEqual((auction['starting_price'], auction['buyout_price'], auction['bid_increment'], auction['status']), (500.0, 900.0, 50.0, 'active'))
        self.assertTrue(auction['item_reference'].startswith('SL-'))
        self.assertEqual((view['status'], view['auction']['stage']), ('listed', 'live'))
        self.assertEqual(store['auction_submissions'][0]['auction_id'], auction['auction_id'])
        card = AuctionService(db).card(auction, {})
        self.assertTrue(card['seller_listing'])
        self.assertNotIn(SELLER, str(card))                                      # bidders never learn who the seller is
        with self.assertRaises(AuctionError) as caught:
            AuctionService(db)._assert_not_seller(auction['auction_id'], SELLER)
        self.assertEqual(caught.exception.status, 403)
        AuctionService(db)._assert_not_seller(auction['auction_id'], BUYER)
        with self.assertRaises(SellerError):
            desk.review(ADMIN, sid, 'reject', {'note': 'Already reviewed listing'})

    def test_rejecting_removes_the_photos_and_an_unsold_item_is_given_back(self):
        db, store = make()
        desk = SellerDesk(db)
        sid = desk.submit(SELLER, listing(), [JPG])['id']
        with self.assertRaises(SellerError):
            desk.review(ADMIN, sid, 'reject', {'note': 'no'})                   # a reason is required
        desk.review(ADMIN, sid, 'reject', {'note': 'The calculator in the office does not match the photos.'})
        self.assertEqual((store['auction_submissions'][0]['status'], db.client.storage.files), ('rejected', {}))
        sid = desk.submit(SELLER, listing(), [JPG])['id']
        desk.review(ADMIN, sid, 'approve', {'item_received': True})
        with self.assertRaises(SellerError):
            desk.return_item(ADMIN, sid, '')                                     # still live
        store['auctions'][0].update(status='ended', bid_count=0, winner_account_id=None)
        desk.return_item(ADMIN, sid, 'No bids.')
        self.assertEqual(store['auction_submissions'][1]['status'], 'returned')


def sold_listing(db, store, price='1000', collected_at=None):
    desk = SellerDesk(db)
    sid = desk.submit(SELLER, listing(), [JPG])['id']
    desk.review(ADMIN, sid, 'approve', {'item_received': True})
    auction = store['auctions'][-1]
    auction.update(status='ended', winner_account_id=BUYER, winning_amount=price, current_price=price, bid_count=3,
                   fulfillment_status='collected' if collected_at else 'awaiting_pickup', fulfillment_updated_at=collected_at)
    return auction


class MoneyTests(unittest.TestCase):
    def setUp(self):
        system_control.clear_caches()

    def test_confirming_the_buyer_payment_counts_only_the_commission_as_income(self):
        db, store = make()
        auction = sold_listing(db, store)
        queue = PaymentDesk(db).awaiting()['items']
        self.assertEqual(queue[0]['seller_split'], {'commission': 50.0, 'share': 950.0, 'rate': 5.0})
        result = PaymentDesk(db).confirm('auction', auction['auction_id'], 'cash', '', '', '1000', ADMIN)
        kinds = sorted((r['kind'], Decimal(r['amount'])) for r in store['income_ledger'])
        self.assertEqual(kinds, [('payout', Decimal('-950')), ('sale', Decimal('1000'))])
        self.assertEqual(result['receipt']['amount'], 1000.0)                    # the buyer's receipt shows what they paid
        summary = IncomeService(db).summary()
        self.assertEqual((summary['total'], summary['by_source']['commission'], summary['by_source']['auction'], summary['refunds']), (50.0, 50.0, 0.0, 0.0))
        self.assertEqual((summary['seller']['gross'], summary['seller']['shares'], summary['seller']['owed']), (1000.0, 950.0, 950.0))
        payout = store['seller_payouts'][0]
        self.assertEqual((payout['status'], payout['gross'], payout['commission'], payout['payout_amount']), ('holding', '1000.00', '50.00', '950.00'))
        entries = IncomeService(db).entries(source='commission')['entries']
        self.assertEqual(sorted(e['kind_label'] for e in entries), ["Sale", "Seller's share"])
        self.assertEqual(IncomeService(db).entries(source='auction')['entries'], [])
        self.assertIn('Seller commissions,Seller', IncomeService(db).csv_export())

    def test_the_terms_the_seller_accepted_are_used_even_if_the_rate_changes(self):
        db, store = make()
        auction = sold_listing(db, store)
        SellerDesk(db).save_terms({'rate': 10, 'minimum': 10, 'cap': 500, 'hold_days': 3, 'max_active': 3, 'enabled': True}, ADMIN)
        system_control.clear_caches()
        PaymentDesk(db).confirm('auction', auction['auction_id'], 'cash', '', '', '1000', ADMIN)
        self.assertEqual(store['seller_payouts'][0]['commission'], '50.00')

    def test_the_seller_is_paid_only_after_pickup_and_the_hold(self):
        db, store = make()
        auction = sold_listing(db, store)
        PaymentDesk(db).confirm('auction', auction['auction_id'], 'cash', '', '', '1000', ADMIN)
        desk = SellerDesk(db)
        pid = store['seller_payouts'][0]['payout_id']
        with self.assertRaises(SellerError) as caught:
            desk.pay(ADMIN, pid, 'cash', '', '')
        self.assertEqual(caught.exception.code, 'not_collected')
        auction.update(fulfillment_status='collected', fulfillment_updated_at=datetime.now(timezone.utc).isoformat())
        with self.assertRaises(SellerError) as caught:
            desk.pay(ADMIN, pid, 'cash', '', '')
        self.assertEqual(caught.exception.code, 'on_hold')
        self.assertEqual(desk.payouts()['payouts'][0]['state'], 'on_hold')
        auction['fulfillment_updated_at'] = LONG_AGO
        self.assertEqual((desk.payouts()['totals']['ready'], desk.payouts('ready')['payouts'][0]['destination']['account_number']), (950.0, '09171234567'))
        with self.assertRaises(SellerError) as caught:
            desk.pay(ADMIN, pid, 'gcash', '12', '')
        self.assertIn('reference', caught.exception.message)
        with self.assertRaises(SellerError) as caught:
            desk.pay(ADMIN, pid, 'gcash', 'GC-778899', '')
        self.assertEqual(caught.exception.code, 'proof_required')
        with self.assertRaises(SellerError):
            desk.pay(SELLER, pid, 'cash', '', '')                                # nobody pays themselves
        result = desk.pay(ADMIN, pid, 'gcash', 'GC-778899', 'Sent from the office GCash', PNG)
        receipt = result['receipt']
        self.assertTrue(receipt['receipt_no'].startswith('PO-'))
        self.assertEqual((receipt['amount'], receipt['gross'], receipt['commission']), (950.0, 1000.0, 50.0))
        self.assertTrue(receipts.verify(db, receipt['receipt_no'], receipt['code'])['valid'])
        self.assertFalse(receipts.verify(db, receipt['receipt_no'], 'AAAAA-AAAAA')['valid'])
        mine = receipts.list_for_owner(db, SELLER)
        self.assertEqual([r['kind'] for r in mine], ['payout'])
        register = receipts.admin_list(db, kind='payout')
        self.assertEqual((register['total'], register['receipts'][0]['person']), (1, 'Sam Seller'))
        with self.assertRaises(SellerError):
            desk.pay(ADMIN, pid, 'cash', '', '')                                 # only once
        view = desk.mine(SELLER)
        self.assertEqual((view['listings'][0]['phase'], view['totals']['paid_out']), ('paid_out', 950.0))
        self.assertIsNotNone(desk.proof_url(pid))

    def test_a_reversal_cancels_the_payout_but_not_after_the_seller_was_paid(self):
        db, store = make()
        auction = sold_listing(db, store)
        sale = PaymentDesk(db).confirm('auction', auction['auction_id'], 'cash', '', '', '1000', ADMIN)['entry']
        spent = []
        PaymentDesk(db).reverse(sale['entry_id'], 'The buyer returned the item.', ADMIN, before_commit=lambda: spent.append(1))
        self.assertEqual(IncomeService(db).summary()['total'], 0.0)
        self.assertEqual(store['seller_payouts'][0]['status'], 'cancelled')
        self.assertEqual(sorted((r['kind'], Decimal(r['amount'])) for r in store['income_ledger']), [('payout', Decimal('-950')), ('payout', Decimal('950')), ('refund', Decimal('-1000')), ('sale', Decimal('1000'))])
        self.assertEqual(spent, [1])

        db, store = make()
        auction = sold_listing(db, store, collected_at=LONG_AGO)
        sale = PaymentDesk(db).confirm('auction', auction['auction_id'], 'cash', '', '', '1000', ADMIN)['entry']
        SellerDesk(db).pay(ADMIN, store['seller_payouts'][0]['payout_id'], 'cash', '', '')
        spent = []
        with self.assertRaises(IncomeError) as caught:
            PaymentDesk(db).reverse(sale['entry_id'], 'The buyer returned the item.', ADMIN, before_commit=lambda: spent.append(1))
        self.assertEqual((caught.exception.code, spent), ('seller_paid', []))    # refused before the authenticator code is used

    def test_an_office_auction_is_unchanged(self):
        db, store = make()
        store['auctions'].append({'auction_id': 'office-1', 'title': 'Found umbrella', 'status': 'ended', 'fulfillment_status': 'collected', 'winning_amount': '300.00',
                                  'winner_account_id': BUYER, 'fulfillment_updated_at': LONG_AGO})
        PaymentDesk(db).confirm('auction', 'office-1', 'cash', '', '', '300', ADMIN)
        summary = IncomeService(db).summary()
        self.assertEqual((summary['total'], summary['by_source']['auction'], summary['by_source']['commission']), (300.0, 300.0, 0.0))
        self.assertEqual(store['seller_payouts'], [])

    def test_a_missing_payout_row_is_rebuilt_from_the_ledger(self):
        db, store = make()
        auction = sold_listing(db, store)
        PaymentDesk(db).confirm('auction', auction['auction_id'], 'cash', '', '', '1000', ADMIN)
        store['seller_payouts'].clear()
        data = SellerDesk(db).payouts()
        self.assertEqual((len(data['payouts']), data['payouts'][0]['payout_amount'], data['payouts'][0]['commission']), (1, 950.0, 50.0))

    def test_the_menu_badges_count_listings_to_review_and_payouts_to_send(self):
        from app.utils import admin_badges
        db, store = make()
        SellerDesk(db).submit(SELLER, listing(), [JPG])
        auction = sold_listing(db, store, collected_at=LONG_AGO)
        PaymentDesk(db).confirm('auction', auction['auction_id'], 'cash', '', '', '1000', ADMIN)
        counts = admin_badges.pending_counts(db.client)
        self.assertEqual((counts['auctions'], counts['income']), (1, 1))     # one listing waiting, one seller to pay
        auction['fulfillment_updated_at'] = datetime.now(timezone.utc).isoformat()
        self.assertEqual(admin_badges.pending_counts(db.client)['income'], 0)  # still in the hold period

    def test_the_auctions_page_counts_the_commission_not_the_seller_money(self):
        db, store = make()
        auction = sold_listing(db, store)
        PaymentDesk(db).confirm('auction', auction['auction_id'], 'cash', '', '', '1000', ADMIN)
        with patch.object(AuctionService, 'reaction_counts', return_value={}):
            stats = AuctionService(db).admin_list()['stats']
        self.assertEqual((stats['sales_total'], stats['seller_sales_total'], stats['seller_commission_total'], stats['office_sales_total']), (50.0, 1000.0, 50.0, 0.0))


class TermsTests(unittest.TestCase):
    def setUp(self):
        system_control.clear_caches()

    def test_terms_are_checked_and_listing_can_be_switched_off(self):
        db, _ = make()
        desk = SellerDesk(db)
        for bad in ({'rate': 40}, {'rate': 5, 'minimum': 50, 'cap': 20}, {'hold_days': 99}, {'max_active': 0}):
            with self.assertRaises(SellerError):
                desk.save_terms({**{'rate': 5, 'minimum': 10, 'cap': 500, 'hold_days': 3, 'max_active': 3}, **bad}, ADMIN)
        desk.save_terms({'rate': 5, 'minimum': 10, 'cap': 500, 'hold_days': 3, 'max_active': 3, 'enabled': False}, ADMIN)
        system_control.clear_caches()
        self.assertFalse(desk.eligibility(SELLER)['can_sell'])


class RouteTests(unittest.TestCase):
    def setUp(self):
        system_control.clear_caches()

    def test_a_listing_is_sent_as_a_form_with_photos(self):
        import io
        from Users.Backend.auctions import selling_routes
        db, store = make()
        app = Flask(__name__)
        app.register_blueprint(selling_routes.selling_bp, url_prefix='/api/auctions/selling')
        client = app.test_client()
        with patch.object(selling_routes, '_desk', return_value=SellerDesk(db)), patch.object(selling_routes, '_authenticated_account_id', return_value=SELLER):
            reply = client.post('/api/auctions/selling', data={**listing(), 'photos': [(io.BytesIO(JPG), 'a.jpg'), (io.BytesIO(PNG), 'b.png')]}, content_type='multipart/form-data')
            self.assertEqual(reply.status_code, 200, reply.get_json())
            self.assertEqual(len(store['auction_submissions'][0]['photo_urls']), 2)
            mine = client.get('/api/auctions/selling').get_json()
            self.assertEqual(mine['listings'][0]['payout_account_number'], '•••• 4567')
            self.assertEqual(reply.headers['Cache-Control'], 'no-store')
            bad = client.post('/api/auctions/selling', data=listing(title='Selling my vape'), content_type='multipart/form-data')
            self.assertEqual((bad.status_code, bad.get_json()['code']), (400, 'prohibited'))
            self.assertEqual(client.get('/api/auctions/selling/terms').get_json()['terms']['rate'], 5.0)

    def test_the_office_reviews_and_pays_through_its_routes(self):
        from Admin.Backend.seller_auctions import routes
        db, store = make()
        sid = SellerDesk(db).submit(SELLER, listing(), [JPG])['id']
        app = Flask(__name__)
        app.register_blueprint(routes.seller_auctions_bp, url_prefix='/api/admin')
        client = app.test_client()
        logged = []
        with patch.object(routes, '_desk', return_value=(db, SellerDesk(db))), patch.object(routes, '_require_admin', return_value={'account_id': ADMIN, 'email': 'a@x'}), \
                patch.object(routes, '_log_admin_action', side_effect=lambda *a, **k: logged.append(a[2])):
            self.assertEqual(client.get('/api/admin/auctions/submissions').get_json()['counts']['pending'], 1)
            reply = client.post(f'/api/admin/auctions/submissions/{sid}/review', json={'action': 'approve'})
            self.assertEqual((reply.status_code, reply.get_json()['code']), (400, 'item_not_received'))
            reply = client.post(f'/api/admin/auctions/submissions/{sid}/review', json={'action': 'approve', 'item_received': True})
            self.assertEqual(reply.status_code, 200)
            auction = store['auctions'][0]
            auction.update(status='ended', winner_account_id=BUYER, winning_amount='1000', fulfillment_status='collected', fulfillment_updated_at=LONG_AGO)
            PaymentDesk(db).confirm('auction', auction['auction_id'], 'cash', '', '', '1000', ADMIN)
            pid = store['seller_payouts'][0]['payout_id']
            reply = client.post(f'/api/admin/income/payouts/{pid}/pay', data={'method': 'cash'}, content_type='multipart/form-data')
            self.assertEqual(reply.status_code, 200, reply.get_json())
            self.assertNotIn('owner_id', reply.get_json()['receipt'])
            self.assertEqual(client.get('/api/admin/income/payouts').get_json()['totals']['paid'], 950.0)
        self.assertEqual(logged, ['Approve Seller Listing', 'Send Seller Payout'])


if __name__ == '__main__':
    unittest.main()
