"""Restoring a backup from the admin console: the file rules, the table rules and every gate on the routes."""
import hashlib
import io
import json
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from flask import Flask

from app.utils import backup_restore as br, rate_limit, system_control as control

PASS = 'a long enough passphrase'
URL = 'https://abcdefgh.supabase.co'
PHRASE = 'RESTORE abcdefgh'


def rows(prefix, n):
    return [{'id': f'{prefix}{i}'} for i in range(n)]


def make_backup(folder, tables, passphrase=PASS, project='abcdefgh', app='E-Balik', tamper=None, plain=False):
    """A real encrypted backup file, built the way backup_database.py builds one."""
    zip_path = Path(folder) / 'b.zip'
    manifest = {'format': 1, 'app': app, 'created_at': '2026-10-20T00:00:00+00:00', 'project': project, 'tables': {}, 'files': {}}
    with zipfile.ZipFile(zip_path, 'w') as archive:
        for name, data in tables.items():
            body = ''.join(json.dumps(r) + '\n' for r in data).encode()
            archive.writestr(f'tables/{name}.jsonl', body if tamper != name else body + b'{"id":"evil"}\n')
            manifest['tables'][name] = {'rows': len(data), 'sha256': hashlib.sha256(body).hexdigest()}
        archive.writestr('manifest.json', json.dumps(manifest))
    if plain:
        return zip_path.read_bytes()
    target = Path(folder) / 'b.zip.enc'
    br._script().encrypt_file(zip_path, target, passphrase)
    return target.read_bytes()


class FakeTable:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.count = None

    def select(self, *a, **k):
        return self

    def limit(self, *a):
        return self

    def upsert(self, batch):
        self.pending = batch
        return self

    def execute(self):
        if self.name not in self.db.tables:
            raise Exception(f'relation "{self.name}" does not exist')
        if hasattr(self, 'pending'):
            if self.db.fail.get(self.name, 0) > 0:
                self.db.fail[self.name] -= 1
                raise Exception('foreign key violation')
            self.db.upserts.append((self.name, len(self.pending)))
            return SimpleNamespace(data=[])
        return SimpleNamespace(data=[], count=self.db.tables[self.name])


class FakeDb:
    def __init__(self, tables=None, fail=None):
        self.tables, self.fail, self.upserts = tables if tables is not None else {}, fail or {}, []
        self.client = SimpleNamespace(table=lambda name: FakeTable(self, name))

    def get_admin_mfa(self, account_id):
        return {'enabled_at': '2026-01-01'}


