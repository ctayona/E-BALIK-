"""Publication review is independent of custody, claims and resolution status."""
import logging
import os
from uuid import UUID

MIGRATION = '20261125_scan_privacy_and_report_review'
logger = logging.getLogger(__name__)


def installed(client):
    try:
        rows = client.table('migration_log').select('name').eq('name', MIGRATION).limit(1).execute().data
        return isinstance(rows, list) and any(row.get('name') == MIGRATION for row in rows)
    except Exception:
        # A database outage must never make unreviewed content public.
        raise RuntimeError('Report review setup unavailable') from None


def public_query(client, query):
    return query.eq('publication_state', 'approved').is_('archived_at', 'null') if installed(client) else query


class _PublicTable:
    def __init__(self, client, name):
        self.client, self.name = client, name

    def select(self, *args, **kwargs):
        return public_query(self.client, self.client.table(self.name).select(*args, **kwargs))


def public_table(client, name):
    return _PublicTable(client, name)


def is_published(client, row):
    return not installed(client) or (row.get('publication_state') == 'approved' and not row.get('archived_at'))


def submission(client):
    if installed(client):
        return {'publication_state': 'pending'}
    if os.getenv('REPORT_REVIEW_ENABLED', '').lower() == 'true':
        raise RuntimeError('Apply the report review migration before accepting new reports')
    return {}


def review_columns(client):
    return ',publication_state' if installed(client) else ''


def list_reports(db, kind, state, category, query, offset):
    if not installed(db.client):
        return dict(available=False, reports=[], has_more=False)
    if kind not in ('all', 'found', 'missing') or state not in ('pending', 'approved', 'rejected'):
        raise ValueError('Choose a valid report type and review state')
    rows = []
    for name in ('found', 'missing') if kind == 'all' else (kind,):
        table = 'found_items' if name == 'found' else 'missing_items'
        request = db.client.table(table).select('*').eq('publication_state', state).is_('archived_at', 'null')
        if category:
            request = request.eq('category', category)
        # Merge a bounded page from each source, then paginate the combined chronological stream.
        if query:
            request = request.ilike('item_name', '%' + query.replace('%', '').replace('_', '') + '%')
        part = request.order('created_at', desc=True).order('item_id',desc=True).limit(offset + 51).execute().data or []
        for row in part:
            rows.append(dict(kind=name, item_id=row['item_id'], reference=row.get('fpost_id') or row.get('mpost_id'),
                item_name=row.get('item_name'), category=row.get('category'), description=row.get('description'),
                location=row.get('location') or row.get('last_location'), image_url=row.get('image_url'),
                created_at=row.get('created_at'), state=row.get('publication_state'), version=row.get('publication_version'),
                custody_status=row.get('custody_status'), reporter=row.get('reporter_name') or 'Account holder'))
    rows.sort(key=lambda row: (row['created_at'] or '', row['item_id']), reverse=True)
    return dict(available=True, reports=rows[offset:offset+50], has_more=len(rows)>offset+50)


def review(db, actor, kind, item_id, body):
    if not installed(db.client):
        raise ValueError('Apply the report review migration first')
    if kind not in ('found', 'missing') or not isinstance(body, dict):
        raise ValueError('Invalid report review')
    state, note, version = body.get('state'), body.get('note', ''), body.get('version')
    if state not in ('approved','rejected') or not isinstance(note, str) or len(note)>300 or type(version) is not int or version<1:
        raise ValueError('Choose an approval or rejection and the current report version')
    if state == 'rejected' and len(note.strip()) < 5:
        raise ValueError('Explain why this report needs changes')
    item_id, request_id = str(UUID(str(item_id))), str(UUID(str(body.get('request_id'))))
    result = db.client.rpc('report_publication_review',dict(p_actor=actor['account_id'],p_request=request_id,
        p_kind=kind,p_item=item_id,p_version=version,p_state=state,p_note=note.strip())).execute().data
    if result and not result.get('replayed'):
        table = 'found_items' if kind=='found' else 'missing_items'
        rows = db.client.table(table).select('*').eq('item_id',item_id).limit(1).execute().data or []
        if rows:
            row = rows[0]
            try:
                db.log_user_activity(account_id=actor['account_id'],user_name=actor.get('email') or 'Admin',
                    action='Approve report publication' if state=='approved' else 'Reject report publication',
                    module='Reports',target_name=row.get('fpost_id') or row.get('mpost_id'),target_id=item_id,result='success')
            except Exception:
                logger.warning('Report review saved; general activity notice unavailable')
            try:
                db.create_user_notification(row.get('reporter_account_id') or row['account_id'],
                    'Report approved' if state=='approved' else 'Report needs changes',
                    f"{row.get('fpost_id') or row.get('mpost_id')}: Your report was approved and is now posted." if state=='approved' else f"{row.get('fpost_id') or row.get('mpost_id')}: {note.strip()}",
                    found_item_id=item_id if kind=='found' else None,missing_report_id=item_id if kind=='missing' else None,
                    notification_type='report_approval' if state=='approved' else 'report_rejection',link_label='View my report',link_page='my-reports')
                if state=='approved':
                    from . import match_alerts
                    (match_alerts.alert_for_new_found_item if kind=='found' else match_alerts.alert_for_new_missing_report)(db,row)
            except Exception:
                logger.warning('Report review saved; follow-up notice unavailable')
    return result
