"""Archive: tidy away finished records without deleting them.

Archiving hides a finished lost report, found report, claim or auction from the admin's working lists (it moves to the page's Archived
tab) and keeps every row, file and link. It is not the Recycle bin: nothing is removed, and restoring it from the Archived tab is one click.
Only finished records can be archived, so live work (an open report, an item in custody, a pending claim, a running auction) can never be
hidden by mistake. People's own pages are not affected: a completed report stays in the owner's Completed tab.

Migration 20261016 adds `archived_at` / `archived_by` to the four tables. Before it runs every call answers 503 `setup_required`.
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
        rows = client.table(table).select(f'{key},archived_at').not_.is_('archived_at', 'null').limit(5000).execute().data or []
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
        rows = client.table(spec['table']).select(f"{spec['key']},status,archived_at").eq(spec['key'], reference).limit(1).execute().data or []
    except Exception as error:
        if _missing_column(error):
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
        if str(row.get('status') or '').strip().lower() not in spec['finished']:
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
