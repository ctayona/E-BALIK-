"""Smart Tags: QR stickers that link a physical item to its owner.

The public page is reachable by anyone who holds the sticker, so this module is strict about what leaves the server:
`public_view` builds its answer from an explicit allow-list, never from the database row.
"""
import calendar
import io
import logging
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# No 0/O or 1/I, so a code read off a sticker by eye cannot be mistaken. 32 symbols x 12 places is about 60 bits.
ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
TAG_LENGTH = 12
MAX_BATCH = 500
MAX_TAGS_PER_ACCOUNT = 25
FOUND_COOLDOWN_SECONDS = 300
MAX_ITEM_NAME = 120
MAX_DESCRIPTION = 500
MAX_FINDER_MESSAGE = 300
MAX_FINDER_CONTACT = 120
# The photo of the item with its sticker, taken live at registration. The bucket is private: finders get a short-lived signed link.
TAG_IMAGE_BUCKET = 'smart-tag-images'
MAX_PHOTO_BYTES = 5 * 1024 * 1024
PHOTO_URL_SECONDS = 600
# A tag a user has just registered, or whose photo they replaced, does nothing until staff have compared it with the real item.
PENDING = 'pending_verification'
_TAG_RE = re.compile(r'^[A-Z0-9]{10,12}$')
_PHONE_RE = re.compile(r'^\+?[0-9][0-9 ()\-]{5,18}[0-9]$')
_CONTROL_RE = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')

SURRENDER_INSTRUCTIONS = [
    'Keep the item safe and do not open, use or alter it.',
    'Bring it to the nearest OHSO guard post on campus as soon as you can.',
    'Tell the guard the Smart Tag code so the item can be logged and returned to its owner.',
    'The owner has already been notified. Please do not arrange a private meet-up.',
]


class TagError(Exception):
    """A business-rule failure with the HTTP status the route should return."""

    def __init__(self, message: str, status: int = 400, **extra: Any):
        super().__init__(message)
        self.message, self.status, self.extra = message, status, extra


class TagsUnavailable(Exception):
    """The smart_tags table has not been created yet."""


def _is_missing_schema(error: Exception) -> bool:
    text = str(error).lower()
    missing = any(m in text for m in ('does not exist', 'schema cache', 'could not find', 'pgrst205', 'pgrst204', '42p01', '42703'))
    return missing and ('smart_tags' in text or any(c in text for c in ('tag_type', 'validity_months', 'valid_until', 'batch_id', 'item_image_url', 'pending_image_url', 'prior_status', 'review_requested_at', 'verified_at', 'verification_note')))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# --------------------------------------------------------------------------------------------------- ids and text
def generate_tag_id() -> str:
    """A fresh unguessable code, drawn from the operating system's secure random source."""
    return ''.join(secrets.choice(ALPHABET) for _ in range(TAG_LENGTH))


def normalize_tag_id(raw: Any) -> Optional[str]:
    """Upper-case a scanned or typed code; None when it cannot be a tag code."""
    value = str(raw or '').strip().upper()
    return value if _TAG_RE.match(value) else None


def clean_text(value: Any, max_length: int, multiline: bool = False) -> str:
    """Plain text only: control characters and angle brackets are removed, whitespace is tidied, length is capped.

    The page renders text as text (React escapes it) and emails escape it too; removing markup characters here is a
    second line of defence for anything that might later be shown in a less careful place.
    """
    text = _CONTROL_RE.sub('', str(value or '')).replace('<', '').replace('>', '')
    if multiline:
        text = re.sub(r'[ \t]+', ' ', text.replace('\r', ''))
        text = re.sub(r'\n{3,}', '\n\n', text)
    else:
        text = re.sub(r'\s+', ' ', text)
    return text.strip()[:max_length]


def clean_phone(value: Any) -> str:
    text = re.sub(r'\s+', ' ', str(value or '')).strip()
    if not text:
        return ''
    if not _PHONE_RE.match(text):
        raise TagError('Enter a valid phone number, for example 0917 123 4567 or +63 917 123 4567.')
    return text


def sniff_image(data: bytes) -> Optional[tuple]:
    """(extension, mimetype) from the file's own bytes. The uploaded filename and content type are never trusted."""
    if data[:3] == b'\xff\xd8\xff':
        return 'jpg', 'image/jpeg'
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png', 'image/png'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'webp', 'image/webp'
    return None


def as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or '').strip().lower() in ('1', 'true', 'yes', 'on')


# ----------------------------------------------------------------------------------------- tag types and validity
# The medium a tag is printed or encoded on. Only QR is switched on today; RFID and NFC are fully supported by the
# schema and the generator, and are turned on later by setting SMART_TAG_TYPES_ENABLED=qr,rfid,nfc on the server.
TAG_TYPES = {'qr': 'QR Code', 'rfid': 'RFID', 'nfc': 'NFC'}
MAX_VALIDITY_MONTHS = 120
EXPIRY_WARNING_DAYS = 30
SCAN_WRITE_INTERVAL_SECONDS = 30


def enabled_tag_types() -> List[str]:
    configured = [t.strip().lower() for t in (os.getenv('SMART_TAG_TYPES_ENABLED') or 'qr').split(',')]
    return [t for t in configured if t in TAG_TYPES] or ['qr']


def tag_type_options() -> List[Dict[str, Any]]:
    enabled = enabled_tag_types()
    return [{'value': key, 'label': label, 'enabled': key in enabled} for key, label in TAG_TYPES.items()]


def parse_validity(value: Any) -> Optional[int]:
    """Months a tag stays valid after its owner registers it. Empty means it never expires."""
    if value is None or str(value).strip().lower() in ('', '0', 'never', 'none', 'null'):
        return None
    try:
        months = int(value)
    except (TypeError, ValueError):
        raise TagError('Enter the validity as a whole number of months, or choose "Never expires".')
    if months < 1 or months > MAX_VALIDITY_MONTHS:
        raise TagError(f'Validity must be between 1 and {MAX_VALIDITY_MONTHS} months.')
    return months


