"""Mission Control tools for super admins: communications hub, admin governance, audit export, storage cleanup and email test.

Everything here is called from `Admin/Backend/system_control/routes.py`, which already requires a super admin. The
functions only use the service-role client they are given, never user input as a column or table name.
"""
import csv
import io
import json
import logging
import re
import threading
import zipfile
from datetime import datetime, timedelta, timezone
from html import escape
from typing import Any, Callable, Dict, Iterable, List, Optional, Set
from urllib.parse import unquote

from app.utils.system_control import STAFF_LEVELS, access_level, forget_account

logger = logging.getLogger(__name__)

MAX_TITLE = 120
MAX_BODY = 1500
MAX_RECIPIENTS = 20000
MAX_EMAIL_RECIPIENTS = 2000
SEARCH_LIMIT = 8
EXPORT_ROW_CAP = 100000
ORPHAN_MIN_AGE_HOURS = 24
IMAGE_BUCKETS = ('found-item-images', 'missing-item-images', 'smart-tag-images', 'claim-proof-images')
ANNOUNCEMENT_TONES = ('info', 'success', 'warning', 'critical')
MAX_ANNOUNCEMENT = 400
_LIKE_UNSAFE = re.compile(r'[^\w@.\- ]', re.UNICODE)
_CONTROL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')


class ToolError(ValueError):
    """A problem the super admin can fix (bad input, unsafe request). Carries the HTTP status to answer with."""

    def __init__(self, message: str, status: int = 400, **extra: Any):
        super().__init__(message)
        self.message, self.status, self.extra = message, status, extra


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _text(value: Any, limit: int, multiline: bool = False) -> str:
    text = _CONTROL.sub('', str(value or '')).replace('<', '').replace('>', '')
    text = text.replace('\r\n', '\n') if multiline else re.sub(r'\s+', ' ', text)
    return text.strip()[:limit]


def _name(profile: Dict[str, Any]) -> str:
    return f"{profile.get('fname') or ''} {profile.get('lname') or ''}".strip() or 'User'


def _paged(query_factory: Callable[[], Any], page: int = 1000, cap: int = EXPORT_ROW_CAP) -> List[Dict[str, Any]]:
    """Read every row of a query (a fresh query per page, because builders are single use)."""
    rows: List[Dict[str, Any]] = []
    while len(rows) < cap:
        chunk = query_factory().range(len(rows), len(rows) + page - 1).execute().data or []
        rows += chunk
        if len(chunk) < page:
            break
    return rows


# ---------------------------------------------------------------------------------------------- communications hub
def search_users(db, query: Any) -> List[Dict[str, Any]]:
    """Find accounts to message. Searches name, email and campus ID; returns only what the picker needs."""
    cleaned = _LIKE_UNSAFE.sub('', str(query or '')).strip()[:60]
    tokens = [t for t in cleaned.lower().split() if t]
    if not tokens or len(cleaned) < 2:
        return []
    pattern = f'%{tokens[0]}%'
    rows = db.client.table('user_profiles').select('account_id,fname,lname,email,campus_id,access_level,is_active') \
        .or_(f'fname.ilike.{pattern},lname.ilike.{pattern},email.ilike.{pattern},campus_id.ilike.{pattern}').limit(40).execute().data or []
    found = []
    for row in rows:
        haystack = f"{row.get('fname') or ''} {row.get('lname') or ''} {row.get('email') or ''} {row.get('campus_id') or ''}".lower()
        if all(token in haystack for token in tokens):
            found.append({
                'account_id': str(row['account_id']), 'name': _name(row), 'email': row.get('email') or '',
                'campus_id': row.get('campus_id') or '', 'level': access_level(row), 'is_active': row.get('is_active') is not False,
            })
    return found[:SEARCH_LIMIT]


def _recipients(db, audience: str, account_id: Optional[str]) -> List[Dict[str, Any]]:
    if audience == 'user':
        rows = db.client.table('user_profiles').select('account_id,fname,lname,email,is_active').eq('account_id', str(account_id or '')).limit(1).execute().data or []
        if not rows:
            raise ToolError('That user was not found. Search again and pick them from the list.', 404)
        return rows
    try:  # email_preferences lets people opt out of announcements; a database without it simply sends to everyone as before
        rows = _paged(lambda: db.client.table('user_profiles').select('account_id,fname,lname,email,is_active,email_preferences').order('account_id'), cap=MAX_RECIPIENTS)
    except Exception:
        rows = _paged(lambda: db.client.table('user_profiles').select('account_id,fname,lname,email,is_active').order('account_id'), cap=MAX_RECIPIENTS)
    return [r for r in rows if r.get('is_active') is not False]


