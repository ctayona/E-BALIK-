"""Email notification preferences and one-click unsubscribe links.

Two optional categories can be switched off by the user:
  * `reminders`     pickup reminders for approved claims and Smart Tag expiry reminders;
  * `announcements` broadcast messages from the administrators.
Everything else is transactional and always sent: verification codes, claim approval (it carries the Handover PIN), the handover
receipt, claim expiry, auction winner and deadline notices, security notices.

Preferences live in `user_profiles.email_preferences` (JSONB, e.g. {"reminders": false}); a missing key means "on".
An unsubscribe link carries a signed token (account and category, HMAC with the app key), so it needs no login and cannot be forged.
"""
import base64
import hashlib
import hmac
import logging
import os
from typing import Any, Dict, Optional, Tuple

from app.utils.crypto_service import CryptoService

logger = logging.getLogger(__name__)

CATEGORIES = ('reminders', 'announcements')
LABELS = {'reminders': 'reminders', 'announcements': 'announcements'}


def get_prefs(profile: Optional[Dict[str, Any]]) -> Dict[str, bool]:
    """The user's choices with defaults filled in. Anything unreadable counts as "on" so a bad value never hides a notice by accident."""
    raw = (profile or {}).get('email_preferences')
    raw = raw if isinstance(raw, dict) else {}
    return {category: raw.get(category) is not False for category in CATEGORIES}


def allows(profile: Optional[Dict[str, Any]], category: str) -> bool:
    return get_prefs(profile).get(category, True)


def clean_update(payload: Any) -> Dict[str, bool]:
    """Keep only known categories with real booleans; anything else is ignored."""
    if not isinstance(payload, dict):
        return {}
    return {key: payload[key] for key in CATEGORIES if isinstance(payload.get(key), bool)}


# ------------------------------------------------------------------------------------------------ signed links
def _sign(message: str) -> str:
    return hmac.new(CryptoService._get_key(), f'unsubscribe:{message}'.encode('utf-8'), hashlib.sha256).hexdigest()[:32]


def make_token(account_id: str, category: str) -> str:
    body = base64.urlsafe_b64encode(f'{account_id}|{category}'.encode('utf-8')).decode('ascii').rstrip('=')
    return f'{body}.{_sign(body)}'


def read_token(token: Any) -> Optional[Tuple[str, str]]:
    """(account_id, category) for a valid token, else None."""
    try:
        body, signature = str(token or '').split('.', 1)
        if not hmac.compare_digest(signature, _sign(body)):
            return None
        padded = body + '=' * (-len(body) % 4)
        account_id, category = base64.urlsafe_b64decode(padded.encode('ascii')).decode('utf-8').split('|', 1)
    except Exception:
        return None
    return (account_id, category) if account_id and category in CATEGORIES else None


def api_base() -> str:
    """The public address of this API: PUBLIC_API_URL, else Render's own RENDER_EXTERNAL_URL, else the local default."""
    return (os.getenv('PUBLIC_API_URL') or os.getenv('RENDER_EXTERNAL_URL') or 'http://localhost:5000').rstrip('/')


def unsubscribe_url(account_id: Any, category: str) -> str:
    return f"{api_base()}/api/email/unsubscribe?t={make_token(str(account_id), category)}"
