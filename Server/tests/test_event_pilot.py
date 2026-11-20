"""University pilot isolation, permissions, safe exports and route connections; no network."""
import io
import unittest
import zipfile
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID
from flask import Flask
from test_event_alerts import alert_fixture, ADMIN, MANAGER, STAFF, USER, OTHER, EVENT, SECOND, REPORT, REQUEST
from app.utils.events import EventError
from app.utils.event_pilot import EventPilot, MIGRATION, csv_bytes
from app.utils import rate_limit
from Users.Backend.events import routes
from Admin.Backend.events import routes as admin_routes

PUBLICATION, TRANSFER = str(UUID(int=101)), str(UUID(int=102))


def pilot_fixture(test):
    alert_fixture(test)
    test.store['migration_log'].append({'name': MIGRATION})
    test.store.update(event_hub_consents=[dict(event_id=EVENT, report_id=REPORT, account_id=USER, allowed=True, version=1)], event_hub_publications=[dict(publication_id=PUBLICATION, event_id=EVENT, report_id=REPORT, status='published', version=1)], event_custody_transfers=[], event_closure_plans=[], event_pilot_history=[])
    test.pilot = EventPilot(test.db)
    test.store['event_hub_publications'][0].update(consent_version=1, listing_snapshot={key: test.report[key] for key in ('kind', 'category', 'public_label', 'venue', 'occurred_at')})
    test.publication = dict(test.report, publication_id=PUBLICATION, event_name=test.event['name'], slug=test.event['slug'], published_at=test.report['created_at'])
    test.snapshot = dict(ok=True, generated_at=test.report['created_at'], counts=dict(reports=2, missing=1, found=1, received=1, released=0, unresolved=2, desk_custody=1, pending_transfers=0, transferred=0, hub_published=1), claims=dict(total=0, open=0, released=0), closure=None, history=[], reports=[dict(test.report, hub_allowed=True, consent_version=1, publication_status='published', publication_version=1, transfer_status=None)])
    test.db.client.rpc_handlers['event_pilot_feed'] = lambda p: dict(publications=[test.publication], has_more=False)
    test.db.client.rpc_handlers['event_pilot_snapshot'] = lambda p: deepcopy(test.snapshot)
    test.db.client.rpc_handlers['event_pilot_command'] = lambda p: dict(ok=True)
    profile = test.db.get_user_by_account_id(STAFF); profile.update(access_level='guard', fname='Office', lname='Receiver', email='office@example.invalid')
    test.transfer = dict(transfer_id=TRANSFER, event_id=EVENT, report_id=REPORT, receiver_id=STAFF, receiver_name='Office Receiver', status='pending', version=1, source_location='Desk bin A', destination='Lost and Found Office', destination_storage=None, accepted_at=None, created_at=test.report['created_at'])


