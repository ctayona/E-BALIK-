"""Offline event-alert privacy and connection tests; RPC writes stay in memory."""
import unittest
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID
from flask import Flask
from test_event_matching import matching_fixture
from test_event_reports import ADMIN, MANAGER, STAFF, USER, OTHER, EVENT, SECOND, REPORT, REQUEST
from app.utils.events import EventError
from app.utils.event_alerts import EventAlerts, MIGRATION, TITLE, MESSAGE
from app.utils import rate_limit
from Users.Backend.events import routes

ALERT = str(UUID(int=77))


def alert_fixture(test):
    matching_fixture(test)
    test.store['migration_log'].append({'name': MIGRATION})
    test.store.update(event_match_alerts=[], event_alert_history=[], event_claims=[], user_notifications=[{'message': 'campus-sentinel'}])
    test.alerts = EventAlerts(test.db)
    test.pair = dict(found_report_id=REPORT, missing_version=1, found_version=1)
    test.alert = dict(alert_id=ALERT, event_id=EVENT, missing_report_id=REQUEST, found_report_id=REPORT,
                      recipient_account_id=OTHER, status='active', inactive_reason=None,
                      read_at=None, dismissed_at=None, created_at=test.report['created_at'])
    test.store['event_match_alerts'].append(test.alert)
    test.db.client.rpc_handlers['event_send_match_alert'] = lambda p: {'ok': True, 'alert': test.alert, 'replayed': True}
    test.db.client.rpc_handlers['event_alert_unread_count'] = lambda p: 1 if p['p_actor_id'] == OTHER else 0

    def action(p):
        if p['p_event_id'] != EVENT or p['p_alert_id'] != ALERT or p['p_actor_id'] != OTHER:
            return {'ok': False, 'error': 'This alert is unavailable.'}
        stamp = datetime.now(timezone.utc).isoformat()
        test.alert['read_at'] = test.alert['read_at'] or stamp
        if p['p_action'] == 'dismiss': test.alert['dismissed_at'] = test.alert['dismissed_at'] or stamp
        return {'ok': True, 'alert': test.alert}
    test.db.client.rpc_handlers['event_alert_action'] = action


