"""Back up E-Balik's Supabase data to one encrypted file you can keep anywhere. Works on the free plan (no Postgres tools needed).

What it saves
  * every table in the `public` schema, one JSON-lines file per table (the app's own data: reports, claims, accounts, ledger...);
  * with --with-files: the photos in the storage buckets you name (default: found and missing item photos).
Not saved by default: one-time codes and admin sign-in challenges (`otp_tokens`, `admin_mfa_challenges`): they expire in minutes.

The file is encrypted (AES-256-GCM, key from your passphrase with scrypt) because a backup holds password hashes and personal data.
Refusing to run without a passphrase is deliberate; pass --no-encrypt only for a throw-away copy on your own disk.

Usage
  python Server/scripts/backup_database.py --out backups                    # asks for the passphrase
  BACKUP_PASSPHRASE=... python Server/scripts/backup_database.py --with-files --buckets found-item-images,missing-item-images,smart-tag-images
  python Server/scripts/backup_database.py --decrypt backups/ebalik-backup-....zip.enc --out backups   # back to a normal .zip
It reads SUPABASE_URL and SUPABASE_SERVICE_KEY from the environment, or from Environment_Configs/backend/.env. After a successful run it
writes the result to `system_settings.last_backup`, which the admin console's Monitoring tab shows (--no-record turns that off).
Keep the passphrase somewhere safe and separate from the backup: without it the file cannot be opened.
"""
import argparse
import getpass
import hashlib
import json
import os
import secrets
import struct
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple

MAGIC = b'EBBK1'
CHUNK = 1024 * 1024
PAGE = 1000
DEFAULT_EXCLUDE = {'otp_tokens', 'admin_mfa_challenges'}
DEFAULT_BUCKETS = ['found-item-images', 'missing-item-images']
ROOT = Path(__file__).resolve().parents[2]


class BackupError(Exception):
    pass


# ---------------------------------------------------------------------------------------------- settings
def load_env() -> Dict[str, str]:
    """SUPABASE_URL and SUPABASE_SERVICE_KEY from the environment, else from Environment_Configs/backend/.env."""
    values = {key: os.environ.get(key, '') for key in ('SUPABASE_URL', 'SUPABASE_SERVICE_KEY')}
    env_file = ROOT / 'Environment_Configs' / 'backend' / '.env'
    if env_file.exists() and not all(values.values()):
        for line in env_file.read_text(encoding='utf-8').splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key, value = line.split('=', 1)
                if key.strip() in values and not values[key.strip()]:
                    values[key.strip()] = value.strip().strip('"').strip("'")
    if not all(values.values()):
        raise BackupError('SUPABASE_URL and SUPABASE_SERVICE_KEY are needed (environment, or Environment_Configs/backend/.env).')
    values['SUPABASE_URL'] = values['SUPABASE_URL'].rstrip('/')
    return values


# ---------------------------------------------------------------------------------------------- HTTP
def http(url: str, key: str, method: str = 'GET', body: Any = None, headers: Optional[Dict[str, str]] = None, timeout: int = 60) -> Tuple[bytes, Dict[str, str]]:
    request = urllib.request.Request(url, method=method, data=None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode('utf-8')),
                                     headers={'apikey': key, 'Authorization': f'Bearer {key}', **({'Content-Type': 'application/json'} if body is not None and not isinstance(body, bytes) else {}), **(headers or {})})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read(), dict(response.headers)
        except urllib.error.HTTPError as error:
            if error.code >= 500 and attempt < 2:
                time.sleep(2 * (attempt + 1))
                continue
            raise BackupError(f'{method} {url.split("?")[0]} answered {error.code}: {error.read()[:200].decode("utf-8", "replace")}')
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            if attempt < 2:
                time.sleep(2 * (attempt + 1))
                continue
            raise BackupError(f'Could not reach Supabase: {error}')
    raise BackupError('unreachable')


def list_tables(url: str, key: str) -> Dict[str, str]:
    """{table: column to order by} from the API's own description of the public schema."""
    body, _ = http(f'{url}/rest/v1/', key, headers={'Accept': 'application/openapi+json'})
    definitions = json.loads(body).get('definitions') or {}
    tables = {}
    for name, definition in definitions.items():
        properties = list((definition.get('properties') or {}).keys())
        if properties:
            tables[name] = 'created_at' if 'created_at' in properties else properties[0]
    return dict(sorted(tables.items()))


