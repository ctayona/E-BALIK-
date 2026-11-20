"""Read-only NFC encoding preparation. Never claim, scan, activate or change a tag."""
from urllib.parse import urlsplit

from app.utils.smart_tags import (
    TagError, clean_phone, clean_text, initials_of, normalize_tag_id,
    stored_contacts, stored_settings, tag_url, url_check, _parse, _now,
)


def prepare_nfc(service, raw_tag_id, *, account_id=None, offline_contact=False):
    tag_id = normalize_tag_id(raw_tag_id)
    if not tag_id:
        raise TagError('This Smart Tag was not found.', 404)
    # Do not use public_view/_refresh: encoding must not record scans or write expiry.
    tag = service._get(tag_id)
    if account_id is not None and str(tag.get('owner_account_id')) != str(account_id):
        raise TagError('This Smart Tag was not found.', 404)
    if tag.get('tag_type') != 'nfc':
        raise TagError('Only NFC tags can use the card writer.', 409)
    # Owners may rewrite URL-only to remove an old physical contact copy even while
    # the website is disabled. This does not reactivate the tag or expose its owner.
    if tag.get('is_disabled') and (account_id is None or offline_contact):
        raise TagError('Reactivate this tag before preparing its NFC card.', 409)
    url = tag_url(tag_id)
    try:
        parsed = urlsplit(url)
    except ValueError:
        raise TagError('PUBLIC_SITE_URL is not a valid public HTTPS address.', 409)
    if not url_check()['ok'] or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise TagError('Set PUBLIC_SITE_URL to the public HTTPS E-Balik address before writing NFC cards.', 409)
    records = [{'recordType': 'url', 'data': url}]
    if offline_contact:
        if account_id is None:
            raise TagError('Only the owner can choose to copy contact details onto a card.', 403)
        until = _parse(tag.get('valid_until'))
        if tag.get('status') not in ('active', 'lost') or (until and until <= _now()):
            raise TagError('Offline contact requires a current, staff-approved tag.', 409)
        owner = service._profile(account_id)
        if not owner:
            raise TagError('The owner account is unavailable.', 409)
        # Reuse the online visibility choices, including initials and the saved phone option.
        name = service._name(owner) if tag.get('show_name') else ''
        if stored_settings(owner)['name_display'] == 'initials':
            name = initials_of(name)
        phone = tag.get('contact_phone') if tag.get('show_phone') else ''
        if not phone and 'phone2' in (tag.get('shown_contacts') or []):
            phone = stored_contacts(owner).get('phone2', '')
        name, phone = clean_text(name, 100), clean_phone(phone)
        if not name or not phone:
            raise TagError('First enable your name and a phone number in this tag\'s privacy settings.', 409)
        records.append({'recordType': 'text', 'data': f'E-Balik recovery contact\nName: {name}\nPhone: {phone}', 'lang': 'en', 'encoding': 'utf-8'})
    return {'tag_id': tag_id, 'url': url, 'records': records, 'offline_contact': bool(offline_contact)}
