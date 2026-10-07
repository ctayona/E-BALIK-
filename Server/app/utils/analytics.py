"""Visual analytics for the admin dashboard: lost-item categories, busiest days and months, campus hotspots and how items ended up.

`build_visual_analytics` is a pure function over plain rows so it can be tested without a database; `collect_visual_analytics`
reads the rows from Supabase (paged, only the columns needed) and calls it. An optional date range limits every figure to
lost reports (and found items) dated inside it.
"""
import logging
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

logger = logging.getLogger(__name__)

WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
TOP_CATEGORIES = 6
TOP_LOCATIONS = 8
MONTHS_DEFAULT = 12
MONTHS_MAX = 24
MAX_SPAN_DAYS = 3650
PAGE = 1000
MAX_ROWS = 100000
RANGE_KEYS = ('30d', '90d', '12m', 'all')

# Found-item statuses grouped by how the story ended.
RETURNED_STATUSES = ('returned', 'collected')
ABANDONED_STATUSES = ('disposed', 'donated', 'abandoned')
AUCTIONED_STATUSES = ('auctioned',)


class RangeError(ValueError):
    """The requested date range makes no sense; the message is safe to show to the admin."""


def _day(value: Any) -> Optional[date]:
    text = str(value or '')[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _month_index(day: date) -> int:
    return day.year * 12 + day.month - 1


def _month_keys(first: date, last: date) -> List[str]:
    low, high = _month_index(first), _month_index(last)
    if high - low + 1 > MONTHS_MAX:
        low = high - MONTHS_MAX + 1
    return [f'{(i // 12):04d}-{(i % 12) + 1:02d}' for i in range(low, high + 1)]


def _month_label(key: str) -> str:
    return datetime.strptime(key, '%Y-%m').strftime('%b %Y')


def _clean_place(value: Any) -> str:
    return ' '.join(str(value or '').split())[:80]


def resolve_range(range_key: Optional[str] = None, start: Any = None, end: Any = None, today: Optional[date] = None) -> Tuple[Optional[date], Optional[date], str]:
    """Turn the request into (start, end, key). `all` has no start; explicit dates win over a preset."""
    today = today or datetime.now(timezone.utc).date()
    if start or end:
        first, last = _day(start) if start else None, _day(end) if end else today
        if (start and not first) or (end and not last):
            raise RangeError('Use dates like 2026-10-01.')
        last = last or today
        if first and first > last:
            raise RangeError('The start date must be before the end date.')
        if first and (last - first).days > MAX_SPAN_DAYS:
            raise RangeError('Choose a range of 10 years or less.')
        return first, last, 'custom'
    key = range_key if range_key in RANGE_KEYS else '12m'
    if key == 'all':
        return None, today, key
    days = {'30d': 30, '90d': 90, '12m': 365}[key]
    return today - timedelta(days=days - 1), today, key


def build_visual_analytics(
    missing_rows: Iterable[Dict[str, Any]],
    outcome_counts: Dict[str, int],
    today: Optional[date] = None,
    start: Optional[date] = None,
    end: Optional[date] = None,
    found_rows: Iterable[Dict[str, Any]] = (),
) -> Dict[str, Any]:
    """`missing_rows`: dicts with category, last_seen_date, created_at, last_location. `outcome_counts`: found-item count per status.

    `found_rows` (optional, dicts with `location`) only feed the hotspot list. `start`/`end` limit lost reports by their date.
    """
    today = today or datetime.now(timezone.utc).date()
    last_day = end or today
    if start:
        keys = _month_keys(start, last_day)
    else:  # no range: the usual rolling twelve months
        index = _month_index(last_day)
        keys = [f'{(i // 12):04d}-{(i % 12) + 1:02d}' for i in range(index - MONTHS_DEFAULT + 1, index + 1)]

    categories: Counter = Counter()
    places: Dict[str, Dict[str, Any]] = {}
    weekdays = [0] * 7
    months = {key: 0 for key in keys}
    heat = {key: [0] * 7 for key in keys}
    total = 0

    def add_place(name: str, kind: str) -> None:
        if not name:
            return
        entry = places.setdefault(name.lower(), {'location': name, 'lost': 0, 'found': 0})
        entry[kind] += 1

    for row in missing_rows:
        when = _day(row.get('last_seen_date')) or _day(row.get('created_at'))
        if (start or end) and (not when or (start and when < start) or (end and when > end)):
            continue
        total += 1
        categories[str(row.get('category') or 'General').strip() or 'General'] += 1
        add_place(_clean_place(row.get('last_location')), 'lost')
        if not when:
            continue
        weekdays[when.weekday()] += 1
        key = f'{when.year:04d}-{when.month:02d}'
        if key in months:
            months[key] += 1
            heat[key][when.weekday()] += 1

    for row in found_rows:
        add_place(_clean_place(row.get('location')), 'found')

    ranked = categories.most_common()
    top = [{'name': name, 'value': count} for name, count in ranked[:TOP_CATEGORIES]]
    rest = sum(count for _, count in ranked[TOP_CATEGORIES:])
    if rest:
        top.append({'name': 'Other', 'value': rest})

    hotspots = sorted(places.values(), key=lambda p: (-(p['lost'] + p['found']), -p['lost'], p['location'].lower()))[:TOP_LOCATIONS]
    hotspots = [{**p, 'total': p['lost'] + p['found']} for p in hotspots]

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
        'hotspots': hotspots,
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


def collect_visual_analytics(db, range_key: Optional[str] = None, start: Any = None, end: Any = None) -> Dict[str, Any]:
    first, last, key = resolve_range(range_key, start, end)
    missing = _paged(db, 'missing_items', 'category,last_seen_date,created_at,last_location')
    found_all = _paged(db, 'found_items', 'status,created_at,found_date,location')

    def in_range(row: Dict[str, Any]) -> bool:
        when = _day(row.get('found_date')) or _day(row.get('created_at'))
        return bool(when) and (not first or when >= first) and (not last or when <= last)

    found = found_all if key == 'all' else [row for row in found_all if in_range(row)]
    outcome_counts: Dict[str, int] = {}
    for row in found:
        status = str(row.get('status') or 'unclaimed').strip().lower() or 'unclaimed'
        outcome_counts[status] = outcome_counts.get(status, 0) + 1
    result = build_visual_analytics(missing, outcome_counts, start=first, end=last if key != 'all' else None, found_rows=found)
    result['range'] = {'key': key, 'start': first.isoformat() if first else None, 'end': last.isoformat() if last else None}

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