class AlertTests(unittest.TestCase):
    def setUp(self): alert_fixture(self)

    def test_preview_is_read_only_generic_and_excludes_private_match_details(self):
        before = deepcopy(self.store)
        result = self.alerts.preview(EVENT, REQUEST, self.pair, MANAGER)
        self.assertEqual((result['title'], result['message']), (TITLE, MESSAGE))
        self.assertTrue(result['already_sent'])
        for private in ('description', 'photo_path', 'reporter_account_id', 'storage_location', 'email', 'score', 'reasons'):
            self.assertNotIn(private, str(result))
        self.assertEqual(self.store, before)
        self.db.client.storage.from_.assert_not_called()

    def test_only_fresh_assigned_managers_can_preview_or_send(self):
        for actor in (STAFF, USER, OTHER, ADMIN):
            with self.subTest(actor=actor), self.assertRaises(EventError): self.alerts.preview(EVENT, REQUEST, self.pair, actor)
        self.store['event_memberships'][0]['status'] = 'revoked'
        with self.assertRaises(EventError): self.alerts.send(EVENT, REQUEST, self.pair, MANAGER)

    def test_payload_cannot_choose_recipient_message_score_or_forged_versions(self):
        for change in ({'recipient_account_id': USER}, {'message': 'Injected'}, {'score': 100}, {'found_version': True}, {'found_version': 2}, {'missing_version': '1'}, {'found_report_id': SECOND}):
            with self.subTest(change=change), self.assertRaises(EventError): self.alerts.send(EVENT, REQUEST, {**self.pair, **change}, MANAGER)

    def test_unapproved_or_unavailable_or_weak_pairs_are_refused(self):
        for changes in ({'moderation_status': 'pending'}, {'moderation_status': 'hidden'}, {'withdrawn_at': self.report['created_at']}, {'released_at': self.report['created_at']}, {'reporter_account_id': OTHER}, {'event_id': SECOND}, {'item_name': 'unrelated thing', 'description': 'no common private identifying features'}):
            old = dict(self.report); self.report.update(changes)
            with self.subTest(changes=changes), self.assertRaises(EventError): self.alerts.preview(EVENT, REQUEST, self.pair, MANAGER)
            self.report.clear(); self.report.update(old)

    def test_paused_closed_or_expired_portal_refuses_send(self):
        for changes in ({'portal_enabled': False}, {'status': 'closed'}, {'deleted_at': self.report['created_at']}, {'recovery_ends_at': self.event['starts_at']}):
            old = dict(self.event); self.event.update(changes)
            with self.subTest(changes=changes), self.assertRaises(EventError): self.alerts.send(EVENT, REQUEST, self.pair, MANAGER)
            self.event.clear(); self.event.update(old)

    def test_inactive_unverified_or_suspended_owner_is_refused(self):
        profile = self.db.get_user_by_account_id(OTHER)
        for changes in ({'is_active': False}, {'verification_status': 'pending'}, {'suspended_until': self.event['recovery_ends_at']}):
            old = dict(profile); profile.update(changes)
            with self.subTest(changes=changes), self.assertRaises(EventError): self.alerts.preview(EVENT, REQUEST, self.pair, MANAGER)
            profile.clear(); profile.update(old)

    def test_send_calls_only_atomic_rpc_with_server_derived_scope(self):
        before = deepcopy(self.store)
        with patch.object(self.db.client, 'rpc', wraps=self.db.client.rpc) as rpc:
            value = self.alerts.send(EVENT, REQUEST, self.pair, MANAGER)
        self.assertTrue(value['sent'] and value['already_sent'])
        rpc.assert_called_once_with('event_send_match_alert', dict(p_event_id=EVENT, p_actor_id=MANAGER, p_missing_id=REQUEST, p_found_id=REPORT, p_missing_version=1, p_found_version=1))
        self.assertEqual(before, self.store)

    def test_rpc_refusal_has_no_direct_write_fallback(self):
        before = deepcopy(self.store)
        self.db.client.rpc_handlers['event_send_match_alert'] = lambda p: {'ok': False, 'error': 'Daily event alert limit reached.'}
        with self.assertRaises(EventError) as error: self.alerts.send(EVENT, REQUEST, self.pair, MANAGER)
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(before, self.store)

    def test_existing_claim_blocks_new_notice_but_not_duplicate_replay(self):
        self.store['event_claims'] = [dict(event_id=EVENT, report_id=REPORT, claimant_account_id=OTHER, status='pending')]
        self.assertTrue(self.alerts.preview(EVENT, REQUEST, self.pair, MANAGER)['already_sent'])
        self.store['event_match_alerts'].clear()
        with self.assertRaises(EventError): self.alerts.send(EVENT, REQUEST, self.pair, MANAGER)

    def test_inbox_is_scoped_to_own_recipient_and_event(self):
        self.store['event_match_alerts'] += [{**self.alert, 'alert_id': USER, 'recipient_account_id': USER}, {**self.alert, 'alert_id': SECOND, 'event_id': SECOND}]
        before = deepcopy(self.store)
        with patch.object(self.db.client, 'table', wraps=self.db.client.table) as tables:
            values = self.alerts.mine('campus-event', OTHER)
        self.assertEqual([value['alert_id'] for value in values], [ALERT])
        self.assertTrue(values[0]['can_claim']); self.assertEqual(values[0]['listing']['report_id'], REPORT)
        for private in ('description', 'photo_path', 'storage_location', 'sent_by', 'recipient_account_id', 'reporter_account_id', 'score', 'reasons'):
            self.assertNotIn(private, str(values))
        self.assertLessEqual({call.args[0] for call in tables.call_args_list}, {'migration_log', 'event_workspaces', 'event_reports', 'event_claims', 'event_match_alerts'})
        self.assertEqual(before, self.store)

    def test_inactive_alerts_hide_listing_even_when_restored_status_is_stale(self):
        for target, changes in ((self.event, {'portal_enabled': False}), (self.event, {'deleted_at': self.report['created_at']}), (self.event, {'status': 'closed'}), (self.report, {'released_at': self.report['created_at']}), (self.report, {'moderation_status': 'hidden'}), (self.missing, {'withdrawn_at': self.report['created_at']}), (self.missing, {'reporter_account_id': USER}), (self.alert, {'status': 'inactive'})):
            old = dict(target); target.update(changes)
            with self.subTest(changes=changes):
                value = self.alerts.mine('campus-event', OTHER)[0]
                self.assertEqual(value['status'], 'inactive'); self.assertIsNone(value['listing']); self.assertFalse(value['can_claim'])
            target.clear(); target.update(old)

    def test_own_existing_claim_links_to_tracking_instead_of_duplicate_claim(self):
        self.store['event_claims'] = [dict(event_id=EVENT, report_id=REPORT, claimant_account_id=OTHER, status='approved')]
        value = self.alerts.mine('campus-event', OTHER)[0]
        self.assertEqual(value['claim_status'], 'approved'); self.assertFalse(value['can_claim'])
        self.store['event_claims'][0]['claimant_account_id'] = USER
        self.assertTrue(self.alerts.mine('campus-event', OTHER)[0]['can_claim'])

    def test_read_dismiss_keep_alert_history_and_all_view(self):
        self.assertEqual(self.alerts.action(EVENT, ALERT, {'action': 'read'}, OTHER)['alert_id'], ALERT)
        stamp = self.alert['read_at']
        self.alerts.action(EVENT, ALERT, {'action': 'dismiss'}, OTHER)
        self.assertEqual(self.alert['read_at'], stamp)
        self.assertEqual(self.alerts.mine('campus-event', OTHER), [])
        self.assertEqual(len(self.alerts.mine('campus-event', OTHER, view='all')), 1)

    def test_acknowledgement_cannot_mutate_another_recipient_or_event(self):
        for actor, event in ((USER, EVENT), (MANAGER, EVENT), (OTHER, SECOND)):
            with self.subTest(actor=actor, event=event), self.assertRaises(EventError): self.alerts.action(event, ALERT, {'action': 'read'}, actor)
        for payload in ({'action': 'delete'}, {'action': 'read', 'status': 'active'}, None):
            with self.subTest(payload=payload), self.assertRaises(EventError): self.alerts.action(EVENT, ALERT, payload, OTHER)

    def test_missing_setup_is_optional_for_old_pages_and_explicit_for_new_actions(self):
        self.store['migration_log'] = [row for row in self.store['migration_log'] if row['name'] != MIGRATION]
        self.assertEqual(self.alerts.count('campus-event', OTHER), {'available': False, 'unread_count': 0})
        self.assertFalse(self.matcher.suggestions(EVENT, REQUEST, STAFF)['alerts_available'])
        with self.assertRaises(EventError) as error: self.alerts.mine('campus-event', OTHER)
        self.assertEqual(error.exception.code, 'event_alerts_setup_required')

    def test_unread_count_uses_only_own_read_only_rpc(self):
        before = deepcopy(self.store)
        with patch.object(self.db.client, 'rpc', wraps=self.db.client.rpc) as rpc:
            self.assertEqual(self.alerts.count('campus-event', OTHER), {'available': True, 'unread_count': 1})
        rpc.assert_called_once_with('event_alert_unread_count', {'p_event_id': EVENT, 'p_actor_id': OTHER})
        self.assertEqual(before, self.store)

    def test_matching_pair_status_does_not_expose_alert_recipient(self):
        result = self.matcher.suggestions(EVENT, REQUEST, MANAGER)
        self.assertTrue(result['alerts_available']); self.assertEqual(result['matches'][0]['alert_status'], 'active')
        self.assertNotIn('recipient_account_id', str(result)); self.assertNotIn('sent_by', str(result))

    def test_pagination_and_view_validation_are_bounded(self):
        for offset in (-1, True, '0', 100001):
            with self.subTest(offset=offset), self.assertRaises(EventError): self.alerts.mine('campus-event', OTHER, offset)
        with self.assertRaises(EventError): self.alerts.mine('campus-event', OTHER, view='all-users')
        self.store['event_match_alerts'] = [{**self.alert, 'alert_id': str(UUID(int=100+i))} for i in range(25)]
        self.assertEqual(len(self.alerts.mine('campus-event', OTHER)), 24)
        self.assertEqual(len(self.alerts.mine('campus-event', OTHER, offset=24)), 1)


