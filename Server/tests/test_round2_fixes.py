"""Polishing round 2: auction pickup PINs and the manual completion, Smart Tag contact methods, and the health check statuses.
(The guard rules for Force logout, maintenance, suspension and verification are in test_system_control.py.)"""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from flask import Flask

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT.parent, ROOT / 'tests'):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from memdb import MemClient  # noqa: E402
from test_handover_and_timeouts import ADMIN_ID, AUCTION, ITEM, OWNER, WINNER, auction_store, claim_client, claim_store, iso, make_db  # noqa: E402
from test_report_lifecycle import staff_patches  # noqa: E402
from Admin.Backend.auctions import routes as admin_auction_routes  # noqa: E402
from Admin.Backend.claims_verification import routes as claim_routes  # noqa: E402
from Users.Backend.auctions import routes as user_auction_routes  # noqa: E402
from Users.Backend.smart_tags import routes as tag_routes  # noqa: E402
from app.utils import auction_email, handover, system_control as control  # noqa: E402
from app.utils.auction_db import AuctionError, AuctionService  # noqa: E402
from app.utils.handover import HandoverError, HandoverService, HandoverUnavailable  # noqa: E402
from app.utils.smart_tags import CONTACT_LABELS, SmartTagService, TagError, TagsUnavailable, clean_contact, contact_url, stored_contacts  # noqa: E402

TAG = 'ABCDEFGHJK23'
CLAIM_ID = '55555555-5555-4555-8555-555555555555'


def client_for(blueprint, prefix):
    app = Flask(__name__)
    app.config.update(SUPABASE_URL='x', SUPABASE_SERVICE_KEY='x')
    app.register_blueprint(blueprint, url_prefix=prefix)
    return app.test_client()


def waiting_world(**auction_extra):
    """An auction whose winner is confirmed and waiting to collect, on a database where both PIN columns are unique."""
    store = auction_store(**auction_extra)
    store.setdefault('custody_log', [])
    db = make_db(store)
    db.client = MemClient(store, unique={'claims': 'handover_pin_hash', 'auctions': 'handover_pin_hash'})
    return store, db