def _send_emails(recipients: List[Dict[str, Any]], subject: str, body: str, broadcast: bool = False) -> Dict[str, int]:
    from app.utils import email_prefs
    from app.utils.email_service import EmailService
    service = EmailService()
    sent = failed = 0
    for person in recipients:
        if not person.get('email'):
            continue
        if broadcast:  # a campus-wide announcement is optional mail: it carries an unsubscribe link
            delivered = service.send_announcement_email(person['email'], str(person.get('fname') or '').strip(), subject, body,
                                                        unsubscribe_url=email_prefs.unsubscribe_url(person['account_id'], 'announcements'))
        else:
            delivered = service.send_announcement_email(person['email'], str(person.get('fname') or '').strip(), subject, body)
        if delivered:
            sent += 1
        else:
            failed += 1
    logger.info('Broadcast email finished: %s sent, %s failed', sent, failed)
    return {'sent': sent, 'failed': failed}


def send_message(db, audience: Any, account_id: Any, title: Any, body: Any, send_email: Any, send_in_app: Any) -> Dict[str, Any]:
    """Send a direct message to one user or everyone, as an email, an in-app notification or both."""
    audience = str(audience or '').strip().lower()
    if audience not in ('user', 'all'):
        raise ToolError('Choose who should get the message: one user or all users.')
    subject, text = _text(title, MAX_TITLE), _text(body, MAX_BODY, multiline=True)
    if len(subject) < 3:
        raise ToolError('Give the message a title of at least 3 characters.')
    if len(text) < 3:
        raise ToolError('Write the message.')
    email, in_app = send_email is True, send_in_app is True
    if not email and not in_app:
        raise ToolError('Choose at least one way to send it: email or in-app notification.')
    recipients = _recipients(db, audience, account_id)
    if not recipients:
        raise ToolError('There is nobody to send this to.', 404)
    if email and len(recipients) > MAX_EMAIL_RECIPIENTS:
        raise ToolError(f'Email can go to at most {MAX_EMAIL_RECIPIENTS:,} people at once. Send it in-app for everyone, or message smaller groups.', 400)

    result: Dict[str, Any] = {'recipients': len(recipients), 'in_app': 0, 'email_queued': 0, 'email_unavailable': False}
    if in_app:
        stamp = _iso(_now())
        rows = [{
            'user_account_id': str(r['account_id']), 'title': subject, 'message': text, 'notification_type': 'announcement',
            'is_read': False, 'link_label': None, 'link_page': None, 'created_at': stamp,
        } for r in recipients]
        for start in range(0, len(rows), 500):
            db.client.table('user_notifications').insert(rows[start:start + 500]).execute()
            result['in_app'] += len(rows[start:start + 500])
    if email:
        from config import Config
        with_email = [r for r in recipients if r.get('email')]
        if audience == 'all':
            from app.utils import email_prefs
            eligible = [r for r in with_email if email_prefs.allows(r, 'announcements')]
            result['email_opted_out'] = len(with_email) - len(eligible)
            with_email = eligible
        if not Config.SENDGRID_API_KEY:
            result['email_unavailable'] = True
        elif audience == 'user':
            outcome = _send_emails(with_email, subject, text)
            result['email_sent'], result['email_failed'] = outcome['sent'], outcome['failed']
        else:
            # A whole-campus email takes a while; send it in the background so the request answers at once.
            threading.Thread(target=_send_emails, args=(with_email, subject, text, True), daemon=True).start()
            result['email_queued'] = len(with_email)
    return result


# ---------------------------------------------------------------------------------------------- admin governance
def list_admins(db) -> List[Dict[str, Any]]:
    """Every admin and super admin, including accounts that only have the legacy role column."""
    columns = 'account_id,fname,lname,email,campus_id,user_role,access_level,is_active,created_at,last_login_at'
    merged: Dict[str, Dict[str, Any]] = {}
    for key, values in (('access_level', ['admin', 'super_admin']), ('user_role', ['admin', 'Admin', 'super_admin', 'Super Admin'])):
        for row in db.client.table('user_profiles').select(columns).in_(key, values).limit(500).execute().data or []:
            merged[str(row['account_id'])] = row
    admins = []
    for row in merged.values():
        level = access_level(row)
        if level not in STAFF_LEVELS:
            continue
        try:
            mfa = db.get_admin_mfa(row['account_id'])
        except Exception:
            mfa = None
        admins.append({
            'account_id': str(row['account_id']), 'name': _name(row), 'email': row.get('email') or '', 'campus_id': row.get('campus_id') or '',
            'level': level, 'is_active': row.get('is_active') is not False, 'mfa_enabled': bool(mfa and mfa.get('enabled_at')),
            'created_at': row.get('created_at'), 'last_login_at': row.get('last_login_at'),
        })
    admins.sort(key=lambda a: (a['level'] != 'super_admin', a['name'].lower()))
    return admins


