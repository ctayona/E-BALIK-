"""Seller auctions: people list their own items in the Auction Hall, and the Lost and Found Office keeps a commission.

Every step is a status someone can see:
  1. A verified user submits a listing (photos, starting bid, how they want to be paid) and accepts the fee shown to them. The fee terms
     are copied onto the listing, so changing the rate later never changes a listing that was already sent.
  2. The seller brings the item to the Office. An administrator checks it and asks for changes, rejects it, or approves it. Approving
     needs the item in the Office's hands and creates a normal Auction Hall auction, marked as a seller's item.
  3. The auction runs, ends and is confirmed like the Office's own auctions. The seller cannot bid on their own item.
  4. The winner pays the Office. When an administrator confirms the payment (PaymentDesk.confirm), the ledger gets the sale AND the
     seller's share (kind 'payout', negative) in one insert, so income only ever counts the commission; `seller_payouts` records what
     is owed to the seller.
  5. The winner collects the item with the handover PIN. After the hold days (time for complaints), an administrator sends the seller's
     money, records the method, reference and proof, and the seller gets a PO- payout receipt.
  6. Nothing sold (no bids, cancelled, forfeited): the Office gives the item back and marks the listing returned. A reversed payment
     cancels the payout, and a payment cannot be reversed once the seller was paid.
The seller's payout details (GCash number, bank account) are only ever shown to staff, and buyers never learn who the seller is.
"""
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Dict, Iterable, List, Optional, Tuple

from app.utils import receipts
from app.utils.text_guard import TextRejected, clean_field, strip_markup

logger = logging.getLogger(__name__)

SETTINGS_KEY = 'seller_auctions'
DEFAULT_TERMS: Dict[str, Any] = {'enabled': True, 'rate': 5.0, 'minimum': 10.0, 'cap': 500.0, 'hold_days': 3, 'max_active': 3}
SETUP_MESSAGE = 'Seller auctions are not set up yet. Run Server/manual_migrations/20261027_seller_auctions.sql in Supabase.'
PHOTO_BUCKET = 'found-item-images'
PROOF_BUCKET = 'payment-proofs'
PROOF_URL_SECONDS = 600
CENT = Decimal('0.01')
MIN_PRICE, MAX_PRICE = Decimal('50'), Decimal('100000')
MIN_PHOTOS, MAX_PHOTOS = 1, 4
MAX_PHOTO_BYTES = 5 * 1024 * 1024
DURATIONS = (1, 3, 5, 7, 10, 14)
CONDITIONS = {'new': 'New', 'like_new': 'Like new', 'used': 'Used', 'worn': 'Well used'}
PAYOUT_METHODS = {'cash': 'Cash at the office', 'gcash': 'GCash', 'maya': 'Maya', 'bank': 'Bank transfer'}
E_PAYOUTS = ('gcash', 'maya', 'bank')
OPEN = ('pending', 'changes_requested')
STATUS_LABELS = {'pending': 'Waiting for the office', 'changes_requested': 'Changes requested', 'listed': 'Listed', 'rejected': 'Not accepted',
                 'withdrawn': 'Withdrawn', 'returned': 'Returned to you'}
FINISHED_UNSOLD = ('no_bids', 'cancelled', 'forfeited')
# Things the Office will not sell for anyone. Whole words only, so "pet bottle" or "gunmetal grey" are not caught by mistake.
PROHIBITED = (
    'gun', 'guns', 'firearm', 'firearms', 'pistol', 'rifle', 'revolver', 'ammo', 'ammunition', 'bullets', 'airsoft', 'balisong', 'switchblade',
    'taser', 'stun gun', 'pepper spray', 'vape', 'vapes', 'e-cigarette', 'cigarette', 'cigarettes', 'tobacco', 'alcohol', 'liquor', 'beer',
    'marijuana', 'weed', 'shabu', 'drugs', 'prescription', 'answer key', 'exam answers', 'test questions', 'fake id', 'replica', 'counterfeit',
    'class a', 'pirated', 'puppy', 'puppies', 'kitten', 'kittens', 'live animal', 'found item', 'lost item', 'umak id',
)
_PROHIBITED = re.compile(r'\b(' + '|'.join(re.escape(word) for word in PROHIBITED) + r')\b', re.IGNORECASE)
_MOBILE = re.compile(r'^09\d{9}$')


class SellerError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = 'invalid'):
        super().__init__(message)
        self.message, self.status, self.code = message, status, code


class SellerUnavailable(Exception):
    """The seller auction tables are not in the database yet."""


def _missing_schema(error: Exception) -> bool:
    text = str(error).lower()
    names = ('auction_submissions', 'seller_payouts', 'seller_account_id', 'submission_id')
    markers = ('does not exist', 'schema cache', '42p01', '42703', 'pgrst204', 'pgrst205', 'could not find')
    return any(n in text for n in names) and any(m in text for m in markers)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat()


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _dec(value: Any) -> Decimal:
    try:
        return Decimal(str(value if value not in (None, '') else 0))
    except InvalidOperation:
        return Decimal('0')


def _truthy(value: Any) -> bool:
    return value is True or str(value or '').strip().lower() in ('1', 'true', 'yes', 'on')


def _name(profile: Optional[Dict[str, Any]]) -> str:
    return f"{(profile or {}).get('fname') or ''} {(profile or {}).get('lname') or ''}".strip()


def _clean(value: Any, limit: int) -> str:
    return ' '.join(str(value or '').split())[:limit]


def fee(gross: Any, rate: Any, minimum: Any = 0, cap: Any = 0) -> Tuple[Decimal, Decimal]:
    """(commission, the seller's share) for a sale. The commission is `rate`% rounded to the centavo, at least `minimum`, at most `cap`
    (0 = no cap) and never more than the sale itself, so the two parts always add up to the sale."""
    gross = _dec(gross).quantize(CENT)
    commission = (gross * _dec(rate) / 100).quantize(CENT, rounding=ROUND_HALF_UP)
    commission = max(commission, _dec(minimum).quantize(CENT))
    if _dec(cap) > 0:
        commission = min(commission, _dec(cap).quantize(CENT))
    commission = max(Decimal('0.00'), min(commission, gross))
    return commission, (gross - commission).quantize(CENT)


def mask_account(number: Any) -> str:
    digits = str(number or '').strip()
    return f"•••• {digits[-4:]}" if len(digits) > 4 else digits


