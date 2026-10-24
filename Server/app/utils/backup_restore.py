"""Restore a portable E-Balik backup (made by Server/scripts/backup_database.py) from the admin console.

Built to be hard to misuse. Only a super administrator can reach it (the routes add: an authenticator code, a typed phrase, maintenance
mode on, rate limits and an audit entry), and this module adds the rules about the file and the data:
  * only ENCRYPTED backups are accepted (header `EBBK1`); a wrong passphrase, a changed byte or a cut-off file is refused;
  * the manifest must be E-Balik's and every table file must match its recorded SHA-256, so a half-edited backup is refused;
  * rows are MERGED by primary key (insert or overwrite). Nothing is ever deleted, so a restore cannot remove newer records;
  * PROTECTED tables (authenticator secrets, recovery codes, one-time codes) can never be restored here, at all;
  * SENSITIVE tables (accounts and roles, system settings) are off by default and need their own extra confirmation;
  * photos are not restored here (use Server/scripts/restore_database.py --with-files).
The decrypted copy lives in a private temp folder that is deleted when the restore ends, whatever the outcome.
"""
import hashlib
import importlib.util
import json
import logging
import shutil
import threading
import urllib.parse
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts' / 'backup_database.py'
MAX_UPLOAD_BYTES = 80 * 1024 * 1024
MAX_UNPACKED_BYTES = 400 * 1024 * 1024
BATCH = 200
PASSES = 3
PROTECTED = frozenset({'admin_mfa', 'admin_mfa_challenges', 'admin_mfa_recovery_codes', 'otp_tokens'})
SENSITIVE = frozenset({'user_profiles', 'system_settings'})
FIRST = ['user_profiles', 'system_settings', 'migration_log', 'found_items', 'missing_items', 'auctions', 'smart_tags', 'claims']
SENSITIVE_PHRASE = 'RESTORE ACCOUNTS AND SETTINGS'
# Tables the database itself refuses to change (migration 20261026): a restore only adds the entries that are missing and skips the rest.
APPEND_ONLY = frozenset({'income_ledger'})

_tool: Dict[str, Any] = {}


class RestoreError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message, self.status = message, status


