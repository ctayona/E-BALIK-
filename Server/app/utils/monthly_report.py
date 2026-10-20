"""The monthly report for the Lost and Found Office: what came in, what went back, what it earned and what is still waiting.

One month (Manila days) at a time, with the month before it for comparison. Every section is read separately and left out (None) if its
table does not exist yet, so the report still works on a database that has not had the newest migrations.
"""
import csv
import io
import logging
import re
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from app.utils.system_ops import csv_safe

logger = logging.getLogger(__name__)

CAMPUS_TZ = timezone(timedelta(hours=8))
TOP = 6
PAGE = 1000
MAX_ROWS = 20000
AGE_BUCKETS = (('Up to 30 days', 0, 30), ('31 to 60 days', 31, 60), ('61 to 90 days', 61, 90), ('Over 90 days', 91, 10 ** 6))
_MONTH = re.compile(r'^(\d{4})-(\d{2})$')


def parse_month(value: Any, today: Optional[date] = None) -> date:
    """The first day of the month asked for (YYYY-MM); the current month when blank. Never in the future, never before 2020."""
    now = today or datetime.now(CAMPUS_TZ).date()
    if value in (None, ''):
        return now.replace(day=1)
    match = _MONTH.match(str(value).strip())
    if not match or not 1 <= int(match.group(2)) <= 12:
        raise ValueError('Choose a month like 2026-10.')
    first = date(int(match.group(1)), int(match.group(2)), 1)
    if first > now.replace(day=1):
        raise ValueError('That month has not happened yet.')
    if first < date(2020, 1, 1):
        raise ValueError('Reports start in 2020.')
    return first


def _next(first: date) -> date:
    return (first.replace(day=28) + timedelta(days=4)).replace(day=1)


def _previous(first: date) -> date:
    return (first - timedelta(days=1)).replace(day=1)


def _utc(day: date) -> str:
    return datetime(day.year, day.month, day.day, tzinfo=CAMPUS_TZ).astimezone(timezone.utc).isoformat()


def _count(db, table: str, column: str, first: date, nxt: date, **equals) -> int:
    query = db.client.table(table).select(column, count='exact').gte(column, _utc(first)).lt(column, _utc(nxt))
    for key, value in equals.items():
        query = query.eq(key, value)
    return int(query.limit(1).execute().count or 0)


def _rows(db, table: str, columns: str, column: str, first: date, nxt: date, **equals) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    offset = 0
    while len(rows) < MAX_ROWS:
        query = db.client.table(table).select(columns).gte(column, _utc(first)).lt(column, _utc(nxt))
        for key, value in equals.items():
            query = query.eq(key, value)
        chunk = query.range(offset, offset + PAGE - 1).execute().data or []
        rows += chunk
        if len(chunk) < PAGE:
            break
        offset += PAGE
    return rows


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _top(values: List[Any], limit: int = TOP) -> List[Dict[str, Any]]:
    counts = Counter(str(v).strip() for v in values if str(v or '').strip())
    return [{'name': name, 'count': count} for name, count in counts.most_common(limit)]


def _section(label: str, build):
    try:
        return build()
    except Exception as error:
        logger.info('Monthly report: %s unavailable: %s', label, str(error)[:120])
        return None


def _figures(db, first: date) -> Dict[str, Any]:
    """The numbers that are compared with the month before."""
    nxt = _next(first)
    figures: Dict[str, Any] = {
        'found_received': _section('found', lambda: _count(db, 'found_items', 'created_at', first, nxt)),
        'lost_filed': _section('lost', lambda: _count(db, 'missing_items', 'created_at', first, nxt)),
        'returned': _section('returned', lambda: _count(db, 'claims', 'collected_at', first, nxt, status='collected')),
        'claims_filed': _section('claims', lambda: _count(db, 'claims', 'created_at', first, nxt)),
    }

    def income():
        rows = _rows(db, 'income_ledger', 'source,kind,amount', 'received_at', first, nxt)
        total = {'auction': Decimal('0'), 'smart_tag': Decimal('0'), 'other': Decimal('0')}
        sales = {'auction': 0, 'smart_tag': 0}
        refunds = Decimal('0')
        for row in rows:
            amount = Decimal(str(row.get('amount') or 0))
            total[row.get('source') if row.get('source') in total else 'other'] += amount
            if amount < 0:
                refunds += amount
            if row.get('kind') == 'sale' and row.get('source') in sales:
                sales[row['source']] += 1
        return {'total': float(sum(total.values())), 'auction': float(total['auction']), 'smart_tag': float(total['smart_tag']), 'other': float(total['other']),
                'refunds': float(refunds), 'auctions_sold': sales['auction'], 'tags_sold': sales['smart_tag']}
    figures['income'] = _section('income', income)
    return figures


