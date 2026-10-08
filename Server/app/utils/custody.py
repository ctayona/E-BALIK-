"""The admin "In custody" view: every found item the office is still holding, and what is happening to each one.

One row per item with a plain-language state (waiting for the owner, claim to review, approved and waiting for pickup, in auction, sold and
waiting for pickup, on hold), how long it has been held, who received it, and whether it is old enough to auction. Read only.
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)

# Found-item statuses that mean "the office still has it".
HELD_STATUSES = ('unclaimed', 'pending', 'review', 'ready_to_release', 'claimed', 'auctioned')
MIN_CUSTODY_DAYS = 30

BASE_COLUMNS = 'item_id,fpost_id,item_name,category,location,turnover_location,found_date,created_at,status,guard_name_or_id,image_url'
# Newest first; an older database that lacks a column falls back to the next set instead of failing.
COLUMN_SETS = (BASE_COLUMNS + ',handover_guard_id,received_at,smart_tag_id', BASE_COLUMNS + ',handover_guard_id', BASE_COLUMNS)
# A claim waiting this long for a decision is flagged (and listed in the daily summary email).
CLAIM_REVIEW_STALE_DAYS = 7

STATE_LABELS = {
    'waiting': 'Waiting for the owner',
    'claim_review': 'Claim to review',
    'claim_approved': 'Approved, waiting for pickup',
    'hold': 'On hold',
    'auction': 'In auction',
    'auction_review': 'Auction result to confirm',
    'sold_pickup': 'Sold, waiting for pickup',
}
# What an administrator should do next, shown as a short hint (and used to sort: lower number needs attention sooner).
ATTENTION = {'claim_review': 1, 'auction_review': 1, 'claim_approved': 2, 'sold_pickup': 2, 'hold': 3, 'waiting': 4, 'auction': 5}


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _chunks(values: List[str], size: int = 100) -> Iterable[List[str]]:
    for start in range(0, len(values), size):
        yield values[start:start + size]


def derive_state(item: Dict[str, Any], claims: List[Dict[str, Any]], auctions: List[Dict[str, Any]]) -> str:
    """The one state that matters most for an item, from its status, its open claims and its newest auction."""
    for auction in auctions:
        status = str(auction.get('status') or '').lower()
        if status in ('scheduled', 'active'):
            return 'auction'
        if status == 'awaiting_admin':
            return 'auction_review'
        if status == 'ended' and auction.get('winner_account_id') and str(auction.get('fulfillment_status') or '') == 'awaiting_pickup':
            return 'sold_pickup'
    claim_statuses = {str(claim.get('status') or '').lower() for claim in claims}
    if 'approved_for_pickup' in claim_statuses:
        return 'claim_approved'
    if claim_statuses & {'pending', 'under_review', 'in_review', 'review'}:
        return 'claim_review'
    if str(item.get('status') or '').lower() in ('pending', 'review'):
        return 'hold'
    return 'waiting'


def build_overview(items: List[Dict[str, Any]], claims: List[Dict[str, Any]], auctions: List[Dict[str, Any]], now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    claims_by_item: Dict[str, List[Dict[str, Any]]] = {}
    for claim in claims:
        claims_by_item.setdefault(str(claim.get('found_item_id')), []).append(claim)

    def review_wait(item_claims: List[Dict[str, Any]]) -> int:
        """Days the oldest claim still waiting for a decision has waited."""
        waiting = [_parse(c.get('created_at')) for c in item_claims if str(c.get('status') or '').lower() in ('pending', 'under_review', 'in_review', 'review')]
        waiting = [w for w in waiting if w]
        return max((now - min(waiting)).days, 0) if waiting else 0
    auctions_by_item: Dict[str, List[Dict[str, Any]]] = {}
    for auction in sorted(auctions, key=lambda a: str(a.get('created_at') or ''), reverse=True):
        auctions_by_item.setdefault(str(auction.get('found_item_id')), []).append(auction)

    rows: List[Dict[str, Any]] = []
    counts = {key: 0 for key in STATE_LABELS}
    for item in items:
        key = str(item['item_id'])
        state = derive_state(item, claims_by_item.get(key, []), auctions_by_item.get(key, []))
        since = _parse(item.get('created_at')) or now
        days = max((now - since).days, 0)
        counts[state] += 1
        waited = review_wait(claims_by_item.get(key, [])) if state == 'claim_review' else 0
        if not item.get('handover_guard_id'):
            receipt = 'none'
        else:
            receipt = 'received' if item.get('received_at') else 'waiting'
        rows.append({
            'reference': item.get('fpost_id') or '',
            'item': item.get('item_name') or 'Item',
            'category': item.get('category') or '',
            'storage': item.get('turnover_location') or item.get('location') or '',
            'guard': item.get('guard_name_or_id') or '',
            'photo': item.get('image_url') or '',
            'daysHeld': days,
            'state': state,
            'stateLabel': STATE_LABELS[state],
            'openClaims': len(claims_by_item.get(key, [])),
            'claimWaitingDays': waited,
            'claimOverdue': waited >= CLAIM_REVIEW_STALE_DAYS,
            'receipt': receipt,   # none: no guard was chosen; waiting: the guard has not confirmed yet; received
            'smartTag': item.get('smart_tag_id') or '',
            'auctionEligible': state == 'waiting' and days >= MIN_CUSTODY_DAYS,
        })
    rows.sort(key=lambda row: (ATTENTION[row['state']], -row['daysHeld']))
    return {
        'items': rows,
        'summary': {
            'total': len(rows),
            'needsReview': counts['claim_review'] + counts['auction_review'],
            'awaitingPickup': counts['claim_approved'] + counts['sold_pickup'],
            'inAuction': counts['auction'],
            'waiting': counts['waiting'],
            'onHold': counts['hold'],
            'auctionEligible': sum(1 for row in rows if row['auctionEligible']),
            'overdueClaims': sum(1 for row in rows if row['claimOverdue']),
            'awaitingReceipt': sum(1 for row in rows if row['receipt'] == 'waiting'),
            'minCustodyDays': MIN_CUSTODY_DAYS,
            'staleClaimDays': CLAIM_REVIEW_STALE_DAYS,
        },
    }


def load_overview(client, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Read the held items with their claims and auctions from the database and build the overview."""
    items: List[Dict[str, Any]] = []
    last_error: Optional[Exception] = None
    for columns in COLUMN_SETS:
        try:
            items = client.table('found_items').select(columns).in_('status', list(HELD_STATUSES)).order('created_at').limit(1000).execute().data or []
            last_error = None
            break
        except Exception as error:
            last_error = error
    if last_error is not None:
        raise last_error
    ids = [str(item['item_id']) for item in items]
    claims: List[Dict[str, Any]] = []
    auctions: List[Dict[str, Any]] = []
    for chunk in _chunks(ids):
        claims += client.table('claims').select('claim_id,found_item_id,status,created_at').in_('found_item_id', chunk)             .in_('status', ['pending', 'under_review', 'in_review', 'review', 'approved_for_pickup']).execute().data or []
        try:
            auctions += client.table('auctions').select('auction_id,found_item_id,status,fulfillment_status,winner_account_id,created_at')                 .in_('found_item_id', chunk).in_('status', ['scheduled', 'active', 'awaiting_admin', 'ended']).execute().data or []
        except Exception as error:
            logger.info('Custody overview without auctions: %s', error)   # the auction migrations have not run on this database
    return build_overview(items, claims, auctions, now)