def add_months(moment: datetime, months: int) -> datetime:
    """Calendar months later, keeping the day where possible (31 Jan + 1 month = 28 or 29 Feb)."""
    index = moment.month - 1 + months
    year, month = moment.year + index // 12, index % 12 + 1
    return moment.replace(year=year, month=month, day=min(moment.day, calendar.monthrange(year, month)[1]))


def days_left(valid_until: Any, now: Optional[datetime] = None) -> Optional[int]:
    until = _parse(valid_until)
    if not until:
        return None
    return int((until - (now or _now())).total_seconds() // 86400)


def encode_value(tag_type: str, tag_id: str) -> str:
    """What gets written onto the medium: a link for QR and NFC, the bare code for an RFID chip."""
    return tag_id if tag_type == 'rfid' else tag_url(tag_id)


def public_base_url() -> str:
    return (os.getenv('PUBLIC_SITE_URL') or 'http://localhost:5173').rstrip('/')


def tag_url(tag_id: str) -> str:
    return f'{public_base_url()}/tag/{tag_id}'


def url_check() -> Dict[str, Any]:
    """Is the address baked into new QR codes one that works for the public? A QR cannot be edited after printing."""
    base = public_base_url()
    local = bool(re.search(r'(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])', base, re.I))
    if not os.getenv('PUBLIC_SITE_URL'):
        return {'url': base, 'ok': False, 'reason': 'PUBLIC_SITE_URL is not set, so QR codes use the development address.'}
    if local:
        return {'url': base, 'ok': False, 'reason': 'This address only works on the computer running the server.'}
    if not base.startswith('https://'):
        return {'url': base, 'ok': False, 'reason': 'Use an https address so phones open the page without a warning.'}
    return {'url': base, 'ok': True, 'reason': ''}


def qr_png(tag_id: str) -> bytes:
    """PNG image of the QR code that points at the tag page."""
    import qrcode
    from qrcode.constants import ERROR_CORRECT_Q
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_Q, box_size=12, border=4)
    qr.add_data(tag_url(tag_id))
    qr.make(fit=True)
    buffer = io.BytesIO()
    qr.make_image(fill_color='#1f3160', back_color='white').save(buffer, format='PNG')
    return buffer.getvalue()


