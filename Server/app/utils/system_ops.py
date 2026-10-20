"""System control, monitoring side: staff account health, email service health and the audit log CSV export.

All read-only except the export's own audit entry (written by the route). Nothing here changes an account.
"""
import csv
import io
import json
import logging
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

STAFF = ('super_admin', 'admin', 'guard')
DORMANT_WARN_DAYS = 45
DORMANT_FAIL_DAYS = 120
FAILED_LOGIN_WARN = 3
EXPORT_MAX_ROWS = 50000
CAMPUS_TZ = timezone(timedelta(hours=8))
RANK = {'ok': 0, 'info': 1, 'warn': 2, 'fail': 3}


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------------------------- staff account health
def admin_health(db, now: Optional[datetime] = None) -> Dict[str, Any]:
    """One row per guard, administrator and super administrator, with what needs attention.

    Flags: no authenticator (fail for a super admin, warn for an admin), locked after wrong passwords, repeated failed sign-ins,
    never signed in, dormant (no sign-in for 45 days: warn, 120: fail), suspended or switched off.
    """
    moment = now or datetime.now(timezone.utc)
    rows = db.client.table('user_profiles').select(
        'account_id,fname,lname,email,access_level,is_active,suspended_until,last_login_at,failed_login_attempts,locked_until,created_at'
    ).in_('access_level', list(STAFF)).limit(500).execute().data or []
    mfa: Dict[str, Dict[str, Any]] = {}
    mfa_available = True
    try:
        for row in db.client.table('admin_mfa').select('account_id,enabled_at,locked_until').limit(1000).execute().data or []:
            mfa[str(row['account_id'])] = row
    except Exception as error:
        mfa_available = False
        logger.info('Admin MFA table unreadable for the health view: %s', str(error)[:120])

    accounts: List[Dict[str, Any]] = []
    for row in rows:
        level = str(row.get('access_level') or '')
        record = mfa.get(str(row['account_id'])) or {}
        has_mfa = bool(record.get('enabled_at'))
        last = _parse(row.get('last_login_at'))
        idle_days = (moment - last).days if last else None
        locked_until = _parse(row.get('locked_until'))
        locked = bool(locked_until and locked_until > moment)
        failed = int(row.get('failed_login_attempts') or 0)
        flags: List[Dict[str, str]] = []

        def flag(code: str, severity: str, text: str) -> None:
            flags.append({'code': code, 'severity': severity, 'text': text})

        if level in ('super_admin', 'admin') and mfa_available and not has_mfa:
            flag('no_mfa', 'fail' if level == 'super_admin' else 'warn', 'No authenticator app set up')
        if row.get('is_active') is False:
            flag('suspended', 'info', 'Account is suspended or switched off')
        if locked:
            flag('locked', 'warn', f"Locked after wrong passwords until {locked_until.astimezone(CAMPUS_TZ).strftime('%b %d, %I:%M %p').replace(' 0', ' ')}")
        elif failed >= FAILED_LOGIN_WARN:
            flag('failed_logins', 'warn', f'{failed} failed sign-ins in a row')
        if last is None:
            flag('never_signed_in', 'info', 'Has never signed in')
        elif idle_days is not None and idle_days >= DORMANT_FAIL_DAYS:
            flag('dormant', 'fail', f'No sign-in for {idle_days} days: consider removing this access')
        elif idle_days is not None and idle_days >= DORMANT_WARN_DAYS:
            flag('dormant', 'warn', f'No sign-in for {idle_days} days')
        status = max((f['severity'] for f in flags), key=lambda s: RANK[s], default='ok')
        accounts.append({
            'account_id': str(row['account_id']), 'name': f"{row.get('fname') or ''} {row.get('lname') or ''}".strip() or 'Unnamed',
            'email': row.get('email') or '', 'role': level, 'active': row.get('is_active') is not False,
            'mfa': has_mfa if level != 'guard' else None, 'last_login_at': row.get('last_login_at'), 'idle_days': idle_days,
            'failed_logins': failed, 'locked': locked, 'status': status, 'flags': flags,
        })
    accounts.sort(key=lambda a: (-RANK[a['status']], {'super_admin': 0, 'admin': 1, 'guard': 2}.get(a['role'], 3), a['name'].lower()))
    counts = {role: sum(1 for a in accounts if a['role'] == role) for role in STAFF}
    summary = {
        'total': len(accounts), 'by_role': counts,
        'flagged': sum(1 for a in accounts if a['status'] in ('warn', 'fail')),
        'without_mfa': sum(1 for a in accounts if a['mfa'] is False),
        'locked': sum(1 for a in accounts if a['locked']),
        'dormant': sum(1 for a in accounts if any(f['code'] == 'dormant' for f in a['flags'])),
        'mfa_available': mfa_available,
    }
    overall = max((a['status'] for a in accounts), key=lambda s: RANK[s], default='ok')
    return {'checked_at': moment.isoformat(), 'status': overall, 'summary': summary, 'accounts': accounts}