# ------------------------------------------------------------------------------------------------------------ auction pickup PIN
class AuctionPinTests(unittest.TestCase):
    def setUp(self):
        self.store, self.db = waiting_world()
        self.service = HandoverService(self.db)

    def test_a_pin_is_stored_as_a_hash_and_an_encrypted_copy_never_the_pin(self):
        pin = self.service.issue_for_auction(AUCTION)
        row = self.store['auctions'][0]
        self.assertEqual(len(pin), 6)
        self.assertEqual(row['handover_pin_hash'], handover.pin_hash(pin))
        self.assertNotIn(pin, str(row))
        self.assertEqual(self.service.reveal_for_auction(row), pin)

    def test_a_new_pin_replaces_the_old_one(self):
        first = self.service.issue_for_auction(AUCTION)
        second = self.service.issue_for_auction(AUCTION)
        self.assertNotEqual(first, second)
        with self.assertRaises(HandoverError):
            self.service.find(first)
        self.assertEqual(self.service.find(second)['kind'], 'auction')

    def test_only_an_auction_waiting_for_pickup_can_have_a_pin(self):
        for extra in ({'fulfillment_status': 'collected'}, {'fulfillment_status': 'forfeited'}, {'status': 'active', 'fulfillment_status': None}):
            _, db = waiting_world(**extra)
            with self.assertRaises(HandoverError) as raised:
                HandoverService(db).issue_for_auction(AUCTION)
            self.assertEqual(raised.exception.status, 409, extra)

    def test_without_the_migration_the_sale_just_has_no_pin(self):
        store = auction_store()
        db = make_db(store)
        db.client = MemClient(store, missing_columns={'auctions': ('handover_pin_hash',)})
        with self.assertRaises(HandoverUnavailable):
            HandoverService(db).issue_for_auction(AUCTION)

    def test_the_lookup_shows_the_winner_the_item_and_the_amount_to_collect(self):
        pin = self.service.issue_for_auction(AUCTION)
        found = self.service.find(pin.lower())
        self.assertEqual((found['kind'], found['claimant_name'], found['claimant_campus_id'], found['item_name'], found['amount_due']),
                         ('auction', 'Juan Cruz', 'K87654321', 'Blue umbrella', 500.0))
        self.assertEqual(found['claim_id'], AUCTION)

    def test_a_claim_pin_still_finds_its_claim(self):
        store = claim_store()
        store['auctions'] = [auction_store()['auctions'][0]]
        db = make_db(store)
        db.client = MemClient(store, unique={'claims': 'handover_pin_hash', 'auctions': 'handover_pin_hash'})
        claim_pin = HandoverService(db).issue(CLAIM_ID)
        found = HandoverService(db).find(claim_pin)
        self.assertEqual((found['kind'], found['claim_id']), ('claim', CLAIM_ID))

    def test_an_auction_pin_never_equals_a_claim_pin(self):
        store = claim_store()
        store['auctions'] = [auction_store()['auctions'][0]]
        db = make_db(store)
        db.client = MemClient(store, unique={'claims': 'handover_pin_hash', 'auctions': 'handover_pin_hash'})
        claim_pin = HandoverService(db).issue(CLAIM_ID)
        with patch.object(handover, 'generate_pin', side_effect=[claim_pin, 'ABCDEF']):
            self.assertEqual(HandoverService(db).issue_for_auction(AUCTION), 'ABCDEF')

    def test_releasing_the_pin_completes_the_auction_and_the_item_and_clears_the_pin(self):
        pin = self.service.issue_for_auction(AUCTION)
        released = self.service.release(pin, ADMIN_ID)
        row = self.store['auctions'][0]
        self.assertEqual(released['kind'], 'auction')
        self.assertEqual(row['fulfillment_status'], 'collected')
        self.assertIsNone(row['handover_pin_hash'])
        self.assertEqual(self.store['found_items'][0]['status'], 'returned')
        self.assertIn('auction_completed', [r['event'] for r in self.store['custody_log']])
        with self.assertRaises(HandoverError) as again:
            self.service.release(pin, ADMIN_ID)
        self.assertEqual(again.exception.code, 'pin_not_found')

    def test_a_pin_of_a_forfeited_sale_no_longer_works(self):
        pin = self.service.issue_for_auction(AUCTION)
        AuctionService(self.db).set_fulfillment(AUCTION, 'forfeited', ADMIN_ID)
        with self.assertRaises(HandoverError):
            self.service.find(pin)
        self.assertIsNone(self.store['auctions'][0]['handover_pin_hash'])


