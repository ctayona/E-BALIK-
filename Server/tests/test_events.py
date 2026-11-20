"""Offline event foundation: permissions, validation, races, and campus separation."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from memdb import MemClient
from app.utils.events import EventFoundation, EventError, EventSetupRequired, validate, branding, CAMPUS_VENUES
from Admin.Backend.events import routes

ACTOR = '11111111-1111-4111-8111-111111111111'


class FoundationTests(unittest.TestCase):
    def setUp(self):
        self.store = {'found_items': [{'item_id': 'campus'}], 'event_workspaces': []}
        self.service = EventFoundation(SimpleNamespace(client=MemClient(self.store)))

    def create(self):
        return self.service.create({'name': 'Sports Day', 'slug': 'sports-day'}, ACTOR)

    def test_create_is_draft_and_does_not_touch_campus(self):
        row = self.create()
        self.assertEqual((row['status'], row['version']), ('draft', 1))
        self.assertEqual(self.store['found_items'], [{'item_id': 'campus'}])
        self.assertEqual(set(self.store), {'found_items', 'event_workspaces'})

    def test_list_and_detail(self):
        row = self.create()
        self.assertEqual(self.service.get(row['event_id']), row)
        self.assertEqual(len(self.service.list()), 1)

    def test_name_generates_unique_stable_link(self):
        first = self.service.create({'name': 'UMak Foundation Week!'}, ACTOR)
        second = self.service.create({'name': 'UMak Foundation Week!'}, ACTOR)
        self.assertRegex(first['slug'], r'^umak-foundation-week-[0-9a-f]{8}$')
        self.assertNotEqual(first['slug'], second['slug'])
        self.assertEqual(self.service.update(first['event_id'], {'name': 'New name'}, 1)['slug'], first['slug'])

    def test_university_venues_are_enforced(self):
        for venue in CAMPUS_VENUES:
            self.assertEqual(validate({'name': 'Campus event', 'venue': venue})['venue'], venue)
        with self.assertRaises(EventError):
            validate({'name': 'Campus event', 'venue': 'Off-campus hotel'})
        with self.assertRaises(EventError):
            validate({'venue': 'Other place'}, self.create())

    def test_venues_match_existing_admin_options(self):
        import re
        source = (Path(__file__).resolve().parents[2] / 'Admin/Frontend/src/utils/itemOptions.ts').read_text(encoding='utf-8')
        locations = re.search(r'export const CAMPUS_LOCATIONS = \[(.*?)\];', source).group(1)
        self.assertEqual(list(CAMPUS_VENUES), re.findall(r'"([^"]+)"', locations))

    def test_assignment_does_not_change_campus_role(self):
        self.service.db.get_user_by_account_id = MagicMock(return_value={'is_active': True, 'access_level': 'user'})
        event = self.create()
        row = self.service.assign(event['event_id'], {'account_id': ACTOR, 'role': 'desk_staff', 'expires_at': '2099-01-01T00:00:00Z'}, ACTOR)
        self.assertEqual(row['event_id'], event['event_id'])
        self.assertEqual(self.service.memberships(event['event_id'])[0]['role'], 'desk_staff')
        self.assertEqual(self.store.get('user_profiles', []), [])

    def test_assignment_requires_active_account_and_bounded_role(self):
        self.service.db.get_user_by_account_id = MagicMock(return_value={'is_active': False})
        event = self.create()
        payload = {'account_id': ACTOR, 'role': 'desk_staff', 'expires_at': '2099-01-01T00:00:00Z'}
        for values in (payload, {**payload, 'role': 'super_admin'}, {**payload, 'expires_at': '2000-01-01T00:00:00Z'}, {**payload, 'extra': True}):
            with self.subTest(values=values), self.assertRaises(EventError):
                self.service.assign(event['event_id'], values, ACTOR)
        self.assertNotIn('event_memberships', self.store)

    def test_terminal_events_reject_new_staff(self):
        event = self.create()
        self.service.db.get_user_by_account_id = MagicMock(return_value={'is_active': True})
        for status in ('closed', 'archived', 'cancelled'):
            self.store['event_workspaces'][0]['status'] = status
            with self.subTest(status=status), self.assertRaises(EventError) as error:
                self.service.assign(event['event_id'], {'account_id': ACTOR, 'role': 'manager', 'expires_at': '2099-01-01T00:00:00Z'}, ACTOR)
            self.assertEqual(error.exception.code, 'event_locked')

    def test_access_expiry_must_fit_recovery_period(self):
        event = self.service.create({'name': 'Event', 'starts_at': '2090-01-01T00:00:00Z', 'ends_at': '2090-01-02T00:00:00Z', 'recovery_ends_at': '2090-01-03T00:00:00Z'}, ACTOR)
        with self.assertRaises(EventError):
            self.service.assign(event['event_id'], {'account_id': ACTOR, 'role': 'manager', 'expires_at': '2099-01-01T00:00:00Z'}, ACTOR)

    def test_expiry_at_recovery_deadline_is_allowed(self):
        self.service.db.get_user_by_account_id = MagicMock(return_value={'is_active': True})
        event = self.service.create({'name': 'Event', 'starts_at': '2090-01-01T00:00:00Z', 'ends_at': '2090-01-02T00:00:00Z', 'recovery_ends_at': '2090-01-03T00:00:00Z'}, ACTOR)
        row = self.service.assign(event['event_id'], {'account_id': ACTOR, 'role': 'manager', 'expires_at': event['recovery_ends_at']}, ACTOR)
        self.assertEqual(row['expires_at'], event['recovery_ends_at'])

    def test_expired_event_reports_specific_deadline(self):
        event = self.service.create({'name': 'Past', 'starts_at': '2020-01-01T00:00:00Z', 'ends_at': '2020-01-02T00:00:00Z', 'recovery_ends_at': '2020-01-03T00:00:00Z'}, ACTOR)
        with self.assertRaises(EventError) as error:
            self.service.assign(event['event_id'], {'account_id': ACTOR, 'role': 'manager', 'expires_at': '2099-01-01T00:00:00Z'}, ACTOR)
        self.assertEqual(error.exception.code, 'recovery_ended')
        self.assertIn('Manila time', str(error.exception))
        self.assertIn('Schedule', str(error.exception))
        self.assertNotIn('event_memberships', self.store)

    def test_revoke_is_event_scoped(self):
        self.service.db.get_user_by_account_id = MagicMock(return_value={'is_active': True})
        first = self.create()
        second = self.service.create({'name': 'Second'}, ACTOR)
        row = self.service.assign(first['event_id'], {'account_id': ACTOR, 'role': 'manager', 'expires_at': '2099-01-01T00:00:00Z'}, ACTOR)
        with self.assertRaises(EventError):
            self.service.revoke(second['event_id'], row['membership_id'])
        self.assertEqual(self.service.revoke(first['event_id'], row['membership_id'])['status'], 'revoked')

    def test_revoked_membership_can_be_reassigned_without_duplicates(self):
        self.service.db.get_user_by_account_id = MagicMock(return_value={'is_active': True})
        event = self.create()
        payload = {'account_id': ACTOR, 'role': 'manager', 'expires_at': '2099-01-01T00:00:00Z'}
        first = self.service.assign(event['event_id'], payload, ACTOR)
        with self.assertRaises(EventError):
            self.service.assign(event['event_id'], payload, ACTOR)
        self.service.revoke(event['event_id'], first['membership_id'])
        next_row = self.service.assign(event['event_id'], {**payload, 'role': 'desk_staff'}, ACTOR)
        self.assertEqual(next_row['membership_id'], first['membership_id'])
        self.assertEqual((next_row['status'], next_row['role']), ('active', 'desk_staff'))
        self.assertEqual(len(self.store['event_memberships']), 1)

    def test_staff_lookup_returns_only_safe_identity_fields(self):
        event = self.create()
        self.store['user_profiles'] = [{'account_id': ACTOR, 'fname': 'Test', 'email': 'member@example.test', 'is_active': True, 'password_hash': 'never-return', 'access_level': 'user'}]
        row = self.service.staff_lookup(event['event_id'], 'MEMBER@example.test')
        self.assertNotIn('password_hash', row)
        self.assertNotIn('access_level', row)
        self.assertEqual(row['account_id'], ACTOR)

    def test_update_and_stale_save(self):
        row = self.create()
        updated = self.service.update(row['event_id'], {'name': 'New name'}, 1)
        self.assertEqual((updated['name'], updated['version']), ('New name', 2))
        with self.assertRaises(EventError) as error:
            self.service.update(row['event_id'], {'name': 'Overwrite'}, 1)
        self.assertEqual(error.exception.code, 'version_conflict')

    def test_race_between_read_and_update_is_rejected(self):
        row = self.create()
        original = self.service.get
        def racing_get(identifier):
            snapshot = dict(original(identifier))
            self.store['event_workspaces'][0]['version'] += 1
            return snapshot
        with patch.object(self.service, 'get', side_effect=racing_get), self.assertRaises(EventError) as error:
            self.service.update(row['event_id'], {'name': 'Overwrite'}, 1)
        self.assertEqual(error.exception.code, 'version_conflict')

    def test_operational_fields_cannot_be_injected(self):
        for field in ('status', 'created_by', 'event_id', 'published', 'version'):
            with self.subTest(field=field), self.assertRaises(EventError):
                validate({'name': 'Event', 'slug': 'event', field: 'active'})

    def test_invalid_payloads(self):
        for body in (None, [], {}, {'name': '', 'slug': 'abc'}, {'name': 'ok', 'slug': '../bad'}, {'name': '<script>', 'slug': 'abc'}):
            with self.subTest(body=body), self.assertRaises(EventError):
                validate(body)

    def test_timezone_and_date_order(self):
        good = {'name': 'Event', 'slug': 'event', 'starts_at': '2026-12-01T09:00:00+08:00',
                'ends_at': '2026-12-01T17:00:00+08:00', 'recovery_ends_at': '2026-12-10T17:00:00+08:00'}
        self.assertTrue(validate(good)['starts_at'].endswith('+00:00'))
        for change in ({'ends_at': None}, {'starts_at': '2026-12-01T09:00:00'}, {'recovery_ends_at': '2026-11-01T00:00:00Z'}):
            with self.subTest(change=change), self.assertRaises(EventError):
                validate({**good, **change})

    def test_branding_is_bounded_and_defaults_are_independent(self):
        self.assertEqual(branding({'primary': '#ABCDEF'})['primary'], '#abcdef')
        for value in ({'css': 'body{}'}, {'primary': 'red'}, {'template': {}}, {'background': None}):
            with self.subTest(value=value), self.assertRaises(EventError):
                branding(value)
        a, b = self.create(), self.service.create({'name': 'Other', 'slug': 'other'}, ACTOR)
        self.assertIsNot(a['branding'], b['branding'])

    def test_invalid_identifiers_and_versions(self):
        with self.assertRaises(EventError):
            self.service.get('not-a-uuid')
        row = self.create()
        for version in (True, 0, None, '1'):
            with self.subTest(version=version), self.assertRaises(EventError):
                self.service.update(row['event_id'], {'name': 'new'}, version)

    def test_restore_order_preserves_parent_dependencies(self):
        from app.utils import backup_restore
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
        import restore_database
        for order in (backup_restore.FIRST, restore_database.FIRST):
            self.assertLess(order.index('user_profiles'), order.index('event_workspaces'))
            self.assertLess(order.index('event_workspaces'), order.index('event_memberships'))
            self.assertLess(order.index('event_workspaces'), order.index('event_brand_assets'))

    def test_event_page_is_super_only_and_cannot_be_granted(self):
        from app.utils.access_control import ADMIN_PAGES, GRANTABLE, access_summary
        page = next(p for p in ADMIN_PAGES if p['id'] == 'events')
        self.assertTrue(page['super'])
        self.assertNotIn('events', GRANTABLE)
        self.assertIn('events', access_summary({}, 'super_admin')['pages'])
        self.assertNotIn('events', access_summary({}, 'admin')['pages'])

    def test_non_draft_record_cannot_be_edited(self):
        row = self.create()
        self.store['event_workspaces'][0]['status'] = 'active'
        with self.assertRaises(EventError) as error:
            self.service.update(row['event_id'], {'name': 'new'}, 1)
        self.assertEqual(error.exception.code, 'event_locked')

    def test_missing_schema_is_not_confused_with_other_failures(self):
        for code, expected in (('42P01', EventSetupRequired), ('PGRST205', EventSetupRequired), ('23505', EventError), ('42501', RuntimeError)):
            failure = RuntimeError('database error')
            failure.code = code
            query = MagicMock()
            query.execute.side_effect = failure
            with self.subTest(code=code), self.assertRaises(expected):
                self.service._execute(query)


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(EVENTS_FOUNDATION_ENABLED=True, SUPABASE_URL='unused', SUPABASE_SERVICE_KEY='unused')
        self.app.register_blueprint(routes.events_bp, url_prefix='/api/admin')
        self.client = self.app.test_client()

    def test_disabled_never_connects_to_database(self):
        self.app.config['EVENTS_FOUNDATION_ENABLED'] = False
        with patch.object(routes, 'get_db') as db:
            self.assertEqual(self.client.get('/api/admin/events').status_code, 503)
            db.assert_not_called()

    def test_staff_cannot_use_foundation(self):
        with patch.object(routes, '_require_admin', side_effect=PermissionError()) as auth, patch.object(routes, 'get_db') as db:
            self.assertEqual(self.client.post('/api/admin/events', json={'name': 'x', 'slug': 'xxx'}).status_code, 403)
            auth.assert_called_once_with('super_admin')
            db.assert_not_called()

    def test_reenabling_module_restores_saved_draft_listing_without_mutation(self):
        db = SimpleNamespace(client=MemClient({}))
        saved = EventFoundation(db).create({'name': 'Saved campus draft', 'slug': 'saved-campus-draft'}, ACTOR)
        with patch.object(routes, '_require_admin', return_value={'account_id': ACTOR}), patch.object(routes, 'get_db', return_value=db) as connect, patch.object(routes, '_log_admin_action') as audit:
            self.app.config['EVENTS_FOUNDATION_ENABLED'] = False
            unavailable = self.client.get('/api/admin/events?view=drafts')
            self.assertEqual((unavailable.status_code, unavailable.json['code']), (503, 'events_disabled'))
            connect.assert_not_called()
            self.app.config['EVENTS_FOUNDATION_ENABLED'] = True
            restored = self.client.get('/api/admin/events?view=drafts')
            self.assertEqual(restored.status_code, 200)
            self.assertEqual(restored.json['events'], [saved])
            self.assertEqual(restored.headers['Cache-Control'], 'no-store')
            self.assertEqual(EventFoundation(db).get(saved['event_id']), saved)
            audit.assert_not_called()

    def test_authentication_failure(self):
        with patch.object(routes, '_require_admin', side_effect=ValueError()):
            self.assertEqual(self.client.get('/api/admin/events').status_code, 401)

    def test_options_and_staff_routes_require_super_admin(self):
        with patch.object(routes, '_require_admin', side_effect=PermissionError()), patch.object(routes, 'get_db') as db:
            for method, path in [('get', '/api/admin/events/options'), ('get', f'/api/admin/events/{ACTOR}/memberships'), ('post', f'/api/admin/events/{ACTOR}/memberships'), ('post', f'/api/admin/events/{ACTOR}/memberships/{ACTOR}/revoke'), ('get', f'/api/admin/events/{ACTOR}/review'), ('post', f'/api/admin/events/{ACTOR}/transition')]:
                self.assertEqual(getattr(self.client, method)(path).status_code, 403)
            db.assert_not_called()

    def test_create_and_edit_are_audited(self):
        db = SimpleNamespace(client=MemClient({}))
        with patch.object(routes, '_require_admin', return_value={'account_id': ACTOR}), patch.object(routes, 'get_db', return_value=db), patch.object(routes, '_log_admin_action') as audit:
            reply = self.client.post('/api/admin/events', json={'name': 'Event', 'slug': 'event'})
            self.assertEqual(reply.status_code, 201)
            identifier = reply.json['event']['event_id']
            self.assertEqual(self.client.patch('/api/admin/events/' + identifier, json={'version': 1, 'name': 'Changed'}).status_code, 200)
            self.assertEqual(audit.call_count, 2)
            self.assertEqual(self.client.post('/api/admin/events', json={'name': 'Bad', 'slug': 'bad', 'status': 'active'}).status_code, 400)
            self.assertEqual(audit.call_count, 2)

    def test_setup_error_and_generic_error(self):
        with patch.object(routes, '_require_admin', return_value={'account_id': ACTOR}), patch.object(routes, 'get_db'), patch.object(routes.EventRecovery, 'list_events', side_effect=EventSetupRequired()):
            reply = self.client.get('/api/admin/events')
            self.assertEqual((reply.status_code, reply.json['setup_required']), (503, True))

    def test_bad_pagination(self):
        with patch.object(routes, '_require_admin', return_value={'account_id': ACTOR}), patch.object(routes, 'get_db'):
            for offset in ('-1', 'abc', '9999999999999'):
                self.assertEqual(self.client.get('/api/admin/events?offset=' + offset).status_code, 400)