# ---------------------------------------------------------------------------------------------- email service health
def email_health(live: bool = True) -> Dict[str, Any]:
    """Which provider is configured, its sender, this server's recent send results, and (live=True) the provider's own answer
    about the key. No email is sent. Statistics are per server process, so they reset when the server restarts."""
    from app.utils import email_service
    from config import Config
    provider = email_service.provider_key()
    result: Dict[str, Any] = {
        'provider': email_service.provider_name() or None, 'configured': bool(provider),
        'sender': (Config.BREVO_FROM_EMAIL if provider == 'brevo' else Config.SENDGRID_FROM_EMAIL) or None,
        'stats': dict(email_service.STATS), 'live': None,
    }
    if not provider:
        result['status'] = 'fail'
        result['detail'] = 'No email key is set on the server (BREVO_API_KEY or SENDGRID_API_KEY), so no email can be sent.'
        return result
    if not result['sender']:
        result['status'] = 'fail'
        result['detail'] = 'No sender address is set (BREVO_FROM_EMAIL or SENDGRID_FROM_EMAIL).'
        return result
    if live:
        result['live'] = email_service.check_provider()
    stats = result['stats']
    recent_failure = stats.get('last_fail_at') and (not stats.get('last_ok_at') or stats['last_fail_at'] > stats['last_ok_at'])
    if result['live'] and not result['live']['ok']:
        result['status'], result['detail'] = 'fail', result['live']['detail']
    elif recent_failure:
        result['status'], result['detail'] = 'warn', f"The last email failed: {stats.get('last_error') or 'unknown error'}"
    else:
        result['status'] = 'ok'
        result['detail'] = (result['live'] or {}).get('detail') or 'The email provider accepted the last message.'
    return result


# ---------------------------------------------------------------------------------------------- backups
BACKUP_FRESH_HOURS = 36        # a daily backup more than a day and a half old has missed a run
BACKUP_STALE_DAYS = 7


def backup_status(settings: Dict[str, Dict[str, Any]], now: Optional[datetime] = None) -> Dict[str, Any]:
    """What the last backup reported (`system_settings.last_backup`, written by the backup job or script), and whether it is recent enough."""
    moment = now or datetime.now(timezone.utc)
    last = settings.get('last_backup') or {}
    done = _parse(last.get('at'))
    failed = _parse(last.get('failed_at'))
    if not done and not failed:
        return {'status': 'warn', 'last': None, 'age_hours': None,
                'detail': 'No backup has reported in yet. Set up the nightly backup (docs/BACKUP_GUIDE.md): Supabase Free has no automatic backups you can download.'}
    if failed and (not done or failed > done):
        return {'status': 'fail', 'last': last, 'age_hours': None, 'detail': f"The last backup attempt failed. {last.get('error') or 'Check the backup job.'}"}
    age = (moment - done).total_seconds() / 3600
    summary = f"{last.get('tables') or '?'} tables" + (f", {last.get('files')} files" if last.get('files') else '') + (', encrypted' if last.get('encrypted') else ', NOT encrypted')
    if age > BACKUP_STALE_DAYS * 24:
        return {'status': 'fail', 'last': last, 'age_hours': round(age), 'detail': f'The last backup is {round(age / 24)} days old. Backups have stopped.'}
    if age > BACKUP_FRESH_HOURS:
        return {'status': 'warn', 'last': last, 'age_hours': round(age), 'detail': f'The last backup is {round(age / 24, 1)} days old, so a run was missed ({summary}).'}
    status = 'ok' if last.get('encrypted') else 'warn'
    return {'status': status, 'last': last, 'age_hours': round(age, 1),
            'detail': f'Last backup {round(age)} hour(s) ago ({summary}).' + ('' if last.get('encrypted') else ' It holds personal data: encrypt it (BACKUP_PASSPHRASE).')}


# ---------------------------------------------------------------------------------------------- audit log CSV export
def csv_safe(value: Any) -> str:
    """A cell that a spreadsheet will treat as text: a leading = + - @ (or tab or return) would otherwise run as a formula."""
    text = '' if value is None else str(value)
    return "'" + text if text[:1] in ('=', '+', '-', '@', '\t', '\r') else text


def _day(value: Any, label: str) -> Optional[date]:
    if value in (None, ''):
        return None
    try:
        return datetime.strptime(str(value).strip(), '%Y-%m-%d').date()
    except ValueError:
        raise ValueError(f'The {label} date must use YYYY-MM-DD.')


def _day_start(day: date) -> str:
    return datetime(day.year, day.month, day.day, tzinfo=CAMPUS_TZ).astimezone(timezone.utc).isoformat()


def audit_csv(db, start: Any = None, end: Any = None, module: str = '', result: str = '') -> Dict[str, Any]:
    """The activity log as CSV text for a date range (Manila days), newest first, up to 50,000 rows."""
    first, last = _day(start, 'start'), _day(end, 'end')
    if first and last and first > last:
        raise ValueError('The start date must be on or before the end date.')
    rows: List[Dict[str, Any]] = []
    offset = 0
    while len(rows) < EXPORT_MAX_ROWS:
        query = db.client.table('user_activity_logs').select('created_at,user_name,account_id,module_name,action,target_name,target_id,result')
        if first:
            query = query.gte('created_at', _day_start(first))
        if last:
            query = query.lt('created_at', _day_start(last + timedelta(days=1)))
        if module:
            query = query.eq('module_name', module[:100])
        if result in ('success', 'failed'):
            query = query.eq('result', result)
        chunk = query.order('created_at', desc=True).range(offset, offset + 999).execute().data or []
        rows += chunk
        if len(chunk) < 1000:
            break
        offset += 1000
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(['Time (Manila)', 'Who', 'Account ID', 'Module', 'Action', 'Target', 'Target ID', 'Result'])
    for row in rows[:EXPORT_MAX_ROWS]:
        moment = _parse(row.get('created_at'))
        writer.writerow([
            moment.astimezone(CAMPUS_TZ).strftime('%Y-%m-%d %H:%M:%S') if moment else '', csv_safe(row.get('user_name')), row.get('account_id') or '',
            csv_safe(row.get('module_name')), csv_safe(row.get('action')), csv_safe(row.get('target_name')), csv_safe(row.get('target_id')), row.get('result') or '',
        ])
    return {'csv': out.getvalue(), 'rows': min(len(rows), EXPORT_MAX_ROWS), 'truncated': len(rows) >= EXPORT_MAX_ROWS}