class WinnerNoticeTests(unittest.TestCase):
    def notice(self, store, db):
        sent = {}
        with patch('app.utils.auction_db.send_auction_won_email', side_effect=lambda **kwargs: sent.update(kwargs) or {'mode': 'mock', 'sent': True}):
            AuctionService(db)._send_winner_notice(store['auctions'][0])
        return sent

    def test_the_winner_notice_creates_the_pin_and_emails_it(self):
        store, db = waiting_world()
        sent = self.notice(store, db)
        pin = sent['handover_pin']
        self.assertEqual(handover.pin_hash(pin), store['auctions'][0]['handover_pin_hash'])
        message = next(n for n in store['user_notifications'] if n['type'] == 'auction_won')
        self.assertEqual(message['user'], WINNER)

    def test_a_sale_before_the_migration_is_still_announced_without_a_pin(self):
        store = auction_store()
        db = make_db(store)
        db.client = MemClient(store, missing_columns={'auctions': ('handover_pin_hash',)})
        sent = self.notice(store, db)
        self.assertNotIn('handover_pin', sent)
        self.assertEqual(sent['to_email'], 'juan@umak.edu.ph')

    def test_the_email_shows_the_pin_without_logging_it(self):
        with patch('app.utils.email_service.send_notice_email_best_effort', return_value=True) as notice, patch.dict('os.environ', {'AUCTION_EMAIL_MODE': 'sendgrid'}):
            result = auction_email.send_auction_won_email(to_email='j@umak.edu.ph', recipient_name='Juan', item_title='Umbrella', reference='FP1', amount=500, handover_pin='K7M2QX')
        self.assertTrue(result['sent'])
        self.assertEqual(notice.call_args.kwargs['highlight'], ('YOUR HANDOVER PIN', 'K7M2QX'))
        with self.assertLogs('app.utils.auction_email', level='INFO') as logs, patch.dict('os.environ', {'AUCTION_EMAIL_MODE': 'mock'}):
            auction_email.send_auction_won_email(to_email='j@umak.edu.ph', recipient_name='Juan', item_title='Umbrella', reference='FP1', amount=500, handover_pin='K7M2QX')
        self.assertNotIn('K7M2QX', ' '.join(logs.output))

    def test_the_email_without_a_pin_is_unchanged(self):
        with patch('app.utils.email_service.send_reference_email_best_effort', return_value=True) as reference, patch.dict('os.environ', {'AUCTION_EMAIL_MODE': 'sendgrid'}):
            auction_email.send_auction_won_email(to_email='j@umak.edu.ph', recipient_name='Juan', item_title='Umbrella', reference='FP1', amount=500)
        self.assertTrue(reference.called)


class ReissueTests(unittest.TestCase):
    def test_an_administrator_can_create_a_new_pin_for_a_win_that_has_none(self):
        store, db = waiting_world()
        with patch('app.utils.auction_db.send_auction_won_email', return_value={'mode': 'mock', 'sent': True}) as email:
            result = AuctionService(db).reissue_pickup_pin(AUCTION, ADMIN_ID)
        self.assertTrue(result['emailed'])
        self.assertTrue(store['auctions'][0]['handover_pin_hash'])
        self.assertEqual(handover.pin_hash(email.call_args.kwargs['handover_pin']), store['auctions'][0]['handover_pin_hash'])
        self.assertIn('auction_pin', [n['type'] for n in store['user_notifications']])

    def test_the_old_pin_stops_working(self):
        store, db = waiting_world()
        service = HandoverService(db)
        old = service.issue_for_auction(AUCTION)
        with patch('app.utils.auction_db.send_auction_won_email', return_value={'mode': 'mock', 'sent': True}):
            AuctionService(db).reissue_pickup_pin(AUCTION, ADMIN_ID)
        with self.assertRaises(HandoverError):
            service.find(old)

    def test_only_a_winner_who_has_not_collected_can_get_one(self):
        _, db = waiting_world(fulfillment_status='collected')
        with self.assertRaises(AuctionError) as raised:
            AuctionService(db).reissue_pickup_pin(AUCTION, ADMIN_ID)
        self.assertEqual(raised.exception.status, 409)


class WinnerViewTests(unittest.TestCase):
    def view(self, viewer):
        store, db = waiting_world()
        pin = HandoverService(db).issue_for_auction(AUCTION)
        with patch.object(AuctionService, 'settle_and_notify'):
            detail = AuctionService(db).public_detail(AUCTION, viewer)
        return detail['viewer'], pin

    def test_only_the_winner_sees_the_pin(self):
        viewer, pin = self.view(WINNER)
        self.assertEqual((viewer['is_winner'], viewer['handover_pin']), (True, pin))
        for other in (OWNER, None):
            viewer, _ = self.view(other)
            self.assertIsNone(viewer['handover_pin'], other)

    def qr(self, account_id):
        store, db = waiting_world()
        HandoverService(db).issue_for_auction(AUCTION)
        client = client_for(user_auction_routes.auctions_bp, '/api/auctions')
        with patch.object(user_auction_routes, '_service', return_value=AuctionService(db)), patch.object(user_auction_routes, '_optional_account_id', return_value=account_id):
            return client.get(f'/api/auctions/{AUCTION}/handover-qr')

    def test_the_qr_code_is_for_the_winner_only_and_never_cached(self):
        response = self.qr(WINNER)
        self.assertEqual((response.status_code, response.mimetype, response.headers['Cache-Control']), (200, 'image/png', 'no-store'))
        self.assertTrue(response.data.startswith(b'\x89PNG'))
        self.assertEqual(self.qr(OWNER).status_code, 404)
        self.assertEqual(self.qr(None).status_code, 401)


