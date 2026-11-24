"""Minimal page-open logs; scanner locations require separate recipient consent."""
import hashlib
import os
from datetime import datetime, timezone
from uuid import UUID
from .report_publication import installed
from .tag_recovery import point
from .smart_tags import TagError, normalize_tag_id
from .campus_catalogue import available


def enabled(client):
    return os.getenv('SMART_TAG_SCAN_LOGGING_ENABLED','').lower()=='true' and installed(client)


def command(service, tag, body, action):
    if not enabled(service.client):
        raise TagError('Scan activity is unavailable. Basic recovery still works.',503)
    if not isinstance(body,dict) or set(body)-{'scan_id','token','admin_consent','owner_consent','consent_version','venue','drop_off','point'}:
        raise TagError('Invalid scan request')
    try:
        scan = str(UUID(str(body.get('scan_id'))))
    except ValueError:
        raise TagError('Invalid scan receipt') from None
    tag = normalize_tag_id(tag)
    token = body.get('token')
    if not tag or not isinstance(token,str) or not 32<=len(token)<=128:
        raise TagError('Invalid scan receipt')
    data = {}
    if action=='share':
        for field in ('admin_consent','owner_consent'):
            if type(body.get(field)) is not bool:
                raise TagError('Choose who may see this location')
        if not(body['admin_consent'] or body['owner_consent']) or body.get('consent_version')!='scan-v1':
            raise TagError('Choose an optional location recipient first')
        venue, drop_off = body.get('venue',''), body.get('drop_off','')
        if not isinstance(venue,str) or not isinstance(drop_off,str):
            raise TagError('Choose a valid campus area or drop-off')
        if venue and venue not in available(service.client):
            raise TagError('Choose a listed campus area')
        if drop_off not in ('','OHSO guard post','Lost and Found Office'):
            raise TagError('Choose a listed drop-off')
        value = body.get('point')
        validated = point({**value,'consent_version':'finder-v1'}) if isinstance(value,dict) else point(value)
        if not(venue or drop_off or validated):
            raise TagError('Choose an area/drop-off or obtain your location')
        data = dict(admin_consent=body['admin_consent'],owner_consent=body['owner_consent'],
            consent_version='scan-v1',venue=venue,drop_off=drop_off,point=validated)
    try:
        return service.client.rpc('smart_tag_scan_command',dict(p_action=action,p_scan=scan,p_tag=tag,
            p_hash=hashlib.sha256(token.encode()).hexdigest(),p_data=data)).execute().data
    except Exception:
        raise TagError('Scan receipt expired, changed or unavailable. Reload for a new visit; basic recovery remains available.',409) from None


def sanitize(row, recipient):
    now = datetime.now(timezone.utc)
    r = {key:row.get(key) for key in ('scan_id','tag_id','scanned_at','expires_at','admin_consent','owner_consent',
        'shared_at','withdrawn_at','resolved_at','version','location_expires_at')}
    allowed = row.get(recipient+'_consent') and not(row.get('resolved_at') or row.get('withdrawn_at'))
    try:
        alive=datetime.fromisoformat(str(row.get('location_expires_at')).replace('Z','+00:00'))>now
    except (ValueError,TypeError):
        alive=False
    if allowed and alive:
        r.update({key:row.get(key) for key in ('venue','drop_off','latitude','longitude','accuracy','captured_at')})
    return r


def list_scans(service, offset=0, tag='', status='all', owner=None):
    if not enabled(service.client):
        return dict(available=False,scans=[],has_more=False)
    now = datetime.now(timezone.utc).isoformat()
    q=service.client.table('smart_tag_scans').select('*').gt('expires_at',now)
    if owner:
        code=normalize_tag_id(tag)
        if not code or str(service._get(code).get('owner_account_id'))!=str(owner):
            raise TagError('Tag unavailable',404)
        q=q.eq('tag_id',code).eq('owner_id',owner).eq('owner_consent',True).is_('withdrawn_at','null')
    elif tag:
        q=q.eq('tag_id',normalize_tag_id(tag) or '')
    if status=='open': q=q.is_('resolved_at','null')
    elif status=='resolved': q=q.not_.is_('resolved_at','null')
    elif status!='all': raise TagError('Choose a valid scan state')
    rows=q.order('scanned_at',desc=True).order('scan_id').range(offset,offset+50).execute().data or []
    return dict(available=True,scans=[sanitize(row,'owner' if owner else 'admin') for row in rows[:50]],has_more=len(rows)>50)
