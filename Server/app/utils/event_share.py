"""Read-only event entry QR codes. No Smart Tag, claim or storage operations."""
import base64
import io
import ipaddress
import os
import re
from urllib.parse import urlsplit
import qrcode
from qrcode.constants import ERROR_CORRECT_Q
from app.utils.events import EventFoundation, EventError
from app.utils.event_reports import EventReports


def event_origin():
    configured = (os.getenv('PUBLIC_SITE_URL') or '').strip()
    base = configured or 'http://localhost:5173'
    try:
        parts = urlsplit(base)
        host, port = parts.hostname, parts.port
        if (len(base) > 300 or re.search(r'[\s\\\x00-\x1f]', base) or parts.scheme not in ('http', 'https')
                or not host or parts.username is not None or parts.password is not None
                or parts.path not in ('', '/') or parts.query or parts.fragment
                or '%' in parts.netloc or not re.fullmatch(r'[a-zA-Z0-9.:-]+', host)):
            raise ValueError('Invalid attendee origin')
        if port is not None and not 1 <= port <= 65535:
            raise ValueError('Invalid attendee port')
        try:
            address = ipaddress.ip_address(host)
            local = address.is_loopback or address.is_unspecified
        except ValueError:
            local = host == 'localhost' or host.endswith('.localhost')
        origin = f'{parts.scheme}://{parts.netloc}'.rstrip('/')
        if not configured or local:
            return origin, False, 'This preview uses a local address. Set PUBLIC_SITE_URL on the backend to the attendee website origin before distributing posters.'
        if parts.scheme != 'https':
            return origin, False, 'Set PUBLIC_SITE_URL to the HTTPS attendee website origin before distributing posters.'
        return origin, True, ''
    except ValueError:
        raise EventError('PUBLIC_SITE_URL must be an HTTP(S) website origin without a path, credentials, query or fragment.', 503, 'event_share_url_invalid') from None


def entry_qr(url):
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_Q, box_size=12, border=4)
    qr.add_data(url)
    qr.make(fit=True)
    output = io.BytesIO()
    qr.make_image(fill_color='black', back_color='white').save(output, format='PNG')
    return output.getvalue()


class EventShare:
    def __init__(self, db):
        self.events, self.reports = EventFoundation(db), EventReports(db)

    def view(self, identifier):
        self.reports.require_setup()
        row = self.events.get(identifier)
        origin, ready, reason = event_origin()
        url = origin + '/events/' + row['slug']
        opened = self.reports.open(row)
        fields = ('event_id', 'slug', 'name', 'organizer_name', 'venue', 'desk_instructions', 'recovery_ends_at', 'branding', 'status', 'version')
        return {'event': {key: row.get(key) for key in fields}, 'url': url,
                'qr_image': 'data:image/png;base64,' + base64.b64encode(entry_qr(url)).decode('ascii'),
                'portal_open': opened, 'url_ready': ready, 'share_ready': ready and opened,
                'reason': reason or ('' if opened else 'Start the event and open its attendee page before downloading or printing for attendees.')}
