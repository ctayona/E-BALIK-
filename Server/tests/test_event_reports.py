"""Event-only reporting, safe projections, authorization, idempotency and image isolation."""
import io
import sys
import unittest
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from flask import Flask
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from memdb import MemClient
from app.utils.events import EventError
from app.utils.event_reports import EventReports, report_payload, MIGRATION, BOARD_FIELDS, CATEGORIES
from Users.Backend.events import routes
from app.utils import rate_limit

ADMIN, MANAGER, STAFF, USER, OTHER = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555']
EVENT, SECOND, REPORT, REQUEST = ['66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777', '88888888-8888-4888-8888-888888888888', '99999999-9999-4999-8999-999999999999']


def fixture(test):
    now = datetime.now(timezone.utc)
    iso = lambda hours: (now + timedelta(hours=hours)).isoformat()
    test.event = dict(event_id=EVENT, name='Campus event', slug='campus-event', organizer_name='Campus team', venue='Gymnasium', desk_instructions='Main entrance', starts_at=iso(-1), ends_at=iso(1), recovery_ends_at=iso(2), status='active', portal_enabled=True, version=1, branding={'template': 'classic', 'primary': '#1f3160', 'accent': '#d1a153', 'background': '#ffffff'})
    test.payload = dict(request_id=REQUEST, board_consent=True, kind='found', item_name='Black backpack', category='Bags & Luggage', description='Private evidence and identifying details.', venue='Gymnasium', location_details='Beside the door', occurred_at=iso(-0.5))
    test.report = dict(test.payload, report_id=REPORT, event_id=EVENT, reporter_account_id=USER, version=1, photo_path=None, moderation_status='pending', public_label=None, received_at=None, withdrawn_at=None, storage_location=None, created_at=iso(0))
    profiles = [dict(account_id=a, is_active=True, access_level='super_admin' if a == ADMIN else 'user', verification_status='verified', suspended_until=None) for a in (ADMIN, MANAGER, STAFF, USER, OTHER)]
    members = [dict(event_id=EVENT, account_id=a, role=role, status='active', starts_at=iso(-2), expires_at=iso(2)) for a, role in ((MANAGER, 'manager'), (STAFF, 'desk_staff'))]
    test.store = {'migration_log': [{'name': MIGRATION}], 'event_workspaces': [test.event], 'event_memberships': members, 'user_profiles': profiles, 'event_reports': [test.report], 'event_report_history': [], 'event_brand_assets': [], 'system_settings': [], 'found_items': [{'item_id': 'campus-sentinel'}], 'missing_items': []}
    test.bucket = MagicMock()
    client = MemClient(test.store)
    client.storage = MagicMock(); client.storage.from_.return_value = test.bucket
    test.db = SimpleNamespace(client=client, get_user_by_account_id=lambda account: next((p for p in test.store['user_profiles'] if p['account_id'] == account), None))
    test.service = EventReports(test.db)