def table_rows(url: str, key: str, table: str, order: str) -> Iterator[List[Dict[str, Any]]]:
    offset = 0
    while True:
        body, _ = http(f'{url}/rest/v1/{urllib.parse.quote(table)}?select=*&order={urllib.parse.quote(order)}.asc', key,
                       headers={'Range-Unit': 'items', 'Range': f'{offset}-{offset + PAGE - 1}'})
        rows = json.loads(body or b'[]')
        if rows:
            yield rows
        if len(rows) < PAGE:
            return
        offset += PAGE


def list_objects(url: str, key: str, bucket: str, prefix: str = '') -> Iterator[str]:
    offset = 0
    while True:
        body, _ = http(f'{url}/storage/v1/object/list/{urllib.parse.quote(bucket)}', key, 'POST', {'prefix': prefix, 'limit': 100, 'offset': offset, 'sortBy': {'column': 'name', 'order': 'asc'}})
        entries = json.loads(body or b'[]')
        for entry in entries:
            path = f'{prefix}{entry["name"]}'
            if entry.get('id') is None:       # a folder
                yield from list_objects(url, key, bucket, path + '/')
            else:
                yield path
        if len(entries) < 100:
            return
        offset += 100


# ---------------------------------------------------------------------------------------------- encryption
def _key_from(passphrase: str, salt: bytes) -> bytes:
    from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
    return Scrypt(salt=salt, length=32, n=2 ** 15, r=8, p=1).derive(passphrase.encode('utf-8'))


def _nonce(base: bytes, index: int) -> bytes:
    return base[:4] + (int.from_bytes(base[4:], 'big') ^ index).to_bytes(8, 'big')


