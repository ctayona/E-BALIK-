"""The handover log of every found item: who had it, when, and what happened to it.

New facts are written to `custody_log` as they happen (turned over, received by the guard, claim approved, released, auction steps...).
Older items have no log rows, so `timeline` also rebuilds what it can from timestamps the database already keeps (when the report was
made, when a guard confirmed receipt, when each claim was filed, approved and collected). A rebuilt event is only added when the log has
no event of that kind for the item, so nothing appears twice.

Writing the log never blocks the action it describes: a missing table or a database error is logged and the action goes on.
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)

LABELS = {
    'turned_over': 'Turned over',
    'registered': 'Registered by the office',
    'received': 'Received by the guard',
    'tag_matched': 'Matched to a Smart Tag',
    'claim_filed': 'Claim filed',
    'claim_approved': 'Claim approved',
    'claim_rejected': 'Claim rejected',
    'claim_expired': 'Claim expired',
    'released': 'Released to the owner',
    'completed': 'Marked completed',
    'auction_listed': 'Put up for auction',
    'auction_confirmed': 'Auction winner confirmed',
    'auction_cancelled': 'Auction cancelled',
    'auction_completed': 'Sold and collected',
    'auction_forfeited': 'Sale forfeited',
    'returned_to_custody': 'Back in custody',
}
# Rebuilt from timestamps when the log has nothing of this kind for the item.
REBUILT = ('turned_over', 'received', 'claim_filed', 'claim_approved', 'claim_rejected', 'released')


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _name(profile: Optional[Dict[str, Any]]) -> str:
    if not profile:
        return ''
    return f"{profile.get('fname') or ''} {profile.get('lname') or ''}".strip()


def record(client, found_item_id: Any, event: str, actor_id: Any = None, actor_label: str = '', detail: str = '') -> bool:
    """Add one line to an item's handover log. Never raises; returns whether the line was saved."""
    if not found_item_id or event not in LABELS:
        return False
    try:
        client.table('custody_log').insert({
            'found_item_id': str(found_item_id), 'event': event, 'actor_account_id': str(actor_id) if actor_id else None,
            'actor_label': (actor_label or '')[:200] or None, 'detail': (detail or '')[:500] or None, 'created_at': _now_iso(),
        }).execute()
        return True
    except Exception as error:
        logger.info('Custody log line "%s" was not saved: %s', event, str(error)[:160])
        return False


def _profiles(client, ids: Iterable[Any]) -> Dict[str, Dict[str, Any]]:
    wanted = sorted({str(i) for i in ids if i})
    if not wanted:
        return {}
    try:
        rows = client.table('user_profiles').select('account_id,fname,lname').in_('account_id', wanted).execute().data or []
    except Exception:
        return {}
    return {str(row['account_id']): row for row in rows}


ITEM_COLUMNS = ('item_id,fpost_id,item_name,category,description,location,turnover_location,found_date,created_at,status,guard_name_or_id,'
                'reporter_account_id,account_id,image_url')


def _item(client, reference: str) -> Optional[Dict[str, Any]]:
    columns = ITEM_COLUMNS + ',handover_guard_id,received_at,received_by,smart_tag_id'
    try:
        rows = client.table('found_items').select(columns).eq('fpost_id', reference).limit(1).execute().data or []
    except Exception:
        rows = client.table('found_items').select(ITEM_COLUMNS).eq('fpost_id', reference).limit(1).execute().data or []   # before migration 20261017
    return rows[0] if rows else None


def timeline(client, reference: str) -> Optional[Dict[str, Any]]:
    """The item and its events, oldest first. None when the item does not exist."""
    item = _item(client, reference)
    if not item:
        return None
    try:
        log = client.table('custody_log').select('log_id,event,actor_account_id,actor_label,detail,created_at').eq('found_item_id', item['item_id']).order('created_at').limit(500).execute().data or []
    except Exception:
        log = []
    try:
        claims = client.table('claims').select('claim_id,claim_reference,claimant_account_id,status,created_at,reviewed_at,reviewed_by,collected_at,released_by,rejection_reason') \
            .eq('found_item_id', item['item_id']).order('created_at').limit(200).execute().data or []
    except Exception:
        claims = []
    people = _profiles(client, [item.get('reporter_account_id') or item.get('account_id'), item.get('received_by')] + [log_row.get('actor_account_id') for log_row in log]
                       + [c.get(k) for c in claims for k in ('claimant_account_id', 'reviewed_by', 'released_by')])

    events: List[Dict[str, Any]] = []
    for row in log:
        actor = row.get('actor_label') or _name(people.get(str(row.get('actor_account_id') or '')))
        events.append({'type': row['event'], 'label': LABELS.get(row['event'], row['event']), 'at': row.get('created_at'), 'actor': actor, 'detail': row.get('detail') or ''})
    logged = {event['type'] for event in events}

    def add(kind: str, at: Any, actor: str, detail: str) -> None:
        if kind in REBUILT and kind in logged or not at:
            return
        events.append({'type': kind, 'label': LABELS[kind], 'at': at, 'actor': actor, 'detail': detail})

    finder = _name(people.get(str(item.get('reporter_account_id') or item.get('account_id') or '')))
    guard = item.get('guard_name_or_id') or ''
    add('turned_over', item.get('created_at'), finder,
        f"Found at {item.get('location') or 'an unknown place'}; handed to {guard or 'security'} at {item.get('turnover_location') or 'the office'}.")
    add('received', item.get('received_at'), _name(people.get(str(item.get('received_by') or ''))) or guard, 'The guard confirmed they have the item.')
    for claim in claims:
        reference_text = claim.get('claim_reference') or 'a claim'
        status = str(claim.get('status') or '').lower()
        add('claim_filed', claim.get('created_at'), _name(people.get(str(claim.get('claimant_account_id') or ''))), f'Claim {reference_text} was filed.')
        if status in ('approved_for_pickup', 'approved', 'collected'):
            add('claim_approved', claim.get('reviewed_at'), _name(people.get(str(claim.get('reviewed_by') or ''))), f'Claim {reference_text} was approved for pickup.')
        if status == 'rejected':
            add('claim_rejected', claim.get('reviewed_at'), _name(people.get(str(claim.get('reviewed_by') or ''))), claim.get('rejection_reason') or f'Claim {reference_text} was rejected.')
        if status == 'collected':
            add('released', claim.get('collected_at'), _name(people.get(str(claim.get('released_by') or ''))), f'Released to the owner (claim {reference_text}).')
    events.sort(key=lambda event: str(event.get('at') or ''))
    summary = {key: item.get(key) for key in ('fpost_id', 'item_name', 'category', 'description', 'location', 'turnover_location', 'found_date', 'status', 'guard_name_or_id', 'image_url', 'received_at', 'smart_tag_id')}
    return {'item': summary, 'events': events}
