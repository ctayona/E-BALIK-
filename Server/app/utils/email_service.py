"""
Email and OTP utilities using SendGrid
"""
import random
import string
from html import escape
from datetime import datetime, timedelta, timezone
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail, Email, To, Content
from config import Config
import logging
from typing import Dict, Optional

logger = logging.getLogger(__name__)

class EmailService:
    """SendGrid email service"""
    
    def __init__(self):
        try:
            self.sg = SendGridAPIClient(Config.SENDGRID_API_KEY)
            self.from_email = Config.SENDGRID_FROM_EMAIL
            logger.info("✓ SendGrid email service initialized")
        except Exception as e:
            logger.error(f"✗ Failed to initialize SendGrid: {e}")
            raise

    def send_otp_email(self, to_email: str, otp_code: str, otp_type: str = "registration") -> bool:
        """
        Send OTP via email
        
        otp_type: 'registration' or 'password_reset'
        """
        try:
            subject = "E-Balik Account Verification" if otp_type == "registration" else "E-Balik Password Reset"
            
            if otp_type == "registration":
                html_content = f"""
                <html>
                    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                            <div style="text-align: center; margin-bottom: 30px;">
                                <h1 style="color: #1f3160;">E-Balik Lost & Found</h1>
                                <p style="color: #d1a153;">University of Makati</p>
                            </div>
                            
                            <h2 style="color: #1f3160;">Welcome to E-Balik!</h2>
                            <p>Thank you for creating your account. To complete your registration, please use the following verification code:</p>
                            
                            <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; text-align: center; margin: 30px 0;">
                                <p style="font-size: 14px; color: #475569; margin: 0;">Verification Code</p>
                                <p style="font-size: 32px; font-weight: bold; color: #1f3160; margin: 10px 0; letter-spacing: 5px;">{otp_code}</p>
                            </div>
                            
                            <p style="color: #475569;">This code will expire in 10 minutes.</p>
                            <p style="color: #475569;">If you didn't create this account, please ignore this email.</p>
                            
                            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
                            
                            <p style="font-size: 12px; color: #94a3b8; text-align: center;">
                                © 2026 University of Makati. All rights reserved.
                            </p>
                        </div>
                    </body>
                </html>
                """
            else:  # password_reset
                html_content = f"""
                <html>
                    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                            <div style="text-align: center; margin-bottom: 30px;">
                                <h1 style="color: #1f3160;">E-Balik Lost & Found</h1>
                                <p style="color: #d1a153;">University of Makati</p>
                            </div>
                            
                            <h2 style="color: #1f3160;">Password Reset Request</h2>
                            <p>We received a request to reset your password. Use the verification code below to proceed:</p>
                            
                            <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; text-align: center; margin: 30px 0;">
                                <p style="font-size: 14px; color: #475569; margin: 0;">Verification Code</p>
                                <p style="font-size: 32px; font-weight: bold; color: #1f3160; margin: 10px 0; letter-spacing: 5px;">{otp_code}</p>
                            </div>
                            
                            <p style="color: #475569;">This code will expire in 10 minutes.</p>
                            <p style="color: #475569;">If you didn't request a password reset, please ignore this email and your password will remain unchanged.</p>
                            
                            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
                            
                            <p style="font-size: 12px; color: #94a3b8; text-align: center;">
                                © 2026 University of Makati. All rights reserved.
                            </p>
                        </div>
                    </body>
                </html>
                """
            
            message = Mail(
                from_email=self.from_email,
                to_emails=to_email,
                subject=subject,
                html_content=html_content
            )
            
            response = self.sg.send(message)
            logger.info(f"✓ OTP email sent to {to_email}")
            return True
        except Exception as e:
            logger.error(f"✗ Failed to send email to {to_email}: {e}")
            return False

    def send_welcome_email(self, to_email: str, first_name: str) -> bool:
        """Send welcome email after successful registration"""
        try:
            subject = "Welcome to E-Balik - University of Makati"
            html_content = f"""
            <html>
                <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                    <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                        <div style="text-align: center; margin-bottom: 30px;">
                            <h1 style="color: #1f3160;">E-Balik Lost & Found</h1>
                            <p style="color: #d1a153;">University of Makati</p>
                        </div>
                        
                        <h2 style="color: #1f3160;">Welcome, {first_name}!</h2>
                        <p>Your account has been successfully created. You can now:</p>
                        
                        <ul style="color: #475569;">
                            <li>Report lost items and search for them</li>
                            <li>Post found items you've discovered on campus</li>
                            <li>Claim your lost items when found</li>
                        </ul>
                        
                        <p style="margin-top: 30px; color: #475569;">
                            If you have any questions, please don't hesitate to contact us.
                        </p>
                        
                        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
                        
                        <p style="font-size: 12px; color: #94a3b8; text-align: center;">
                            © 2026 University of Makati. All rights reserved.
                        </p>
                    </div>
                </body>
            </html>
            """
            
            message = Mail(
                from_email=self.from_email,
                to_emails=to_email,
                subject=subject,
                html_content=html_content
            )
            
            response = self.sg.send(message)
            logger.info(f"✓ Welcome email sent to {to_email}")
            return True
        except Exception as e:
            logger.error(f"✗ Failed to send welcome email: {e}")
            return False

    def send_reference_email(
        self,
        to_email: str,
        recipient_name: str,
        subject: str,
        summary: str,
        reference_label: str,
        reference: str,
        details: Optional[Dict[str, str]] = None,
    ) -> bool:
        """Send a safe reference/status email without including credentials or private attachments."""
        if not to_email:
            logger.warning('Skipping reference email because the account has no email address')
            return False

        try:
            safe_name = escape(recipient_name or 'there')
            safe_summary = escape(summary)
            safe_label = escape(reference_label)
            safe_reference = escape(reference or 'Unavailable')
            details_html = ''.join(
                f'<p style="margin:6px 0;color:#475569;"><strong>{escape(str(label))}:</strong> {escape(str(value))}</p>'
                for label, value in (details or {}).items()
                if value
            )
            html_content = f"""
            <html>
              <body style="font-family:Arial,sans-serif;line-height:1.6;color:#1f3160;background:#f4f6fb;padding:24px;">
                <div style="max-width:600px;margin:0 auto;padding:28px;border:1px solid #e2e8f0;border-radius:12px;background:#ffffff;">
                  <p style="margin:0;color:#b8893e;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">University of Makati</p>
                  <h1 style="margin:6px 0 24px;color:#1f3160;font-size:24px;">E-Balik Lost &amp; Found</h1>
                  <p>Hello {safe_name},</p>
                  <p>{safe_summary}</p>
                  <div style="margin:22px 0;padding:16px;border-radius:8px;background:#f1f5f9;">
                    <p style="margin:0 0 4px;color:#64748b;font-size:12px;">{safe_label}</p>
                    <p style="margin:0;color:#1f3160;font-size:20px;font-weight:bold;word-break:break-word;">{safe_reference}</p>
                  </div>
                  {details_html}
                  <p style="margin-top:24px;color:#64748b;font-size:13px;">You can review this record in your E-Balik account. Do not reply with passwords or verification codes.</p>
                  <hr style="margin:24px 0;border:0;border-top:1px solid #e2e8f0;" />
                  <p style="margin:0;color:#94a3b8;font-size:11px;text-align:center;">University of Makati · E-Balik Lost &amp; Found</p>
                </div>
              </body>
            </html>
            """
            response = self.sg.send(Mail(
                from_email=self.from_email,
                to_emails=to_email,
                subject=subject,
                html_content=html_content,
            ))
            if not 200 <= int(response.status_code) < 300:
                logger.error('SendGrid rejected reference email with status %s', response.status_code)
                return False
            logger.info('Reference email sent for %s', reference_label)
            return True
        except Exception as e:
            logger.exception('Failed to send reference email: %s', e)
            return False


def send_reference_email_best_effort(**email_data) -> bool:
    """Send a reference email without allowing email configuration to undo saved app data."""
    try:
        return EmailService().send_reference_email(**email_data)
    except Exception as error:
        logger.exception('Reference email service is unavailable: %s', error)
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
