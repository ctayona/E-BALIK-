"""Handover PINs: the code a claimant shows the guard to collect an approved item.

When an admin approves a claim the server draws a 6 character PIN and stores two things on the claim row:
  * `handover_pin_hash`      an HMAC of the PIN, used to find the claim when the guard types it (the PIN is never searched in plain text);
  * `handover_pin_encrypted` the PIN encrypted with the app key, so the owner can read it again in their account.
The PIN is emailed to the claimant. The guard enters it on the admin dashboard; if it matches an approved claim the item
is released: the claim becomes `collected` and the found item `returned`, through the same database function the
claims page uses, so the chain of custody has one definition of "released".
"""
import hashlib
import hmac
import io
import logging
import secrets
from typing import Any, Dict, Optional

from app.utils.crypto_service import CryptoService

logger = logging.getLogger(__name__)

# 31 symbols: no 0, O, 1, I or L, so a PIN read aloud or copied from a screen is not mistaken.
PIN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
PIN_LENGTH = 6
APPROVED_STATUS = 'approved_for_pickup'
MAX_ISSUE_ATTEMPTS = 8
# What the QR code on the claimant's screen contains. The prefix lets the scanner tell it from any other QR code.
QR_PREFIX = 'EBALIK-HANDOVER:'


class HandoverError(Exception):
    """A rule failure with an HTTP status the route can return as is."""

    def __init__(self, message: str, status: int = 400, code: str = 'handover_error'):
        super().__init__(message)
        self.message, self.status, self.code = message, status, code


class HandoverUnavailable(HandoverError):
    """The database does not have the PIN columns yet (migration 20261012 has not been run)."""

    def __init__(self):
        super().__init__('Handover PINs are not set up yet. Run migration 20261012_handover_pins_and_auction_timeouts.sql.', 503, 'setup_required')


def generate_pin() -> str:
    return ''.join(secrets.choice(PIN_ALPHABET) for _ in range(PIN_LENGTH))


def qr_payload(pin: str) -> str:
    return f'{QR_PREFIX}{pin}'


def qr_png(pin: str) -> bytes:
    """PNG of the QR code the guard scans instead of typing the PIN."""
    import qrcode
    from qrcode.constants import ERROR_CORRECT_Q
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_Q, box_size=12, border=4)
    qr.add_data(qr_payload(pin))
    qr.make(fit=True)
    buffer = io.BytesIO()
    qr.make_image(fill_color='#1f3160', back_color='white').save(buffer, format='PNG')
    return buffer.getvalue()


def normalize_pin(value: Any) -> str:
    """Upper-case the PIN and drop spaces and dashes (and the QR prefix). Returns '' when it cannot be a valid PIN."""
    text = str(value or '').strip()
    if text.upper().startswith(QR_PREFIX):
        text = text[len(QR_PREFIX):]
    pin = ''.join(ch for ch in text.upper() if ch not in ' -')
    if len(pin) != PIN_LENGTH or any(ch not in PIN_ALPHABET for ch in pin):
        return ''
    return pin


def pin_hash(pin: str) -> str:
    return hmac.new(CryptoService._get_key(), f'handover:{pin}'.encode('utf-8'), hashlib.sha256).hexdigest()


def _missing_column(error: Exception) -> bool:
    text = str(error).lower()
    return 'handover_pin' in text and ('column' in text or 'schema cache' in text or '42703' in text or 'pgrst204' in text)


def _is_duplicate(error: Exception) -> bool:
    text = str(error).lower()
    return 'duplicate key' in text or '23505' in text


