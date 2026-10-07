"""Visual analytics for the admin dashboard: lost-item categories, busiest days and months, and how items ended up.

`build_visual_analytics` is a pure function over plain rows so it can be tested without a database; `collect_visual_analytics`
reads the rows from Supabase (paged, only the columns needed) and calls it.
"""
import logging
from collections import Counter
from datetime import date, datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)

WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
TOP_CATEGORIES = 6
MONTHS_SHOWN = 12
PAGE = 1000
MAX_ROWS = 100000

# Found-item statuses grouped by how the story ended.
RETURNED_STATUSES = ('returned', 'collected')
ABANDONED_STATUSES = ('disposed', 'donated', 'abandoned')
AUCTIONED_STATUSES = ('auctioned',)


def _day(value: Any) -> Optional[date]:
    text = str(value or '')[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _month_keys(today: date) -> List[str]:
    index = today.year * 12 + today.month - 1
    return [f'{(i // 12):04d}-{(i % 12) + 1:02d}' for i in range(index - MONTHS_SHOWN + 1, index + 1)]


def _month_label(key: str) -> str:
    return datetime.strptime(key, '%Y-%m').strftime('%b %Y')


def build_visual_analytics(missing_rows: Iterable[Dict[str, Any]], outcome_counts: Dict[str, int], today: Optional[date] = None) -> Dict[str, Any]:
    """`missing_rows`: dicts with category, last_seen_date, created_at. `outcome_counts`: found-item count per status."""
    today = today or datetime.now(timezone.utc).date()
    keys = _month_keys(today)
    categories: Counter = Counter()
    weekdays = [0] * 7
    months = {key: 0 for key in keys}
    heat = {key: [0] * 7 for key in keys}
    total = 0

    for row in missing_rows:
        total += 1
        categories[str(row.get('category') or 'General').strip() or 'General'] += 1
        when = _day(row.get('last_seen_date')) or _day(row.get('created_at'))
        if not when:
            continue
        weekdays[when.weekday()] += 1
        key = f'{when.year:04d}-{when.month:02d}'
        if key in months:
            months[key] += 1
            heat[key][when.weekday()] += 1

    ranked = categories.most_common()
    top = [{'name': name, 'value': count} for name, count in ranked[:TOP_CATEGORIES]]
    rest = sum(count for _, count in ranked[TOP_CATEGORIES:])
    if rest:
        top.append({'name': 'Other', 'value': rest})

    lost_by_weekday = [{'day': WEEKDAYS[i], 'name': WEEKDAY_NAMES[i], 'count': weekdays[i]} for i in range(7)]
    lost_by_month = [{'key': key, 'month': _month_label(key), 'count': months[key]} for key in keys]
    busiest_day = max(lost_by_weekday, key=lambda entry: entry['count']) if any(weekdays) else None
    busiest_month = max(lost_by_month, key=lambda entry: entry['count']) if any(months.values()) else None

    def group(statuses):
        return sum(int(outcome_counts.get(status, 0) or 0) for status in statuses)

    returned, auctioned, abandoned = group(RETURNED_STATUSES), group(AUCTIONED_STATUSES), group(ABANDONED_STATUSES)
    total_found = sum(int(v or 0) for v in outcome_counts.values())
    closed = returned + auctioned + abandoned
    return {
        'lost_total': total,
        'lost_categories': top,
        'lost_by_weekday': lost_by_weekday,
        'lost_by_month': lost_by_month,
        'lost_heatmap': {
            'weekdays': WEEKDAYS,
            'months': [{'key': key, 'label': _month_label(key), 'counts': heat[key]} for key in keys],
            'max': max((max(counts) for counts in heat.values()), default=0),
        },
        'busiest': {'weekday': busiest_day['name'] if busiest_day else None, 'month': busiest_month['month'] if busiest_month else None},
        'outcomes': {
            'returned': returned,
            'auctioned': auctioned,
            'abandoned': abandoned,
            'in_custody': max(total_found - closed, 0),
            'total_found': total_found,
            'return_rate': round(returned / total_found * 100, 1) if total_found else 0,
        },
    }


def _paged(db, table: str, columns: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    offset = 0
    while offset < MAX_ROWS:
        batch = db.client.table(table).select(columns).range(offset, offset + PAGE - 1).execute().data or []
        rows.extend(batch)
        if len(batch) < PAGE:
            break
        offset += PAGE
    return rows


def collect_visual_analytics(db) -> Dict[str, Any]:
    missing = _paged(db, 'missing_items', 'category,last_seen_date,created_at')
    outcome_counts: Dict[str, int] = {}
    for row in _paged(db, 'found_items', 'status'):
        status = str(row.get('status') or 'unclaimed').strip().lower() or 'unclaimed'
        outcome_counts[status] = outcome_counts.get(status, 0) + 1
    result = build_visual_analytics(missing, outcome_counts)

    # Handover and auction forfeits come from newer columns: leave them out quietly on a database that has not been migrated.
    result['handover'] = {'released': None, 'awaiting': None}
    try:
        released = db.client.table('claims').select('claim_id', count='exact').eq('status', 'collected').execute()
        awaiting = db.client.table('claims').select('claim_id', count='exact').eq('status', 'approved_for_pickup').execute()
        result['handover'] = {'released': int(released.count or 0), 'awaiting': int(awaiting.count or 0)}
    except Exception as error:
        logger.warning('Handover totals unavailable: %s', error)
    result['outcomes']['auction_forfeits'] = None
    try:
        forfeits = db.client.table('auctions').select('auction_id', count='exact').not_.is_('auto_forfeited_at', 'null').execute()
        result['outcomes']['auction_forfeits'] = int(forfeits.count or 0)
    except Exception:
        pass
    result['generated_at'] = datetime.now(timezone.utc).isoformat()
    return result
