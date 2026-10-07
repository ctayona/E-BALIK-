"""
Email and OTP utilities using SendGrid. Message layout lives in email_templates.py.
"""
import random
import string
from datetime import datetime, timedelta, timezone
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail, Email, To, Content
from config import Config
from app.utils.email_templates import render_email, site_url
import logging
from typing import Dict, Optional

logger = logging.getLogger(__name__)

class EmailService:
    """SendGrid email service. Every message is built by `email_templates.render_email` (Navy and Gold HTML plus plain text)."""

    def __init__(self):
        try:
            self.sg = SendGridAPIClient(Config.SENDGRID_API_KEY)
            self.from_email = Config.SENDGRID_FROM_EMAIL
            logger.info("✓ SendGrid email service initialized")
        except Exception as e:
            logger.error(f"✗ Failed to initialize SendGrid: {e}")
            raise

    def _send(self, to_email: str, subject: str, html: str, text: str) -> bool:
        """Send one message with an HTML and a plain-text part. True only when SendGrid accepts it."""
        response = self.sg.send(Mail(
            from_email=self.from_email,
            to_emails=to_email,
            subject=subject,
            html_content=html,
            plain_text_content=text,
        ))
        return 200 <= int(response.status_code) < 300

    def send_notice_email(self, to_email: str, subject: str, **layout) -> bool:
        """Render a premium message (see `render_email` for the layout fields) and send it. Never raises."""
        if not to_email:
            logger.warning('Skipping email "%s": the account has no email address', subject)
            return False
        try:
            html, text = render_email(**layout)
            sent = self._send(to_email, subject, html, text)
            if not sent:
                logger.error('SendGrid rejected the email "%s"', subject)
            return sent
        except Exception as error:
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
                     'Where': 'Lost and Found Office, Admin Building (Ground Floor, OHSO Office)'},
            cta=("View Claim Status", site_url()),
            notes=["Approval online does not release the item by itself: the in-person check keeps your belongings safe. Questions? Call 09478685684."],
        )

    def send_announcement_email(self, to_email: str, first_name: str, subject: str, body: str) -> bool:
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
            response = self.sg.send(Mail(from_email=self.from_email, to_emails=to_email, subject='E-Balik email test', html_content=html, plain_text_content=text))
            status = int(response.status_code)
            if 200 <= status < 300:
                return True, 'SendGrid accepted the message. Check your inbox (and spam) in a minute.', status
            return False, f'SendGrid answered with status {status}.', status
        except Exception as error:
            status = getattr(error, 'status_code', None)
            reason = {401: 'The API key was rejected (401). Check SENDGRID_API_KEY.', 403: 'SendGrid refused the sender (403). Verify SENDGRID_FROM_EMAIL in SendGrid.'}.get(status)
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