# --------------------------------------------------------------------------------------------------- service
class SmartTagService:
    def __init__(self, db):
        self.db = db
        self.client = db.client

    def _table(self):
        return self.client.table('smart_tags')

    def _guard(self, error: Exception):
        if _is_missing_schema(error):
            raise TagsUnavailable('Smart Tags are not set up yet. Run the 20261008_smart_tags.sql, 20261009_tag_expiry_and_auction_buyout.sql and 20261010_tag_photo_and_mission_control.sql migrations in Supabase.') from error
        raise error

    def _get(self, tag_id: str) -> Dict[str, Any]:
        try:
            rows = self._table().select('*').eq('tag_id', tag_id).limit(1).execute().data or []
        except Exception as error:
            self._guard(error)
        if not rows:
            raise TagError('This Smart Tag was not found.', 404)
        return rows[0]

    def _profile(self, account_id: Optional[str]) -> Optional[Dict[str, Any]]:
        if not account_id:
            return None
        user = self.db.get_user_by_account_id(str(account_id))
        if not user:
            return None
        decrypt = getattr(self.db, '_decrypt_profile_sensitive_fields', None)
        return (decrypt(user) if decrypt else None) or user

    @staticmethod
    def _name(profile: Optional[Dict[str, Any]]) -> str:
        return f"{(profile or {}).get('fname') or ''} {(profile or {}).get('lname') or ''}".strip()

    # ------------------------------------------------------------------ item photo
    def _store_photo(self, tag_id: str, photo: Optional[Dict[str, Any]]) -> str:
        """Validate and upload the live photo. Returns the storage path (what `item_image_url` holds)."""
        data = (photo or {}).get('data') or b''
        if not data:
            raise TagError('Take a photo of your item with the sticker attached. It must be taken with the camera right now.', 400, code='photo_required')
        if len(data) > MAX_PHOTO_BYTES:
            raise TagError('The photo is too large. Take it again; it must be 5 MB or smaller.', 400, code='photo_too_large')
        kind = sniff_image(data)
        if not kind:
            raise TagError('That file is not a photo. Take a picture with the camera.', 400, code='photo_invalid')
        path = f'{tag_id}/{uuid.uuid4().hex}.{kind[0]}'
        try:
            self.client.storage.from_(TAG_IMAGE_BUCKET).upload(path, data, {'content-type': kind[1], 'upsert': 'false'})
        except Exception as error:
            logger.warning('Smart tag photo upload failed: %s', error)
            raise TagError('The photo could not be saved. Check your connection and try again.', 502, code='photo_upload_failed')
        return path

    def _remove_photo(self, path: Optional[str]) -> None:
        if not path:
            return
        try:
            self.client.storage.from_(TAG_IMAGE_BUCKET).remove([path])
        except Exception as error:
            logger.warning('Smart tag photo cleanup failed: %s', error)

    def _photo_url(self, path: Optional[str]) -> Optional[str]:
        """A signed link that works for ten minutes. The raw storage path is never sent to a browser."""
        if not path or str(path).startswith(('http://', 'https://', 'data:')):
            return None
        try:
            result = self.client.storage.from_(TAG_IMAGE_BUCKET).create_signed_url(path, PHOTO_URL_SECONDS)
            if isinstance(result, dict):
                return result.get('signedURL') or result.get('signedUrl') or result.get('signed_url')
        except Exception as error:
            logger.warning('Smart tag photo link failed: %s', error)
        return None

    def _owner(self, row: Dict[str, Any]) -> Dict[str, Any]:
        # While a new photo waits for approval the owner sees it (it is what they took); finders see nothing at all.
        return {**self.owner_view(row), 'photo_url': self._photo_url(row.get('pending_image_url') or row.get('item_image_url'))}

    def set_photo(self, raw_tag_id: Any, account_id: str, photo: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """Replace the photo of a tag you own (also how tags registered before photos existed get one)."""
        tag_id = normalize_tag_id(raw_tag_id)
        if not tag_id:
            raise TagError('This Smart Tag was not found.', 404)
        tag = self._refresh(self._get(tag_id))
        if str(tag.get('owner_account_id')) != str(account_id):
            raise TagError('This Smart Tag was not found.', 404)
        if tag.get('is_disabled'):
            raise TagError('This Smart Tag was deactivated by an administrator, so it cannot be changed.', 403)
        if tag.get('status') == 'expired':
            raise TagError('This Smart Tag has expired. Ask the Lost and Found Office to renew it.', 403, code='expired')
        if tag.get('status') == 'blank':
            raise TagError('This Smart Tag is not registered yet.', 409)
        status = tag.get('status')
        now = _iso(_now())
        first_review = status == PENDING and not tag.get('prior_status')  # nothing has ever been approved: just replace the submitted photo
        path = self._store_photo(tag_id, photo)
        if first_review:
            changes = {'item_image_url': path, 'review_requested_at': now, 'updated_at': now}
            replaced = tag.get('item_image_url')
        else:
            # A new photo of an approved tag takes it out of service until staff approve the new picture. The approved
            # photo stays in place so a rejection can put everything back.
            changes = {'pending_image_url': path, 'status': PENDING, 'prior_status': tag.get('prior_status') or status, 'review_requested_at': now, 'updated_at': now}
            replaced = tag.get('pending_image_url')
        try:
            rows = self._table().update(changes).eq('tag_id', tag_id).eq('owner_account_id', account_id).eq('status', status).eq('is_disabled', False).execute().data or []
        except Exception as error:
            self._remove_photo(path)
            self._guard(error)
        if not rows:
            self._remove_photo(path)
            raise TagError('The tag changed while you were editing it. Reload and try again.', 409)
        self._remove_photo(replaced)
        self._log(account_id, 'Update Smart Tag Photo', rows[0])
        return self._owner(rows[0])

    def admin_photo_url(self, raw_tag_id: Any) -> Optional[str]:
        tag_id = normalize_tag_id(raw_tag_id)
        if not tag_id:
            raise TagError('This Smart Tag was not found.', 404)
        return self._photo_url(self._get(tag_id).get('item_image_url'))

    # ------------------------------------------------------------------ expiry and visit statistics
    def _refresh(self, tag: Dict[str, Any]) -> Dict[str, Any]:
        """A registered tag past its valid_until becomes 'expired' the moment anyone looks at it."""
        until = _parse(tag.get('valid_until'))
        if tag.get('status') in ('active', 'lost') and until and until <= _now():
            try:
                rows = self._table().update({'status': 'expired', 'updated_at': _iso(_now())}).eq('tag_id', tag['tag_id']).in_('status', ['active', 'lost']).execute().data or []
            except Exception as error:
                self._guard(error)
            return rows[0] if rows else {**tag, 'status': 'expired'}
        return tag

    def _expire_due(self) -> None:
        """Expire every tag that is past its date, so lists and counts are right without waiting for a scan."""
        try:
            self._table().update({'status': 'expired', 'updated_at': _iso(_now())}).in_('status', ['active', 'lost']).lt('valid_until', _iso(_now())).execute()
        except Exception as error:
            if not _is_missing_schema(error):
                logger.warning('Expiring due tags failed: %s', error)

    def _record_scan(self, tag: Dict[str, Any]) -> None:
        """Visit statistics for the admin. Best effort and at most one write every 30 seconds per tag."""
        last = _parse(tag.get('last_scanned_at'))
        now = _now()
        if last and (now - last).total_seconds() < SCAN_WRITE_INTERVAL_SECONDS:
            return
        try:
            self._table().update({'scan_count': int(tag.get('scan_count') or 0) + 1, 'last_scanned_at': _iso(now)}).eq('tag_id', tag['tag_id']).execute()
        except Exception as error:
            logger.debug('Scan statistics skipped: %s', error)

    # ------------------------------------------------------------------ public page
    def public_view(self, raw_tag_id: Any, viewer_id: Optional[str] = None) -> Dict[str, Any]:
        """What anyone holding the sticker may see. Built field by field from an allow-list."""
        tag_id = normalize_tag_id(raw_tag_id)
        if not tag_id:
            raise TagError('This Smart Tag was not found.', 404)
        tag = self._refresh(self._get(tag_id))
        if tag.get('status') != 'blank':
            self._record_scan(tag)
        if tag.get('is_disabled'):
            return {'tag_id': tag_id, 'status': 'disabled'}
        if tag.get('status') == 'blank':
            return {'tag_id': tag_id, 'status': 'blank'}
        if tag.get('status') == 'expired':
            return {'tag_id': tag_id, 'status': 'expired'}
        if tag.get('status') == PENDING:
            # Not verified by staff yet: no item, owner or photo. Only the owner is told it is theirs.
            return {'tag_id': tag_id, 'status': PENDING, 'is_owner': bool(viewer_id) and str(tag.get('owner_account_id')) == str(viewer_id)}
        owner = self._profile(tag.get('owner_account_id'))
        if not owner:
            return {'tag_id': tag_id, 'status': 'inactive'}
        contact: Dict[str, str] = {}
        if tag.get('show_name') and self._name(owner):
            contact['name'] = self._name(owner)
        if tag.get('show_email') and owner.get('email'):
            contact['email'] = str(owner['email'])
        if tag.get('show_phone') and tag.get('contact_phone'):
            contact['phone'] = str(tag['contact_phone'])
        return {
            'tag_id': tag_id,
            'status': 'lost' if tag.get('status') == 'lost' else 'active',
            'item_name': tag.get('item_name') or 'Registered item',
            'item_description': tag.get('item_description') or '',
            'photo_url': self._photo_url(tag.get('item_image_url')),
            'contact': contact,
            'is_owner': bool(viewer_id) and str(tag.get('owner_account_id')) == str(viewer_id),
        }

    # ------------------------------------------------------------------ owner
    @staticmethod
    def owner_view(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            'tag_id': row['tag_id'], 'status': row.get('status'), 'item_name': row.get('item_name') or '',
            'item_description': row.get('item_description') or '', 'show_name': bool(row.get('show_name')),
            'show_email': bool(row.get('show_email')), 'show_phone': bool(row.get('show_phone')),
            'contact_phone': row.get('contact_phone') or '', 'is_disabled': bool(row.get('is_disabled')),
            'disabled_reason': row.get('disabled_reason') if row.get('is_disabled') else None,
            'claimed_at': row.get('claimed_at'), 'found_notice_count': int(row.get('found_notice_count') or 0),
            'last_found_notice_at': row.get('last_found_notice_at'), 'url': tag_url(row['tag_id']),
            'tag_type': row.get('tag_type') or 'qr', 'validity_months': row.get('validity_months'), 'valid_until': row.get('valid_until'),
            'days_left': days_left(row.get('valid_until')) if row.get('status') in ('active', 'lost') else None,
            'item_name_locked': True,  # the item name can never be edited by its owner after registration
            'awaiting_approval': row.get('status') == PENDING,
            'photo_pending': bool(row.get('pending_image_url')),
            'is_reregistration': bool(row.get('prior_status')),
        }

    def my_tags(self, account_id: str) -> List[Dict[str, Any]]:
        self._expire_due()
        try:
            rows = self._table().select('*').eq('owner_account_id', account_id).order('claimed_at', desc=True).limit(100).execute().data or []
        except Exception as error:
            self._guard(error)
        return [self._owner(r) for r in rows]

    def _details(self, payload: Dict[str, Any], current: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Validate the fields an owner may set. With `current`, only the fields present in the payload change."""
        changes: Dict[str, Any] = {}
        partial = current is not None
        if not partial or 'item_name' in payload:
            name = clean_text(payload.get('item_name'), MAX_ITEM_NAME)
            if len(name) < 2:
                raise TagError('Enter what this tag is attached to, for example "My black Dell laptop".')
            changes['item_name'] = name
        if not partial or 'item_description' in payload:
            changes['item_description'] = clean_text(payload.get('item_description'), MAX_DESCRIPTION, multiline=True) or None
        for key in ('show_name', 'show_email', 'show_phone'):
            if not partial or key in payload:
                changes[key] = as_bool(payload.get(key))
        if not partial or 'contact_phone' in payload:
            changes['contact_phone'] = clean_phone(payload.get('contact_phone')) or None
        phone = changes['contact_phone'] if 'contact_phone' in changes else (current or {}).get('contact_phone')
        shows_phone = changes['show_phone'] if 'show_phone' in changes else bool((current or {}).get('show_phone'))
        if shows_phone and not phone:
            raise TagError('Add a phone number first, or switch "Show my phone number" off.')
        return changes

    def claim(self, raw_tag_id: Any, account_id: str, payload: Dict[str, Any], photo: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        tag_id = normalize_tag_id(raw_tag_id)
        if not tag_id:
            raise TagError('This Smart Tag was not found.', 404)
        if not as_bool(payload.get('dpa_consent')):
            raise TagError('You must agree to the Data Privacy Notice (Data Privacy Act of 2012) before registering a tag.', 400, code='dpa_required')
        fields = self._details(payload)
        try:
            owned = self._table().select('tag_id', count='exact').eq('owner_account_id', account_id).limit(1).execute()
        except Exception as error:
            self._guard(error)
        if int(owned.count or 0) >= MAX_TAGS_PER_ACCOUNT:
            raise TagError(f'You can register up to {MAX_TAGS_PER_ACCOUNT} Smart Tags.', 409)
        current = self._get(tag_id)  # 404 for a code that was never generated
        if current.get('status') != 'blank' or current.get('owner_account_id') or current.get('is_disabled'):
            # Do not store a photo for a sticker somebody else already owns.
            if current.get('is_disabled'):
                raise TagError('This Smart Tag has been deactivated and cannot be registered.', 403)
            raise TagError('This Smart Tag is already registered to someone.', 409, code='already_claimed')
        photo_path = self._store_photo(tag_id, photo)
        moment = _now()
        now = _iso(moment)
        # Registration only submits the tag. Staff verify the item in person, and the validity period starts at that approval.
        # One atomic statement: it only succeeds while the tag is still blank, unowned and not disabled,
        # so two people (or two clicks) can never both claim the same sticker.
        try:
            rows = self._table().update({**fields, 'item_image_url': photo_path, 'owner_account_id': account_id, 'status': PENDING, 'prior_status': None, 'review_requested_at': now, 'claimed_at': now, 'updated_at': now}) \
                .eq('tag_id', tag_id).eq('status', 'blank').is_('owner_account_id', 'null').eq('is_disabled', False).execute().data or []
        except Exception as error:
            self._remove_photo(photo_path)
            self._guard(error)
        if not rows:
            self._remove_photo(photo_path)  # lost the race: nobody keeps this photo
            existing = self._get(tag_id)  # 404 when the code does not exist
            if existing.get('is_disabled'):
                raise TagError('This Smart Tag has been deactivated and cannot be registered.', 403)
            raise TagError('This Smart Tag is already registered to someone.', 409, code='already_claimed')
        self._log(account_id, 'Register Smart Tag', rows[0])
        return self._owner(rows[0])

    def update(self, raw_tag_id: Any, account_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        tag_id = normalize_tag_id(raw_tag_id)
        if not tag_id:
            raise TagError('This Smart Tag was not found.', 404)
        tag = self._refresh(self._get(tag_id))
        if str(tag.get('owner_account_id')) != str(account_id):
            raise TagError('This Smart Tag was not found.', 404)  # same answer as a missing tag: do not reveal other owners' tags
        if tag.get('is_disabled'):
            raise TagError('This Smart Tag was deactivated by an administrator, so it cannot be changed.', 403)
        if tag.get('status') == 'expired':
            raise TagError('This Smart Tag has expired. Ask the Lost and Found Office to renew it.', 403, code='expired')
        if 'item_name' in payload and clean_text(payload.get('item_name'), MAX_ITEM_NAME) != (tag.get('item_name') or ''):
            raise TagError('The item name cannot be changed after a tag is registered. This stops a sticker from being moved to a different item. If the name is wrong, ask the Lost and Found Office.', 403, code='item_locked')
        changes = self._details({key: value for key, value in payload.items() if key != 'item_name'}, current=tag)
        if 'status' in payload:
            if tag.get('status') == PENDING:
                raise TagError('This tag is waiting for staff approval. You can mark it lost or found once it is approved.', 409, code='pending')
            status = str(payload.get('status') or '').strip().lower()
            if status not in ('active', 'lost'):
                raise TagError('A tag can be marked active or lost.')
            changes['status'] = status
        if not changes:
            raise TagError('Nothing to change.')
        changes['updated_at'] = _iso(_now())
        try:
            rows = self._table().update(changes).eq('tag_id', tag_id).eq('owner_account_id', account_id).eq('is_disabled', False).execute().data or []
        except Exception as error:
            self._guard(error)
        if not rows:
            raise TagError('The tag changed while you were editing it. Reload and try again.', 409)
        if 'status' in changes and changes['status'] != tag.get('status'):
            self._log(account_id, 'Mark Smart Tag Lost' if changes['status'] == 'lost' else 'Mark Smart Tag Found', rows[0])
        return self._owner(rows[0])

    # ------------------------------------------------------------------ staff verification
    def admin_photos(self, raw_tag_id: Any) -> Dict[str, Any]:
        """The photo staff must compare with the real item, and the previously approved one when a new photo is waiting."""
        tag_id = normalize_tag_id(raw_tag_id)
        if not tag_id:
            raise TagError('This Smart Tag was not found.', 404)
        tag = self._get(tag_id)
        pending = tag.get('pending_image_url')
        return {
            'url': self._photo_url(pending or tag.get('item_image_url')),
            'previous_url': self._photo_url(tag.get('item_image_url')) if pending else None,
            'is_new_photo': bool(pending),
        }

    def _notify(self, owner_id: Any, title: str, message: str, kind: str) -> None:
        if not owner_id:
            return
        try:
            self.db.create_user_notification(str(owner_id), title, message, notification_type=kind, link_label='View my Smart Tags', link_page='my-tags')
        except Exception as error:
            logger.warning('Smart tag verification notice failed: %s', error)

    def approve(self, raw_tag_id: Any, admin_id: str) -> Dict[str, Any]:
        """Staff compared the screen with the item in front of them. The tag goes live (a new photo replaces the old one)."""
        tag_id = normalize_tag_id(raw_tag_id)
        if not tag_id:
            raise TagError('This Smart Tag was not found.', 404)
        tag = self._get(tag_id)
        if tag.get('status') != PENDING:
            raise TagError('This tag is not waiting for approval.', 409, code='not_pending')
        moment = _now()
        now = _iso(moment)
        changes: Dict[str, Any] = {'status': tag.get('prior_status') or 'active', 'prior_status': None, 'review_requested_at': None,
                                   'verified_at': now, 'verified_by': admin_id, 'verification_note': None, 'updated_at': now}
        replaced = None
        if tag.get('pending_image_url'):
            changes.update({'item_image_url': tag['pending_image_url'], 'pending_image_url': None})
            replaced = tag.get('item_image_url')
        months = tag.get('validity_months')
        if not tag.get('prior_status') and months:
            changes['valid_until'] = _iso(add_months(moment, int(months)))  # the validity period starts at this in-person approval
        try:
            rows = self._table().update(changes).eq('tag_id', tag_id).eq('status', PENDING).execute().data or []
        except Exception as error:
            self._guard(error)
        if not rows:
            raise TagError('Someone else just reviewed this tag. Reload the list.', 409, code='not_pending')
        self._remove_photo(replaced)
        self._notify(tag.get('owner_account_id'), 'Smart Tag approved',
                     f'Staff verified your Smart Tag for "{tag.get("item_name") or "your item"}". It is active now and finders can see what you chose to share.', 'smart_tag_approved')
        return rows[0]

    def reject(self, raw_tag_id: Any, reason: Any, admin_id: str) -> Dict[str, Any]:
        """A new registration is cleared so the sticker can be registered again; a rejected new photo just returns to the old one."""
        tag_id = normalize_tag_id(raw_tag_id)
        if not tag_id:
            raise TagError('This Smart Tag was not found.', 404)
        note = clean_text(reason, 300)
        if len(note) < 3:
            raise TagError('Give a short reason. The owner is told why.')
        tag = self._get(tag_id)
        if tag.get('status') != PENDING:
            raise TagError('This tag is not waiting for approval.', 409, code='not_pending')
        now = _iso(_now())
        owner_id = tag.get('owner_account_id')
        item = tag.get('item_name') or 'your item'
        if tag.get('prior_status'):
            changes = {'status': tag['prior_status'], 'pending_image_url': None, 'prior_status': None, 'review_requested_at': None,
                       'verification_note': note, 'updated_at': now}
            discard = tag.get('pending_image_url')
            message = f'Staff did not approve the new photo for "{item}". Reason: {note} Your previous photo and your tag are active again.'
        else:
            changes = {'status': 'blank', 'owner_account_id': None, 'item_name': None, 'item_description': None, 'show_name': False, 'show_email': False,
                       'show_phone': False, 'contact_phone': None, 'item_image_url': None, 'pending_image_url': None, 'claimed_at': None, 'valid_until': None,
                       'prior_status': None, 'review_requested_at': None, 'verification_note': note, 'updated_at': now}
            discard = tag.get('item_image_url')
            message = f'Staff could not verify your Smart Tag registration for "{item}". Reason: {note} The sticker is free again; bring the item to the Lost and Found Office and register it again.'
        try:
            rows = self._table().update(changes).eq('tag_id', tag_id).eq('status', PENDING).execute().data or []
        except Exception as error:
            self._guard(error)
        if not rows:
            raise TagError('Someone else just reviewed this tag. Reload the list.', 409, code='not_pending')
        self._remove_photo(discard)
        self._notify(owner_id, 'Smart Tag not approved', message, 'smart_tag_rejected')
        return rows[0]

    def admin_update(self, raw_tag_id: Any, payload: Dict[str, Any], photo: Optional[Dict[str, Any]], admin_id: str) -> Dict[str, Any]:
        """Staff may change every field of a registered tag, including the item name and the photo, without triggering approval."""
        tag_id = normalize_tag_id(raw_tag_id)
        if not tag_id:
            raise TagError('This Smart Tag was not found.', 404)
        tag = self._get(tag_id)
        if tag.get('status') == 'blank' or not tag.get('owner_account_id'):
            raise TagError('Only a registered tag can be edited.', 409)
        keys = ('item_name', 'item_description', 'show_name', 'show_email', 'show_phone', 'contact_phone')
        changes = self._details({key: payload[key] for key in keys if key in payload}, current=tag)
        path = None
        if photo and photo.get('data'):
            path = self._store_photo(tag_id, photo)
            changes.update({'item_image_url': path, 'pending_image_url': None})
        if not changes:
            raise TagError('Nothing to change.')
        changes['updated_at'] = _iso(_now())
        try:
            rows = self._table().update(changes).eq('tag_id', tag_id).execute().data or []
        except Exception as error:
            self._remove_photo(path)
            self._guard(error)
        if not rows:
            self._remove_photo(path)
            raise TagError('The tag changed while you were editing it. Reload and try again.', 409)
        if path:
            self._remove_photo(tag.get('item_image_url'))
            self._remove_photo(tag.get('pending_image_url'))
        self._notify(tag.get('owner_account_id'), 'Smart Tag updated by staff', f'Staff updated the details of your Smart Tag for "{rows[0].get("item_name") or "your item"}".', 'smart_tag_updated')
        return rows[0]

    # ------------------------------------------------------------------ finder
    def report_found(self, raw_tag_id: Any, message: Any = '', finder_contact: Any = '') -> Dict[str, Any]:
        """A finder pressed "I found this item". Tell the owner (in the app and by email) at most once per cooldown."""
        tag_id = normalize_tag_id(raw_tag_id)
        if not tag_id:
            raise TagError('This Smart Tag was not found.', 404)
        tag = self._refresh(self._get(tag_id))
        if tag.get('is_disabled') or tag.get('status') in ('blank', 'expired', PENDING) or not tag.get('owner_account_id'):
            raise TagError('This Smart Tag is not active, so the owner cannot be notified.', 409)
        note = clean_text(message, MAX_FINDER_MESSAGE, multiline=True)
        contact = clean_text(finder_contact, MAX_FINDER_CONTACT)
        now = _now()
        last = _parse(tag.get('last_found_notice_at'))
        result = {'tag_id': tag_id, 'notified': False, 'cooldown': False, 'instructions': SURRENDER_INSTRUCTIONS}
        if last and (now - last).total_seconds() < FOUND_COOLDOWN_SECONDS:
            return {**result, 'cooldown': True}
        # Claim the notification atomically so two simultaneous finders produce one message.
        query = self._table().update({'last_found_notice_at': _iso(now), 'found_notice_count': int(tag.get('found_notice_count') or 0) + 1}).eq('tag_id', tag_id)
        query = query.eq('last_found_notice_at', tag['last_found_notice_at']) if tag.get('last_found_notice_at') else query.is_('last_found_notice_at', 'null')
        try:
            claimed = query.execute().data or []
        except Exception as error:
            self._guard(error)
        if not claimed:
            return {**result, 'cooldown': True}
        self._notify_owner(tag, note, contact)
        return {**result, 'notified': True}

    def _notify_owner(self, tag: Dict[str, Any], note: str, contact: str) -> None:
        item = tag.get('item_name') or 'your item'
        owner = self._profile(tag.get('owner_account_id')) or {}
        text = f'Someone scanned the Smart Tag on "{item}" and says they found it. They were asked to bring it to the OHSO guard post.'
        if note:
            text += f' Their message: {note}'
        if contact:
            text += f' Contact: {contact}'
        try:
            self.db.create_user_notification(
                str(tag['owner_account_id']), 'Someone found your item', text,
                notification_type='smart_tag_found', link_label='View my Smart Tags', link_page='my-tags',
            )
        except Exception as error:
            logger.warning('Smart tag in-app notice failed: %s', error)
        if owner.get('email'):
            try:
                from app.utils.email_service import send_reference_email_best_effort
                send_reference_email_best_effort(
                    to_email=owner['email'], recipient_name=str(owner.get('fname') or '').strip(),
                    subject=f'Someone found your item: {item}',
                    summary='Someone scanned your Smart Tag and says they found your item. They were asked to bring it to the OHSO guard post. Check with the guard post before you go, and do not share your passwords or codes with anyone.',
                    reference_label='Smart Tag code', reference=tag['tag_id'],
                    details={'Item': item, 'Message from the finder': note, 'Finder contact': contact},
                )
            except Exception as error:
                logger.warning('Smart tag email failed: %s', error)

    def _log(self, account_id: str, action: str, row: Dict[str, Any]) -> None:
        try:
            profile = self._profile(account_id) or {}
            self.db.log_user_activity(account_id=account_id, user_name=self._name(profile) or 'User', action=action, module='Smart Tags',
                                      target_name=row.get('item_name') or row['tag_id'], target_id=row['tag_id'])
        except Exception as error:
            logger.warning('Smart tag activity log failed: %s', error)

    # ------------------------------------------------------------------ admin
    def create_batch(self, count: Any, label: Any, admin_id: str, tag_type: Any = 'qr', validity_months: Any = None) -> Dict[str, Any]:
        try:
            number = int(count)
        except (TypeError, ValueError):
            raise TagError('Enter how many tags to generate.')
        if number < 1 or number > MAX_BATCH:
            raise TagError(f'You can generate between 1 and {MAX_BATCH} tags at a time.')
        kind = str(tag_type or 'qr').strip().lower()
        if kind not in TAG_TYPES:
            raise TagError('Choose a tag type.')
        if kind not in enabled_tag_types():
            raise TagError(f'{TAG_TYPES[kind]} tags are not available yet.')
        months = parse_validity(validity_months)
        batch_id = str(uuid.uuid4())
        batch = clean_text(label, 80) or f"Batch {_now().strftime('%Y-%m-%d %H:%M')}"
        ids: List[str] = []
        for _attempt in range(3):  # a collision is astronomically unlikely, but handle it anyway
            ids = []
            seen = set()
            while len(ids) < number:
                candidate = generate_tag_id()
                if candidate not in seen:
                    seen.add(candidate)
                    ids.append(candidate)
            rows = [{'tag_id': tag_id, 'status': 'blank', 'batch_label': batch, 'batch_id': batch_id, 'tag_type': kind, 'validity_months': months, 'created_by': admin_id} for tag_id in ids]
            try:
                for start in range(0, len(rows), 200):
                    self._table().insert(rows[start:start + 200]).execute()
                return {'count': number, 'batch_label': batch, 'batch_id': batch_id, 'tag_type': kind, 'validity_months': months, 'tag_ids': ids,
                        'values': [encode_value(kind, tag_id) for tag_id in ids], 'tag_url_base': public_base_url(), 'url_check': url_check()}
            except Exception as error:
                if 'duplicate' in str(error).lower() or '23505' in str(error):
                    continue
                self._guard(error)
        raise TagError('Could not generate unique tags. Try again.', 500)

    def admin_list(self, status: str = 'all', query: str = '') -> Dict[str, Any]:
        status = (status or 'all').lower()
        self._expire_due()
        try:
            def count(**flt):
                q = self._table().select('tag_id', count='exact')
                for key, value in flt.items():
                    q = q.in_(key, value) if isinstance(value, list) else q.eq(key, value)
                return int(q.limit(1).execute().count or 0)
            stats = {'total': count(), 'blank': count(status='blank', is_disabled=False), 'claimed': count(status=['active', 'lost', 'expired', PENDING]),
                     'lost': count(status='lost'), 'expired': count(status='expired'), 'pending': count(status=PENDING), 'disabled': count(is_disabled=True)}
            q = self._table().select('*')
            if status == 'blank':
                q = q.eq('status', 'blank').eq('is_disabled', False)
            elif status == 'claimed':
                q = q.in_('status', ['active', 'lost', 'expired', PENDING])
            elif status == 'pending':
                q = q.eq('status', PENDING)
            elif status == 'lost':
                q = q.eq('status', 'lost')
            elif status == 'expired':
                q = q.eq('status', 'expired')
            elif status == 'disabled':
                q = q.eq('is_disabled', True)
            rows = q.order('created_at', desc=True).limit(1000).execute().data or []
        except Exception as error:
            self._guard(error)
        owners: Dict[str, Dict[str, Any]] = {}
        ids = sorted({str(r['owner_account_id']) for r in rows if r.get('owner_account_id')})
        for start in range(0, len(ids), 100):
            for profile in self.client.table('user_profiles').select('account_id,fname,lname,email,campus_id').in_('account_id', ids[start:start + 100]).execute().data or []:
                owners[str(profile['account_id'])] = profile
        items = []
        needle = clean_text(query, 80).lower()
        for row in rows:
            owner = owners.get(str(row.get('owner_account_id'))) if row.get('owner_account_id') else None
            item = {
                'tag_id': row['tag_id'], 'status': row.get('status'), 'is_disabled': bool(row.get('is_disabled')), 'disabled_reason': row.get('disabled_reason'),
                'item_name': row.get('item_name') or '', 'batch_label': row.get('batch_label') or '', 'created_at': row.get('created_at'), 'claimed_at': row.get('claimed_at'),
                'found_notice_count': int(row.get('found_notice_count') or 0), 'last_found_notice_at': row.get('last_found_notice_at'),
                'tag_type': row.get('tag_type') or 'qr', 'validity_months': row.get('validity_months'), 'valid_until': row.get('valid_until'),
                'days_left': days_left(row.get('valid_until')) if row.get('status') in ('active', 'lost') else None, 'batch_id': row.get('batch_id'),
                'scan_count': int(row.get('scan_count') or 0), 'last_scanned_at': row.get('last_scanned_at'), 'has_photo': bool(row.get('item_image_url') or row.get('pending_image_url')),
                'has_pending_photo': bool(row.get('pending_image_url')), 'is_reregistration': bool(row.get('prior_status')),
                'submitted_at': row.get('review_requested_at') if row.get('status') == PENDING else None, 'verified_at': row.get('verified_at'),
                'item_description': row.get('item_description') or '', 'show_name': bool(row.get('show_name')), 'show_email': bool(row.get('show_email')),
                'show_phone': bool(row.get('show_phone')), 'contact_phone': row.get('contact_phone') or '',
                'owner': {'name': self._name(owner), 'email': owner.get('email') or '', 'campus_id': owner.get('campus_id') or ''} if owner else None,
                'url': tag_url(row['tag_id']),
            }
            if needle and needle not in f"{item['tag_id']} {item['item_name']} {item['batch_label']} {(item['owner'] or {}).get('name', '')} {(item['owner'] or {}).get('email', '')}".lower():
                continue
            items.append(item)
        return {'tags': items, 'stats': stats, 'tag_url_base': public_base_url(), 'url_check': url_check(), 'tag_types': tag_type_options()}

    def set_disabled(self, raw_tag_id: Any, disabled: bool, reason: Any, admin_id: str) -> Dict[str, Any]:
        tag_id = normalize_tag_id(raw_tag_id)
        if not tag_id:
            raise TagError('This Smart Tag was not found.', 404)
        note = clean_text(reason, 300)
        if disabled and len(note) < 3:
            raise TagError('Give a short reason. The owner is told why the tag was deactivated.')
        tag = self._get(tag_id)
        now = _iso(_now())
        changes = {'is_disabled': True, 'disabled_reason': note, 'disabled_by': admin_id, 'disabled_at': now, 'updated_at': now} if disabled else \
                  {'is_disabled': False, 'disabled_reason': None, 'disabled_by': None, 'disabled_at': None, 'updated_at': now}
        try:
            rows = self._table().update(changes).eq('tag_id', tag_id).execute().data or []
        except Exception as error:
            self._guard(error)
        if disabled and tag.get('owner_account_id'):
            try:
                self.db.create_user_notification(
                    str(tag['owner_account_id']), 'Smart Tag deactivated', f'Your Smart Tag for "{tag.get("item_name") or "your item"}" was deactivated by an administrator. Reason: {note}',
                    notification_type='smart_tag_disabled', link_label='View my Smart Tags', link_page='my-tags',
                )
            except Exception as error:
                logger.warning('Smart tag disable notice failed: %s', error)
        return rows[0] if rows else tag

    # ------------------------------------------------------------------ admin: batches and renewal
    def _all_rows(self, columns: str, limit: int = 20000) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        start = 0
        while len(rows) < limit:
            chunk = self._table().select(columns).order('created_at', desc=True).range(start, start + 999).execute().data or []
            rows += chunk
            if len(chunk) < 1000:
                break
            start += 1000
        return rows

    def batches(self) -> Dict[str, Any]:
        """One row per generated batch, the ones whose registered tags expire soonest first."""
        self._expire_due()
        try:
            rows = self._all_rows('tag_id,status,is_disabled,batch_id,batch_label,tag_type,validity_months,valid_until,created_at,scan_count,last_scanned_at')
        except Exception as error:
            self._guard(error)
        now = _now()
        groups: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            key = str(row.get('batch_id') or f"label:{row.get('batch_label') or ''}")
            group = groups.setdefault(key, {
                'batch_id': row.get('batch_id'), 'label': row.get('batch_label') or 'Unnamed batch', 'tag_type': row.get('tag_type') or 'qr',
                'validity_months': row.get('validity_months'), 'created_at': row.get('created_at'),
                'total': 0, 'blank': 0, 'active': 0, 'lost': 0, 'expired': 0, 'pending': 0, 'disabled': 0, 'expiring_soon': 0, 'scans': 0, 'next_expiry': None,
            })
            group['total'] += 1
            group['scans'] += int(row.get('scan_count') or 0)
            if row.get('is_disabled'):
                group['disabled'] += 1
            status = row.get('status') or 'blank'
            group['pending' if status == PENDING else status if status in ('blank', 'active', 'lost', 'expired') else 'blank'] += 1
            until = _parse(row.get('valid_until'))
            if status in ('active', 'lost') and until:
                if group['next_expiry'] is None or until < _parse(group['next_expiry']):
                    group['next_expiry'] = _iso(until)
                if (until - now).total_seconds() <= EXPIRY_WARNING_DAYS * 86400:
                    group['expiring_soon'] += 1
            if row.get('created_at') and str(row['created_at']) < str(group['created_at'] or '~'):
                group['created_at'] = row['created_at']
        items = list(groups.values())
        for item in items:
            item['days_to_expiry'] = days_left(item['next_expiry'], now) if item['next_expiry'] else None
            item['all_disabled'] = item['disabled'] == item['total']
        # Closest to expiring first, then batches without an expiry date, newest first.
        items.sort(key=lambda b: (b['next_expiry'] is None, b['next_expiry'] or '', str(b['created_at'] or '')), reverse=False)
        with_expiry = [b for b in items if b['next_expiry']]
        without = sorted([b for b in items if not b['next_expiry']], key=lambda b: str(b['created_at'] or ''), reverse=True)
        return {'batches': with_expiry + without, 'warning_days': EXPIRY_WARNING_DAYS}

    def set_batch_disabled(self, raw_batch_id: Any, disabled: bool, reason: Any, admin_id: str) -> Dict[str, Any]:
        """Switch a whole batch off (or back on), for example when a roll of stickers is stolen."""
        try:
            batch_id = str(uuid.UUID(str(raw_batch_id)))
        except ValueError:
            raise TagError('This batch was not found.', 404)
        note = clean_text(reason, 300)
        if disabled and len(note) < 3:
            raise TagError('Give a short reason. Owners of affected tags are told why.')
        try:
            if not (self._table().select('tag_id').eq('batch_id', batch_id).limit(1).execute().data or []):
                raise TagError('This batch was not found.', 404)
            now = _iso(_now())
            changes = {'is_disabled': True, 'disabled_reason': note, 'disabled_by': admin_id, 'disabled_at': now, 'updated_at': now} if disabled else \
                      {'is_disabled': False, 'disabled_reason': None, 'disabled_by': None, 'disabled_at': None, 'updated_at': now}
            rows = self._table().update(changes).eq('batch_id', batch_id).eq('is_disabled', not disabled).execute().data or []
        except TagError:
            raise
        except Exception as error:
            self._guard(error)
        if disabled:
            for owner_id in sorted({str(r['owner_account_id']) for r in rows if r.get('owner_account_id')})[:500]:
                try:
                    self.db.create_user_notification(
                        owner_id, 'Smart Tag deactivated', f'Your Smart Tag was deactivated by an administrator together with its whole batch. Reason: {note}',
                        notification_type='smart_tag_disabled', link_label='View my Smart Tags', link_page='my-tags',
                    )
                except Exception as error:
                    logger.warning('Batch disable notice failed: %s', error)
        return {'batch_id': batch_id, 'changed': len(rows)}

    def renew(self, raw_tag_id: Any, months: Any, admin_id: str) -> Dict[str, Any]:
        """Extend a registered tag (the owner bought another year). An expired tag becomes active again."""
        tag_id = normalize_tag_id(raw_tag_id)
        if not tag_id:
            raise TagError('This Smart Tag was not found.', 404)
        count = parse_validity(months)
        if count is None:
            raise TagError('Enter how many months to add.')
        tag = self._get(tag_id)
        if tag.get('status') == 'blank' or not tag.get('owner_account_id'):
            raise TagError('Only a registered tag can be renewed.', 409)
        if tag.get('status') == PENDING:
            raise TagError('Approve this tag first. It is still waiting for verification.', 409)
        now = _now()
        base = max(now, _parse(tag.get('valid_until')) or now)
        changes = {'valid_until': _iso(add_months(base, count)), 'updated_at': _iso(now)}
        if tag.get('status') == 'expired':
            changes['status'] = 'active'
        try:
            rows = self._table().update(changes).eq('tag_id', tag_id).execute().data or []
        except Exception as error:
            self._guard(error)
        row = rows[0] if rows else {**tag, **changes}
        try:  # a renewed tag may need a fresh expiry reminder later; a separate step so renewing works before migration 20261013
            self._table().update({'expiry_reminder_sent_at': None}).eq('tag_id', tag_id).execute()
        except Exception:
            pass
        try:
            self.db.create_user_notification(
                str(tag['owner_account_id']), 'Smart Tag renewed', f'Your Smart Tag for "{tag.get("item_name") or "your item"}" is valid until {add_months(base, count).strftime("%B %d, %Y")}.',
                notification_type='smart_tag_renewed', link_label='View my Smart Tags', link_page='my-tags',
            )
        except Exception as error:
            logger.warning('Renewal notice failed: %s', error)
        return row