def revoke_admin(db, actor_id: str, target_id: Any) -> Dict[str, Any]:
    """Demote an admin or super admin to a standard user at once. Their next request is refused: admin routes re-read the level."""
    target_id = str(target_id or '')
    if not target_id:
        raise ToolError('Choose an account.')
    if target_id == str(actor_id):
        raise ToolError('You cannot revoke your own access. Ask another super administrator.', 400)
    rows = db.client.table('user_profiles').select('account_id,fname,lname,email,user_role,access_level').eq('account_id', target_id).limit(1).execute().data or []
    if not rows:
        raise ToolError('That account was not found.', 404)
    target = rows[0]
    level = access_level(target)
    if level not in STAFF_LEVELS:
        raise ToolError('This account is already a standard user.', 409)
    if level == 'super_admin':
        remaining = [a for a in list_admins(db) if a['level'] == 'super_admin' and a['account_id'] != target_id and a['is_active']]
        if not remaining:
            raise ToolError('This is the last active super administrator. Promote another one first, or nobody could manage the system.', 409)
    changed = db.client.table('user_profiles').update({'access_level': 'user', 'updated_at': _iso(_now())}).eq('account_id', target_id).execute().data or []
    if not changed:
        raise ToolError('The account could not be updated. Try again.', 502)
    forget_account(target_id)
    try:
        db.create_user_notification(
            target_id, 'Your administrator access was removed',
            'A super administrator removed your admin access to E-Balik. You can still use your account as a regular user. Contact the Lost and Found Office if you think this is a mistake.',
            notification_type='access_revoked', link_label=None, link_page=None,
        )
    except Exception as error:
        logger.warning('Could not notify %s about revoked access: %s', target_id, error)
    return {'account_id': target_id, 'name': _name(target), 'email': target.get('email') or '', 'previous_level': level}


# ---------------------------------------------------------------------------------------------- audit export
EXPORT_SECTIONS = {
    'users': ('user_profiles', ['account_id', 'campus_id', 'fname', 'mname', 'lname', 'email', 'user_role', 'access_level', 'user_category', 'verification_status', 'is_active', 'suspended_until', 'created_at', 'last_login_at']),
    'claims': ('claims', ['claim_id', 'found_item_id', 'claimant_account_id', 'status', 'created_at', 'reviewed_at', 'updated_at']),
    'found_items': ('found_items', ['item_id', 'fpost_id', 'item_name', 'category', 'location', 'found_date', 'status', 'custody_status', 'turnover_location', 'created_at']),
    'missing_items': ('missing_items', ['item_id', 'mpost_id', 'item_name', 'category', 'last_location', 'last_seen_date', 'status', 'created_at']),
}


def _tally(rows: Iterable[Dict[str, Any]], key: str) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for row in rows:
        label = str(row.get(key) or 'unknown').lower()
        counts[label] = counts.get(label, 0) + 1
    return dict(sorted(counts.items()))


def build_export(db, actor_email: str) -> Dict[str, Any]:
    """The master backup for official reporting. An allow-list of columns: no password hashes, ID documents, proof images or claim text."""
    data: Dict[str, List[Dict[str, Any]]] = {}
    for section, (table, columns) in EXPORT_SECTIONS.items():
        rows = _paged(lambda table=table: db.client.table(table).select('*').order('created_at'))
        data[section] = [{column: row.get(column) for column in columns} for row in rows]
    for row in data['users']:
        row['access_level'] = access_level(row)
    summary = {
        'users_total': len(data['users']), 'users_by_access_level': _tally(data['users'], 'access_level'),
        'users_by_verification': _tally(data['users'], 'verification_status'),
        'claims_total': len(data['claims']), 'claims_by_status': _tally(data['claims'], 'status'),
        'found_items_total': len(data['found_items']), 'found_items_by_status': _tally(data['found_items'], 'status'),
        'lost_reports_total': len(data['missing_items']), 'lost_reports_by_status': _tally(data['missing_items'], 'status'),
    }
    return {'meta': {'generated_at': _iso(_now()), 'generated_by': actor_email, 'system': 'E-Balik, University of Makati', 'row_cap_per_table': EXPORT_ROW_CAP}, 'summary': summary, **data}


