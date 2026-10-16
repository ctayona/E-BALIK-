"""Anti-abuse rules for one-time codes (registration and password reset).

* A 60 second cooldown between codes for the same email, and at most 5 codes per email in any 24 hours (counted from `otp_tokens`, so every
  server instance and every restart agrees). Both hold for register, forgot password and resend.
* Disposable email domains cannot be used to register.
* A burst limit per network address, so one machine cannot ask for codes for many emails.
* Five wrong guesses kill the code: the row is marked used, and the person has to ask for a new one (which the cooldown and daily limit meter).

Everything fails open on a database error (the in-memory limiter still applies), so a database hiccup never locks people out of signing in.
"""
import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from app.utils import rate_limit

logger = logging.getLogger(__name__)

COOLDOWN_SECONDS = 60
DAILY_LIMIT = 5
MAX_ATTEMPTS = 5
IP_LIMIT = 12
IP_WINDOW_SECONDS = 600
VERIFY_IP_LIMIT = 40          # wrong-or-right guesses per address per window, so guessing cannot be spread over many emails
VERIFY_WINDOW_SECONDS = 600
DAY_SECONDS = 24 * 3600

# Throwaway mailbox providers. A subdomain of one of these counts too. Add domains here as abuse shows up.
DISPOSABLE_DOMAINS = frozenset({
    'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.biz', 'guerrillamail.de', 'grr.la', 'sharklasers.com',
    'pokemail.net', 'spam4.me', '10minutemail.com', '10minutemail.net', '10minutemail.co.uk', '20minutemail.com', 'tempmail.com', 'temp-mail.org',
    'temp-mail.io', 'tempmail.net', 'tempmailo.com', 'tempail.com', 'tempinbox.com', 'throwawaymail.com', 'trashmail.com', 'trashmail.net', 'trashmail.de',
    'yopmail.com', 'yopmail.net', 'yopmail.fr', 'cool.fr.nf', 'jetable.org', 'nospam.ze.tc', 'dispostable.com', 'getnada.com', 'nada.email',
    'maildrop.cc', 'mailnesia.com', 'mailcatch.com', 'mintemail.com', 'mohmal.com', 'moakt.com', 'mytemp.email', 'emailondeck.com', 'fakeinbox.com',
    'fakemail.net', 'getairmail.com', 'harakirimail.com', 'incognitomail.org', 'instantemailaddress.com', 'mailforspam.com', 'mailnull.com',
    'mailtothis.com', 'mvrht.net', 'owlymail.com', 'rcpt.at', 'spambog.com', 'spamgourmet.com', 'tmail.ws', 'tmpmail.net', 'tmpmail.org',
    'burnermail.io', 'discard.email', 'discardmail.com', 'dropmail.me', 'emailfake.com', 'email-fake.com', 'fakemailgenerator.com', 'inboxkitten.com',
    'luxusmail.org', 'mail-temp.com', 'mailpoof.com', 'minuteinbox.com', 'myfakemail.com', 'smailpro.com', 'spamex.com', 'tempr.email', 'trbvm.com',
    'gufum.com', 'linshiyouxiang.net', 'mail.tm', 'mailsac.com', 'inboxbear.com', 'wegwerfmail.de', 'byom.de', 'sute.jp', 'sofort-mail.de',
})