class AlertRouteTests(unittest.TestCase):
    def setUp(self):
        alert_fixture(self); rate_limit.reset(); self.addCleanup(rate_limit.reset)
        self.app = Flask(__name__); self.app.config.update(EVENTS_FOUNDATION_ENABLED=True, SUPABASE_URL='https://example.invalid', SUPABASE_SERVICE_KEY='offline')
        self.app.register_blueprint(routes.event_desk_bp, url_prefix='/api/events'); self.client = self.app.test_client()
        self.token = {'account_id': MANAGER, 'iat': datetime.now(timezone.utc).timestamp()}
        for value in (patch.object(routes, 'get_db', return_value=self.db), patch.object(routes.JWTService, 'extract_token_from_header', return_value='offline'), patch.object(routes.JWTService, 'verify_token', side_effect=lambda token: self.token)):
            value.start(); self.addCleanup(value.stop)
        self.url = f'/api/events/{EVENT}/reports/{REQUEST}/alerts'
        self.query = f'?found_report_id={REPORT}&missing_version=1&found_version=1'
        self.inbox = '/api/events/portal/campus-event/alerts'
        self.action_url = f'/api/events/{EVENT}/alerts/{ALERT}/actions'

    def test_preview_get_is_no_store_and_send_requires_manager(self):
        before = deepcopy(self.store)
        value = self.client.get(self.url + self.query)
        self.assertEqual(value.status_code, 200); self.assertEqual(value.headers['Cache-Control'], 'no-store')
        self.assertEqual(before, self.store)
        self.assertEqual(self.client.post(self.url, json=self.pair).status_code, 200)
        self.token['account_id'] = STAFF
        self.assertEqual(self.client.get(self.url + self.query).status_code, 403)
        self.assertEqual(self.client.post(self.url, json=self.pair).status_code, 403)

    def test_preview_rejects_extra_invalid_and_overflow_versions(self):
        for query in (self.query + '&recipient_account_id=' + USER, self.query.replace('missing_version=1', 'missing_version=-1'), self.query.replace('found_version=1', 'found_version=2147483648'), '?found_report_id=' + REPORT):
            with self.subTest(query=query): self.assertEqual(self.client.get(self.url + query).status_code, 400)

    def test_inbox_actor_forgery_cannot_select_another_recipient(self):
        self.token['account_id'] = USER
        value = self.client.get(self.inbox + '?account_id=' + OTHER)
        self.assertEqual(value.status_code, 200); self.assertEqual(value.json['alerts'], [])
        self.assertEqual(value.headers['Cache-Control'], 'no-store')
        self.assertEqual(self.client.post(self.action_url, json={'action': 'read'}).status_code, 409)

    def test_owner_actions_and_inbox_views_connect_without_campus_mutations(self):
        self.token['account_id'] = OTHER
        before = deepcopy(self.store['user_notifications'])
        self.assertEqual(self.client.get(self.inbox + '/count').json['unread_count'], 1)
        self.assertEqual(len(self.client.get(self.inbox).json['alerts']), 1)
        self.assertEqual(self.client.post(self.action_url, json={'action': 'dismiss'}).status_code, 200)
        self.assertEqual(self.client.get(self.inbox).json['alerts'], [])
        self.assertEqual(len(self.client.get(self.inbox + '?view=all').json['alerts']), 1)
        self.assertEqual(self.store['user_notifications'], before)
        self.assertEqual(self.client.get(self.action_url).status_code, 405)

    def test_missing_setup_hides_count_without_breaking_prior_matching(self):
        self.store['migration_log'] = [row for row in self.store['migration_log'] if row['name'] != MIGRATION]
        self.assertEqual(self.client.get(self.inbox + '/count').json, {'available': False, 'unread_count': 0})
        self.assertEqual(self.client.get(self.url + self.query).status_code, 503)
        self.assertEqual(self.client.get(self.inbox).status_code, 503)
        self.assertEqual(self.client.get(f'/api/events/{EVENT}/reports/{REQUEST}/matches').status_code, 200)

    def test_active_session_verification_rate_and_feature_gates(self):
        with patch.object(routes.rate_limit, 'allow', return_value=False):
            for url, body in ((self.url, self.pair), (self.action_url, {'action': 'read'})):
                result = self.client.post(url, json=body)
                self.assertEqual(result.status_code, 429); self.assertEqual(result.headers['Cache-Control'], 'no-store')
        self.token['account_id'] = OTHER; self.db.get_user_by_account_id(OTHER)['verification_status'] = 'pending'
        self.assertEqual(self.client.get(self.inbox).status_code, 403)
        self.db.get_user_by_account_id(OTHER)['verification_status'] = 'verified'
        self.store['system_settings'] = [{'setting_key': 'sessions_valid_after', 'setting_value': {'ts': (datetime.now(timezone.utc) + timedelta(seconds=5)).isoformat()}}]
        self.assertEqual(self.client.get(self.inbox).status_code, 401)
        self.app.config['EVENTS_FOUNDATION_ENABLED'] = False
        self.assertEqual(self.client.get(self.inbox).status_code, 503)