def _csv_cell(value: Any) -> Any:
    """Stop spreadsheet formulas: a cell that starts with = + - @ is shown as text."""
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False)
    if isinstance(value, str) and value[:1] in ('=', '+', '-', '@', '\t', '\r'):
        return "'" + value
    return value


def export_json(export: Dict[str, Any]) -> bytes:
    return json.dumps(export, indent=2, ensure_ascii=False, default=str).encode('utf-8')


def export_csv_zip(export: Dict[str, Any]) -> bytes:
    """One CSV per section in a zip, plus summary.csv, so each opens cleanly in a spreadsheet."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        summary = io.StringIO()
        writer = csv.writer(summary)
        writer.writerow(['measure', 'value'])
        for key, value in export['meta'].items():
            writer.writerow([_csv_cell(f'meta.{key}'), _csv_cell(value)])
        for key, value in export['summary'].items():
            if isinstance(value, dict):
                for label, count in value.items():
                    writer.writerow([_csv_cell(f'{key}.{label}'), count])
            else:
                writer.writerow([key, value])
        archive.writestr('summary.csv', '﻿' + summary.getvalue())
        for section, (_, columns) in EXPORT_SECTIONS.items():
            out = io.StringIO()
            writer = csv.writer(out)
            writer.writerow(columns)
            for row in export[section]:
                writer.writerow([_csv_cell(row.get(column)) for column in columns])
            archive.writestr(f'{section}.csv', '﻿' + out.getvalue())
    return buffer.getvalue()


# ---------------------------------------------------------------------------------------------- storage
class StorageUnavailable(Exception):
    """The storage_bucket_stats / storage_list_objects functions have not been created yet."""


def _rpc(db, name: str, params: Dict[str, Any]) -> Any:
    try:
        return db.client.rpc(name, params).execute().data
    except Exception as error:
        text = str(error).lower()
        if name in text and any(marker in text for marker in ('pgrst202', '42883', 'could not find the function', 'does not exist', 'schema cache')):
            raise StorageUnavailable('Storage tools are not set up yet. Run the 20261010_tag_photo_and_mission_control.sql migration in Supabase.') from error
        raise


def storage_overview(db) -> Dict[str, Any]:
    rows = _rpc(db, 'storage_bucket_stats', {}) or []
    buckets = [{'bucket': r['bucket'], 'objects': int(r.get('objects') or 0), 'bytes': int(r.get('bytes') or 0)} for r in rows]
    images = [b for b in buckets if b['bucket'] in IMAGE_BUCKETS]
    return {
        'buckets': buckets, 'total_objects': sum(b['objects'] for b in buckets), 'total_bytes': sum(b['bytes'] for b in buckets),
        'image_objects': sum(b['objects'] for b in images), 'image_bytes': sum(b['bytes'] for b in images),
    }


def storage_path(bucket: str, value: Any) -> Optional[str]:
    """The object path inside a bucket for a stored URL or raw path. None for data URLs, other buckets and anything unclear."""
    if not value or not isinstance(value, str) or value.startswith('data:'):
        return None
    match = re.search(rf'/object/(?:public|sign|authenticated)/{re.escape(bucket)}/([^?#]+)', value)
    if match:
        return unquote(match.group(1))
    if value.startswith(('http://', 'https://')):
        return None
    return unquote(value.split('?', 1)[0]).lstrip('/') or None


def _decrypted(value: Any) -> Any:
    try:
        from app.utils.crypto_service import CryptoService
        return CryptoService.decrypt(value) or value
    except Exception:
        return value


def referenced_paths(db) -> Dict[str, Set[str]]:
    """Every object path still pointed at by a row. Any read failure raises: cleanup must never run on partial knowledge."""
    refs: Dict[str, Set[str]] = {bucket: set() for bucket in IMAGE_BUCKETS}

    def add(bucket: str, value: Any) -> None:
        path = storage_path(bucket, value)
        if path:
            refs[bucket].add(path)

    for row in _paged(lambda: db.client.table('found_items').select('image_url').order('item_id')):
        add('found-item-images', row.get('image_url'))
    for row in _paged(lambda: db.client.table('auctions').select('image_url,gallery_urls').order('auction_id')):
        for value in [row.get('image_url'), *(row.get('gallery_urls') or [])]:
            add('found-item-images', value)
    for row in _paged(lambda: db.client.table('missing_items').select('image_url').order('item_id')):
        add('missing-item-images', row.get('image_url'))
    for row in _paged(lambda: db.client.table('smart_tags').select('item_image_url').order('tag_id')):
        add('smart-tag-images', row.get('item_image_url'))
    for row in _paged(lambda: db.client.table('claims').select('proof_image_url,proof_image_path').order('claim_id')):
        add('claim-proof-images', row.get('proof_image_path'))
        add('claim-proof-images', _decrypted(row.get('proof_image_url')))
    return refs


def _list_objects(db, bucket: str) -> List[Dict[str, Any]]:
    objects: List[Dict[str, Any]] = []
    offset = 0
    while len(objects) < EXPORT_ROW_CAP:
        page = _rpc(db, 'storage_list_objects', {'p_bucket': bucket, 'p_limit': 1000, 'p_offset': offset}) or []
        objects += page
        if len(page) < 1000:
            break
        offset += 1000
    return objects


def scan_orphans(db) -> Dict[str, Any]:
    """Images in storage that no report, tag, auction or claim points at, and that are old enough not to be an upload in progress."""
    refs = referenced_paths(db)
    cutoff = _now() - timedelta(hours=ORPHAN_MIN_AGE_HOURS)
    found: Dict[str, List[Dict[str, Any]]] = {}
    for bucket in IMAGE_BUCKETS:
        orphans = []
        for obj in _list_objects(db, bucket):
            created = None
            try:
                created = datetime.fromisoformat(str(obj.get('created_at')).replace('Z', '+00:00'))
            except ValueError:
                pass
            if obj.get('name') and obj['name'] not in refs[bucket] and created and created < cutoff:
                orphans.append({'name': obj['name'], 'bytes': int(obj.get('size') or 0)})
        found[bucket] = orphans
    return {
        'buckets': [{'bucket': b, 'count': len(found[b]), 'bytes': sum(o['bytes'] for o in found[b])} for b in IMAGE_BUCKETS],
        'total': sum(len(v) for v in found.values()), 'bytes': sum(o['bytes'] for v in found.values() for o in v),
        'min_age_hours': ORPHAN_MIN_AGE_HOURS, '_objects': found,
    }


def clean_orphans(db) -> Dict[str, Any]:
    scan = scan_orphans(db)
    removed = failed = freed = 0
    for bucket, orphans in scan['_objects'].items():
        names = [o['name'] for o in orphans]
        sizes = {o['name']: o['bytes'] for o in orphans}
        for start in range(0, len(names), 100):
            chunk = names[start:start + 100]
            try:
                db.client.storage.from_(bucket).remove(chunk)
                removed += len(chunk)
                freed += sum(sizes[n] for n in chunk)
            except Exception as error:
                failed += len(chunk)
                logger.warning('Orphan cleanup failed for %s: %s', bucket, error)
    scan.pop('_objects')
    return {'removed': removed, 'failed': failed, 'freed_bytes': freed, 'scanned_buckets': list(IMAGE_BUCKETS)}


# ---------------------------------------------------------------------------------------------- email test
def mask_email(email: str) -> str:
    local, _, domain = str(email or '').partition('@')
    return f"{local[:1]}{'*' * max(len(local) - 1, 2)}@{domain}" if domain else '(no email)'


def send_test_email(db, actor_id: str) -> Dict[str, Any]:
    """Send a test message to the signed-in super admin. Reports exactly what the provider answered."""
    from config import Config
    rows = db.client.table('user_profiles').select('email,fname').eq('account_id', str(actor_id)).limit(1).execute().data or []
    email = (rows[0].get('email') if rows else '') or ''
    if not email:
        raise ToolError('Your account has no email address to send the test to.', 400)
    if not Config.SENDGRID_API_KEY:
        return {'ok': False, 'to': mask_email(email), 'provider': 'SendGrid', 'detail': 'SENDGRID_API_KEY is not set on the server, so no email can be sent.', 'status_code': None}
    from app.utils.email_service import EmailService
    ok, detail, status = EmailService().send_test_email(email, str((rows[0] or {}).get('fname') or ''))
    return {'ok': ok, 'to': mask_email(email), 'provider': 'SendGrid', 'detail': detail, 'status_code': status, 'from': Config.SENDGRID_FROM_EMAIL}


def humanize_bytes(value: int) -> str:
    size = float(value)
    for unit in ('B', 'KB', 'MB', 'GB'):
        if size < 1024 or unit == 'GB':
            return f'{size:.0f} {unit}' if unit == 'B' else f'{size:.1f} {unit}'
        size /= 1024
    return f'{value} B'
