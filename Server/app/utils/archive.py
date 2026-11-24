"""Admin archive views preserve record status, photos, relationships and custody.

Reports can be archived during custody. Claims and auctions retain their completion
rules. Account and tag archival requires deactivation. Administrative deletion
requires prior archival and uses the existing recovery and authorization commands.
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.utils.report_lifecycle import COMPLETED_FOUND, COMPLETED_MISSING

logger = logging.getLogger(__name__)

CLAIM_FINISHED = frozenset({'collected', 'rejected'})

# kind -> (table, column that identifies the record in the admin UI, statuses that count as finished, what to call it)
KINDS: Dict[str, Dict[str, Any]] = {
    'lost': {'table': 'missing_items', 'key': 'mpost_id', 'finished': COMPLETED_MISSING, 'label': 'lost report'},
    'found': {'table': 'found_items', 'key': 'fpost_id', 'finished': COMPLETED_FOUND, 'label': 'found report'},
    'claim': {'table': 'claims', 'key': 'claim_id', 'finished': CLAIM_FINISHED, 'label': 'claim'},
    'user': {'table': 'user_profiles', 'key': 'account_id', 'label': 'account'},
    'tag': {'table': 'smart_tags', 'key': 'tag_id', 'label': 'Smart Tag'},
}
SETUP_MESSAGE = 'Archiving needs the latest database update. Run Server/manual_migrations/20261016_archive_and_bid_steps.sql in Supabase, then try again.'


class ArchiveError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = 'archive_error'):
        super().__init__(message)
        self.message, self.status, self.code = message, status, code


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _missing_column(error: Exception) -> bool:
    return 'archived_at' in str(error) or 'archived_by' in str(error)


def archived_keys(client, table: str, key: str) -> set:
    """Identifiers of the archived rows of a table. Empty (nothing is archived) before the migration."""
    try:
        rows = []
        for offset in range(0, 5000, 1000):
            page = client.table(table).select(f'{key},archived_at').not_.is_('archived_at', 'null').order(key).range(offset, offset + 999).execute().data or []
            rows.extend(page)
            if len(page) < 1000:
                break
    except Exception as error:
        if not _missing_column(error):
            logger.warning('Archived list for %s unavailable: %s', table, error)
        return set()
    return {str(row.get(key)) for row in rows}


def flag_archived(client, rows, table: str, key: str, row_key: str = 'id') -> None:
    """Add `archived: bool` to each admin row."""
    archived = archived_keys(client, table, key)
    for row in rows:
        row['archived'] = str(row.get(row_key)) in archived


def set_archived(client, kind: str, reference: str, admin_id: str, archived: bool) -> Dict[str, Any]:
    spec = KINDS.get(kind)
    if not spec:
        raise ArchiveError('Unknown record type.', 400, 'unknown_kind')
    reference = str(reference or '').strip()
    if not reference:
        raise ArchiveError('Choose the record to archive.', 400, 'missing_reference')
    try:
        fields = 'is_active,suspended_until' if kind == 'user' else 'status,is_disabled' if kind == 'tag' else 'status'
        rows = client.table(spec['table']).select(f"{spec['key']},{fields},archived_at").eq(spec['key'], reference).limit(1).execute().data or []
    except Exception as error:
        if _missing_column(error):
            if kind in ('user', 'tag'):
                raise ArchiveError('Run 20261124c_admin_archive_first.sql to enable account and tag archives.', 503, 'setup_required') from None
            raise ArchiveError(SETUP_MESSAGE, 503, 'setup_required')
        if 'invalid input syntax' in str(error):   # a claim id that is not a UUID
            raise ArchiveError(f"That {spec['label']} was not found.", 404, 'not_found')
        raise
    if not rows:
        raise ArchiveError(f"That {spec['label']} was not found.", 404, 'not_found')
    row = rows[0]
    if archived:
        if row.get('archived_at'):
            raise ArchiveError(f"This {spec['label']} is already archived.", 409, 'already_archived')
        if kind == 'user' and row.get('is_active') is not False:
            raise ArchiveError('Deactivate the account before archiving it.', 409)
        if kind == 'user' and row.get('suspended_until'):
            raise ArchiveError('Use an indefinite suspension before archiving an account.', 409)
        if kind == 'tag' and row.get('status') != 'blank' and row.get('is_disabled') is not True:
            raise ArchiveError('Deactivate this registered tag before archiving it.', 409)
        if kind == 'claim' and str(row.get('status') or '').strip().lower() not in spec['finished']:
            raise ArchiveError(f"Only finished {spec['label']}s can be archived. Complete or close it first.", 409, 'not_finished')
    elif not row.get('archived_at'):
        raise ArchiveError(f"This {spec['label']} is not archived.", 409, 'not_archived')
    update = {'archived_at': _now_iso() if archived else None, 'archived_by': admin_id if archived else None}
    try:
        client.table(spec['table']).update(update).eq(spec['key'], reference).execute()
    except Exception as error:
        if _missing_column(error):
            raise ArchiveError(SETUP_MESSAGE, 503, 'setup_required')
        raise
    return {'kind': kind, 'reference': reference, 'archived': archived}


def require_archived(client, kind, reference):
    """Reject working-list deletion before any recycle-bin/storage mutation."""
    spec = KINDS.get(kind)
    if kind == 'auction':
        spec = {'table': 'auctions', 'key': 'auction_id'}
    try:
        rows = client.table(spec['table']).select('archived_at').eq(spec['key'], reference).limit(1).execute().data or []
    except Exception as error:
        if _missing_column(error):
            raise ArchiveError('Apply the archive-first migration before deleting this record.', 503, 'setup_required') from None
        raise
    if not rows:
        raise ArchiveError('Record not found.', 404, 'not_found')
    if not rows[0].get('archived_at'):
        raise ArchiveError('Archive this record first. Delete is available from its Archived view.', 409, 'archive_required')