class PilotServiceTests(unittest.TestCase):
    def setUp(self): pilot_fixture(self)

    def test_hub_uses_explicit_safe_projection_without_campus_queries_or_writes(self):
        before = deepcopy(self.store)
        with patch.object(self.db.client, 'table', wraps=self.db.client.table) as tables:
            result = self.pilot.hub(OTHER)
        for private in ('description', 'reporter_account_id', 'photo_path', 'storage_location', 'location_details', 'email', 'evidence'):
            self.assertNotIn(private, str(result))
        self.assertEqual(result['publications'][0]['report_id'], REPORT)
        self.assertLessEqual({call.args[0] for call in tables.call_args_list}, {'migration_log'})
        self.assertEqual(before, self.store); self.db.client.storage.from_.assert_not_called()

    def test_private_hub_detail_rechecks_consent_event_and_original_report(self):
        value = self.pilot.hub_detail(PUBLICATION, OTHER)
        self.assertTrue(value['can_claim']); self.assertEqual(value['slug'], 'campus-event')
        self.assertFalse(self.pilot.hub_detail(PUBLICATION, USER)['can_claim'])
        self.store['event_hub_publications'][0]['listing_snapshot']['public_label'] = 'Old backup label'
        with self.assertRaises(EventError): self.pilot.hub_detail(PUBLICATION, OTHER)
        self.store['event_hub_publications'][0]['listing_snapshot']['public_label'] = self.report['public_label']
        self.store['event_hub_consents'][0]['version'] = 2
        with self.assertRaises(EventError): self.pilot.hub_detail(PUBLICATION, OTHER)
        self.store['event_hub_consents'][0]['version'] = 1
        self.store['event_hub_consents'][0]['allowed'] = False
        with self.assertRaises(EventError): self.pilot.hub_detail(PUBLICATION, OTHER)
        self.store['event_hub_consents'][0]['allowed'] = True; self.event['portal_enabled'] = False
        with self.assertRaises(EventError): self.pilot.hub_detail(PUBLICATION, OTHER)

    def test_hidden_released_withdrawn_or_owner_changed_hub_details_fail_closed(self):
        for changes in ({'moderation_status': 'hidden'}, {'released_at': self.report['created_at']}, {'withdrawn_at': self.report['created_at']}, {'reporter_account_id': OTHER}):
            old = dict(self.report); self.report.update(changes)
            with self.subTest(changes=changes), self.assertRaises(EventError): self.pilot.hub_detail(PUBLICATION, OTHER)
            self.report.clear(); self.report.update(old)

    def test_only_verified_original_owner_can_read_or_change_consent(self):
        self.assertTrue(self.pilot.own_consent(EVENT, REPORT, USER)['allowed'])
        for actor in (OTHER, MANAGER, ADMIN):
            with self.subTest(actor=actor), self.assertRaises(EventError): self.pilot.own_consent(EVENT, REPORT, actor)
        self.db.get_user_by_account_id(USER)['verification_status'] = 'pending'
        with self.assertRaises(EventError): self.pilot.consent(EVENT, REPORT, USER, dict(version=1, allowed=False))

    def test_consent_payload_cannot_publish_or_choose_actor(self):
        for payload in (dict(version=1, allowed='yes'), dict(version=True, allowed=True), dict(version=1, allowed=True, account_id=OTHER), dict(version=1, allowed=True, published=True)):
            with self.subTest(payload=payload), self.assertRaises(EventError): self.pilot.consent(EVENT, REPORT, USER, payload)
        with patch.object(self.db.client, 'rpc', wraps=self.db.client.rpc) as rpc:
            self.pilot.consent(EVENT, REPORT, USER, dict(version=1, allowed=False))
        rpc.assert_called_once_with('event_pilot_command', dict(p_event_id=EVENT, p_actor_id=USER, p_action='consent', p_data=dict(report_id=REPORT, version=1, allowed=False)))

    def test_owner_can_revoke_after_terminal_state_without_reopening_event(self):
        self.event.update(status='closed', deleted_at=self.report['created_at'])
        self.pilot.consent(EVENT, REPORT, USER, dict(version=1, allowed=False))
        self.assertEqual(self.event['status'], 'closed')

    def test_admin_preview_exposes_generic_listing_and_versions_only(self):
        value = self.pilot.preview(EVENT, REPORT, ADMIN)
        self.assertTrue(value['can_publish']); self.assertEqual(value['version'], 1)
        for private in ('description', 'reporter_account_id', 'photo_path', 'location_details', 'storage_location'):
            self.assertNotIn(private, str(value))
        for actor in (MANAGER, STAFF, USER):
            with self.subTest(actor=actor), self.assertRaises(EventError): self.pilot.preview(EVENT, REPORT, actor)

    def test_publication_commands_require_fresh_admin_exact_fields_and_atomic_rpc(self):
        payload = dict(report_id=REPORT, report_version=1, consent_version=1, version=1, note='Approved generic hub publication')
        with patch.object(self.db.client, 'rpc', wraps=self.db.client.rpc) as rpc: self.pilot.command(EVENT, ADMIN, 'publish', payload)
        rpc.assert_called_once_with('event_pilot_command', dict(p_event_id=EVENT, p_actor_id=ADMIN, p_action='publish', p_data=payload))
        with self.assertRaises(EventError): self.pilot.command(EVENT, MANAGER, 'publish', payload)
        with self.assertRaises(EventError): self.pilot.command(EVENT, ADMIN, 'publish', {**payload, 'event_id': SECOND})
        with self.assertRaises(EventError): self.pilot.command(EVENT, ADMIN, ['publish'], payload)
        self.db.get_user_by_account_id(ADMIN)['is_active'] = False
        with self.assertRaises(EventError): self.pilot.command(EVENT, ADMIN, 'publish', payload)

    def test_failed_rpc_has_no_direct_write_fallback(self):
        before = deepcopy(self.store); self.db.client.rpc_handlers['event_pilot_command'] = lambda p: dict(ok=False, error='Stale publication or consent version.')
        with self.assertRaises(EventError): self.pilot.command(EVENT, ADMIN, 'unpublish', dict(report_id=REPORT, report_version=1, consent_version=1, version=1, note='Withdraw hub visibility'))
        self.assertEqual(before, self.store)

    def test_summary_and_export_need_current_manager_or_super_admin(self):
        self.assertTrue(self.pilot.snapshot(EVENT, MANAGER)['available'])
        for actor in (STAFF, USER, OTHER):
            with self.subTest(actor=actor), self.assertRaises(EventError): self.pilot.snapshot(EVENT, actor)
        self.store['event_memberships'][0]['status'] = 'revoked'
        with self.assertRaises(EventError): self.pilot.snapshot(EVENT, MANAGER)
        self.event['status'] = 'closed'; self.assertTrue(self.pilot.snapshot(EVENT, ADMIN)['available'])

    def test_safe_zip_export_preserves_scope_and_neutralizes_formulas(self):
        self.snapshot['reports'][0].update(item_name='=HYPERLINK("bad")', received_at=self.report['created_at'], storage_location='\t=CMD')
        archive = zipfile.ZipFile(io.BytesIO(self.pilot.export(EVENT, MANAGER)))
        self.assertEqual(set(archive.namelist()), {'summary.csv', 'event-register.csv', 'unresolved-custody.csv'})
        register = archive.read('event-register.csv').decode('utf-8-sig')
        self.assertIn("'=HYPERLINK", register); self.assertIn("'\t=CMD", register)
        for private in ('reporter_account_id', 'description', 'photo_path', 'pin_hash', 'evidence'):
            self.assertNotIn(private, register)
        self.assertIn('EV-88888888', register)

    def test_export_refuses_silent_truncation_and_register_paging_is_bounded(self):
        self.snapshot['reports'] = [dict(self.report) for _ in range(5001)]
        with self.assertRaises(EventError) as error: self.pilot.export(EVENT, MANAGER)
        self.assertEqual(error.exception.status, 413)
        self.snapshot['reports'] = self.snapshot['reports'][:25]
        value = self.pilot.snapshot(EVENT, MANAGER)
        self.assertEqual(len(value['reports']), 24); self.assertTrue(value['has_more'])
        for offset in (-1, True, '0', 100001):
            with self.subTest(offset=offset), self.assertRaises(EventError): self.pilot.snapshot(EVENT, MANAGER, offset)

    def test_receiver_lookup_returns_only_exact_eligible_office_account(self):
        self.assertEqual(self.pilot.receiver_lookup(EVENT, ADMIN, 'office@example.invalid'), dict(account_id=STAFF, fname='Office', lname='Receiver'))
        self.db.get_user_by_account_id(STAFF)['access_level'] = 'user'
        with self.assertRaises(EventError): self.pilot.receiver_lookup(EVENT, ADMIN, 'office@example.invalid')
        with self.assertRaises(EventError): self.pilot.receiver_lookup(EVENT, MANAGER, 'office@example.invalid')

    def test_incoming_receivers_get_only_their_own_scoped_handover(self):
        self.store['event_custody_transfers'] = [self.transfer, {**self.transfer, 'transfer_id': REQUEST, 'receiver_id': ADMIN}]
        result = self.pilot.incoming(STAFF)
        self.assertEqual([r['transfer_id'] for r in result['transfers']], [TRANSFER])
        for private in ('receiver_id', 'requested_by', 'description', 'evidence', 'email', 'pin_hash'):
            self.assertNotIn(private, str(result))
        self.assertEqual(self.pilot.incoming(USER)['transfers'], [])

    def test_accept_requires_current_office_role_and_explicit_physical_receipt(self):
        payload = dict(transfer_id=TRANSFER, version=1, storage='Cabinet B', identity_checked=True)
        self.pilot.accept(EVENT, STAFF, payload)
        with self.assertRaises(EventError): self.pilot.accept(EVENT, USER, payload)
        with self.assertRaises(EventError): self.pilot.accept(EVENT, STAFF, {**payload, 'identity_checked': False})
        with self.assertRaises(EventError): self.pilot.accept(EVENT, STAFF, {**payload, 'status': 'accepted'})

    def test_missing_migration_only_disables_new_pilot_capabilities(self):
        self.store['migration_log'] = [row for row in self.store['migration_log'] if row['name'] != MIGRATION]
        self.assertFalse(self.pilot.hub(OTHER)['available']); self.assertFalse(self.pilot.snapshot(EVENT, MANAGER)['available'])
        self.assertFalse(self.pilot.recovery_info('campus-event', OTHER)['available'])
        self.assertFalse(self.pilot.incoming(STAFF)['available']); self.assertTrue(self.service.workspace(EVENT, MANAGER)['reports_available'])
        with self.assertRaises(EventError): self.pilot.preview(EVENT, REPORT, ADMIN)

    def test_attendees_get_only_generic_final_instructions(self):
        self.store['event_closure_plans'] = [dict(event_id=EVENT, instructions='Visit the university office for follow-up.', note='Private operational note', completed_by=ADMIN, completed_at=self.report['created_at'])]
        self.event['status'] = 'closed'
        result = self.pilot.recovery_info('campus-event', OTHER)
        self.assertTrue(result['available']); self.assertNotIn('note', str(result)); self.assertNotIn(ADMIN, str(result))
        for status in ('draft', 'scheduled'):
            self.event['status'] = status
            with self.subTest(status=status), self.assertRaises(EventError): self.pilot.recovery_info('campus-event', OTHER)


