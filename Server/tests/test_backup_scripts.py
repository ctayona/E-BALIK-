"""The backup and restore scripts: encryption round trip, a full backup of a fake Supabase, and a dry-run restore that writes nothing."""
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))


import backup_database as backup  # noqa: E402
import restore_database as restore  # noqa: E402

ENV = {'SUPABASE_URL': 'https://abcdefgh.supabase.co', 'SUPABASE_SERVICE_KEY': 'service-key'}


class FakeSupabase:
    def __init__(self):
        self.tables = {
            'user_profiles': [{'account_id': 'a', 'email': 'x@umak.edu.ph', 'created_at': '1'}],
            'found_items': [{'item_id': f'f{i}', 'created_at': str(i)} for i in range(2300)],
            'otp_tokens': [{'id': 1, 'created_at': '1'}],
        }
        self.writes = []

    def http(self, url, key, method='GET', body=None, headers=None, timeout=60):
        if url.endswith('/rest/v1/'):
            return json.dumps({'definitions': {name: {'properties': {'created_at': {}, 'id': {}}} for name in self.tables}}).encode(), {}
        if '/rest/v1/system_settings' in url:
            self.writes.append(('status', body))
            return b'', {}
        if '/storage/v1/object/list/' in url:
            return json.dumps([{'name': 'a.jpg', 'id': 'x'}, {'name': 'folder', 'id': None}] if not body['prefix'] else [{'name': 'b.jpg', 'id': 'y'}]).encode(), {}
        if '/storage/v1/object/' in url and method == 'GET':
            return b'JPEGDATA', {}
        if '/rest/v1/' in url and method == 'GET':
            table = url.split('/rest/v1/')[1].split('?')[0]
            start, end = [int(x) for x in headers['Range'].split('-')]
            return json.dumps(self.tables[table][start:end + 1]).encode(), {}
        raise AssertionError(url)


class EncryptionTests(unittest.TestCase):
    def test_round_trip_and_tamper_detection(self):
        with tempfile.TemporaryDirectory() as folder:
            source, sealed, opened = Path(folder, 'a.bin'), Path(folder, 'a.enc'), Path(folder, 'b.bin')
            data = b'personal data ' * 200_000                                  # about 2.8 MB: three 1 MB pieces
            source.write_bytes(data)
            backup.encrypt_file(source, sealed, 'correct horse battery')
            self.assertNotIn(b'personal data', sealed.read_bytes())
            backup.decrypt_file(sealed, opened, 'correct horse battery')
            self.assertEqual(opened.read_bytes(), data)
            with self.assertRaises(backup.BackupError):
                backup.decrypt_file(sealed, opened, 'wrong passphrase!!')
            whole = sealed.read_bytes()
            sealed.write_bytes(whole[:-50])                                     # a truncated file is not mistaken for a complete one
            with self.assertRaises(backup.BackupError):
                backup.decrypt_file(sealed, opened, 'correct horse battery')
            damaged = bytearray(whole)
            damaged[200] ^= 1
            sealed.write_bytes(bytes(damaged))
            with self.assertRaises(backup.BackupError):
                backup.decrypt_file(sealed, opened, 'correct horse battery')


class BackupFlowTests(unittest.TestCase):
    def test_a_backup_saves_every_table_with_checksums_and_skips_one_time_codes(self):
        fake = FakeSupabase()
        with tempfile.TemporaryDirectory() as folder, patch.object(backup, 'http', fake.http):
            result = backup.make_backup(ENV, Path(folder), backup.DEFAULT_EXCLUDE, True, ['found-item-images'], log=lambda *_: None)
            with zipfile.ZipFile(result['path']) as archive:
                names = archive.namelist()
                self.assertIn('tables/found_items.jsonl', names)
                self.assertNotIn('tables/otp_tokens.jsonl', names)
                self.assertEqual(len(archive.read('tables/found_items.jsonl').decode().splitlines()), 2300)    # three pages of 1000
                self.assertEqual(archive.read('storage/found-item-images/folder/b.jpg'), b'JPEGDATA')
                manifest = json.loads(archive.read('manifest.json'))
        self.assertEqual((manifest['project'], manifest['tables']['found_items']['rows'], manifest['files']['found-item-images']), ('abcdefgh', 2300, 2))

    def test_the_command_refuses_without_a_passphrase_and_records_the_result(self):
        fake = FakeSupabase()
        with tempfile.TemporaryDirectory() as folder, patch.object(backup, 'http', fake.http), patch.object(backup, 'load_env', return_value=ENV), \
                patch.dict('os.environ', {'BACKUP_PASSPHRASE': ''}), patch('sys.stdin', io.StringIO()):
            self.assertEqual(backup.main(['--out', folder]), 1)                    # no passphrase and not a terminal: refuse
            self.assertEqual(backup.main(['--out', folder, '--passphrase', 'short']), 1)    # too short
            self.assertEqual(backup.main(['--out', folder, '--passphrase', 'a long enough secret']), 0)
            self.assertEqual(len(list(Path(folder).glob('*.zip.enc'))), 1)
            self.assertFalse(list(Path(folder).glob('*.zip')))                      # the plain zip was removed
        status = fake.writes[-1][1][0]['setting_value']
        self.assertEqual((status['ok'], status['encrypted'], status['tables']), (True, True, 2))


class RestoreTests(unittest.TestCase):
    def make(self, folder):
        with patch.object(backup, 'http', FakeSupabase().http):
            return backup.make_backup(ENV, Path(folder), backup.DEFAULT_EXCLUDE, False, [], log=lambda *_: None)['path']

    def test_a_dry_run_writes_nothing_and_an_apply_upserts_parents_first(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.make(folder)
            writes = []
            with patch.object(restore, 'http', lambda *a, **k: writes.append(a) or (b'', {})), zipfile.ZipFile(path) as archive:
                dry = restore.restore(archive, ENV, None, False, False, log=lambda *_: None)
                self.assertEqual((dry['dry_run'], writes), (True, []))
                applied = restore.restore(archive, ENV, None, True, False, log=lambda *_: None)
        self.assertEqual(applied['restored'], {'user_profiles': 1, 'found_items': 2300})
        self.assertIn('user_profiles', writes[0][0])                               # the parent table first
        self.assertEqual(len([w for w in writes if 'found_items' in w[0]]), 5)    # 2300 rows in batches of 500

    def test_a_table_that_fails_is_retried_in_a_later_pass(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.make(folder)
            calls = {'n': 0}

            def flaky(url, *a, **k):
                if 'found_items' in url:
                    calls['n'] += 1
                    if calls['n'] <= 2:
                        raise backup.BackupError('foreign key violation')
                return b'', {}
            with patch.object(restore, 'http', flaky), zipfile.ZipFile(path) as archive:
                result = restore.restore(archive, ENV, None, True, False, log=lambda *_: None)
        self.assertIn('found_items', result['restored'])
        self.assertEqual(result['failed'], {})

    def test_a_table_that_never_fits_is_reported(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.make(folder)

            def broken(url, *a, **k):
                if 'found_items' in url:
                    raise backup.BackupError('still broken')
                return b'', {}
            with patch.object(restore, 'http', broken), zipfile.ZipFile(path) as archive:
                result = restore.restore(archive, ENV, None, True, False, log=lambda *_: None)
        self.assertIn('found_items', result['failed'])


if __name__ == '__main__':
    unittest.main()
