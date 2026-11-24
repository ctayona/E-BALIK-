"""Offline event recovery boundaries; atomic database behavior is tested in PGlite."""
import io
import unittest
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
from flask import Flask
from PIL import Image
from test_event_reports import fixture, ADMIN, MANAGER, STAFF, USER, OTHER, EVENT, SECOND, REPORT, REQUEST
from app.utils.event_recovery import EventRecovery, MIGRATION
from app.utils.crypto_service import CryptoService
from app.utils.events import EventError
from app.utils import rate_limit
from Users.Backend.events import routes
from Admin.Backend.events import routes as admin_routes


def recovery_fixture(test):
    fixture(test)
    test.key = patch.dict('os.environ', {'APP_ENCRYPTION_KEY': 'offline-event-recovery-key-32byte!'})
    test.key.start(); test.addCleanup(test.key.stop)
    test.store['migration_log'].append({'name': MIGRATION})
    test.report.update(moderation_status='approved', public_label='Blue backpack', received_at=test.event['starts_at'], released_at=None)
    test.claim = dict(claim_id=SECOND, event_id=EVENT, report_id=REPORT, claimant_account_id=OTHER, request_id=REQUEST,
                      evidence='Private distinguishing ownership evidence.', status='approved', version=2,
                      pickup_expires_at=test.event['recovery_ends_at'], pin_issued_at=test.event['starts_at'],
                      failed_attempts=0, pin_hash='a' * 64, pin_encrypted=CryptoService.encrypt('ABC234'),
                      proof_path=None, released_at=None, created_at=test.event['starts_at'])
    test.store.update(event_claims=[test.claim], event_claim_history=[])
    test.recovery = EventRecovery(test.db)


