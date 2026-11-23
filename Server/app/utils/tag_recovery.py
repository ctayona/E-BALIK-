"""Private Smart Tag finder reports. Keep precise locations out of logs and alerts."""
import logging
import math
import os
from datetime import datetime, timedelta, timezone
from uuid import UUID

from .campus_catalogue import available
from .smart_tags import TagError, SURRENDER_INSTRUCTIONS, clean_text, normalize_tag_id

logger = logging.getLogger(__name__)
MIGRATION = '20261123b_smart_tag_recovery'


def installed(client):
    try:
        return bool(client.table('migration_log').select('name').eq('name', MIGRATION).limit(1).execute().data)
    except Exception:
        return False


def enabled(client):
    return os.getenv('SMART_TAG_RECOVERY_ENABLED', '').lower() == 'true' and installed(client)


def require(client):
    if not enabled(client):
        raise TagError('Enhanced recovery is unavailable. Refresh to use the standard finder form.', 503)


def point(value):
    if value is None:
        return None
    fields = {'latitude', 'longitude', 'accuracy', 'captured_at', 'consent_version'}
    if not isinstance(value, dict) or set(value) != fields or value['consent_version'] != 'finder-v1':
        raise TagError('Confirm sharing this location before sending.')
    for key, low, high in [('latitude', -90, 90), ('longitude', -180, 180), ('accuracy', 0, 100000)]:
        number = value[key]
        if type(number) not in (float, int) or not low <= number <= high or not math.isfinite(number):
            raise TagError('Choose a valid location or remove it.')
    try:
        captured = datetime.fromisoformat(value['captured_at'].replace('Z', '+00:00'))
        age = datetime.now(timezone.utc) - captured
        if not timedelta(seconds=-30) <= age <= timedelta(minutes=10):
            raise ValueError()
    except (AttributeError, ValueError, TypeError, OverflowError):
        raise TagError('Location expired. Retry or remove it.') from None
    return value


def submit(service, tag_id, body):
    require(service.client)
    if set(body) - {'request_id', 'venue', 'message', 'contact', 'point'}:
        raise TagError('Unexpected report field.')
    if any(not isinstance(body.get(key, ''), str) for key in ('venue', 'message', 'contact')):
        raise TagError('Venue, message and contact must be text.')
    try:
        request_id = str(UUID(str(body.get('request_id'))))
    except ValueError:
        raise TagError('Invalid report reference.') from None
    venue = body.get('venue') or None
    if venue and venue not in available(service.client):
        raise TagError('Choose a listed campus location.')
    tag_id = normalize_tag_id(tag_id)
    if not tag_id:
        raise TagError('Smart Tag unavailable.', 404)
    args = dict(p_tag=tag_id, p_request=request_id, p_venue=venue,
                p_note=clean_text(body.get('message'), 300, multiline=True),
                p_contact=clean_text(body.get('contact'), 120), p_point=point(body.get('point')))
    try:
        result = service.client.rpc('tag_recovery_submit', args).execute().data
    except Exception:
        raise TagError('Unable to confirm the report. Retry using this form.', 503) from None
    state = result['state']
    if state == 'inactive':
        raise TagError('This tag cannot receive finder reports.', 409)
    if state == 'venue_unavailable':
        raise TagError('This venue was retired. Choose another or clear the selection.', 409)
    if state not in ('saved', 'duplicate', 'cooldown'):
        raise TagError('Unable to confirm the report. Retry using this form.', 503)
    emailed = notified = False
    if state == 'saved':
        try:
            notified, emailed = service._notify_owner(
                {'owner_account_id': result['owner'], 'tag_id': tag_id, 'item_name': result['item']},
                '', '', private_report=True, venue=(venue or '').split(' / ')[0])
        except Exception:
            logger.warning('Unable to send saved recovery report alerts')
    return dict(saved=state != 'cooldown', replayed=state == 'duplicate', notified=notified, emailed=emailed,
                cooldown=state == 'cooldown', instructions=SURRENDER_INSTRUCTIONS)


def owned(service, tag, owner):
    require(service.client)
    tag = normalize_tag_id(tag)
    if not tag or str(service._get(tag).get('owner_account_id')) != str(owner):
        raise TagError('Smart Tag unavailable.', 404)
    return service.client.table('tag_recovery_reports'), tag


def history(service, tag, owner, offset=0):
    table, tag = owned(service, tag, owner)
    fields = 'report_id,created_at,venue,note,contact,found_item_id,received_at,returned_at,review'
    rows = (table.select(fields).eq('owner_id', owner).eq('tag_id', tag)
            .order('created_at', desc=True).order('report_id').range(offset, offset+49).execute().data or [])
    ids = [r['report_id'] for r in rows if not r['returned_at']]
    points = []
    if ids:
        points = (service.client.table('tag_recovery_points').select('report_id,latitude,longitude,accuracy,captured_at,expires_at')
                  .in_('report_id', ids).gt('expires_at', datetime.now(timezone.utc).isoformat()).execute().data or [])
    linked = {r.get('found_item_id') for r in rows if r.get('found_item_id')}
    references = {}
    if linked:
        items = service.client.table('found_items').select('item_id,fpost_id').in_('item_id', list(linked)).execute().data or []
        references = {item['item_id']: item['fpost_id'] for item in items}
    logger.info('Owner recovery history read owner=%s tag=%s', owner, tag)
    by_id = {p['report_id']: p for p in points}
    return [{**{key: r.get(key) for key in fields.split(',') if key != 'found_item_id'},
             'point': by_id.get(r['report_id']), 'reference': references.get(r.get('found_item_id'))} for r in rows]
