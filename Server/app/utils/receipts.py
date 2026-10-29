"""Digital handover receipts: the owner's proof that an item was released to them (or an auction win was collected and paid).

No QR code and no table: a receipt is built from the record that already exists (a claim marked collected, or an auction marked
collected), so it can never disagree with it. Each receipt has
  * a receipt number     HR-<date>-<claim reference>   or   AR-<date>-<first 8 characters of the auction id>
  * a verification code  ten characters, derived from the record with the app's secret key (HMAC), shown on the receipt.
Anyone given a receipt number and its code can check it (`verify`) and learns only that it is genuine, what the item was and the
day it was released: never a name, a campus ID or a contact detail. Only the owner can open the full receipt.
"""
import base64
import hashlib
import hmac
import re
from decimal import Decimal
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.utils.crypto_service import CryptoService

CAMPUS_TZ = timezone(timedelta(hours=8))
CLAIM_PREFIX, AUCTION_PREFIX, PAYMENT_PREFIX, PAYOUT_PREFIX = 'HR', 'AR', 'PR', 'PO'
_NUMBER = re.compile(r'^(HR|AR|PR|PO)-(\d{8})-([A-Za-z0-9-]{3,40})$', re.IGNORECASE)
CODE_LENGTH = 10


class ReceiptError(Exception):
    def __init__(self, message: str, status: int = 404):
        super().__init__(message)
        self.message, self.status = message, status


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _day(moment: datetime) -> str:
    return moment.astimezone(CAMPUS_TZ).strftime('%Y%m%d')


def _code(kind: str, record_id: str, moment: datetime) -> str:
    """Ten characters (5-5) that only this server can produce for this record and release time."""
    digest = hmac.new(CryptoService._get_key(), f'receipt:{kind}:{record_id}:{moment.astimezone(timezone.utc).strftime("%Y%m%d%H%M%S")}'.encode('utf-8'), hashlib.sha256).digest()
    text = base64.b32encode(digest).decode('ascii').rstrip('=')[:CODE_LENGTH]
    return f'{text[:5]}-{text[5:]}'


def _normalise_code(value: Any) -> str:
    text = re.sub(r'[^A-Za-z0-9]', '', str(value or '')).upper()
    return f'{text[:5]}-{text[5:]}' if len(text) == CODE_LENGTH else ''


def _name(profile: Optional[Dict[str, Any]]) -> str:
    return f"{(profile or {}).get('fname') or ''} {(profile or {}).get('lname') or ''}".strip()


def _claim_receipt(db, claim: Dict[str, Any], item: Dict[str, Any], owner: Dict[str, Any], releaser: Dict[str, Any]) -> Dict[str, Any]:
    moment = _parse(claim.get('collected_at')) or _parse(claim.get('updated_at')) or datetime.now(timezone.utc)
    return {
        'kind': 'claim', 'receipt_no': f"{CLAIM_PREFIX}-{_day(moment)}-{claim.get('claim_reference') or str(claim['claim_id'])[:8]}",
        'code': _code('claim', str(claim['claim_id']), moment), 'released_at': moment.isoformat(),
        'item': {'name': item.get('item_name') or 'Item', 'reference': item.get('fpost_id') or '', 'category': item.get('category') or '', 'found_at': item.get('location') or ''},
        'reference': claim.get('claim_reference') or '', 'released_to': _name(owner), 'campus_id': owner.get('campus_id') or '',
        'released_by': _name(releaser) or 'Lost and Found Office', 'amount': None,
    }


def _auction_receipt(db, auction: Dict[str, Any], owner: Dict[str, Any], releaser: Dict[str, Any]) -> Dict[str, Any]:
    moment = _parse(auction.get('fulfillment_updated_at')) or datetime.now(timezone.utc)
    return {
        'kind': 'auction', 'receipt_no': f"{AUCTION_PREFIX}-{_day(moment)}-{str(auction['auction_id'])[:8].upper()}",
        'code': _code('auction', str(auction['auction_id']), moment), 'released_at': moment.isoformat(),
        'item': {'name': auction.get('title') or 'Auction item', 'reference': auction.get('item_reference') or '', 'category': '', 'found_at': ''},
        'reference': auction.get('item_reference') or '', 'released_to': _name(owner), 'campus_id': owner.get('campus_id') or '',
        'released_by': _name(releaser) or 'Lost and Found Office', 'amount': float(auction.get('winning_amount') or 0) or None,
    }