class PilotRouteTests(unittest.TestCase):
    def setUp(self):
        pilot_fixture(self); rate_limit.reset(); self.addCleanup(rate_limit.reset)
        self.app = Flask(__name__); self.app.config.update(EVENTS_FOUNDATION_ENABLED=True, SUPABASE_URL='https://example.invalid', SUPABASE_SERVICE_KEY='offline')
        self.app.register_blueprint(routes.event_desk_bp, url_prefix='/api/events'); self.app.register_blueprint(admin_routes.events_bp, url_prefix='/api/admin'); self.client = self.app.test_client()
        self.token = {'account_id': OTHER, 'iat': datetime.now(timezone.utc).timestamp()}
        for value in (patch.object(routes, 'get_db', return_value=self.db), patch.object(routes.JWTService, 'extract_token_from_header', return_value='offline'), patch.object(routes.JWTService, 'verify_token', side_effect=lambda token: self.token), patch.object(admin_routes, 'get_db', return_value=self.db), patch.object(admin_routes, '_require_admin', return_value={'account_id': ADMIN}), patch.object(admin_routes, '_log_admin_action')):
            value.start(); self.addCleanup(value.stop)

    def test_hub_list_and_deep_link_are_private_no_store_and_ignore_actor_forgery(self):
        value = self.client.get('/api/events/hub/publications?account_id=' + USER)
        self.assertEqual(value.status_code, 200); self.assertEqual(value.headers['Cache-Control'], 'no-store')
        self.assertEqual(self.client.get('/api/events/hub/publications/' + PUBLICATION).status_code, 200)
        self.db.get_user_by_account_id(OTHER)['verification_status'] = 'pending'
        self.assertEqual(self.client.get('/api/events/hub/publications').status_code, 403)

    def test_manager_register_and_export_are_protected_and_downloadable(self):
        url = f'/api/events/{EVENT}/operations'
        self.assertEqual(self.client.get(url).status_code, 403)
        self.token['account_id'] = MANAGER
        self.assertEqual(self.client.get(url).status_code, 200)
        result = self.client.get(url + '/export'); self.assertEqual(result.mimetype, 'application/zip')
        self.assertEqual(result.headers['Cache-Control'], 'no-store'); self.assertEqual(self.client.get(url + '?offset=-1').status_code, 400)

    def test_consent_is_owner_scoped_and_rate_limited(self):
        url = f'/api/events/{EVENT}/reports/{REPORT}/hub-consent'
        self.assertEqual(self.client.get(url).status_code, 403)
        self.token['account_id'] = USER
        self.assertEqual(self.client.post(url, json=dict(version=1, allowed=False)).status_code, 200)
        with patch.object(routes.rate_limit, 'allow', return_value=False): self.assertEqual(self.client.post(url, json=dict(version=1, allowed=False)).status_code, 429)

    def test_receiving_office_can_acknowledge_without_general_event_membership(self):
        self.token['account_id'] = STAFF; self.store['event_memberships'] = []
        self.store['event_custody_transfers'] = [self.transfer]
        self.assertEqual(len(self.client.get('/api/events/custody/incoming').json['transfers']), 1)
        self.assertEqual(self.client.post(f'/api/events/{EVENT}/custody/accept', json=dict(transfer_id=TRANSFER, version=1, storage='Office cabinet', identity_checked=True)).status_code, 200)
        self.assertEqual(self.client.get(f'/api/events/{EVENT}/operations').status_code, 403)

    def test_admin_operations_preview_export_and_exact_payload_connection(self):
        url = f'/api/admin/events/{EVENT}'
        self.assertEqual(self.client.get(url + '/operations').status_code, 200)
        self.assertEqual(self.client.get(url + '/hub/' + REPORT).status_code, 200)
        self.assertEqual(self.client.get(url + '/operations/export').mimetype, 'application/zip')
        result = self.client.post(url + '/operations', json=dict(action='closure_save', data=dict(version=0, instructions='Visit university office after recovery.', note='Final recovery arrangement', acknowledged=False)))
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.client.post(url + '/operations', json={'event_id': SECOND}).status_code, 400)

    def test_authentication_revocation_and_disabled_module_fail_closed(self):
        with patch.object(admin_routes, '_require_admin', side_effect=PermissionError()):
            response = self.client.get(f'/api/admin/events/{EVENT}/operations')
            self.assertEqual(response.status_code, 403); self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.store['system_settings'] = [{'setting_key': 'sessions_valid_after', 'setting_value': {'ts': (datetime.now(timezone.utc) + timedelta(seconds=5)).isoformat()}}]
        self.assertEqual(self.client.get('/api/events/hub/publications').status_code, 401)
        self.app.config['EVENTS_FOUNDATION_ENABLED'] = False
        self.assertEqual(self.client.get('/api/events/hub/publications').status_code, 503)
