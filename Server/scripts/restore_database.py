"""Restore an E-Balik backup made by backup_database.py into a Supabase project.

SAFE BY DEFAULT: without --apply it only reads the backup and prints what it WOULD restore. Nothing is written.

Typical recovery
  1. Create a new Supabase project (or reset the broken one) and run the SQL files in Server/manual_migrations (see Step-by-Step Setup.md),
     so the tables exist. This script restores DATA, not table definitions.
  2. Put the new project's SUPABASE_URL and SUPABASE_SERVICE_KEY in Environment_Configs/backend/.env (or the environment).
  3. python Server/scripts/restore_database.py backups/ebalik-backup-....zip.enc --apply            (add --with-files for photos)
Rows are upserted by primary key, in several passes, so parent tables fill before the tables that point at them. Running it twice is safe.
The encryption passphrase comes from --passphrase, env BACKUP_PASSPHRASE, or a prompt.
"""
import argparse
import getpass
import json
import os
import sys
import tempfile
import urllib.parse
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
from backup_database import BackupError, decrypt_file, http, load_env  # noqa: E402

BATCH = 500
PASSES = 4
# Tables other tables point at come first; anything not listed follows alphabetically and is retried until it fits.
FIRST = ['user_profiles', 'system_settings', 'migration_log', 'found_items', 'missing_items', 'auctions', 'smart_tags', 'claims']


def read_backup(path: Path, passphrase: str, workdir: Path) -> zipfile.ZipFile:
    if path.suffix == '.enc':
        target = workdir / path.name.removesuffix('.enc')
        decrypt_file(path, target, passphrase)
        path = target
    return zipfile.ZipFile(path)


def ordered(tables: List[str]) -> List[str]:
    return [t for t in FIRST if t in tables] + sorted(t for t in tables if t not in FIRST)


APPEND_ONLY = {'income_ledger'}   # the database refuses to change money records (migration 20261026): only missing entries are added


def upsert(env: Dict[str, str], table: str, rows: List[Dict[str, Any]]) -> None:
    resolution = 'ignore-duplicates' if table in APPEND_ONLY else 'merge-duplicates'
    http(f"{env['SUPABASE_URL']}/rest/v1/{urllib.parse.quote(table)}", env['SUPABASE_SERVICE_KEY'], 'POST', rows, {'Prefer': f'resolution={resolution},return=minimal'}, timeout=120)


def restore(archive: zipfile.ZipFile, env: Dict[str, str], only: Optional[List[str]], apply: bool, with_files: bool, log=print) -> Dict[str, Any]:
    manifest = json.loads(archive.read('manifest.json'))
    tables = ordered([t for t in manifest['tables'] if not only or t in only])
    log(f"Backup of {manifest.get('project')} from {manifest.get('created_at')}: {len(tables)} tables, {sum(manifest['tables'][t]['rows'] for t in tables)} rows.")
    done: Dict[str, int] = {}
    if not apply:
        for table in tables:
            log(f"  would restore {table}: {manifest['tables'][table]['rows']} rows")
        return {'dry_run': True, 'tables': len(tables)}
    pending = list(tables)
    failures: Dict[str, str] = {}
    for attempt in range(1, PASSES + 1):
        retry = []
        for table in pending:
            try:
                rows = [json.loads(line) for line in archive.read(f'tables/{table}.jsonl').decode('utf-8').splitlines() if line]
                for start in range(0, len(rows), BATCH):
                    upsert(env, table, rows[start:start + BATCH])
                done[table] = len(rows)
                log(f'  restored {table}: {len(rows)} rows')
            except BackupError as error:
                retry.append(table)
                failures[table] = str(error)[:160]
        if not retry:
            break
        pending = retry
        log(f'  pass {attempt}: {len(retry)} table(s) waiting for their parent rows, trying again')
    files = 0
    if with_files:
        for name in archive.namelist():
            if name.startswith('storage/') and not name.endswith('/'):
                bucket, _, path = name[len('storage/'):].partition('/')
                http(f"{env['SUPABASE_URL']}/storage/v1/object/{urllib.parse.quote(bucket)}/{urllib.parse.quote(path)}", env['SUPABASE_SERVICE_KEY'], 'POST', archive.read(name),
                     {'x-upsert': 'true', 'Content-Type': 'application/octet-stream'}, timeout=120)
                files += 1
        log(f'  restored {files} files')
    return {'dry_run': False, 'restored': done, 'failed': {t: failures[t] for t in pending if t not in done}, 'files': files}


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('backup', help='the .zip or .zip.enc file')
    parser.add_argument('--apply', action='store_true', help='really write to the database (without it nothing is changed)')
    parser.add_argument('--tables', default='', help='comma-separated tables to restore (default: all in the backup)')
    parser.add_argument('--with-files', action='store_true', help='also restore storage photos')
    parser.add_argument('--passphrase', default='')
    args = parser.parse_args(argv)
    try:
        passphrase = args.passphrase or os.environ.get('BACKUP_PASSPHRASE', '')
        if args.backup.endswith('.enc') and not passphrase:
            passphrase = getpass.getpass('Passphrase: ')
        env = load_env()
        if args.apply:
            print(f"This WRITES to {env['SUPABASE_URL']}. Type that project's name (the part before .supabase.co) to continue:")
            if input('> ').strip() != urllib.parse.urlparse(env['SUPABASE_URL']).hostname.split('.')[0]:
                raise BackupError('Not confirmed: nothing was changed.')
        with tempfile.TemporaryDirectory() as work:
            archive = read_backup(Path(args.backup), passphrase, Path(work))
            result = restore(archive, env, [t.strip() for t in args.tables.split(',') if t.strip()] or None, args.apply, args.with_files)
            archive.close()
        if result.get('failed'):
            for table, reason in result['failed'].items():
                print(f'  FAILED {table}: {reason}', file=sys.stderr)
            return 2
        print('Done.' if args.apply else 'Dry run finished. Add --apply to restore.')
        return 0
    except BackupError as error:
        print(f'Restore failed: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