def _price(value: Any, label: str, required: bool = True) -> Optional[Decimal]:
    text = str(value if value is not None else '').replace(',', '').replace('₱', '').strip()
    if not text:
        if required:
            raise SellerError(f'Enter the {label}.')
        return None
    try:
        amount = Decimal(text).quantize(CENT, rounding=ROUND_HALF_UP)
    except InvalidOperation:
        raise SellerError(f'Enter the {label} as a number, for example 250.')
    if amount < MIN_PRICE or amount > MAX_PRICE:
        raise SellerError(f'The {label} must be between ₱{MIN_PRICE:,.0f} and ₱{MAX_PRICE:,.0f}.')
    return amount


def default_increment(starting: Decimal) -> Decimal:
    if starting < 500:
        return Decimal('10')
    if starting < 5000:
        return Decimal('50')
    return Decimal('100')


def _text(fields: Dict[str, Any], key: str, kind: str, label: str, required: bool = True) -> str:
    try:
        return clean_field(fields.get(key), kind, key, label, required)
    except TextRejected as error:
        raise SellerError(error.message, 400, 'invalid_text')


class SellerDesk:
    def __init__(self, db):
        self.db = db
        self.client = db.client

    # ------------------------------------------------------------------ fee terms (System settings, super administrators change them)
    def terms(self) -> Dict[str, Any]:
        from app.utils import system_control as control
        stored = control.load_settings(self.db).get(SETTINGS_KEY) or {}
        merged = {**DEFAULT_TERMS, **{k: v for k, v in stored.items() if k in DEFAULT_TERMS}}
        return {'enabled': bool(merged['enabled']), 'rate': float(_dec(merged['rate'])), 'minimum': float(_dec(merged['minimum'])),
                'cap': float(_dec(merged['cap'])), 'hold_days': int(merged['hold_days']), 'max_active': int(merged['max_active']),
                'min_price': float(MIN_PRICE), 'max_price': float(MAX_PRICE), 'durations': list(DURATIONS), 'conditions': CONDITIONS,
                'payout_methods': PAYOUT_METHODS, 'max_photos': MAX_PHOTOS}

    def save_terms(self, payload: Dict[str, Any], admin_id: str) -> Dict[str, Any]:
        from app.utils import system_control as control

        def number(key: str, low: float, high: float, label: str) -> float:
            try:
                value = float(_dec(payload.get(key, DEFAULT_TERMS[key])))
            except (TypeError, ValueError):
                raise SellerError(f'Enter a number for the {label}.')
            if value < low or value > high:
                raise SellerError(f'The {label} must be between {low:g} and {high:g}.')
            return round(value, 2)
        rate = number('rate', 0, 30, 'commission rate (%)')
        minimum = number('minimum', 0, 1000, 'minimum commission')
        cap = number('cap', 0, 100000, 'commission cap (0 for no cap)')
        if cap and cap < minimum:
            raise SellerError('The commission cap must be at least the minimum commission (or 0 for no cap).')
        value = {'enabled': _truthy(payload.get('enabled', True)), 'rate': rate, 'minimum': minimum, 'cap': cap,
                 'hold_days': int(number('hold_days', 0, 30, 'payout hold (days)')), 'max_active': int(number('max_active', 1, 20, 'listings per seller'))}
        control.save_setting(self.db, SETTINGS_KEY, value, admin_id)
        return self.terms()

    # ------------------------------------------------------------------ reading
    def _rows(self, query) -> List[Dict[str, Any]]:
        try:
            return query.execute().data or []
        except Exception as error:
            if _missing_schema(error):
                raise SellerUnavailable(SETUP_MESSAGE) from error
            raise

    def _submission(self, submission_id: Any) -> Dict[str, Any]:
        rows = self._rows(self.client.table('auction_submissions').select('*').eq('submission_id', str(submission_id)).limit(1))
        if not rows:
            raise SellerError('This listing was not found.', 404, 'not_found')
        return rows[0]

    def _profiles(self, ids: Iterable[Any]) -> Dict[str, Dict[str, Any]]:
        wanted = sorted({str(i) for i in ids if i})
        if not wanted:
            return {}
        rows = self.client.table('user_profiles').select('account_id,fname,lname,campus_id,email,verification_status').in_('account_id', wanted).execute().data or []
        return {str(r['account_id']): r for r in rows}

    def _auctions(self, ids: Iterable[Any]) -> Dict[str, Dict[str, Any]]:
        wanted = sorted({str(i) for i in ids if i})
        if not wanted:
            return {}
        rows = self.client.table('auctions').select('*').in_('auction_id', wanted).execute().data or []
        return {str(r['auction_id']): r for r in rows}

    def _payouts_for(self, auction_ids: Iterable[Any]) -> Dict[str, Dict[str, Any]]:
        wanted = sorted({str(i) for i in auction_ids if i})
        if not wanted:
            return {}
        rows = self._rows(self.client.table('seller_payouts').select('*').in_('auction_id', wanted))
        return {str(r['auction_id']): r for r in rows}

    def _auction_state(self, auction: Optional[Dict[str, Any]], paid: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not auction:
            return None
        from app.utils.auction_db import AuctionService
        service = AuctionService(self.db)
        card = service.card(auction, {}, anonymous=True)
        stage = service.stage_of(card, auction)
        return {'id': str(auction['auction_id']), 'status': card['status'], 'stage': stage, 'current_price': card['current_price'], 'bid_count': card['bid_count'],
                'starts_at': card['starts_at'], 'ends_at': card['ends_at'], 'winning_amount': card['winning_amount'],
                'payment_confirmed': str(auction['auction_id']) in paid, 'collected_at': auction.get('fulfillment_updated_at') if auction.get('fulfillment_status') == 'collected' else None}

    def _ready_at(self, payout: Dict[str, Any], auction: Optional[Dict[str, Any]], hold_days: int) -> Optional[datetime]:
        """When the payout may be sent: the hold days after the buyer collected the item. None while it is not collected."""
        if not auction or auction.get('fulfillment_status') != 'collected':
            return None
        collected = _parse(auction.get('fulfillment_updated_at')) or _parse(payout.get('created_at')) or _now()
        return collected + timedelta(days=hold_days)

    def _payout_view(self, payout: Optional[Dict[str, Any]], auction: Optional[Dict[str, Any]], hold_days: int) -> Optional[Dict[str, Any]]:
        if not payout:
            return None
        ready_at = self._ready_at(payout, auction, hold_days) if payout.get('status') == 'holding' else None
        return {'id': str(payout['payout_id']), 'status': payout.get('status'), 'gross': float(_dec(payout.get('gross'))), 'commission': float(_dec(payout.get('commission'))),
                'commission_rate': float(_dec(payout.get('commission_rate'))), 'payout_amount': float(_dec(payout.get('payout_amount'))),
                'ready_at': _iso(ready_at) if ready_at else None, 'ready': bool(ready_at and ready_at <= _now()), 'collected': bool(auction and auction.get('fulfillment_status') == 'collected'),
                'method': payout.get('method'), 'reference': payout.get('reference') or '', 'receipt_no': payout.get('receipt_no'), 'paid_at': payout.get('paid_at'),
                'has_proof': bool(payout.get('proof_path')), 'cancelled_reason': payout.get('cancelled_reason') or '', 'created_at': payout.get('created_at')}

    @staticmethod
    def _phase(row: Dict[str, Any], auction: Optional[Dict[str, Any]], payout: Optional[Dict[str, Any]]) -> Tuple[str, str]:
        """(phase, what happens next) as the seller should read it."""
        status = row.get('status')
        if status == 'pending':
            return 'pending', 'Bring the item to the Lost and Found Office. Staff will check it against your photos and list it.'
        if status == 'changes_requested':
            return 'changes_requested', 'Edit your listing as the office asked, then send it again.'
        if status in ('rejected', 'withdrawn'):
            return status, ''
        if status == 'returned':
            return 'returned', 'The office gave the item back to you.'
        if not auction:
            return 'listed', 'The auction for this listing is no longer available. Contact the Lost and Found Office.'
        stage = auction['stage']
        if stage == 'scheduled':
            return 'scheduled', 'Your auction opens soon.'
        if stage == 'live':
            return 'live', 'Your auction is open for bids.'
        if stage == 'awaiting_admin':
            return 'ending', 'Bidding has closed. The office is confirming the result.'
        if stage in FINISHED_UNSOLD:
            return 'unsold', 'It did not sell. Collect your item from the Lost and Found Office.'
        if payout and payout['status'] == 'paid':
            return 'paid_out', 'The office sent your money. Your payout receipt is in My receipts.'
        if payout and payout['status'] == 'cancelled':
            return 'cancelled', 'The buyer was refunded, so there is nothing to pay out. Contact the office if you have questions.'
        if payout and payout['status'] == 'holding':
            if not payout['collected']:
                return 'paid', 'The buyer paid. You are paid after they collect the item and the hold period ends.'
            return 'holding', 'The buyer collected the item. Your payout is being prepared.' if payout['ready'] else 'The buyer collected the item. Your payout is sent after the hold period.'
        return 'sold', 'It sold. Waiting for the buyer to pay the office.'

    def _view(self, row: Dict[str, Any], auction: Optional[Dict[str, Any]], payout: Optional[Dict[str, Any]], terms: Dict[str, Any], staff: bool = False) -> Dict[str, Any]:
        rate, minimum, cap = row.get('commission_rate'), row.get('commission_minimum'), row.get('commission_cap')
        starting = _dec(row.get('starting_price'))
        price_now = _dec((auction or {}).get('winning_amount') or (auction or {}).get('current_price') or starting) if auction else starting
        commission, share = fee(price_now, rate, minimum, cap)
        phase, next_step = self._phase(row, auction, payout)
        view = {
            'id': str(row['submission_id']), 'title': row.get('title') or '', 'category': row.get('category') or '', 'condition': row.get('item_condition') or 'used',
            'description': row.get('description') or '', 'starting_price': float(starting),
            'buyout_price': float(_dec(row['buyout_price'])) if row.get('buyout_price') is not None else None, 'duration_days': int(row.get('duration_days') or 3),
            'photos': list(row.get('photo_urls') or []), 'status': row.get('status'), 'status_label': STATUS_LABELS.get(row.get('status'), row.get('status')),
            'phase': phase, 'next_step': next_step, 'review_note': row.get('review_note') or '', 'created_at': row.get('created_at'), 'updated_at': row.get('updated_at'),
            'reviewed_at': row.get('reviewed_at'), 'item_received_at': row.get('item_received_at'), 'returned_at': row.get('returned_at'),
            'payout_method': row.get('payout_method'), 'payout_method_label': PAYOUT_METHODS.get(row.get('payout_method'), row.get('payout_method')),
            'payout_account_name': row.get('payout_account_name') or '',
            'payout_account_number': (row.get('payout_account_number') or '') if staff else mask_account(row.get('payout_account_number')),
            'fee': {'rate': float(_dec(rate)), 'minimum': float(_dec(minimum)), 'cap': float(_dec(cap)), 'on_price': float(price_now), 'commission': float(commission), 'you_get': float(share)},
            'auction': auction, 'payout': payout, 'can_edit': row.get('status') in OPEN, 'can_withdraw': row.get('status') in OPEN,
            'hold_days': terms['hold_days'],
        }
        return view

    def _assemble(self, rows: List[Dict[str, Any]], staff: bool = False) -> List[Dict[str, Any]]:
        terms = self.terms()
        auctions = self._auctions([r.get('auction_id') for r in rows])
        payouts = self._payouts_for(auctions.keys())
        from app.utils.payments import PaymentDesk
        paid = PaymentDesk(self.db).paid_map('auction', list(auctions.keys())) or {}
        result = []
        for row in rows:
            auction_row = auctions.get(str(row.get('auction_id'))) if row.get('auction_id') else None
            auction = self._auction_state(auction_row, paid)
            payout = self._payout_view(payouts.get(str(row.get('auction_id'))), auction_row, terms['hold_days']) if auction_row else None
            result.append(self._view(row, auction, payout, terms, staff))
        return result

    # ------------------------------------------------------------------ the seller
    def eligibility(self, account_id: str) -> Dict[str, Any]:
        """Can this person list an item right now, and if not, why not (shown before they fill in the form)."""
        terms = self.terms()
        if not terms['enabled']:
            return {'can_sell': False, 'reason': 'The office is not accepting new listings right now.'}
        profile = (self.client.table('user_profiles').select('*').eq('account_id', str(account_id)).limit(1).execute().data or [{}])[0]
        if str(profile.get('verification_status') or '').lower() != 'verified':
            return {'can_sell': False, 'reason': 'Verify your UMak ID in your profile before you list an item.'}
        now = _now()
        for column, message in (('suspended_until', 'Your account is suspended, so you cannot list items.'),
                                ('bidding_banned_until', 'Listing and bidding are paused on your account because a won auction was not collected in time.')):
            until = _parse(profile.get(column))
            if until and until > now:
                return {'can_sell': False, 'reason': message}
        active = self._active_count(account_id)
        if active >= terms['max_active']:
            return {'can_sell': False, 'reason': f"You already have {active} listings in progress (the limit is {terms['max_active']}). Wait for one to finish."}
        return {'can_sell': True, 'reason': '', 'active': active}

    def _active_count(self, account_id: str) -> int:
        rows = self._rows(self.client.table('auction_submissions').select('submission_id,status,auction_id').eq('seller_account_id', str(account_id)).in_('status', list(OPEN) + ['listed']))
        listed = [r for r in rows if r.get('status') == 'listed']
        auctions = self._auctions([r.get('auction_id') for r in listed])
        payouts = self._payouts_for(auctions.keys()) if auctions else {}
        active = len(rows) - len(listed)
        for row in listed:
            auction = auctions.get(str(row.get('auction_id')))
            if not auction:
                continue
            payout = payouts.get(str(auction['auction_id']))
            finished = (auction.get('status') == 'cancelled' or (auction.get('status') == 'ended' and (not auction.get('winner_account_id') or auction.get('fulfillment_status') == 'forfeited'))
                        or (payout and payout.get('status') in ('paid', 'cancelled')))
            active += 0 if finished else 1
        return active

    def _validate(self, fields: Dict[str, Any]) -> Dict[str, Any]:
        title = _text(fields, 'title', 'title', 'item title')
        description = _text(fields, 'description', 'description', 'description')
        category = _clean(strip_markup(fields.get('category')), 60) or 'Other'
        condition = str(fields.get('condition') or 'used').strip().lower()
        if condition not in CONDITIONS:
            raise SellerError('Choose the condition of the item.')
        found = _PROHIBITED.search(f'{title} {description} {category}')
        if found:
            raise SellerError(f'"{found.group(0)}" cannot be sold in the Auction Hall. Weapons, vapes, alcohol, drugs, exam material, counterfeits, animals and '
                              'found property are not allowed. If you think this is a mistake, ask the Lost and Found Office.', 400, 'prohibited')
        starting = _price(fields.get('starting_price'), 'starting bid')
        buyout = _price(fields.get('buyout_price'), 'buy-now price', required=False)
        if buyout is not None and buyout <= starting:
            raise SellerError('The buy-now price must be higher than the starting bid (or leave it empty).')
        try:
            days = int(str(fields.get('duration_days') or 3).strip())
        except ValueError:
            days = 0
        if days not in DURATIONS:
            raise SellerError('Choose how long the auction should run.')
        method = str(fields.get('payout_method') or '').strip().lower()
        if method not in PAYOUT_METHODS:
            raise SellerError('Choose how you want to receive your money.')
        account_name, account_number = '', ''
        if method in ('gcash', 'maya'):
            account_name = _text(fields, 'payout_account_name', 'name', f'{PAYOUT_METHODS[method]} account name')
            account_number = re.sub(r'[\s-]', '', str(fields.get('payout_account_number') or ''))
            if account_number.startswith('+63'):
                account_number = '0' + account_number[3:]
            if not _MOBILE.match(account_number):
                raise SellerError(f'Enter the {PAYOUT_METHODS[method]} mobile number as 11 digits starting with 09.')
        elif method == 'bank':
            account_name = _clean(strip_markup(fields.get('payout_account_name')), 100)
            account_number = re.sub(r'[\s-]', '', str(fields.get('payout_account_number') or ''))
            if len(account_name) < 4:
                raise SellerError('Enter the bank and the account name, for example "BPI, Juan Dela Cruz".')
            if not re.fullmatch(r'\d{6,20}', account_number):
                raise SellerError('Enter the bank account number (6 to 20 digits).')
        return {'title': title, 'description': description, 'category': category, 'item_condition': condition, 'starting_price': str(starting),
                'buyout_price': str(buyout) if buyout is not None else None, 'duration_days': days, 'payout_method': method,
                'payout_account_name': account_name or None, 'payout_account_number': account_number or None}

    def _store_photos(self, account_id: str, photos: List[bytes]) -> List[str]:
        from app.utils.smart_tags import sniff_image
        urls: List[str] = []
        try:
            for data in photos:
                if not data:
                    continue
                if len(data) > MAX_PHOTO_BYTES:
                    raise SellerError('Each photo must be 5 MB or smaller.', 400, 'photo_too_large')
                kind = sniff_image(data)
                if not kind or kind[0] not in ('jpg', 'png'):
                    raise SellerError('Photos must be JPG or PNG images.', 400, 'photo_invalid')
                # A random name only: these photos become public on the Auction Hall, and the path must not reveal who the seller is.
                path = f'seller-listings/{uuid.uuid4().hex}.{kind[0]}'
                try:
                    self.client.storage.from_(PHOTO_BUCKET).upload(path, data, {'content-type': kind[1], 'upsert': 'false'})
                except Exception as error:
                    logger.warning('Seller photo upload failed: %s', error)
                    raise SellerError('A photo could not be saved. Check your connection and try again.', 502, 'photo_upload_failed')
                url = self.client.storage.from_(PHOTO_BUCKET).get_public_url(path)
                urls.append((url.get('publicUrl') or url.get('publicURL') or '') if isinstance(url, dict) else str(url))
        except SellerError:
            self._remove_photos(urls)
            raise
        return urls

    def _remove_photos(self, urls: Iterable[str]) -> None:
        marker = f'/{PHOTO_BUCKET}/'
        paths = [u.split(marker, 1)[1].split('?', 1)[0] for u in urls if isinstance(u, str) and marker in u and 'seller-listings/' in u]
        if not paths:
            return
        try:
            self.client.storage.from_(PHOTO_BUCKET).remove(paths)
        except Exception as error:
            logger.warning('Seller photo cleanup failed: %s', error)

    def submit(self, account_id: str, fields: Dict[str, Any], photos: List[bytes]) -> Dict[str, Any]:
        state = self.eligibility(account_id)
        if not state['can_sell']:
            raise SellerError(state['reason'], 403, 'cannot_sell')
        if not _truthy(fields.get('accept_terms')):
            raise SellerError('Read and accept the selling rules and the fee first.', 400, 'terms_required')
        values = self._validate(fields)
        photos = [p for p in photos if p]
        if not MIN_PHOTOS <= len(photos) <= MAX_PHOTOS:
            raise SellerError(f'Add {MIN_PHOTOS} to {MAX_PHOTOS} clear photos of the item.', 400, 'photos_required')
        terms = self.terms()
        urls = self._store_photos(account_id, photos)
        now = _iso(_now())
        row = {**values, 'seller_account_id': str(account_id), 'photo_urls': urls, 'commission_rate': str(terms['rate']), 'commission_minimum': str(terms['minimum']),
               'commission_cap': str(terms['cap']), 'status': 'pending', 'created_at': now, 'updated_at': now}
        try:
            created = (self.client.table('auction_submissions').insert(row).execute().data or [row])[0]
        except Exception as error:
            self._remove_photos(urls)
            if _missing_schema(error):
                raise SellerUnavailable(SETUP_MESSAGE) from error
            raise
        return self._assemble([created])[0]

    def update(self, account_id: str, submission_id: str, fields: Dict[str, Any], photos: List[bytes], keep: List[str]) -> Dict[str, Any]:
        row = self._submission(submission_id)
        if str(row.get('seller_account_id')) != str(account_id):
            raise SellerError('This listing was not found.', 404, 'not_found')
        if row.get('status') not in OPEN:
            raise SellerError('This listing can no longer be changed.', 409, 'locked')
        fields = dict(fields)
        if not str(fields.get('payout_account_number') or '').strip() and str(fields.get('payout_method') or '').strip().lower() == row.get('payout_method'):
            fields['payout_account_number'] = row.get('payout_account_number') or ''   # the seller only sees it masked, so an empty box keeps it
        values = self._validate(fields)
        existing = list(row.get('photo_urls') or [])
        kept = [u for u in existing if u in set(keep or [])]
        photos = [p for p in photos if p]
        if not MIN_PHOTOS <= len(kept) + len(photos) <= MAX_PHOTOS:
            raise SellerError(f'Keep or add {MIN_PHOTOS} to {MAX_PHOTOS} photos of the item.', 400, 'photos_required')
        added = self._store_photos(account_id, photos)
        update = {**values, 'photo_urls': kept + added, 'status': 'pending', 'updated_at': _iso(_now())}
        saved = self.client.table('auction_submissions').update(update).eq('submission_id', str(submission_id)).in_('status', list(OPEN)).execute().data or []
        if not saved:
            self._remove_photos(added)
            raise SellerError('This listing changed while you were editing it. Reload and try again.', 409, 'changed')
        self._remove_photos([u for u in existing if u not in kept])
        return self._assemble(saved)[0]

    def withdraw(self, account_id: str, submission_id: str) -> Dict[str, Any]:
        row = self._submission(submission_id)
        if str(row.get('seller_account_id')) != str(account_id):
            raise SellerError('This listing was not found.', 404, 'not_found')
        if row.get('status') not in OPEN:
            raise SellerError('Only a listing that is not yet on the Auction Hall can be withdrawn. Ask the office about a listed item.', 409, 'locked')
        saved = self.client.table('auction_submissions').update({'status': 'withdrawn', 'updated_at': _iso(_now())}).eq('submission_id', str(submission_id)).in_('status', list(OPEN)).execute().data or []
        if not saved:
            raise SellerError('This listing changed. Reload and try again.', 409, 'changed')
        self._remove_photos(row.get('photo_urls') or [])
        return self._assemble(saved)[0]

    def mine(self, account_id: str) -> Dict[str, Any]:
        rows = self._rows(self.client.table('auction_submissions').select('*').eq('seller_account_id', str(account_id)).order('created_at', desc=True).limit(100))
        items = self._assemble(rows)
        earned = sum(Decimal(str(i['payout']['payout_amount'])) for i in items if i['payout'] and i['payout']['status'] == 'paid')
        owed = sum(Decimal(str(i['payout']['payout_amount'])) for i in items if i['payout'] and i['payout']['status'] == 'holding')
        return {'listings': items, 'terms': self.terms(), 'eligibility': self.eligibility(account_id),
                'totals': {'paid_out': float(earned), 'owed': float(owed), 'sold': sum(1 for i in items if i['payout'] and i['payout']['status'] in ('holding', 'paid')),
                           'active': sum(1 for i in items if i['phase'] in ('pending', 'changes_requested', 'scheduled', 'live', 'ending', 'sold', 'paid', 'holding'))}}

    # ------------------------------------------------------------------ the office: reviewing listings
    def admin_list(self, status: str = '') -> Dict[str, Any]:
        query = self.client.table('auction_submissions').select('*').order('created_at', desc=True).limit(300)
        rows = self._rows(query)
        counts = {key: sum(1 for r in rows if r.get('status') == key) for key in STATUS_LABELS}
        chosen = [r for r in rows if not status or r.get('status') == status]
        items = self._assemble(chosen, staff=True)
        people = self._profiles([r.get('seller_account_id') for r in chosen] + [r.get('reviewed_by') for r in chosen])
        for item, row in zip(items, chosen):
            seller = people.get(str(row.get('seller_account_id'))) or {}
            item['seller'] = {'account_id': str(row.get('seller_account_id') or ''), 'name': _name(seller), 'campus_id': seller.get('campus_id') or '',
                              'email': seller.get('email') or '', 'verification_status': seller.get('verification_status') or ''}
            item['reviewed_by'] = _name(people.get(str(row.get('reviewed_by')))) if row.get('reviewed_by') else ''
            auction = item['auction']
            item['can_approve'] = row.get('status') in OPEN
            item['can_return'] = row.get('status') == 'listed' and (auction is None or auction['stage'] in FINISHED_UNSOLD)
        return {'listings': items, 'counts': counts, 'terms': self.terms()}

    def _notify(self, account_id: Any, title: str, message: str, link: str = 'auction-selling', label: str = 'View my listings') -> None:
        if not account_id:
            return
        try:
            self.db.create_user_notification(str(account_id), title, message, notification_type='seller_listing', link_label=label, link_page=link)
        except Exception as error:
            logger.warning('Seller notice failed: %s', error)

    def review(self, admin_id: str, submission_id: str, action: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        row = self._submission(submission_id)
        if str(row.get('seller_account_id')) == str(admin_id):
            raise SellerError('You cannot review your own listing. Ask another administrator.', 403, 'own_listing')
        if row.get('status') not in OPEN:
            raise SellerError('This listing was already reviewed. Reload the list.', 409, 'already_reviewed')
        note = _clean(payload.get('note'), 500)
        now = _now()
        if action in ('request_changes', 'reject'):
            if len(note) < 8:
                raise SellerError('Tell the seller what to change or why it was not accepted (at least 8 characters).')
            status = 'changes_requested' if action == 'request_changes' else 'rejected'
            saved = self.client.table('auction_submissions').update({'status': status, 'review_note': note, 'reviewed_by': str(admin_id), 'reviewed_at': _iso(now), 'updated_at': _iso(now)}) \
                .eq('submission_id', str(submission_id)).in_('status', list(OPEN)).execute().data or []
            if not saved:
                raise SellerError('This listing changed while you were reviewing it. Reload and try again.', 409, 'changed')
            if status == 'rejected':
                self._remove_photos(row.get('photo_urls') or [])
                self._notify(row['seller_account_id'], 'Listing not accepted', f"The office did not accept \"{row.get('title')}\": {note}")
            else:
                self._notify(row['seller_account_id'], 'Changes needed on your listing', f"The office asked for changes to \"{row.get('title')}\": {note}", label='Edit my listing')
            return self._assemble(saved, staff=True)[0]
        if action != 'approve':
            raise SellerError('Choose approve, request changes or reject.')
        if not _truthy(payload.get('item_received')):
            raise SellerError('Approve only when the item is at the office and matches the photos. Tick "The item is at the office".', 400, 'item_not_received')
        claimed = self.client.table('auction_submissions').update({'status': 'listed', 'review_note': note or None, 'reviewed_by': str(admin_id), 'reviewed_at': _iso(now),
                                                                  'item_received_at': _iso(now), 'updated_at': _iso(now)}) \
            .eq('submission_id', str(submission_id)).in_('status', list(OPEN)).execute().data or []
        if not claimed:
            raise SellerError('This listing changed while you were reviewing it. Reload and try again.', 409, 'changed')
        from app.utils.auction_db import AuctionError, AuctionService
        try:
            auction = AuctionService(self.db).create_seller_auction(row, payload, str(admin_id))
        except Exception as error:
            self.client.table('auction_submissions').update({'status': row.get('status'), 'reviewed_by': row.get('reviewed_by'), 'reviewed_at': row.get('reviewed_at'),
                                                            'item_received_at': None, 'review_note': row.get('review_note'), 'updated_at': _iso(_now())}) \
                .eq('submission_id', str(submission_id)).execute()
            if isinstance(error, AuctionError):
                raise SellerError(error.message, error.status, 'auction_rejected') from error
            raise
        saved = self.client.table('auction_submissions').update({'auction_id': auction['auction_id']}).eq('submission_id', str(submission_id)).execute().data or claimed
        when = 'now open for bids' if auction.get('status') == 'active' else 'scheduled'
        self._notify(row['seller_account_id'], 'Your item is on the Auction Hall', f"\"{row.get('title')}\" is {when}. The office keeps the item until it is collected by the buyer.")
        return self._assemble(saved, staff=True)[0]

    def return_item(self, admin_id: str, submission_id: str, note: Any) -> Dict[str, Any]:
        """The item did not sell (or the auction was cancelled): the office gives it back to the seller."""
        row = self._submission(submission_id)
        if row.get('status') != 'listed':
            raise SellerError('Only a listed item that did not sell can be given back.', 409, 'not_listed')
        view = self._assemble([row], staff=True)[0]
        auction = view['auction']
        if auction and auction['stage'] not in FINISHED_UNSOLD:
            raise SellerError('The auction is still running or the item sold. Cancel the auction first, or finish the sale.', 409, 'still_selling')
        now = _now()
        saved = self.client.table('auction_submissions').update({'status': 'returned', 'returned_at': _iso(now), 'review_note': _clean(note, 500) or row.get('review_note'),
                                                                'updated_at': _iso(now)}).eq('submission_id', str(submission_id)).eq('status', 'listed').execute().data or []
        if not saved:
            raise SellerError('This listing changed. Reload and try again.', 409, 'changed')
        self._notify(row['seller_account_id'], 'Item returned to you', f"The office gave \"{row.get('title')}\" back to you.")
        return self._assemble(saved, staff=True)[0]

    # ------------------------------------------------------------------ money: called by PaymentDesk when a buyer's payment is confirmed or reversed
    def split_for(self, auction: Dict[str, Any], gross: Decimal) -> Dict[str, Any]:
        """The commission and the seller's share for a seller's auction, using the terms the seller accepted."""
        terms: Dict[str, Any] = {}
        if auction.get('submission_id'):
            try:
                terms = (self.client.table('auction_submissions').select('*').eq('submission_id', str(auction['submission_id'])).limit(1).execute().data or [{}])[0]
            except Exception as error:
                if _missing_schema(error):
                    raise SellerUnavailable(SETUP_MESSAGE) from error
                raise
        current = self.terms()
        rate = terms.get('commission_rate', current['rate'])
        minimum = terms.get('commission_minimum', current['minimum'])
        cap = terms.get('commission_cap', current['cap'])
        commission, share = fee(gross, rate, minimum, cap)
        return {'rate': _dec(rate), 'minimum': _dec(minimum), 'cap': _dec(cap), 'commission': commission, 'share': share, 'submission_id': terms.get('submission_id')}

    def open_payout(self, auction: Dict[str, Any], sale_entry: Dict[str, Any], split: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Record what the Office owes the seller after the buyer's payment was confirmed. Best effort: `payouts()` rebuilds a missing row."""
        row = {'auction_id': str(auction['auction_id']), 'submission_id': split.get('submission_id'), 'title': (auction.get('title') or 'Auction item')[:255],
               'seller_account_id': str(auction['seller_account_id']), 'buyer_account_id': str(auction['winner_account_id']) if auction.get('winner_account_id') else None,
               'sale_entry_id': sale_entry.get('entry_id'), 'gross': str(split['commission'] + split['share']), 'commission_rate': str(split['rate']),
               'commission': str(split['commission']), 'payout_amount': str(split['share']), 'status': 'holding'}
        try:
            created = (self.client.table('seller_payouts').insert(row).execute().data or [row])[0]
        except Exception as error:
            logger.error('Seller payout row for auction %s not saved (it is rebuilt from the ledger): %s', auction.get('auction_id'), error)
            return None
        hold = self.terms()['hold_days']
        self._notify(auction['seller_account_id'], 'Your item sold and the buyer paid',
                     f"\"{auction.get('title')}\" sold for ₱{split['commission'] + split['share']:,.2f}. You will receive ₱{split['share']:,.2f} "
                     f"(after the ₱{split['commission']:,.2f} office fee) once the buyer collects the item and the {hold}-day hold ends.")
        return created

    def payout_for(self, auction_id: Any) -> Optional[Dict[str, Any]]:
        try:
            rows = self.client.table('seller_payouts').select('*').eq('auction_id', str(auction_id)).limit(1).execute().data or []
        except Exception:
            return None
        return rows[0] if rows else None

    def cancel_payout(self, auction_id: Any, reason: str) -> None:
        """The buyer's payment was reversed: nothing is owed to the seller any more."""
        now = _iso(_now())
        try:
            rows = self.client.table('seller_payouts').update({'status': 'cancelled', 'cancelled_at': now, 'cancelled_reason': _clean(reason, 300), 'updated_at': now}) \
                .eq('auction_id', str(auction_id)).eq('status', 'holding').execute().data or []
        except Exception as error:
            logger.error('Seller payout for auction %s not cancelled: %s', auction_id, error)
            return
        for row in rows:
            self._notify(row.get('seller_account_id'), 'Sale reversed', f"The office refunded the buyer of \"{row.get('title')}\", so there is no payout for it. Contact the office if you have questions.")

    # ------------------------------------------------------------------ the office: paying sellers
    def _heal(self) -> None:
        """A seller's share in the ledger without its payout row (the second write failed): rebuild the row so nobody is forgotten."""
        try:
            shares = self.client.table('income_ledger').select('entry_id,source_ref,amount,received_at').eq('kind', 'payout').eq('source', 'auction').limit(5000).execute().data or []
        except Exception:
            return
        owed = {str(s['source_ref']): s for s in shares if _dec(s.get('amount')) < 0 and s.get('source_ref')}
        cancelled = {str(s['source_ref']) for s in shares if _dec(s.get('amount')) > 0 and s.get('source_ref')}
        if not owed:
            return
        have = self._payouts_for(owed.keys())
        missing = [ref for ref in owed if ref not in have and ref not in cancelled]
        if not missing:
            return
        auctions = self._auctions(missing)
        sales = {str(s['source_ref']): s for s in (self.client.table('income_ledger').select('entry_id,source_ref,amount').eq('kind', 'sale').eq('source', 'auction').in_('source_ref', missing).execute().data or [])}
        for ref in missing:
            auction, sale = auctions.get(ref), sales.get(ref)
            if not auction or not sale or not auction.get('seller_account_id'):
                continue
            share = -_dec(owed[ref]['amount'])
            gross = _dec(sale.get('amount'))
            split = self.split_for(auction, gross)
            split.update({'share': share, 'commission': gross - share})
            self.open_payout(auction, sale, split)

    def payouts(self, status: str = '') -> Dict[str, Any]:
        self._heal()
        rows = self._rows(self.client.table('seller_payouts').select('*').order('created_at', desc=True).limit(500))
        terms = self.terms()
        auctions = self._auctions([r.get('auction_id') for r in rows])
        submissions = {}
        sub_ids = sorted({str(r['submission_id']) for r in rows if r.get('submission_id')})
        if sub_ids:
            submissions = {str(s['submission_id']): s for s in (self.client.table('auction_submissions').select('*').in_('submission_id', sub_ids).execute().data or [])}
        people = self._profiles([r.get(k) for r in rows for k in ('seller_account_id', 'buyer_account_id', 'paid_by')])
        items = []
        for row in rows:
            auction = auctions.get(str(row.get('auction_id')))
            view = self._payout_view(row, auction, terms['hold_days'])
            sub = submissions.get(str(row.get('submission_id'))) or {}
            seller = people.get(str(row.get('seller_account_id'))) or {}
            view.update({'auction_id': str(row.get('auction_id') or ''), 'title': row.get('title') or '', 'submission_id': str(row.get('submission_id') or ''),
                         'seller': {'account_id': str(row.get('seller_account_id') or ''), 'name': _name(seller), 'campus_id': seller.get('campus_id') or '', 'email': seller.get('email') or ''},
                         'buyer_name': _name(people.get(str(row.get('buyer_account_id')))), 'paid_by': _name(people.get(str(row.get('paid_by')))),
                         'destination': {'method': sub.get('payout_method') or 'cash', 'label': PAYOUT_METHODS.get(sub.get('payout_method') or 'cash'),
                                         'account_name': sub.get('payout_account_name') or '', 'account_number': sub.get('payout_account_number') or ''},
                         'notes': row.get('notes') or ''})
            view['state'] = 'paid' if row.get('status') == 'paid' else 'cancelled' if row.get('status') == 'cancelled' else ('ready' if view['ready'] else 'waiting_pickup' if not view['collected'] else 'on_hold')
            items.append(view)
        totals = {
            'owed': float(sum(_dec(i['payout_amount']) for i in items if i['status'] == 'holding')), 'owed_count': sum(1 for i in items if i['status'] == 'holding'),
            'ready': float(sum(_dec(i['payout_amount']) for i in items if i['state'] == 'ready')), 'ready_count': sum(1 for i in items if i['state'] == 'ready'),
            'paid': float(sum(_dec(i['payout_amount']) for i in items if i['status'] == 'paid')), 'paid_count': sum(1 for i in items if i['status'] == 'paid'),
            'commission': float(sum(_dec(i['commission']) for i in items if i['status'] in ('holding', 'paid'))),
            'gross': float(sum(_dec(i['gross']) for i in items if i['status'] in ('holding', 'paid'))),
            'cancelled_count': sum(1 for i in items if i['status'] == 'cancelled'),
        }
        chosen = [i for i in items if not status or i['state'] == status or i['status'] == status]
        return {'payouts': chosen, 'totals': totals, 'terms': terms, 'methods': PAYOUT_METHODS}

    def _store_proof(self, payout_id: str, data: bytes) -> str:
        from app.utils.smart_tags import sniff_image
        if len(data) > MAX_PHOTO_BYTES:
            raise SellerError('That image is larger than 5 MB. Use a smaller screenshot.', 400, 'proof_too_large')
        kind = sniff_image(data)
        if not kind:
            raise SellerError('The transfer receipt must be a JPG, PNG or WEBP image.', 400, 'proof_invalid')
        path = f'payouts/{payout_id}/{uuid.uuid4().hex}.{kind[0]}'
        try:
            self.client.storage.from_(PROOF_BUCKET).upload(path, data, {'content-type': kind[1], 'upsert': 'false'})
        except Exception as error:
            logger.warning('Payout proof upload failed: %s', error)
            raise SellerError('The image could not be saved. Check the connection and try again.', 502, 'proof_upload_failed') from error
        return path

    def pay(self, admin_id: str, payout_id: str, method: Any, reference: Any, notes: Any, proof: bytes = b'') -> Dict[str, Any]:
        rows = self._rows(self.client.table('seller_payouts').select('*').eq('payout_id', str(payout_id)).limit(1))
        if not rows:
            raise SellerError('This payout was not found.', 404, 'not_found')
        row = rows[0]
        if row.get('status') != 'holding':
            raise SellerError('This payout was already sent or cancelled. Reload the list.', 409, 'not_holding')
        if str(row.get('seller_account_id')) == str(admin_id):
            raise SellerError('You cannot send a payout to yourself. Ask another administrator.', 403, 'own_payout')
        auction = self._auctions([row.get('auction_id')]).get(str(row.get('auction_id')))
        ready_at = self._ready_at(row, auction, self.terms()['hold_days'])
        if not ready_at:
            raise SellerError('The buyer has not collected the item yet. Pay the seller after the handover.', 409, 'not_collected')
        if ready_at > _now():
            raise SellerError(f"The hold period ends on {ready_at.astimezone(timezone(timedelta(hours=8))).strftime('%b %d, %Y %I:%M %p')}. Pay the seller after that.", 409, 'on_hold')
        method = str(method or '').strip().lower()
        if method not in PAYOUT_METHODS:
            raise SellerError('Choose how you paid the seller.')
        reference = _clean(reference, 64)
        if method in E_PAYOUTS and len(reference) < 4:
            raise SellerError('Enter the transfer reference number (at least 4 characters).')
        if method in E_PAYOUTS and not proof:
            raise SellerError('Attach the transfer receipt (a screenshot of the GCash, Maya or bank transfer).', 400, 'proof_required')
        path = self._store_proof(str(payout_id), proof) if proof else None
        now = _now()
        update = {'status': 'paid', 'method': method, 'reference': reference or None, 'notes': _clean(notes, 300) or None, 'paid_at': _iso(now), 'paid_by': str(admin_id),
                  'receipt_no': receipts.payout_number(row.get('auction_id'), now), 'updated_at': _iso(now)}
        if path:
            update['proof_path'] = path
        saved = self.client.table('seller_payouts').update(update).eq('payout_id', str(payout_id)).eq('status', 'holding').execute().data or []
        if not saved:
            if path:
                try:
                    self.client.storage.from_(PROOF_BUCKET).remove([path])
                except Exception:
                    pass
            raise SellerError('This payout changed while you were working. Reload and try again.', 409, 'changed')
        receipt = receipts.receipt_for_payout(self.db, str(payout_id))
        self._email_payout(row, receipt)
        return {'payout': saved[0], 'receipt': receipt}

    def _email_payout(self, row: Dict[str, Any], receipt: Optional[Dict[str, Any]]) -> None:
        if not receipt:
            return
        self._notify(row.get('seller_account_id'), 'Payout sent', f"The office sent you ₱{_dec(receipt['amount']):,.2f} for \"{row.get('title')}\". Your payout receipt is {receipt['receipt_no']}.",
                     link='receipts', label='View receipt')
        try:
            profile = self.db.get_user_by_account_id(str(row.get('seller_account_id'))) or {}
            if profile.get('email'):
                from app.utils.email_service import send_notice_email_best_effort, site_url
                send_notice_email_best_effort(
                    profile['email'], f"Payout receipt {receipt['receipt_no']}", title='Your payout was sent', preheader=f"Receipt {receipt['receipt_no']}",
                    greeting=f"Hello {str(profile.get('fname') or '').strip() or 'there'},",
                    paragraphs=[f"The Lost and Found Office sent you PHP {_dec(receipt['amount']):,.2f} for \"{row.get('title')}\", which sold in the Auction Hall for "
                                f"PHP {_dec(receipt['gross']):,.2f} (office fee PHP {_dec(receipt['commission']):,.2f}). Keep this receipt number and code."],
                    highlight=('RECEIPT NUMBER', receipt['receipt_no']), highlight_note=f"Verification code {receipt['code']}",
                    details={'Item': row.get('title') or 'Auction item', 'Sold for': f"PHP {_dec(receipt['gross']):,.2f}", 'Office fee': f"PHP {_dec(receipt['commission']):,.2f}",
                             'You received': f"PHP {_dec(receipt['amount']):,.2f}", 'Sent by': PAYOUT_METHODS.get(receipt.get('method'), receipt.get('method'))},
                    cta=('View my receipts', site_url()),
                )
        except Exception as error:
            logger.warning('Payout receipt email failed: %s', error)

    def proof_url(self, payout_id: str) -> Optional[str]:
        rows = self._rows(self.client.table('seller_payouts').select('proof_path').eq('payout_id', str(payout_id)).limit(1))
        path = rows[0].get('proof_path') if rows else None
        if not path:
            return None
        try:
            result = self.client.storage.from_(PROOF_BUCKET).create_signed_url(path, PROOF_URL_SECONDS)
            if isinstance(result, dict):
                return result.get('signedURL') or result.get('signedUrl') or result.get('signed_url')
        except Exception as error:
            logger.warning('Payout proof link failed: %s', error)
        return None