class ReportTests(unittest.TestCase):
    def setUp(self): fixture(self)

    def test_form_validation_and_consent_are_server_enforced(self):
        self.assertEqual(report_payload(self.payload)['board_consent'], True)
        for values in ({**self.payload, 'board_consent': False}, {**self.payload, 'item_name': '<img>'}, {**self.payload, 'category': 'Injected'}, {**self.payload, 'venue': 'Off-campus'}, {**self.payload, 'event_id': SECOND}, {**self.payload, 'kind': 'claim'}, {**self.payload, 'description': 'short'}, {**self.payload, 'occurred_at': '2026-11-16T10:00:00'}):
            with self.subTest(values=values), self.assertRaises(EventError): report_payload(values)

    def test_categories_match_current_campus_options(self):
        import re
        source = (Path(__file__).resolve().parents[2] / 'Admin/Frontend/src/utils/itemOptions.ts').read_text(encoding='utf-8')
        match = re.search(r'export const ITEM_CATEGORIES = \[(.*?)\];', source)
        self.assertEqual(list(CATEGORIES), re.findall(r'"([^"]+)"', match.group(1)))

    def test_default_closed_portal_rejects_drafts_expired_or_paused_events(self):
        for changes in ({'portal_enabled': False}, {'status': 'draft'}, {'status': 'scheduled'}, {'status': 'cancelled'}, {'recovery_ends_at': '2020-01-01T00:00:00Z'}):
            old = dict(self.event); self.event.update(changes)
            with self.subTest(changes=changes), self.assertRaises(EventError): self.service.portal('campus-event')
            self.event.clear(); self.event.update(old)

    def test_portal_configuration_has_no_private_staff_or_account_data(self):
        reply = self.service.portal('campus-event')
        self.assertNotIn('version', reply['event'])
        self.assertNotIn('portal_enabled', reply['event'])
        self.assertNotIn('account_id', str(reply))
        self.assertNotIn('description', str(reply))

    def test_event_board_is_an_explicit_safe_projection(self):
        self.report.update(moderation_status='approved', public_label='Black backpack', photo_path=f'{EVENT}/{REPORT}/' + 'a' * 32 + '.webp')
        self.store['event_reports'] += [{**self.report, 'report_id': SECOND, 'event_id': SECOND}, {**self.report, 'report_id': OTHER, 'moderation_status': 'pending'}, {**self.report, 'report_id': ADMIN, 'withdrawn_at': self.event['starts_at']}]
        board = self.service.board('campus-event', OTHER)
        self.assertEqual(len(board), 1)
        self.assertEqual(set(board[0]), set(BOARD_FIELDS) | {'reference'})
        for private in ('description', 'item_name', 'photo_path', 'reporter_account_id', 'storage_location', 'location_details'):
            self.assertNotIn(private, board[0])
        self.assertNotIn('https', str(board))

    def test_unverified_attendee_denied_but_explicit_staff_assignment_works(self):
        self.db.get_user_by_account_id(USER)['verification_status'] = 'pending'
        with self.assertRaises(EventError) as error: self.service.board('campus-event', USER)
        self.assertEqual(error.exception.code, 'verification_required')
        self.db.get_user_by_account_id(STAFF)['verification_status'] = 'pending'
        self.service.board('campus-event', STAFF)

    def test_own_reports_are_scoped_and_readable_after_closure(self):
        self.event['status'] = 'closed'
        self.assertEqual(len(self.service.mine('campus-event', USER)['reports']), 1)
        self.assertEqual(self.service.mine('campus-event', OTHER)['reports'], [])
        self.assertNotIn('storage_location', self.service.mine('campus-event', USER)['reports'][0])

    def test_detail_and_queue_require_membership_even_for_super_admin(self):
        for actor in (USER, OTHER, ADMIN):
            with self.subTest(actor=actor), self.assertRaises(EventError): self.service.queue(EVENT, actor)
            with self.subTest(actor=actor), self.assertRaises(EventError): self.service.detail(EVENT, REPORT, actor)
        with self.assertRaises(EventError): self.service.detail(SECOND, REPORT, MANAGER)
        self.assertEqual(self.service.detail(EVENT, REPORT, MANAGER)['report']['report_id'], REPORT)

    def test_role_and_revocation_are_checked_before_desk_actions(self):
        with self.assertRaises(EventError): self.service.action(EVENT, REPORT, dict(action='approve', version=1, data={'note': 'Reviewed', 'public_label': 'Black backpack'}), STAFF)
        self.store['event_memberships'][0]['status'] = 'revoked'
        with self.assertRaises(EventError): self.service.action(EVENT, REPORT, dict(action='note', version=1, data={'note': 'Checked'}), MANAGER)

    def test_report_replay_does_not_upload_or_mutate_again(self):
        before = deepcopy(self.store)
        self.assertEqual(self.service.create(EVENT, self.payload, USER, b'not-even-a-photo')['report_id'], REPORT)
        self.bucket.upload.assert_not_called()
        self.assertEqual(before, self.store)

    def test_create_uses_only_event_rpc_and_normalizes_private_photo(self):
        self.store['event_reports'] = []
        self.db.client.rpc_handlers['event_report_command'] = lambda params: {'ok': True, 'report': {**self.report, 'report_id': params['p_report_id'], 'photo_path': params['p_data'].get('photo_path')}}
        raw = io.BytesIO(); Image.new('RGB', (24, 24), 'blue').save(raw, 'PNG')
        before = deepcopy(self.store['found_items'])
        result = self.service.create(EVENT, self.payload, USER, raw.getvalue())
        self.assertTrue(result['has_photo'])
        self.db.client.storage.from_.assert_called_with('event-report-images')
        path, content, options = self.bucket.upload.call_args.args
        self.assertTrue(path.startswith(EVENT + '/'))
        self.assertEqual(content[:4], b'RIFF')
        self.assertEqual(options['upsert'], 'false')
        self.assertEqual(self.store['found_items'], before)

    def test_failed_or_ambiguous_creation_does_not_delete_referenced_media(self):
        self.store['event_reports'] = []
        self.db.client.rpc_handlers['event_report_command'] = lambda params: (_ for _ in ()).throw(RuntimeError('Ambiguous transport failure'))
        raw = io.BytesIO(); Image.new('RGB', (10, 10)).save(raw, 'PNG')
        with self.assertRaises(RuntimeError): self.service.create(EVENT, self.payload, USER, raw.getvalue())
        self.bucket.remove.assert_not_called()

    def test_explicit_rpc_refusal_removes_only_unreferenced_new_upload(self):
        self.store['event_reports'] = []
        self.db.client.rpc_handlers['event_report_command'] = lambda params: {'ok': False, 'error': 'Reporting paused during upload'}
        raw = io.BytesIO(); Image.new('RGB', (10, 10)).save(raw, 'PNG')
        with self.assertRaises(EventError): self.service.create(EVENT, self.payload, USER, raw.getvalue())
        self.bucket.remove.assert_called_once()
        self.assertEqual(self.bucket.remove.call_args.args[0], [self.bucket.upload.call_args.args[0]])

    def test_photos_are_owner_or_staff_only_and_path_scoped(self):
        self.report['photo_path'] = f'{EVENT}/{REPORT}/' + 'a' * 32 + '.webp'
        self.bucket.download.return_value = b'private-webp'
        self.assertEqual(self.service.photo(EVENT, REPORT, USER), b'private-webp')
        self.assertEqual(self.service.photo(EVENT, REPORT, STAFF), b'private-webp')
        for actor in (OTHER, ADMIN):
            with self.subTest(actor=actor), self.assertRaises(EventError): self.service.photo(EVENT, REPORT, actor)
        self.report['photo_path'] = '../../other-event/photo.webp'
        with self.assertRaises(EventError): self.service.photo(EVENT, REPORT, USER)

    def test_manager_approval_rejects_contact_details_and_arbitrary_fields(self):
        for label in ('student@example.test', 'ID 12345678'):
            with self.subTest(label=label), self.assertRaises(EventError): self.service.action(EVENT, REPORT, dict(action='approve', version=1, data={'note': 'Reviewed label', 'public_label': label}), MANAGER)
        with self.assertRaises(EventError): self.service.action(EVENT, REPORT, dict(action='receive', version=1, data={'note': 'Received', 'storage_location': 'A'}), STAFF)
        with self.assertRaises(EventError): self.service.action(EVENT, REPORT, dict(action='note', version=True, data={'note': 'Checked'}), STAFF)

    def test_missing_reports_migration_does_not_break_assignments(self):
        self.store['migration_log'] = []
        result = self.service.workspace(EVENT, STAFF)
        self.assertFalse(result['reports_available'])
        with self.assertRaises(EventError) as error: self.service.queue(EVENT, STAFF)
        self.assertEqual(error.exception.code, 'event_reports_setup_required')


