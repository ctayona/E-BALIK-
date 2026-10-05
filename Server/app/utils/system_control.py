"""System control: maintenance mode, forced logout, per-request account enforcement, health scan and data cleanup.

Settings live in `system_settings` (see Server/manual_migrations/20261006_system_control_verification.sql). Reads are
cached for a few seconds so enforcing them on every API request stays cheap, and enforcement fails open if the database
cannot be read: a database hiccup must never lock everyone out.
"""
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import jwt
from flask import jsonify, request

from config import Config

logger = logging.getLogger(__name__)

STAFF_LEVELS = {'admin', 'super_admin'}
CACHE_SECONDS = 5.0
MIN_CLEANUP_DAYS = 30
MAX_CLEANUP_DAYS = 3650
MAX_MESSAGE_LENGTH = 280

DEFAULT_SETTINGS: Dict[str, Dict[str, Any]] = {
    'maintenance_mode': {'enabled': False, 'message': '', 'since': None},
    'sessions_valid_after': {'ts': None},
    'last_cleanup': {},
}

# Reachable while maintenance mode is on: sign-in decides per account (staff pass), and password reset only sends a code.
AUTH_OPEN_PATHS = {
    '/api/auth/login', '/api/auth/google-login', '/api/auth/admin-mfa/verify',
    '/api/auth/forgot-password', '/api/auth/reset-password',
}
PUBLIC_PATHS = {'/api/system/status'}

# (method, path pattern, what the user was trying to do)
VERIFICATION_GATED = [
    ('POST', re.compile(r'^/api/(found-items|missing-items)/?$'), 'file a report'),
    ('POST', re.compile(r'^/api/claims/?$'), 'file a claim'),
    ('POST', re.compile(r'^/api/auctions/[^/]+/bids/?$'), 'place a bid'),
]

_settings_cache: Dict[str, Any] = {'at': 0.0, 'data': None, 'missing': False}
_state_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}


