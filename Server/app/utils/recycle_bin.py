"""Recycle bin: nothing an admin deletes is gone for good straight away.

Before a claim, found item, lost report, account or auction is deleted, `RecycleBin.archive` copies a JSON snapshot of the record and
of everything that is deleted with it (the database cascades), and copies its files into the private `recycle-bin` bucket. Only then
does the normal delete run. If the archive step fails, the delete does not happen.

A super admin can then:
  * restore it (rows and files go back; refused with a clear reason if something now conflicts);
  * delete it permanently (needs their authenticator code, see Admin/Backend/recycle_bin/routes.py);
  * or do nothing: it is purged automatically `RECYCLE_BIN_DAYS` (default 30) after deletion, so ID documents are never kept for ever.
The retention rule (housekeeping.py) archives old ID documents and proof photos here too instead of deleting them straight away.

A purged or restored entry keeps only a tombstone row (what, when, who); its snapshot and files are emptied.
Not restored: notifications, activity logs, authenticator secrets (never copied), and links that the database sets to NULL when a user
is deleted (Smart Tag ownership, auction winner or bidder links).
"""
import logging
import mimetypes
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

logger = logging.getLogger(__name__)

BUCKET = 'recycle-bin'
MAX_FILE_BYTES = 25 * 1024 * 1024
CHUNK = 100
LIST_LIMIT = 300

# How restoring works for each kind: `tables` are inserted in this order (the first is the root, which is checked for conflicts and
# deleted again if the restore fails halfway; its children cascade). `optional` tables are restored row by row and may be skipped.
# `checks` say what to do with a row whose parent no longer exists: fail the restore, skip the row, or clear the link.
SPECS: Dict[str, Dict[str, Any]] = {
    'claim': {
        'tables': [('claims', 'claim_id')], 'optional': [],
        'checks': [('claims', 'found_item_id', 'found_items', 'item_id', 'fail'), ('claims', 'claimant_account_id', 'user_profiles', 'account_id', 'fail'),
                   ('claims', 'missing_report_id', 'missing_items', 'item_id', 'null')],
    },
    'found_item': {
        'tables': [('found_items', 'item_id'), ('claims', 'claim_id')], 'optional': [('ai_matches', 'match_id'), ('custody_log', 'log_id')],
        'checks': [('found_items', 'account_id', 'user_profiles', 'account_id', 'fail'), ('claims', 'claimant_account_id', 'user_profiles', 'account_id', 'skip'),
                   ('found_items', 'handover_guard_id', 'user_profiles', 'account_id', 'null'), ('claims', 'missing_report_id', 'missing_items', 'item_id', 'null')],
    },
    'missing_item': {
        'tables': [('missing_items', 'item_id')], 'optional': [('ai_matches', 'match_id')],
        'checks': [('missing_items', 'account_id', 'user_profiles', 'account_id', 'fail')],
    },
    'user': {
        'tables': [('user_profiles', 'account_id'), ('found_items', 'item_id'), ('missing_items', 'item_id'), ('claims', 'claim_id')], 'optional': [('ai_matches', 'match_id'), ('custody_log', 'log_id')],
        'checks': [('claims', 'claimant_account_id', 'user_profiles', 'account_id', 'skip'), ('claims', 'missing_report_id', 'missing_items', 'item_id', 'null'),
                   ('found_items', 'handover_guard_id', 'user_profiles', 'account_id', 'null')],
    },
    'auction': {
        'tables': [('auctions', 'auction_id'), ('auction_bids', 'bid_id'), ('auction_comments', 'comment_id'), ('auction_reactions', None)], 'optional': [],
        'checks': [('auctions', 'found_item_id', 'found_items', 'item_id', 'null'), ('auction_bids', 'bidder_account_id', 'user_profiles', 'account_id', 'null'),
                   ('auction_comments', 'account_id', 'user_profiles', 'account_id', 'skip'), ('auction_reactions', 'account_id', 'user_profiles', 'account_id', 'skip')],
    },
}
EVIDENCE_KEYS = {'claims': 'claim_id', 'user_profiles': 'account_id'}


class BinError(Exception):
    """A rule failure with the HTTP status the route should return."""

    def __init__(self, message: str, status: int = 400, code: str = 'bin_error'):
        super().__init__(message)
        self.message, self.status, self.code = message, status, code


class BinUnavailable(BinError):
    def __init__(self):
        super().__init__('The recycle bin is not set up yet, so nothing was deleted. Run migration 20261014_recycle_bin.sql, then try again.', 503, 'setup_required')


