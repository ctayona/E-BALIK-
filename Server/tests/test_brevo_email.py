"""Email goes through Brevo when BREVO_API_KEY is set (SendGrid's free trial ends), and through SendGrid otherwise."""
import io
import json
import unittest
import urllib.error
from unittest.mock import MagicMock, patch

from config import Config
from app.utils import email_service
from app.utils.email_service import EmailDeliveryError, EmailService


def brevo_config():
    return patch.multiple(Config, BREVO_API_KEY='xkeysib-test', BREVO_FROM_EMAIL='office@umak.test', EMAIL_FROM_NAME='E-Balik')


class FakeResponse:
    def __init__(self, status=201):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class BrevoTests(unittest.TestCase):
    def test_a_message_is_posted_to_brevo_with_the_key_and_sender(self):
        with brevo_config(), patch('urllib.request.urlopen', return_value=FakeResponse()) as opened:
            sent = EmailService().send_notice_email('maria@umak.edu.ph', 'Hello', title='Hi', paragraphs=['Body'])
        self.assertTrue(sent)
        request = opened.call_args.args[0]
        body = json.loads(request.data)
        self.assertEqual(request.full_url, 'https://api.brevo.com/v3/smtp/email')
        self.assertEqual(request.get_header('Api-key'), 'xkeysib-test')
        self.assertEqual((body['sender']['email'], body['to'], body['subject']), ('office@umak.test', [{'email': 'maria@umak.edu.ph'}], 'Hello'))
        self.assertIn('Body', body['htmlContent'])
        self.assertIn('Body', body['textContent'])

    def test_a_refusal_is_reported_as_not_sent_and_never_raises(self):
        error = urllib.error.HTTPError('u', 401, 'Unauthorized', {}, io.BytesIO(b'{"message":"Key not found"}'))
        with brevo_config(), patch('urllib.request.urlopen', side_effect=error):
            self.assertFalse(EmailService().send_notice_email('a@b.co', 'Hello', title='Hi', paragraphs=['x']))

    def test_the_test_email_explains_a_rejected_key(self):
        error = urllib.error.HTTPError('u', 401, 'Unauthorized', {}, io.BytesIO(b'{"message":"Key not found"}'))
        with brevo_config(), patch('urllib.request.urlopen', side_effect=error):
            ok, detail, status = EmailService().send_test_email('a@b.co')
        self.assertEqual((ok, status), (False, 401))
        self.assertIn('BREVO_API_KEY', detail)

    def test_the_test_email_succeeds(self):
        with brevo_config(), patch('urllib.request.urlopen', return_value=FakeResponse()):
            self.assertEqual(EmailService().send_test_email('a@b.co')[0], True)

    def test_a_missing_sender_stops_the_service_early(self):
        with patch.multiple(Config, BREVO_API_KEY='k', BREVO_FROM_EMAIL=None):
            with self.assertRaises(ValueError):
                EmailService()

    def test_sendgrid_is_still_used_when_only_its_key_is_set(self):
        with patch.multiple(Config, BREVO_API_KEY=None, SENDGRID_API_KEY='SG.x.y', SENDGRID_FROM_EMAIL='a@b.co'), patch.object(email_service, 'SendGridAPIClient') as client:
            client.return_value.send.return_value = MagicMock(status_code=202)
            self.assertTrue(EmailService().send_notice_email('a@b.co', 'Hello', title='Hi', paragraphs=['x']))
        client.return_value.send.assert_called_once()

    def test_provider_choice_prefers_brevo(self):
        with patch.multiple(Config, BREVO_API_KEY='k', SENDGRID_API_KEY='SG.x.y'):
            self.assertEqual(email_service.provider_key(), 'brevo')
        with patch.multiple(Config, BREVO_API_KEY=None, SENDGRID_API_KEY='SG.x.y'):
            self.assertEqual(email_service.provider_key(), 'sendgrid')
        with patch.multiple(Config, BREVO_API_KEY=None, SENDGRID_API_KEY=None):
            self.assertEqual(email_service.provider_key(), '')

if __name__ == '__main__':
    unittest.main()