class SystemSetupRequired(Exception):
    """The system_settings table has not been created yet."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _missing_table(error: Exception, name: str) -> bool:
    text = str(error).lower()
    return name in text and any(marker in text for marker in ('pgrst205', '42p01', 'schema cache', 'does not exist', 'could not find the'))


def access_level(profile: Optional[Dict[str, Any]]) -> str:
    """Same rule as the sign-in code: the stored access_level, else the legacy user_role."""
    if not profile:
        return 'user'
    stored = str(profile.get('access_level') or '').strip().lower()
    if stored in {'user', 'admin', 'super_admin'}:
        return stored
    legacy = str(profile.get('user_role') or '').strip().lower()
    return legacy if legacy in STAFF_LEVELS else 'user'


# ---------------------------------------------------------------------------------------------- settings
def load_settings(db, force: bool = False) -> Dict[str, Dict[str, Any]]:
    """All settings merged over their defaults; cached for CACHE_SECONDS. Missing table means defaults."""
    if not force and _settings_cache['data'] is not None and time.monotonic() - _settings_cache['at'] < CACHE_SECONDS:
        return _settings_cache['data']
    settings = {key: dict(value) for key, value in DEFAULT_SETTINGS.items()}
    missing = False
    try:
        rows = db.client.table('system_settings').select('setting_key,setting_value').execute().data or []
        for row in rows:
            if isinstance(row.get('setting_value'), dict):
                settings[row['setting_key']] = {**settings.get(row['setting_key'], {}), **row['setting_value']}
    except Exception as error:
        if _missing_table(error, 'system_settings'):
            missing = True
        else:
            raise
    _settings_cache.update(at=time.monotonic(), data=settings, missing=missing)
    return settings


def settings_table_missing() -> bool:
    return bool(_settings_cache['missing'])


def save_setting(db, key: str, value: Dict[str, Any], actor_id: Optional[str]) -> None:
    try:
        db.client.table('system_settings').upsert({
            'setting_key': key, 'setting_value': value, 'updated_by': actor_id, 'updated_at': _iso(_now()),
        }).execute()
    except Exception as error:
        if _missing_table(error, 'system_settings'):
            raise SystemSetupRequired('System settings are not set up yet. Run the 20261006_system_control_verification.sql migration in Supabase.') from error
        raise
    _settings_cache['data'] = None


def clear_caches() -> None:
    _settings_cache.update(at=0.0, data=None, missing=False)
    _state_cache.clear()


def public_status(db) -> Dict[str, Any]:
    maintenance = load_settings(db)['maintenance_mode']
    enabled = bool(maintenance.get('enabled'))
    return {
        'maintenance': enabled,
        'message': (maintenance.get('message') or '') if enabled else '',
        'since': maintenance.get('since') if enabled else None,
    }


def set_maintenance(db, enabled: bool, message: str, actor_id: str) -> Dict[str, Any]:
    text = str(message or '').strip()[:MAX_MESSAGE_LENGTH]
    value = {'enabled': bool(enabled), 'message': text, 'since': _iso(_now()) if enabled else None, 'by': actor_id}
    save_setting(db, 'maintenance_mode', value, actor_id)
    return value


def force_logout(db, actor_id: str) -> str:
    """Revoke every standard-user session issued before now. Staff sessions are untouched."""
    stamp = _iso(_now().replace(microsecond=0))
    save_setting(db, 'sessions_valid_after', {'ts': stamp, 'by': actor_id}, actor_id)
    return stamp


# ---------------------------------------------------------------------------------------------- accounts
def account_state(db, account_id: str, fresh: bool = False) -> Optional[Dict[str, Any]]:
    """Level, activity, suspension and verification of one account (cached briefly). Lifts an expired suspension."""
    cached = _state_cache.get(account_id)
    if cached and not fresh and time.monotonic() - cached[0] < CACHE_SECONDS:
        return cached[1]
    rows = db.client.table('user_profiles').select('*').eq('account_id', account_id).limit(1).execute().data or []
    if not rows:
        return None
    profile = rows[0]
    active = profile.get('is_active') is not False
    until = _parse(profile.get('suspended_until'))
    if not active and until and until <= _now() and 'suspended_until' in profile:
        try:
            db.client.table('user_profiles').update({'is_active': True, 'suspended_until': None, 'suspension_reason': None}).eq('account_id', account_id).execute()
            active, until = True, None
        except Exception as error:
            logger.warning('Could not lift expired suspension for %s: %s', account_id, error)
    state = {
        'account_id': account_id,
        'level': access_level(profile),
        'is_active': active,
        'suspended_until': _iso(until) if until and not active else None,
        'suspension_reason': profile.get('suspension_reason') if not active else None,
        'verification_status': str(profile.get('verification_status') or 'pending').lower(),
        'user_category': profile.get('user_category'),
    }
    _state_cache[account_id] = (time.monotonic(), state)
    return state


def forget_account(account_id: str) -> None:
    _state_cache.pop(str(account_id), None)


def _suspension_message(state: Dict[str, Any]) -> str:
    until = _parse(state.get('suspended_until'))
    when = f" until {until.strftime('%b %d, %Y')}" if until else ''
    reason = f" Reason: {state['suspension_reason']}" if state.get('suspension_reason') else ''
    return f"Your account is suspended{when}.{reason} Contact the Lost and Found Office if you think this is a mistake."


def _maintenance_response(settings: Dict[str, Dict[str, Any]]):
    message = (settings['maintenance_mode'].get('message') or '').strip() or 'E-Balik is under maintenance. Please check back soon.'
    response = jsonify({'error': message, 'maintenance': True})
    response.status_code = 503
    response.headers['Retry-After'] = '60'
    return response


def login_block(db, profile: Dict[str, Any]):
    """A JSON response when this account may not sign in right now (maintenance for non-staff, suspension), else None."""
    staff = access_level(profile) in STAFF_LEVELS
    settings = load_settings(db)
    if settings['maintenance_mode'].get('enabled') and not staff:
        return _maintenance_response(settings)
    if staff:
        return None
    state = account_state(db, str(profile['account_id']), fresh=True)
    if state and not state['is_active']:
        response = jsonify({'error': _suspension_message(state), 'suspended': True, 'suspended_until': state['suspended_until']})
        response.status_code = 403
        return response
    return None


# ---------------------------------------------------------------------------------------------- per-request enforcement
def _token_payload() -> Optional[Dict[str, Any]]:
    header = request.headers.get('Authorization', '')
    if not header.lower().startswith('bearer '):
        return None
    try:
        payload = jwt.decode(header[7:].strip(), Config.JWT_SECRET_KEY, algorithms=['HS256'])
    except Exception:
        return None
    if payload.get('purpose') == 'admin_mfa' or not payload.get('account_id'):
        return None
    return payload


def enforce_request():
    """Flask before_request hook: maintenance lock, revoked sessions, suspension and the verification gate."""
    if request.method == 'OPTIONS' or not request.path.startswith('/api/') or request.path in PUBLIC_PATHS:
        return None
    try:
        from app.utils import get_db
        from flask import current_app
        db = get_db(url=current_app.config['SUPABASE_URL'], service_key=current_app.config['SUPABASE_SERVICE_KEY'])
        settings = load_settings(db)
        payload = _token_payload()
        state = account_state(db, str(payload['account_id'])) if payload else None
    except Exception as error:
        logger.warning('System enforcement skipped (database unavailable): %s', error)
        return None

    staff = bool(state) and state['level'] in STAFF_LEVELS
    if settings['maintenance_mode'].get('enabled') and not staff:
        return None if request.path in AUTH_OPEN_PATHS else _maintenance_response(settings)
    if not payload or not state or staff:
        return None

    valid_after = _parse(settings['sessions_valid_after'].get('ts'))
    issued = payload.get('iat')
    if valid_after and isinstance(issued, (int, float)) and issued < valid_after.timestamp():
        response = jsonify({'error': 'Your session was ended by an administrator. Please sign in again.', 'session_revoked': True})
        response.status_code = 401
        return response
    if not state['is_active']:
        response = jsonify({'error': _suspension_message(state), 'suspended': True, 'suspended_until': state['suspended_until']})
        response.status_code = 403
        return response
    if state['verification_status'] != 'verified':
        for method, pattern, action in VERIFICATION_GATED:
            if request.method == method and pattern.match(request.path):
                response = jsonify({
                    'error': f"Verify your account to {action}. Upload your ID in Profile and wait for an administrator to approve it.",
                    'verification_required': True,
                    'verification_status': state['verification_status'],
                })
                response.status_code = 403
                return response
    return None


# ---------------------------------------------------------------------------------------------- cleanup
CLEANUP_TARGETS = {
    'notifications': {'table': 'user_notifications', 'column': 'created_at', 'label': 'Old notifications'},
    'otp_tokens': {'table': 'otp_tokens', 'column': 'expires_at', 'label': 'Expired verification codes'},
    'mfa_challenges': {'table': 'admin_mfa_challenges', 'column': 'expires_at', 'label': 'Expired admin sign-in challenges'},
}


def validate_days(value: Any) -> int:
    try:
        days = int(value)
    except (TypeError, ValueError):
        raise ValueError('Enter the age in days.')
    if days < MIN_CLEANUP_DAYS or days > MAX_CLEANUP_DAYS:
        raise ValueError(f'Only data older than {MIN_CLEANUP_DAYS} days can be cleaned up (up to {MAX_CLEANUP_DAYS}).')
    return days


def _cleanup_query(db, key: str, cutoff: str, include_unread: bool, builder):
    target = CLEANUP_TARGETS[key]
    query = builder(db.client.table(target['table'])).lt(target['column'], cutoff)
    if key == 'notifications' and not include_unread:
        query = query.eq('is_read', True)
    return query


def cleanup_preview(db, days: int, include_unread: bool) -> List[Dict[str, Any]]:
    cutoff = _iso(_now() - timedelta(days=days))
    rows = []
    for key, target in CLEANUP_TARGETS.items():
        try:
            result = _cleanup_query(db, key, cutoff, include_unread, lambda table: table.select(target['column'], count='exact')).limit(1).execute()
            rows.append({'key': key, 'label': target['label'], 'count': int(result.count or 0), 'available': True})
        except Exception as error:
            if _missing_table(error, target['table']):
                rows.append({'key': key, 'label': target['label'], 'count': 0, 'available': False})
            else:
                raise
    return rows


def run_cleanup(db, days: int, include_unread: bool, targets: List[str], actor_id: str) -> Dict[str, Any]:
    chosen = [key for key in targets if key in CLEANUP_TARGETS]
    if not chosen:
        raise ValueError('Choose at least one kind of data to clean up.')
    cutoff = _iso(_now() - timedelta(days=days))
    deleted: Dict[str, int] = {}
    for key in chosen:
        target = CLEANUP_TARGETS[key]
        try:
            result = _cleanup_query(db, key, cutoff, include_unread, lambda table: table.delete(count='exact')).execute()
            deleted[key] = int(result.count if result.count is not None else len(result.data or []))
        except Exception as error:
            if _missing_table(error, target['table']):
                deleted[key] = 0
            else:
                raise
    summary = {'at': _iso(_now()), 'by': actor_id, 'days': days, 'include_unread': include_unread, 'deleted': deleted}
    try:
        save_setting(db, 'last_cleanup', summary, actor_id)
    except SystemSetupRequired:
        pass
    return summary


# ---------------------------------------------------------------------------------------------- health scan
REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET_KEY', 'APP_ENCRYPTION_KEY']
OPTIONAL_ENV = ['SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL', 'GOOGLE_CLIENT_ID']
BLOAT_WARN = {'user_notifications': 5000, 'otp_tokens': 2000, 'user_activity_logs': 50000}
HIGH_ACTIVITY_ACTIONS = 15
RANK = {'ok': 0, 'info': 0, 'warn': 1, 'fail': 2}


def _check(check_id: str, title: str, status: str, detail: str, items: Optional[List[str]] = None) -> Dict[str, Any]:
    return {'id': check_id, 'title': title, 'status': status, 'detail': detail, 'items': items or []}


def _count(db, table: str, apply=None) -> int:
    query = db.client.table(table).select('*', count='exact')
    if apply:
        query = apply(query)
    return int(query.limit(1).execute().count or 0)


def health_scan(db) -> Dict[str, Any]:
    started = time.monotonic()
    checks: List[Dict[str, Any]] = []

    def run(check_id: str, title: str, func):
        try:
            checks.append(func())
        except Exception as error:
            logger.warning('Health check %s failed to run: %s', check_id, error)
            checks.append(_check(check_id, title, 'warn', f'This check could not run: {str(error)[:140]}'))

    def environment():
        missing = [name for name in REQUIRED_ENV if not os.getenv(name)]
        optional = [name for name in OPTIONAL_ENV if not os.getenv(name)]
        weak = os.getenv('JWT_SECRET_KEY', '') in ('', 'dev-secret-key-change-in-production')
        if missing or weak:
            items = [f'Missing: {name}' for name in missing] + (['JWT_SECRET_KEY is empty or still the development default'] if weak and 'JWT_SECRET_KEY' not in missing else [])
            return _check('environment', 'Environment variables', 'fail', 'A required setting is missing or unsafe.', items)
        if optional:
            return _check('environment', 'Environment variables', 'warn', 'Optional settings are not configured. Related features may not work.', [f'Not set: {name}' for name in optional])
        return _check('environment', 'Environment variables', 'ok', 'All required and optional settings are present.')

    def database():
        began = time.monotonic()
        db.client.table('user_profiles').select('account_id').limit(1).execute()
        latency = int((time.monotonic() - began) * 1000)
        return _check('database', 'Database connection', 'warn' if latency > 1500 else 'ok', f'Reachable in {latency} ms.' + (' Slower than expected.' if latency > 1500 else ''))

    def schema():
        problems = []
        for table in ('system_settings', 'auctions', 'auction_bids', 'auction_comments'):
            try:
                db.client.table(table).select('*').limit(1).execute()
            except Exception as error:
                if _missing_table(error, table):
                    problems.append(f'Table {table} is missing')
                else:
                    raise
        try:
            db.client.table('user_profiles').select('user_category,suspended_until,suspension_reason,suspended_by').limit(1).execute()
        except Exception:
            problems.append('user_profiles is missing user_category / suspension columns')
        if problems:
            return _check('schema', 'Database migrations', 'fail', 'Some migrations have not been applied.', problems)
        return _check('schema', 'Database migrations', 'ok', 'Auction, verification and system tables are in place.')

    def unverified_activity():
        since = _iso(_now() - timedelta(days=7))
        logs = db.client.table('user_activity_logs').select('account_id').gte('created_at', since).limit(5000).execute().data or []
        counts: Dict[str, int] = {}
        for row in logs:
            if row.get('account_id'):
                counts[str(row['account_id'])] = counts.get(str(row['account_id']), 0) + 1
        busy = [account for account, total in counts.items() if total >= HIGH_ACTIVITY_ACTIONS]
        flagged = []
        for account in busy:
            state = account_state(db, account)
            if state and state['level'] not in STAFF_LEVELS and state['verification_status'] != 'verified':
                profile = db.client.table('user_profiles').select('fname,lname,campus_id').eq('account_id', account).limit(1).execute().data or [{}]
                flagged.append((counts[account], f"{profile[0].get('fname', '')} {profile[0].get('lname', '')}".strip() or 'Unknown user', profile[0].get('campus_id') or '-'))
        if flagged:
            flagged.sort(reverse=True)
            return _check('unverified_activity', 'Unverified users with high activity', 'warn',
                          f'{len(flagged)} unverified account(s) made {HIGH_ACTIVITY_ACTIONS}+ actions in 7 days.',
                          [f'{name} ({campus}): {total} actions' for total, name, campus in flagged[:5]])
        return _check('unverified_activity', 'Unverified users with high activity', 'ok', 'No unverified account shows unusual activity.')

    def admin_mfa():
        admins = db.client.table('user_profiles').select('account_id,fname,lname,access_level').in_('access_level', ['admin', 'super_admin']).limit(100).execute().data or []
        without = []
        for admin in admins:
            record = db.get_admin_mfa(admin['account_id'])
            if not (record and record.get('enabled_at')):
                without.append(f"{admin.get('fname', '')} {admin.get('lname', '')}".strip() or 'Admin')
        if without:
            return _check('admin_mfa', 'Admin two-factor authentication', 'warn', f'{len(without)} of {len(admins)} admin account(s) have no authenticator.', without[:5])
        return _check('admin_mfa', 'Admin two-factor authentication', 'ok', f'All {len(admins)} admin accounts use an authenticator.')

    def verification_backlog():
        pending = _count(db, 'user_profiles', lambda q: q.eq('verification_status', 'pending').not_.is_('verification_document_url', 'null'))
        return _check('verification_backlog', 'Verification requests', 'warn' if pending > 20 else 'ok', f'{pending} document(s) are waiting for review.' + (' The queue is getting long.' if pending > 20 else ''))

    def suspensions():
        overdue = _count(db, 'user_profiles', lambda q: q.eq('is_active', False).lt('suspended_until', _iso(_now())))
        total = _count(db, 'user_profiles', lambda q: q.eq('is_active', False))
        if overdue:
            return _check('suspensions', 'Suspended accounts', 'info', f'{total} suspended. {overdue} timed suspension(s) have expired and lift on the next sign-in.')
        return _check('suspensions', 'Suspended accounts', 'ok', f'{total} account(s) are currently suspended.')

    def bloat():
        items, status = [], 'ok'
        cutoff = _iso(_now() - timedelta(days=MIN_CLEANUP_DAYS))
        for table, limit in BLOAT_WARN.items():
            try:
                total = _count(db, table)
            except Exception as error:
                if _missing_table(error, table):
                    continue
                raise
            items.append(f'{table}: {total:,} rows')
            if total > limit:
                status = 'warn'
        stale = _count(db, 'user_notifications', lambda q: q.lt('created_at', cutoff))
        expired = _count(db, 'otp_tokens', lambda q: q.lt('expires_at', cutoff))
        if stale + expired > 500:
            status = 'warn'
        detail = f'{stale:,} notification(s) and {expired:,} verification code(s) are older than {MIN_CLEANUP_DAYS} days.'
        return _check('bloat', 'Database size', status, detail + (' Consider running the cleanup tool.' if status == 'warn' else ''), items)

    def auctions_waiting():
        cutoff = _iso(_now() - timedelta(hours=48))
        late = _count(db, 'auctions', lambda q: q.eq('status', 'awaiting_admin').lt('ended_at', cutoff))
        waiting = _count(db, 'auctions', lambda q: q.eq('status', 'awaiting_admin'))
        return _check('auctions_waiting', 'Auctions awaiting an admin', 'warn' if late else 'ok', f'{waiting} auction(s) wait for a decision.' + (f' {late} have waited over 48 hours.' if late else ''))

    def controls():
        settings = load_settings(db, force=True)
        on = bool(settings['maintenance_mode'].get('enabled'))
        stamp = settings['sessions_valid_after'].get('ts')
        detail = 'Maintenance mode is ON. Standard users are locked out.' if on else 'Maintenance mode is off.'
        return _check('controls', 'System controls', 'warn' if on else 'ok', detail + (f' Last forced logout: {stamp}.' if stamp else ''))

    for check_id, title, func in (
        ('environment', 'Environment variables', environment), ('database', 'Database connection', database), ('schema', 'Database migrations', schema),
        ('unverified_activity', 'Unverified users with high activity', unverified_activity), ('admin_mfa', 'Admin two-factor authentication', admin_mfa),
        ('verification_backlog', 'Verification requests', verification_backlog), ('suspensions', 'Suspended accounts', suspensions),
        ('bloat', 'Database size', bloat), ('auctions_waiting', 'Auctions awaiting an admin', auctions_waiting), ('controls', 'System controls', controls),
    ):
        run(check_id, title, func)
    worst = max((RANK[c['status']] for c in checks), default=0)
    return {
        'status': {0: 'ok', 1: 'warn', 2: 'fail'}[worst],
        'checked_at': _iso(_now()),
        'duration_ms': int((time.monotonic() - started) * 1000),
        'checks': checks,
    }
