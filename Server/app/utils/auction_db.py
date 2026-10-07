"""Auction Hall data layer: public feed, bidding, comments, settlement and admin management.

Every database access goes through `AuctionService(db)`. Bid validation, price updates, anti-snipe extension and
winner selection run inside Postgres (see Server/manual_migrations/20261005_auction_hall.sql) so concurrent bids
cannot corrupt a price or award an auction twice.
"""
import hashlib
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Dict, Iterable, List, Optional

from app.utils.auction_email import format_peso, send_auction_final_warning_email, send_auction_forfeited_email, send_auction_won_email
from app.utils.profanity import find_profanity

logger = logging.getLogger(__name__)

MIN_CUSTODY_DAYS = 30
LIVE_STATUSES = ('scheduled', 'active')
# Live plus the state after the timer ends while an admin decides: the item is still committed to this auction.
OPEN_STATUSES = ('scheduled', 'active', 'awaiting_admin')
OPEN_CLAIM_STATUSES = ('pending', 'approved_for_pickup')
MAX_PRICE = Decimal('10000000')
MAX_COMMENT_LENGTH = 500
MAX_GALLERY_IMAGES = 4
MIN_DURATION_MINUTES = 15
MAX_DURATION_MINUTES = 60 * 24 * 60
PAST_AUCTION_DAYS = 60
COMMENT_COOLDOWN_SECONDS = 5
SETTLE_THROTTLE_SECONDS = 2.0
# A confirmed winner has 48 hours before a final warning and 72 hours before the win is forfeited.
PICKUP_WARNING_HOURS = 48
PICKUP_FORFEIT_HOURS = 72
BIDDING_BAN_DAYS = 30
STAFF_LEVELS = ('admin', 'super_admin')

_last_settle = [0.0]

BID_ERRORS = {
    'account_inactive': ("Your account can't place bids right now.", 403),
    'not_found': ('Auction not found.', 404),
    'auction_closed': ('Bidding has closed on this auction.', 409),
    'not_started': ('Bidding has not opened yet.', 409),
    'item_unavailable': ('This item is no longer available.', 409),
    'already_highest': ('You already have the highest bid.', 409),
    'invalid_amount': ('Enter a valid bid amount.', 400),
    'bid_too_high': ('That bid is above the allowed maximum.', 400),
    'bid_too_low': ('Your bid is below the minimum.', 409),
}


class AuctionError(Exception):
    """A business-rule failure with the HTTP status the route should return."""

    def __init__(self, message: str, status: int = 400, **extra: Any):
        super().__init__(message)
        self.message = message
        self.status = status
        self.extra = extra


class AuctionsUnavailable(Exception):
    """The auction tables or functions have not been created in Supabase yet."""


def _is_missing_schema(error: Exception) -> bool:
    text = str(error).lower()
    markers = ('pgrst205', 'pgrst202', '42p01', '42883', 'schema cache', 'does not exist', 'could not find the')
    return 'auction' in text and any(marker in text for marker in markers)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _num(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def parse_money(value: Any, field: str, minimum: Decimal = Decimal('0.01'), maximum: Decimal = MAX_PRICE) -> Decimal:
    try:
        amount = Decimal(str(value).replace(',', '').strip()).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, AttributeError):
        raise AuctionError(f'Enter a valid {field}.')
    if not amount.is_finite() or amount < minimum or amount > maximum:
        raise AuctionError(f'The {field} must be between {format_peso(minimum)} and {format_peso(maximum)}.')
    return amount


def parse_buyout(value: Any, starting: Decimal) -> Optional[Decimal]:
    """The optional Buy Now price. It must be higher than the starting bid, or nobody could ever bid."""
    if value is None or str(value).strip() == '':
        return None
    amount = parse_money(value, 'Buy Now price')
    if amount <= starting:
        raise AuctionError('The Buy Now price must be higher than the starting bid.')
    return amount