def list_for_owner(db, account_id: str) -> List[Dict[str, Any]]:
    """Every receipt this person has: items released to them and auctions they won and collected, newest first."""
    owner = db.get_user_by_account_id(str(account_id)) or {}
    receipts: List[Dict[str, Any]] = []
    claims = db.client.table('claims').select('claim_id,claim_reference,found_item_id,claimant_account_id,status,collected_at,updated_at,released_by') \
        .eq('claimant_account_id', str(account_id)).eq('status', 'collected').order('collected_at', desc=True).limit(200).execute().data or []
    item_ids = sorted({str(c['found_item_id']) for c in claims if c.get('found_item_id')})
    items = {}
    if item_ids:
        items = {str(r['item_id']): r for r in db.client.table('found_items').select('item_id,fpost_id,item_name,category,location').in_('item_id', item_ids).execute().data or []}
    for claim in claims:
        releaser = db.get_user_by_account_id(str(claim['released_by'])) if claim.get('released_by') else {}
        receipts.append(_claim_receipt(db, claim, items.get(str(claim.get('found_item_id')), {}), owner, releaser or {}))
    try:
        auctions = db.client.table('auctions').select('auction_id,title,item_reference,winning_amount,winner_account_id,fulfillment_status,fulfillment_updated_at') \
            .eq('winner_account_id', str(account_id)).eq('fulfillment_status', 'collected').order('fulfillment_updated_at', desc=True).limit(200).execute().data or []
        receipts += [_auction_receipt(db, auction, owner, {}) for auction in auctions]
    except Exception:
        pass  # before the Auction Hall tables exist there are simply no auction receipts
    receipts += _payment_receipts(db, account_id, owner)
    receipts += _payout_receipts(db, account_id, owner)
    return sorted(receipts, key=lambda r: r['released_at'], reverse=True)


def get_for_owner(db, account_id: str, receipt_no: str) -> Dict[str, Any]:
    for receipt in list_for_owner(db, account_id):
        if receipt['receipt_no'].upper() == str(receipt_no or '').strip().upper():
            return receipt
    raise ReceiptError('This receipt was not found on your account.')


def verify(db, receipt_no: Any, code: Any) -> Dict[str, Any]:
    """Is this receipt number with this code genuine? Answers only the item and the day, never who the owner is."""
    match = _NUMBER.match(str(receipt_no or '').strip())
    entered = _normalise_code(code)
    if not match or not entered:
        raise ReceiptError('Enter the receipt number (for example HR-20261020-CL-0007) and its 10 character code.', 400)
    prefix, day, ref = match.group(1).upper(), match.group(2), match.group(3)
    if prefix == PAYMENT_PREFIX:
        return _verify_payment(db, day, ref, entered)
    if prefix == PAYOUT_PREFIX:
        return _verify_payout(db, f'{prefix}-{day}-{ref}', entered)
    if prefix == CLAIM_PREFIX:
        rows = db.client.table('claims').select('claim_id,claim_reference,found_item_id,status,collected_at,updated_at').eq('claim_reference', ref).eq('status', 'collected').limit(1).execute().data or []
        record = rows[0] if rows else None
        moment = (_parse(record.get('collected_at')) or _parse(record.get('updated_at'))) if record else None
        record_id, kind = str(record['claim_id']) if record else '', 'claim'
    else:
        rows = db.client.table('auctions').select('auction_id,title,item_reference,fulfillment_status,fulfillment_updated_at').eq('fulfillment_status', 'collected').limit(500).execute().data or []
        record = next((r for r in rows if str(r['auction_id']).upper().startswith(ref.upper()) and _parse(r.get('fulfillment_updated_at')) and _day(_parse(r['fulfillment_updated_at'])) == day), None)
        moment = _parse(record.get('fulfillment_updated_at')) if record else None
        record_id, kind = str(record['auction_id']) if record else '', 'auction'
    genuine = bool(record and moment and _day(moment) == day and hmac.compare_digest(_code(kind, record_id, moment), entered))
    if not genuine:
        return {'valid': False}
    if kind == 'claim':
        item = (db.client.table('found_items').select('item_name').eq('item_id', record['found_item_id']).limit(1).execute().data or [{}])[0]
        name = item.get('item_name') or 'Item'
    else:
        name = record.get('title') or 'Auction item'
    return {'valid': True, 'kind': kind, 'item_name': name, 'released_on': moment.astimezone(CAMPUS_TZ).strftime('%B %d, %Y').replace(' 0', ' ')}


