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
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.utils.crypto_service import CryptoService

CAMPUS_TZ = timezone(timedelta(hours=8))
CLAIM_PREFIX, AUCTION_PREFIX = 'HR', 'AR'
_NUMBER = re.compile(r'^(HR|AR)-(\d{8})-([A-Za-z0-9-]{3,40})$')
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
    prefix, day, ref = match.group(1), match.group(2), match.group(3)
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
