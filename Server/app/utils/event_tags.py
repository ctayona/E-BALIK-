"""Private per-use event storage. Issued codes never enter personal Smart Tag services."""
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.utils.crypto_service import CryptoService
from app.utils.event_assets import normalize_artwork
from app.utils.event_lifecycle import EventLifecycle, parse
from app.utils.event_recovery import EventRecovery
from app.utils.event_reports import BUCKET, EventReports
from app.utils.event_share import event_origin, entry_qr
from app.utils.events import EventError, event_id, _text
from app.utils.handover import generate_pin, PIN_LENGTH, PIN_ALPHABET

MIGRATION = '20261124_event_smart_tags'
OPEN = ['pending', 'held', 'office']
OFFICE = ('guard', 'admin', 'super_admin')
PUBLIC_FIELDS = ('registration_id','event_id','event_name','code','item_name','description','status','version',
                 'created_at','received_at','released_at','report_id','recovery_consent')
NOTICES = {'receive':'Your event item is in custody.', 'collect':'Your event item was collected.',
           'remind':'Your event item is awaiting collection.', 'accept':'The university office received your event item.'}


class EventTags:
    def __init__(self, db):
        self.db, self.client = db, db.client
        self.lifecycle = EventLifecycle(db)
        self.rows = self.lifecycle.events._execute

    def mode(self):
        enabled = os.getenv('EVENT_SMART_TAGS_ENABLED','').lower() == 'true'
        recovery = os.getenv('EVENT_SMART_TAGS_RECOVERY_ONLY','').lower() == 'true'
        if not (enabled or recovery):
            return 'off'
        try:
            installed = self.rows(self.client.table('migration_log').select('name').eq('name', MIGRATION).limit(1))
        except Exception:
            return 'off'
        return ('recovery' if recovery else 'on') if installed else 'off'

    def require(self, new=False):
        mode = self.mode()
        if mode == 'off' or new and mode != 'on':
            raise EventError('Event tag intake is unavailable.' if new else 'Event tags are unavailable.', 503)
        return mode

    def table(self, suffix):
        return self.client.table('event_tag' + suffix)

    def one(self, query):
        rows = self.rows(query.limit(1))
        return rows[0] if rows else {}

    def inventory(self, batch=None, offset=0):
        mode = self.require()
        origin, printable, warning = event_origin()
        if not batch:
            return dict(mode=mode, batches=self.rows(self.table('_batches').select('batch_id,label,created_at').order('created_at',desc=True).range(offset,offset+24)))
        tags = self.rows(self.table('s').select('code,version,disabled').eq('batch_id',event_id(batch)).order('code').limit(100))
        codes = [t['code'] for t in tags]
        allocations = self.rows(self.table('_allocations').select('code,event_id,event_workspaces(name)').in_('code',codes).is_('ended_at','null')) if codes else []
        held = self.rows(self.table('_registrations').select('code,status').in_('code',codes).in_('status',OPEN)) if codes else []
        assignments = {a['code']:a for a in allocations}
        states = {r['code']:r['status'] for r in held}
        return dict(mode=mode, printable=printable,warning=warning,tags=[dict(t,allocation=assignments.get(t['code']),held=states.get(t['code']),url=f"{origin}/event-tag/{t['code']}") for t in tags])

    def qr(self, code):
        self.require()
        origin, ready, warning = event_origin()
        if not ready: raise EventError(warning,409)
        if not self.one(self.table('s').select('code').eq('code',event_id(code))): raise EventError('Unknown event tag.',404)
        return entry_qr(f'{origin}/event-tag/{code}')

    def scan(self, code):
        self.require(new=True)
        row = self.one(self.table('_allocations').select('allocation_id,event_id,event_tags(version,disabled),event_workspaces(name,venue,desk_instructions,starts_at,ends_at,recovery_ends_at,deleted_at,portal_enabled,status)').eq('code',event_id(code)).is_('ended_at','null'))
        e = row.get('event_workspaces') or {}
        if not e or row['event_tags']['disabled'] or not EventReports.open(e) or e['status']!='active' or parse(e['ends_at']) <= datetime.now(timezone.utc):
            raise EventError('This tag is unavailable for check-in.',409)
        desk = self.one(self.table('_desks').select('enabled').eq('event_id',row['event_id']))
        if not desk.get('enabled') or self.one(self.table('_registrations').select('code').eq('code',code).in_('status',OPEN)):
            raise EventError('This tag is unavailable for check-in.',409)
        return dict(event_id=row['event_id'],allocation_id=row['allocation_id'],version=row['event_tags']['version'],
                    **{k:e[k] for k in ('name','venue','desk_instructions')})

    def staff(self, event, actor):
        if (self.db.get_user_by_account_id(actor) or {}).get('access_level') == 'super_admin': return 'super_admin'
        return self.lifecycle.authorize_workspace(event,actor)['role']

    def transfer(self, registration):
        return self.one(self.table('_transfers').select('receiver_id,destination,accepted_at').eq('registration_id',registration).is_('cancelled_at','null'))

    def view(self, row, owner=False, transfer=None):
        result = {k:row.get(k) for k in PUBLIC_FIELDS}
        if owner and row['status'] in ('held','office'):
            valid = row['attempts'] < 5 and parse(row['pin_at']) + timedelta(hours=24) > datetime.now(timezone.utc)
            result['pin'] = CryptoService.decrypt(row['pin_cipher']) if valid else None
        if not owner:
            result.update(storage=row.get('storage_position'),transfer=bool(transfer),destination=(transfer or {}).get('destination'))
            profile = row.get('attendee') or {}
            result['attendee'] = ' '.join(filter(None,[profile.get('fname'),profile.get('lname')]))
        if row['status']=='collected':
            result['receipt'] = 'ETS-' + row['registration_id'].replace('-','').upper()
        return result

    def listing(self, actor, scope, offset, event=None, registration=None, search='', status=''):
        self.require()
        columns = ','.join(PUBLIC_FIELDS)
        if scope=='mine':
            columns += ',attempts,pin_at,pin_cipher'
        else:
            relation = 'event_tag_transfers!inner' if scope=='office' else 'event_tag_transfers'
            columns += ',storage_position,attendee:user_profiles!event_tag_registrations_owner_id_fkey(fname,lname),'+relation+'(receiver_id,destination,accepted_at,cancelled_at)'
        q = self.table('_registrations').select(columns)
        role = 'owner'
        if scope=='mine':
            if event and event.startswith('slug:'):
                event = EventReports(self.db).event_for_slug(event[5:],include_deleted=True)['event_id']
            q = q.eq('owner_id',actor)
            if event: q = q.eq('event_id',event_id(event))
        elif scope=='staff':
            role = self.staff(event_id(event),actor)
            q = q.eq('event_id',event)
        elif scope=='office':
            role = 'office'
            if (self.db.get_user_by_account_id(actor) or {}).get('access_level') not in OFFICE:
                return dict(rows=[],role=role,more=False)
            # Join before paging. A receiver can only see their designated handovers.
            q = q.eq('event_tag_transfers.receiver_id',actor).is_('event_tag_transfers.cancelled_at','null').in_('status',['held','office'])
        else: raise EventError('Unknown item list.')
        if registration: q=q.eq('registration_id',event_id(registration))
        if status:
            if status not in OPEN + ['collected','cancelled']: raise EventError('Unknown custody status.')
            q=q.eq('status',status)
        if search:
            term=_text(search,'Search',160,True)
            code=term.rsplit('/',1)[-1].lower()
            if re.fullmatch('[0-9a-f]{8}',code):
                q=q.gte('code',code+'-0000-0000-0000-000000000000').lte('code',code+'-ffff-ffff-ffff-ffffffffffff')
            elif re.fullmatch('[a-f0-9-]{36}',code):
                q=q.eq('code',event_id(code))
            else:
                literal=term.replace('\\','\\\\').replace('%',r'\%').replace('_',r'\_')
                q=q.ilike('item_name','%'+literal+'%')
        rows=self.rows(q.order('created_at',desc=True).order('registration_id').range(offset,offset+24))
        def current_transfer(row):
            return next((x for x in row.get('event_tag_transfers',[]) if not x.get('cancelled_at')),None)
        return dict(rows=[self.view(r,scope=='mine',current_transfer(r)) for r in rows[:24]],role=role,more=len(rows)>24)

    def detail(self, actor, registration):
        self.require()
        row=self.one(self.table('_registrations').select('*').eq('registration_id',event_id(registration)))
        if not row: raise EventError('Event item unavailable.',404)
        if row['owner_id']!=actor:
            transfer=self.transfer(registration)
            if transfer.get('receiver_id')!=actor or (self.db.get_user_by_account_id(actor) or {}).get('access_level') not in OFFICE:
                self.staff(row['event_id'],actor)
        return row

    def photo(self, actor, registration):
        row=self.detail(actor,registration)
        path=row['photo_path']
        if not re.fullmatch(re.escape(row['event_id'])+r'/event-tags/[a-f0-9]{32}\.webp',path):
            raise EventError('Invalid custody photo.',409)
        return self.client.storage.from_(BUCKET).download(path)

    def rpc(self, actor, action, request_id, event=None, code=None, registration=None, version=None, data=None):
        self.require(new=action in ('issue','assign_batch','assign','register','receive') or action=='desk' and (data or {}).get('enabled'))
        params=dict(p_actor=event_id(actor),p_action=action,p_request=event_id(request_id),p_event=event_id(event) if event else None,
                    p_code=event_id(code) if code else None,p_registration=event_id(registration) if registration else None,p_version=version,p_data=data or {})
        try: return self.client.rpc('event_tag_command',params).execute().data
        except Exception as exc:
            kind=str(getattr(exc,'code',''))
            if kind=='P0001': raise EventError(str(getattr(exc,'message','Event item action refused.')),409) from exc
            if kind in ('P0002','23505','23514','22P02'): raise EventError('Item or allocation changed. Refresh and try again.',409) from exc
            raise

    def register(self, actor, body, photo):
        self.require(new=True)
        event,code,key,allocation=[event_id(body.get(k)) for k in ('event_id','code','request_id','allocation_id')]
        old=self.one(self.table('_history').select('registration_id').eq('actor_id',actor).eq('request_id',key).eq('event_id',event).eq('code',code).eq('action','register'))
        if old: return dict(registration_id=old['registration_id'],replay=True)
        scan=self.scan(code)
        if scan['allocation_id']!=allocation or scan['version']!=body.get('version') or scan['event_id']!=event: raise EventError('Scan this tag again.',409)
        if (self.db.get_user_by_account_id(actor) or {}).get('verification_status')!='verified': raise EventError('Verify your account before checking in.',403)
        name=_text(body.get('item_name'),'Item',100,True)
        desc=_text(body.get('description'),'Details',500,True)
        if len(name)<3 or not photo: raise EventError('Supply the item name and a live photo.')
        path=f'{event}/event-tags/{uuid4().hex}.webp'
        store=self.client.storage.from_(BUCKET)
        store.upload(path,normalize_artwork(photo,'banner'),{'content-type':'image/webp','upsert':'false','cache-control':'0'})
        try:
            result=self.rpc(actor,'register',key,event,code,version=scan['version'],data=dict(allocation_id=allocation,item_name=name,description=desc,photo_path=path))
        except EventError:
            self.discard_upload(store,path)
            raise
        if result.get('replay'):
            self.discard_upload(store,path)
        return result

    @staticmethod
    def discard_upload(bucket,path):
        try:
            bucket.remove([path])
        except Exception:
            logging.getLogger(__name__).warning('Event item upload cleanup deferred.')

    def action(self, actor, body, admin=False):
        if not isinstance(body,dict): raise EventError('Invalid action.')
        action=body.get('action')
        inventory=('issue','assign_batch','unassign_batch','assign','unassign','disable','enable','desk')
        operations=('cancel','receive','collect','reset_pin','transfer','accept','cancel_transfer','consent','escalate','remind')
        if action not in operations and not (admin and action in inventory): raise EventError('Unknown event tag action.')
        data={}
        if action=='issue':
            count=body.get('count')
            if type(count)!=int or not 1<=count<=100: raise EventError('Choose 1 to 100 tags.')
            data=dict(count=count,label=_text(body.get('label'),'Batch name',80,True))
        elif action in ('assign_batch','unassign_batch'):
            tags=body.get('tags')
            if not isinstance(tags,list) or not 1<=len(tags)<=100 or any(not isinstance(t,dict) or type(t.get('version'))!=int for t in tags):
                raise EventError('Choose available tags from one batch.')
            data=dict(batch_id=event_id(body.get('batch_id')),tags=[dict(code=event_id(t.get('code')),version=t['version']) for t in tags])
        elif action in ('desk','consent'):
            key='enabled' if action=='desk' else 'allowed'
            if type(body.get(key))!=bool: raise EventError('Confirm your selection.')
            data[key]=body[key]
        elif action in ('receive','accept'):
            data['storage']=_text(body.get('storage'),'Private storage position',160,True)
        elif action=='transfer':
            if self.staff(event_id(body.get('event_id')),actor) not in ('manager','super_admin'): raise EventError('Manager access required.',403)
            email=_text(body.get('email'),'Office account email',254,True).lower()
            person=self.one(self.client.table('user_profiles').select('account_id').eq('email',email))
            if not person: raise EventError('Office receiver unavailable.',409)
            data=dict(receiver_id=person['account_id'],destination=_text(body.get('destination'),'Office destination',160,True))
        elif action=='escalate':
            data['reason']=_text(body.get('reason'),'Recovery reason',500,True)
            if len(data['reason'])<10: raise EventError('Describe the recovery reason in at least ten characters.')
        if action in operations:
            row=self.detail(actor,body.get('registration_id'))
            if row['event_id']!=body.get('event_id') or row['code']!=body.get('code'): raise EventError('Wrong registration scope.',403)
        if action in ('receive','reset_pin'):
            pin=generate_pin()
            data.update(hash=EventRecovery.pin_hash(row['registration_id'],pin),cipher=CryptoService.encrypt(pin),
                        fingerprint=EventRecovery.pin_hash(row['code'],pin))
        if action=='collect':
            pin=_text(body.get('pin'),'PIN',32,True).upper().replace(' ','').replace('-','')
            if body.get('identity_checked') is not True or len(pin)!=PIN_LENGTH or any(c not in PIN_ALPHABET for c in pin): raise EventError('Verify identity and enter the complete Handover PIN.')
            data.update(hash=EventRecovery.pin_hash(row['registration_id'],pin),identity_checked=True)
        version=body.get('version')
        if action not in ('issue','assign_batch','unassign_batch') and (type(version)!=int or version<0): raise EventError('Refresh the current version.')
        result=self.rpc(actor,action,body.get('request_id'),body.get('event_id'),body.get('code'),body.get('registration_id'),version,data)
        if result.get('outcome')=='invalid_pin': raise EventError('Incorrect PIN. Refresh before another attempt.',409)
        if action in NOTICES and not result.get('replay'):
            result.update(self.notify(row,action))
        return result

    def notify(self,row,action):
        rid=row['registration_id']
        path=f'event-items/{rid}'
        message=NOTICES[action]
        notified=emailed=False
        try:
            self.db.create_user_notification(row['owner_id'],'Event item update',message,notification_type='event_item',link_label='View event item',link_page=path)
            notified=True
        except Exception: pass
        try:
            from app.utils.email_service import send_reference_email_best_effort
            owner=self.db.get_user_by_account_id(row['owner_id']) or {}
            if owner.get('email'):
                emailed=bool(send_reference_email_best_effort(to_email=owner['email'],recipient_name=owner.get('fname') or '',subject='E-Balik event item update',
                 summary=message,reference_label='Registration',reference=rid[:8].upper(),details={},cta_label='View event item',cta_path='/'+path))
        except Exception: pass
        return dict(notified=notified,emailed=emailed)
