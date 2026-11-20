"""Event-only matching isolation and authorization; no network or write workflows."""
import unittest
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from uuid import UUID
from unittest.mock import patch
from flask import Flask
from test_event_reports import fixture, ADMIN, MANAGER, STAFF, USER, OTHER, EVENT, SECOND, REPORT, REQUEST
from app.utils.events import EventError
from app.utils.event_matching import EventMatching, SCAN_LIMIT, RESULT_LIMIT
from app.utils.event_recovery import MIGRATION
from app.utils import rate_limit
from Users.Backend.events import routes


def matching_fixture(test):
    fixture(test)
    test.store['migration_log'].append({'name': MIGRATION})
    test.report.update(item_name='Black Jansport backpack', description='Black bag with silver zipper and blue stitched patch.', moderation_status='approved', public_label='Black backpack', released_at=None)
    earlier = (datetime.fromisoformat(test.report['occurred_at']) - timedelta(minutes=15)).isoformat()
    test.missing = {**test.report, 'report_id': REQUEST, 'kind': 'missing', 'reporter_account_id': OTHER, 'occurred_at': earlier, 'received_at': None}
    test.store['event_reports'].append(test.missing)
    test.store['smart_tags'] = [{'tag_id': 'campus-tag-sentinel'}]
    test.matcher = EventMatching(test.db)


class MatchingTests(unittest.TestCase):
    def setUp(self): matching_fixture(self)

    def test_event_suggestions_reuse_pure_score_without_touching_other_features(self):
        before = deepcopy(self.store)
        with patch.object(self.db.client, 'rpc') as rpc, patch.object(self.db.client, 'table', wraps=self.db.client.table) as tables:
            result = self.matcher.suggestions(EVENT, REQUEST, MANAGER)
        self.assertEqual(len(result['matches']), 1)
        match = result['matches'][0]
        self.assertEqual(match['report']['report_id'], REPORT)
        self.assertGreaterEqual(match['score'], 85)
        self.assertTrue(match['reasons'])
        self.assertIsNone(match['components']['image'])
        for field in ('description', 'reporter_account_id', 'photo_path', 'storage_location', 'pin_hash', 'email'):
            self.assertNotIn(field, match['report'])
        queried = {call.args[0] for call in tables.call_args_list}
        self.assertLessEqual(queried, {'migration_log', 'event_workspaces', 'event_memberships', 'event_reports'})
        rpc.assert_not_called(); self.db.client.storage.from_.assert_not_called()
        self.assertEqual(before, self.store)

    def test_cross_event_hidden_withdrawn_released_and_same_reporter_are_excluded(self):
        for number, changes in enumerate(({'event_id': SECOND}, {'moderation_status': 'hidden'}, {'withdrawn_at': self.event['starts_at']}, {'released_at': self.event['starts_at']}, {'reporter_account_id': OTHER}), 20):
            self.store['event_reports'].append({**self.report, 'report_id': str(UUID(int=number)), **changes})
        result = self.matcher.suggestions(EVENT, REQUEST, STAFF)
        self.assertEqual([value['report']['report_id'] for value in result['matches']], [REPORT])

    def test_attendees_and_unassigned_global_admin_have_no_matching_access(self):
        for actor in (USER, OTHER, ADMIN):
            with self.subTest(actor=actor), self.assertRaises(EventError): self.matcher.suggestions(EVENT, REQUEST, actor)
        with self.assertRaises(EventError): self.matcher.suggestions(SECOND, REQUEST, MANAGER)
        with self.assertRaises(EventError): self.matcher.suggestions(EVENT, SECOND, MANAGER)

    def test_revoked_expired_and_suspended_staff_fail_closed(self):
        self.store['event_memberships'][0]['status'] = 'revoked'
        with self.assertRaises(EventError): self.matcher.suggestions(EVENT, REQUEST, MANAGER)
        self.store['event_memberships'][0]['status'] = 'active'
        self.store['event_memberships'][0]['expires_at'] = self.event['starts_at']
        with self.assertRaises(EventError): self.matcher.suggestions(EVENT, REQUEST, MANAGER)
        self.db.get_user_by_account_id(STAFF)['suspended_until'] = self.event['recovery_ends_at']
        with self.assertRaises(EventError): self.matcher.suggestions(EVENT, REQUEST, STAFF)

    def test_unavailable_event_or_source_stops_before_scoring(self):
        for changes in ({'status': 'closed'}, {'status': 'cancelled'}, {'status': 'archived'}, {'deleted_at': self.event['starts_at']}, {'recovery_ends_at': self.event['starts_at']}):
            previous = dict(self.event); self.event.update(changes)
            with self.subTest(changes=changes), self.assertRaises(EventError), patch('app.utils.event_matching.match_details') as score:
                try: self.matcher.suggestions(EVENT, REQUEST, MANAGER)
                finally: score.assert_not_called()
            self.event.clear(); self.event.update(previous)
        for changes in ({'moderation_status': 'hidden'}, {'withdrawn_at': self.event['starts_at']}, {'released_at': self.event['starts_at']}):
            previous = dict(self.missing); self.missing.update(changes)
            with self.subTest(changes=changes), self.assertRaises(EventError) as error: self.matcher.suggestions(EVENT, REQUEST, STAFF)
            self.assertEqual(error.exception.code, 'event_match_source_unavailable')
            self.missing.clear(); self.missing.update(previous)

    def test_found_report_can_find_missing_counterparts_and_paused_portal_keeps_staff_access(self):
        self.event['portal_enabled'] = False
        value = self.matcher.suggestions(EVENT, REPORT, STAFF)
        self.assertEqual(value['source']['kind'], 'found')
        self.assertEqual(value['matches'][0]['report']['report_id'], REQUEST)

    def test_found_before_missing_timestamp_is_excluded_even_on_the_same_day(self):
        self.report['occurred_at'] = (datetime.fromisoformat(self.missing['occurred_at']) - timedelta(seconds=1)).isoformat()
        self.assertEqual(self.matcher.suggestions(EVENT, REQUEST, STAFF)['matches'], [])

    def test_date_component_uses_manila_day_instead_of_utc_day(self):
        self.missing['occurred_at'] = '2026-11-15T23:30:00+00:00'
        self.report['occurred_at'] = '2026-11-16T00:30:00+00:00'
        self.assertEqual(self.matcher.suggestions(EVENT, REQUEST, STAFF)['matches'][0]['components']['date']['percent'], 100)

    def test_matching_location_and_category_alone_do_not_create_an_ownership_lead(self):
        self.report.update(item_name='Different object', description='the and was found item please')
        self.missing.update(item_name='Unrelated belonging', description='the and was lost item please')
        self.assertEqual(self.matcher.suggestions(EVENT, REQUEST, STAFF)['matches'], [])

    def test_neutral_category_and_unreceived_item_can_still_be_reviewed(self):
        self.report['category'] = 'Others'
        result = self.matcher.suggestions(EVENT, REQUEST, STAFF)
        self.assertEqual(len(result['matches']), 1)
        self.assertIsNone(result['matches'][0]['report']['received_at'])

    def test_candidate_scan_and_result_list_are_bounded_and_older_reports_are_available(self):
        self.store['event_reports'] = [self.missing] + [{**self.report, 'report_id': str(UUID(int=index + 1000))} for index in range(SCAN_LIMIT + 1)]
        newest = self.matcher.suggestions(EVENT, REQUEST, STAFF)
        older = self.matcher.suggestions(EVENT, REQUEST, STAFF, SCAN_LIMIT)
        self.assertEqual((newest['scanned'], len(newest['matches']), newest['has_more']), (SCAN_LIMIT, RESULT_LIMIT, True))
        self.assertEqual((older['scanned'], len(older['matches']), older['has_more']), (1, 1, False))
        self.assertNotIn(older['matches'][0]['report']['report_id'], [value['report']['report_id'] for value in newest['matches']])

    def test_reporting_only_schema_works_and_invalid_pagination_is_rejected(self):
        self.store['migration_log'] = [row for row in self.store['migration_log'] if row['name'] != MIGRATION]
        self.db.client.missing_columns['event_reports'] = ('released_at',)
        self.assertEqual(len(self.matcher.suggestions(EVENT, REQUEST, STAFF)['matches']), 1)
        for offset in (-1, True, 100001, '0'):
            with self.subTest(offset=offset), self.assertRaises(EventError): self.matcher.suggestions(EVENT, REQUEST, STAFF, offset)
        self.store['migration_log'] = []
        with self.assertRaises(EventError) as error: self.matcher.suggestions(EVENT, REQUEST, STAFF)
        self.assertEqual(error.exception.code, 'event_reports_setup_required')


