"""
Email and OTP utilities using SendGrid. Message layout lives in email_templates.py.
"""
import json
import random
import string
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail, Email, To, Content, Header
from config import Config
from app.utils.email_templates import render_email, site_url
import logging
from typing import Dict, Optional

logger = logging.getLogger(__name__)

BREVO_URL = 'https://api.brevo.com/v3/smtp/email'

# Recent delivery results for this server process (Mission Control > Monitoring). Reset when the server restarts.
STATS: Dict[str, object] = {'sent': 0, 'failed': 0, 'last_ok_at': None, 'last_fail_at': None, 'last_error': ''}


def _record(ok: bool, error: str = '') -> None:
    moment = datetime.now(timezone.utc).isoformat()
    if ok:
        STATS['sent'] = int(STATS['sent']) + 1
        STATS['last_ok_at'] = moment
    else:
        STATS['failed'] = int(STATS['failed']) + 1
        STATS['last_fail_at'] = moment
        STATS['last_error'] = error[:160]


def check_provider() -> Dict[str, object]:
    """Ask the provider whether our key works, without sending any email. {ok, status_code, detail, plan}."""
    key = provider_key()
    if key == 'brevo':
        url, headers = 'https://api.brevo.com/v3/account', {'api-key': Config.BREVO_API_KEY or '', 'Accept': 'application/json'}
    elif key == 'sendgrid':
        url, headers = 'https://api.sendgrid.com/v3/scopes', {'Authorization': f'Bearer {Config.SENDGRID_API_KEY}'}
    else:
        return {'ok': False, 'status_code': None, 'detail': 'No email provider is configured.', 'plan': None}
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=10) as response:
            data = json.loads(response.read().decode('utf-8', 'replace') or '{}')
    except urllib.error.HTTPError as error:
        detail = {401: 'The provider rejected the key (401). An expired trial, a revoked key or a typo gives this answer.', 403: 'The provider refused this key (403).'}.get(error.code, f'The provider answered {error.code}.')
        return {'ok': False, 'status_code': error.code, 'detail': detail, 'plan': None}
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return {'ok': False, 'status_code': None, 'detail': f'The provider could not be reached: {str(error)[:100]}', 'plan': None}
    if key == 'brevo':
        plans = [p for p in (data.get('plan') or []) if isinstance(p, dict)]
        plan = ', '.join(f"{p.get('type', 'plan')} ({p.get('credits')} {p.get('creditsType', 'credits')} left)" for p in plans if p.get('credits') is not None) or None
        return {'ok': True, 'status_code': 200, 'detail': 'Brevo accepted the key.' + (f' Plan: {plan}.' if plan else ''), 'plan': plan}
    allowed = 'mail.send' in (data.get('scopes') or [])
    return {'ok': allowed, 'status_code': 200, 'detail': 'SendGrid accepted the key.' if allowed else 'The key works but is not allowed to send mail (missing the mail.send permission).', 'plan': None}


class EmailDeliveryError(Exception):
    """The provider refused or could not take the message. `status_code` is its HTTP status when it answered."""

    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


def provider_key() -> str:
    """'brevo' when BREVO_API_KEY is set, else 'sendgrid' when SENDGRID_API_KEY is set, else ''. Read at call time."""
    return 'brevo' if Config.BREVO_API_KEY else ('sendgrid' if Config.SENDGRID_API_KEY else '')


def provider_name() -> str:
    """'Brevo', 'SendGrid' or '' when no email provider is configured."""
    return {'brevo': 'Brevo', 'sendgrid': 'SendGrid'}.get(provider_key(), '')