# ------------------------------------------------------------------------------------------------------------ the routes
class PickupRouteTests(unittest.TestCase):
    def setUp(self):
        self.store, self.db = waiting_world()
        self.pin = HandoverService(self.db).issue_for_auction(AUCTION)

    def desk(self, level, path, body):
        client = client_for(claim_routes.claims_verification_bp, '/api/admin')
        patches = staff_patches(level, ADMIN_ID) + (patch.object(claim_routes, 'get_db', return_value=self.db), patch.object(claim_routes, '_log_admin_action'),
                                                     patch.object(claim_routes, '_send_receipt'))
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5] as receipt:
            return client.post(path, json=body), receipt

    def test_a_guard_looks_up_and_releases_an_auction_pin_at_the_desk(self):
        looked, _ = self.desk('guard', '/api/admin/claims/handover/lookup', {'pin': self.pin})
        self.assertEqual((looked.status_code, looked.get_json()['claim']['kind'], looked.get_json()['claim']['amount_due']), (200, 'auction', 500.0))
        released, receipt = self.desk('guard', '/api/admin/claims/handover/release', {'pin': self.pin})
        self.assertEqual(released.status_code, 200)
        self.assertIn('auction is complete', released.get_json()['message'])
        self.assertEqual(self.store['auctions'][0]['fulfillment_status'], 'collected')
        receipt.assert_not_called()   # the claim handover receipt is only for claims

    def test_a_wrong_pin_changes_nothing(self):
        response, _ = self.desk('guard', '/api/admin/claims/handover/release', {'pin': 'ZZZZZZ'})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.store['auctions'][0]['fulfillment_status'], 'awaiting_pickup')

    def auction_call(self, level, method, path):
        client = client_for(admin_auction_routes.auctions_bp, '/api/admin')
        patches = staff_patches(level, ADMIN_ID) + (patch.object(admin_auction_routes, 'get_db', return_value=self.db), patch.object(admin_auction_routes, '_log_admin_action'))
        with patches[0], patches[1], patches[2], patches[3], patches[4], patch('app.utils.auction_db.send_auction_won_email', return_value={'mode': 'mock', 'sent': True}):
            return getattr(client, method)(path, json={'action': 'collected'})

    def test_an_administrator_can_complete_the_auction_by_hand_without_a_pin(self):
        self.store['auctions'][0].pop('handover_pin_hash')   # a win that never got a PIN
        response = self.auction_call('admin', 'post', f'/api/admin/auctions/{AUCTION}/fulfillment')
        self.assertEqual(response.status_code, 200)
        self.assertIn('without a PIN', response.get_json()['message'])
        self.assertEqual((self.store['auctions'][0]['fulfillment_status'], self.store['found_items'][0]['status']), ('collected', 'returned'))

    def test_a_guard_cannot_complete_an_auction_by_hand(self):
        response = self.auction_call('guard', 'post', f'/api/admin/auctions/{AUCTION}/fulfillment')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.store['auctions'][0]['fulfillment_status'], 'awaiting_pickup')

    def test_an_administrator_can_send_a_new_pin(self):
        old = self.store['auctions'][0]['handover_pin_hash']
        response = self.auction_call('admin', 'post', f'/api/admin/auctions/{AUCTION}/handover-pin')
        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(self.store['auctions'][0]['handover_pin_hash'], old)
        self.assertEqual(self.auction_call('guard', 'post', f'/api/admin/auctions/{AUCTION}/handover-pin').status_code, 403)

    def test_the_admin_list_says_whether_the_winner_has_a_pin(self):
        card = AuctionService(self.db).admin_list()['auctions'][0]
        self.assertEqual((card['stage'], card['handover_pin_issued']), ('awaiting_pickup', True))
        self.assertNotIn(self.pin, str(card))


