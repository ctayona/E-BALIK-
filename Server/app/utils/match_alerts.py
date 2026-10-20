"""Match alerts: tell people the moment a possible match appears, instead of waiting for them to open Matches.

Two triggers (both best effort, never raise, never block the report that caused them):
  * a found item is registered  -> every owner of an open lost report that scores well against it gets an in-app notice (and an email
    for a strong match, unless they switched "match alerts" off);
  * a lost report is filed      -> its owner is told if items already at the office look like it.
A pair is alerted once (the notice itself is the memory: same person, same found item, same lost report).
Scores come from `matching.match_percentage`. A notice never names the other person: only the item, where it was found and the score.
"""
import logging
from typing import Any, Dict, List, Optional

from app.utils import email_prefs
from app.utils.matching import match_percentage

logger = logging.getLogger(__name__)

ALERT_MIN = 55.0        # "matched" everywhere else in the app
EMAIL_MIN = 72.0        # only a strong match is worth an email
MAX_RECIPIENTS = 30     # one new item can alert at most this many people
MAX_LISTED = 3          # matches named in the notice for a new lost report
NOTICE_TYPE = 'match_alert'

_MISSING_COLUMNS = 'item_id,mpost_id,account_id,item_name,category,description,distinctive_marks,last_location,last_seen_date,status'
_FOUND_COLUMNS = 'item_id,fpost_id,account_id,item_name,category,description,location,found_date,status'


def _already_alerted(db, owner_id: str, found_id: str, missing_id: str) -> bool:
    try:
        rows = db.client.table('user_notifications').select('notification_id').eq('user_account_id', owner_id) \
            .eq('found_item_id', found_id).eq('missing_report_id', missing_id).eq('notification_type', NOTICE_TYPE).limit(1).execute().data or []
        return bool(rows)
    except Exception as error:
        logger.info('Match alert history unreadable, alerting anyway: %s', str(error)[:100])
        return False


def _notify(db, owner_id: str, found: Dict[str, Any], missing: Dict[str, Any], score: float, listed: Optional[List[Dict[str, Any]]] = None) -> bool:
    name = missing.get('item_name') or 'your lost item'
    if listed:
        names = ', '.join(f'"{item.get("item_name")}"' for item in listed)
        text = f'The Lost and Found Office already has {len(listed)} item{"s" if len(listed) != 1 else ""} that may be yours: {names}. The best match is {score:.0f}%. Open Matches to compare.'
        title = f'Possible matches for "{name}"'
    else:
        where = f' It was found at {found.get("location")}.' if found.get('location') else ''
        text = f'An item that looks like "{name}" was just handed in: "{found.get("item_name")}" ({score:.0f}% match).{where} Open Matches to compare it with your report.'
        title = f'A possible match for "{name}"'
    try:
        db.create_user_notification(
            owner_id, title, text, found_item_id=found.get('item_id'), missing_report_id=missing.get('item_id'),
            notification_type=NOTICE_TYPE, link_label='Review matches', link_page='matches',
        )
        return True
    except Exception as error:
        logger.warning('Match alert notice failed: %s', error)
        return False


def _email(db, owner_id: str, found: Dict[str, Any], missing: Dict[str, Any], score: float) -> bool:
    try:
        profile = db.get_user_by_account_id(owner_id) or {}
        if not profile.get('email') or not email_prefs.allows(profile, 'matches'):
            return False
        from app.utils.email_service import send_notice_email_best_effort, site_url
        return bool(send_notice_email_best_effort(
            profile['email'], f'A possible match for your lost {missing.get("item_name") or "item"}',
            unsubscribe_url=email_prefs.unsubscribe_url(owner_id, 'matches'), unsubscribe_label='match alerts',
            title='A possible match was found', preheader=f'{score:.0f}% match with your lost report {missing.get("mpost_id") or ""}',
            greeting=f"Hello {str(profile.get('fname') or '').strip() or 'there'},",
            paragraphs=['An item was just handed in to the Lost and Found Office that looks like the one you reported. Open E-Balik to compare the two and, if it is yours, file a claim.'],
            highlight=('Match', f'{score:.0f}%'), highlight_note=f'with your report {missing.get("mpost_id") or ""}',
            details={'Your report': missing.get('item_name'), 'Item found': found.get('item_name'), 'Found at': found.get('location'), 'Date found': found.get('found_date')},
            cta=('Review the match', site_url()),
            notes=['Only you can see this alert. We never share your details with the finder.'],
        ))
    except Exception as error:
        logger.warning('Match alert email failed: %s', error)
        return False


def alert_for_new_found_item(db, found: Dict[str, Any]) -> int:
    """A found item was registered: alert the owners of open lost reports that match it. Returns how many were alerted."""
    try:
        if not found or not found.get('item_id'):
            return 0
        rows = db.client.table('missing_items').select(_MISSING_COLUMNS).eq('status', 'missing').order('created_at', desc=True).limit(1000).execute().data or []
        scored = sorted(
            ((match_percentage(missing, found), missing) for missing in rows if str(missing.get('account_id')) != str(found.get('account_id'))),
            key=lambda pair: pair[0], reverse=True,
        )
        alerted = 0
        for score, missing in scored:
            if score < ALERT_MIN or alerted >= MAX_RECIPIENTS:
                break
            owner = str(missing['account_id'])
            if _already_alerted(db, owner, str(found['item_id']), str(missing['item_id'])):
                continue
            if _notify(db, owner, found, missing, score):
                alerted += 1
                if score >= EMAIL_MIN:
                    _email(db, owner, found, missing, score)
        return alerted
    except Exception as error:
        logger.warning('Match alerts for found item %s failed: %s', (found or {}).get('fpost_id'), error)
        return 0


def alert_for_new_missing_report(db, missing: Dict[str, Any]) -> int:
    """A lost report was filed: if items at the office already look like it, tell the owner once. Returns 1 when alerted, else 0."""
    try:
        if not missing or not missing.get('item_id') or not missing.get('account_id'):
            return 0
        rows = db.client.table('found_items').select(_FOUND_COLUMNS).eq('status', 'unclaimed').order('created_at', desc=True).limit(1000).execute().data or []
        scored = sorted(
            ((match_percentage(missing, found), found) for found in rows if str(found.get('account_id')) != str(missing.get('account_id'))),
            key=lambda pair: pair[0], reverse=True,
        )
        good = [(score, found) for score, found in scored if score >= ALERT_MIN][:MAX_LISTED]
        if not good:
            return 0
        owner = str(missing['account_id'])
        best_score, best = good[0]
        if _already_alerted(db, owner, str(best['item_id']), str(missing['item_id'])):
            return 0
        if not _notify(db, owner, best, missing, best_score, listed=[found for _, found in good]):
            return 0
        if best_score >= EMAIL_MIN:
            _email(db, owner, best, missing, best_score)
        return 1
    except Exception as error:
        logger.warning('Match alerts for lost report %s failed: %s', (missing or {}).get('mpost_id'), error)
        return 0