class RecoveryTests(unittest.TestCase):
    def setUp(self): recovery_fixture(self)

    def test_owner_only_pickup_code_and_staff_projection(self):
        owner = self.recovery.mine('campus-event', OTHER)[0]
        self.assertEqual(owner['pickup_code'], 'ABC234')
        staff = self.recovery.queue(EVENT, STAFF)[0]
        for field in ('pin_hash', 'pin_encrypted', 'proof_path', 'claimant_account_id', 'pickup_code'):
            self.assertNotIn(field, staff)
        self.assertEqual(self.recovery.mine('campus-event', USER), [])
        self.claim['failed_attempts'] = 5
        self.assertIsNone(self.recovery.mine('campus-event', OTHER)[0]['pickup_code'])
        self.assertTrue(self.recovery.mine('campus-event', OTHER)[0]['pickup_locked'])

    def test_expired_codes_are_never_returned(self):
        self.claim['pickup_expires_at'] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        result = self.recovery.view(self.claim, owner=True)
        self.assertEqual(result['status'], 'expired')
        self.assertNotIn('pickup_code', result)

    def test_queue_and_detail_are_event_scoped_and_assignment_only(self):
        for actor in (ADMIN, USER, OTHER):
            with self.subTest(actor=actor), self.assertRaises(EventError): self.recovery.queue(EVENT, actor)
            with self.subTest(actor=actor), self.assertRaises(EventError): self.recovery.detail(EVENT, SECOND, actor)
        with self.assertRaises(EventError): self.recovery._claim(REPORT, SECOND)
        self.store['event_memberships'][1]['status'] = 'revoked'
        with self.assertRaises(EventError): self.recovery.queue(EVENT, STAFF)

    def test_owner_records_survive_soft_deletion_without_public_access(self):
        self.event['deleted_at'] = self.event['starts_at']
        self.event['status'] = 'closed'
        self.assertEqual(len(self.recovery.mine('campus-event', OTHER)), 1)
        with self.assertRaises(EventError): self.service.portal('campus-event')
        with self.assertRaises(EventError): self.recovery.events.get(EVENT)
        with self.assertRaises(EventError): self.recovery.queue(EVENT, STAFF)

    def test_draft_and_deleted_lists_do_not_mix(self):
        self.event['status'] = 'draft'
        deleted = {**self.event, 'event_id': SECOND, 'deleted_at': self.event['starts_at']}
        self.store['event_workspaces'].append(deleted)
        self.assertEqual([r['event_id'] for r in self.recovery.list_events(0, 'drafts')[0]], [EVENT])
        self.assertEqual([r['event_id'] for r in self.recovery.list_events(0, 'deleted')[0]], [SECOND])
        with self.assertRaises(EventError): self.recovery.list_events(0, 'injected')
        self.store['migration_log'] = []
        self.assertEqual(self.recovery.list_events(0, 'deleted'), ([], False))
        with self.assertRaises(EventError) as error: self.recovery.require_setup()
        self.assertEqual(error.exception.code, 'event_recovery_setup_required')

    def test_claim_replay_never_uploads_again(self):
        before = deepcopy(self.store)
        result = self.recovery.create(EVENT, dict(request_id=REQUEST, report_id=REPORT, evidence=self.claim['evidence']), OTHER, b'bad-photo')
        self.assertEqual(result['claim_id'], SECOND)
        self.bucket.upload.assert_not_called()
        self.assertEqual(before, self.store)

    def test_unverified_and_forged_create_payloads_are_refused(self):
        payload = dict(request_id=REQUEST, report_id=REPORT, evidence=self.claim['evidence'])
        for changed in ({**payload, 'pin_hash': 'forged'}, {**payload, 'evidence': '<script>bad evidence</script>'}):
            with self.subTest(changed=changed), self.assertRaises(EventError): self.recovery.create(EVENT, changed, OTHER)
        self.db.get_user_by_account_id(OTHER)['verification_status'] = 'pending'
        with self.assertRaises(EventError): self.recovery.create(EVENT, payload, OTHER)

    def test_private_proof_normalization_and_failed_upload_cleanup(self):
        self.store['event_claims'] = []
        raw = io.BytesIO(); Image.new('RGB', (20, 20), 'blue').save(raw, 'PNG')
        handler = MagicMock(return_value={'ok': False, 'error': 'Claim no longer available'})
        self.db.client.rpc_handlers['event_claim_command'] = handler
        with self.assertRaises(EventError): self.recovery.create(EVENT, dict(request_id=REQUEST, report_id=REPORT, evidence=self.claim['evidence']), OTHER, raw.getvalue())
        path, content, options = self.bucket.upload.call_args.args
        self.assertRegex(path, rf'^{EVENT}/claims/[a-f0-9-]+/[a-f0-9]{{32}}\.webp$')
        self.assertEqual(content[:4], b'RIFF')
        self.assertEqual(options['upsert'], 'false')
        self.bucket.remove.assert_called_once_with([path])

    def test_ambiguous_claim_failure_preserves_possible_committed_proof(self):
        self.store['event_claims'] = []
        self.db.client.rpc_handlers['event_claim_command'] = lambda p: (_ for _ in ()).throw(RuntimeError('Lost response'))
        raw = io.BytesIO(); Image.new('RGB', (20, 20)).save(raw, 'PNG')
        with self.assertRaises(RuntimeError): self.recovery.create(EVENT, dict(request_id=REQUEST, report_id=REPORT, evidence=self.claim['evidence']), OTHER, raw.getvalue())
        self.bucket.remove.assert_not_called()

    def test_claim_proof_paths_and_access_are_scoped(self):
        self.claim['proof_path'] = f'{EVENT}/claims/{SECOND}/' + 'a' * 32 + '.webp'
        self.bucket.download.return_value = b'private-proof'
        self.assertEqual(self.recovery.proof(EVENT, SECOND, OTHER), b'private-proof')
        self.assertEqual(self.recovery.proof(EVENT, SECOND, STAFF), b'private-proof')
        for actor in (USER, ADMIN):
            with self.subTest(actor=actor), self.assertRaises(EventError): self.recovery.proof(EVENT, SECOND, actor)
        self.claim['proof_path'] = '../../private.webp'
        with self.assertRaises(EventError): self.recovery.proof(EVENT, SECOND, OTHER)

    def test_manager_approval_generates_secrets_but_never_returns_them(self):
        handler = MagicMock(return_value={'ok': True, 'claim': self.claim})
        self.db.client.rpc_handlers['event_claim_command'] = handler
        with patch('app.utils.event_recovery.generate_pin', return_value='ABC234'):
            result = self.recovery.action(EVENT, SECOND, dict(action='approve', version=2, data={'note': 'Ownership checked'}), MANAGER)
        data = handler.call_args.args[0]['p_data']
        self.assertEqual(CryptoService.decrypt(data['pin_encrypted']), 'ABC234')
        self.assertEqual(data['pin_hash'], self.recovery.pin_hash(SECOND, 'ABC234'))
        self.assertNotIn('pickup_code', result)
        self.assertNotIn('pin_encrypted', result)

    def test_role_forgery_and_owner_actions_are_refused(self):
        for actor, payload in ((STAFF, dict(action='approve', version=2, data={'note': 'Checked item'})),
                               (USER, dict(action='withdraw', version=2, data={})),
                               (OTHER, dict(action='reset_pin', version=2, data={'pin_hash': 'forged'})),
                               (MANAGER, dict(action='approve', version=2, data={'note': 'Checked item', 'pin_encrypted': 'forged'}))):
            with self.subTest(actor=actor, payload=payload), self.assertRaises(EventError): self.recovery.action(EVENT, SECOND, payload, actor)

    def test_release_sends_hash_and_requires_identity_check(self):
        handler = MagicMock(return_value={'ok': True, 'claim': {**self.claim, 'status': 'released'}})
        self.db.client.rpc_handlers['event_claim_command'] = handler
        values = dict(note='Verified claimant in person', pin='abc-234', identity_checked=True)
        self.recovery.action(EVENT, SECOND, dict(action='release', version=2, data=values), STAFF)
        data = handler.call_args.args[0]['p_data']
        self.assertNotIn('pin', data)
        self.assertEqual(data['pin_hash'], self.recovery.pin_hash(SECOND, 'ABC234'))
        for change in ({'identity_checked': False}, {'pin': '123'}, {'identity_checked': 1}):
            with self.subTest(change=change), self.assertRaises(EventError): self.recovery.action(EVENT, SECOND, dict(action='release', version=2, data={**values, **change}), STAFF)

    def test_completed_receipt_owner_access_and_minimal_public_verification(self):
        with self.assertRaises(EventError): self.recovery.receipt(EVENT, SECOND, OTHER)
        self.claim.update(status='released', released_at=self.event['starts_at'], recipient_name='Private claimant', receipt_item_label='Blue backpack', receipt_event_name='Campus event')
        receipt = self.recovery.receipt(EVENT, SECOND, OTHER)
        public = self.recovery.verify_receipt(SECOND, receipt['verification_code'])
        self.assertEqual(set(public), {'valid', 'item_label', 'released_on', 'receipt_no'})
        self.assertNotIn('Private claimant', str(public))
        with self.assertRaises(EventError): self.recovery.receipt(EVENT, SECOND, USER)
        with self.assertRaises(EventError): self.recovery.verify_receipt(SECOND, '0000000000000000')
        self.claim['released_at'] = self.event['ends_at']
        with self.assertRaises(EventError): self.recovery.verify_receipt(SECOND, receipt['verification_code'])

    def test_management_requires_exact_fields_and_atomic_rpc(self):
        with self.assertRaises(EventError):
            self.recovery.manage(EVENT, dict(action='delete', version=1, note='Unarchived draft'), ADMIN)
        self.event['status'] = 'archived'
        handler = MagicMock(return_value={'ok': True, 'event': {**self.event, 'deleted_at': self.event['starts_at']}})
        self.db.client.rpc_handlers['event_manage_workspace'] = handler
        result = self.recovery.manage(EVENT, dict(action='delete', version=1, note='Duplicate event draft'), ADMIN)
        self.assertTrue(result['deleted_at'])
        self.assertEqual(handler.call_args.args[0]['p_actor_id'], ADMIN)
        for payload in ({'action': 'purge', 'version': 1, 'note': 'Permanent deletion'}, {'action': 'delete', 'version': True, 'note': 'Invalid version'}):
            with self.subTest(payload=payload), self.assertRaises(EventError): self.recovery.manage(EVENT, payload, ADMIN)