class EmailService:
    """Email service (Brevo or SendGrid, whichever key is set). Every message is built by `email_templates.render_email` (Navy and Gold HTML plus plain text)."""

    provider = 'sendgrid'  # overwritten in __init__; the default keeps tests that skip __init__ on the SendGrid path

    def __init__(self):
        self.provider = provider_key()
        try:
            if self.provider == 'brevo':
                self.sg = None
                self.from_email = Config.BREVO_FROM_EMAIL
                if not self.from_email:
                    raise ValueError('BREVO_FROM_EMAIL (or SENDGRID_FROM_EMAIL) is not set')
            else:
                self.sg = SendGridAPIClient(Config.SENDGRID_API_KEY)
                self.from_email = Config.SENDGRID_FROM_EMAIL
            logger.info("✓ %s email service initialized", provider_name() or 'Email')
        except Exception as e:
            logger.error(f"✗ Failed to initialize the email service: {e}")
            raise

    def _send_brevo(self, to_email: str, subject: str, html: str, text: str, headers: Optional[Dict[str, str]] = None) -> bool:
        body = {
            'sender': {'name': Config.EMAIL_FROM_NAME, 'email': self.from_email},
            'to': [{'email': to_email}],
            'subject': subject, 'htmlContent': html, 'textContent': text,
        }
        if headers:
            body['headers'] = dict(headers)
        request = urllib.request.Request(BREVO_URL, data=json.dumps(body).encode('utf-8'), method='POST', headers={
            'api-key': Config.BREVO_API_KEY or '', 'Content-Type': 'application/json', 'Accept': 'application/json',
        })
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return 200 <= int(response.status) < 300
        except urllib.error.HTTPError as error:
            detail = ''
            try:
                detail = json.loads(error.read().decode('utf-8', 'replace')).get('message', '')
            except Exception:
                pass
            raise EmailDeliveryError(f'Brevo answered {error.code}: {detail or error.reason}', error.code) from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise EmailDeliveryError(f'Brevo could not be reached: {error}') from error

    def _send(self, to_email: str, subject: str, html: str, text: str, headers: Optional[Dict[str, str]] = None) -> bool:
        """Send one message with an HTML and a plain-text part. True only when the provider accepts it."""
        if self.provider == 'brevo':
            return self._send_brevo(to_email, subject, html, text, headers)
        message = Mail(
            from_email=self.from_email,
            to_emails=to_email,
            subject=subject,
            html_content=html,
            plain_text_content=text,
        )
        for key, value in (headers or {}).items():
            message.add_header(Header(key, value))
        response = self.sg.send(message)
        return 200 <= int(response.status_code) < 300

    def send_notice_email(self, to_email: str, subject: str, unsubscribe_url: str = '', unsubscribe_label: str = 'these emails', **layout) -> bool:
        """Render a premium message (see `render_email` for the layout fields) and send it. Never raises.

        An `unsubscribe_url` (optional emails only) adds a footer link and the List-Unsubscribe headers mail apps show as a button.
        """
        if not to_email:
            logger.warning('Skipping email "%s": the account has no email address', subject)
            return False
        try:
            html, text = render_email(unsubscribe_url=unsubscribe_url, unsubscribe_label=unsubscribe_label, **layout)
            headers = {'List-Unsubscribe': f'<{unsubscribe_url}>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'} if unsubscribe_url else None
            sent = self._send(to_email, subject, html, text, headers)
            _record(bool(sent), '' if sent else 'The provider did not accept the message')
            if not sent:
                logger.error('The email provider rejected the email "%s"', subject)
            return sent
        except Exception as error:
            _record(False, str(error))
            logger.exception('Failed to send email "%s": %s', subject, error)
            return False

    def send_otp_email(self, to_email: str, otp_code: str, otp_type: str = "registration") -> bool:
        """Send a verification code. otp_type: 'registration' or 'password_reset'."""
        if otp_type == "registration":
            return self.send_notice_email(
                to_email, "Your E-Balik verification code",
                title="Welcome to E-Balik",
                preheader=f"Your verification code is {otp_code}. It expires in 10 minutes.",
                paragraphs=[
                    "Thank you for joining the University of Makati's lost and found community. You are one step away from reporting and recovering belongings on campus.",
                    "Enter the code below on the sign-up page to confirm your email address.",
                ],
                highlight=("YOUR VERIFICATION CODE", otp_code),
                highlight_note="This code expires in 10 minutes and works only once.",
                notes=["If you did not create an E-Balik account, you can safely ignore this email. Nothing will happen without this code."],
            )
        return self.send_notice_email(
            to_email, "Reset your E-Balik password",
            title="Reset your password",
            preheader=f"Your password reset code is {otp_code}. It expires in 10 minutes.",
            paragraphs=[
                "We received a request to reset the password for your E-Balik account. Use the code below to continue.",
            ],
            highlight=("YOUR RESET CODE", otp_code),
            highlight_note="This code expires in 10 minutes and works only once.",
            notes=["If you did not ask for a reset, ignore this email. Your password stays exactly as it is, and your account is safe."],
            tone='warning',
        )

    def send_welcome_email(self, to_email: str, first_name: str) -> bool:
        """Sent once the account is verified."""
        return self.send_notice_email(
            to_email, "Welcome to E-Balik - University of Makati",
            title=f"You're in, {first_name or 'welcome'}",
            preheader="Your E-Balik account is ready. Here is what you can do first.",
            greeting=f"Hello {first_name or 'there'},",
            paragraphs=[
                "Your account is ready, and we are glad you are here. E-Balik is how the University of Makati reunites people with the things they lose on campus.",
                "Report something you lost, post something you found, and let our matching tool do the searching. When your item turns up, we will email you and walk you through collecting it safely at the Lost and Found Office.",
            ],
            details={'Report a lost item': 'Describe it once and we watch for matches', 'Post a found item': 'Help a classmate get their belongings back', 'Smart Tags': 'Put a QR sticker on your valuables'},
            cta=("Go to my dashboard", site_url()),
            notes=["Need a hand? Reply to ebaliksupport@gmail.com or visit the Lost and Found Office."],
        )

    def send_reference_email(
        self,
        to_email: str,
        recipient_name: str,
        subject: str,
        summary: str,
        reference_label: str,
        reference: str,
        details: Optional[Dict[str, str]] = None,
        title: Optional[str] = None,
        cta_label: str = 'Open my E-Balik account',
        cta_path: str = '',
        highlight_label: Optional[str] = None,
        highlight_value: Optional[str] = None,
        highlight_note: str = '',
        tone: str = 'default',
    ) -> bool:
        """A status email with a reference number. Without a highlight the reference itself is the highlighted block."""
        if not to_email:
            logger.warning('Skipping reference email because the account has no email address')
            return False
        highlight = (highlight_label or reference_label, highlight_value) if highlight_value else (reference_label, reference or 'Unavailable')
        shown_details = dict(details or {})
        if highlight_value and reference:
            shown_details = {reference_label: reference, **shown_details}
        sent = self.send_notice_email(
            to_email, subject,
            title=title or subject,
            preheader=summary[:140],
            greeting=f"Hello {recipient_name or 'there'},",
            paragraphs=[summary],
            highlight=highlight,
            highlight_note=highlight_note,
            highlight_big=bool(highlight_value),
            details=shown_details,
            cta=(cta_label, site_url(cta_path)),
            notes=["You can review this record any time in your E-Balik account. We will never ask for passwords or verification codes."],
            tone=tone,
        )
        if sent:
            logger.info('Reference email sent for %s', reference_label)
        return sent

    def send_claim_approved_email(
        self,
        to_email: str,
        recipient_name: str,
        claim_reference: str,
        item_name: str,
        found_item_reference: str,
        handover_pin: Optional[str],
        pickup_deadline_text: Optional[str] = None,
    ) -> bool:
        """The approval notice. The Handover PIN is the centrepiece: the guard types it to release the item."""
        paragraphs = [
            f"Good news: your claim for \"{item_name}\" has been approved. The Lost and Found Office has the item ready for you.",
        ]
        if handover_pin:
            paragraphs.append("Bring your original school or government ID and show the PIN below to the guard. Entering it completes the handover and records the return.")
        else:
            paragraphs.append("Bring your original school or government ID to the Lost and Found Office. Staff will verify you in person before releasing the item.")
        return self.send_notice_email(
            to_email, "Your E-Balik claim was approved",
            title="Your claim is approved",
            preheader=f"Handover PIN {handover_pin}. Bring your ID to collect your item." if handover_pin else "Bring your ID to the Lost and Found Office to collect your item.",
            greeting=f"Hello {recipient_name or 'there'},",
            paragraphs=paragraphs,
            highlight=("YOUR HANDOVER PIN", handover_pin) if handover_pin else None,
            highlight_note="Keep this PIN private. It works once, for this item only, and only together with your ID.",
            details={'Item': item_name, 'Claim reference': claim_reference, 'Found item reference': found_item_reference,
                     'Collect by': pickup_deadline_text or '',
                     'Where': 'Lost and Found Office, Admin Building (Ground Floor, OHSO Office)'},
            cta=("View Claim Status", site_url()),
            notes=["Approval online does not release the item by itself: the in-person check keeps your belongings safe. Questions? Call 09478685684."],
        )

    def send_handover_receipt_email(self, to_email: str, recipient_name: str, item_name: str, claim_reference: str,
                                    found_item_reference: str, released_at: str, receipt_no: str = '', receipt_code: str = '') -> bool:
        """Sent once the guard has released the item: the owner's proof that it was returned."""
        return self.send_notice_email(
            to_email, "Your item was released: receipt",
            title="Item released to you",
            preheader=f"{item_name} was released to you. This is your receipt.",
            greeting=f"Hello {recipient_name or 'there'},",
            paragraphs=[
                f"This confirms that \"{item_name}\" was handed over to you at the Lost and Found Office. Your claim is now complete, and we are glad it found its way back.",
                "Keep this email as your receipt. You can also open, print or save it as a PDF in E-Balik under Claims, then My receipts. If anything about this handover looks wrong, contact us right away.",
            ],
            highlight=('RECEIPT NUMBER', receipt_no) if receipt_no else None,
            highlight_note=f'Verification code: {receipt_code}' if receipt_code else '',
            details={'Item': item_name, 'Claim reference': claim_reference, 'Found item reference': found_item_reference, 'Released': released_at},
            cta=("View my receipt", site_url()),
            notes=["If you did not collect this item yourself, please call 09478685684 or email ebaliksupport@gmail.com immediately."],
            tone='success',
        )

    def send_claim_pickup_reminder_email(self, to_email: str, recipient_name: str, item_name: str, claim_reference: str,
                                         days_left: int, deadline_text: str, unsubscribe_url: str = '') -> bool:
        """A friendly nudge a week after approval. Optional (the reminders category)."""
        return self.send_notice_email(
            to_email, f"Reminder: {item_name} is waiting for you",
            unsubscribe_url=unsubscribe_url, unsubscribe_label='pickup reminders',
            title="Your item is still waiting",
            preheader=f"Collect {item_name} within {days_left} days with your Handover PIN and ID.",
            greeting=f"Hello {recipient_name or 'there'},",
            paragraphs=[
                f"Your claim for \"{item_name}\" was approved and the Lost and Found Office is keeping it safe for you.",
                f"Please collect it by {deadline_text}. Bring your original school or government ID and show your Handover PIN, which is on your claim card in E-Balik.",
            ],
            details={'Item': item_name, 'Claim reference': claim_reference, 'Collect by': deadline_text, 'Time left': f"{days_left} day{'s' if days_left != 1 else ''}"},
            cta=("View Claim Status", site_url()),
            notes=["If you can no longer collect it, no action is needed. After the deadline the claim closes and you can submit a new one."],
            tone='warning',
        )

    def send_admin_digest_email(self, to_email: str, recipient_name: str, digest: dict, date_text: str, unsubscribe_url: str = '') -> bool:
        """The daily summary for administrators: only the things that are waiting, with the oldest claims named."""
        counts = digest.get('counts') or {}
        rows = [
            ('Claims waiting for review', counts.get('claims', 0)),
            ('IDs waiting for verification', counts.get('users', 0)),
            ('Smart Tags waiting for approval', counts.get('smart-tags', 0)),
            ('Auction results to confirm', counts.get('auctions', 0)),
            (f"Approved claims expiring within {digest.get('dueSoonDays', 3)} days", len(digest.get('dueSoon') or [])),
            ('Items a guard has not confirmed receiving', digest.get('lateReceipts', 0)),
            ('Items old enough to auction', digest.get('auctionReady', 0)),
        ]
        details = {label: str(value) for label, value in rows if value}
        notes = []
        for claim in digest.get('overdue') or []:
            notes.append(f"{claim['item']} ({claim['reference']}): a claim has waited {claim['days']} days for a decision.")
        total = digest.get('attention', 0)
        return self.send_notice_email(
            to_email, f"Lost and Found Office: {total} thing{'s' if total != 1 else ''} waiting for you",
            unsubscribe_url=unsubscribe_url, unsubscribe_label='the daily summary',
            title="Waiting for you today",
            preheader=f"{total} item{'s' if total != 1 else ''} need an administrator today.",
            eyebrow=date_text,
            greeting=f"Good morning {recipient_name or 'there'},",
            paragraphs=["Here is what is waiting for an administrator in E-Balik. Nothing is listed that does not need someone."],
            details=details,
            cta=("Open the admin console", site_url().rstrip('/') + '/admin/'),
            notes=notes,
            tone='default',
        )

    def send_claim_expired_email(self, to_email: str, recipient_name: str, item_name: str, claim_reference: str, deadline_text: str) -> bool:
        """The pickup window closed. Always sent: the claimant must know the claim is no longer open."""
        return self.send_notice_email(
            to_email, f"Your claim for {item_name} has closed",
            title="Your claim has closed",
            preheader=f"The pickup deadline for {item_name} has passed.",
            greeting=f"Hello {recipient_name or 'there'},",
            paragraphs=[
                f"The pickup deadline for \"{item_name}\" ({deadline_text}) passed, so your approved claim has been closed and your Handover PIN no longer works.",
                "If the item is still yours and you would like it back, you can submit a new claim in E-Balik while it is still in custody, and we will review it again.",
            ],
            details={'Item': item_name, 'Claim reference': claim_reference, 'Deadline': deadline_text},
            cta=("Open E-Balik", site_url()),
            notes=["Questions? Call 09478685684 or email ebaliksupport@gmail.com."],
            tone='danger',
        )

    def send_tag_expiry_reminder_email(self, to_email: str, recipient_name: str, item_name: str, tag_code: str,
                                       days_left: int, valid_until_text: str, unsubscribe_url: str = '') -> bool:
        """Smart Tag is about to expire. Optional (the reminders category)."""
        return self.send_notice_email(
            to_email, f"Your Smart Tag for {item_name} expires in {days_left} days",
            unsubscribe_url=unsubscribe_url, unsubscribe_label='Smart Tag reminders',
            title="Your Smart Tag is expiring soon",
            preheader=f"Valid until {valid_until_text}. Renew it so finders can still reach you.",
            greeting=f"Hello {recipient_name or 'there'},",
            paragraphs=[
                f"The Smart Tag on \"{item_name}\" is valid until {valid_until_text}. After that, anyone who scans it will only be told that it expired, and they will not be able to reach you.",
                "To renew it, bring the item to the Lost and Found Office. Staff will extend it for you.",
            ],
            details={'Item': item_name, 'Tag code': tag_code, 'Valid until': valid_until_text, 'Time left': f"{days_left} day{'s' if days_left != 1 else ''}"},
            cta=("Open My Smart Tags", site_url()),
            notes=["This is a courtesy reminder. Your tag keeps working until the date above."],
            tone='warning',
        )

    def send_announcement_email(self, to_email: str, first_name: str, subject: str, body: str, unsubscribe_url: str = '') -> bool:
        """A message written by an administrator. Everything is escaped, and no attachment is ever added."""
        if not to_email:
            return False
        return self.send_notice_email(
            to_email, subject,
            title=subject,
            preheader=str(body).strip().split('\n')[0][:140],
            greeting=f"Hello {first_name or 'there'},",
            paragraphs=[line for line in str(body).split('\n') if line.strip()],
            cta=("Open E-Balik", site_url()),
            notes=["This message was sent by the E-Balik administrators."],
            unsubscribe_url=unsubscribe_url, unsubscribe_label='announcements',
        )

    def send_test_email(self, to_email: str, first_name: str = '') -> tuple:
        """(ok, plain-language detail, provider status code). Used by Mission Control to prove the email service works."""
        try:
            html, text = render_email(
                title="Email is working",
                preheader="This is a test message from E-Balik Mission Control.",
                greeting=f"Hello {first_name or 'there'},",
                paragraphs=["This is a test message from E-Balik Mission Control. If you can read it, the email service is working."],
                details={'Sent': datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")},
                tone='success',
            )
            name = provider_name() or 'The email provider'
            if self.provider == 'brevo':
                self._send_brevo(to_email, 'E-Balik email test', html, text)
                return True, 'Brevo accepted the message. Check your inbox (and spam) in a minute.', 201
            response = self.sg.send(Mail(from_email=self.from_email, to_emails=to_email, subject='E-Balik email test', html_content=html, plain_text_content=text))
            status = int(response.status_code)
            if 200 <= status < 300:
                return True, 'SendGrid accepted the message. Check your inbox (and spam) in a minute.', status
            return False, f'SendGrid answered with status {status}.', status
        except Exception as error:
            status = getattr(error, 'status_code', None)
            name = provider_name() or 'The email provider'
            key = 'BREVO_API_KEY' if self.provider == 'brevo' else 'SENDGRID_API_KEY'
            reason = {401: f'The API key was rejected (401). Check {key}; an expired trial or a revoked key gives this answer.', 403: f'{name} refused the sender (403). Verify the sender address in {name}.'}.get(status)
            return False, reason or f'The email could not be sent: {str(error)[:160]}', status


def send_reference_email_best_effort(**email_data) -> bool:
    """Send a reference email without allowing email configuration to undo saved app data."""
    try:
        return EmailService().send_reference_email(**email_data)
    except Exception as error:
        logger.exception('Reference email service is unavailable: %s', error)
        return False


def send_notice_email_best_effort(to_email: str, subject: str, **layout) -> bool:
    """Send a premium notice without letting an email problem undo saved app data."""
    try:
        return EmailService().send_notice_email(to_email, subject, **layout)
    except Exception as error:
        logger.exception('Notice email service is unavailable: %s', error)
        return False


class OTPGenerator:
    """OTP generation and validation"""
    
    @staticmethod
    def generate_otp(length: int = 6) -> str:
        """Generate a random 6-digit OTP"""
        return ''.join(random.choices(string.digits, k=length))

    @staticmethod
    def get_otp_expiration(minutes: int = 10) -> str:
        """Get expiration timestamp in UTC ISO format."""
        expiration = datetime.now(timezone.utc) + timedelta(minutes=minutes)
        return expiration.isoformat().replace('+00:00', 'Z')

    @staticmethod
    def is_otp_expired(expires_at: str) -> bool:
        """Check if OTP is expired."""
        try:
            if not expires_at:
                return True

            normalized = expires_at.replace('Z', '+00:00') if expires_at.endswith('Z') else expires_at
            expiration_time = datetime.fromisoformat(normalized)

            if expiration_time.tzinfo is None:
                expiration_time = expiration_time.replace(tzinfo=timezone.utc)
            else:
                expiration_time = expiration_time.astimezone(timezone.utc)

            return datetime.now(timezone.utc) > expiration_time
        except Exception as e:
            logger.error(f"Error checking OTP expiration: {e}")
            return True
