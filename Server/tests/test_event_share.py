"""Offline event entry QR isolation, canonical addresses and access gates."""
import base64
import io
import unittest
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from flask import Flask
from PIL import Image
from test_event_reports import fixture, ADMIN, EVENT, SECOND
from app.utils.events import EventError
from app.utils.event_share import EventShare, event_origin
from Admin.Backend.events import routes


class EventOriginTests(unittest.TestCase):
    def test_https_origin_is_canonical_and_trailing_slash_is_removed(self):
        with patch.dict('os.environ', {'PUBLIC_SITE_URL': ' https://ebalik.example.test/ '}):
            self.assertEqual(event_origin(), ('https://ebalik.example.test', True, ''))

    def test_local_and_http_origins_are_preview_only(self):
        for value in ('', 'http://localhost:5173', 'https://localhost', 'http://127.0.0.1:5173', 'https://[::1]', 'https://0.0.0.0', 'http://ebalik.example.test'):
            with self.subTest(value=value), patch.dict('os.environ', {'PUBLIC_SITE_URL': value}):
                origin, ready, reason = event_origin()
                self.assertTrue(origin.startswith(('http://', 'https://')))
                self.assertFalse(ready)
                self.assertTrue(reason)

    def test_untrusted_schemes_credentials_paths_and_malformed_origins_fail_closed(self):
        for value in ('javascript:alert(1)', 'https://user:password@example.test', 'https://example.test/admin',
                      'https://example.test?token=secret', 'https://example.test/#token', 'https://example.test:70000',
                      'https://example.test\\@evil.test', 'https://exa mple.test', 'https://example.test\n.evil.test',
                      'https://%65xample.test', 'https://example.test:0'):
            with self.subTest(value=value), patch.dict('os.environ', {'PUBLIC_SITE_URL': value}), self.assertRaises(EventError) as error:
                event_origin()
            self.assertEqual(error.exception.code, 'event_share_url_invalid')


