"""Offline lifecycle readiness, event isolation and immediate staff access revocation."""
import sys
import unittest
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch, MagicMock
from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from memdb import MemClient
from app.utils.event_lifecycle import EventLifecycle, MIGRATION
from app.utils.events import EventError
from Users.Backend.events import routes

ACTOR = '11111111-1111-4111-8111-111111111111'
MEMBER = '22222222-2222-4222-8222-222222222222'
EVENT = '33333333-3333-4333-8333-333333333333'
OTHER = '44444444-4444-4444-8444-444444444444'


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.now(timezone.utc)
        iso = lambda hours: (self.now + timedelta(hours=hours)).isoformat()
        self.event = dict(event_id=EVENT, name='Campus day', organizer_name='Student council', venue='Gymnasium', desk_instructions='Main entrance', starts_at=iso(1), ends_at=iso(2), recovery_ends_at=iso(3), status='draft', version=1, slug='private-reference', branding={})
        self.member = dict(event_id=EVENT, account_id=MEMBER, role='manager', status='active', starts_at=iso(-1), expires_at=iso(3))
        self.profile = dict(account_id=MEMBER, is_active=True, suspended_until=None, access_level='user', email='never-public@example.test')
        self.store = {'event_workspaces': [self.event], 'event_memberships': [self.member], 'user_profiles': [self.profile], 'migration_log': [{'name': MIGRATION}], 'event_state_history': [], 'found_items': [{'item_id': 'campus'}], 'system_settings': []}
        self.db = SimpleNamespace(client=MemClient(self.store), get_user_by_account_id=lambda identifier: next((p for p in self.store['user_profiles'] if p['account_id'] == identifier), None))
        self.service = EventLifecycle(self.db)

    def test_ready_draft_can_schedule_and_never_opens_public_reports(self):
        result = self.service.review(EVENT, self.now)
        self.assertTrue(result['ready'])
        self.assertEqual(result['actions'], ['scheduled', 'cancelled'])
        self.assertFalse(result['public_reporting_enabled'])

    def test_readiness_missing_details_and_manager_are_actionable(self):
        self.event['desk_instructions'] = ''
        self.member['role'] = 'desk_staff'
        result = self.service.review(EVENT, self.now)
        self.assertFalse(result['ready'])
        self.assertEqual(result['actions'], ['cancelled'])
        self.assertEqual({c['step'] for c in result['checks'] if not c['ok']}, {'details', 'team'})

    def test_manager_must_cover_deadline_and_have_active_account(self):
        for change in ({'is_active': False}, {'suspended_until': (self.now + timedelta(days=1)).isoformat()}):
            with self.subTest(change=change):
                old = dict(self.profile); self.profile.update(change)
                self.assertFalse(self.service.review(EVENT, self.now)['ready'])
                self.profile.clear(); self.profile.update(old)
        self.member['expires_at'] = (self.now + timedelta(hours=2)).isoformat()
        self.assertFalse(self.service.review(EVENT, self.now)['ready'])

    def test_other_events_manager_does_not_complete_readiness(self):
        self.member['event_id'] = OTHER
        self.assertFalse(self.service.review(EVENT, self.now)['ready'])

    def test_missing_migration_preserves_review_but_disables_mutations(self):
        self.store['migration_log'] = []
        result = self.service.review(EVENT, self.now)
        self.assertTrue(result['ready'])
        self.assertFalse(result['lifecycle_available'])
        self.assertEqual(result['actions'], [])
        with self.assertRaises(EventError) as error:
            self.service.transition(EVENT, dict(status='scheduled', version=1, note='Ready to run'), ACTOR)
        self.assertEqual(error.exception.code, 'lifecycle_setup_required')

    def test_transition_uses_only_atomic_rpc_and_passes_version_and_actor(self):
        before = deepcopy(self.store)
        handler = MagicMock(return_value={'ok': True, 'event': {**self.event, 'status': 'scheduled', 'version': 2}})
        self.db.client.rpc_handlers['event_transition'] = handler
        result = self.service.transition(EVENT, dict(status='scheduled', version=1, note=' Ready to run '), ACTOR)
        self.assertEqual(result['status'], 'scheduled')
        self.assertEqual(handler.call_args.args[0], dict(p_event_id=EVENT, p_actor_id=ACTOR, p_version=1, p_target='scheduled', p_note='Ready to run'))
        self.assertEqual(self.store, before)

    def test_rpc_refusal_does_not_fall_back_to_direct_update(self):
        self.db.client.rpc_handlers['event_transition'] = lambda p: {'ok': False, 'error': 'Event changed. Refresh.'}
        with self.assertRaises(EventError) as error:
            self.service.transition(EVENT, dict(status='active', version=1, note='Ready to run'), ACTOR)
        self.assertEqual(error.exception.code, 'transition_refused')
        self.assertEqual(self.event['status'], 'draft')

    def test_transition_rejects_forged_fields_and_invalid_notes(self):
        good = dict(status='scheduled', version=1, note='Ready to run')
        for payload in (None, {**good, 'actor_id': MEMBER}, {**good, 'version': True}, {**good, 'status': 'published'}, {**good, 'note': 'x'}, {**good, 'note': '<script>'}, {**good, 'note': 'bad\nreason'}):
            with self.subTest(payload=payload), self.assertRaises(EventError):
                self.service.transition(EVENT, payload, ACTOR)

    def test_workspace_is_event_scoped_and_contains_no_account_or_brand_secrets(self):
        self.event['status'] = 'scheduled'
        result = self.service.authorize_workspace(EVENT, MEMBER, self.now)
        self.assertEqual(result['permissions'], ['view_workspace'])
        self.assertFalse(result['reporting_enabled'])
        self.assertNotIn('email', str(result))
        self.assertNotIn('slug', result['event'])
        self.assertNotIn('branding', result['event'])
        with self.assertRaises(EventError):
            self.service.authorize_workspace(OTHER, MEMBER, self.now)

    def test_revocation_and_role_change_take_effect_on_next_request(self):
        self.event['status'] = 'active'
        self.service.authorize_workspace(EVENT, MEMBER, self.now)
        for key, value in [('status', 'revoked'), ('role', 'super_admin')]:
            old = self.member[key]; self.member[key] = value
            with self.subTest(key=key), self.assertRaises(EventError):
                self.service.authorize_workspace(EVENT, MEMBER, self.now)
            self.member[key] = old

    def test_expired_future_or_closed_assignments_are_denied(self):
        self.event['status'] = 'active'
        for changes in ({'expires_at': self.now.isoformat()}, {'starts_at': (self.now + timedelta(minutes=1)).isoformat()}):
            old = dict(self.member); self.member.update(changes)
            with self.subTest(changes=changes), self.assertRaises(EventError):
                self.service.authorize_workspace(EVENT, MEMBER, self.now)
            self.member.clear(); self.member.update(old)
        for status in ('draft', 'closed', 'archived', 'cancelled'):
            self.event['status'] = status
            with self.subTest(status=status), self.assertRaises(EventError):
                self.service.authorize_workspace(EVENT, MEMBER, self.now)
        self.event['status'] = 'recovery'; self.event['recovery_ends_at'] = self.now.isoformat()
        with self.assertRaises(EventError):
            self.service.authorize_workspace(EVENT, MEMBER, self.now)

    def test_account_suspension_immediately_denies_workspace(self):
        self.event['status'] = 'active'
        self.profile['is_active'] = False
        with self.assertRaises(EventError):
            self.service.authorize_workspace(EVENT, MEMBER, self.now)


