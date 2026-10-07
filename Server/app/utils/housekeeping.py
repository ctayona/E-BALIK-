"""Scheduled housekeeping, run by the scheduler next to the auction deadlines.

1. Claim pickups: an approved claim that is not collected gets a reminder (default 7 days after approval) and is closed at its
   pickup deadline (default 14 days). A closed claim is stored as `rejected` with a clear reason, its Handover PIN stops working,
   and the item stays in custody so the owner can claim again or it can be auctioned.
2. Smart Tag expiry reminders: one email and one in-app notice, 30 days before a tag expires.
3. Evidence retention: ID documents and proof photos leave the claim N days after it closes (collected or rejected) and N days after an
   account verification is reviewed. They are not deleted straight away: they are copied into the recycle bin (see recycle_bin.py), where a
   super admin can restore them, and are purged for good when the bin period ends. Nothing is removed from the claim until the copy exists.
4. Recycle bin expiry: entries older than RECYCLE_BIN_DAYS (default 30) are purged: their files and snapshot are removed.

Every step claims its row with a conditional update before it sends anything, so overlapping runs never send twice, and every step
degrades quietly (logs, changes nothing) on a database that has not run migration 20261013 yet.
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.utils import email_prefs
from app.utils.crypto_service import CryptoService
from app.utils.recycle_bin import RecycleBin

logger = logging.getLogger(__name__)

PHT = timezone(timedelta(hours=8))  # people in Makati read local time, not UTC
BATCH = 200
CLOSED_CLAIM_STATUSES = ('collected', 'rejected')


# ------------------------------------------------------------------------------------------------ settings
def _env_int(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(float(os.getenv(name) or default))
    except ValueError:
        value = default
    return max(low, min(value, high))


def claim_pickup_days() -> int:
    return _env_int('CLAIM_PICKUP_DAYS', 14, 3, 90)


def claim_reminder_days() -> int:
    return min(_env_int('CLAIM_REMINDER_DAYS', 7, 1, 60), claim_pickup_days() - 1)


def tag_reminder_days() -> int:
    return _env_int('TAG_EXPIRY_REMINDER_DAYS', 30, 1, 120)


def retention_days() -> int:
    """Days to keep ID documents and proof photos after a case closes. 0 switches deletion off entirely."""
    raw = (os.getenv('EVIDENCE_RETENTION_DAYS') or '30').strip()
    try:
        value = int(float(raw))
    except ValueError:
        value = 30
    return 0 if value <= 0 else max(7, min(value, 3650))


# ------------------------------------------------------------------------------------------------ helpers
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def format_date(value: Any) -> str:
    when = _parse(value)
    if not when:
        return ''
    local = when.astimezone(PHT)
    return f"{local.strftime('%B')} {local.day}, {local.year}"


def format_datetime(value: Any) -> str:
    when = _parse(value) or _now()
    local = when.astimezone(PHT)
    return f"{local.strftime('%B')} {local.day}, {local.year}, {local.strftime('%I:%M %p').lstrip('0')} (PHT)"


def _email_service():
    """An EmailService, or None when email is not configured. Housekeeping must never fail because of email."""
    try:
        from app.utils.email_service import EmailService
        return EmailService()
    except Exception as error:
        logger.warning('Housekeeping emails skipped: %s', error)
        return None


def _notify(db, account_id: Any, title: str, message: str, kind: str, label: str, page: str) -> None:
    try:
        db.create_user_notification(str(account_id), title, message, notification_type=kind, link_label=label, link_page=page)
    except Exception as error:
        logger.warning('Notification "%s" failed: %s', title, error)


def _profile(db, account_id: Any) -> Dict[str, Any]:
    try:
        return db.get_user_by_account_id(str(account_id)) or {}
    except Exception:
        return {}


# ------------------------------------------------------------------------------------------------ 1. claim pickups
def process_claim_pickups(db, now: Optional[datetime] = None) -> Dict[str, int]:
    now = now or _now()
    summary = {'checked': 0, 'started': 0, 'reminded': 0, 'expired': 0, 'errors': 0}
    pickup_days, reminder_days = claim_pickup_days(), claim_reminder_days()
    try:
        rows = db.client.table('claims').select(
            'claim_id,claim_reference,claimant_account_id,reviewed_at,pickup_deadline,pickup_reminder_sent_at'
        ).eq('status', 'approved_for_pickup').limit(BATCH).execute().data or []
    except Exception as error:
        logger.warning('Claim pickup check skipped: %s', error)
        summary['errors'] += 1
        return summary

    for row in rows:
        deadline = _parse(row.get('pickup_deadline'))
        if not deadline:
            # Approved before pickup deadlines existed: the clock starts now, so nobody is closed retroactively.
            try:
                db.client.table('claims').update({'pickup_deadline': _iso(now + timedelta(days=pickup_days))})                     .eq('claim_id', row['claim_id']).eq('status', 'approved_for_pickup').is_('pickup_deadline', 'null').execute()
                summary['started'] += 1
            except Exception as error:
                summary['errors'] += 1
                logger.warning('Pickup deadline could not be started for claim %s: %s', row.get('claim_id'), error)
            continue
        summary['checked'] += 1
        try:
            if now >= deadline:
                if _expire_claim(db, row, deadline):
                    summary['expired'] += 1
            elif not row.get('pickup_reminder_sent_at') and now >= deadline - timedelta(days=pickup_days - reminder_days):
                if _remind_claim(db, row, deadline, now):
                    summary['reminded'] += 1
        except Exception as error:
            summary['errors'] += 1
            logger.exception('Claim pickup step failed for %s: %s', row.get('claim_id'), error)
    return summary


def _remind_claim(db, row: Dict[str, Any], deadline: datetime, now: datetime) -> bool:
    claimed = db.client.table('claims').update({'pickup_reminder_sent_at': _iso(now)}).eq('claim_id', row['claim_id']) \
        .eq('status', 'approved_for_pickup').is_('pickup_reminder_sent_at', 'null').execute().data or []
    if not claimed:
        return False
    context = db.get_claim_email_context(row['claim_id']) or {}
    item = context.get('item_name') or 'your item'
    days_left = max(1, -(-int((deadline - now).total_seconds()) // 86400))
    _notify(db, row['claimant_account_id'], 'Your item is still waiting',
            f'"{item}" is ready for you. Collect it by {format_date(deadline)} with your Handover PIN and ID.',
            'claim_reminder', 'View my claims', 'claim')
    profile = _profile(db, row['claimant_account_id'])
    service = _email_service()
    if service and context.get('email') and email_prefs.allows(profile, 'reminders'):
        service.send_claim_pickup_reminder_email(
            context['email'], context.get('name') or 'there', item, str(context.get('claim_reference') or row['claim_id']), days_left,
            format_date(deadline), unsubscribe_url=email_prefs.unsubscribe_url(row['claimant_account_id'], 'reminders'),
        )
    return True


def _expire_claim(db, row: Dict[str, Any], deadline: datetime) -> bool:
    reason = f'Not collected by the pickup deadline ({format_date(deadline)}). The claim closed automatically.'
    closed = db.client.table('claims').update({'status': 'rejected', 'rejection_reason': reason, 'updated_at': _iso(_now())}) \
        .eq('claim_id', row['claim_id']).eq('status', 'approved_for_pickup').execute().data or []
    if not closed:
        return False  # collected or changed a moment ago
    try:  # the PIN is useless now; failing to wipe it is harmless because the claim is no longer approved
        db.client.table('claims').update({'handover_pin_hash': None, 'handover_pin_encrypted': None}).eq('claim_id', row['claim_id']).execute()
    except Exception as error:
        logger.warning('PIN cleanup failed for expired claim %s: %s', row['claim_id'], error)
    context = db.get_claim_email_context(row['claim_id']) or {}
    item = context.get('item_name') or 'your item'
    _notify(db, row['claimant_account_id'], 'Your claim has closed',
            f'The pickup deadline for "{item}" passed, so the claim closed. You can submit a new claim while the item is still in custody.',
            'claim_update', 'View my claims', 'claim')
    service = _email_service()
    if service and context.get('email'):
        service.send_claim_expired_email(context['email'], context.get('name') or 'there', item, str(context.get('claim_reference') or row['claim_id']), format_date(deadline))
    try:
        db.log_user_activity(account_id=str(row['claimant_account_id']), user_name='System', action='Claim Expired (Automatic)', module='Claims & Verification',
                             target_name=item, target_id=str(context.get('claim_reference') or row['claim_id']))
    except Exception as error:
        logger.warning('Claim expiry activity log failed: %s', error)
    return True


# ------------------------------------------------------------------------------------------------ 2. Smart Tag reminders
def process_tag_expiry_reminders(db, now: Optional[datetime] = None) -> Dict[str, int]:
    now = now or _now()
    summary = {'checked': 0, 'reminded': 0, 'errors': 0}
    window = now + timedelta(days=tag_reminder_days())
    try:
        rows = db.client.table('smart_tags').select('tag_id,item_name,owner_account_id,valid_until,status,is_disabled,expiry_reminder_sent_at') \
            .in_('status', ['active', 'lost']).not_.is_('valid_until', 'null').not_.is_('owner_account_id', 'null') \
            .is_('expiry_reminder_sent_at', 'null').gt('valid_until', _iso(now)).lte('valid_until', _iso(window)).limit(BATCH).execute().data or []
    except Exception as error:
        logger.warning('Smart Tag reminder check skipped: %s', error)
        summary['errors'] += 1
        return summary
    for row in rows:
        if row.get('is_disabled'):
            continue
        summary['checked'] += 1
        try:
            if _remind_tag(db, row, now):
                summary['reminded'] += 1
        except Exception as error:
            summary['errors'] += 1
            logger.exception('Smart Tag reminder failed for %s: %s', row.get('tag_id'), error)
    return summary


def _remind_tag(db, row: Dict[str, Any], now: datetime) -> bool:
    claimed = db.client.table('smart_tags').update({'expiry_reminder_sent_at': _iso(now)}).eq('tag_id', row['tag_id']) \
        .is_('expiry_reminder_sent_at', 'null').execute().data or []
    if not claimed:
        return False
    valid_until = _parse(row['valid_until'])
    days_left = max(1, -(-int((valid_until - now).total_seconds()) // 86400))
    item = row.get('item_name') or 'your item'
    _notify(db, row['owner_account_id'], 'Your Smart Tag expires soon',
            f'The Smart Tag for "{item}" is valid until {format_date(valid_until)}. Visit the Lost and Found Office to renew it.',
            'smart_tag_expiring', 'View my Smart Tags', 'my-tags')
    profile = _profile(db, row['owner_account_id'])
    service = _email_service()
    if service and profile.get('email') and email_prefs.allows(profile, 'reminders'):
        service.send_tag_expiry_reminder_email(
            profile['email'], str(profile.get('fname') or '').strip(), item, str(row['tag_id']), days_left, format_date(valid_until),
            unsubscribe_url=email_prefs.unsubscribe_url(row['owner_account_id'], 'reminders'),
        )
    return True


# ------------------------------------------------------------------------------------------------ 3. evidence retention
def _remove(db, bucket: str, path: Optional[str]) -> None:
    if path:
        db.client.storage.from_(bucket).remove([path])


def _plain(value: Any) -> Optional[str]:
    """A stored path that may be encrypted (older rows): the readable text, or None."""
    if not value:
        return None
    try:  # older rows hold the plain path, newer ones an encrypted one: decrypt_if_present keeps the text when it is not encrypted
        return CryptoService.decrypt_if_present(value) or None
    except Exception:
        return str(value)


def _retention_ready(db) -> bool:
    """True once `evidence_purged_at` (migration 20261013) and the recycle bin (migration 20261014) exist."""
    try:
        db.client.table('claims').select('claim_id,evidence_purged_at').limit(1).execute()
        db.client.table('recycle_bin').select('archive_id').limit(1).execute()
        return True
    except Exception as error:
        logger.warning('File retention is waiting for migrations 20261013 and 20261014: %s', error)
        return False


def purge_old_evidence(db, now: Optional[datetime] = None, days: Optional[int] = None) -> Dict[str, Any]:
    days = retention_days() if days is None else days
    summary: Dict[str, Any] = {'days': days, 'claims': 0, 'verifications': 0, 'errors': 0, 'disabled': days <= 0}
    if days <= 0:
        return summary
    if not _retention_ready(db):
        # Nothing is deleted until migration 20261013 has been run, so no file goes before the records can show it happened.
        summary['waiting_for_migration'] = True
        return summary
    cutoff = (now or _now()) - timedelta(days=days)
    summary['claims'], errors = _purge_claims(db, cutoff)
    summary['errors'] += errors
    summary['verifications'], errors = _purge_verifications(db, cutoff)
    summary['errors'] += errors
    return summary


def _purge_claims(db, cutoff: datetime):
    purged = errors = 0
    try:
        rows = db.client.table('claims').select(
            'claim_id,claim_reference,status,proof_image_path,proof_image_url,identity_document_path,identity_document_name,collected_at,reviewed_at,updated_at,evidence_purged_at'
        ).in_('status', list(CLOSED_CLAIM_STATUSES)).is_('evidence_purged_at', 'null').lte('updated_at', _iso(cutoff)).limit(50).execute().data or []
    except Exception as error:
        logger.warning('Claim evidence purge skipped: %s', error)
        return 0, 1
    for row in rows:
        closed = _parse(row.get('collected_at')) or _parse(row.get('reviewed_at')) or _parse(row.get('updated_at'))
        if not closed or closed > cutoff:
            continue
        archive_id = None
        try:
            proof = row.get('proof_image_path') or db._legacy_claim_storage_path(_plain(row.get('proof_image_url')), 'claim-proof-images')
            files = [('claim-proof-images', proof), ('claim-id-documents', row.get('identity_document_path'))]
            if any(path for _, path in files):
                # Keep a copy in the recycle bin first; if that fails nothing below runs and the claim keeps its files for the next try.
                keep = {key: row.get(key) for key in ('claim_id', 'proof_image_path', 'proof_image_url', 'identity_document_path', 'identity_document_name')}
                archive_id = RecycleBin(db).archive_evidence('claims', keep, files, f"ID document and proof photo of claim {row.get('claim_reference') or row['claim_id']}")
            _remove(db, 'claim-proof-images', proof)
            _remove(db, 'claim-id-documents', row.get('identity_document_path'))
            db.client.table('claims').update({
                'proof_image_path': None, 'proof_image_url': None, 'identity_document_path': None, 'identity_document_name': None,
                'evidence_purged_at': _iso(_now()),
            }).eq('claim_id', row['claim_id']).execute()
            purged += 1
        except Exception as error:
            if archive_id:
                RecycleBin(db).discard(archive_id)   # the move did not finish, so do not leave a second copy in the bin
            errors += 1
            logger.warning('Evidence purge failed for claim %s: %s', row.get('claim_id'), error)
    return purged, errors


def _purge_verifications(db, cutoff: datetime):
    purged = errors = 0
    try:
        rows = db.client.table('user_profiles').select('account_id,fname,lname,email,verification_status,verification_reviewed_at,verification_document_url,verification_document_name,verification_document_bucket') \
            .in_('verification_status', ['verified', 'rejected']).not_.is_('verification_document_url', 'null') \
            .lte('verification_reviewed_at', _iso(cutoff)).limit(50).execute().data or []
    except Exception as error:
        logger.warning('Verification document purge skipped: %s', error)
        return 0, 1
    for row in rows:
        archive_id = None
        try:
            path, bucket = _plain(row.get('verification_document_url')), row.get('verification_document_bucket')
            if path and bucket:
                keep = {key: row.get(key) for key in ('account_id', 'verification_document_url', 'verification_document_name', 'verification_document_bucket')}
                who = f"{row.get('fname') or ''} {row.get('lname') or ''}".strip() or row.get('email') or str(row['account_id'])
                archive_id = RecycleBin(db).archive_evidence('user_profiles', keep, [(str(bucket), path)], f"Verification document of {who}")
                _remove(db, str(bucket), path)
            db.client.table('user_profiles').update({
                'verification_document_url': None, 'verification_document_name': None, 'verification_document_bucket': None,
            }).eq('account_id', row['account_id']).execute()
            purged += 1
        except Exception as error:
            if archive_id:
                RecycleBin(db).discard(archive_id)
            errors += 1
            logger.warning('Verification document purge failed for %s: %s', row.get('account_id'), error)
    return purged, errors


# ------------------------------------------------------------------------------------------------ 4. recycle bin expiry
def process_recycle_bin(db, now: Optional[datetime] = None) -> Dict[str, int]:
    return RecycleBin(db).purge_expired(now)


# ------------------------------------------------------------------------------------------------ all together
def run_housekeeping(db, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Every step, each isolated so one failure cannot stop the others."""
    result: Dict[str, Any] = {}
    for name, step in (('claim_pickups', process_claim_pickups), ('tag_reminders', process_tag_expiry_reminders), ('evidence', purge_old_evidence), ('recycle_bin', process_recycle_bin)):
        try:
            result[name] = step(db, now)
        except Exception as error:
            logger.exception('Housekeeping step %s failed: %s', name, error)
            result[name] = {'errors': 1}
    return result
