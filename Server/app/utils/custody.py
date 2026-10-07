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

FOUND_COLUMNS = 'item_id,fpost_id,item_name,category,location,turnover_location,found_date,created_at,status,guard_name_or_id,handover_guard_id,image_url'
FOUND_COLUMNS_NO_GUARD = FOUND_COLUMNS.replace('handover_guard_id,', '')

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
            'minCustodyDays': MIN_CUSTODY_DAYS,
        },
    }


def load_overview(client, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Read the held items with their claims and auctions from the database and build the overview."""
    try:
        items = client.table('found_items').select(FOUND_COLUMNS).in_('status', list(HELD_STATUSES)).order('created_at').limit(1000).execute().data or []
    except Exception as error:
        if 'handover_guard_id' not in str(error):
            raise
        items = client.table('found_items').select(FOUND_COLUMNS_NO_GUARD).in_('status', list(HELD_STATUSES)).order('created_at').limit(1000).execute().data or []
    ids = [str(item['item_id']) for item in items]
    claims: List[Dict[str, Any]] = []
    auctions: List[Dict[str, Any]] = []
    for chunk in _chunks(ids):
        claims += client.table('claims').select('claim_id,found_item_id,status').in_('found_item_id', chunk) \
            .in_('status', ['pending', 'under_review', 'in_review', 'review', 'approved_for_pickup']).execute().data or []
        try:
            auctions += client.table('auctions').select('auction_id,found_item_id,status,fulfillment_status,winner_account_id,created_at') \
                .in_('found_item_id', chunk).in_('status', ['scheduled', 'active', 'awaiting_admin', 'ended']).execute().data or []
        except Exception as error:
            logger.info('Custody overview without auctions: %s', error)   # the auction migrations have not run on this database
    return build_overview(items, claims, auctions, now)