class DeskRouteTests(unittest.TestCase):
    def setUp(self):
        LifecycleTests.setUp(self)
        self.event['status'] = 'scheduled'
        self.app = Flask(__name__)
        self.app.config.update(EVENTS_FOUNDATION_ENABLED=True, SUPABASE_URL='https://example.invalid', SUPABASE_SERVICE_KEY='offline')
        self.app.register_blueprint(routes.event_desk_bp, url_prefix='/api/events')
        self.client = self.app.test_client()
        self.patches = [patch.object(routes, 'get_db', return_value=self.db), patch.object(routes.JWTService, 'extract_token_from_header', return_value='offline'), patch.object(routes.JWTService, 'verify_token', return_value={'account_id': MEMBER, 'iat': self.now.timestamp()})]
        for p in self.patches: p.start(); self.addCleanup(p.stop)

    def test_mine_lists_only_assigned_events_and_never_writes(self):
        before = deepcopy(self.store)
        response = self.client.get('/api/events/mine')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json['workspaces']), 1)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(before, self.store)
        self.member['status'] = 'revoked'
        self.assertEqual(self.client.get('/api/events/mine').json['workspaces'], [])

    def test_profile_super_admin_does_not_bypass_membership(self):
        self.profile['access_level'] = 'super_admin'; self.store['event_memberships'] = []
        self.assertEqual(self.client.get(f'/api/events/{EVENT}/workspace').status_code, 403)

    def test_global_and_role_session_wipes_are_fresh(self):
        for key, value in [('sessions_valid_after', {'ts': (self.now + timedelta(seconds=1)).isoformat()}), ('role_session_wipes', {'user': {'ts': (self.now + timedelta(seconds=1)).isoformat()}})]:
            self.store['system_settings'] = []
            self.assertEqual(self.client.get('/api/events/mine').status_code, 200)
            self.store['system_settings'] = [{'setting_key': key, 'setting_value': value}]
            response = self.client.get('/api/events/mine')
            self.assertEqual(response.status_code, 401)
            self.assertTrue(response.json['session_revoked'])
            self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_missing_token_or_issue_time_is_denied(self):
        for payload in ({'account_id': MEMBER}, {'account_id': MEMBER, 'iat': True}):
            with patch.object(routes.JWTService, 'verify_token', return_value=payload):
                self.assertEqual(self.client.get('/api/events/mine').status_code, 401)

    def test_settings_read_failure_fails_closed(self):
        with patch.object(routes.EventFoundation, '_execute', side_effect=RuntimeError('offline read failure')):
            self.assertEqual(self.client.get('/api/events/mine').status_code, 503)

    def test_feature_disabled_and_maintenance_are_respected(self):
        self.app.config['EVENTS_FOUNDATION_ENABLED'] = False
        self.assertEqual(self.client.get('/api/events/mine').status_code, 503)
        self.app.config['EVENTS_FOUNDATION_ENABLED'] = True
        self.store['system_settings'] = [{'setting_key': 'maintenance_mode', 'setting_value': {'enabled': True}}]
        self.assertEqual(self.client.get('/api/events/mine').status_code, 503)


if __name__ == '__main__':
    unittest.main()