def retention_days() -> int:
    try:
        value = int(float(os.getenv('RECYCLE_BIN_DAYS') or 30))
    except ValueError:
        value = 30
    return max(1, min(value, 365))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _missing_table(error: Exception) -> bool:
    text = str(error).lower()
    return 'recycle_bin' in text and ('does not exist' in text or 'schema cache' in text or '42p01' in text or 'pgrst205' in text)


def _missing_file(error: Exception) -> bool:
    text = str(error).lower()
    return 'not found' in text or '404' in text or 'does not exist' in text


def _chunks(values: List[Any]) -> Iterable[List[Any]]:
    for start in range(0, len(values), CHUNK):
        yield values[start:start + CHUNK]


def _name(profile: Dict[str, Any]) -> str:
    return f"{profile.get('fname') or ''} {profile.get('lname') or ''}".strip() or profile.get('email') or 'account'


class Capture:
    """What is about to be deleted: the rows, the files and a label."""

    def __init__(self, entity_type: str, entity_id: str, label: str, snapshot: Dict[str, List[Dict[str, Any]]], files: List[Tuple[str, str]]):
        self.entity_type, self.entity_id, self.label = entity_type, entity_id, label
        self.snapshot = {table: rows for table, rows in snapshot.items() if rows}
        seen, unique = set(), []
        for bucket, path in files:
            if bucket and path and (bucket, path) not in seen:
                seen.add((bucket, path))
                unique.append((bucket, path))
        self.files = unique

    @property
    def summary(self) -> Dict[str, int]:
        return {table: len(rows) for table, rows in self.snapshot.items()}