class ReportRouteTests(unittest.TestCase):
    def setUp(self):
        fixture(self); rate_limit.reset(); self.addCleanup(rate_limit.reset)
        self.app = Flask(__name__); self.app.config.update(EVENTS_FOUNDATION_ENABLED=True, SUPABASE_URL='https://example.invalid', SUPABASE_SERVICE_KEY='offline')
        self.app.register_blueprint(routes.event_desk_bp, url_prefix='/api/events'); self.client = self.app.test_client()
        for p in (patch.object(routes, 'get_db', return_value=self.db), patch.object(routes.JWTService, 'extract_token_from_header', return_value='offline'), patch.object(routes.JWTService, 'verify_token', return_value={'account_id': USER, 'iat': datetime.now(timezone.utc).timestamp()})):
            p.start(); self.addCleanup(p.stop)

    def test_public_portal_and_private_report_listing_have_no_store(self):
        self.assertEqual(self.client.get('/api/events/portal/campus-event').status_code, 200)
        response = self.client.get('/api/events/portal/campus-event/mine')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(len(response.json['reports']), 1)

    def test_attendee_cannot_open_staff_report_queue_or_detail(self):
        for path in (f'/api/events/{EVENT}/reports', f'/api/events/{EVENT}/reports/{REPORT}'):
            self.assertEqual(self.client.get(path).status_code, 403)

    def test_portal_submission_is_supported_but_staff_intake_needs_assignment(self):
        response = self.client.post('/api/events/portal/campus-event/reports', json=self.payload)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json['report']['report_id'], REPORT)
        self.assertEqual(self.client.post(f'/api/events/{EVENT}/reports', json=self.payload).status_code, 403)

    def test_invalid_page_and_missing_auth_are_rejected(self):
        self.assertEqual(self.client.get('/api/events/portal/campus-event/mine?offset=-1').status_code, 400)
        with patch.object(routes.JWTService, 'extract_token_from_header', side_effect=ValueError('Missing token')):
            self.assertEqual(self.client.get('/api/events/portal/campus-event/mine').status_code, 401)

    def test_disabled_portal_does_not_read_database(self):
        self.app.config['EVENTS_FOUNDATION_ENABLED'] = False
        with patch.object(routes, 'get_db') as db:
            self.assertEqual(self.client.get('/api/events/portal/campus-event').status_code, 503)
            db.assert_not_called()


if __name__ == '__main__': unittest.main()