class RecoveryRouteTests(unittest.TestCase):
    def setUp(self):
        recovery_fixture(self); rate_limit.reset(); self.addCleanup(rate_limit.reset)
        self.app = Flask(__name__); self.app.config.update(EVENTS_FOUNDATION_ENABLED=True, SUPABASE_URL='https://example.invalid', SUPABASE_SERVICE_KEY='offline')
        self.app.register_blueprint(routes.event_desk_bp, url_prefix='/api/events')
        self.app.register_blueprint(admin_routes.events_bp, url_prefix='/api/admin')
        self.client = self.app.test_client()
        for p in (patch.object(routes, 'get_db', return_value=self.db), patch.object(admin_routes, 'get_db', return_value=self.db),
                  patch.object(routes.JWTService, 'extract_token_from_header', return_value='offline'),
                  patch.object(routes.JWTService, 'verify_token', return_value={'account_id': OTHER, 'iat': datetime.now(timezone.utc).timestamp()})):
            p.start(); self.addCleanup(p.stop)

    def test_owner_list_is_private_and_staff_endpoints_refuse_attendees(self):
        response = self.client.get('/api/events/portal/campus-event/claims')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(response.json['claims'][0]['pickup_code'], 'ABC234')
        for path in (f'/api/events/{EVENT}/claims', f'/api/events/{EVENT}/claims/{SECOND}'):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_disabled_missing_setup_and_suspended_account_fail_closed(self):
        self.app.config['EVENTS_FOUNDATION_ENABLED'] = False
        self.assertEqual(self.client.get('/api/events/portal/campus-event/claims').status_code, 503)
        self.app.config['EVENTS_FOUNDATION_ENABLED'] = True
        self.store['migration_log'] = []
        self.assertEqual(self.client.get('/api/events/portal/campus-event/claims').status_code, 503)
        self.db.get_user_by_account_id(OTHER)['is_active'] = False
        self.assertEqual(self.client.get('/api/events/portal/campus-event/claims').status_code, 403)

    def test_only_super_admin_can_manage_workspaces(self):
        with patch.object(admin_routes, '_require_admin', side_effect=PermissionError()):
            response = self.client.post(f'/api/admin/events/{EVENT}/manage', json=dict(action='delete', version=1, note='No permission'))
            self.assertEqual(response.status_code, 403)
        with patch.object(admin_routes, '_require_admin', return_value={'account_id': ADMIN}) as auth, patch.object(admin_routes, '_log_admin_action') as audit:
            self.db.client.rpc_handlers['event_manage_workspace'] = lambda p: {'ok': True, 'event': self.event}
            self.assertEqual(self.client.post(f'/api/admin/events/{EVENT}/manage', json=dict(action='archive', version=1, note='Event completed')).status_code, 200)
            auth.assert_called_with('super_admin'); audit.assert_called_once()

    def test_receipt_verification_has_minimal_no_store_response(self):
        self.claim.update(status='released', released_at=self.event['starts_at'], recipient_name='Private claimant', receipt_item_label='Blue backpack', receipt_event_name='Campus event')
        response = self.client.get(f'/api/events/receipts/{SECOND}/verify?code={self.recovery.receipt_code(self.claim)}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertNotIn('Private claimant', str(response.json))
        self.assertEqual(self.client.get(f'/api/events/receipts/{SECOND}/verify?code=bad').status_code, 404)