class MatchingRouteTests(unittest.TestCase):
    def setUp(self):
        matching_fixture(self); rate_limit.reset(); self.addCleanup(rate_limit.reset)
        self.app = Flask(__name__); self.app.config.update(EVENTS_FOUNDATION_ENABLED=True, SUPABASE_URL='https://example.invalid', SUPABASE_SERVICE_KEY='offline')
        self.app.register_blueprint(routes.event_desk_bp, url_prefix='/api/events'); self.client = self.app.test_client()
        self.token = {'account_id': STAFF, 'iat': datetime.now(timezone.utc).timestamp()}
        for value in (patch.object(routes, 'get_db', return_value=self.db), patch.object(routes.JWTService, 'extract_token_from_header', return_value='offline'), patch.object(routes.JWTService, 'verify_token', side_effect=lambda token: self.token)):
            value.start(); self.addCleanup(value.stop)
        self.url = f'/api/events/{EVENT}/reports/{REQUEST}/matches'

    def test_staff_route_is_no_store_and_read_only_and_ignores_actor_query_forgery(self):
        before = deepcopy(self.store)
        result = self.client.get(self.url + '?account_id=' + ADMIN)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.headers['Cache-Control'], 'no-store')
        self.assertEqual(len(result.json['matches']), 1)
        self.assertEqual(self.client.post(self.url, json={'status': 'approved'}).status_code, 405)
        self.assertEqual(before, self.store)

    def test_attendee_invalid_page_missing_setup_and_disabled_feature_are_refused(self):
        self.token['account_id'] = USER
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.token['account_id'] = STAFF
        self.assertEqual(self.client.get(self.url + '?offset=-1').status_code, 400)
        self.store['migration_log'] = []
        self.assertEqual(self.client.get(self.url).status_code, 503)
        self.app.config['EVENTS_FOUNDATION_ENABLED'] = False
        self.assertEqual(self.client.get(self.url).status_code, 503)

    def test_session_revocation_and_rate_limit_are_enforced(self):
        self.store['system_settings'] = [{'setting_key': 'sessions_valid_after', 'setting_value': {'ts': (datetime.now(timezone.utc) + timedelta(seconds=10)).isoformat()}}]
        self.assertEqual(self.client.get(self.url).status_code, 401)
        self.store['system_settings'] = []
        with patch.object(routes.rate_limit, 'allow', return_value=False):
            result = self.client.get(self.url)
            self.assertEqual(result.status_code, 429)
            self.assertEqual(result.headers['Cache-Control'], 'no-store')