def encrypt_file(source: Path, target: Path, passphrase: str) -> None:
    """Chunked AES-256-GCM (1 MB pieces, so a large backup never has to fit in memory). Each piece is bound to its position."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    salt, base = secrets.token_bytes(16), secrets.token_bytes(12)
    aead = AESGCM(_key_from(passphrase, salt))
    with source.open('rb') as reader, target.open('wb') as writer:
        writer.write(MAGIC + salt + base)
        index = 0
        block = reader.read(CHUNK)
        while True:
            following = reader.read(CHUNK)
            sealed = aead.encrypt(_nonce(base, index), block, b'last' if not following else b'more')
            writer.write(struct.pack('>I', len(sealed)) + sealed)
            if not following:
                return
            block, index = following, index + 1


def decrypt_file(source: Path, target: Path, passphrase: str) -> None:
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    with source.open('rb') as reader, target.open('wb') as writer:
        header = reader.read(len(MAGIC) + 28)
        if header[:len(MAGIC)] != MAGIC:
            raise BackupError('This is not an E-Balik backup file.')
        salt, base = header[len(MAGIC):len(MAGIC) + 16], header[len(MAGIC) + 16:]
        aead = AESGCM(_key_from(passphrase, salt))
        index = 0
        try:
            while True:
                size = reader.read(4)
                if not size:
                    raise BackupError('The file ends early: it is incomplete.')
                sealed = reader.read(struct.unpack('>I', size)[0])
                last = not reader.peek(1) if hasattr(reader, 'peek') else reader.tell() >= source.stat().st_size
                writer.write(aead.decrypt(_nonce(base, index), sealed, b'last' if last else b'more'))
                if last:
                    return
                index += 1
        except InvalidTag:
            raise BackupError('Wrong passphrase, or the file was changed or damaged.')


# ---------------------------------------------------------------------------------------------- backup
def make_backup(env: Dict[str, str], out_dir: Path, exclude: set, with_files: bool, buckets: List[str], log=print) -> Dict[str, Any]:
    url, key = env['SUPABASE_URL'], env['SUPABASE_SERVICE_KEY']
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    out_dir.mkdir(parents=True, exist_ok=True)
    zip_path = out_dir / f'ebalik-backup-{stamp}.zip'
    manifest: Dict[str, Any] = {'format': 1, 'app': 'E-Balik', 'created_at': datetime.now(timezone.utc).isoformat(), 'project': urllib.parse.urlparse(url).hostname.split('.')[0],
                                'tables': {}, 'files': {}, 'excluded': sorted(exclude)}
    tables = list_tables(url, key)
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for table, order in tables.items():
            if table in exclude:
                continue
            digest, count = hashlib.sha256(), 0
            with tempfile.TemporaryFile() as spool:
                for rows in table_rows(url, key, table, order):
                    for row in rows:
                        line = (json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
                        spool.write(line)
                        digest.update(line)
                        count += 1
                spool.seek(0)
                archive.writestr(f'tables/{table}.jsonl', spool.read())
            manifest['tables'][table] = {'rows': count, 'sha256': digest.hexdigest()}
            log(f'  table {table}: {count} rows')
        if with_files:
            for bucket in buckets:
                saved = 0
                try:
                    for path in list_objects(url, key, bucket):
                        data, _ = http(f'{url}/storage/v1/object/{urllib.parse.quote(bucket)}/{urllib.parse.quote(path)}', key, timeout=120)
                        archive.writestr(f'storage/{bucket}/{path}', data)
                        saved += 1
                except BackupError as error:
                    log(f'  bucket {bucket}: skipped ({error})')
                manifest['files'][bucket] = saved
                log(f'  bucket {bucket}: {saved} files')
        archive.writestr('manifest.json', json.dumps(manifest, indent=2))
        archive.writestr('README.txt', 'E-Balik backup. tables/*.jsonl is one JSON row per line; storage/<bucket>/ holds the photos. Restore with Server/scripts/restore_database.py.\n')
    return {'path': zip_path, 'manifest': manifest}


def record_status(env: Dict[str, str], status: Dict[str, Any]) -> None:
    """Tell the admin console about this backup (system_settings.last_backup). Best effort."""
    body = [{'setting_key': 'last_backup', 'setting_value': status, 'updated_at': datetime.now(timezone.utc).isoformat()}]
    http(f"{env['SUPABASE_URL']}/rest/v1/system_settings?on_conflict=setting_key", env['SUPABASE_SERVICE_KEY'], 'POST', body, {'Prefer': 'resolution=merge-duplicates,return=minimal'})


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--out', default='backups', help='folder for the backup file (default: backups)')
    parser.add_argument('--with-files', action='store_true', help='also save storage photos')
    parser.add_argument('--buckets', default=','.join(DEFAULT_BUCKETS), help='comma-separated storage buckets for --with-files')
    parser.add_argument('--include-all', action='store_true', help='also save one-time codes and admin sign-in challenges')
    parser.add_argument('--passphrase', default='', help='encryption passphrase (or env BACKUP_PASSPHRASE, or you are asked)')
    parser.add_argument('--no-encrypt', action='store_true', help='leave the backup unencrypted (not recommended: it holds personal data)')
    parser.add_argument('--no-record', action='store_true', help='do not tell the admin console about this backup')
    parser.add_argument('--decrypt', metavar='FILE', help='decrypt an .enc backup into a .zip instead of making a backup')
    args = parser.parse_args(argv)
    out_dir = Path(args.out)
    passphrase = args.passphrase or os.environ.get('BACKUP_PASSPHRASE', '')
    try:
        if args.decrypt:
            source = Path(args.decrypt)
            passphrase = passphrase or getpass.getpass('Passphrase: ')
            out_dir.mkdir(parents=True, exist_ok=True)
            target = out_dir / source.name.removesuffix('.enc')
            decrypt_file(source, target, passphrase)
            print(f'Decrypted to {target}')
            return 0
        if not args.no_encrypt and not passphrase:
            if not sys.stdin.isatty():
                raise BackupError('Set BACKUP_PASSPHRASE (or pass --passphrase): the backup holds personal data and is encrypted by default.')
            passphrase = getpass.getpass('Choose a passphrase for this backup: ')
            if passphrase != getpass.getpass('Type it again: '):
                raise BackupError('The two passphrases are different.')
        if not args.no_encrypt and len(passphrase) < 12:
            raise BackupError('Use a passphrase of at least 12 characters.')
        env = load_env()
        print('Reading the database...')
        started = time.time()
        result = make_backup(env, out_dir, set() if args.include_all else DEFAULT_EXCLUDE, args.with_files, [b.strip() for b in args.buckets.split(',') if b.strip()])
        final = result['path']
        if not args.no_encrypt:
            encrypted = final.with_suffix('.zip.enc')
            encrypt_file(final, encrypted, passphrase)
            final.unlink()
            final = encrypted
        rows = sum(table['rows'] for table in result['manifest']['tables'].values())
        status = {'ok': True, 'at': datetime.now(timezone.utc).isoformat(), 'file': final.name, 'bytes': final.stat().st_size, 'tables': len(result['manifest']['tables']), 'rows': rows,
                  'files': sum(result['manifest']['files'].values()), 'encrypted': not args.no_encrypt, 'kind': 'portable', 'where': 'local file or CI artifact', 'seconds': round(time.time() - started)}
        if not args.no_record:
            try:
                record_status(env, status)
            except BackupError as error:
                print(f'Backup saved, but the admin console was not told: {error}')
        print(f'Done: {final} ({status["bytes"] / 1024 / 1024:.1f} MB, {status["tables"]} tables, {rows} rows).')
        return 0
    except BackupError as error:
        print(f'Backup failed: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
