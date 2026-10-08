"""Auction winner email. AUCTION_EMAIL_MODE: auto (default: send when SENDGRID_API_KEY is set, else log), sendgrid or mock."""
import logging
import os
from typing import Any, Dict, Optional

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


def _deliver_notice(*, to_email: str, message: Dict[str, str], notice: Dict[str, Any]) -> Dict[str, Any]:
    """Like `_deliver`, for the richer notice layout (a highlighted code). The code is never written to the log in mock mode."""
    mode = (os.getenv('AUCTION_EMAIL_MODE') or 'auto').strip().lower()
    if mode == 'auto':
        mode = 'sendgrid' if os.getenv('SENDGRID_API_KEY') else 'mock'
    if mode == 'sendgrid':
        try:
            from app.utils.email_service import send_notice_email_best_effort, site_url
            sent = send_notice_email_best_effort(to_email, message['subject'], cta=('View Auction Details', site_url()), **notice)
            return {'mode': 'sendgrid', 'sent': bool(sent), 'subject': message['subject']}
        except Exception as error:  # pragma: no cover - depends on SendGrid configuration
            logger.exception('Auction email failed: %s', error)
            return {'mode': 'sendgrid', 'sent': False, 'subject': message['subject']}
    logger.info('[MOCK EMAIL] to=%s subject="%s" (a Handover PIN is included and not logged)', _mask_email(to_email), message['subject'])
    return {'mode': 'mock', 'sent': True, 'subject': message['subject']}


def _deliver(*, to_email: str, recipient_name: str, message: Dict[str, str], email: Dict[str, Any]) -> Dict[str, Any]:
    """Send through SendGrid or only log, following AUCTION_EMAIL_MODE. Never raises: a failed notice must not undo saved data."""
    mode = (os.getenv('AUCTION_EMAIL_MODE') or 'auto').strip().lower()
    if mode == 'auto':  # real emails whenever SendGrid is configured, otherwise a logged mock for local development
        mode = 'sendgrid' if os.getenv('SENDGRID_API_KEY') else 'mock'
    if mode == 'sendgrid':
        try:
            from app.utils.email_service import send_reference_email_best_effort
            sent = send_reference_email_best_effort(to_email=to_email, recipient_name=recipient_name, subject=message['subject'], **email)
            return {'mode': 'sendgrid', 'sent': bool(sent), 'subject': message['subject']}
        except Exception as error:  # pragma: no cover - depends on SendGrid configuration
            logger.exception('Auction email failed: %s', error)
            return {'mode': 'sendgrid', 'sent': False, 'subject': message['subject']}

    logger.info('[MOCK EMAIL] to=%s subject="%s"\n%s', _mask_email(to_email), message['subject'], message['body'])
    return {'mode': 'mock', 'sent': True, 'subject': message['subject']}


def send_auction_won_email(*, to_email: str, recipient_name: str, item_title: str, reference: str, amount: Any, handover_pin: Optional[str] = None) -> Dict[str, Any]:
    """Return {'mode', 'sent', 'subject'}. With a `handover_pin` the email shows it as the code to give the guard at the desk."""
    message = build_winner_email(recipient_name, item_title, reference, amount)
    if handover_pin:
        message['body'] += '\n\nA Handover PIN was created for this win. It is shown in your Auction Hall account and in this email.'
        return _deliver_notice(to_email=to_email, message=message, notice={
            'title': 'Congratulations, you won!',
            'preheader': f"Handover PIN {handover_pin}. Bring your ID, pay and collect {item_title}.",
            'greeting': f"Hello {recipient_name or 'there'},",
            'paragraphs': [f"Your bid of {format_peso(amount)} won the auction for {item_title}. {PICKUP_NOTE} Please collect it within 72 hours of this notice.",
                           'At the desk, pay the amount and show the PIN below to the guard together with your ID. Entering it completes the handover.'],
            'highlight': ('YOUR HANDOVER PIN', handover_pin),
            'highlight_note': 'Keep this PIN private. It works once, for this item only, and only together with your ID.',
            'details': {'Item': item_title, 'Auction item': reference or item_title, 'Winning bid': format_peso(amount), 'Collect within': '72 hours'},
            'tone': 'success',
        })
    return _deliver(to_email=to_email, recipient_name=recipient_name, message=message, email={
        'title': 'Congratulations, you won!',
        'summary': f"Your bid of {format_peso(amount)} won the auction for {item_title}. {PICKUP_NOTE} Please collect it within 72 hours of this notice.",
        'reference_label': 'Auction item',
        'reference': reference or item_title,
        'details': {'Winning bid': format_peso(amount), 'Collect within': '72 hours'},
        'cta_label': 'View Auction Details',
        'tone': 'success',
    })


def build_final_warning_email(recipient_name: str, item_title: str) -> Dict[str, str]:
    return {
        'subject': f"Final warning: collect {item_title} within 24 hours",
        'body': (f"Hello {recipient_name or 'there'},\n\nYou have not collected {item_title} yet. You have 24 hours left before "
                 "the win is forfeited and you are barred from bidding for 30 days.\n\nUniversity of Makati - E-Balik Lost & Found"),
    }


def send_auction_final_warning_email(*, to_email: str, recipient_name: str, item_title: str, reference: str, amount: Any, hours_left: int = 24) -> Dict[str, Any]:
    """The 24-hour Final Warning, sent when a winner has not collected after 48 hours."""
    message = build_final_warning_email(recipient_name, item_title)
    return _deliver(to_email=to_email, recipient_name=recipient_name, message=message, email={
        'title': f'{hours_left}-hour final warning',
        'summary': (f"Your winning bid of {format_peso(amount)} for {item_title} is still waiting at the Lost and Found Office. "
                    f"Please collect it within {hours_left} hours. After that your win is forfeited, the item goes back to auction and you "
                    "cannot bid for 30 days. If something has gone wrong, contact us right away and we will help."),
        'reference_label': 'Auction item',
        'reference': reference or item_title,
        'details': {'Winning bid': format_peso(amount), 'Time left': f'{hours_left} hours', 'Bring': 'Your original school or government ID'},
        'cta_label': 'Collect My Item',
        'tone': 'warning',
    })


def build_forfeit_email(recipient_name: str, item_title: str) -> Dict[str, str]:
    return {
        'subject': f"Your win for {item_title} was forfeited",
        'body': (f"Hello {recipient_name or 'there'},\n\nThe 72-hour collection window for {item_title} has passed, so the win was forfeited. "
                 "You cannot place bids for 30 days.\n\nUniversity of Makati - E-Balik Lost & Found"),
    }


def send_auction_forfeited_email(*, to_email: str, recipient_name: str, item_title: str, reference: str, amount: Any, ban_days: int = 30) -> Dict[str, Any]:
    """Sent once the 72-hour window passes without a pickup."""
    message = build_forfeit_email(recipient_name, item_title)
    return _deliver(to_email=to_email, recipient_name=recipient_name, message=message, email={
        'title': 'Your auction win was forfeited',
        'summary': (f"The 72-hour collection window for {item_title} has passed without a pickup, so your winning bid of {format_peso(amount)} was forfeited "
                    f"and the item will be offered again. Bidding is paused on your account for {ban_days} days. You can still report, claim and browse as usual. "
                    "If you believe this is a mistake, please contact the Lost and Found Office."),
        'reference_label': 'Auction item',
        'reference': reference or item_title,
        'details': {'Bidding paused for': f'{ban_days} days'},
        'cta_label': 'Open E-Balik',
        'tone': 'danger',
    })