class EngineTests(unittest.TestCase):
    def setUp(self):
        br._job.clear()

    def open(self, blob, passphrase=PASS):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'up.bin'
            path.write_bytes(blob)
            archive, manifest = br.open_backup(path, passphrase, Path(folder))
            archive.close()
            return manifest

    def test_a_good_backup_opens_and_every_bad_one_is_refused_with_a_plain_message(self):
        with tempfile.TemporaryDirectory() as folder:
            good = make_backup(folder, {'found_items': rows('f', 3)})
            self.assertEqual(self.open(good)['tables']['found_items']['rows'], 3)
            with self.assertRaisesRegex(br.RestoreError, 'Wrong passphrase'):
                self.open(good, 'not the passphrase!')
            with self.assertRaisesRegex(br.RestoreError, 'not an encrypted'):
                self.open(make_backup(folder, {'found_items': rows('f', 1)}, plain=True))
            with self.assertRaisesRegex(br.RestoreError, 'not an E-Balik backup'):
                self.open(make_backup(folder, {'found_items': rows('f', 1)}, app='Other'))
            with self.assertRaisesRegex(br.RestoreError, 'checksum'):
                self.open(make_backup(folder, {'found_items': rows('f', 2)}, tamper='found_items'))
            with self.assertRaises(br.RestoreError):
                self.open(good[:-40])                                    # cut off
            with self.assertRaisesRegex(br.RestoreError, 'passphrase'):
                self.open(good, '')

    def test_the_preview_marks_protected_sensitive_and_missing_tables(self):
        manifest = {'created_at': '2026-10-20T00:00:00+00:00', 'project': 'abcdefgh', 'files': {'found-item-images': 5},
                    'tables': {n: {'rows': 2} for n in ('claims', 'user_profiles', 'admin_mfa', 'ghost')}}
        db = FakeDb({'claims': 7, 'user_profiles': 3, 'admin_mfa': 1})
        result = br.preview(db, manifest, 'abc', URL)
        by = {t['name']: t for t in result['tables']}
        self.assertEqual((by['claims']['kind'], by['claims']['restorable'], by['claims']['current']), ('normal', True, 7))
        self.assertEqual((by['user_profiles']['kind'], by['user_profiles']['restorable']), ('sensitive', True))
        self.assertEqual((by['admin_mfa']['kind'], by['admin_mfa']['restorable']), ('protected', False))
        self.assertEqual((by['ghost']['restorable'], by['ghost']['current']), (False, None))
        self.assertEqual((result['same_project'], result['includes_photos'], result['total_rows']), (True, True, 4))
        self.assertFalse(br.preview(db, {**manifest, 'project': 'zzzz'}, 'abc', URL)['same_project'])
        self.assertEqual(br.confirm_phrase(URL), PHRASE)

    def test_the_table_choice_is_checked_and_ordered_parents_first(self):
        manifest = {'tables': {n: {} for n in ('claims', 'found_items', 'user_profiles', 'admin_mfa', 'otp_tokens', 'income_ledger')}}
        self.assertEqual(br.validate_selection(manifest, ['claims', 'income_ledger', 'found_items'], ''), ['found_items', 'claims', 'income_ledger'])
        for bad in ([], 'claims', ['nope'], ['admin_mfa'], ['claims', 'otp_tokens']):
            with self.assertRaises(br.RestoreError):
                br.validate_selection(manifest, bad, br.SENSITIVE_PHRASE)
        with self.assertRaisesRegex(br.RestoreError, 'extra phrase'):
            br.validate_selection(manifest, ['user_profiles'], '')
        self.assertEqual(br.validate_selection(manifest, ['user_profiles', 'claims'], br.SENSITIVE_PHRASE), ['user_profiles', 'claims'])

    def test_apply_merges_in_batches_retries_and_reports_what_failed_and_never_deletes(self):
        with tempfile.TemporaryDirectory() as folder:
            blob = make_backup(folder, {'found_items': rows('f', 450), 'claims': rows('c', 3), 'income_ledger': rows('i', 2)})
            path = Path(folder) / 'up.bin'
            path.write_bytes(blob)
            archive, _ = br.open_backup(path, PASS, Path(folder))
            db = FakeDb({'found_items': 0, 'claims': 0, 'income_ledger': 0}, fail={'claims': 1})     # claims fails once, then fits
            steps = []
            result = br.apply(db, archive, ['found_items', 'claims', 'income_ledger'], lambda **k: steps.append(k))
            self.assertEqual(result, {'restored': {'found_items': 450, 'claims': 3, 'income_ledger': 2}, 'failed': {}})
            self.assertEqual([n for n, _ in db.upserts if n == 'found_items'], ['found_items'] * 3)    # 200 + 200 + 50
            stuck = br.apply(FakeDb({'claims': 0}, fail={'claims': 99}), archive, ['claims'], lambda **k: None)
            self.assertEqual(list(stuck['failed']), ['claims'])
            archive.close()

    def test_the_background_job_finishes_saves_its_result_and_removes_the_temp_files(self):
        import threading
        folder = Path(tempfile.mkdtemp())
        blob = make_backup(folder, {'claims': rows('c', 5)})
        path = folder / 'up.bin'
        path.write_bytes(blob)
        archive, _ = br.open_backup(path, PASS, folder)
        saved, release = [], threading.Event()
        real_apply = br.apply

        def slow_apply(*args, **kwargs):
            release.wait(5)                                   # hold the first job open so the second start is refused deterministically
            return real_apply(*args, **kwargs)
        with patch.object(br, 'apply', slow_apply):
            br.start(FakeDb({'claims': 0}), archive, folder, ['claims'], 'a@umak.edu.ph', saved.append)
            with self.assertRaisesRegex(br.RestoreError, 'already running'):
                br.start(FakeDb({'claims': 0}), archive, folder, ['claims'], 'x', saved.append)
            release.set()
            for _ in range(100):
                if saved:
                    break
                time.sleep(0.05)
        self.assertEqual((saved[0]['state'], saved[0]['rows'], saved[0]['done_tables']), ('done', 5, ['claims']))
        self.assertFalse(folder.exists())


