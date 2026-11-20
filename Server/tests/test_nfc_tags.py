"""NFC integration tests use memory tables only; no server, network or storage."""
import copy
import unittest
from unittest.mock import patch

from test_smart_tags import (
    ADMIN, CLAIM, OTHER, OWNER, PROFILES, TAG, admin_client, make_service,
    tag_row, tags, user_client, user_routes, admin_routes,
)
from app.utils.nfc_tags import prepare_nfc
from app.utils.smart_tags import TagError


class NfcTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict('os.environ', {'PUBLIC_SITE_URL': 'https://ebalik.example', 'SMART_TAG_TYPES_ENABLED': 'qr,nfc'})
        self.env.start()
        self.addCleanup(self.env.stop)
        from app.utils import rate_limit
        rate_limit.reset()

    def test_distinct_batches_and_default_qr_are_preserved(self):
        service, _, store = make_service()
        qr = service.create_batch(3, 'QR', ADMIN)
        nfc = service.create_batch(3, 'NFC', ADMIN, 'nfc')
        self.assertEqual(qr['tag_type'], 'qr')
        self.assertTrue(set(qr['tag_ids']).isdisjoint(nfc['tag_ids']))
        self.assertTrue(all(r['status'] == 'blank' and not r.get('owner_account_id') for r in store['smart_tags']))
        for code, value in zip(nfc['tag_ids'], nfc['values']):
            self.assertEqual(value, f'https://ebalik.example/tag/{code}')

    def test_explicit_qr_only_configuration_is_respected(self):
        service, _, _ = make_service()
        with patch.dict('os.environ', {'SMART_TAG_TYPES_ENABLED': 'qr'}), self.assertRaises(TagError):
            service.create_batch(1, 'NFC', ADMIN, 'nfc')

    def test_nfc_registration_requires_consent_photo_and_staff_approval(self):
        service, _, store = make_service([tag_row(tag_type='nfc', status='blank', owner_account_id=None)])
        with self.assertRaises(TagError):
            service.claim(TAG, OWNER, {**CLAIM, 'dpa_consent': False})
        with self.assertRaises(TagError):
            service.claim(TAG, OWNER, CLAIM, None)
        view = service.claim(TAG, OWNER, CLAIM)
        self.assertEqual((view['tag_type'], view['status']), ('nfc', 'pending_verification'))
        public = service.public_view(TAG)
        self.assertNotIn('contact', public)
        self.assertNotIn('item_name', public)
        with self.assertRaises(TagError):
            service.claim(TAG, OTHER, CLAIM)
        self.assertEqual(store['smart_tags'][0]['owner_account_id'], OWNER)

    def test_url_preparation_is_read_only_and_contains_no_personal_data(self):
        service, db, store = make_service([tag_row(tag_type='nfc', show_name=True, show_phone=True)])
        before = copy.deepcopy(store)
        payload = prepare_nfc(service, TAG)
        self.assertEqual(payload['records'], [{'recordType': 'url', 'data': f'https://ebalik.example/tag/{TAG}'}])
        self.assertFalse(payload['offline_contact'])
        self.assertEqual(store, before)
        db.create_user_notification.assert_not_called()
        db.log_user_activity.assert_not_called()

    def test_nfc_fee_confirmation_still_precedes_staff_approval(self):
        service, _, store = make_service([tag_row(tag_type='nfc', status='pending_verification', price=150, show_name=True, show_phone=True)])
        with patch('app.utils.payments.PaymentDesk.is_paid', return_value=False):
            with self.assertRaises(TagError) as caught:
                service.approve(TAG, ADMIN)
        self.assertEqual(caught.exception.extra['code'], 'payment_required')
        self.assertEqual(store['smart_tags'][0]['status'], 'pending_verification')
        with patch('app.utils.payments.PaymentDesk.is_paid', return_value=True):
            service.approve(TAG, ADMIN)
        self.assertEqual(service.public_view(TAG)['status'], 'active')
        self.assertEqual(len(prepare_nfc(service, TAG, account_id=OWNER, offline_contact=True)['records']), 2)

    def test_qr_and_rfid_cannot_be_reencoded_as_nfc(self):
        for kind in ('qr', 'rfid', None):
            with self.subTest(kind=kind):
                service, _, _ = make_service([tag_row(tag_type=kind)])
                with self.assertRaises(TagError):
                    prepare_nfc(service, TAG)

    def test_only_owner_can_request_offline_contact(self):
        service, _, _ = make_service([tag_row(tag_type='nfc', show_name=True, show_phone=True)])
        for account in (None, OTHER):
            with self.subTest(account=account), self.assertRaises(TagError):
                prepare_nfc(service, TAG, account_id=account, offline_contact=True)

    def test_offline_contact_is_explicit_minimal_and_uses_initials(self):
        service, _, store = make_service([tag_row(tag_type='nfc', show_name=True, show_phone=True)])
        with patch.dict(PROFILES[OWNER], {'tag_contacts': {'name_display': 'initials'}}):
            payload = prepare_nfc(service, TAG, account_id=OWNER, offline_contact=True)
        self.assertEqual(payload['records'][0]['recordType'], 'url')
        text = payload['records'][1]['data']
        self.assertIn('M. S.', text)
        self.assertIn('0917', text)
        self.assertNotIn('Santos', text)
        self.assertNotIn('email', text)
        self.assertNotIn('offline_contact', store['smart_tags'][0])

    def test_hidden_contact_and_ineligible_states_are_rejected(self):
        changes = [{'show_name': False}, {'show_phone': False}, {'status': 'blank'}, {'status': 'pending_verification'},
                   {'status': 'expired'}, {'valid_until': '2020-01-01T00:00:00+00:00'}, {'is_disabled': True}]
        for change in changes:
            with self.subTest(change=change):
                service, _, store = make_service([tag_row(**({'tag_type': 'nfc', 'show_name': True, 'show_phone': True} | change))])
                before = copy.deepcopy(store)
                with self.assertRaises(TagError):
                    prepare_nfc(service, TAG, account_id=OWNER, offline_contact=True)
                self.assertEqual(store, before)

    def test_saved_visible_phone_option_is_supported(self):
        service, _, _ = make_service([tag_row(tag_type='nfc', show_name=True, shown_contacts=['phone2'])])
        with patch.dict(PROFILES[OWNER], {'tag_contacts': {'phone2': '09171234567'}}):
            self.assertIn('09171234567', prepare_nfc(service, TAG, account_id=OWNER, offline_contact=True)['records'][1]['data'])

    def test_disabled_and_missing_tags_are_rejected(self):
        service, _, _ = make_service([tag_row(tag_type='nfc', is_disabled=True)])
        for code in (TAG, 'NOTFOUND1234', 'invalid!'):
            with self.subTest(code=code), self.assertRaises(TagError):
                prepare_nfc(service, code)

    def test_disabled_owner_can_remove_physical_contact_without_reactivation(self):
        service, _, store = make_service([tag_row(tag_type='nfc', is_disabled=True, show_name=True, show_phone=True)])
        before = copy.deepcopy(store)
        payload = prepare_nfc(service, TAG, account_id=OWNER)
        self.assertEqual(len(payload['records']), 1)
        self.assertEqual(store, before)

    def test_development_or_credential_urls_cannot_be_written(self):
        service, _, _ = make_service([tag_row(tag_type='nfc')])
        for url in ('', 'http://example.com', 'https://localhost:5173', 'https://u:p@example.com', 'https://example.com?x=1', 'https://example.com#x'):
            with self.subTest(url=url), patch.dict('os.environ', {'PUBLIC_SITE_URL': url}), self.assertRaises(TagError):
                prepare_nfc(service, TAG)

    def test_medium_filter_is_applied_to_rows_and_counts_before_limit(self):
        service, _, _ = make_service([tag_row(tag_type='nfc'), tag_row(tag_id='QRTESTCODE12', tag_type='qr', status='lost')])
        result = service.admin_list('all', '', 'nfc')
        self.assertEqual([r['tag_id'] for r in result['tags']], [TAG])
        self.assertEqual((result['stats']['total'], result['stats']['lost']), (1, 0))
        self.assertEqual(service.admin_list('all', '', 'qr')['stats']['total'], 1)
        with self.assertRaises(TagError):
            service.admin_list('all', '', 'invented')

    def test_owner_endpoint_requires_auth_and_ownership_and_no_store(self):
        service, _, _ = make_service([tag_row(tag_type='nfc')])
        client, service_patch = user_client(service)
        with service_patch, patch.object(user_routes, '_authenticated_account_id', side_effect=ValueError('Login required')):
            self.assertEqual(client.post(f'/api/tags/{TAG}/nfc').status_code, 401)
        with service_patch, patch.object(user_routes, '_authenticated_account_id', return_value=OTHER):
            self.assertEqual(client.post(f'/api/tags/{TAG}/nfc').status_code, 404)
        with service_patch, patch.object(user_routes, '_authenticated_account_id', return_value=OWNER):
            result = client.post(f'/api/tags/{TAG}/nfc', json={})
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.headers['Cache-Control'], 'no-store')
            self.assertFalse(result.json['offline_contact'])
            self.assertEqual(client.post(f'/api/tags/{TAG}/nfc', json={'offline_contact': 'false'}).status_code, 400)
            self.assertEqual(client.post(f'/api/tags/{TAG}/nfc', json=['true']).status_code, 400)

    def test_admin_endpoint_requires_staff_and_never_includes_contact(self):
        service, _, _ = make_service([tag_row(tag_type='nfc', show_name=True, show_phone=True)])
        client, service_patch, access = admin_client(service)
        with service_patch, access:
            result = client.get(f'/api/admin/smart-tags/{TAG}/nfc?offline_contact=true')
            self.assertEqual(result.status_code, 200)
            self.assertEqual(len(result.json['records']), 1)
            self.assertEqual(result.headers['Cache-Control'], 'no-store')
        with patch.object(admin_routes, '_require_admin', side_effect=PermissionError('Forbidden')):
            self.assertEqual(client.get(f'/api/admin/smart-tags/{TAG}/nfc').status_code, 403)

    def test_nfc_and_qr_public_privacy_remain_identical(self):
        for status in ('active', 'lost', 'pending_verification', 'expired', 'blank'):
            with self.subTest(status=status):
                qr, _, _ = make_service([tag_row(tag_type='qr', status=status, show_name=False, show_phone=False)])
                nfc, _, _ = make_service([tag_row(tag_type='nfc', status=status, show_name=False, show_phone=False)])
                self.assertEqual(qr.public_view(TAG), nfc.public_view(TAG))


if __name__ == '__main__':
    unittest.main()
