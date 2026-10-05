"""Auction winner email. Runs in mock mode by default: the message is built and logged, not delivered."""
import logging
import os
from typing import Any, Dict

logger = logging.getLogger(__name__)

PICKUP_NOTE = (
    'Please bring your original school or government ID to the UMak Lost and Found Office to pay and collect '
    'the item. If you do not collect it, the university may offer it to another bidder.'
)


def _mask_email(email: str) -> str:
    local, _, domain = (email or '').partition('@')
    if not local or not domain:
        return 'unknown'
    return f"{local[0]}{'*' * max(len(local) - 1, 1)}@{domain}"


def format_peso(amount: Any) -> str:
    try:
        return f"PHP {float(amount):,.2f}"
    except (TypeError, ValueError):
        return 'PHP 0.00'


def build_winner_email(recipient_name: str, item_title: str, reference: str, amount: Any) -> Dict[str, str]:
    subject = f"You won the auction for {item_title}"
    body = (
        f"Hello {recipient_name or 'there'},\n\n"
        f"Congratulations! Your bid of {format_peso(amount)} won the E-Balik auction for {item_title}"
        f"{f' ({reference})' if reference else ''}.\n\n"
        f"{PICKUP_NOTE}\n\n"
        "University of Makati - E-Balik Lost & Found"
    )
    return {'subject': subject, 'body': body}


def send_auction_won_email(*, to_email: str, recipient_name: str, item_title: str, reference: str, amount: Any) -> Dict[str, Any]:
    """Return {'mode', 'sent', 'subject'}. Never raises: a failed notice must not undo the saved auction result."""
    mode = (os.getenv('AUCTION_EMAIL_MODE') or 'mock').strip().lower()
    message = build_winner_email(recipient_name, item_title, reference, amount)
    if mode == 'sendgrid':
        try:
            from app.utils.email_service import send_reference_email_best_effort
            sent = send_reference_email_best_effort(
                to_email=to_email,
                recipient_name=recipient_name,
                subject=message['subject'],
                summary=f"Your bid of {format_peso(amount)} won the auction for {item_title}. {PICKUP_NOTE}",
                reference_label='Auction item',
                reference=reference or item_title,
                details={'Winning bid': format_peso(amount)},
            )
            return {'mode': 'sendgrid', 'sent': bool(sent), 'subject': message['subject']}
        except Exception as error:  # pragma: no cover - depends on SendGrid configuration
            logger.exception('Auction winner email failed: %s', error)
            return {'mode': 'sendgrid', 'sent': False, 'subject': message['subject']}

    logger.info('[MOCK EMAIL] to=%s subject="%s"\n%s', _mask_email(to_email), message['subject'], message['body'])
    return {'mode': 'mock', 'sent': True, 'subject': message['subject']}
