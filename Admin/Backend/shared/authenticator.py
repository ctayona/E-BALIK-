"""Check a super admin's Google Authenticator code before an irreversible action (the same rules as deleting an account)."""
from datetime import datetime, timezone

from app.utils.admin_mfa import matched_totp_step
from app.utils.crypto_service import CryptoService


class AuthenticatorError(Exception):
    """A code that cannot be accepted, with the HTTP status the route should return."""

    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.message, self.status = message, status


def consume_authenticator_code(db, account_id: str, code: str, action: str = 'this action') -> int:
    """Accept a current 6 digit code once. Raises AuthenticatorError otherwise (403 not enabled, 423 locked, 401 wrong or reused)."""
    record = db.get_admin_mfa(account_id)
    if not record or not record.get('enabled_at'):
        raise AuthenticatorError(f'Enable Google Authenticator in your Admin Profile before {action}.', 403)
    locked_until = record.get('locked_until')
    if locked_until:
        parsed = datetime.fromisoformat(str(locked_until).replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        if parsed > datetime.now(timezone.utc):
            raise AuthenticatorError('Google Authenticator verification is temporarily locked.', 423)
    secret = CryptoService.decrypt(record.get('secret_ciphertext'))
    step = matched_totp_step(secret or '', str(code or '').strip())
    if step is None:
        db.record_admin_mfa_failure(account_id)
        raise AuthenticatorError('Authenticator code is invalid.', 401)
    if not db.consume_admin_mfa_step(account_id, step):
        raise AuthenticatorError('Authenticator code was already used or MFA is locked.', 401)
    return step