def parse_int(value: Any, field: str, minimum: int, maximum: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise AuctionError(f'Enter a whole number for the {field}.')
    if number < minimum or number > maximum:
        raise AuctionError(f'The {field} must be between {minimum} and {maximum}.')
    return number


def mask_name(profile: Optional[Dict[str, Any]]) -> str:
    """Public display name: first name plus last initial. Never exposes email or campus ID."""
    if not profile:
        return 'Former bidder'
    first = str(profile.get('fname') or '').strip().split(' ')[0]
    last = str(profile.get('lname') or '').strip()
    if not first:
        return 'Bidder'
    return f"{first} {last[0].upper()}." if last else first


_ALIAS_CHARS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'  # no I or O, so aliases are easy to read


def bidder_alias(auction_id: Any, account_id: Any) -> str:
    """Anonymous public name such as Bidder_8X9. Stable inside one auction (the same person always gets the same
    alias there), different across auctions, and not derivable without the server secret."""
    if not account_id:
        return 'Former bidder'
    secret = os.getenv('JWT_SECRET_KEY', '')
    number = int.from_bytes(hashlib.sha256(f'{auction_id}:{account_id}:{secret}'.encode()).digest()[:4], 'big')
    return 'Bidder_' + ''.join(_ALIAS_CHARS[(number // len(_ALIAS_CHARS) ** i) % len(_ALIAS_CHARS)] for i in range(3))


def _chunks(values: List[str], size: int = 100) -> Iterable[List[str]]:
    for index in range(0, len(values), size):
        yield values[index:index + size]


class AuctionService:
    def __init__(self, db):
        self.db = db
        self.client = db.client

    # ------------------------------------------------------------------ helpers
    def _guard(self, error: Exception):
        if _is_missing_schema(error):
            raise AuctionsUnavailable('The Auction Hall is not set up yet. Run the 20261005_auction_hall.sql and 20261009_tag_expiry_and_auction_buyout.sql migrations in Supabase.') from error
        raise error

    def _profiles(self, ids: Iterable[Optional[str]]) -> Dict[str, Dict[str, Any]]:
        wanted = [str(i) for i in set(ids) if i]
        found: Dict[str, Dict[str, Any]] = {}
        for chunk in _chunks(wanted):
            rows = self.client.table('user_profiles').select('account_id,fname,lname,campus_id,email').in_('account_id', chunk).execute().data or []
            found.update({str(row['account_id']): row for row in rows})
        return found

    @staticmethod
    def _gallery(row: Dict[str, Any]) -> List[str]:
        seen: List[str] = []
        for url in [row.get('image_url'), *(row.get('gallery_urls') or [])]:
            if isinstance(url, str) and url and url not in seen:
                seen.append(url)
        return seen

    @staticmethod
    def _public_status(row: Dict[str, Any], now: datetime) -> str:
        status = row.get('status')
        if status == 'awaiting_admin':
            return 'awaiting'
        if status in LIVE_STATUSES:
            starts, ends = _parse(row.get('starts_at')), _parse(row.get('ends_at'))
            if ends and ends <= now:
                return 'awaiting' if int(row.get('bid_count') or 0) > 0 else 'ended'
            if starts and starts > now:
                return 'scheduled'
            return 'live'
        return status or 'ended'

    def card(self, row: Dict[str, Any], profiles: Dict[str, Dict[str, Any]], now: Optional[datetime] = None,
             anonymous: bool = True, reactions: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
        now = now or _now()
        starting, increment, current = _num(row.get('starting_price')), _num(row.get('bid_increment')), _num(row.get('current_price'))
        bid_count = int(row.get('bid_count') or 0)
        status = self._public_status(row, now)
        winner_id = str(row['winner_account_id']) if row.get('winner_account_id') else None
        leader_id = str(row['highest_bidder_id']) if row.get('highest_bidder_id') else None
        return {
            'id': str(row['auction_id']),
            'reference': row.get('item_reference') or '',
            'title': row.get('title') or 'Auction item',
            'description': row.get('description') or '',
            'category': row.get('category') or '',
            'location': row.get('found_location') or '',
            'image_url': row.get('image_url') or '',
            'gallery': self._gallery(row),
            'starting_price': starting,
            'bid_increment': increment,
            'current_price': current,
            'min_next_bid': starting if bid_count == 0 else round(current + increment, 2),
            'bid_count': bid_count,
            'starts_at': row.get('starts_at'),
            'ends_at': row.get('ends_at'),
            'original_ends_at': row.get('original_ends_at'),
            'extension_count': int(row.get('extension_count') or 0),
            'anti_snipe_enabled': bool(row.get('anti_snipe_enabled')),
            'anti_snipe_window_seconds': int(row.get('anti_snipe_window_seconds') or 0),
            'anti_snipe_extension_seconds': int(row.get('anti_snipe_extension_seconds') or 0),
            'max_extensions': int(row.get('max_extensions') or 0),
            'status': status,
            'is_open': status == 'live',
            'buyout_price': _num(row.get('buyout_price')) if row.get('buyout_price') is not None else None,
            'bought_out': bool(row.get('bought_out')),
            'leader': (bidder_alias(row['auction_id'], leader_id) if anonymous else mask_name(profiles.get(leader_id))) if leader_id else None,
            'winner': (bidder_alias(row['auction_id'], winner_id) if anonymous else mask_name(profiles.get(winner_id))) if winner_id and status == 'ended' else None,
            'reaction_count': int((reactions or {}).get(str(row['auction_id']), 0)),
            'winning_amount': _num(row.get('winning_amount')) if winner_id and status == 'ended' else None,
            'sold': bool(winner_id) and status == 'ended',
            'awaiting_admin': status == 'awaiting',
            'cancel_reason': row.get('cancel_reason') if status == 'cancelled' else None,
        }

    # ------------------------------------------------------------------ settlement
    def settle_and_notify(self, force: bool = False) -> int:
        """Start due auctions, close finished ones and send each winner notice exactly once."""
        if not force and time.monotonic() - _last_settle[0] < SETTLE_THROTTLE_SECONDS:
            return 0
        _last_settle[0] = time.monotonic()
        try:
            self.client.rpc('auction_settle_due', {}).execute()
        except Exception as error:
            self._guard(error)
        return self._notify_pending_winners()

    def _notify_awaiting_leaders(self) -> None:
        """Tell the top bidder bidding closed and an admin will confirm the result (once per auction)."""
        try:
            rows = self.client.table('auctions').select('auction_id').eq('status', 'awaiting_admin').not_.is_('winner_account_id', 'null').is_('leader_notified_at', 'null').limit(20).execute().data or []
        except Exception as error:
            logger.warning('Leader notices skipped: %s', error)
            return
        for row in rows:
            claimed = self.client.table('auctions').update({'leader_notified_at': _iso(_now())}).eq('auction_id', row['auction_id']).is_('leader_notified_at', 'null').execute().data or []
            if not claimed:
                continue
            auction = claimed[0]
            try:
                self.db.create_user_notification(
                    str(auction['winner_account_id']), 'Bidding closed: you have the highest bid',
                    f"Bidding on {auction.get('title')} ended and your {format_peso(auction.get('winning_amount'))} bid is the highest. An administrator will confirm the result soon.",
                    notification_type='auction_awaiting', link_label='View auction', link_page='auction-hall',
                )
            except Exception as error:
                logger.warning('Leader notification failed: %s', error)

    def _notify_pending_winners(self) -> int:
        self._notify_awaiting_leaders()
        pending = self.client.table('auctions').select('auction_id').eq('status', 'ended').in_('fulfillment_status', ['awaiting_pickup', 'collected']).not_.is_('winner_account_id', 'null').is_('winner_notified_at', 'null').limit(20).execute().data or []
        sent = 0
        for row in pending:
            # Claim the notice atomically: only the request whose update matches a still-null winner_notified_at sends it.
            claimed = self.client.table('auctions').update({'winner_notified_at': _iso(_now())}).eq('auction_id', row['auction_id']).is_('winner_notified_at', 'null').execute().data or []
            if not claimed:
                continue
            auction = claimed[0]
            try:
                self._send_winner_notice(auction)
                sent += 1
            except Exception as error:
                logger.exception('Winner notice failed for auction %s: %s', auction.get('auction_id'), error)
        return sent

    def _send_winner_notice(self, auction: Dict[str, Any]) -> None:
        winner = (self._profiles([auction.get('winner_account_id')]) or {}).get(str(auction.get('winner_account_id')))
        if not winner:
            return
        title, amount = auction.get('title') or 'the item', auction.get('winning_amount')
        try:
            self.db.create_user_notification(
                str(winner['account_id']),
                'You won the auction',
                f"Your bid of {format_peso(amount)} won {title}. Bring your ID to the Lost and Found Office to pay and collect it within {PICKUP_FORFEIT_HOURS} hours, or the win is forfeited.",
                notification_type='auction_won', link_label='View auction', link_page='auction-hall',
            )
        except Exception as error:
            logger.exception('Winner in-app notification failed: %s', error)
        self._email_winner(auction, winner)

    def _email_winner(self, auction: Dict[str, Any], winner: Dict[str, Any]) -> Dict[str, Any]:
        """Send the winner email and record how it went (`mode`, or `mode_failed`) so an admin can see and resend it."""
        result = send_auction_won_email(
            to_email=winner.get('email') or '',
            recipient_name=str(winner.get('fname') or '').strip(),
            item_title=auction.get('title') or 'the item',
            reference=auction.get('item_reference') or '',
            amount=auction.get('winning_amount'),
        )
        recorded = result.get('mode') if result.get('sent') else f"{result.get('mode')}_failed"
        self.client.table('auctions').update({'winner_email_mode': recorded}).eq('auction_id', auction['auction_id']).execute()
        return {**result, 'recorded': recorded}

    def winner_email_state(self, auction_id: str) -> str:
        """How the winner email went: 'sendgrid', 'mock', 'sendgrid_failed' or '' when none was attempted."""
        try:
            return str(self._live_row(auction_id).get('winner_email_mode') or '')
        except Exception:
            return ''

    def resend_winner_email(self, auction_id: str) -> Dict[str, Any]:
        """Admin action: send the winner email again (for example after a SendGrid failure)."""
        try:
            row = self._live_row(auction_id)
        except AuctionError:
            raise
        except Exception as error:
            self._guard(error)
        if not (row.get('status') == 'ended' and row.get('winner_account_id') and row.get('fulfillment_status') in ('awaiting_pickup', 'collected')):
            raise AuctionError('Only a confirmed winner can be emailed.', 409)
        winner = (self._profiles([row.get('winner_account_id')]) or {}).get(str(row['winner_account_id']))
        if not winner or not winner.get('email'):
            raise AuctionError('The winner has no email address on file.', 409)
        result = self._email_winner(row, winner)
        # The pickup clock runs from the first notice, so a resend only fills the time in when it was never set.
        self.client.table('auctions').update({'winner_notified_at': _iso(_now())}).eq('auction_id', auction_id).is_('winner_notified_at', 'null').execute()
        return {'auction': row, **result}

    # ------------------------------------------------------------------ pickup deadlines (run by the scheduler)
    def process_overdue_pickups(self, now: Optional[datetime] = None, warning_hours: int = PICKUP_WARNING_HOURS,
                                forfeit_hours: int = PICKUP_FORFEIT_HOURS, ban_days: int = BIDDING_BAN_DAYS) -> Dict[str, Any]:
        """Warn winners who have not collected after `warning_hours` and forfeit the win after `forfeit_hours`.

        The clock starts when the winner was first notified (`winner_notified_at`). Every step claims its row with a
        conditional update, so two workers or two overlapping runs can never warn or forfeit the same auction twice.
        """
        now = now or _now()
        summary: Dict[str, Any] = {'checked': 0, 'warned': 0, 'forfeited': 0, 'errors': 0}
        try:
            rows = self.client.table('auctions').select('*').eq('status', 'ended').eq('fulfillment_status', 'awaiting_pickup') \
                .not_.is_('winner_account_id', 'null').not_.is_('winner_notified_at', 'null').limit(200).execute().data or []
        except Exception as error:
            logger.warning('Pickup deadline check skipped: %s', error)
            summary['errors'] += 1
            return summary
        for row in rows:
            started = _parse(row.get('winner_notified_at'))
            if not started:
                continue
            summary['checked'] += 1
            age_hours = (now - started).total_seconds() / 3600
            try:
                if age_hours >= forfeit_hours:
                    if self._auto_forfeit(row, now, ban_days):
                        summary['forfeited'] += 1
                elif age_hours >= warning_hours and not row.get('pickup_warning_sent_at'):
                    if self._send_final_warning(row, now, max(1, round(forfeit_hours - age_hours))):
                        summary['warned'] += 1
            except Exception as error:
                summary['errors'] += 1
                logger.exception('Pickup deadline step failed for auction %s: %s', row.get('auction_id'), error)
        return summary

    def _send_final_warning(self, row: Dict[str, Any], now: datetime, hours_left: int) -> bool:
        claimed = self.client.table('auctions').update({'pickup_warning_sent_at': _iso(now)}).eq('auction_id', row['auction_id']) \
            .eq('fulfillment_status', 'awaiting_pickup').is_('pickup_warning_sent_at', 'null').execute().data or []
        if not claimed:
            return False
        winner = (self._profiles([row.get('winner_account_id')]) or {}).get(str(row.get('winner_account_id')))
        if not winner:
            return True
        hours_left = min(hours_left, PICKUP_FORFEIT_HOURS - PICKUP_WARNING_HOURS)
        try:
            self.db.create_user_notification(
                str(winner['account_id']), f'Final warning: {hours_left} hours left',
                f"You still have not collected {row.get('title')}. Collect it within {hours_left} hours, or your win is forfeited and you cannot bid for {BIDDING_BAN_DAYS} days.",
                notification_type='auction_final_warning', link_label='View auction', link_page='auction-hall',
            )
        except Exception as error:
            logger.warning('Final warning notification failed: %s', error)
        send_auction_final_warning_email(
            to_email=winner.get('email') or '', recipient_name=str(winner.get('fname') or '').strip(), item_title=row.get('title') or 'the item',
            reference=row.get('item_reference') or '', amount=row.get('winning_amount'), hours_left=hours_left,
        )
        return True

    def _auto_forfeit(self, row: Dict[str, Any], now: datetime, ban_days: int) -> bool:
        reason = 'The winning bidder did not collect the item within 72 hours.'
        claimed = self.client.table('auctions').update({
            'fulfillment_status': 'forfeited', 'fulfillment_updated_at': _iso(now), 'auto_forfeited_at': _iso(now),
            'reauction_reason': reason, 'updated_at': _iso(now),
        }).eq('auction_id', row['auction_id']).eq('fulfillment_status', 'awaiting_pickup').execute().data or []
        if not claimed:
            return False
        if row.get('found_item_id'):
            # The item returns to custody so it can be listed again, or claimed by its real owner.
            self.client.table('found_items').update({'status': 'unclaimed', 'custody_status': 'turned_over', 'updated_at': _iso(now)}) \
                .eq('item_id', row['found_item_id']).eq('status', 'auctioned').execute()
        winner_id = str(row.get('winner_account_id') or '')
        winner = (self._profiles([winner_id]) or {}).get(winner_id) or {}
        banned = False
        if winner_id:
            try:
                level = str((self.db.get_user_by_account_id(winner_id) or {}).get('access_level') or '').lower()
                if level not in STAFF_LEVELS:  # staff are never barred from here
                    self.client.table('user_profiles').update({
                        'bidding_banned_until': _iso(now + timedelta(days=ban_days)),
                        'bidding_ban_reason': f"Did not collect a won auction ({row.get('item_reference') or row.get('title')}) within 72 hours.",
                    }).eq('account_id', winner_id).execute()
                    banned = True
            except Exception as error:
                logger.warning('Bidding ban could not be saved for %s: %s', winner_id, error)
            try:
                self.db.create_user_notification(
                    winner_id, 'Your auction win was forfeited',
                    f"The 72-hour collection window for {row.get('title')} passed, so the win was forfeited."
                    + (f" You cannot bid for {ban_days} days." if banned else ''),
                    notification_type='auction_forfeited', link_label='View auctions', link_page='auction-hall',
                )
            except Exception as error:
                logger.warning('Forfeit notification failed: %s', error)
            if winner.get('email'):
                send_auction_forfeited_email(
                    to_email=winner['email'], recipient_name=str(winner.get('fname') or '').strip(), item_title=row.get('title') or 'the item',
                    reference=row.get('item_reference') or '', amount=row.get('winning_amount'), ban_days=ban_days,
                )
        self._alert_admins_reauction(row, winner)
        return True

    def _alert_admins_reauction(self, row: Dict[str, Any], winner: Dict[str, Any]) -> None:
        """Tell every admin the item is back in custody and ready to be auctioned again. Best effort."""
        title = row.get('title') or 'An item'
        message = (f"{title} ({row.get('item_reference') or 'no reference'}) was forfeited because the winner did not collect it in 72 hours. "
                   "It is back in custody and ready for Re-Auction.")
        try:
            admins = self.client.table('user_profiles').select('account_id,email,fname,is_active').in_('access_level', list(STAFF_LEVELS)).limit(100).execute().data or []
        except Exception as error:
            logger.warning('Could not list admins for the re-auction alert: %s', error)
            return
        from app.utils.email_service import send_reference_email_best_effort
        for admin in admins:
            if admin.get('is_active') is False:
                continue
            try:
                self.db.create_user_notification(str(admin['account_id']), 'Ready for Re-Auction', message, notification_type='auction_reauction_ready', link_label='Open auctions', link_page='auctions')
            except Exception as error:
                logger.warning('Re-auction alert failed for an admin: %s', error)
            if admin.get('email'):
                send_reference_email_best_effort(
                    to_email=admin['email'], recipient_name=str(admin.get('fname') or '').strip(), subject=f'Ready for Re-Auction: {title}',
                    title='An item is ready for Re-Auction', summary=message, reference_label='Auction item', reference=row.get('item_reference') or title,
                    details={'Previous winning bid': format_peso(row.get('winning_amount'))}, cta_label='Open the Auctions page', tone='warning',
                )
        try:
            self.db.log_user_activity(
                account_id=str(row.get('winner_account_id') or ''), user_name='System', action='Auction Win Forfeited (Automatic)', module='Auctions',
                target_name=title, target_id=row.get('item_reference') or str(row.get('auction_id')), metadata={'ready_for_reauction': True},
            )
        except Exception as error:
            logger.warning('Forfeit activity log failed: %s', error)

    # ------------------------------------------------------------------ public reads
    def public_feed(self) -> Dict[str, Any]:
        now = _now()
        try:
            self.settle_and_notify()
            live = self.client.table('auctions').select('*').in_('status', list(LIVE_STATUSES)).order('ends_at').limit(100).execute().data or []
            since = _iso(now - timedelta(days=PAST_AUCTION_DAYS))
            past = self.client.table('auctions').select('*').in_('status', ['ended', 'awaiting_admin']).gte('ended_at', since).order('ended_at', desc=True).limit(40).execute().data or []
        except Exception as error:
            self._guard(error)
        rows = live + past
        profiles = self._profiles([r.get(k) for r in rows for k in ('highest_bidder_id', 'winner_account_id')])
        reactions = self.reaction_counts([str(r['auction_id']) for r in rows])
        cards = [self.card(r, profiles, now, reactions=reactions) for r in rows]
        return {
            'live': [c for c in cards if c['status'] in ('live', 'scheduled')],
            'past': [c for c in cards if c['status'] in ('ended', 'awaiting')],
            'server_time': _iso(now),
        }

    def public_detail(self, auction_id: str, viewer_id: Optional[str] = None) -> Dict[str, Any]:
        now = _now()
        try:
            self.settle_and_notify()
            rows = self.client.table('auctions').select('*').eq('auction_id', auction_id).limit(1).execute().data or []
            if not rows:
                raise AuctionError('Auction not found.', 404)
            row = rows[0]
            bids = self.client.table('auction_bids').select('bid_id,bidder_account_id,amount,created_at').eq('auction_id', auction_id).order('amount', desc=True).order('created_at').limit(100).execute().data or []
            comments = self.client.table('auction_comments').select('comment_id,account_id,body,created_at').eq('auction_id', auction_id).eq('is_hidden', False).order('created_at', desc=True).limit(100).execute().data or []
        except AuctionError:
            raise
        except Exception as error:
            self._guard(error)
        ids = [row.get('highest_bidder_id'), row.get('winner_account_id'), *(b.get('bidder_account_id') for b in bids), *(c.get('account_id') for c in comments)]
        profiles = self._profiles(ids)
        reactions = self.reaction_counts([str(auction_id)])
        card = self.card(row, profiles, now, reactions=reactions)
        viewer = str(viewer_id) if viewer_id else None
        my_bids = [_num(b['amount']) for b in bids if viewer and str(b.get('bidder_account_id')) == viewer]
        return {
            'auction': card,
            'log': self._activity_log(row, card, bids),
            'bids': [{
                'id': str(b['bid_id']),
                'bidder': bidder_alias(auction_id, b.get('bidder_account_id')),
                'amount': _num(b['amount']),
                'created_at': b['created_at'],
                'is_mine': bool(viewer) and str(b.get('bidder_account_id')) == viewer,
            } for b in bids],
            'comments': [{
                'id': str(c['comment_id']),
                'author': bidder_alias(auction_id, c.get('account_id')),
                'body': c['body'],
                'created_at': c['created_at'],
                'is_mine': bool(viewer) and str(c['account_id']) == viewer,
            } for c in comments],
            'viewer': {
                'signed_in': bool(viewer),
                'reacted': bool(viewer) and str(auction_id) in self.my_reaction_ids(viewer),
                'is_leading': bool(viewer) and str(row.get('highest_bidder_id')) == viewer,
                'is_winner': bool(viewer) and str(row.get('winner_account_id')) == viewer and card['status'] == 'ended',
                'my_best_bid': max(my_bids) if my_bids else None,
            },
            'server_time': _iso(now),
        }

    def _activity_log(self, row: Dict[str, Any], card: Dict[str, Any], bids: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Public timeline of the auction: opening, every bid (anonymous), time extensions and the result."""
        auction_id = row['auction_id']
        events: List[Dict[str, Any]] = [{'type': 'opened', 'at': row.get('starts_at'), 'text': f"Auction opened at {format_peso(row.get('starting_price'))}"}]
        for bid in sorted(bids, key=lambda b: (b.get('created_at') or '', _num(b.get('amount')))):
            events.append({'type': 'bid', 'at': bid.get('created_at'), 'text': f"{bidder_alias(auction_id, bid.get('bidder_account_id'))} bid {format_peso(bid.get('amount'))}"})
        if int(row.get('extension_count') or 0) > 0:
            count = int(row['extension_count'])
            events.append({'type': 'extended', 'at': None, 'text': f"Closing time extended {count} time{'s' if count != 1 else ''} by late bids"})
        status = card['status']
        closed_at = row.get('ended_at') or row.get('ends_at')
        if status in ('awaiting', 'ended', 'cancelled'):
            count = int(row.get('bid_count') or 0)
            if row.get('bought_out'):
                events.append({'type': 'buyout', 'at': closed_at, 'text': f"{bidder_alias(auction_id, row.get('winner_account_id'))} used Buy Now at {format_peso(row.get('winning_amount'))}. Bidding ended at once"})
            else:
                events.append({'type': 'closed', 'at': closed_at, 'text': f"Bidding closed with {count} bid{'s' if count != 1 else ''}" if status != 'cancelled' else 'Auction cancelled'})
        if row.get('status') == 'awaiting_admin':
            events.append({'type': 'pending', 'at': None, 'text': 'Waiting for an administrator to confirm the result'})
        if row.get('finalized_at') and row.get('winner_account_id'):
            events.append({'type': 'result', 'at': row.get('finalized_at'), 'text': f"Winner confirmed: {bidder_alias(auction_id, row['winner_account_id'])} at {format_peso(row.get('winning_amount'))}"})
        if row.get('fulfillment_status') == 'forfeited':
            events.append({'type': 'forfeited', 'at': row.get('fulfillment_updated_at'), 'text': 'The winner did not complete the purchase. The item was offered again'})
        return events

    # ------------------------------------------------------------------ reactions (hearts)
    def reaction_counts(self, auction_ids: List[str]) -> Dict[str, int]:
        """Number of reactors per auction. Reactions are optional, so a missing table just means zero."""
        counts: Dict[str, int] = {}
        if not auction_ids:
            return counts
        try:
            for chunk in _chunks(list(auction_ids)):
                for row in self.client.table('auction_reactions').select('auction_id').in_('auction_id', chunk).limit(5000).execute().data or []:
                    counts[str(row['auction_id'])] = counts.get(str(row['auction_id']), 0) + 1
        except Exception as error:
            if not _is_missing_schema(error):
                logger.warning('Reaction counts unavailable: %s', error)
        return counts

    def my_reaction_ids(self, account_id: str) -> List[str]:
        try:
            rows = self.client.table('auction_reactions').select('auction_id').eq('account_id', account_id).limit(500).execute().data or []
        except Exception as error:
            if not _is_missing_schema(error):
                logger.warning('Reactions unavailable: %s', error)
            return []
        return [str(r['auction_id']) for r in rows]

    def set_reaction(self, auction_id: str, account_id: str, on: bool) -> Dict[str, Any]:
        """Save or remove a heart. Stored per account so the admin can see who is interested."""
        try:
            if not (self.client.table('auctions').select('auction_id').eq('auction_id', auction_id).limit(1).execute().data or []):
                raise AuctionError('Auction not found.', 404)
            if on:
                self.client.table('auction_reactions').upsert({'auction_id': auction_id, 'account_id': account_id}, on_conflict='auction_id,account_id').execute()
            else:
                self.client.table('auction_reactions').delete().eq('auction_id', auction_id).eq('account_id', account_id).execute()
        except AuctionError:
            raise
        except Exception as error:
            if _is_missing_schema(error):
                raise AuctionsUnavailable('Saving hearts needs the 20261007_auction_reactions.sql migration in Supabase.') from error
            raise
        return {'reacted': on, 'reaction_count': self.reaction_counts([str(auction_id)]).get(str(auction_id), 0)}

    def my_bids(self, account_id: str) -> Dict[str, Any]:
        now = _now()
        try:
            self.settle_and_notify()
            bids = self.client.table('auction_bids').select('auction_id,amount').eq('bidder_account_id', account_id).order('created_at', desc=True).limit(300).execute().data or []
            best: Dict[str, float] = {}
            order: List[str] = []
            for bid in bids:
                key = str(bid['auction_id'])
                if key not in best:
                    order.append(key)
                best[key] = max(best.get(key, 0.0), _num(bid['amount']))
            rows = []
            for chunk in _chunks(order[:30]):
                rows += self.client.table('auctions').select('*').in_('auction_id', chunk).execute().data or []
        except Exception as error:
            self._guard(error)
        profiles = self._profiles([r.get(k) for r in rows for k in ('highest_bidder_id', 'winner_account_id')])
        items = []
        for row in rows:
            card = self.card(row, profiles, now)
            leading = str(row.get('highest_bidder_id')) == str(account_id)
            if card['status'] in ('live', 'scheduled'):
                state = 'leading' if leading else 'outbid'
            elif card['status'] == 'awaiting':
                state = 'awaiting' if leading else 'outbid'
            elif card['status'] == 'cancelled':
                state = 'cancelled'
            else:
                state = 'won' if str(row.get('winner_account_id')) == str(account_id) else 'lost'
            items.append({**card, 'my_state': state, 'my_best_bid': best.get(card['id'])})
        items.sort(key=lambda i: (i['my_state'] not in ('leading', 'outbid'), _parse(i['ends_at']) or now))
        return {'auctions': items, 'server_time': _iso(now)}

    # ------------------------------------------------------------------ user writes
    def _assert_can_bid(self, account_id: str) -> None:
        """Refuse a bid from an account barred after a forfeited win. Quietly allows it if the ban column does not exist yet."""
        try:
            rows = self.client.table('user_profiles').select('bidding_banned_until').eq('account_id', account_id).limit(1).execute().data or []
        except Exception:
            return
        until = _parse((rows[0] if rows else {}).get('bidding_banned_until'))
        if until and until > _now():
            raise AuctionError(
                f"Bidding is paused on your account until {until.strftime('%b %d, %Y')} because a won auction was not collected in time. You can still browse, report and claim.",
                403, code='bidding_banned', banned_until=_iso(until),
            )

    def place_bid(self, auction_id: str, account_id: str, amount: Any) -> Dict[str, Any]:
        try:
            value = float(Decimal(str(amount).replace(',', '').strip()))
        except (InvalidOperation, ValueError):
            raise AuctionError('Enter a valid bid amount.')
        self._assert_can_bid(account_id)
        try:
            response = self.client.rpc('auction_place_bid', {'p_auction_id': auction_id, 'p_bidder_id': account_id, 'p_amount': value}).execute()
        except Exception as error:
            self._guard(error)
        result = response.data[0] if isinstance(response.data, list) and response.data else response.data
        if not isinstance(result, dict):
            raise AuctionError('The bid could not be placed. Try again.', 500)
        if not result.get('ok'):
            message, status = BID_ERRORS.get(str(result.get('error')), ('The bid could not be placed.', 400))
            extra = {}
            if result.get('error') == 'bid_too_low' and result.get('min_bid') is not None:
                extra['min_bid'] = _num(result['min_bid'])
                message = f"Your bid must be at least {format_peso(result['min_bid'])}."
            raise AuctionError(message, status, **extra)

        auction = result['auction']
        previous = result.get('previous_bidder_id')
        bought_out = bool(result.get('bought_out'))
        if bought_out:
            # Buy Now ended the auction at once. The buyer waits for the admin to confirm pickup; the rest are told it is over.
            try:
                self.db.create_user_notification(
                    str(account_id), 'You used Buy Now',
                    f"You bought {auction.get('title')} for {format_peso(auction.get('winning_amount'))}. An administrator will confirm your purchase, then you can pay and collect it at the Lost and Found Office.",
                    notification_type='auction_awaiting', link_label='View auction', link_page='auction-hall',
                )
            except Exception as error:
                logger.warning('Buy Now notification failed: %s', error)
        if previous and str(previous) != str(account_id):
            try:
                self.db.create_user_notification(
                    str(previous), 'Auction ended: Buy Now' if bought_out else 'You have been outbid',
                    (f"{auction.get('title')} was bought at the Buy Now price of {format_peso(auction.get('winning_amount'))}, so the auction has ended."
                     if bought_out else f"Another bidder is now leading {auction.get('title')} at {format_peso(auction.get('current_price'))}. Bid again to take the lead."),
                    notification_type='auction_outbid', link_label='View auction', link_page='auction-hall',
                )
            except Exception as error:
                logger.warning('Outbid notification failed: %s', error)
        profile = self._profiles([account_id]).get(str(account_id))
        try:
            self.db.log_user_activity(
                account_id=account_id, user_name=(profile or {}).get('email') or 'User', action='Buy Now (Auction)' if bought_out else 'Place Auction Bid',
                module='Auction Hall', target_name=auction.get('title'), target_id=auction.get('item_reference') or str(auction_id),
            )
        except Exception as error:
            logger.warning('Bid activity log failed: %s', error)
        profiles = self._profiles([auction.get('highest_bidder_id')])
        return {'auction': self.card(auction, profiles), 'extended': bool(result.get('extended')), 'bought_out': bought_out, 'bid_id': result.get('bid_id')}

    def add_comment(self, auction_id: str, account_id: str, body: Any) -> Dict[str, Any]:
        text = str(body or '').strip()
        if not text:
            raise AuctionError('Write a comment first.')
        if len(text) > MAX_COMMENT_LENGTH:
            raise AuctionError(f'Comments can be up to {MAX_COMMENT_LENGTH} characters.')
        if find_profanity(text):
            raise AuctionError('Your comment contains language that is not allowed on E-Balik, so it was not posted. Please rewrite it respectfully.', 422, code='profanity')
        try:
            rows = self.client.table('auctions').select('auction_id,status').eq('auction_id', auction_id).limit(1).execute().data or []
            if not rows:
                raise AuctionError('Auction not found.', 404)
            if rows[0].get('status') == 'cancelled':
                raise AuctionError('Comments are closed on a cancelled auction.', 409)
            recent = self.client.table('auction_comments').select('created_at').eq('auction_id', auction_id).eq('account_id', account_id).order('created_at', desc=True).limit(1).execute().data or []
            if recent and (_now() - (_parse(recent[0]['created_at']) or _now())).total_seconds() < COMMENT_COOLDOWN_SECONDS:
                raise AuctionError('You are commenting too fast. Wait a few seconds.', 429)
            created = self.client.table('auction_comments').insert({'auction_id': auction_id, 'account_id': account_id, 'body': text}).execute().data or []
        except AuctionError:
            raise
        except Exception as error:
            self._guard(error)
        row = created[0]
        return {'id': str(row['comment_id']), 'author': bidder_alias(auction_id, account_id), 'body': row['body'], 'created_at': row['created_at'], 'is_mine': True}

    def delete_own_comment(self, auction_id: str, comment_id: str, account_id: str) -> bool:
        try:
            deleted = self.client.table('auction_comments').delete().eq('comment_id', comment_id).eq('auction_id', auction_id).eq('account_id', account_id).execute().data or []
        except Exception as error:
            self._guard(error)
        return bool(deleted)

    # ------------------------------------------------------------------ admin: eligibility and creation
    def eligible_items(self) -> Dict[str, Any]:
        now = _now()
        cutoff = _iso(now - timedelta(days=MIN_CUSTODY_DAYS))
        try:
            items = self.client.table('found_items').select(
                'item_id,fpost_id,item_name,category,description,location,found_date,image_url,turnover_location,created_at'
            ).eq('status', 'unclaimed').lte('created_at', cutoff).order('created_at').limit(500).execute().data or []
            unclaimed_total = self.client.table('found_items').select('item_id', count='exact').eq('status', 'unclaimed').limit(1).execute().count or 0
            ids = [str(i['item_id']) for i in items]
            blocked = set()
            for chunk in _chunks(ids):
                live = self.client.table('auctions').select('found_item_id').in_('found_item_id', chunk).in_('status', list(OPEN_STATUSES)).execute().data or []
                claims = self.client.table('claims').select('found_item_id').in_('found_item_id', chunk).in_('status', list(OPEN_CLAIM_STATUSES)).execute().data or []
                blocked.update(str(r['found_item_id']) for r in live + claims)
        except Exception as error:
            self._guard(error)
        eligible = []
        for item in items:
            if str(item['item_id']) in blocked:
                continue
            since = _parse(item.get('created_at')) or now
            eligible.append({
                'id': str(item['item_id']), 'reference': item.get('fpost_id') or '', 'name': item.get('item_name') or 'Item',
                'category': item.get('category') or '', 'description': item.get('description') or '', 'location': item.get('location') or '',
                'storage': item.get('turnover_location') or '', 'photo': item.get('image_url') or '',
                'found_date': item.get('found_date'), 'days_in_custody': max((now - since).days, 0),
            })
        return {'items': eligible, 'min_custody_days': MIN_CUSTODY_DAYS, 'unclaimed_total': int(unclaimed_total)}

    def create_auction(self, payload: Dict[str, Any], gallery_urls: List[str], admin_id: str) -> Dict[str, Any]:
        reference = str(payload.get('found_item_reference') or '').strip()
        if not reference:
            raise AuctionError('Choose the found item to auction.')
        now = _now()
        try:
            rows = self.client.table('found_items').select('*').eq('fpost_id', reference).limit(1).execute().data or []
            if not rows:
                raise AuctionError('Found item not found.', 404)
            item = rows[0]
            if str(item.get('status') or '').lower() != 'unclaimed':
                raise AuctionError('Only unclaimed items can be auctioned.', 409)
            since = _parse(item.get('created_at'))
            if not since or (now - since).days < MIN_CUSTODY_DAYS:
                raise AuctionError(f'An item must be in custody for at least {MIN_CUSTODY_DAYS} days before it can be auctioned.', 409)
            if self.client.table('claims').select('claim_id').eq('found_item_id', item['item_id']).in_('status', list(OPEN_CLAIM_STATUSES)).limit(1).execute().data:
                raise AuctionError('This item has an open ownership claim. Resolve the claim first.', 409)
            if self.client.table('auctions').select('auction_id').eq('found_item_id', item['item_id']).in_('status', list(OPEN_STATUSES)).limit(1).execute().data:
                raise AuctionError('This item already has a live auction.', 409)
        except AuctionError:
            raise
        except Exception as error:
            self._guard(error)

        starting = parse_money(payload.get('starting_price'), 'starting bid')
        increment = parse_money(payload.get('bid_increment', 50), 'bid increment', maximum=Decimal('1000000'))
        duration = parse_int(payload.get('duration_minutes'), 'auction length in minutes', MIN_DURATION_MINUTES, MAX_DURATION_MINUTES)
        starts = _parse(payload.get('starts_at')) or now
        if starts < now - timedelta(minutes=2):
            starts = now
        if starts > now + timedelta(days=90):
            raise AuctionError('The start time can be at most 90 days away.')
        ends = starts + timedelta(minutes=duration)
        buyout = parse_buyout(payload.get('buyout_price'), starting)
        snipe = bool(payload.get('anti_snipe_enabled', True))
        window = parse_int(payload.get('anti_snipe_window_seconds', 300), 'anti-snipe window', 30, 3600)
        extension = parse_int(payload.get('anti_snipe_extension_seconds', 300), 'anti-snipe extension', 30, 3600)
        max_extensions = parse_int(payload.get('max_extensions', 10), 'maximum extensions', 0, 50)
        description = str(payload.get('description') if payload.get('description') is not None else item.get('description') or '').strip()[:2000]
        title = str(payload.get('title') or item.get('item_name') or '').strip()[:255]
        if not title:
            raise AuctionError('The auction needs a title.')
        row = {
            'found_item_id': item['item_id'], 'item_reference': item.get('fpost_id'), 'title': title, 'description': description,
            'category': item.get('category'), 'found_location': item.get('location'), 'image_url': item.get('image_url'),
            'gallery_urls': gallery_urls[:MAX_GALLERY_IMAGES], 'starting_price': float(starting), 'bid_increment': float(increment),
            'current_price': float(starting), 'starts_at': _iso(starts), 'ends_at': _iso(ends), 'original_ends_at': _iso(ends),
            'anti_snipe_enabled': snipe, 'anti_snipe_window_seconds': window, 'anti_snipe_extension_seconds': extension,
            'max_extensions': max_extensions, 'status': 'scheduled' if starts > now else 'active', 'created_by': admin_id,
        }
        if buyout is not None:
            row['buyout_price'] = float(buyout)
        try:
            created = self.client.table('auctions').insert(row).execute().data or []
        except Exception as error:
            if '23505' in str(error) or 'uq_auctions_one_live_per_item' in str(error):
                raise AuctionError('This item already has a live auction.', 409)
            self._guard(error)
        return created[0]

    # ------------------------------------------------------------------ admin: reads
    def _admin_card(self, row: Dict[str, Any], profiles: Dict[str, Dict[str, Any]], now: datetime, reactions: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
        card = self.card(row, profiles, now, anonymous=False, reactions=reactions)
        winner = profiles.get(str(row['winner_account_id'])) if row.get('winner_account_id') else None
        leader = profiles.get(str(row['highest_bidder_id'])) if row.get('highest_bidder_id') else None

        def person(profile):
            if not profile:
                return None
            return {'account_id': str(profile['account_id']), 'name': f"{profile.get('fname') or ''} {profile.get('lname') or ''}".strip(),
                    'campus_id': profile.get('campus_id') or '', 'email': profile.get('email') or ''}
        return {**card, 'found_item_id': str(row['found_item_id']) if row.get('found_item_id') else None,
                'db_status': row.get('status'), 'fulfillment_status': row.get('fulfillment_status'),
                'winner_notified_at': row.get('winner_notified_at'), 'winner_email_mode': row.get('winner_email_mode'),
                'pickup_warning_sent_at': row.get('pickup_warning_sent_at'), 'auto_forfeited_at': row.get('auto_forfeited_at'),
                'cancelled_at': row.get('cancelled_at'), 'ended_at': row.get('ended_at'), 'created_at': row.get('created_at'),
                'finalized_at': row.get('finalized_at'), 'reauctioned_from': str(row['reauctioned_from']) if row.get('reauctioned_from') else None, 'reauction_reason': row.get('reauction_reason'),
                'leader': (person(leader) or {}).get('name') or card['leader'],
                'leader_detail': person(leader), 'winner_detail': person(winner) if card['status'] == 'ended' else None,
                'winner': (person(winner) or {}).get('name') if card['status'] == 'ended' and winner else None}

    def admin_list(self) -> Dict[str, Any]:
        now = _now()
        try:
            self.settle_and_notify(force=True)
            rows = self.client.table('auctions').select('*').order('created_at', desc=True).limit(300).execute().data or []
        except Exception as error:
            self._guard(error)
        profiles = self._profiles([r.get(k) for r in rows for k in ('highest_bidder_id', 'winner_account_id')])
        reactions = self.reaction_counts([str(r['auction_id']) for r in rows])
        cards = [self._admin_card(r, profiles, now, reactions) for r in rows]
        relisted = {str(r['reauctioned_from']) for r in rows if r.get('reauctioned_from')}
        for card in cards:
            # Forfeited automatically and not yet listed again: the admin's cue to re-auction.
            card['reauction_ready'] = bool(card.get('auto_forfeited_at')) and card['fulfillment_status'] == 'forfeited' and card['id'] not in relisted
        sold = [c for c in cards if c['sold'] and c['fulfillment_status'] != 'forfeited']
        stats = {
            'live': sum(1 for c in cards if c['status'] == 'live'),
            'scheduled': sum(1 for c in cards if c['status'] == 'scheduled'),
            'awaiting_admin': sum(1 for c in cards if c['status'] == 'awaiting'),
            'ended': sum(1 for c in cards if c['status'] == 'ended'),
            'awaiting_pickup': sum(1 for c in cards if c['fulfillment_status'] == 'awaiting_pickup'),
            'reauction_ready': sum(1 for c in cards if c.get('reauction_ready')),
            'total_bids': sum(c['bid_count'] for c in cards),
            'sales_total': round(sum(c['winning_amount'] or 0 for c in sold), 2),
        }
        return {'auctions': cards, 'stats': stats, 'server_time': _iso(now), 'min_custody_days': MIN_CUSTODY_DAYS}

    def admin_detail(self, auction_id: str) -> Dict[str, Any]:
        now = _now()
        try:
            self.settle_and_notify()
            rows = self.client.table('auctions').select('*').eq('auction_id', auction_id).limit(1).execute().data or []
            if not rows:
                raise AuctionError('Auction not found.', 404)
            bids = self.client.table('auction_bids').select('bid_id,bidder_account_id,amount,created_at').eq('auction_id', auction_id).order('created_at', desc=True).limit(200).execute().data or []
            comments = self.client.table('auction_comments').select('comment_id,account_id,body,created_at,is_hidden').eq('auction_id', auction_id).order('created_at', desc=True).limit(200).execute().data or []
        except AuctionError:
            raise
        except Exception as error:
            self._guard(error)
        row = rows[0]
        profiles = self._profiles([row.get('highest_bidder_id'), row.get('winner_account_id'), *(b.get('bidder_account_id') for b in bids), *(c.get('account_id') for c in comments)])

        def who(account_id):
            profile = profiles.get(str(account_id)) if account_id else None
            return {'name': f"{profile.get('fname') or ''} {profile.get('lname') or ''}".strip() if profile else 'Former user', 'campus_id': (profile or {}).get('campus_id') or ''}
        reactors = []
        try:
            reacted = self.client.table('auction_reactions').select('account_id,created_at').eq('auction_id', auction_id).order('created_at', desc=True).limit(200).execute().data or []
            reactor_profiles = self._profiles([r['account_id'] for r in reacted])
            for r in reacted:
                profile = reactor_profiles.get(str(r['account_id']))
                reactors.append({'name': f"{(profile or {}).get('fname') or ''} {(profile or {}).get('lname') or ''}".strip() or 'Former user', 'campus_id': (profile or {}).get('campus_id') or '', 'created_at': r['created_at']})
        except Exception as error:
            if not _is_missing_schema(error):
                logger.warning('Reactors unavailable: %s', error)
        return {
            'auction': self._admin_card(row, profiles, now, {str(auction_id): len(reactors)}),
            'reactors': reactors,
            'bids': [{'id': str(b['bid_id']), **who(b.get('bidder_account_id')), 'amount': _num(b['amount']), 'created_at': b['created_at']} for b in bids],
            'comments': [{'id': str(c['comment_id']), **who(c['account_id']), 'body': c['body'], 'created_at': c['created_at'], 'hidden': bool(c.get('is_hidden'))} for c in comments],
            'server_time': _iso(now),
        }

    # ------------------------------------------------------------------ admin: changes
    def _live_row(self, auction_id: str) -> Dict[str, Any]:
        rows = self.client.table('auctions').select('*').eq('auction_id', auction_id).limit(1).execute().data or []
        if not rows:
            raise AuctionError('Auction not found.', 404)
        return rows[0]

    def update_auction(self, auction_id: str, payload: Dict[str, Any], gallery_urls: Optional[List[str]]) -> Dict[str, Any]:
        now = _now()
        try:
            row = self._live_row(auction_id)
            if row.get('status') not in LIVE_STATUSES or (_parse(row.get('ends_at')) or now) <= now:
                raise AuctionError('Only scheduled or running auctions can be edited.', 409)
            has_bids = int(row.get('bid_count') or 0) > 0
            update: Dict[str, Any] = {}
            for field in ('starting_price', 'bid_increment'):
                if field in payload:
                    if has_bids:
                        raise AuctionError('Prices are locked once bidding has started.', 409)
                    amount = parse_money(payload[field], 'starting bid' if field == 'starting_price' else 'bid increment',
                                         maximum=MAX_PRICE if field == 'starting_price' else Decimal('1000000'))
                    update[field] = float(amount)
                    if field == 'starting_price':
                        update['current_price'] = float(amount)
            if 'buyout_price' in payload:
                if has_bids:
                    raise AuctionError('The Buy Now price is locked once bidding has started.', 409)
                raw = payload['buyout_price']
                update['buyout_price'] = None if raw is None or str(raw).strip() == '' else float(parse_money(raw, 'Buy Now price'))
            final_start = Decimal(str(update.get('starting_price', row.get('starting_price') or 0)))
            final_buyout = update['buyout_price'] if 'buyout_price' in update else row.get('buyout_price')
            if final_buyout is not None and final_start >= Decimal(str(final_buyout)):
                raise AuctionError('The Buy Now price must be higher than the starting bid.')
            if 'starts_at' in payload:
                if has_bids or row.get('status') != 'scheduled':
                    raise AuctionError('The start time can only change before the auction opens.', 409)
                starts = _parse(payload['starts_at'])
                if not starts or starts > now + timedelta(days=90):
                    raise AuctionError('Enter a valid start time within 90 days.')
                update['starts_at'] = _iso(max(starts, now))
            starts_at = _parse(update.get('starts_at') or row.get('starts_at')) or now
            if 'ends_at' in payload:
                ends = _parse(payload['ends_at'])
                current_end = _parse(row.get('ends_at')) or now
                if not ends or ends <= max(now, starts_at) + timedelta(minutes=MIN_DURATION_MINUTES - 1) or ends > now + timedelta(minutes=MAX_DURATION_MINUTES):
                    raise AuctionError(f'The end time must be at least {MIN_DURATION_MINUTES} minutes from now and within 60 days.')
                if has_bids and ends < current_end:
                    raise AuctionError('Once bidding has started the end time can only be extended.', 409)
                update['ends_at'] = _iso(ends)
                if not has_bids:
                    update['original_ends_at'] = _iso(ends)
            elif 'starts_at' in update and (_parse(row.get('ends_at')) or now) <= starts_at:
                raise AuctionError('The new start time must be before the end time.')
            if 'anti_snipe_enabled' in payload:
                update['anti_snipe_enabled'] = bool(payload['anti_snipe_enabled'])
            if 'anti_snipe_window_seconds' in payload:
                update['anti_snipe_window_seconds'] = parse_int(payload['anti_snipe_window_seconds'], 'anti-snipe window', 30, 3600)
            if 'anti_snipe_extension_seconds' in payload:
                update['anti_snipe_extension_seconds'] = parse_int(payload['anti_snipe_extension_seconds'], 'anti-snipe extension', 30, 3600)
            if 'max_extensions' in payload:
                update['max_extensions'] = parse_int(payload['max_extensions'], 'maximum extensions', 0, 50)
            if 'title' in payload:
                title = str(payload['title'] or '').strip()[:255]
                if not title:
                    raise AuctionError('The auction needs a title.')
                update['title'] = title
            if 'description' in payload:
                update['description'] = str(payload['description'] or '').strip()[:2000]
            if gallery_urls is not None:
                update['gallery_urls'] = gallery_urls[:MAX_GALLERY_IMAGES]
            if not update:
                raise AuctionError('Nothing to update.')
            update['updated_at'] = _iso(now)
            updated = self.client.table('auctions').update(update).eq('auction_id', auction_id).in_('status', list(LIVE_STATUSES)).execute().data or []
        except AuctionError:
            raise
        except Exception as error:
            self._guard(error)
        if not updated:
            raise AuctionError('The auction changed while you were editing. Reload and try again.', 409)
        return updated[0]

    def end_now(self, auction_id: str) -> Dict[str, Any]:
        now = _now()
        try:
            row = self._live_row(auction_id)
            if self._public_status(row, now) != 'live':
                raise AuctionError('Only a running auction can be ended now.', 409)
            starts = _parse(row.get('starts_at')) or now
            end = max(now, starts + timedelta(seconds=1))
            self.client.table('auctions').update({'ends_at': _iso(end), 'updated_at': _iso(now)}).eq('auction_id', auction_id).in_('status', list(LIVE_STATUSES)).execute()
            time.sleep(max((end - _now()).total_seconds(), 0) + 0.05)
            self.settle_and_notify(force=True)
            return self._live_row(auction_id)
        except AuctionError:
            raise
        except Exception as error:
            self._guard(error)

    def cancel_auction(self, auction_id: str, reason: str) -> Dict[str, Any]:
        now = _now()
        reason = str(reason or '').strip()[:300] or 'Cancelled by an administrator.'
        try:
            row = self._live_row(auction_id)
            if row.get('status') not in OPEN_STATUSES:
                raise AuctionError('Only an open auction can be cancelled.', 409)
            cancelled = self.client.table('auctions').update({
                'status': 'cancelled', 'cancelled_at': _iso(now), 'ended_at': _iso(now), 'cancel_reason': reason, 'updated_at': _iso(now),
            }).eq('auction_id', auction_id).in_('status', list(OPEN_STATUSES)).execute().data or []
        except AuctionError:
            raise
        except Exception as error:
            self._guard(error)
        if not cancelled:
            raise AuctionError('The auction changed while you were cancelling it. Reload and try again.', 409)
        leader = cancelled[0].get('highest_bidder_id')
        if leader:
            try:
                self.db.create_user_notification(
                    str(leader), 'Auction cancelled', f"The auction for {cancelled[0].get('title')} was cancelled. {reason}",
                    notification_type='auction_cancelled', link_label='View auction', link_page='auction-hall',
                )
            except Exception as error:
                logger.warning('Auction cancel notification failed: %s', error)
        return cancelled[0]

    def set_fulfillment(self, auction_id: str, action: str) -> Dict[str, Any]:
        if action not in ('collected', 'forfeited'):
            raise AuctionError('Choose collected or forfeited.')
        now = _now()
        try:
            row = self._live_row(auction_id)
            if row.get('fulfillment_status') != 'awaiting_pickup':
                raise AuctionError('This auction is not waiting for pickup.', 409)
            updated = self.client.table('auctions').update({'fulfillment_status': action, 'fulfillment_updated_at': _iso(now), 'updated_at': _iso(now)}) \
                .eq('auction_id', auction_id).eq('fulfillment_status', 'awaiting_pickup').execute().data or []
            if not updated:
                raise AuctionError('This auction was already updated.', 409)
            if action == 'forfeited' and row.get('found_item_id'):
                # The winner never collected: put the item back in custody so it can be claimed or auctioned again.
                self.client.table('found_items').update({'status': 'unclaimed', 'custody_status': 'turned_over', 'updated_at': _iso(now)}) \
                    .eq('item_id', row['found_item_id']).eq('status', 'auctioned').execute()
        except AuctionError:
            raise
        except Exception as error:
            self._guard(error)
        return updated[0]

    def set_comment_hidden(self, auction_id: str, comment_id: str, hidden: bool, admin_id: str) -> bool:
        try:
            updated = self.client.table('auction_comments').update({
                'is_hidden': hidden, 'hidden_by': admin_id if hidden else None, 'hidden_at': _iso(_now()) if hidden else None,
            }).eq('comment_id', comment_id).eq('auction_id', auction_id).execute().data or []
        except Exception as error:
            self._guard(error)
        return bool(updated)

    def finalize(self, auction_id: str, admin_id: str) -> Dict[str, Any]:
        """An admin confirms the result of an auction awaiting_admin. Sends the winner notice on success."""
        try:
            response = self.client.rpc('auction_finalize', {'p_auction_id': auction_id, 'p_admin_id': admin_id}).execute()
        except Exception as error:
            self._guard(error)
        result = response.data[0] if isinstance(response.data, list) and response.data else response.data
        if not isinstance(result, dict):
            raise AuctionError('The result could not be confirmed. Try again.', 500)
        if not result.get('ok'):
            message, status = {
                'admin_required': ('Only an administrator can confirm a result.', 403),
                'not_found': ('Auction not found.', 404),
                'not_awaiting': ('This auction is not waiting for an administrator.', 409),
            }.get(str(result.get('error')), ('The result could not be confirmed.', 400))
            raise AuctionError(message, status)
        auction = result['auction']
        if result.get('outcome') == 'cancelled':
            if auction.get('winner_account_id'):
                try:
                    self.db.create_user_notification(
                        str(auction['winner_account_id']), 'Auction cancelled', f"The auction for {auction.get('title')} was cancelled. {auction.get('cancel_reason') or ''}".strip(),
                        notification_type='auction_cancelled', link_label='View auction', link_page='auction-hall',
                    )
                except Exception as error:
                    logger.warning('Cancel notification failed: %s', error)
        else:
            self._notify_pending_winners()
        return {'outcome': result.get('outcome'), 'auction': auction}

    def reauction(self, auction_id: str, payload: Dict[str, Any], admin_id: str) -> Dict[str, Any]:
        """The confirmed winner did not complete the sale: forfeit it, put the item back in custody and list it again."""
        now = _now()
        reason = str(payload.get('reason') or '').strip()[:300] or 'The winning bidder did not complete the purchase.'
        try:
            row = self._live_row(auction_id)
            status, fulfillment = row.get('status'), row.get('fulfillment_status')
            auto_forfeited = status == 'ended' and fulfillment == 'forfeited' and bool(row.get('auto_forfeited_at'))
            if auto_forfeited and (self.client.table('auctions').select('auction_id').eq('reauctioned_from', auction_id).limit(1).execute().data or []):
                raise AuctionError('This item was already listed again.', 409)
            if not ((status == 'ended' and fulfillment == 'awaiting_pickup') or auto_forfeited):
                raise AuctionError('Confirm the winner first. An item can be re-auctioned only after a confirmed winner has not collected it.', 409)
            original_minutes = 4320
            starts_old, ends_old = _parse(row.get('starts_at')), _parse(row.get('original_ends_at'))
            if starts_old and ends_old:
                original_minutes = max(MIN_DURATION_MINUTES, min(MAX_DURATION_MINUTES, int((ends_old - starts_old).total_seconds() // 60)))
            starting = parse_money(payload.get('starting_price', row.get('starting_price')), 'starting bid')
            increment = parse_money(payload.get('bid_increment', row.get('bid_increment')), 'bid increment', maximum=Decimal('1000000'))
            duration = parse_int(payload.get('duration_minutes', original_minutes), 'auction length in minutes', MIN_DURATION_MINUTES, MAX_DURATION_MINUTES)
            window = parse_int(payload.get('anti_snipe_window_seconds', row.get('anti_snipe_window_seconds') or 300), 'anti-snipe window', 30, 3600)
            extension = parse_int(payload.get('anti_snipe_extension_seconds', row.get('anti_snipe_extension_seconds') or 300), 'anti-snipe extension', 30, 3600)
            max_extensions = parse_int(payload.get('max_extensions', row.get('max_extensions') if row.get('max_extensions') is not None else 10), 'maximum extensions', 0, 50)
            if row.get('found_item_id'):
                item = (self.client.table('found_items').select('status').eq('item_id', row['found_item_id']).limit(1).execute().data or [{}])[0]
                if str(item.get('status') or '').lower() not in ('unclaimed', 'auctioned'):
                    raise AuctionError('The item is no longer in custody, so it cannot be re-auctioned.', 409)
                if self.client.table('claims').select('claim_id').eq('found_item_id', row['found_item_id']).in_('status', list(OPEN_CLAIM_STATUSES)).limit(1).execute().data:
                    raise AuctionError('This item has an open ownership claim. Resolve the claim first.', 409)

            if auto_forfeited:
                closed = [row]  # the scheduler already forfeited it and returned the item to custody
            else:
                forfeit = {'status': 'ended', 'fulfillment_status': 'forfeited', 'fulfillment_updated_at': _iso(now), 'reauction_reason': reason, 'updated_at': _iso(now)}
                if not row.get('ended_at'):
                    forfeit['ended_at'] = _iso(now)
                query = self.client.table('auctions').update(forfeit).eq('auction_id', auction_id).eq('status', status)
                if status == 'ended':
                    query = query.eq('fulfillment_status', 'awaiting_pickup')
                closed = query.execute().data or []
                if not closed:
                    raise AuctionError('The auction changed while you were working. Reload and try again.', 409)
                if row.get('found_item_id'):
                    self.client.table('found_items').update({'status': 'unclaimed', 'custody_status': 'turned_over', 'updated_at': _iso(now)}) \
                        .eq('item_id', row['found_item_id']).eq('status', 'auctioned').execute()

            ends = now + timedelta(minutes=duration)
            fresh = {
                'found_item_id': row.get('found_item_id'), 'item_reference': row.get('item_reference'), 'title': row.get('title'),
                'description': row.get('description'), 'category': row.get('category'), 'found_location': row.get('found_location'),
                'image_url': row.get('image_url'), 'gallery_urls': row.get('gallery_urls') or [],
                'starting_price': float(starting), 'bid_increment': float(increment), 'current_price': float(starting),
                'starts_at': _iso(now), 'ends_at': _iso(ends), 'original_ends_at': _iso(ends), 'anti_snipe_enabled': bool(row.get('anti_snipe_enabled')),
                'anti_snipe_window_seconds': window, 'anti_snipe_extension_seconds': extension, 'max_extensions': max_extensions,
                'status': 'active', 'created_by': admin_id, 'reauctioned_from': auction_id,
            }
            try:
                created = self.client.table('auctions').insert(fresh).execute().data or []
            except Exception:
                # Put everything back so the admin can retry instead of being left with a half-finished re-auction.
                if not auto_forfeited:
                    revert = {'status': status, 'fulfillment_status': fulfillment, 'reauction_reason': None, 'updated_at': _iso(now)}
                    self.client.table('auctions').update(revert).eq('auction_id', auction_id).execute()
                    if row.get('found_item_id') and status == 'ended':
                        self.client.table('found_items').update({'status': 'auctioned', 'custody_status': 'auctioned'}).eq('item_id', row['found_item_id']).execute()
                raise
        except AuctionError:
            raise
        except Exception as error:
            self._guard(error)
        return {'old': closed[0], 'new': created[0], 'previous_winner_id': row.get('winner_account_id')}

    def delete_auction(self, auction_id: str) -> Dict[str, Any]:
        try:
            row = self._live_row(auction_id)
            if row.get('status') in OPEN_STATUSES:
                raise AuctionError('Cancel the auction before deleting it.', 409)
            if row.get('fulfillment_status') == 'awaiting_pickup':
                raise AuctionError('The winner has not collected this item yet. Mark it collected or forfeited first.', 409)
            self.client.table('auctions').delete().eq('auction_id', auction_id).execute()
        except AuctionError:
            raise
        except Exception as error:
            self._guard(error)
        return row