class HandoverService:
    def __init__(self, db):
        self.db = db
        self.client = db.client

    def issue(self, claim_id: str) -> str:
        """Create a fresh PIN for an approved claim (replacing any older one) and return it in plain text, once."""
        for _ in range(MAX_ISSUE_ATTEMPTS):
            pin = generate_pin()
            try:
                updated = self.client.table('claims').update({
                    'handover_pin_hash': pin_hash(pin),
                    'handover_pin_encrypted': CryptoService.encrypt(pin),
                    'handover_pin_issued_at': self._now(),
                }).eq('claim_id', claim_id).eq('status', APPROVED_STATUS).execute().data or []
            except Exception as error:
                if _is_duplicate(error):
                    continue  # another open claim already holds this PIN: draw again
                if _missing_column(error):
                    raise HandoverUnavailable()
                raise
            if not updated:
                raise HandoverError('Only an approved claim can have a Handover PIN.', 409, 'not_approved')
            return pin
        raise HandoverError('Could not create a unique PIN. Try again.', 500, 'pin_exhausted')

    def reveal(self, claim: Dict[str, Any]) -> Optional[str]:
        """The owner's PIN, decrypted, for an approved claim; None otherwise."""
        if str(claim.get('status') or '') != APPROVED_STATUS or not claim.get('handover_pin_encrypted'):
            return None
        try:
            return CryptoService.decrypt(claim['handover_pin_encrypted']) or None
        except Exception:
            logger.warning('A stored Handover PIN could not be decrypted for claim %s', claim.get('claim_id'))
            return None

    def find(self, pin: str) -> Dict[str, Any]:
        """The approved claim that holds this PIN, with who and what, or a HandoverError."""
        normalized = normalize_pin(pin)
        if not normalized:
            raise HandoverError('Enter the 6 character PIN from the claimant.', 400, 'invalid_pin')
        try:
            rows = self.client.table('claims').select(
                'claim_id,claim_reference,status,found_item_id,claimant_account_id,reviewed_at'
            ).eq('handover_pin_hash', pin_hash(normalized)).eq('status', APPROVED_STATUS).limit(1).execute().data or []
        except Exception as error:
            if _missing_column(error):
                raise HandoverUnavailable()
            raise
        if not rows:
            raise HandoverError('No approved claim matches that PIN. Check it with the claimant, or it may already have been used.', 404, 'pin_not_found')
        return self._summary(rows[0])

    def _summary(self, claim: Dict[str, Any]) -> Dict[str, Any]:
        claimant = self.db.get_user_by_account_id(str(claim.get('claimant_account_id') or '')) or {}
        item: Dict[str, Any] = {}
        if claim.get('found_item_id'):
            item = (self.client.table('found_items').select('fpost_id,item_name,status').eq('item_id', claim['found_item_id']).limit(1).execute().data or [{}])[0]
        return {
            'claim_id': claim.get('claim_id'),
            'claim_reference': claim.get('claim_reference') or claim.get('claim_id'),
            'claimant_name': f"{claimant.get('fname') or ''} {claimant.get('lname') or ''}".strip() or 'Claimant',
            'claimant_campus_id': claimant.get('campus_id') or '',
            'item_name': item.get('item_name') or 'Found item',
            'found_item_reference': item.get('fpost_id') or '',
            'approved_at': claim.get('reviewed_at'),
        }

    def release(self, pin: str, admin_account_id: str) -> Dict[str, Any]:
        """Mark the item as released to its owner. The PIN stops working as soon as this succeeds."""
        found = self.find(pin)
        try:
            self.db.update_claim_status(found['claim_id'], 'collected', admin_account_id)
        except Exception as error:
            raise HandoverError(f'The item could not be released: {str(error)[:140]}', 409, 'release_failed')
        try:
            self.client.table('claims').update({'handover_pin_hash': None, 'handover_pin_encrypted': None}).eq('claim_id', found['claim_id']).execute()
        except Exception as error:  # the claim is already collected, so the PIN cannot match again anyway
            logger.warning('Handover PIN cleanup failed for claim %s: %s', found['claim_id'], error)
        return found

    def set_pickup_deadline(self, claim_id: str, days: int) -> Optional[str]:
        """Record when an approved claim must be collected by. Never raises: the deadline is a convenience, the approval already stands."""
        from datetime import datetime, timedelta, timezone
        deadline = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
        try:
            self.client.table('claims').update({'pickup_deadline': deadline}).eq('claim_id', claim_id).eq('status', APPROVED_STATUS).execute()
            return deadline
        except Exception as error:
            logger.warning('Pickup deadline could not be saved for claim %s: %s', claim_id, error)
            return None

    @staticmethod
    def _now() -> str:
        from datetime import datetime, timezone
        return datetime.now(timezone.utc).isoformat()