class RecycleBin:
    def __init__(self, db):
        self.db = db
        self.client = db.client

    # ---------------------------------------------------------------------------------------------- reading what will be deleted
    def _rows(self, table: str, column: str, value: Any, limit: int = 2000) -> List[Dict[str, Any]]:
        return self.client.table(table).select('*').eq(column, value).limit(limit).execute().data or []

    def _rows_in(self, table: str, column: str, values: List[Any]) -> List[Dict[str, Any]]:
        found: List[Dict[str, Any]] = []
        for chunk in _chunks([v for v in values if v]):
            found.extend(self.client.table(table).select('*').in_(column, chunk).execute().data or [])
        return found

    def _log_rows(self, item_ids: List[Any]) -> List[Dict[str, Any]]:
        """The handover log of these items. Empty when migration 20261017 has not been run."""
        try:
            return self._rows_in('custody_log', 'found_item_id', item_ids)
        except Exception:
            return []

    def _claim_files(self, claim: Dict[str, Any]) -> List[Tuple[str, str]]:
        decrypted = self.db._decrypt_claim_sensitive_fields(dict(claim)) or claim
        proof = claim.get('proof_image_path') or self.db._legacy_claim_storage_path(decrypted.get('proof_image_url'), 'claim-proof-images') \
            or self.db._account_storage_path('claim-proof-images', claim.get('proof_image_url'))
        identity = self.db._account_storage_path('claim-id-documents', claim.get('identity_document_path'), allow_raw_path=True)
        return [('claim-proof-images', proof), ('claim-id-documents', identity)]

    def _item_file(self, bucket: str, row: Dict[str, Any]) -> List[Tuple[str, str]]:
        return [(bucket, self.db._account_storage_path(bucket, row.get('image_url')))]

    def capture(self, entity_type: str, reference: str) -> Capture:
        """Read the record and everything the database deletes with it. Raises BinError(404) when it does not exist."""
        builder = getattr(self, f'_capture_{entity_type}', None)
        if not builder:
            raise BinError('That kind of record cannot be archived.', 400)
        return builder(str(reference))

    def _capture_claim(self, claim_id: str) -> Capture:
        rows = self._rows('claims', 'claim_id', claim_id, 1)
        if not rows:
            raise BinError('Claim not found.', 404)
        claim = rows[0]
        item = (self._rows('found_items', 'item_id', claim.get('found_item_id'), 1) or [{}])[0] if claim.get('found_item_id') else {}
        label = f"Claim {claim.get('claim_reference') or claim_id}" + (f" for {item.get('item_name')}" if item.get('item_name') else '')
        return Capture('claim', claim_id, label, {'claims': rows}, self._claim_files(claim))

    def _capture_found_item(self, reference: str) -> Capture:
        rows = self._rows('found_items', 'fpost_id', reference, 1)
        if not rows:
            raise BinError('Found item not found.', 404)
        item = rows[0]
        claims = self._rows('claims', 'found_item_id', item['item_id'])
        matches = self._rows('ai_matches', 'found_item_id', item['item_id'])
        files = self._item_file('found-item-images', item)
        for claim in claims:
            files += self._claim_files(claim)
        return Capture('found_item', reference, f"Found item {reference}: {item.get('item_name') or 'item'}",
                       {'found_items': rows, 'claims': claims, 'ai_matches': matches, 'custody_log': self._log_rows([item['item_id']])}, files)

    def _capture_missing_item(self, reference: str) -> Capture:
        rows = self._rows('missing_items', 'mpost_id', reference, 1)
        if not rows:
            raise BinError('Lost report not found.', 404)
        item = rows[0]
        matches = self._rows('ai_matches', 'missing_item_id', item['item_id'])
        return Capture('missing_item', reference, f"Lost report {reference}: {item.get('item_name') or 'item'}",
                       {'missing_items': rows, 'ai_matches': matches}, self._item_file('missing-item-images', item))

    def _capture_user(self, account_id: str) -> Capture:
        rows = self._rows('user_profiles', 'account_id', account_id, 1)
        if not rows:
            raise BinError('Account not found.', 404)
        profile = rows[0]
        found = self._rows('found_items', 'account_id', account_id)
        missing = self._rows('missing_items', 'account_id', account_id)
        claims: Dict[str, Dict[str, Any]] = {str(c['claim_id']): c for c in self._rows('claims', 'claimant_account_id', account_id)}
        for claim in self._rows_in('claims', 'found_item_id', [f['item_id'] for f in found]):
            claims[str(claim['claim_id'])] = claim
        matches: Dict[str, Dict[str, Any]] = {}
        for match in self._rows_in('ai_matches', 'found_item_id', [f['item_id'] for f in found]) + self._rows_in('ai_matches', 'missing_item_id', [m['item_id'] for m in missing]):
            matches[str(match['match_id'])] = match
        decrypted = self.db._decrypt_profile_sensitive_fields(dict(profile)) or profile
        files = [(profile.get('verification_document_bucket'), self.db._account_storage_path(str(profile.get('verification_document_bucket') or ''), decrypted.get('verification_document_url'), allow_raw_path=True))]
        for row in found:
            files += self._item_file('found-item-images', row)
        for row in missing:
            files += self._item_file('missing-item-images', row)
        for claim in claims.values():
            files += self._claim_files(claim)
        return Capture('user', account_id, f"Account {_name(profile)} ({profile.get('email') or 'no email'})",
                       {'user_profiles': rows, 'found_items': found, 'missing_items': missing, 'claims': list(claims.values()), 'ai_matches': list(matches.values()),
                        'custody_log': self._log_rows([f['item_id'] for f in found])}, files)

    def _capture_auction(self, auction_id: str) -> Capture:
        rows = self._rows('auctions', 'auction_id', auction_id, 1)
        if not rows:
            raise BinError('Auction not found.', 404)
        auction = rows[0]
        return Capture('auction', auction_id, f"Auction {auction.get('item_reference') or auction.get('title') or auction_id}",
                       {'auctions': rows, 'auction_bids': self._rows('auction_bids', 'auction_id', auction_id), 'auction_comments': self._rows('auction_comments', 'auction_id', auction_id),
                        'auction_reactions': self._rows('auction_reactions', 'auction_id', auction_id)}, [])

    # ---------------------------------------------------------------------------------------------- archiving
    def _copy_in(self, archive_id: str, index: int, bucket: str, path: str) -> Optional[Dict[str, Any]]:
        """Copy one file into the bin. None when the original is already gone; BinError when it cannot be copied."""
        try:
            data = self.client.storage.from_(bucket).download(path)
        except Exception as error:
            if _missing_file(error):
                return None
            raise BinError(f'A file could not be copied to the recycle bin ({bucket}), so nothing was deleted. Try again.', 502)
        if not data:
            return None
        if len(data) > MAX_FILE_BYTES:
            raise BinError('A file is too large for the recycle bin, so nothing was deleted.', 413)
        target = f'{archive_id}/{index:03d}'
        try:
            self.client.storage.from_(BUCKET).upload(target, data, {'content-type': mimetypes.guess_type(path)[0] or 'application/octet-stream', 'upsert': 'true'})
        except Exception as error:
            if 'bucket' in str(error).lower() and 'not found' in str(error).lower():
                raise BinUnavailable()
            raise BinError('A file could not be copied to the recycle bin, so nothing was deleted. Try again.', 502)
        return {'bucket': bucket, 'path': path, 'archive_path': target, 'bytes': len(data)}

    def _remove_bin_files(self, entries: List[Dict[str, Any]]) -> None:
        paths = [e['archive_path'] for e in entries if e.get('archive_path')]
        if paths:
            try:
                self.client.storage.from_(BUCKET).remove(paths)
            except Exception as error:
                logger.warning('Recycle bin files could not be removed: %s', error)

    def archive(self, capture: Capture, actor_id: Optional[str] = None, actor_label: str = '', reason: str = 'admin_delete') -> str:
        """Store the snapshot and copy the files. Returns the archive id. Raises BinError and leaves nothing behind on failure."""
        archive_id = str(uuid.uuid4())
        copied: List[Dict[str, Any]] = []
        try:
            for index, (bucket, path) in enumerate(capture.files):
                entry = self._copy_in(archive_id, index, bucket, path)
                if entry:
                    copied.append(entry)
            now = _now()
            self.client.table('recycle_bin').insert({
                'archive_id': archive_id, 'entity_type': capture.entity_type, 'entity_id': capture.entity_id, 'label': capture.label[:300], 'reason': reason,
                'snapshot': capture.snapshot, 'summary': capture.summary, 'files': copied, 'deleted_by': actor_id, 'deleted_by_label': actor_label[:200] or None,
                'deleted_at': _iso(now), 'expires_at': _iso(now + timedelta(days=retention_days())), 'status': 'archived',
            }).execute()
        except BinError:
            self._remove_bin_files(copied)
            raise
        except Exception as error:
            self._remove_bin_files(copied)
            if _missing_table(error):
                raise BinUnavailable()
            logger.exception('Recycle bin archive failed: %s', error)
            raise BinError('The record could not be archived, so nothing was deleted. Try again.', 500)
        return archive_id

    def archive_entity(self, entity_type: str, reference: str, actor_id: Optional[str] = None, actor_label: str = '') -> str:
        try:
            capture = self.capture(entity_type, reference)
        except BinError:
            raise
        except Exception as error:
            if _missing_table(error):
                raise BinUnavailable()
            logger.exception('Recycle bin capture failed: %s', error)
            raise BinError('The record could not be read for archiving, so nothing was deleted.', 500)
        return self.archive(capture, actor_id, actor_label)

    def discard(self, archive_id: str) -> None:
        """Undo an archive whose delete then failed, so the bin does not list something that still exists."""
        try:
            rows = self.client.table('recycle_bin').select('files').eq('archive_id', archive_id).limit(1).execute().data or []
            self._remove_bin_files((rows[0] if rows else {}).get('files') or [])
            self.client.table('recycle_bin').delete().eq('archive_id', archive_id).execute()
        except Exception as error:
            logger.warning('Recycle bin entry %s could not be discarded: %s', archive_id, error)

    def archive_evidence(self, kind: str, row: Dict[str, Any], files: List[Tuple[str, str]], label: str) -> str:
        """Retention rule: keep the ID document and proof photo here, instead of deleting them, for the bin period.

        `kind` is 'claims' or 'user_profiles'; `row` holds the primary key and the columns that point at the files (restored by an update).
        """
        key = EVIDENCE_KEYS[kind]
        capture = Capture('evidence', str(row[key]), label, {kind: [row]}, files)
        return self.archive(capture, None, 'Retention rule', reason='retention')

    # ---------------------------------------------------------------------------------------------- listing
    def list_items(self, entity_type: Optional[str] = None, search: str = '') -> List[Dict[str, Any]]:
        try:
            query = self.client.table('recycle_bin').select(
                'archive_id,entity_type,entity_id,label,reason,summary,files,deleted_by_label,deleted_at,expires_at,status'
            ).eq('status', 'archived')
            if entity_type:
                query = query.eq('entity_type', entity_type)
            rows = query.order('deleted_at', desc=True).limit(LIST_LIMIT).execute().data or []
        except Exception as error:
            if _missing_table(error):
                raise BinUnavailable()
            raise
        needle = ' '.join(str(search or '').lower().split())
        now = _now()
        items = []
        for row in rows:
            if needle and needle not in f"{row.get('label', '')} {row.get('entity_id', '')} {row.get('deleted_by_label', '')}".lower():
                continue
            expires = _parse(row.get('expires_at'))
            items.append({
                'archive_id': row['archive_id'], 'entity_type': row['entity_type'], 'entity_id': row.get('entity_id'), 'label': row.get('label'), 'reason': row.get('reason'),
                'summary': row.get('summary') or {}, 'file_count': len(row.get('files') or []), 'deleted_by': row.get('deleted_by_label') or 'System',
                'deleted_at': row.get('deleted_at'), 'expires_at': row.get('expires_at'),
                'days_left': max(0, -(-int((expires - now).total_seconds()) // 86400)) if expires else None,
            })
        return items

    def _get_archived(self, archive_id: str) -> Dict[str, Any]:
        try:
            uuid.UUID(str(archive_id))
        except ValueError:
            raise BinError('That recycle bin entry was not found.', 404)
        try:
            rows = self.client.table('recycle_bin').select('*').eq('archive_id', archive_id).limit(1).execute().data or []
        except Exception as error:
            if _missing_table(error):
                raise BinUnavailable()
            raise
        if not rows:
            raise BinError('That recycle bin entry was not found.', 404)
        if rows[0].get('status') != 'archived':
            raise BinError(f"That entry was already {rows[0].get('status')}.", 409)
        return rows[0]

    def _finish(self, archive_id: str, status: str, actor_id: Optional[str]) -> None:
        self.client.table('recycle_bin').update({
            'status': status, 'snapshot': {}, 'files': [], 'finished_at': _iso(_now()), 'finished_by': actor_id,
        }).eq('archive_id', archive_id).eq('status', 'archived').execute()

    # ---------------------------------------------------------------------------------------------- purging
    def purge(self, archive_id: str, actor_id: Optional[str] = None) -> Dict[str, Any]:
        row = self._get_archived(archive_id)
        self._remove_bin_files(row.get('files') or [])
        self._finish(archive_id, 'purged', actor_id)
        return {'archive_id': archive_id, 'label': row.get('label'), 'entity_type': row.get('entity_type')}

    def purge_expired(self, now: Optional[datetime] = None, limit: int = 50) -> Dict[str, int]:
        summary = {'purged': 0, 'errors': 0}
        try:
            rows = self.client.table('recycle_bin').select('archive_id').eq('status', 'archived').lte('expires_at', _iso(now or _now())).limit(limit).execute().data or []
        except Exception as error:
            logger.warning('Recycle bin expiry check skipped: %s', error)
            summary['errors'] += 1
            return summary
        for row in rows:
            try:
                self.purge(row['archive_id'], None)
                summary['purged'] += 1
            except Exception as error:
                summary['errors'] += 1
                logger.warning('Recycle bin entry %s could not be purged: %s', row.get('archive_id'), error)
        return summary

    # ---------------------------------------------------------------------------------------------- restoring
    def _restore_files(self, entries: List[Dict[str, Any]]) -> List[Tuple[str, str]]:
        """Copy the files back to where they were. Returns what was put back so a failed restore can undo it."""
        restored: List[Tuple[str, str]] = []
        try:
            for entry in entries:
                try:
                    self.client.storage.from_(entry['bucket']).download(entry['path'])
                    continue   # a file is already there: never overwrite it, and never remove it if this restore has to be undone
                except Exception:
                    pass
                data = self.client.storage.from_(BUCKET).download(entry['archive_path'])
                self.client.storage.from_(entry['bucket']).upload(entry['path'], data, {'content-type': mimetypes.guess_type(entry['path'])[0] or 'application/octet-stream', 'upsert': 'false'})
                restored.append((entry['bucket'], entry['path']))
        except Exception as error:
            self._undo_files(restored)
            logger.warning('Restoring files failed: %s', error)
            raise BinError('The files could not be restored, so nothing was changed. Try again.', 502)
        return restored

    def _undo_files(self, restored: List[Tuple[str, str]]) -> None:
        for bucket, path in restored:
            try:
                self.client.storage.from_(bucket).remove([path])
            except Exception as error:
                logger.warning('Could not undo restored file %s/%s: %s', bucket, path, error)

    def _existing(self, table: str, column: str, values: List[Any]) -> set:
        found = set()
        for chunk in _chunks(sorted({str(v) for v in values if v})):
            for row in self.client.table(table).select(column).in_(column, chunk).execute().data or []:
                found.add(str(row[column]))
        return found

    def restore(self, archive_id: str, actor_id: Optional[str] = None) -> Dict[str, Any]:
        row = self._get_archived(archive_id)
        if row['entity_type'] == 'evidence':
            return self._restore_evidence(row, actor_id)
        spec = SPECS.get(row['entity_type'])
        snapshot = {table: [dict(r) for r in rows] for table, rows in (row.get('snapshot') or {}).items()}
        if not spec or not snapshot:
            raise BinError('This entry has nothing left to restore.', 409)

        root_table, root_key = spec['tables'][0]
        root_rows = snapshot.get(root_table, [])
        if root_key and self._existing(root_table, root_key, [r.get(root_key) for r in root_rows]):
            raise BinError('This already exists again, so it cannot be restored over the top of it.', 409, 'already_exists')

        skipped = self._apply_checks(spec, snapshot)

        restored_files = self._restore_files(row.get('files') or [])
        inserted_root = False
        try:
            for table, _ in spec['tables']:
                if snapshot.get(table):
                    self.client.table(table).insert(snapshot[table]).execute()
                    inserted_root = inserted_root or table == root_table
            optional_restored = 0
            for table, _ in spec['optional']:
                for record in snapshot.get(table, []):
                    try:
                        self.client.table(table).insert(record).execute()
                        optional_restored += 1
                    except Exception:
                        pass   # derived data (suggested matches) whose other side is gone is simply dropped
        except Exception as error:
            if inserted_root and root_key:
                for record in root_rows:
                    try:
                        self.client.table(root_table).delete().eq(root_key, record[root_key]).execute()   # its children cascade
                    except Exception as cleanup:
                        logger.warning('Could not undo a partial restore of %s: %s', record.get(root_key), cleanup)
            self._undo_files(restored_files)
            logger.warning('Restore of %s failed: %s', archive_id, error)
            raise BinError('It could not be restored because something it depends on has changed or its reference is already in use.', 409, 'restore_conflict')

        self._remove_bin_files(row.get('files') or [])
        self._finish(archive_id, 'restored', actor_id)
        return {'archive_id': archive_id, 'label': row.get('label'), 'entity_type': row['entity_type'], 'skipped': skipped, 'restored': {t: len(r) for t, r in snapshot.items() if r}}

    def _apply_checks(self, spec: Dict[str, Any], snapshot: Dict[str, List[Dict[str, Any]]]) -> Dict[str, int]:
        """Look up every parent a restored row points at. Rows whose parent is gone are dropped, unlinked, or stop the restore."""
        skipped: Dict[str, int] = {}
        for table, column, parent_table, parent_key, action in spec['checks']:
            rows = snapshot.get(table, [])
            wanted = [r.get(column) for r in rows if r.get(column)]
            if not wanted:
                continue
            present = self._existing(parent_table, parent_key, wanted) | {str(r.get(parent_key)) for r in snapshot.get(parent_table, [])}
            missing = [r for r in rows if r.get(column) and str(r[column]) not in present]
            if not missing:
                continue
            if action == 'fail':
                raise BinError('It cannot be restored because the account or item it belongs to no longer exists. Restore that first.', 409, 'parent_missing')
            if action == 'skip':
                snapshot[table] = [r for r in rows if r not in missing]
                skipped[table] = skipped.get(table, 0) + len(missing)
            else:
                for record in missing:
                    record[column] = None
        return skipped

    def _restore_evidence(self, row: Dict[str, Any], actor_id: Optional[str]) -> Dict[str, Any]:
        snapshot = row.get('snapshot') or {}
        targets = [(table, key, record) for table, key in EVIDENCE_KEYS.items() for record in snapshot.get(table, [])]
        if not targets:
            raise BinError('This entry has nothing left to restore.', 409)
        for table, key, record in targets:
            if not self.client.table(table).select(key).eq(key, record[key]).limit(1).execute().data:
                raise BinError('The record these files belonged to no longer exists, so they cannot be attached again.', 409, 'parent_missing')
        restored_files = self._restore_files(row.get('files') or [])
        try:
            for table, key, record in targets:
                changes = {k: v for k, v in record.items() if k != key}
                if table == 'claims':
                    changes['evidence_purged_at'] = None
                self.client.table(table).update(changes).eq(key, record[key]).execute()
        except Exception as error:
            self._undo_files(restored_files)
            logger.warning('Evidence restore failed: %s', error)
            raise BinError('The files could not be attached again, so nothing was changed.', 409, 'restore_conflict')
        self._remove_bin_files(row.get('files') or [])
        self._finish(row['archive_id'], 'restored', actor_id)
        return {'archive_id': row['archive_id'], 'label': row.get('label'), 'entity_type': 'evidence', 'skipped': {}, 'restored': {t: len(r) for t, r in snapshot.items() if r}}