class OtpBlocked(Exception):
    """A rule stopped the request. `status` and `retry_after` are ready for the JSON answer."""

    def __init__(self, message: str, code: str, retry_after: int = 0, status: int = 429):
        super().__init__(message)
        self.message, self.code, self.retry_after, self.status = message, code, int(retry_after), status

    def body(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {'error': self.message, 'code': self.code}
        if self.retry_after:
            payload['retry_after'] = self.retry_after
        return payload


def is_disposable(email: str) -> bool:
    domain = str(email or '').strip().lower().rpartition('@')[2]
    if not domain:
        return False
    parts = domain.split('.')
    return any('.'.join(parts[i:]) in DISPOSABLE_DOMAINS for i in range(len(parts) - 1))


def client_ip() -> str:
    """The address the proxy saw. Render appends the real client last, so the last entry cannot be spoofed by the caller."""
    from flask import request
    forwarded = request.headers.get('X-Forwarded-For', '')
    return (forwarded.split(',')[-1].strip() if forwarded else '') or request.remote_addr or 'unknown'


def _parse(value: Any) -> Optional[datetime]:
    try:
        moment = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _wait_text(seconds: int) -> str:
    if seconds >= 3600:
        hours = math.ceil(seconds / 3600)
        return f'{hours} hour{"s" if hours != 1 else ""}'
    if seconds >= 90:
        return f'{math.ceil(seconds / 60)} minutes'
    return f'{seconds} second{"s" if seconds != 1 else ""}'


def block_disposable(email: str) -> None:
    if is_disposable(email):
        raise OtpBlocked('Disposable email addresses cannot be used. Please use your university email or another permanent address.', 'disposable_email', status=400)


def check_ip(ip: Optional[str]) -> None:
    if ip and not rate_limit.allow(f'otp-ip:{ip}', IP_LIMIT, IP_WINDOW_SECONDS):
        raise OtpBlocked('Too many code requests from this network. Wait a few minutes and try again.', 'ip_limited', IP_WINDOW_SECONDS // 2)


def check_memory(email: str) -> None:
    """Cooldown and daily limit kept in this process. Used for password reset (so unknown emails behave exactly like known ones) and as the
    fallback when the database cannot be read."""
    key = str(email or '').strip().lower()
    if not rate_limit.allow(f'otp-cool:{key}', 1, COOLDOWN_SECONDS):
        raise OtpBlocked(f'Please wait {COOLDOWN_SECONDS} seconds before asking for another code.', 'cooldown', COOLDOWN_SECONDS)
    if not rate_limit.allow(f'otp-day:{key}', DAILY_LIMIT, DAY_SECONDS):
        raise OtpBlocked(f'You have asked for too many codes today (the limit is {DAILY_LIMIT}). Try again tomorrow.', 'daily_limit', DAY_SECONDS)


def check_issue(client, email: str, now: Optional[datetime] = None) -> None:
    """Raise OtpBlocked when this email may not be sent another code right now (cooldown or daily limit, counted from the database)."""
    now = now or datetime.now(timezone.utc)
    key = str(email or '').strip().lower()
    try:
        rows = client.table('otp_tokens').select('created_at').eq('email', key).gte('created_at', (now - timedelta(seconds=DAY_SECONDS)).isoformat()) \
            .order('created_at', desc=True).limit(50).execute().data or []
    except Exception as error:
        logger.warning('OTP history unavailable, using the in-memory limits: %s', str(error)[:120])
        check_memory(key)
        return
    stamps = [stamp for stamp in (_parse(row.get('created_at')) for row in rows) if stamp]
    if stamps:
        age = (now - stamps[0]).total_seconds()
        if age < COOLDOWN_SECONDS:
            wait = max(int(math.ceil(COOLDOWN_SECONDS - age)), 1)
            raise OtpBlocked(f'Please wait {wait} second{"s" if wait != 1 else ""} before asking for another code.', 'cooldown', wait)
    if len(stamps) >= DAILY_LIMIT:
        reopens = stamps[DAILY_LIMIT - 1] + timedelta(seconds=DAY_SECONDS)
        wait = max(int(math.ceil((reopens - now).total_seconds())), 1)
        raise OtpBlocked(f'You have asked for too many codes today (the limit is {DAILY_LIMIT}). Try again in about {_wait_text(wait)}.', 'daily_limit', wait)


def daily_limit_reached(client, email: str, now: Optional[datetime] = None) -> bool:
    """True when the email already used its codes today. Used by password reset, which must answer the same way whether or not the account exists."""
    try:
        check_issue(client, email, now)
    except OtpBlocked:
        return True
    return False


def check_verify_ip(ip: Optional[str]) -> None:
    if ip and not rate_limit.allow(f'otp-verify-ip:{ip}', VERIFY_IP_LIMIT, VERIFY_WINDOW_SECONDS):
        raise OtpBlocked('Too many verification attempts from this network. Wait a few minutes and try again.', 'ip_limited', VERIFY_WINDOW_SECONDS // 2)


def register_failure(client, record: Dict[str, Any], email: str, otp_type: str) -> Optional[int]:
    """Count one wrong guess against the code. Returns how many guesses are left, or raises OtpBlocked when this was the last one:
    the code is then dead and a new one has to be requested."""
    attempts = int(record.get('attempts') or 0) + 1
    locked = attempts >= MAX_ATTEMPTS
    counted = True
    try:
        client.table('otp_tokens').update({'attempts': attempts, **({'is_used': True} if locked else {})}).eq('id', record['id']).execute()
    except Exception as error:
        if 'attempts' not in str(error):
            logger.warning('Could not record a wrong code for %s: %s', email, str(error)[:120])
        counted = False
    if not counted:
        # Migration 20261020 has not been run: count in this process and still kill the code at the limit.
        allowed = rate_limit.allow(f'otp-fail:{str(email).lower()}:{otp_type}', MAX_ATTEMPTS - 1, 900)
        locked = not allowed
        attempts = attempts if allowed else MAX_ATTEMPTS
        if locked:
            try:
                client.table('otp_tokens').update({'is_used': True}).eq('id', record['id']).execute()
            except Exception as error:
                logger.warning('Could not retire the code of %s: %s', email, str(error)[:120])
    if locked:
        raise OtpBlocked('Too many wrong codes. This code no longer works, so please ask for a new one.', 'otp_locked', 0)
    return MAX_ATTEMPTS - attempts if counted else None