def _script():
    """The backup script's own decrypt code, so the format has exactly one implementation."""
    if 'module' not in _tool:
        spec = importlib.util.spec_from_file_location('ebalik_backup_script', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _tool['module'] = module
    return _tool['module']


def kind_of(table: str) -> str:
    return 'protected' if table in PROTECTED else 'sensitive' if table in SENSITIVE else 'normal'


def ordered(tables: List[str]) -> List[str]:
    return [t for t in FIRST if t in tables] + sorted(t for t in tables if t not in FIRST)


def project_name(supabase_url: str) -> str:
    return (urllib.parse.urlparse(supabase_url or '').hostname or '').split('.')[0]


def confirm_phrase(supabase_url: str) -> str:
    """The phrase the admin must type: it names the project, so a restore cannot be started on the wrong one by habit."""
    return f'RESTORE {project_name(supabase_url)}'


# ---------------------------------------------------------------------------------------------- the file
def save_upload(storage, workdir: Path) -> Path:
    """Stream an uploaded file to the private folder, refusing anything over the size limit."""
    target = workdir / 'upload.bin'
    size = 0
    with target.open('wb') as out:
        while True:
            chunk = storage.stream.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                raise RestoreError(f'That file is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB. Use Server/scripts/restore_database.py on a computer for large backups.', 413)
            out.write(chunk)
    if size == 0:
        raise RestoreError('Choose a backup file first.')
    return target


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as reader:
        for chunk in iter(lambda: reader.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def open_backup(path: Path, passphrase: str, workdir: Path):
    """Decrypt and verify a backup. Returns (open ZipFile, manifest). Every failure is a RestoreError with a plain message."""
    tool = _script()
    with path.open('rb') as reader:
        if reader.read(len(tool.MAGIC)) != tool.MAGIC:
            raise RestoreError('This is not an encrypted E-Balik backup. Choose the .zip.enc file; plain zip files are not accepted here.')
    if not passphrase:
        raise RestoreError('Enter the backup passphrase.')
    plain = workdir / 'backup.zip'
    try:
        tool.decrypt_file(path, plain, passphrase)
    except tool.BackupError as error:
        raise RestoreError(str(error)) from error
    try:
        archive = zipfile.ZipFile(plain)
        manifest = json.loads(archive.read('manifest.json'))
    except Exception as error:
        raise RestoreError('The backup opened but is not a valid E-Balik backup.') from error
    try:
        if manifest.get('app') != 'E-Balik' or manifest.get('format') != 1 or not isinstance(manifest.get('tables'), dict):
            raise RestoreError('This file is not an E-Balik backup of a supported version.')
        if sum(info.file_size for info in archive.infolist()) > MAX_UNPACKED_BYTES:
            raise RestoreError('This backup is too large to restore from the admin console. Use Server/scripts/restore_database.py.')
        for table, entry in manifest['tables'].items():
            name = f'tables/{table}.jsonl'
            if name not in archive.namelist():
                raise RestoreError(f'The backup is incomplete: {table} is missing.')
            digest = hashlib.sha256()
            with archive.open(name) as part:
                for chunk in iter(lambda: part.read(1024 * 1024), b''):
                    digest.update(chunk)
            if digest.hexdigest() != entry.get('sha256'):
                raise RestoreError(f'The backup was changed or damaged: {table} does not match its checksum. Nothing was restored.')
    except Exception:
        archive.close()
        raise
    return archive, manifest


# ---------------------------------------------------------------------------------------------- what would change
def live_rows(db, table: str) -> Optional[int]:
    """How many rows the live table has now, or None when the table does not exist in this database."""
    try:
        return int(db.client.table(table).select('*', count='exact').limit(1).execute().count or 0)
    except Exception:
        return None


def preview(db, manifest: Dict[str, Any], sha256: str, supabase_url: str) -> Dict[str, Any]:
    created = manifest.get('created_at')
    try:
        age_days = max(0, (datetime.now(timezone.utc) - datetime.fromisoformat(str(created).replace('Z', '+00:00'))).days)
    except Exception:
        age_days = None
    tables = []
    for name in ordered(list(manifest['tables'])):
        kind = kind_of(name)
        current = live_rows(db, name)
        restorable = kind != 'protected' and current is not None
        note = ('Never restored here: it holds sign-in secrets.' if kind == 'protected'
                else 'This table does not exist in this database yet. Run the SQL migrations first.' if current is None
                else 'Accounts, roles and settings. Restoring can undo recent role or access changes.' if kind == 'sensitive'
                else 'Money records are never changed: only entries that are missing from the database are added.' if name in APPEND_ONLY else '')
        tables.append({'name': name, 'rows': int(manifest['tables'][name].get('rows') or 0), 'current': current, 'kind': kind, 'restorable': restorable, 'note': note})
    return {
        'created_at': created, 'age_days': age_days, 'project': manifest.get('project'), 'same_project': manifest.get('project') == project_name(supabase_url),
        'includes_photos': bool(manifest.get('files')), 'file_sha256': sha256, 'tables': tables,
        'total_rows': sum(t['rows'] for t in tables if t['restorable']),
    }


def validate_selection(manifest: Dict[str, Any], requested: Any, sensitive_phrase: str) -> List[str]:
    """The chosen tables, in a safe order. Refuses unknown or protected tables, and sensitive ones without their own phrase."""
    if not isinstance(requested, list) or not requested or not all(isinstance(t, str) for t in requested):
        raise RestoreError('Choose at least one table to restore.')
    chosen = []
    for table in dict.fromkeys(requested):
        if table not in manifest['tables']:
            raise RestoreError(f'{table} is not in this backup.')
        if table in PROTECTED:
            raise RestoreError(f'{table} holds sign-in secrets and can never be restored from the admin console.')
        chosen.append(table)
    if any(t in SENSITIVE for t in chosen) and (sensitive_phrase or '').strip() != SENSITIVE_PHRASE:
        raise RestoreError(f'Restoring accounts or settings needs the extra phrase: {SENSITIVE_PHRASE}')
    return ordered(chosen)


# ---------------------------------------------------------------------------------------------- doing it
def apply(db, archive: zipfile.ZipFile, tables: List[str], progress: Callable[..., None]) -> Dict[str, Any]:
    """Merge the chosen tables into the live database, parents first, retrying tables that wait on their parent rows."""
    done: Dict[str, int] = {}
    errors: Dict[str, str] = {}
    pending = list(tables)

    def save(table: str, batch: List[Dict[str, Any]]) -> None:
        if table in APPEND_ONLY:
            db.client.table(table).upsert(batch, ignore_duplicates=True).execute()     # ON CONFLICT DO NOTHING: existing money records stay exactly as they are
        else:
            db.client.table(table).upsert(batch).execute()

    for attempt in range(PASSES):
        retry = []
        for table in pending:
            progress(current=table)
            try:
                count = 0
                with archive.open(f'tables/{table}.jsonl') as part:
                    batch: List[Dict[str, Any]] = []
                    for line in part:
                        if line.strip():
                            batch.append(json.loads(line))
                        if len(batch) >= BATCH:
                            save(table, batch)
                            count += len(batch)
                            batch = []
                    if batch:
                        save(table, batch)
                        count += len(batch)
                done[table] = count
                errors.pop(table, None)
                progress(done_table=table, rows=count)
            except Exception as error:
                retry.append(table)
                errors[table] = str(error)[:160]
        pending = retry
        if not pending:
            break
    return {'restored': done, 'failed': {t: errors.get(t, 'failed') for t in pending}}


# One job at a time. The server runs a single worker process, so memory is shared by every request; the result is also saved to system_settings.
_job: Dict[str, Any] = {}
_lock = threading.Lock()


def is_running() -> bool:
    return _job.get('state') == 'running'


def status() -> Dict[str, Any]:
    return dict(_job)


def start(db, archive: zipfile.ZipFile, workdir: Path, tables: List[str], by: str, save: Callable[[Dict[str, Any]], None]) -> Dict[str, Any]:
    """Start the restore in the background. The temp folder is deleted when it ends. Raises RestoreError if one is already running."""
    with _lock:
        if is_running():
            raise RestoreError('A restore is already running.', 409)
        _job.clear()
        _job.update(state='running', started_at=datetime.now(timezone.utc).isoformat(), by=by, total_tables=len(tables), done_tables=[], rows=0, current='', failed={}, error='')

    def progress(current: Optional[str] = None, done_table: Optional[str] = None, rows: int = 0):
        if current:
            _job['current'] = current
        if done_table:
            _job['done_tables'] = _job['done_tables'] + [done_table]
            _job['rows'] += rows

    def run():
        # The job stays "running" until EVERYTHING has finished (temp files removed, result saved and logged), and the final state is
        # published last. Otherwise a status read, or the next restore, could see "done" while the cleanup was still going on.
        final: Dict[str, Any] = {}
        try:
            outcome = apply(db, archive, tables, progress)
            final = {'failed': outcome['failed'], 'state': 'done' if not outcome['failed'] else 'partial'}
        except Exception as error:
            logger.exception('Restore failed: %s', error)
            final = {'state': 'failed', 'error': str(error)[:200]}
        finally:
            try:
                archive.close()
            finally:
                shutil.rmtree(workdir, ignore_errors=True)
            final = {**final, 'finished_at': datetime.now(timezone.utc).isoformat(), 'current': ''}
            try:
                save({**_job, **final})
            except Exception as error:
                logger.warning('Could not save the restore result: %s', error)
            _job.update(final)

    threading.Thread(target=run, name='ebalik-restore', daemon=True).start()
    return dict(_job)
