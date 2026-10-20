"""Income: the money the Lost and Found Office receives from the Auction Hall and from Smart Tags, in one ledger.

Every entry comes from a real event, so the books follow the work:
  * an auction sale when staff record it paid and collected, or the guard releases it with the pickup PIN (`AuctionService.set_fulfillment`);
  * a Smart Tag sale when staff approve a tag's first registration at the office, at the price set for its batch (`SmartTagService.approve`);
  * a manual entry by a super administrator (another payment, a refund, a correction).
Entries are never edited or deleted: a mistake is fixed with a new adjustment, so the history stays complete.
The table comes from migration 20261022_income_ledger.sql; before it runs, recording is skipped quietly and the page says setup is needed.
"""
import csv
import io
import logging
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Dict, List, Optional

from app.utils.system_ops import csv_safe

logger = logging.getLogger(__name__)

SOURCES = {'auction': 'Auction Hall', 'smart_tag': 'Smart Tags', 'other': 'Other'}
KINDS = ('sale', 'refund', 'adjustment')
METHODS = {'cash': 'Cash', 'gcash': 'GCash', 'maya': 'Maya', 'bank': 'Bank transfer', 'other': 'Other'}
MAX_AMOUNT = Decimal('1000000')
MAX_TAG_PRICE = Decimal('100000')
CAMPUS_TZ = timezone(timedelta(hours=8))
MAX_ROWS = 20000


class IncomeError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = 'invalid'):
        super().__init__(message)
        self.message, self.status, self.code = message, status, code


class IncomeUnavailable(Exception):
    """The ledger table does not exist yet (migration 20261022 has not been run)."""


def _missing_schema(error: Exception) -> bool:
    text = str(error)
    return 'income_ledger' in text and ('does not exist' in text or 'PGRST205' in text or 'schema cache' in text or '42P01' in text)


def money(value: Any, field: str = 'amount', allow_zero: bool = False, maximum: Decimal = MAX_AMOUNT) -> Decimal:
    """A peso amount with two decimals. Raises IncomeError with a sentence for the form."""
    text = str(value if value is not None else '').strip().replace(',', '').replace('₱', '').replace('PHP', '').strip()
    try:
        amount = Decimal(text).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        raise IncomeError(f'Enter the {field} in pesos, for example 150 or 150.50.')
    if not amount.is_finite():
        raise IncomeError(f'Enter the {field} in pesos.')
    if amount < 0 or (amount == 0 and not allow_zero):
        raise IncomeError(f'The {field} must be more than zero.' if not allow_zero else f'The {field} cannot be negative.')
    if amount > maximum:
        raise IncomeError(f'The {field} cannot be more than ₱{maximum:,.0f}.')
    return amount


def parse_tag_price(value: Any) -> Decimal:
    """The price of each tag in a batch: 0 (free) up to ₱100,000. Blank means free."""
    if value is None or str(value).strip() == '':
        return Decimal('0.00')
    return money(value, 'price per tag', allow_zero=True, maximum=MAX_TAG_PRICE)


def campus_day(moment: datetime) -> date:
    return moment.astimezone(CAMPUS_TZ).date()