def build(db, month: Any = None, today: Optional[date] = None) -> Dict[str, Any]:
    first = parse_month(month, today)
    nxt = _next(first)
    now = datetime.now(timezone.utc)
    report: Dict[str, Any] = {'month': first.strftime('%Y-%m'), 'label': first.strftime('%B %Y'), 'generated_at': now.isoformat(), 'start': first.isoformat(), 'end': (nxt - timedelta(days=1)).isoformat()}
    report['figures'] = _figures(db, first)
    report['previous'] = _figures(db, _previous(first))
    report['previous_label'] = _previous(first).strftime('%B %Y')

    def intake():
        found = _rows(db, 'found_items', 'category,location,status', 'created_at', first, nxt)
        lost = _rows(db, 'missing_items', 'category,last_location', 'created_at', first, nxt)
        return {'found_by_category': _top([r.get('category') for r in found]), 'found_by_location': _top([r.get('location') for r in found]),
                'lost_by_category': _top([r.get('category') for r in lost]), 'lost_by_location': _top([r.get('last_location') for r in lost])}
    report['intake'] = _section('intake', intake)

    def claims():
        filed = _rows(db, 'claims', 'status', 'created_at', first, nxt)
        returned = _rows(db, 'claims', 'created_at,collected_at', 'collected_at', first, nxt, status='collected')
        days = [(c - o).total_seconds() / 86400 for r in returned for c, o in [(_parse(r.get('collected_at')), _parse(r.get('created_at')))] if c and o and c >= o]
        return {'filed': len(filed), 'by_status': dict(Counter(str(r.get('status') or 'unknown') for r in filed)), 'returned': len(returned),
                'average_days_to_return': round(sum(days) / len(days), 1) if days else None}
    report['claims'] = _section('claims', claims)

    def waiting():
        today_local = datetime.now(CAMPUS_TZ).date()
        rows = db.client.table('found_items').select('created_at').eq('status', 'unclaimed').limit(MAX_ROWS).execute().data or []
        ages = []
        for row in rows:
            moment = _parse(row.get('created_at'))
            if moment:
                ages.append((today_local - moment.astimezone(CAMPUS_TZ).date()).days)
        return {'total': len(ages), 'buckets': [{'label': label, 'count': sum(1 for a in ages if low <= a <= high)} for label, low, high in AGE_BUCKETS]}
    report['waiting'] = _section('waiting', waiting)

    def alerts():
        return {'sent': _count(db, 'user_notifications', 'created_at', first, nxt, notification_type='match_alert')}
    report['match_alerts'] = _section('match alerts', alerts)

    def tags():
        return {'registered': _count(db, 'smart_tags', 'claimed_at', first, nxt), 'scans': None}
    report['smart_tags'] = _section('smart tags', tags)

    def delta(current: Any, before: Any) -> Optional[float]:
        if current is None or before in (None, 0):
            return None
        return round((current - before) / before * 100, 1)
    figures, previous = report['figures'], report['previous']
    report['changes'] = {
        key: delta(figures.get(key), previous.get(key)) for key in ('found_received', 'lost_filed', 'returned', 'claims_filed')
    }
    report['changes']['income'] = delta((figures.get('income') or {}).get('total'), (previous.get('income') or {}).get('total'))
    return report


def to_csv(report: Dict[str, Any]) -> str:
    """The report as rows of Section, Measure, Value, so it opens in a spreadsheet and can be pivoted."""
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(['E-Balik monthly report', report['label']])
    writer.writerow(['Section', 'Measure', 'Value'])
    figures = report['figures']
    for label, key in (('Found items received', 'found_received'), ('Lost reports filed', 'lost_filed'), ('Items returned to owners', 'returned'), ('Claims filed', 'claims_filed')):
        writer.writerow(['Overview', label, '' if figures.get(key) is None else figures[key]])
    income = figures.get('income')
    if income:
        for label, key in (('Total income (PHP)', 'total'), ('Auction Hall (PHP)', 'auction'), ('Smart Tags (PHP)', 'smart_tag'), ('Other (PHP)', 'other'), ('Refunds (PHP)', 'refunds'), ('Auctions sold', 'auctions_sold'), ('Smart Tags sold', 'tags_sold')):
            writer.writerow(['Income', label, f'{income[key]:.2f}' if isinstance(income[key], float) else income[key]])
    claims = report.get('claims')
    if claims:
        writer.writerow(['Claims', 'Average days to return', '' if claims['average_days_to_return'] is None else claims['average_days_to_return']])
        for status, count in sorted(claims['by_status'].items()):
            writer.writerow(['Claims filed by status', csv_safe(status), count])
    intake = report.get('intake')
    if intake:
        for title, key in (('Found items by category', 'found_by_category'), ('Found items by place', 'found_by_location'), ('Lost reports by category', 'lost_by_category'), ('Lost reports by place', 'lost_by_location')):
            for entry in intake[key]:
                writer.writerow([title, csv_safe(entry['name']), entry['count']])
    waiting = report.get('waiting')
    if waiting:
        writer.writerow(['Still at the office', 'Total waiting', waiting['total']])
        for bucket in waiting['buckets']:
            writer.writerow(['Still at the office', bucket['label'], bucket['count']])
    if report.get('match_alerts'):
        writer.writerow(['Matching', 'Match alerts sent', report['match_alerts']['sent']])
    if report.get('smart_tags'):
        writer.writerow(['Smart Tags', 'Tags registered', report['smart_tags']['registered']])
    return out.getvalue()