def receipt_for_claim(db, claim_id: str) -> Optional[Dict[str, Any]]:
    """The receipt for one collected claim (used to put the number and code in the receipt email). None if it is not collected."""
    rows = db.client.table('claims').select('claim_id,claim_reference,found_item_id,claimant_account_id,status,collected_at,updated_at,released_by').eq('claim_id', claim_id).limit(1).execute().data or []
    if not rows or rows[0].get('status') != 'collected':
        return None
    claim = rows[0]
    item = (db.client.table('found_items').select('item_id,fpost_id,item_name,category,location').eq('item_id', claim['found_item_id']).limit(1).execute().data or [{}])[0]
    owner = db.get_user_by_account_id(str(claim['claimant_account_id'])) or {}
    releaser = db.get_user_by_account_id(str(claim['released_by'])) if claim.get('released_by') else {}
    receipt = _claim_receipt(db, claim, item, owner, releaser or {})
    receipt['owner_id'] = str(claim['claimant_account_id'])   # internal: who to notify; never sent to a browser
    return receipt


# ---------------------------------------------------------------------------------------------- payment receipts (income_ledger)
def payment_number(source: str, source_ref: Any, moment: Optional[datetime]) -> str:
    """PR-<date>-AU-<first 8 characters of the auction id>  or  PR-<date>-TG-<Smart Tag code>. One sale per item, so one number per item."""
    moment = moment or datetime.now(timezone.utc)
    ref = str(source_ref or '').upper()
    return f"{PAYMENT_PREFIX}-{_day(moment)}-AU-{ref[:8]}" if source == 'auction' else f"{PAYMENT_PREFIX}-{_day(moment)}-TG-{ref[:30]}"


def _reversed_numbers(db) -> set:
    try:
        rows = db.client.table('income_ledger').select('receipt_no').eq('kind', 'refund').limit(5000).execute().data or []
    except Exception:
        return set()
    return {r.get('receipt_no') for r in rows if r.get('receipt_no')}


def _entry_number(entry: Dict[str, Any]) -> str:
    return entry.get('receipt_no') or payment_number(entry.get('source'), entry.get('source_ref'), _parse(entry.get('received_at')))


def _payment_receipt(entry: Dict[str, Any], owner: Dict[str, Any], confirmer: Dict[str, Any], reversed_flag: bool) -> Dict[str, Any]:
    moment = _parse(entry.get('received_at')) or datetime.now(timezone.utc)
    return {
        'kind': 'payment', 'receipt_no': _entry_number(entry), 'code': _code('payment', str(entry['entry_id']), moment), 'released_at': moment.isoformat(),
        'item': {'name': entry.get('description') or 'Payment', 'reference': entry.get('source_ref') or '', 'category': '', 'found_at': ''},
        'reference': entry.get('source_ref') or '', 'released_to': _name(owner), 'campus_id': owner.get('campus_id') or '',
        'released_by': _name(confirmer) or 'Lost and Found Office', 'amount': float(Decimal(str(entry.get('amount') or 0))),
        'method': entry.get('method') or 'cash', 'payment_reference': entry.get('payment_reference') or '', 'reversed': bool(reversed_flag),
    }