# ------------------------------------------------------------------------------------------------------------ Smart Tag contact methods
class ContactCleaningTests(unittest.TestCase):
    def test_usernames_and_profile_links_become_the_same_handle(self):
        for kind, text, expected in (
            ('messenger', 'juan.cruz', 'juan.cruz'), ('messenger', '@juan.cruz', 'juan.cruz'), ('messenger', 'm.me/juan.cruz', 'juan.cruz'),
            ('messenger', 'https://www.messenger.com/t/juan.cruz', 'juan.cruz'), ('messenger', 'https://facebook.com/juan.cruz?ref=x', 'juan.cruz'),
            ('facebook', 'https://www.facebook.com/juan.cruz', 'juan.cruz'), ('facebook', 'facebook.com/profile.php?id=1000123456789', '1000123456789'),
            ('instagram', '@juan_cruz', 'juan_cruz'), ('instagram', 'https://instagram.com/juan_cruz/', 'juan_cruz'),
            ('telegram', 'https://t.me/juan_cruz', 'juan_cruz'), ('telegram', 'juan_cruz', 'juan_cruz'),
        ):
            self.assertEqual(clean_contact(kind, text), expected, (kind, text))

    def test_phone_numbers(self):
        self.assertEqual(clean_contact('phone2', ' 0917 123   4567 '), '0917 123 4567')
        self.assertEqual(clean_contact('whatsapp', '0917 123 4567'), '639171234567')
        self.assertEqual(clean_contact('whatsapp', '+63 917 123 4567'), '639171234567')
        for bad in ('12', 'call me'):
            with self.assertRaises(TagError):
                clean_contact('whatsapp', bad)
        with self.assertRaises(TagError):
            clean_contact('phone2', 'abc')

    def test_anything_that_is_not_a_username_is_refused(self):
        for kind, text in (('messenger', 'javascript:alert(1)'), ('facebook', 'https://evil.example/juan.cruz'), ('instagram', 'a b'), ('telegram', 'ab'),
                           ('messenger', '<script>'), ('facebook', 'https://facebook.com/'), ('instagram', 'x' * 40)):
            with self.assertRaises(TagError, msg=(kind, text)):
                clean_contact(kind, text)

    def test_an_empty_value_clears_it(self):
        self.assertEqual(clean_contact('messenger', '   '), '')

    def test_links_are_built_from_the_handle_never_from_user_text(self):
        self.assertEqual(contact_url('messenger', 'juan.cruz'), 'https://m.me/juan.cruz')
        self.assertEqual(contact_url('facebook', 'juan.cruz'), 'https://www.facebook.com/juan.cruz')
        self.assertEqual(contact_url('facebook', '1000123456789'), 'https://www.facebook.com/profile.php?id=1000123456789')
        self.assertEqual(contact_url('instagram', 'juan_cruz'), 'https://www.instagram.com/juan_cruz')
        self.assertEqual(contact_url('telegram', 'juan_cruz'), 'https://t.me/juan_cruz')
        self.assertEqual(contact_url('whatsapp', '639171234567'), 'https://wa.me/639171234567')
        self.assertEqual(contact_url('phone2', '0917 123 4567'), 'tel:09171234567')

    def test_stored_contacts_ignores_junk(self):
        self.assertEqual(stored_contacts({'tag_contacts': {'messenger': 'a.b.c.d', 'bogus': 'x', 'telegram': ''}}), {'messenger': 'a.b.c.d'})
        self.assertEqual(stored_contacts({'tag_contacts': 'nope'}), {})
        self.assertEqual(stored_contacts(None), {})


