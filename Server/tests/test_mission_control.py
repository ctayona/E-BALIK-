import io
import json
import sys
import unittest
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

from flask import Flask

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT.parent, ROOT / 'tests'):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from app.utils import mission_control as mission
from app.utils import system_control as control
from app.utils.smart_tags import MAX_PHOTO_BYTES, TAG_IMAGE_BUCKET, SmartTagService, TagError
from Admin.Backend.smart_tags import routes as admin_tag_routes
from Admin.Backend.system_control import routes as system_routes
from Users.Backend.smart_tags import routes as user_tag_routes
from test_smart_tags import ADMIN, CLAIM, OTHER, OWNER, PHOTO, TAG, make_service, tag_row

SUPER = '99999999-9999-4999-8999-999999999999'
NOW = datetime.now(timezone.utc)


class Table:
    """A small in-memory table with the query methods the Mission Control code uses."""

    def __init__(self, client, name):
        self.client, self.name = client, name
        self.rows = client.tables.setdefault(name, [])
        self.op, self.payload, self.filters, self.start, self.stop = 'select', None, [], 0, None

    def select(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def or_(self, *_a, **_k):
        return self

    def limit(self, count):
        self.stop = count
        return self

    def range(self, first, last):
        self.start, self.stop = first, last + 1
        return self

    def eq(self, key, value):
        self.filters.append(lambda r: str(r.get(key)) == str(value))
        return self

    def in_(self, key, values):
        self.filters.append(lambda r: r.get(key) in values)
        return self

    def insert(self, payload):
        self.op, self.payload = 'insert', payload
        return self

    def update(self, payload):
        self.op, self.payload = 'update', payload
        return self

    def execute(self):
        if self.name in self.client.fail:
            raise RuntimeError(self.client.fail[self.name])
        if self.op == 'insert':
            added = self.payload if isinstance(self.payload, list) else [self.payload]
            self.rows.extend(added)
            self.client.inserts.append((self.name, len(added)))
            return MagicMock(data=added)
        matched = [r for r in self.rows if all(f(r) for f in self.filters)]
        if self.op == 'update':
            for row in matched:
                row.update(self.payload)
            return MagicMock(data=matched)
        end = self.stop if self.stop is not None else len(matched)
        return MagicMock(data=[dict(r) for r in matched[self.start:end]])


class Storage:
    def __init__(self, client):
        self.client = client

    def from_(self, bucket):
        client = self.client
        return MagicMock(remove=lambda paths: client.removed.append((bucket, list(paths))))


class Rpc:
    def __init__(self, data, error=None):
        self.data, self.error = data, error

    def execute(self):
        if self.error:
            raise RuntimeError(self.error)
        return MagicMock(data=self.data)


class Client:
    def __init__(self, tables=None, rpcs=None, fail=None):
        self.tables = {k: [dict(r) for r in v] for k, v in (tables or {}).items()}
        self.rpcs, self.fail, self.inserts, self.removed = rpcs or {}, fail or {}, [], []
        self.storage = Storage(self)

    def table(self, name):
        return Table(self, name)

    def rpc(self, name, params):
        result = self.rpcs.get(name)
        if result is None:
            return Rpc(None, f'Could not find the function public.{name} in the schema cache')
        return Rpc(result(params) if callable(result) else result)


def fake_db(**kwargs):
    db = MagicMock()
    db.client = Client(**kwargs)
    db.get_admin_mfa.side_effect = lambda account_id: {'enabled_at': 'x'} if account_id == SUPER else None
    return db


def person(account_id, fname, level='user', **extra):
    return {'account_id': account_id, 'fname': fname, 'lname': 'Cruz', 'email': f'{fname.lower()}@umak.edu.ph', 'campus_id': f'K{fname}', 'access_level': level, 'is_active': True, **extra}


class AnnouncementTests(unittest.TestCase):
    def db(self):
        db = MagicMock()
        db.client.table.return_value.upsert.return_value.execute.return_value = MagicMock()
        return db

    def test_the_banner_is_hidden_until_it_is_live_and_has_text(self):
        settings = {k: dict(v) for k, v in control.DEFAULT_SETTINGS.items()}
        self.assertIsNone(control.public_announcement(settings))
        settings['announcement'] = {'live': True, 'message': '  ', 'tone': 'info'}
        self.assertIsNone(control.public_announcement(settings))
        settings['announcement'] = {'live': True, 'message': 'Downtime tonight', 'tone': 'weird', 'updated_at': 't1', 'title': 'Heads up'}
        self.assertEqual(control.public_announcement(settings), {'id': 't1', 'tone': 'info', 'title': 'Heads up', 'message': 'Downtime tonight'})

    def test_setting_it_cleans_the_text_and_checks_the_style(self):
        saved = {}
        with patch.object(control, 'save_setting', side_effect=lambda db, key, value, actor: saved.update({key: value})):
            value = control.set_announcement(self.db(), True, 'warning', '<b>Maintenance</b>', 'The system  is\n down <script>alert(1)</script> tonight', 'admin1')
        self.assertEqual(value['message'], 'The system is down scriptalert(1)/script tonight')
        self.assertNotIn('<', value['title'] + value['message'])
        self.assertTrue(saved['announcement']['live'])
        with self.assertRaises(ValueError):
            control.set_announcement(self.db(), True, 'warning', '', '   ', 'a')
        with self.assertRaises(ValueError):
            control.set_announcement(self.db(), False, 'rainbow', '', 'x', 'a')
        with patch.object(control, 'save_setting'):
            self.assertFalse(control.set_announcement(self.db(), False, 'info', '', '', 'a')['live'])  # turning it off needs no text

    def test_the_public_status_carries_the_banner_for_every_visitor(self):
        rows = [{'setting_key': 'announcement', 'setting_value': {'live': True, 'message': 'Classes resume Monday', 'tone': 'success', 'updated_at': 'v9'}}]
        db = fake_db(tables={'system_settings': rows})
        control.clear_caches()
        status = control.public_status(db)
        self.assertEqual(status['announcement']['message'], 'Classes resume Monday')
        self.assertFalse(status['maintenance'])
        control.clear_caches()


class MessagingTests(unittest.TestCase):
    def users(self, count=3):
        return [person(f'u{i}', f'User{i}') for i in range(count)]

    def test_input_is_checked_before_anything_is_sent(self):
        db = fake_db(tables={'user_profiles': self.users()})
        for args in (('nobody', 'u0', 'Hello', 'Body text', True, True), ('user', 'u0', 'Hi', 'Body text', True, True),
                     ('user', 'u0', 'Hello', 'x', True, True), ('user', 'u0', 'Hello', 'Body text', False, False),
                     ('user', 'u0', 'Hello', 'Body text', 'true', 'true')):  # strings are not booleans
            with self.assertRaises(mission.ToolError):
                mission.send_message(db, *args)
        self.assertEqual(db.client.inserts, [])
        with self.assertRaises(mission.ToolError) as caught:
            mission.send_message(db, 'user', 'missing', 'Hello', 'Body text', False, True)
        self.assertEqual(caught.exception.status, 404)

    def test_one_user_gets_an_in_app_notification(self):
        db = fake_db(tables={'user_profiles': self.users(), 'user_notifications': []})
        result = mission.send_message(db, 'user', 'u1', 'Pickup ready', 'Your item <b>is ready</b>', False, True)
        row = db.client.tables['user_notifications'][0]
        self.assertEqual((result['recipients'], result['in_app']), (1, 1))
        self.assertEqual((row['user_account_id'], row['title'], row['notification_type'], row['is_read']), ('u1', 'Pickup ready', 'announcement', False))
        self.assertNotIn('<', row['message'])

    def test_everyone_means_every_active_account_in_batches(self):
        people = [person(f'a{i}', f'N{i}') for i in range(1200)] + [person('off', 'Off', is_active=False)]
        db = fake_db(tables={'user_profiles': people, 'user_notifications': []})
        result = mission.send_message(db, 'all', None, 'Campus notice', 'The office closes early.', False, True)
        self.assertEqual((result['recipients'], result['in_app']), (1200, 1200))
        self.assertEqual([n for t, n in db.client.inserts if t == 'user_notifications'], [500, 500, 200])
        self.assertNotIn('off', {r['user_account_id'] for r in db.client.tables['user_notifications']})

    def test_email_goes_to_one_user_directly_and_reports_the_provider(self):
        db = fake_db(tables={'user_profiles': self.users()})
        service = MagicMock()
        service.send_announcement_email.return_value = True
        with patch('config.Config.SENDGRID_API_KEY', 'key'), patch('app.utils.email_service.EmailService', return_value=service):
            result = mission.send_message(db, 'user', 'u2', 'Hello', 'A short note', True, False)
        service.send_announcement_email.assert_called_once_with('user2@umak.edu.ph', 'User2', 'Hello', 'A short note')
        self.assertEqual((result['email_sent'], result['email_failed'], result['in_app']), (1, 0, 0))

    def test_a_campus_wide_email_runs_in_the_background(self):
        db = fake_db(tables={'user_profiles': self.users(5)})
        started = []
        with patch('config.Config.SENDGRID_API_KEY', 'key'), patch.object(mission.threading, 'Thread') as thread:
            thread.return_value.start.side_effect = lambda: started.append(True)
            result = mission.send_message(db, 'all', None, 'Notice', 'Everyone please read', True, True)
        self.assertEqual((result['email_queued'], result['in_app'], started), (5, 5, [True]))

    def test_no_email_service_still_sends_the_in_app_copy(self):
        db = fake_db(tables={'user_profiles': self.users(), 'user_notifications': []})
        with patch('config.Config.SENDGRID_API_KEY', None):
            result = mission.send_message(db, 'user', 'u0', 'Hello', 'A short note', True, True)
        self.assertTrue(result['email_unavailable'])
        self.assertEqual(result['in_app'], 1)

    def test_too_many_recipients_for_email_is_refused_without_sending_anything(self):
        db = fake_db(tables={'user_profiles': [person(f'b{i}', f'M{i}') for i in range(mission.MAX_EMAIL_RECIPIENTS + 1)], 'user_notifications': []})
        with self.assertRaises(mission.ToolError):
            mission.send_message(db, 'all', None, 'Notice', 'Everyone please read', True, True)
        self.assertEqual(db.client.inserts, [])

    def test_user_search_cleans_the_query_and_matches_every_word(self):
        db = fake_db(tables={'user_profiles': [person('u1', 'Maria', campus_id='K1234'), person('u2', 'Mario', lname='Lim')]})
        self.assertEqual(mission.search_users(db, 'm'), [])
        self.assertEqual([u['account_id'] for u in mission.search_users(db, 'maria cruz')], ['u1'])
        self.assertEqual([u['account_id'] for u in mission.search_users(db, "mar,io)or(x=1")], [])  # punctuation cannot reach the filter
        found = mission.search_users(db, 'mari')
        self.assertEqual({u['account_id'] for u in found}, {'u1', 'u2'})
        self.assertEqual(set(found[0]), {'account_id', 'name', 'email', 'campus_id', 'level', 'is_active'})


class GovernanceTests(unittest.TestCase):
    def db(self, extra=None):
        people = [person(SUPER, 'Super', 'super_admin'), person('s2', 'Second', 'super_admin'), person('ad1', 'Admin', 'admin'),
                  person('ad2', 'Legacy', 'user', user_role='Admin', access_level=None), person('us1', 'Plain')] + (extra or [])
        return fake_db(tables={'user_profiles': people})

    def test_every_admin_and_super_admin_is_listed_with_two_factor_status(self):
        admins = mission.list_admins(self.db())
        self.assertEqual([a['level'] for a in admins], ['super_admin', 'super_admin', 'admin', 'admin'])
        self.assertTrue(next(a for a in admins if a['account_id'] == SUPER)['mfa_enabled'])
        self.assertNotIn('us1', {a['account_id'] for a in admins})
        self.assertNotIn('password_hash', admins[0])

    def test_revoking_demotes_the_account_and_tells_them(self):
        db = self.db()
        result = mission.revoke_admin(db, SUPER, 'ad1')
        self.assertEqual((result['previous_level'], result['name']), ('admin', 'Admin Cruz'))
        row = next(r for r in db.client.tables['user_profiles'] if r['account_id'] == 'ad1')
        self.assertEqual(row['access_level'], 'user')
        self.assertEqual(db.create_user_notification.call_args.args[0], 'ad1')
        self.assertNotIn('ad1', {a['account_id'] for a in mission.list_admins(db)})

    def test_a_legacy_role_admin_can_be_revoked_too(self):
        db = self.db()
        mission.revoke_admin(db, SUPER, 'ad2')
        self.assertEqual(next(r for r in db.client.tables['user_profiles'] if r['account_id'] == 'ad2')['access_level'], 'user')

    def test_unsafe_revocations_are_refused(self):
        db = self.db()
        for target, status in ((SUPER, 400), ('us1', 409), ('missing', 404), ('', 400)):
            with self.assertRaises(mission.ToolError) as caught:
                mission.revoke_admin(db, SUPER, target)
            self.assertEqual(caught.exception.status, status, target)
        mission.revoke_admin(db, SUPER, 's2')  # fine: another super admin remains
        solo = fake_db(tables={'user_profiles': [person(SUPER, 'Super', 'super_admin'), person('s2', 'Second', 'super_admin', is_active=False)]})
        with self.assertRaises(mission.ToolError) as caught:
            mission.revoke_admin(solo, 'someone-else', SUPER)  # the last ACTIVE super admin
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(next(r for r in solo.client.tables['user_profiles'] if r['account_id'] == SUPER)['access_level'], 'super_admin')


class ExportTests(unittest.TestCase):
    def db(self):
        return fake_db(tables={
            'user_profiles': [person('u1', 'Maria', verification_status='verified', password_hash='SECRET', verification_document_url='doc'), person('u2', '=cmd', verification_status='pending')],
            'claims': [{'claim_id': 'c1', 'status': 'approved', 'claim_reason': 'ENCRYPTED REASON', 'proof_image_url': 'proof', 'created_at': '2026-01-01'}],
            'found_items': [{'item_id': 'f1', 'fpost_id': 'FP1', 'item_name': 'Umbrella', 'status': 'unclaimed', 'reporter_email': 'private@x.ph', 'created_at': '2026-01-02'}],
            'missing_items': [{'item_id': 'm1', 'mpost_id': 'MP1', 'item_name': 'Wallet', 'status': 'open', 'created_at': '2026-01-03'}, {'item_id': 'm2', 'mpost_id': 'MP2', 'item_name': 'Keys', 'status': 'open', 'created_at': '2026-01-04'}],
        })

    def test_the_export_has_counts_and_only_allow_listed_columns(self):
        export = mission.build_export(self.db(), 'boss@umak.edu.ph')
        blob = mission.export_json(export).decode()
        for secret in ('SECRET', 'ENCRYPTED REASON', 'private@x.ph', 'proof', 'verification_document_url', 'password_hash'):
            self.assertNotIn(secret, blob)
        summary = export['summary']
        self.assertEqual((summary['users_total'], summary['claims_total'], summary['found_items_total'], summary['lost_reports_total']), (2, 1, 1, 2))
        self.assertEqual(summary['users_by_verification'], {'pending': 1, 'verified': 1})
        self.assertEqual(summary['lost_reports_by_status'], {'open': 2})
        self.assertEqual(json.loads(blob)['meta']['generated_by'], 'boss@umak.edu.ph')

    def test_the_csv_download_is_a_zip_of_clean_spreadsheets(self):
        archive = zipfile.ZipFile(io.BytesIO(mission.export_csv_zip(mission.build_export(self.db(), 'x'))))
        self.assertEqual(sorted(archive.namelist()), ['claims.csv', 'found_items.csv', 'missing_items.csv', 'summary.csv', 'users.csv'])
        users = archive.read('users.csv').decode('utf-8-sig')
        self.assertIn("'=cmd", users)  # a formula in a name is shown as text, never executed by Excel
        self.assertNotIn(',=cmd', users)
        self.assertIn('users_total,2', archive.read('summary.csv').decode('utf-8-sig'))


class StorageTests(unittest.TestCase):
    OLD = (NOW - timedelta(days=3)).isoformat()

    def listing(self, bucket_objects):
        return lambda params: bucket_objects.get(params['p_bucket'], [])

    def test_storage_paths_come_from_urls_and_raw_paths_but_never_other_buckets(self):
        self.assertEqual(mission.storage_path('found-item-images', 'https://x.supabase.co/storage/v1/object/public/found-item-images/u1/2026/a%20b.jpg?t=1'), 'u1/2026/a b.jpg')
        self.assertEqual(mission.storage_path('smart-tag-images', 'TAG/abc.jpg'), 'TAG/abc.jpg')
        self.assertIsNone(mission.storage_path('found-item-images', 'https://x.co/storage/v1/object/public/missing-item-images/a.jpg'))
        self.assertIsNone(mission.storage_path('found-item-images', 'data:image/png;base64,AAA'))
        self.assertIsNone(mission.storage_path('found-item-images', ''))

    def db(self, objects, fail=None):
        return fake_db(
            tables={'found_items': [{'image_url': 'https://x.co/storage/v1/object/public/found-item-images/keep/1.jpg'}],
                    'auctions': [{'image_url': None, 'gallery_urls': ['https://x.co/storage/v1/object/public/found-item-images/keep/auction.jpg']}],
                    'missing_items': [], 'smart_tags': [{'item_image_url': 'T1/p.jpg'}], 'claims': [{'proof_image_path': 'c/proof.png', 'proof_image_url': None}]},
            rpcs={'storage_list_objects': self.listing(objects), 'storage_bucket_stats': [{'bucket': 'found-item-images', 'objects': 3, 'bytes': 3072}, {'bucket': 'claim-id-documents', 'objects': 1, 'bytes': 1000}]},
            fail=fail)

    def objects(self):
        recent = NOW.isoformat()
        return {
            'found-item-images': [{'name': 'keep/1.jpg', 'size': 10, 'created_at': self.OLD}, {'name': 'keep/auction.jpg', 'size': 10, 'created_at': self.OLD},
                                  {'name': 'gone/2.jpg', 'size': 500, 'created_at': self.OLD}, {'name': 'new/upload.jpg', 'size': 700, 'created_at': recent}],
            'missing-item-images': [{'name': 'u/3.jpg', 'size': 300, 'created_at': self.OLD}],
            'smart-tag-images': [{'name': 'T1/p.jpg', 'size': 20, 'created_at': self.OLD}, {'name': 'T9/old.jpg', 'size': 40, 'created_at': self.OLD}],
            'claim-proof-images': [{'name': 'c/proof.png', 'size': 5, 'created_at': self.OLD}],
        }

    def test_the_overview_counts_objects_and_bytes(self):
        overview = mission.storage_overview(self.db({}))
        self.assertEqual((overview['total_objects'], overview['image_objects'], overview['image_bytes']), (4, 3, 3072))

    def test_only_unreferenced_and_old_images_are_orphans(self):
        scan = mission.scan_orphans(self.db(self.objects()))
        by = {b['bucket']: b['count'] for b in scan['buckets']}
        self.assertEqual(by, {'found-item-images': 1, 'missing-item-images': 1, 'smart-tag-images': 1, 'claim-proof-images': 0})
        names = {o['name'] for v in scan['_objects'].values() for o in v}
        self.assertEqual(names, {'gone/2.jpg', 'u/3.jpg', 'T9/old.jpg'})  # not the referenced ones, not the fresh upload
        self.assertEqual(scan['bytes'], 840)

    def test_cleaning_removes_exactly_the_orphans(self):
        db = self.db(self.objects())
        result = mission.clean_orphans(db)
        self.assertEqual((result['removed'], result['failed'], result['freed_bytes']), (3, 0, 840))
        self.assertEqual(sorted((b, tuple(p)) for b, p in db.client.removed), [('found-item-images', ('gone/2.jpg',)), ('missing-item-images', ('u/3.jpg',)), ('smart-tag-images', ('T9/old.jpg',))])

    def test_nothing_is_deleted_when_a_reference_table_cannot_be_read(self):
        db = self.db(self.objects(), fail={'claims': 'connection reset'})
        with self.assertRaises(RuntimeError):
            mission.clean_orphans(db)
        self.assertEqual(db.client.removed, [])

    def test_a_missing_sql_function_asks_for_the_migration(self):
        db = fake_db(tables={})
        with self.assertRaises(mission.StorageUnavailable) as caught:
            mission.storage_overview(db)
        self.assertIn('20261010', str(caught.exception))


class EmailTestTests(unittest.TestCase):
    def db(self, email='boss@umak.edu.ph'):
        return fake_db(tables={'user_profiles': [{'account_id': SUPER, 'email': email, 'fname': 'Boss'}]})

    def test_a_missing_api_key_is_reported_without_trying(self):
        with patch('config.Config.SENDGRID_API_KEY', None):
            result = mission.send_test_email(self.db(), SUPER)
        self.assertFalse(result['ok'])
        self.assertIn('SENDGRID_API_KEY', result['detail'])
        self.assertEqual(result['to'], 'b***@umak.edu.ph')

    def test_the_provider_answer_is_passed_through(self):
        service = MagicMock()
        service.send_test_email.return_value = (True, 'SendGrid accepted the message.', 202)
        with patch('config.Config.SENDGRID_API_KEY', 'key'), patch('app.utils.email_service.EmailService', return_value=service):
            result = mission.send_test_email(self.db(), SUPER)
        self.assertEqual((result['ok'], result['status_code']), (True, 202))
        service.send_test_email.assert_called_once_with('boss@umak.edu.ph', 'Boss')

    def test_an_account_without_an_email_cannot_run_the_test(self):
        with self.assertRaises(mission.ToolError):
            mission.send_test_email(self.db(email=''), SUPER)

    def test_masking_hides_most_of_the_address(self):
        self.assertEqual(mission.mask_email('maria@umak.edu.ph'), 'm****@umak.edu.ph')
        self.assertEqual(mission.mask_email(''), '(no email)')


def route_client(level='super_admin', db=None):
    app = Flask(__name__)
    app.config.update(SUPABASE_URL='http://unused', SUPABASE_SERVICE_KEY='unused')
    app.register_blueprint(system_routes.system_control_bp, url_prefix='/api/admin')

    def require(required_level='admin'):
        if required_level == 'super_admin' and level != 'super_admin':
            raise PermissionError('Super administrator access required')
        return {'account_id': SUPER, 'access_level': level, 'email': 'boss@umak.edu.ph'}
    return app.test_client(), [patch.object(system_routes, '_require_admin', side_effect=require), patch.object(system_routes, '_database', return_value=db or fake_db(tables={'user_profiles': []})),
                               patch.object(system_routes, '_log_admin_action')]


class RouteTests(unittest.TestCase):
    def call(self, method, path, level='super_admin', db=None, **kwargs):
        client, patchers = route_client(level, db)
        for p in patchers:
            p.start()
        try:
            from app.utils import rate_limit
            rate_limit._buckets.clear() if hasattr(rate_limit, '_buckets') else None
            return getattr(client, method)(f'/api/admin{path}', **kwargs)
        finally:
            for p in patchers:
                p.stop()

    def test_every_new_tool_is_super_admin_only(self):
        for method, path in (('get', '/system/users/search?q=ma'), ('post', '/system/messages'), ('get', '/system/admins'), ('post', '/system/admins/x/revoke'),
                             ('get', '/system/export'), ('get', '/system/storage'), ('post', '/system/storage/scan'), ('post', '/system/storage/clean'),
                             ('post', '/system/email-test'), ('put', '/system/announcement')):
            kwargs = {'json': {}} if method in ('post', 'put') else {}
            self.assertEqual(self.call(method, path, level='admin', **kwargs).status_code, 403, path)

    def test_tool_errors_become_clear_json_answers(self):
        db = fake_db(tables={'user_profiles': [person('u1', 'Maria')], 'user_notifications': []})
        bad = self.call('post', '/system/messages', db=db, json={'audience': 'all', 'title': 'Hi', 'message': 'short body', 'send_email': False, 'send_in_app': False})
        self.assertEqual(bad.status_code, 400)
        self.assertIn('title', bad.get_json()['error'].lower())
        good = self.call('post', '/system/messages', db=db, json={'audience': 'user', 'account_id': 'u1', 'title': 'Pickup ready', 'message': 'Please collect it', 'send_email': False, 'send_in_app': True})
        self.assertEqual(good.status_code, 200)
        self.assertIn('1 in-app', good.get_json()['message'])

    def test_exports_download_with_a_dated_filename(self):
        db = fake_db(tables={'user_profiles': [person('u1', 'Maria')], 'claims': [], 'found_items': [], 'missing_items': []})
        csv_reply = self.call('get', '/system/export?format=csv', db=db)
        self.assertEqual((csv_reply.status_code, csv_reply.mimetype), (200, 'application/zip'))
        self.assertRegex(csv_reply.headers['Content-Disposition'], r'attachment; filename="ebalik-audit-export-\d{4}-\d{2}-\d{2}\.zip"')
        json_reply = self.call('get', '/system/export', db=db)
        self.assertEqual(json_reply.get_json()['summary']['users_total'], 1)
        self.assertEqual(self.call('get', '/system/export?format=xml', db=db).status_code, 400)

    def test_a_missing_storage_function_answers_503_with_setup_required(self):
        reply = self.call('get', '/system/storage', db=fake_db(tables={}))
        self.assertEqual((reply.status_code, reply.get_json()['setup_required']), (503, True))

    def test_the_announcement_route_validates_and_saves(self):
        with patch.object(control, 'save_setting') as save:
            ok = self.call('put', '/system/announcement', json={'live': True, 'tone': 'warning', 'title': 'Downtime', 'message': 'Saturday 10pm'})
            missing = self.call('put', '/system/announcement', json={'live': True, 'tone': 'info', 'message': ''})
            wrong = self.call('put', '/system/announcement', json={'live': 'yes'})
        self.assertEqual((ok.status_code, missing.status_code, wrong.status_code), (200, 400, 400))
        self.assertTrue(save.call_args.args[2]['live'])


# ---------------------------------------------------------------------------------------------- tag photo
class TagPhotoTests(unittest.TestCase):
    BLANK = {'tag_id': TAG, 'status': 'blank', 'owner_account_id': None, 'is_disabled': False}

    def test_registration_needs_a_photo_and_nothing_is_saved_without_one(self):
        service, _, store = make_service([self.BLANK], auto_photo=False)
        for photo in (None, {'data': b'', 'mimetype': 'image/jpeg'}):
            with self.assertRaises(TagError) as caught:
                service.claim(TAG, OWNER, CLAIM, photo)
            self.assertEqual(caught.exception.extra['code'], 'photo_required')
        self.assertEqual(store['smart_tags'][0]['status'], 'blank')

    def test_only_real_images_of_a_sensible_size_are_accepted(self):
        service, _, store = make_service([self.BLANK], auto_photo=False)
        for photo, code in (({'data': b'GIF89a' + b'0' * 50, 'mimetype': 'image/jpeg'}, 'photo_invalid'), ({'data': b'<?php evil ?>', 'mimetype': 'image/jpeg'}, 'photo_invalid'),
                            ({'data': PHOTO['data'] + b'0' * MAX_PHOTO_BYTES, 'mimetype': 'image/jpeg'}, 'photo_too_large')):
            with self.assertRaises(TagError) as caught:
                service.claim(TAG, OWNER, CLAIM, photo)
            self.assertEqual(caught.exception.extra['code'], code)
        self.assertNotIn('objects', store)

    def test_a_valid_photo_is_stored_privately_and_only_its_path_is_kept(self):
        service, _, store = make_service([self.BLANK], auto_photo=False)
        view = service.claim(TAG, OWNER, CLAIM, PHOTO)
        (bucket, path), (data, options) = next(iter(store['objects'].items()))
        self.assertEqual((bucket, options['content-type'], data), (TAG_IMAGE_BUCKET, 'image/jpeg', PHOTO['data']))
        self.assertTrue(path.startswith(f'{TAG}/') and path.endswith('.jpg'))
        self.assertEqual(store['smart_tags'][0]['item_image_url'], path)
        self.assertIn('token=', view['photo_url'])
        self.assertNotIn(path, json.dumps({k: v for k, v in view.items() if k != 'photo_url'}))

    def test_a_png_is_stored_with_its_real_type_whatever_the_upload_claimed(self):
        service, _, store = make_service([self.BLANK], auto_photo=False)
        png = b'\x89PNG\r\n\x1a\n' + b'0' * 40
        service.claim(TAG, OWNER, CLAIM, {'data': png, 'mimetype': 'image/jpeg'})
        (_, path), (_, options) = next(iter(store['objects'].items()))
        self.assertEqual((options['content-type'], path.endswith('.png')), ('image/png', True))

    def test_a_failed_upload_keeps_the_tag_blank(self):
        service, _, store = make_service([self.BLANK], auto_photo=False)
        store['storage_fail'] = True
        with self.assertRaises(TagError) as caught:
            service.claim(TAG, OWNER, CLAIM, PHOTO)
        self.assertEqual((caught.exception.status, store['smart_tags'][0]['status']), (502, 'blank'))

    def test_an_already_registered_tag_never_stores_a_second_persons_photo(self):
        service, _, store = make_service([tag_row()], auto_photo=False)
        with self.assertRaises(TagError) as caught:
            service.claim(TAG, OTHER, CLAIM, PHOTO)
        self.assertEqual(caught.exception.status, 409)
        self.assertNotIn('objects', store)

    def test_finders_see_the_photo_only_for_a_live_tag(self):
        path = f'{TAG}/a.jpg'
        service, _, _ = make_service([tag_row(item_image_url=path, show_name=True)])
        shown = service.public_view(TAG)
        self.assertIn(f'/{TAG_IMAGE_BUCKET}/{path}?token=', shown['photo_url'])
        self.assertIn('exp=600', shown['photo_url'])  # the link dies after ten minutes
        for status, extra in (('expired', {}), ('active', {'is_disabled': True}), ('blank', {})):
            service, _, _ = make_service([tag_row(item_image_url=path, status=status, **extra)])
            self.assertNotIn('photo_url', service.public_view(TAG), (status, extra))

    def test_tags_registered_before_photos_simply_have_none(self):
        service, _, _ = make_service([tag_row()])
        self.assertIsNone(service.public_view(TAG)['photo_url'])
        self.assertIsNone(service.my_tags(OWNER)[0]['photo_url'])

    def test_the_owner_can_retake_the_photo_and_the_old_one_is_deleted(self):
        service, _, store = make_service([tag_row(item_image_url=f'{TAG}/old.jpg')], auto_photo=False)
        store['objects'] = {(TAG_IMAGE_BUCKET, f'{TAG}/old.jpg'): (b'x', {})}
        view = service.set_photo(TAG, OWNER, PHOTO)
        # The approved photo stays until staff approve the new one; the new one waits beside it.
        self.assertIn((TAG_IMAGE_BUCKET, f'{TAG}/old.jpg'), store['objects'])
        self.assertEqual(len(store['objects']), 2)
        saved = store['smart_tags'][0]
        self.assertEqual(saved['item_image_url'], f'{TAG}/old.jpg')
        self.assertEqual((saved['pending_image_url'] or '').split('/')[0], TAG)
        self.assertEqual((view['status'], saved['prior_status']), ('pending_verification', 'active'))
        self.assertTrue(view['photo_url'])

    def test_only_the_owner_of_a_working_tag_can_change_its_photo(self):
        for rows, account, status in (([tag_row()], OTHER, 404), ([tag_row(is_disabled=True)], OWNER, 403), ([tag_row(valid_until='2020-01-01T00:00:00+00:00')], OWNER, 403)):
            service, _, store = make_service(rows, auto_photo=False)
            with self.assertRaises(TagError) as caught:
                service.set_photo(TAG, account, PHOTO)
            self.assertEqual(caught.exception.status, status)
            self.assertNotIn('objects', store)

    def test_admins_can_open_the_photo_and_the_list_only_flags_it(self):
        service, _, _ = make_service([tag_row(item_image_url=f'{TAG}/a.jpg'), tag_row(tag_id='ZZZZZZZZZZ22')])
        self.assertIn('token=', service.admin_photo_url(TAG))
        listed = {t['tag_id']: t for t in service.admin_list('all')['tags']}
        self.assertEqual((listed[TAG]['has_photo'], listed['ZZZZZZZZZZ22']['has_photo']), (True, False))
        self.assertNotIn(f'{TAG}/a.jpg', json.dumps(service.admin_list('all')))


class TagPhotoRouteTests(unittest.TestCase):
    def client(self, service):
        app = Flask(__name__)
        app.register_blueprint(user_tag_routes.smart_tags_bp, url_prefix='/api/tags')
        return app.test_client(), [patch.object(user_tag_routes, '_service', return_value=service), patch.object(user_tag_routes, '_authenticated_account_id', return_value=OWNER)]

    def form(self, photo=True, data=None):
        values = {k: str(v).lower() if isinstance(v, bool) else v for k, v in CLAIM.items()}
        if photo:
            values['photo'] = (io.BytesIO(data or PHOTO['data']), 'camera.jpg', 'image/jpeg')
        return values

    def test_a_multipart_registration_with_a_photo_succeeds_and_one_without_is_a_400(self):
        service, _, store = make_service([{'tag_id': TAG, 'status': 'blank', 'owner_account_id': None, 'is_disabled': False}], auto_photo=False)
        client, patchers = self.client(service)
        for p in patchers:
            p.start()
        try:
            without = client.post(f'/api/tags/{TAG}/claim', data=self.form(photo=False), content_type='multipart/form-data')
            junk = client.post(f'/api/tags/{TAG}/claim', data=self.form(data=b'not an image'), content_type='multipart/form-data')
            ok = client.post(f'/api/tags/{TAG}/claim', data=self.form(), content_type='multipart/form-data')
        finally:
            for p in patchers:
                p.stop()
        self.assertEqual((without.status_code, junk.status_code, ok.status_code), (400, 400, 201))
        self.assertEqual(without.get_json()['code'], 'photo_required')
        self.assertTrue(ok.get_json()['tag']['photo_url'])
        self.assertEqual(ok.headers['Cache-Control'], 'no-store')

    def test_the_photo_route_replaces_a_photo_for_the_owner(self):
        service, _, store = make_service([tag_row()], auto_photo=False)
        client, patchers = self.client(service)
        for p in patchers:
            p.start()
        try:
            reply = client.post(f'/api/tags/{TAG}/photo', data={'photo': (io.BytesIO(PHOTO['data']), 'again.jpg', 'image/jpeg')}, content_type='multipart/form-data')
            none = client.post(f'/api/tags/{TAG}/photo', data={}, content_type='multipart/form-data')
        finally:
            for p in patchers:
                p.stop()
        self.assertEqual((reply.status_code, none.status_code), (200, 400))
        self.assertTrue(reply.get_json()['tag']['photo_url'])


if __name__ == '__main__':
    unittest.main()
