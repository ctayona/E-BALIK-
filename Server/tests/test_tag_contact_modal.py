"""Smart Tag contact settings (2026-10-19): email and X as contact methods, the name and language settings kept next to them,
what the scan page shows with those settings, and the owner-only QR image."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT.parent, ROOT / 'tests'):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from test_round2_fixes import TAG, ContactServiceTests, client_for  # noqa: E402
from test_handover_and_timeouts import OWNER, WINNER  # noqa: E402
from Users.Backend.smart_tags import routes as tag_routes  # noqa: E402
from app.utils.smart_tags import CONTACT_LABELS, TagError, clean_contact, clean_settings, contact_url, initials_of, stored_settings  # noqa: E402


class NewContactKinds(unittest.TestCase):
    def test_email_is_cleaned_and_becomes_a_mailto_link(self):
        self.assertEqual(clean_contact('email', ' Maria.Santos@UMak.edu.ph '), 'maria.santos@umak.edu.ph')
        self.assertEqual(clean_contact('email', 'mailto:maria@umak.edu.ph'), 'maria@umak.edu.ph')
        self.assertEqual(contact_url('email', 'maria@umak.edu.ph'), 'mailto:maria@umak.edu.ph')
        for bad in ('maria', 'maria@umak', 'ma ria@umak.edu.ph', 'a@@b.com', 'a..b@c.com', 'x' * 130 + '@b.com', '<script>@x.com'):
            with self.assertRaises(TagError, msg=bad):
                clean_contact('email', bad)

    def test_x_handles_and_links_are_accepted_and_rebuilt(self):
        for text in ('juan_cruz', '@juan_cruz', 'https://x.com/juan_cruz', 'twitter.com/juan_cruz', 'https://mobile.twitter.com/juan_cruz?s=20'):
            self.assertEqual(clean_contact('twitter', text), 'juan_cruz', text)
        self.assertEqual(contact_url('twitter', 'juan_cruz'), 'https://x.com/juan_cruz')
        for bad in ('this handle is too long_x', 'evil.com/juan', 'juan-cruz'):
            with self.assertRaises(TagError, msg=bad):
                clean_contact('twitter', bad)

    def test_the_new_kinds_are_known_and_the_old_ones_stay(self):
        self.assertEqual(list(CONTACT_LABELS), ['phone2', 'email', 'messenger', 'facebook', 'twitter', 'instagram', 'telegram', 'whatsapp'])


class Settings(unittest.TestCase):
    def test_defaults_and_validation(self):
        self.assertEqual(stored_settings(None), {'name_display': 'full', 'language': 'en'})
        self.assertEqual(stored_settings({'tag_contacts': {'name_display': 'initials', 'language': 'klingon'}}), {'name_display': 'initials', 'language': 'en'})
        self.assertEqual(clean_settings({'language': 'FIL'}), {'language': 'fil'})
        self.assertEqual(clean_settings('nope'), {})
        with self.assertRaises(TagError):
            clean_settings({'name_display': 'nickname'})

    def test_initials(self):
        self.assertEqual(initials_of('Maria Santos'), 'M. S.')
        self.assertEqual(initials_of('  maria   dela cruz '), 'M. D. C.')


class SavingAndScanning(ContactServiceTests):
    def test_settings_and_contacts_are_saved_together_and_kept_apart(self):
        self.service.save_contacts(OWNER, {'email': 'maria@umak.edu.ph', 'twitter': '@maria_s'}, {'name_display': 'initials', 'language': 'fil'})
        stored = self.store['user_profiles'][0]['tag_contacts']
        self.assertEqual(stored, {'email': 'maria@umak.edu.ph', 'twitter': 'maria_s', 'name_display': 'initials', 'language': 'fil'})
        # Saving contacts again without settings keeps the settings; settings never appear among the contacts.
        contacts = self.service.save_contacts(OWNER, {'twitter': ''})
        self.assertNotIn('name_display', contacts)
        self.assertEqual(self.store['user_profiles'][0]['tag_contacts'], {'email': 'maria@umak.edu.ph', 'name_display': 'initials', 'language': 'fil'})
        self.assertEqual(self.service.get_settings(OWNER), {'name_display': 'initials', 'language': 'fil'})

    def test_a_bad_setting_saves_nothing(self):
        with self.assertRaises(TagError):
            self.service.save_contacts(OWNER, {'email': 'maria@umak.edu.ph'}, {'language': 'xx'})
        self.assertEqual(self.store['user_profiles'][0]['tag_contacts'], {})

    def test_the_scan_page_follows_the_name_and_language_settings(self):
        view = self.service.public_view(TAG, None)
        self.assertEqual((view['contact']['name'], view['language']), ('Maria Santos', 'en'))
        self.service.save_contacts(OWNER, {}, {'name_display': 'initials', 'language': 'fil'})
        view = self.service.public_view(TAG, None)
        self.assertEqual((view['contact']['name'], view['language']), ('M. S.', 'fil'))

    def test_email_and_x_are_shown_only_when_switched_on_for_the_tag(self):
        self.service.save_contacts(OWNER, {'email': 'maria@umak.edu.ph', 'twitter': 'maria_s'})
        self.assertNotIn('links', self.service.public_view(TAG, None)['contact'])
        self.service.update(TAG, OWNER, {'shown_contacts': ['email', 'twitter']})
        links = self.service.public_view(TAG, None)['contact']['links']
        self.assertEqual([(link['kind'], link['url']) for link in links], [('email', 'mailto:maria@umak.edu.ph'), ('twitter', 'https://x.com/maria_s')])

    def test_the_owner_gets_the_qr_image_and_nobody_else_does(self):
        self.assertTrue(self.service.owner_qr(TAG, OWNER).startswith(b'\x89PNG'))
        for account, code in ((WINNER, TAG), (OWNER, 'ZZZZZZZZZZ22'), (OWNER, 'bad')):
            with self.assertRaises(TagError) as caught:
                self.service.owner_qr(code, account)
            self.assertEqual(caught.exception.status, 404)

    def test_routes(self):
        client = client_for(tag_routes.smart_tags_bp, '/api/tags')
        with patch.object(tag_routes, '_service', return_value=self.service), patch.object(tag_routes, '_authenticated_account_id', return_value=OWNER):
            got = client.get('/api/tags/contacts').get_json()
            self.assertEqual(got['settings'], {'name_display': 'full', 'language': 'en'})
            self.assertIn('email', got['contacts'])
            put = client.put('/api/tags/contacts', json={'email': 'maria@umak.edu.ph', 'settings': {'language': 'fil'}})
            self.assertEqual((put.status_code, put.get_json()['settings']['language'], put.get_json()['contacts']['email']), (200, 'fil', 'maria@umak.edu.ph'))
            qr = client.get(f'/api/tags/{TAG}/qr')
            self.assertEqual((qr.status_code, qr.mimetype, qr.headers['Cache-Control']), (200, 'image/png', 'no-store'))
        with patch.object(tag_routes, '_service', return_value=self.service), patch.object(tag_routes, '_authenticated_account_id', return_value=WINNER):
            self.assertEqual(client.get(f'/api/tags/{TAG}/qr').status_code, 404)


if __name__ == '__main__':
    unittest.main()