def _payment_receipts(db, account_id: str, owner: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The payments an administrator confirmed for this person (auction wins and Smart Tags), newest first."""
    try:
        sales = db.client.table('income_ledger').select('*').eq('payer_account_id', str(account_id)).eq('kind', 'sale').order('received_at', desc=True).limit(200).execute().data or []
    except Exception:
        return []        # before the income ledger exists there are simply no payment receipts
    reversed_numbers = _reversed_numbers(db)
    staff: Dict[str, Dict[str, Any]] = {}
    result = []
    for entry in sales:
        if entry.get('source') not in ('auction', 'smart_tag'):
            continue
        by = str(entry.get('recorded_by') or '')
        if by and by not in staff:
            staff[by] = db.get_user_by_account_id(by) or {}
        result.append(_payment_receipt(entry, owner, staff.get(by, {}), _entry_number(entry) in reversed_numbers))
    return result


def receipt_for_payment(db, entry_id: str) -> Optional[Dict[str, Any]]:
    """The receipt for one confirmed payment (for the confirming administrator and the payer's email). None if it is not a payment sale."""
    rows = db.client.table('income_ledger').select('*').eq('entry_id', str(entry_id)).limit(1).execute().data or []
    if not rows or rows[0].get('kind') != 'sale' or rows[0].get('source') not in ('auction', 'smart_tag'):
        return None
    entry = rows[0]
    owner = db.get_user_by_account_id(str(entry['payer_account_id'])) if entry.get('payer_account_id') else {}
    confirmer = db.get_user_by_account_id(str(entry['recorded_by'])) if entry.get('recorded_by') else {}
    receipt = _payment_receipt(entry, owner or {}, confirmer or {}, _entry_number(entry) in _reversed_numbers(db))
    receipt['owner_id'] = str(entry['payer_account_id']) if entry.get('payer_account_id') else ''   # internal; never sent to a browser
    receipt['has_proof'] = bool(entry.get('proof_path'))
    receipt['entry_id'] = str(entry['entry_id'])
    return receipt


def _verify_payment(db, day: str, ref: str, entered: str) -> Dict[str, Any]:
    kind_code, _, key = ref.partition('-')
    source = {'AU': 'auction', 'TG': 'smart_tag'}.get(kind_code.upper())
    if not source or not key:
        return {'valid': False}
    try:
        rows = db.client.table('income_ledger').select('*').eq('source', source).eq('kind', 'sale').limit(2000).execute().data or []
    except Exception:
        return {'valid': False}
    for row in rows:
        reference = str(row.get('source_ref') or '').upper()
        if not (reference.startswith(key.upper()) if source == 'auction' else reference == key.upper()):
            continue
        moment = _parse(row.get('received_at'))
        if moment and _day(moment) == day and hmac.compare_digest(_code('payment', str(row['entry_id']), moment), entered):
            return {'valid': True, 'kind': 'payment', 'item_name': row.get('description') or 'Payment', 'released_on': moment.astimezone(CAMPUS_TZ).strftime('%B %d, %Y').replace(' 0', ' '),
                    'reversed': _entry_number(row) in _reversed_numbers(db)}
    return {'valid': False}


# ---------------------------------------------------------------------------------------------- seller payouts (PO- receipts)
def payout_number(auction_id: Any, moment: Optional[datetime]) -> str:
    """PO-<date>-AU-<first 8 characters of the auction id>: the seller's receipt for the money the Office sent them after a sale."""
    return f"{PAYOUT_PREFIX}-{_day(moment or datetime.now(timezone.utc))}-AU-{str(auction_id or '').upper()[:8]}"


def _payout_receipt(row: Dict[str, Any], owner: Dict[str, Any], payer: Dict[str, Any]) -> Dict[str, Any]:
    moment = _parse(row.get('paid_at')) or datetime.now(timezone.utc)
    return {
        'kind': 'payout', 'receipt_no': row.get('receipt_no') or payout_number(row.get('auction_id'), moment), 'code': _code('payout', str(row['payout_id']), moment),
        'released_at': moment.isoformat(),
        'item': {'name': row.get('title') or 'Auction item', 'reference': str(row.get('auction_id') or '')[:8].upper(), 'category': '', 'found_at': ''},
        'reference': str(row.get('auction_id') or '')[:8].upper(), 'released_to': _name(owner), 'campus_id': owner.get('campus_id') or '',
        'released_by': _name(payer) or 'Lost and Found Office', 'amount': float(Decimal(str(row.get('payout_amount') or 0))),
        'gross': float(Decimal(str(row.get('gross') or 0))), 'commission': float(Decimal(str(row.get('commission') or 0))),
        'commission_rate': float(Decimal(str(row.get('commission_rate') or 0))), 'method': row.get('method') or 'cash',
        'payment_reference': row.get('reference') or '', 'reversed': False,
    }


def _payout_receipts(db, account_id: str, owner: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The payouts the Office sent this person for items they sold in the Auction Hall."""
    try:
        rows = db.client.table('seller_payouts').select('*').eq('seller_account_id', str(account_id)).eq('status', 'paid').order('paid_at', desc=True).limit(200).execute().data or []
    except Exception:
        return []        # before seller auctions exist there are simply no payout receipts
    staff: Dict[str, Dict[str, Any]] = {}
    result = []
    for row in rows:
        by = str(row.get('paid_by') or '')
        if by and by not in staff:
            staff[by] = db.get_user_by_account_id(by) or {}
        result.append(_payout_receipt(row, owner, staff.get(by, {})))
    return result


def receipt_for_payout(db, payout_id: str) -> Optional[Dict[str, Any]]:
    """The receipt for one payout that was sent (for the seller's email and the office). None while it is not paid."""
    rows = db.client.table('seller_payouts').select('*').eq('payout_id', str(payout_id)).limit(1).execute().data or []
    if not rows or rows[0].get('status') != 'paid':
        return None
    row = rows[0]
    owner = db.get_user_by_account_id(str(row['seller_account_id'])) if row.get('seller_account_id') else {}
    payer = db.get_user_by_account_id(str(row['paid_by'])) if row.get('paid_by') else {}
    receipt = _payout_receipt(row, owner or {}, payer or {})
    receipt['owner_id'] = str(row['seller_account_id']) if row.get('seller_account_id') else ''   # internal; never sent to a browser
    receipt['has_proof'] = bool(row.get('proof_path'))
    receipt['payout_id'] = str(row['payout_id'])
    return receipt


def _verify_payout(db, number: str, entered: str) -> Dict[str, Any]:
    try:
        rows = db.client.table('seller_payouts').select('*').eq('receipt_no', number.upper()).eq('status', 'paid').limit(1).execute().data or []
    except Exception:
        return {'valid': False}
    row = rows[0] if rows else None
    moment = _parse(row.get('paid_at')) if row else None
    if not row or not moment or not hmac.compare_digest(_code('payout', str(row['payout_id']), moment), entered):
        return {'valid': False}
    return {'valid': True, 'kind': 'payout', 'item_name': row.get('title') or 'Auction item', 'released_on': moment.astimezone(CAMPUS_TZ).strftime('%B %d, %Y').replace(' 0', ' '), 'reversed': False}


# ---------------------------------------------------------------------------------------------- the office's view of every receipt
def _people(db, ids) -> Dict[str, str]:
    ids = sorted({str(i) for i in ids if i})
    if not ids:
        return {}
    try:
        rows = db.client.table('user_profiles').select('account_id,fname,lname').in_('account_id', ids).execute().data or []
    except Exception:
        return {}
    return {str(r['account_id']): _name(r) for r in rows}


def receipt_for_auction(db, auction_id: str) -> Optional[Dict[str, Any]]:
    rows = db.client.table('auctions').select('auction_id,title,item_reference,winning_amount,winner_account_id,fulfillment_status,fulfillment_updated_at').eq('auction_id', str(auction_id)).limit(1).execute().data or []
    if not rows or rows[0].get('fulfillment_status') != 'collected':
        return None
    owner = db.get_user_by_account_id(str(rows[0]['winner_account_id'])) if rows[0].get('winner_account_id') else {}
    return _auction_receipt(db, rows[0], owner or {}, {})


def admin_list(db, kind: str = '', q: str = '', status: str = '', start: str = '', end: str = '', limit: int = 25, offset: int = 0) -> Dict[str, Any]:
    """Every receipt the office has issued: payment receipts, item handover receipts and auction collection receipts, newest first.

    Filter by kind (payment, claim, auction, payout), status (valid, reversed), a day range (Manila days, YYYY-MM-DD) and a search word
    (receipt number, item or person). The list never includes the verification code: open one receipt to see it.
    """
    rows: List[Dict[str, Any]] = []
    reversed_numbers = _reversed_numbers(db)
    try:
        sales = db.client.table('income_ledger').select('*').eq('kind', 'sale').order('received_at', desc=True).limit(1000).execute().data or []
    except Exception:
        sales = []
    claims = db.client.table('claims').select('claim_id,claim_reference,found_item_id,claimant_account_id,collected_at,updated_at').eq('status', 'collected').order('collected_at', desc=True).limit(500).execute().data or []
    try:
        auctions = db.client.table('auctions').select('auction_id,title,winning_amount,winner_account_id,fulfillment_updated_at').eq('fulfillment_status', 'collected').order('fulfillment_updated_at', desc=True).limit(500).execute().data or []
    except Exception:
        auctions = []
    try:
        payouts = db.client.table('seller_payouts').select('payout_id,auction_id,title,seller_account_id,payout_amount,method,proof_path,paid_by,paid_at,receipt_no').eq('status', 'paid').order('paid_at', desc=True).limit(500).execute().data or []
    except Exception:
        payouts = []
    item_ids = sorted({str(c['found_item_id']) for c in claims if c.get('found_item_id')})
    items = {}
    if item_ids:
        items = {str(r['item_id']): r.get('item_name') for r in db.client.table('found_items').select('item_id,item_name').in_('item_id', item_ids).execute().data or []}
    people = _people(db, [s.get('payer_account_id') for s in sales] + [s.get('recorded_by') for s in sales] + [c.get('claimant_account_id') for c in claims] + [a.get('winner_account_id') for a in auctions]
                     + [p.get('seller_account_id') for p in payouts] + [p.get('paid_by') for p in payouts])
    for entry in sales:
        if entry.get('source') not in ('auction', 'smart_tag'):
            continue
        number, moment = _entry_number(entry), _parse(entry.get('received_at'))
        rows.append({'kind': 'payment', 'id': str(entry['entry_id']), 'receipt_no': number, 'item': entry.get('description') or 'Payment', 'person': people.get(str(entry.get('payer_account_id')), ''),
                     'amount': float(Decimal(str(entry.get('amount') or 0))), 'method': entry.get('method'), 'has_proof': bool(entry.get('proof_path')), 'issued_by': people.get(str(entry.get('recorded_by')), ''),
                     'released_at': moment.isoformat() if moment else None, 'status': 'reversed' if number in reversed_numbers else 'valid'})
    for claim in claims:
        moment = _parse(claim.get('collected_at')) or _parse(claim.get('updated_at')) or datetime.now(timezone.utc)
        rows.append({'kind': 'claim', 'id': str(claim['claim_id']), 'receipt_no': f"{CLAIM_PREFIX}-{_day(moment)}-{claim.get('claim_reference') or str(claim['claim_id'])[:8]}",
                     'item': items.get(str(claim.get('found_item_id'))) or 'Item', 'person': people.get(str(claim.get('claimant_account_id')), ''), 'amount': None, 'method': None,
                     'has_proof': False, 'issued_by': '', 'released_at': moment.isoformat(), 'status': 'valid'})
    for auction in auctions:
        moment = _parse(auction.get('fulfillment_updated_at')) or datetime.now(timezone.utc)
        rows.append({'kind': 'auction', 'id': str(auction['auction_id']), 'receipt_no': f"{AUCTION_PREFIX}-{_day(moment)}-{str(auction['auction_id'])[:8].upper()}",
                     'item': auction.get('title') or 'Auction item', 'person': people.get(str(auction.get('winner_account_id')), ''), 'amount': float(auction.get('winning_amount') or 0) or None,
                     'method': None, 'has_proof': False, 'issued_by': '', 'released_at': moment.isoformat(), 'status': 'valid'})
    for payout in payouts:
        moment = _parse(payout.get('paid_at'))
        rows.append({'kind': 'payout', 'id': str(payout['payout_id']), 'receipt_no': payout.get('receipt_no') or payout_number(payout.get('auction_id'), moment),
                     'item': payout.get('title') or 'Auction item', 'person': people.get(str(payout.get('seller_account_id')), ''), 'amount': float(Decimal(str(payout.get('payout_amount') or 0))),
                     'method': payout.get('method'), 'has_proof': bool(payout.get('proof_path')), 'issued_by': people.get(str(payout.get('paid_by')), ''),
                     'released_at': moment.isoformat() if moment else None, 'status': 'valid'})
    word = (q or '').strip().lower()

    def keep(row: Dict[str, Any], with_kind: bool = True) -> bool:
        day = _day(_parse(row['released_at'])) if row.get('released_at') else ''
        if with_kind and kind and row['kind'] != kind:
            return False
        if status and row['status'] != status:
            return False
        if start and day < start.replace('-', ''):
            return False
        if end and day > end.replace('-', ''):
            return False
        return not word or word in f"{row['receipt_no']} {row['item']} {row['person']}".lower()
    counts = {k: sum(1 for r in rows if r['kind'] == k and keep(r, with_kind=False)) for k in ('payment', 'claim', 'auction', 'payout')}
    chosen = sorted((r for r in rows if keep(r)), key=lambda r: r['released_at'] or '', reverse=True)
    limit = max(1, min(int(limit or 25), 100))
    offset = max(0, int(offset or 0))
    return {'receipts': chosen[offset:offset + limit], 'total': len(chosen), 'counts': counts, 'limit': limit, 'offset': offset}


def history(db, receipt_no: str) -> List[Dict[str, Any]]:
    """What the office did with this receipt: issued, reversed, emailed again. From the activity log (the number is the log's reference)."""
    try:
        rows = db.client.table('user_activity_logs').select('user_name,action,target_name,created_at,result').eq('target_id', str(receipt_no)).order('created_at', desc=True).limit(50).execute().data or []
    except Exception:
        return []
    return [{'who': r.get('user_name'), 'action': r.get('action'), 'details': r.get('target_name'), 'at': r.get('created_at'), 'result': r.get('result')} for r in rows]