class EventShareTests(unittest.TestCase):
    def setUp(self):
        fixture(self)
        self.store['smart_tags'] = [{'tag_id': 'campus-sentinel', 'owner': 'unchanged'}]
        self.sharing = EventShare(self.db)
        settings = patch.dict('os.environ', {'PUBLIC_SITE_URL': 'https://ebalik.example.test'})
        settings.start(); self.addCleanup(settings.stop)

    def test_saved_event_link_contains_no_tag_or_private_payload_and_never_writes(self):
        self.event['created_by'] = 'private-admin-account'
        before = deepcopy(self.store)
        value = self.sharing.view(EVENT)
        self.assertEqual(value['url'], 'https://ebalik.example.test/events/campus-event')
        self.assertTrue(value['share_ready'])
        for private in ('created_by', 'memberships', 'description', 'reporter_account_id', 'pin_hash', 'smart_tags'):
            self.assertNotIn(private, str(value))
        self.assertEqual(self.store, before)
        self.db.client.storage.from_.assert_not_called()

    def test_png_uses_opaque_black_white_modules_and_a_four_module_quiet_zone(self):
        encoded = self.sharing.view(EVENT)['qr_image']
        self.assertTrue(encoded.startswith('data:image/png;base64,'))
        png = base64.b64decode(encoded.partition(',')[2], validate=True)
        image = Image.open(io.BytesIO(png)).convert('RGB')
        self.assertEqual(image.width, image.height)
        self.assertGreaterEqual(image.width, 300)
        self.assertEqual(set(image.getdata()), {(0, 0, 0), (255, 255, 255)})
        self.assertEqual(set(image.crop((0, 0, image.width, 48)).getdata()), {(255, 255, 255)})

    def test_paused_terminal_future_and_expired_events_cannot_be_distributed(self):
        for change in ({'portal_enabled': False}, {'status': 'draft'}, {'status': 'scheduled'}, {'status': 'closed'},
                       {'status': 'archived'}, {'status': 'cancelled'}, {'starts_at': (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()},
                       {'recovery_ends_at': '2020-01-01T00:00:00Z'}):
            original = dict(self.event); self.event.update(change)
            with self.subTest(change=change):
                value = self.sharing.view(EVENT)
                self.assertFalse(value['portal_open'])
                self.assertFalse(value['share_ready'])
                self.assertTrue(value['reason'])
            self.event.clear(); self.event.update(original)

    def test_deleted_and_unknown_events_do_not_produce_a_share_card(self):
        self.event['deleted_at'] = self.event['starts_at']
        with self.assertRaises(EventError): self.sharing.view(EVENT)
        with self.assertRaises(EventError): self.sharing.view(SECOND)

    def test_sharing_requires_reporting_setup_but_not_the_recovery_migration(self):
        self.assertTrue(self.sharing.view(EVENT)['share_ready'])
        self.store['migration_log'] = []
        with self.assertRaises(EventError) as error: self.sharing.view(EVENT)
        self.assertEqual(error.exception.code, 'event_reports_setup_required')

    def test_two_events_have_distinct_entry_links_without_changing_campus_tags(self):
        self.store['event_workspaces'].append({**self.event, 'event_id': SECOND, 'slug': 'second-campus-event'})
        before = deepcopy(self.store)
        one, two = self.sharing.view(EVENT), self.sharing.view(SECOND)
        self.assertNotEqual(one['url'], two['url'])
        self.assertNotEqual(one['qr_image'], two['qr_image'])
        self.assertEqual(self.store, before)


class EventShareRouteTests(unittest.TestCase):
    def setUp(self):
        fixture(self)
        self.app = Flask(__name__)
        self.app.config.update(EVENTS_FOUNDATION_ENABLED=True, SUPABASE_URL='https://example.invalid', SUPABASE_SERVICE_KEY='offline')
        self.app.register_blueprint(routes.events_bp, url_prefix='/api/admin')
        self.client = self.app.test_client()

    def test_disabled_or_unauthorized_requests_never_connect(self):
        with patch.object(routes, '_require_admin', side_effect=PermissionError()) as auth, patch.object(routes, 'get_db') as db:
            self.assertEqual(self.client.get(f'/api/admin/events/{EVENT}/share').status_code, 403)
            auth.assert_called_once_with('super_admin'); db.assert_not_called()
        self.app.config['EVENTS_FOUNDATION_ENABLED'] = False
        with patch.object(routes, 'get_db') as db:
            self.assertEqual(self.client.get(f'/api/admin/events/{EVENT}/share').status_code, 503)
            db.assert_not_called()

    def test_authorized_read_ignores_request_origins_and_cannot_change_the_event(self):
        before = deepcopy(self.store)
        with patch.dict('os.environ', {'PUBLIC_SITE_URL': 'https://ebalik.example.test'}), patch.object(routes, '_require_admin', return_value={'account_id': ADMIN}) as auth, patch.object(routes, 'get_db', return_value=self.db), patch.object(routes, '_log_admin_action') as audit:
            reply = self.client.get(f'/api/admin/events/{EVENT}/share?url=https://other.test/tag/forged', headers={'Host': 'other.test', 'Origin': 'https://other.test'})
            self.assertEqual(reply.status_code, 200)
            self.assertEqual(reply.json['url'], 'https://ebalik.example.test/events/campus-event')
            self.assertEqual(reply.headers['Cache-Control'], 'no-store')
            auth.assert_called_once_with('super_admin')
            audit.assert_not_called()
            self.assertEqual(self.client.post(f'/api/admin/events/{EVENT}/share', json={'portal_enabled': True}).status_code, 405)
        self.assertEqual(before, self.store)
        self.db.client.storage.from_.assert_not_called()

    def test_authenticated_get_is_no_store_and_ignores_untrusted_origin_parameters(self):
        before = deepcopy(self.store)
        with patch.object(routes, '_require_admin', return_value={'account_id': ADMIN}), patch.object(routes, 'get_db', return_value=self.db), patch.dict('os.environ', {'PUBLIC_SITE_URL': 'https://ebalik.example.test'}):
            result = self.client.get(f'/api/admin/events/{EVENT}/share?url=https://evil.test/tag/other', headers={'Origin': 'https://evil.test', 'Host': 'evil.test'})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.headers['Cache-Control'], 'no-store')
        self.assertEqual(result.json['url'], 'https://ebalik.example.test/events/campus-event')
        self.assertEqual(self.store, before)
        self.assertEqual(self.client.post(f'/api/admin/events/{EVENT}/share').status_code, 405)