class RouteTests(unittest.TestCase):
    def setUp(self):
        br._job.clear()
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.blob = make_backup(self.folder.name, {'found_items': rows('f', 4), 'claims': rows('c', 2), 'admin_mfa': rows('m', 1), 'user_profiles': rows('u', 2)})
        self.sha = hashlib.sha256(self.blob).hexdigest()
        self.db = FakeDb({'found_items': 1, 'claims': 1, 'admin_mfa': 1, 'user_profiles': 1})
        self.logged, self.spent = [], []

    def client(self, level='super_admin', maintenance=True, limited=False):
        from Admin.Backend.system_control import routes
        app = Flask(__name__)
        app.config.update(SUPABASE_URL=URL, SUPABASE_SERVICE_KEY='x')
        app.register_blueprint(routes.system_control_bp, url_prefix='/api/admin')

        def require(required_level='admin'):
            if required_level == 'super_admin' and level != 'super_admin':
                raise PermissionError('Super administrator access required')
            return {'account_id': 'a1', 'email': 'root@umak.edu.ph', 'access_level': level}
        settings = {k: dict(v) for k, v in control.DEFAULT_SETTINGS.items()}
        settings['maintenance_mode'] = {'enabled': maintenance, 'message': '', 'since': None}
        for p in (patch.object(rate_limit, 'allow', side_effect=None if limited else (lambda *a, **k: True)) if not limited else patch.object(rate_limit, 'allow', return_value=False),
                  patch.object(routes, '_require_admin', side_effect=require), patch.object(routes, '_database', return_value=self.db),
                  patch.object(control, 'load_settings', return_value=settings), patch.object(control, 'save_setting'),
                  patch.object(routes, '_log_admin_action', side_effect=lambda *a, **k: self.logged.append(a[2])),
                  patch.object(routes, 'consume_authenticator_code', side_effect=lambda *a: self.spent.append(a[2]) or 1)):
            p.start()
        self.addCleanup(patch.stopall)
        return app.test_client(), routes

    def form(self, **over):
        data = {'backup': (io.BytesIO(self.blob), 'b.zip.enc'), 'passphrase': PASS, 'file_sha256': self.sha, 'confirm_phrase': PHRASE,
                'acknowledge': 'yes', 'authenticator_code': '123456', 'tables': json.dumps(['found_items', 'claims'])}
        data.update(over)
        return {k: v for k, v in data.items() if v is not None}

    def post(self, client, path, **over):
        return client.post(f'/api/admin/system/restore/{path}', data=self.form(**over), content_type='multipart/form-data')

    def wait(self):
        for _ in range(100):
            if not br.is_running():
                return
            time.sleep(0.05)

    def test_only_super_admins_can_use_any_restore_route(self):
        client, _ = self.client('admin')
        self.assertEqual(self.post(client, 'preview').status_code, 403)
        self.assertEqual(self.post(client, 'execute').status_code, 403)
        self.assertEqual(client.get('/api/admin/system/restore/status').status_code, 403)
        self.assertEqual((self.db.upserts, self.spent), ([], []))

    def test_the_preview_shows_the_plan_and_writes_nothing(self):
        client, _ = self.client()
        reply = self.post(client, 'preview')
        body = reply.get_json()
        self.assertEqual(reply.status_code, 200)
        self.assertEqual((body['confirm_phrase'], body['maintenance_on'], body['authenticator_enabled'], body['file_sha256']), (PHRASE, True, True, self.sha))
        self.assertEqual({t['name']: t['kind'] for t in body['tables']}['admin_mfa'], 'protected')
        self.assertEqual((self.db.upserts, self.spent, self.logged), ([], [], ['Preview Restore']))
        self.assertEqual(self.post(client, 'preview', passphrase='wrong wrong wrong').status_code, 400)
        self.assertEqual(self.post(client, 'preview', backup=None).status_code, 400)

    def test_every_gate_refuses_before_the_authenticator_code_is_spent(self):
        client, _ = self.client()
        refused = {
            'wrong phrase': self.post(client, 'execute', confirm_phrase='RESTORE other'),
            'no acknowledgement': self.post(client, 'execute', acknowledge=None),
            'a different file': self.post(client, 'execute', file_sha256='0' * 64),
            'wrong passphrase': self.post(client, 'execute', passphrase='wrong wrong wrong'),
            'a protected table': self.post(client, 'execute', tables=json.dumps(['claims', 'admin_mfa'])),
            'no tables': self.post(client, 'execute', tables='[]'),
            'accounts without the extra phrase': self.post(client, 'execute', tables=json.dumps(['user_profiles'])),
        }
        for name, reply in refused.items():
            self.assertEqual(reply.status_code, 400, name)
        self.assertEqual((self.spent, self.db.upserts), ([], []))
        stopped, _ = self.client(maintenance=False)
        self.assertEqual(self.post(stopped, 'execute').status_code, 409)
        self.assertEqual((self.spent, self.db.upserts), ([], []))

    def test_the_limits_stop_repeated_attempts(self):
        client, _ = self.client(limited=True)
        self.assertEqual(self.post(client, 'execute').status_code, 429)
        self.assertEqual(self.post(client, 'preview').status_code, 429)
        self.assertEqual((self.spent, self.db.upserts), ([], []))

    def test_a_wrong_authenticator_code_starts_nothing(self):
        from Admin.Backend.shared.authenticator import AuthenticatorError
        client, routes = self.client()
        with patch.object(routes, 'consume_authenticator_code', side_effect=AuthenticatorError('Authenticator code is invalid.', 401)):
            reply = self.post(client, 'execute')
        self.assertEqual((reply.status_code, self.db.upserts, br.is_running()), (401, [], False))
        self.assertNotIn('Start Restore', self.logged)

    def test_a_correct_request_restores_in_the_background_and_is_logged(self):
        client, _ = self.client()
        reply = self.post(client, 'execute')
        self.assertEqual(reply.status_code, 202)
        self.wait()
        self.assertEqual(self.spent, ['123456'])
        self.assertEqual(sorted({n for n, _ in self.db.upserts}), ['claims', 'found_items'])      # only the chosen tables; the protected one untouched
        self.assertEqual(br.status()['state'], 'done')
        self.assertEqual(self.logged[:1], ['Start Restore'])
        self.assertIn('Finish Restore', self.logged)
        status = client.get('/api/admin/system/restore/status').get_json()
        self.assertEqual((status['running'], status['job']['rows']), (False, 6))

    def test_accounts_can_be_restored_only_with_the_extra_phrase(self):
        client, _ = self.client()
        reply = self.post(client, 'execute', tables=json.dumps(['user_profiles']), sensitive_phrase=br.SENSITIVE_PHRASE)
        self.assertEqual(reply.status_code, 202)
        self.wait()
        self.assertIn('user_profiles', {n for n, _ in self.db.upserts})


if __name__ == '__main__':
    unittest.main()