def _parse_moment(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _day(value: Any, field: str) -> Optional[date]:
    if value in (None, ''):
        return None
    try:
        return datetime.strptime(str(value).strip(), '%Y-%m-%d').date()
    except ValueError:
        raise IncomeError(f'The {field} date must use YYYY-MM-DD.')


def _start_of(day: date) -> str:
    return datetime(day.year, day.month, day.day, tzinfo=CAMPUS_TZ).astimezone(timezone.utc).isoformat()


class IncomeService:
    def __init__(self, db):
        self.db = db
        self.client = db.client

    def _table(self):
        return self.client.table('income_ledger')

    def _guard(self, error: Exception):
        if _missing_schema(error):
            raise IncomeUnavailable('Income tracking is not set up yet. Run Server/manual_migrations/20261022_income_ledger.sql in Supabase.') from error
        raise error

    # ------------------------------------------------------------------ recording (called by the workflows)
    def record_sale(self, source: str, source_ref: str, amount: Any, description: str, payer_account_id: Any = None,
                    recorded_by: Any = None, method: str = 'cash', notes: str = '') -> Optional[Dict[str, Any]]:
        """Write the one sale for this auction or tag. Never raises: the sale itself already happened and must not be undone.

        Returns the entry, the existing entry when it was already recorded, or None when nothing could be written.
        """
        try:
            value = money(amount)
        except IncomeError:
            return None
        row = {
            'source': source, 'kind': 'sale', 'source_ref': str(source_ref)[:64], 'description': str(description)[:255],
            'amount': str(value), 'payer_account_id': str(payer_account_id) if payer_account_id else None,
            'method': method if method in METHODS else 'cash', 'notes': (notes or None) and str(notes)[:500],
            'recorded_by': str(recorded_by) if recorded_by else None, 'received_at': datetime.now(timezone.utc).isoformat(),
        }
        try:
            return (self._table().insert(row).execute().data or [row])[0]
        except Exception as error:
            text = str(error)
            if 'duplicate' in text.lower() or '23505' in text:
                try:
                    found = self._table().select('*').eq('source', source).eq('source_ref', row['source_ref']).eq('kind', 'sale').limit(1).execute().data or []
                    return found[0] if found else None
                except Exception:
                    return None
            if _missing_schema(error):
                logger.info('Income ledger missing (run 20261022); %s sale %s not recorded', source, source_ref)
            else:
                logger.error('Could not record the %s sale %s: %s', source, source_ref, error)
            return None

    def record_manual(self, payload: Dict[str, Any], admin_id: str) -> Dict[str, Any]:
        """A super administrator's entry: an "other" sale, a refund (stored negative) or an adjustment (either sign)."""
        kind = str(payload.get('kind') or '').strip().lower()
        if kind not in KINDS:
            raise IncomeError('Choose sale, refund or adjustment.')
        source = str(payload.get('source') or '').strip().lower()
        if source not in SOURCES:
            raise IncomeError('Choose what the money is for: Auction Hall, Smart Tags or Other.')
        if kind == 'sale' and source != 'other':
            raise IncomeError('Auction and Smart Tag sales are recorded automatically. Use an adjustment to correct one.')
        method = str(payload.get('method') or 'cash').strip().lower()
        if method not in METHODS:
            raise IncomeError('Choose how the money was paid.')
        description = str(payload.get('description') or '').strip()
        if len(description) < 4:
            raise IncomeError('Describe the entry in a few words (at least 4 characters).')
        reason = str(payload.get('notes') or '').strip()
        if kind != 'sale' and len(reason) < 8:
            raise IncomeError('Give the reason for this refund or adjustment (at least 8 characters). It stays in the record.')
        raw = str(payload.get('amount') or '').strip()
        negative = raw.startswith('-')
        amount = money(raw.lstrip('-'))
        if kind == 'refund' or (kind == 'adjustment' and negative):
            amount = -amount
        received = _day(payload.get('received_on'), 'received') or campus_day(datetime.now(timezone.utc))
        if received > campus_day(datetime.now(timezone.utc)):
            raise IncomeError('The received date cannot be in the future.')
        row = {
            'source': source, 'kind': kind, 'source_ref': (str(payload.get('source_ref') or '').strip()[:64] or None),
            'description': description[:255], 'amount': str(amount), 'method': method,
            'receipt_no': (str(payload.get('receipt_no') or '').strip()[:40] or None), 'notes': reason[:500] or None,
            'recorded_by': admin_id, 'received_at': _start_of(received) if received != campus_day(datetime.now(timezone.utc)) else datetime.now(timezone.utc).isoformat(),
        }
        try:
            return (self._table().insert(row).execute().data or [row])[0]
        except Exception as error:
            self._guard(error)

    # ------------------------------------------------------------------ reading
    def _rows(self, start: Optional[date], end: Optional[date], source: str = '') -> List[Dict[str, Any]]:
        try:
            query = self._table().select('*')
            if start:
                query = query.gte('received_at', _start_of(start))
            if end:
                query = query.lt('received_at', _start_of(end + timedelta(days=1)))
            if source:
                query = query.eq('source', source)
            return query.order('received_at', desc=True).limit(MAX_ROWS).execute().data or []
        except Exception as error:
            self._guard(error)

    def _names(self, ids: List[str]) -> Dict[str, str]:
        ids = sorted({str(i) for i in ids if i})
        if not ids:
            return {}
        try:
            rows = self.client.table('user_profiles').select('account_id,fname,lname').in_('account_id', ids).execute().data or []
        except Exception:
            return {}
        return {str(r['account_id']): f"{r.get('fname') or ''} {r.get('lname') or ''}".strip() for r in rows}

    def _pending(self) -> Dict[str, Any]:
        """Money that is owed but not received yet: auctions waiting for pickup, tags waiting for approval, unsold tags in stock."""
        pending = {'auction': Decimal('0'), 'auction_count': 0, 'smart_tag': Decimal('0'), 'smart_tag_count': 0, 'stock_value': Decimal('0'), 'stock_count': 0}
        try:
            for row in self.client.table('auctions').select('winning_amount').eq('fulfillment_status', 'awaiting_pickup').limit(MAX_ROWS).execute().data or []:
                pending['auction'] += Decimal(str(row.get('winning_amount') or 0))
                pending['auction_count'] += 1
        except Exception as error:
            logger.info('Pending auction income unavailable: %s', str(error)[:120])
        try:
            for row in self.client.table('smart_tags').select('status,price,paid_at,is_disabled').in_('status', ['blank', 'pending_verification']).limit(MAX_ROWS).execute().data or []:
                price = Decimal(str(row.get('price') or 0))
                if price <= 0 or row.get('is_disabled'):
                    continue
                if row.get('status') == 'blank':
                    pending['stock_value'] += price
                    pending['stock_count'] += 1
                elif not row.get('paid_at'):
                    pending['smart_tag'] += price
                    pending['smart_tag_count'] += 1
        except Exception as error:
            logger.info('Pending Smart Tag income unavailable (price column needs 20261022): %s', str(error)[:120])
        return {key: (float(value) if isinstance(value, Decimal) else value) for key, value in pending.items()}

    def summary(self, start: Any = None, end: Any = None) -> Dict[str, Any]:
        today = campus_day(datetime.now(timezone.utc))
        first = _day(start, 'start') or (today.replace(day=1) - timedelta(days=330)).replace(day=1)  # the last 12 months by default
        last = _day(end, 'end') or today
        if first > last:
            raise IncomeError('The start date must be on or before the end date.')
        rows = self._rows(first, last)
        totals = {key: Decimal('0') for key in SOURCES}
        months: Dict[str, Dict[str, Decimal]] = {}
        cursor = first.replace(day=1)
        while cursor <= last:  # every month in the range, so an empty month still shows as zero
            months[cursor.strftime('%Y-%m')] = {key: Decimal('0') for key in SOURCES}
            cursor = (cursor + timedelta(days=32)).replace(day=1)
        refunds = Decimal('0')
        sales_count = 0
        for row in rows:
            amount = Decimal(str(row.get('amount') or 0))
            source = row.get('source') if row.get('source') in SOURCES else 'other'
            totals[source] += amount
            moment = _parse_moment(row.get('received_at'))
            if moment:
                months.setdefault(campus_day(moment).strftime('%Y-%m'), {key: Decimal('0') for key in SOURCES})[source] += amount
            if amount < 0:
                refunds += amount
            if row.get('kind') == 'sale':
                sales_count += 1
        this_month = today.strftime('%Y-%m')
        previous_month = (today.replace(day=1) - timedelta(days=1)).strftime('%Y-%m')
        month_total = lambda key: float(sum(months.get(key, {}).values(), Decimal('0')))
        return {
            'range': {'start': first.isoformat(), 'end': last.isoformat()},
            'total': float(sum(totals.values(), Decimal('0'))),
            'by_source': {key: float(value) for key, value in totals.items()},
            'refunds': float(refunds),
            'entries': len(rows),
            'sales': sales_count,
            'this_month': month_total(this_month),
            'previous_month': month_total(previous_month),
            'by_month': [{'month': key, **{k: float(v) for k, v in value.items()}, 'total': float(sum(value.values(), Decimal('0')))} for key, value in sorted(months.items())],
            'pending': self._pending(),
            'sources': SOURCES,
            'methods': METHODS,
        }

    def entries(self, start: Any = None, end: Any = None, source: str = '', limit: Any = 50, offset: Any = 0) -> Dict[str, Any]:
        source = source if source in SOURCES else ''
        try:
            limit, offset = max(1, min(int(limit), 200)), max(0, int(offset))
        except (TypeError, ValueError):
            limit, offset = 50, 0
        rows = self._rows(_day(start, 'start'), _day(end, 'end'), source)
        page = rows[offset:offset + limit]
        names = self._names([r.get('payer_account_id') for r in page] + [r.get('recorded_by') for r in page])
        return {
            'entries': [{**row, 'amount': float(Decimal(str(row.get('amount') or 0))), 'payer_name': names.get(str(row.get('payer_account_id')), ''),
                         'recorded_by_name': names.get(str(row.get('recorded_by')), '') or ('System' if not row.get('recorded_by') else '')} for row in page],
            'total': len(rows), 'limit': limit, 'offset': offset,
        }

    def csv_export(self, start: Any = None, end: Any = None, source: str = '') -> str:
        rows = self._rows(_day(start, 'start'), _day(end, 'end'), source if source in SOURCES else '')
        names = self._names([r.get('payer_account_id') for r in rows] + [r.get('recorded_by') for r in rows])
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(['Received (Manila)', 'Source', 'Type', 'Description', 'Reference', 'Amount (PHP)', 'Method', 'Receipt no.', 'Paid by', 'Recorded by', 'Notes'])
        for row in rows:
            moment = _parse_moment(row.get('received_at'))
            writer.writerow([
                moment.astimezone(CAMPUS_TZ).strftime('%Y-%m-%d %H:%M') if moment else '', SOURCES.get(row.get('source'), row.get('source')),
                row.get('kind'), csv_safe(row.get('description')), csv_safe(row.get('source_ref')), f"{Decimal(str(row.get('amount') or 0)):.2f}",
                METHODS.get(row.get('method'), row.get('method')), csv_safe(row.get('receipt_no')), csv_safe(names.get(str(row.get('payer_account_id')), '')),
                csv_safe(names.get(str(row.get('recorded_by')), '') or ('System' if not row.get('recorded_by') else '')), csv_safe(row.get('notes')),
            ])
        return out.getvalue()
