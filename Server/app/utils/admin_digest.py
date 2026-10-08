"""The daily summary email for administrators: what is waiting for a decision, in one message at the start of the working day.

The admin menu badges only help while someone has the console open. This is the same list pushed to the inbox: claims waiting for review
(and the ones waiting too long), IDs to verify, Smart Tags to approve, auction results to confirm, approved claims about to expire, items a
guard has not yet confirmed receiving, and items old enough to auction.

It is sent at most once per Makati day (the day is claimed with a row in `system_settings`, so overlapping scheduler runs, a second server
and the external cron all agree), only when something is waiting, and only to active administrators who have not switched it off
(the `admin_digest` email preference). It runs from the scheduler; `ADMIN_DIGEST_HOUR` (default 8, Makati time) sets the earliest hour.
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.utils import admin_badges, custody, email_prefs
from app.utils.localtime import PHT, now_pht

logger = logging.getLogger(__name__)

DUE_SOON_DAYS = 3
RECEIPT_WAIT_DAYS = 2


def digest_hour() -> int:
    try:
        return max(0, min(int(os.getenv('ADMIN_DIGEST_HOUR') or 8), 23))
    except ValueError:
        return 8


def _parse(value: Any) -> Optional[datetime]:
    try:
        moment = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def build_digest(client, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Everything that is waiting, as numbers and short lists. `attention` is what decides whether an email is worth sending."""
    now = now or datetime.now(timezone.utc)
    counts = admin_badges.pending_counts(client)
    summary: Dict[str, Any] = {}
    overdue: List[Dict[str, Any]] = []
    try:
        overview = custody.load_overview(client, now)
        summary = overview['summary']
        overdue = [{'reference': row['reference'], 'item': row['item'], 'days': row['claimWaitingDays']} for row in overview['items'] if row['claimOverdue']][:5]
        late_receipts = sum(1 for row in overview['items'] if row['receipt'] == 'waiting' and row['daysHeld'] >= RECEIPT_WAIT_DAYS)
    except Exception as error:
        logger.info('Digest without the custody overview: %s', error)
        late_receipts = 0
    due_soon: List[Dict[str, Any]] = []
    try:
        horizon = (now + timedelta(days=DUE_SOON_DAYS)).isoformat()
        rows = client.table('claims').select('claim_reference,pickup_deadline').eq('status', 'approved_for_pickup').lt('pickup_deadline', horizon).limit(50).execute().data or []
        due_soon = [{'reference': r.get('claim_reference') or 'claim', 'deadline': r.get('pickup_deadline')} for r in rows]
    except Exception as error:
        logger.info('Digest without pickup deadlines: %s', error)
    attention = sum(counts.values()) + len(due_soon) + late_receipts
    return {
        'counts': counts, 'overdue': overdue, 'dueSoon': due_soon, 'dueSoonDays': DUE_SOON_DAYS, 'lateReceipts': late_receipts,
        'overdueClaims': int(summary.get('overdueClaims') or 0), 'auctionReady': int(summary.get('auctionEligible') or 0),
        'inCustody': int(summary.get('total') or 0), 'attention': attention,
    }


def _recipients(client) -> List[Dict[str, Any]]:
    try:
        rows = client.table('user_profiles').select('account_id,fname,email,access_level,is_active,email_preferences').in_('access_level', ['admin', 'super_admin']).limit(200).execute().data or []
    except Exception as error:
        logger.warning('Daily summary recipients unavailable: %s', error)
        return []
    return [r for r in rows if r.get('is_active') is not False and r.get('email') and email_prefs.allows(r, 'admin_digest')]


def _claim_today(client, day: str) -> bool:
    """True for the one run that claims today's summary. The key is unique, so a second insert fails and that run does nothing."""
    try:
        client.table('system_settings').insert({'setting_key': f'admin_digest:{day}', 'setting_value': {'claimed_at': datetime.now(timezone.utc).isoformat()}}).execute()
        return True
    except Exception as error:
        text = str(error).lower()
        if 'duplicate' not in text and '23505' not in text:
            logger.info('Daily summary not sent (settings unavailable): %s', str(error)[:140])
        return False


def process_admin_digest(db, now: Optional[datetime] = None) -> Dict[str, int]:
    """Send today's summary if it is time, something is waiting and nobody sent it yet. Safe to call every few minutes."""
    local = (now or datetime.now(timezone.utc)).astimezone(PHT)
    result = {'sent': 0, 'recipients': 0, 'skipped': 0}
    if local.hour < digest_hour():
        result['skipped'] = 1
        return result
    digest = build_digest(db.client, local.astimezone(timezone.utc))
    if digest['attention'] <= 0:
        result['skipped'] = 1
        return result
    people = _recipients(db.client)
    if not people:
        result['skipped'] = 1
        return result
    if not _claim_today(db.client, local.date().isoformat()):
        result['skipped'] = 1
        return result
    try:
        from app.utils.email_service import EmailService
        service = EmailService()
    except Exception as error:
        logger.warning('Daily summary skipped, email service unavailable: %s', error)
        return result
    result['recipients'] = len(people)
    for person in people:
        if service.send_admin_digest_email(person['email'], str(person.get('fname') or '').strip(), digest, local.strftime('%A, %B %d').replace(' 0', ' '),
                                           email_prefs.unsubscribe_url(person['account_id'], 'admin_digest')):
            result['sent'] += 1
    return result