class ContactServiceTests(unittest.TestCase):
    def setUp(self):
        self.store = {
            'user_profiles': [{'account_id': OWNER, 'fname': 'Maria', 'lname': 'Santos', 'email': 'maria@umak.edu.ph', 'tag_contacts': {}}],
            'smart_tags': [{'tag_id': TAG, 'status': 'active', 'owner_account_id': OWNER, 'item_name': 'Umbrella', 'item_description': '', 'is_disabled': False,
                            'show_name': True, 'show_email': False, 'show_phone': False, 'contact_phone': None, 'shown_contacts': [], 'valid_until': None}],
        }
        self.db = MagicMock()
        self.db.client = MemClient(self.store)
        self.db.get_user_by_account_id.side_effect = lambda a: dict(next((p for p in self.store['user_profiles'] if p['account_id'] == a), {})) or None
        self.db._decrypt_profile_sensitive_fields = None
        self.service = SmartTagService(self.db)

    def test_contacts_are_saved_merged_and_cleared(self):
        self.assertEqual(self.service.get_contacts(OWNER), {kind: '' for kind in CONTACT_LABELS})
        saved = self.service.save_contacts(OWNER, {'messenger': 'm.me/maria.santos', 'whatsapp': '0917 123 4567'})
        self.assertEqual((saved['messenger'], saved['whatsapp'], saved['telegram']), ('maria.santos', '639171234567', ''))
        self.service.save_contacts(OWNER, {'telegram': 'maria_s'})   # the others stay
        self.assertEqual(self.store['user_profiles'][0]['tag_contacts'], {'messenger': 'maria.santos', 'whatsapp': '639171234567', 'telegram': 'maria_s'})
        self.service.save_contacts(OWNER, {'whatsapp': ''})
        self.assertNotIn('whatsapp', self.store['user_profiles'][0]['tag_contacts'])

    def test_one_bad_value_saves_nothing(self):
        with self.assertRaises(TagError):
            self.service.save_contacts(OWNER, {'messenger': 'maria.santos', 'instagram': 'not valid!'})
        self.assertEqual(self.store['user_profiles'][0]['tag_contacts'], {})

    def test_a_tag_can_only_show_a_method_that_is_saved(self):
        with self.assertRaises(TagError) as raised:
            self.service.update(TAG, OWNER, {'shown_contacts': ['messenger']})
        self.assertIn('Add your Messenger', raised.exception.message)
        self.service.save_contacts(OWNER, {'messenger': 'maria.santos'})
        tag = self.service.update(TAG, OWNER, {'shown_contacts': ['messenger', 'messenger']})
        self.assertEqual(tag['shown_contacts'], ['messenger'])
        with self.assertRaises(TagError):
            self.service.update(TAG, OWNER, {'shown_contacts': ['carrier_pigeon']})

    def test_a_finder_sees_only_the_links_the_owner_switched_on_for_that_tag(self):
        self.service.save_contacts(OWNER, {'messenger': 'maria.santos', 'telegram': 'maria_s', 'phone2': '0917 123 4567'})
        self.service.update(TAG, OWNER, {'shown_contacts': ['messenger', 'phone2']})
        contact = self.service.public_view(TAG, None)['contact']
        self.assertEqual([(link['kind'], link['url']) for link in contact['links']], [('messenger', 'https://m.me/maria.santos'), ('phone2', 'tel:09171234567')])
        self.assertNotIn('maria_s', str(contact))     # telegram was saved but not switched on for this tag
        self.assertEqual(contact['name'], 'Maria Santos')

    def test_without_any_choice_a_finder_gets_no_links_and_no_saved_handles(self):
        self.service.save_contacts(OWNER, {'messenger': 'maria.santos'})
        view = self.service.public_view(TAG, None)
        self.assertNotIn('links', view['contact'])
        self.assertNotIn('maria.santos', str(view))

    def test_removing_a_saved_method_removes_it_from_the_tags_that_showed_it(self):
        self.service.save_contacts(OWNER, {'messenger': 'maria.santos', 'telegram': 'maria_s'})
        self.service.update(TAG, OWNER, {'shown_contacts': ['messenger', 'telegram']})
        self.service.save_contacts(OWNER, {'messenger': ''})
        self.assertEqual(self.store['smart_tags'][0]['shown_contacts'], ['telegram'])
        self.assertEqual([link['kind'] for link in self.service.public_view(TAG, None)['contact']['links']], ['telegram'])

    def test_a_stale_choice_for_a_method_the_owner_no_longer_has_never_crashes_or_shows(self):
        self.store['smart_tags'][0]['shown_contacts'] = ['messenger', 'carrier_pigeon']
        view = self.service.public_view(TAG, None)
        self.assertNotIn('links', view['contact'])

    def test_another_persons_tag_cannot_be_changed(self):
        self.service.save_contacts(OWNER, {'messenger': 'maria.santos'})
        with self.assertRaises(TagError) as raised:
            self.service.update(TAG, 'someone-else', {'shown_contacts': ['messenger']})
        self.assertEqual(raised.exception.status, 404)

    def test_before_the_migration_the_feature_asks_for_the_update_instead_of_failing(self):
        self.db.client = MemClient(self.store, missing_columns={'user_profiles': ('tag_contacts',)})
        service = SmartTagService(self.db)
        with self.assertRaises(TagsUnavailable):
            service.save_contacts(OWNER, {'messenger': 'maria.santos'})

    def call(self, method, path, body=None):
        client = client_for(tag_routes.smart_tags_bp, '/api/tags')
        with patch.object(tag_routes, '_service', return_value=self.service), patch.object(tag_routes, '_authenticated_account_id', return_value=OWNER):
            return getattr(client, method)(path, json=body)

    def test_the_routes_read_and_save_the_owners_contacts(self):
        saved = self.call('put', '/api/tags/contacts', {'instagram': '@maria_santos'})
        self.assertEqual((saved.status_code, saved.get_json()['contacts']['instagram']), (200, 'maria_santos'))
        self.assertEqual(saved.headers['Cache-Control'], 'no-store')
        self.assertEqual(self.call('get', '/api/tags/contacts').get_json()['contacts']['instagram'], 'maria_santos')
        self.assertEqual(self.call('put', '/api/tags/contacts', {'instagram': 'bad value!'}).status_code, 400)
        mine = self.call('get', '/api/tags/mine').get_json()['tags'][0]
        self.assertEqual(mine['shown_contacts'], [])


# ------------------------------------------------------------------------------------------------------------ health check
class HealthStatusTests(unittest.TestCase):
    def test_every_status_a_check_can_return_is_one_the_page_knows(self):
        """The page crashed on `info` (suspended accounts exist) because it only knew ok, warn and fail."""
        import re
        source = (ROOT / 'app' / 'utils' / 'system_control.py').read_text(encoding='utf-8')
        used = set(re.findall(r"_check\('[a-z_]+', '[^']+', '([a-z]+)'", source)) | {'ok', 'warn', 'fail'}
        page = (ROOT.parent / 'Admin' / 'Frontend' / 'src' / 'pages' / 'system-control' / 'SystemControl.tsx').read_text(encoding='utf-8')
        types = (ROOT.parent / 'Admin' / 'Frontend' / 'src' / 'utils' / 'systemApi.ts').read_text(encoding='utf-8')
        for status in used:
            self.assertIn(f'  {status}: {{ icon:', page, f'the System control page has no look for "{status}"')
            self.assertIn(f'"{status}"', types.split('export type HealthStatus')[1].split(';')[0])
        self.assertEqual(set(control.RANK) - {'info'}, {'ok', 'warn', 'fail'})


if __name__ == '__main__':
    unittest.main()
